import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const ART = process.env.ARTIFACTS || '/opt/cursor/artifacts';
const PORT = Number(process.env.PORT || 4173);
const balanceOnly = process.argv.includes('--balance-only');
const skipBalance = process.argv.includes('--skip-balance');

async function startServer() {
  const proc = spawn('python3', ['-u', '-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  proc.stdout.on('data', (chunk) => { buf += chunk.toString(); });
  proc.stderr.on('data', (chunk) => { buf += chunk.toString(); });
  let exited = false;
  proc.on('exit', () => { exited = true; });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (exited) throw new Error('server exited early\n' + buf);
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/');
      if (res.status >= 200 && res.status < 500) return proc;
    } catch (err) {}
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  proc.kill('SIGTERM');
  throw new Error('server did not start\n' + buf);
}

function trackErrors(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    errors.push(String(err && err.stack ? err.stack : err));
  });
  return errors;
}

async function drag(page, fromFrac, toFrac) {
  const vp = page.viewportSize();
  const y = Math.round(vp.height * 0.72);
  const x1 = Math.round(vp.width * fromFrac);
  const x2 = Math.round(vp.width * toFrac);
  await page.mouse.move(x1, y);
  await page.mouse.down();
  await page.mouse.move(x2, y, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const moved = await page.evaluate(() => Math.abs(window.__EMBERLINE__.cannonNX - 0.5) > 0.04);
  if (moved) return 'mouse';
  await page.evaluate(({ x1, y, x2 }) => {
    const c = document.getElementById('view');
    const fire = (type, x) => {
      c.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
      }));
    };
    fire('pointerdown', x1);
    const steps = 12;
    for (let i = 1; i <= steps; i++) fire('pointermove', x1 + (x2 - x1) * (i / steps));
    fire('pointerup', x2);
  }, { x1, y, x2 });
  await page.waitForTimeout(80);
  return 'pointer';
}

async function playProfile(browser, name, contextOptions, shots) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = trackErrors(page);
  const url = `http://127.0.0.1:${PORT}/?debug=1`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__EMBERLINE__ && window.__EMBERLINE__.phase === 'title');

  const touchAction = await page.evaluate(() => getComputedStyle(document.documentElement).touchAction);
  if (touchAction !== 'none') throw new Error(name + ' touch-action was ' + touchAction);
  const vpMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
  if (!vpMeta || vpMeta.indexOf('viewport-fit=cover') < 0) throw new Error(name + ' viewport meta missing');
  const srcs = await page.evaluate(() => Array.from(document.scripts).map((s) => s.getAttribute('src')));
  if (srcs.indexOf('./game.js') < 0) throw new Error(name + ' script src is not relative: ' + srcs.join(','));
  const hosts = await page.evaluate(() => {
    const out = [];
    const entries = performance.getEntriesByType('resource');
    for (let i = 0; i < entries.length; i++) out.push(new URL(entries[i].name).host);
    return out;
  });
  const pageHost = new URL(page.url()).host;
  for (const host of hosts) {
    if (host && host !== pageHost) throw new Error(name + ' loaded off-origin resource from ' + host);
  }

  await page.evaluate(() => window.scrollTo(0, 400));
  const scrollY = await page.evaluate(() => window.scrollY);
  if (scrollY !== 0) throw new Error(name + ' page scrolled to ' + scrollY);

  await page.locator('[data-action="start"]').click();
  await page.waitForFunction(() => window.__EMBERLINE__.phase === 'play' && window.__EMBERLINE__.stage === 1);

  const before = await page.evaluate(() => window.__EMBERLINE__.cannonNX);
  const dragMode = await drag(page, 0.62, 0.22);
  await page.waitForTimeout(180);
  const after = await page.evaluate(() => window.__EMBERLINE__.cannonNX);
  if (Math.abs(after - before) < 0.05) {
    throw new Error(name + ' drag did not move cannon (' + dragMode + ') ' + before + ' -> ' + after);
  }

  await page.waitForFunction(() => window.__EMBERLINE__.friendlyAlive > 4 && window.__EMBERLINE__.spawnedTotal > 4, null, { timeout: 5000 });
  await page.evaluate(() => window.__EMBERLINE__.restart());
  await page.waitForFunction(() => window.__EMBERLINE__.phase === 'play' && window.__EMBERLINE__.spawnedTotal < 4);
  await page.evaluate(() => window.__EMBERLINE__.trackGate('add', 10));
  const gate = await page.waitForFunction(() => {
    const e = window.__EMBERLINE__.gateProof();
    if (!e || e.op !== 'add' || e.value !== 10 || e.after <= e.before) return false;
    return { op: e.op, value: e.value, before: e.before, after: e.after, alive: window.__EMBERLINE__.friendlyAlive };
  }, null, { timeout: 8000 }).then((handle) => handle.jsonValue());

  await page.waitForFunction(() => window.__EMBERLINE__.enemyAlive > 0, null, { timeout: 5000 });
  if (shots && shots.gameplay) {
    await page.waitForTimeout(350);
    await page.screenshot({ path: shots.gameplay });
  }

  await page.evaluate(() => window.__EMBERLINE__.clearTrack());
  await page.evaluate(() => window.__EMBERLINE__.forceWin());
  await page.waitForSelector('[data-screen="win"]:not([hidden])');
  await page.locator('[data-screen="win"] [data-action="next"]').waitFor({ state: 'visible' });
  await page.locator('[data-screen="win"] [data-action="retry"]').waitFor({ state: 'visible' });
  if (shots && shots.win) await page.screenshot({ path: shots.win });

  await page.locator('[data-screen="win"] [data-action="retry"]').click();
  await page.waitForFunction(() => window.__EMBERLINE__.phase === 'play' && window.__EMBERLINE__.playerHp > 0);
  await page.evaluate(() => window.__EMBERLINE__.forceLose());
  await page.waitForSelector('[data-screen="lose"]:not([hidden])');
  await page.locator('[data-screen="lose"] [data-action="retry"]').waitFor({ state: 'visible' });
  if (shots && shots.lose) await page.screenshot({ path: shots.lose });

  await page.locator('[data-screen="lose"] [data-action="retry"]').click();
  await page.waitForFunction(() => window.__EMBERLINE__.phase === 'play');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__EMBERLINE__.fillCrowd(360, 120));
  await page.waitForTimeout(120);
  await page.evaluate(() => window.__EMBERLINE__.armSample());
  await page.waitForTimeout(800);
  const perf = await page.evaluate(() => window.__EMBERLINE__.sample());

  let cleared = null;
  if (shots && shots.win) {
    await page.evaluate(() => window.__EMBERLINE__.forceWin());
    await page.locator('[data-screen="win"] [data-action="next"]').click();
    await page.waitForFunction(() => window.__EMBERLINE__.phase === 'play' && window.__EMBERLINE__.stage === 2);
    await page.evaluate(() => window.__EMBERLINE__.forceWin());
    await page.locator('[data-screen="win"] [data-action="next"]').click();
    await page.waitForFunction(() => window.__EMBERLINE__.phase === 'play' && window.__EMBERLINE__.stage === 3);
    await page.evaluate(() => window.__EMBERLINE__.forceWin());
    await page.locator('[data-screen="win"] [data-action="next"]').click();
    await page.waitForSelector('[data-screen="clear"]:not([hidden])');
    await page.locator('[data-action="loop"]').click();
    await page.waitForFunction(() => window.__EMBERLINE__.phase === 'play' && window.__EMBERLINE__.stage === 1);
    cleared = true;
  }

  if (errors.length) throw new Error(name + ' console errors:\n' + errors.join('\n'));
  await context.close();
  return { name, dragMode, gate, perf, cleared, errors };
}

async function runBalance(browser, stage) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = trackErrors(page);
  const url = `http://127.0.0.1:${PORT}/?debug=1&autostart=1&bot=1&speed=24&stage=${stage}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__EMBERLINE__ && window.__EMBERLINE__.phase === 'play');
  const result = await page.waitForFunction(() => {
    const g = window.__EMBERLINE__;
    if (!g) return false;
    if (g.phase === 'win' || g.phase === 'lose') {
      return { phase: g.phase, simTime: g.simTime, hp: g.enemyHp, player: g.playerHp };
    }
    if (g.simTime > 420) return { phase: g.phase, simTime: g.simTime, hp: g.enemyHp, player: g.playerHp, timeout: true };
    return false;
  }, null, { timeout: 60000 });
  const value = await result.jsonValue();
  if (errors.length) throw new Error('balance stage ' + stage + ' console errors:\n' + errors.join('\n'));
  await context.close();
  return value;
}

async function assertCleanLoad(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'load' });
  await page.waitForSelector('[data-screen="title"]:not([hidden])');
  await page.waitForTimeout(400);
  const hook = await page.evaluate(() => typeof window.__EMBERLINE__);
  if (hook !== 'undefined') throw new Error('debug hook is present without ?debug=1');
  if (errors.length) throw new Error('default load console errors:\n' + errors.join('\n'));
  await context.close();
  console.log('PASS default load, hook off, zero console errors');
}

async function main() {
  await mkdir(ART, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const report = { profiles: [], balance: [] };
    if (!balanceOnly) {
      await assertCleanLoad(browser);
      const desktop = await playProfile(browser, 'desktop', {
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
      }, {
        gameplay: path.join(ART, 'gameplay_desktop.png'),
        win: path.join(ART, 'win_screen.png'),
        lose: path.join(ART, 'lose_screen.png'),
      });
      report.profiles.push(desktop);
      console.log('PASS desktop', JSON.stringify(desktop));

      const iphone = await playProfile(browser, 'iphone', {
        ...devices['iPhone 13'],
      }, {
        gameplay: path.join(ART, 'gameplay_iphone.png'),
      });
      report.profiles.push(iphone);
      console.log('PASS iphone', JSON.stringify(iphone));
    }
    if (!skipBalance) {
      for (const stage of [1, 2, 3]) {
        const outcome = await runBalance(browser, stage);
        report.balance.push({ stage, ...outcome });
        console.log('BALANCE stage ' + stage, JSON.stringify(outcome));
      }
      const s1 = report.balance[0];
      if (!s1 || s1.phase !== 'win') throw new Error('stage 1 bot did not win: ' + JSON.stringify(s1));
      if (s1.simTime < 70 || s1.simTime > 120) {
        throw new Error('stage 1 bot time ' + s1.simTime + 's is outside 70-120s');
      }
      for (const row of report.balance) {
        if (row.phase !== 'win') throw new Error('stage ' + row.stage + ' bot did not win: ' + JSON.stringify(row));
      }
      console.log('PASS balance');
    }
    console.log('PASS smoke');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('FAIL', err && err.stack ? err.stack : err);
  process.exit(1);
});
