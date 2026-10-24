/**
 * Honest Emberline player.
 * Aims by dragging with real pointer input. Reads the canvas and the HUD.
 * Does not call debug hooks, write game state, or touch debug globals.
 *
 *   node tests/honest-bot.mjs --serve
 *   GAME_URL=https://souljazzfunk.github.io/mob-crowd-game/ node tests/honest-bot.mjs
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const ART = process.env.ARTIFACTS || '/opt/cursor/artifacts';
const serve = process.argv.includes('--serve');
const stage1Only = process.argv.includes('--stage1');
const idleOnly = process.argv.includes('--idle');
const PORT = Number(process.env.PORT || 4195);
const URL = process.env.GAME_URL || ('http://127.0.0.1:' + PORT + '/');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer() {
  const proc = spawn('python3', ['-u', '-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: root,
    stdio: 'ignore',
  });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/');
      if (res.status >= 200 && res.status < 500) return proc;
    } catch (err) {}
    await sleep(40);
  }
  proc.kill('SIGTERM');
  throw new Error('local server did not start');
}

function trackErrors(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

async function installReader(page) {
  await page.evaluate(() => {
    window.__honestRead = function () {
      const view = document.getElementById('view');
      const rect = view.getBoundingClientRect();
      const w = view.clientWidth;
      const h = view.clientHeight;
      if (!window.__honestBuf) window.__honestBuf = document.createElement('canvas');
      const buf = window.__honestBuf;
      if (buf.width !== w || buf.height !== h) {
        buf.width = w;
        buf.height = h;
      }
      const bctx = buf.getContext('2d', { willReadFrequently: true });
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.drawImage(view, 0, 0, w, h);
      const img = bctx.getImageData(0, 0, w, h);
      const d = img.data;
      const stride = 2;
      const gw = Math.ceil(w / stride);
      const gh = Math.ceil(h / stride);
      const grid = new Uint8Array(gw * gh);
      const idOf = { add: 1, sub: 2, mul: 3, core: 4 };
      function kindAt(r, g, b) {
        if (r > 210 && r < 252 && g > 248 && b > 245 && b > r) return 'core';
        if (g > 175 && g > r + 18 && g > b + 35 && r > 120 && r < 230 && b > 80) return 'add';
        if (r > 200 && g < 150 && b > 80 && b < 190 && r > g + 50 && r > b + 40) return 'sub';
        if (r > 200 && g > 160 && g < 220 && b > 60 && b < 130 && g - b > 50 && r - g < 70) return 'mul';
        return '';
      }
      for (let y = 0; y < h; y += stride) {
        for (let x = 0; x < w; x += stride) {
          const i = (y * w + x) * 4;
          const k = kindAt(d[i], d[i + 1], d[i + 2]);
          if (!k) continue;
          const gx = (x / stride) | 0;
          const gy = (y / stride) | 0;
          grid[gy * gw + gx] = idOf[k];
        }
      }
      const seen = new Uint8Array(gw * gh);
      const gates = [];
      const cores = [];
      for (let p = 0; p < grid.length; p++) {
        const id = grid[p];
        if (!id || seen[p]) continue;
        const stack = [p];
        seen[p] = 1;
        let n = 0;
        let minX = gw;
        let maxX = 0;
        let minY = gh;
        let maxY = 0;
        while (stack.length) {
          const q = stack.pop();
          n++;
          const qx = q % gw;
          const qy = (q / gw) | 0;
          if (qx < minX) minX = qx;
          if (qx > maxX) maxX = qx;
          if (qy < minY) minY = qy;
          if (qy > maxY) maxY = qy;
          const ns = [q + 1, q - 1, q + gw, q - gw];
          for (let k = 0; k < 4; k++) {
            const np = ns[k];
            if (np < 0 || np >= grid.length || seen[np] || grid[np] !== id) continue;
            if (k < 2 && ((np % gw) - qx) * (k === 0 ? 1 : -1) !== 1) continue;
            seen[np] = 1;
            stack.push(np);
          }
        }
        const bx = minX * stride;
        const by = minY * stride;
        const bw = (maxX - minX + 1) * stride;
        const bh = (maxY - minY + 1) * stride;
        if (id === 4 && n >= 4 && bw <= 36 && bh <= 36) {
          cores.push({ cy: by + bh * 0.5 });
        } else if (id !== 4 && n >= 40 && bw >= 36 && bw <= 240 && bh >= 16 && bh <= 80 && by > 120) {
          const op = id === 1 ? 'add' : id === 2 ? 'sub' : 'mul';
          gates.push({ op: op, x: bx, y: by, w: bw, h: bh });
        }
      }
      let best = null;
      let bestScore = -1e9;
      for (let i = 0; i < gates.length; i++) {
        const g = gates[i];
        let score = g.op === 'mul' ? 200 + g.y * 0.01 : g.op === 'add' ? 40 : -30;
        if (score > bestScore) {
          bestScore = score;
          best = g;
        }
      }
      let aim = rect.left + w * 0.5;
      if (best) aim = rect.left + best.x + best.w * 0.5;
      let mean = 0;
      let front = 0;
      for (let i = 0; i < cores.length; i++) {
        mean += cores[i].cy;
        if (cores[i].cy > front) front = cores[i].cy;
      }
      if (cores.length) mean /= cores.length;
      return {
        aim: aim,
        phase: document.body.dataset.phase || '',
        stage: document.body.dataset.stage || '',
        name: (document.getElementById('stage-name') || {}).textContent || '',
        crown: (document.getElementById('enemy-hp') || {}).textContent || '',
        hearth: (document.getElementById('player-hp') || {}).textContent || '',
        raiders: cores.length,
        meanY: cores.length ? mean : null,
        frontY: cores.length ? front : null,
        gates: gates.map((g) => g.op + '@' + Math.round(g.x + g.w / 2) + ',' + Math.round(g.y)),
        hook: typeof window.__EMBERLINE__,
      };
    };
  });
}

async function readBoard(page) {
  return page.evaluate(() => window.__honestRead());
}

async function play(page, timeoutMs, onTick) {
  const y = 700;
  const t0 = Date.now();
  let held = false;
  let lastLog = 0;
  while (Date.now() - t0 < timeoutMs) {
    const board = await readBoard(page);
    if (board.phase === 'win' || board.phase === 'lose') {
      if (held) {
        await page.mouse.up();
        held = false;
      }
      return { board: board, seconds: (Date.now() - t0) / 1000, held: false };
    }
    if (!held) {
      await page.mouse.move(board.aim, y);
      await page.mouse.down();
      held = true;
    } else {
      await page.mouse.move(board.aim, y, { steps: 3 });
    }
    if (onTick) await onTick(board, (Date.now() - t0) / 1000);
    if (Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      console.log('PLAY', JSON.stringify({
        t: ((Date.now() - t0) / 1000).toFixed(1),
        crown: board.crown,
        hearth: board.hearth,
        raiders: board.raiders,
        frontY: board.frontY == null ? null : Math.round(board.frontY),
        aim: Math.round(board.aim),
        gates: board.gates,
        name: board.name,
      }));
    }
    await sleep(140);
  }
  if (held) await page.mouse.up();
  const board = await readBoard(page);
  return { board: board, seconds: (Date.now() - t0) / 1000, timeout: true };
}

async function shot(page, name) {
  const file = path.join(ART, name);
  await page.screenshot({ path: file });
  return file;
}

async function main() {
  await mkdir(ART, { recursive: true });
  const server = serve ? await startServer() : null;
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const report = { url: URL, errors: [], stages: [], idle: null, horde: null };
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForSelector('[data-screen="title"]:not([hidden])');
    const hook = await page.evaluate(() => typeof window.__EMBERLINE__);
    if (hook !== 'undefined') throw new Error('debug hook is present');
    await installReader(page);

    if (!idleOnly) {
      await page.locator('[data-action="start"]').click();
      await page.waitForFunction(() => document.body.dataset.phase === 'play');
      const horde = {};
      const first = await play(page, 150000, async (board, t) => {
        if (!horde.t1 && t >= 1) {
          horde.t1 = { t: t, raiders: board.raiders, frontY: board.frontY, meanY: board.meanY, phase: board.phase, shot: await shot(page, 'balance_horde_t1.png') };
          console.log('HORDE_T1', JSON.stringify(horde.t1));
        } else if (horde.t1 && !horde.t5 && t >= 5) {
          horde.t5 = { t: t, raiders: board.raiders, frontY: board.frontY, meanY: board.meanY, phase: board.phase, shot: await shot(page, 'balance_horde_t5.png') };
          console.log('HORDE_T5', JSON.stringify(horde.t5));
        }
      });
      report.horde = horde;
      report.stages.push({ stage: 1, seconds: first.seconds, phase: first.board.phase, crown: first.board.crown, hearth: first.board.hearth, timeout: !!first.timeout });
      console.log('STAGE1', JSON.stringify(report.stages[0]));
      if (first.board.phase === 'win') {
        report.stages[0].shot = await shot(page, 'balance_win_stage1.png');
        if (!stage1Only) {
          await page.locator('[data-screen="win"] [data-action="next"]').click();
          await page.waitForFunction(() => document.body.dataset.phase === 'play' && document.body.dataset.stage === '2');
          await installReader(page);
          const second = await play(page, 200000);
          report.stages.push({ stage: 2, seconds: second.seconds, phase: second.board.phase, name: second.board.name, crown: second.board.crown, hearth: second.board.hearth, timeout: !!second.timeout });
          console.log('STAGE2', JSON.stringify(report.stages[1]));
          if (second.board.phase === 'win') {
            report.stages[1].shot = await shot(page, 'balance_win_stage2.png');
            await page.locator('[data-screen="win"] [data-action="next"]').click();
            await page.waitForFunction(() => document.body.dataset.phase === 'play' && document.body.dataset.stage === '3');
            await installReader(page);
            const third = await play(page, 220000);
            report.stages.push({ stage: 3, seconds: third.seconds, phase: third.board.phase, name: third.board.name, crown: third.board.crown, hearth: third.board.hearth, timeout: !!third.timeout });
            console.log('STAGE3', JSON.stringify(report.stages[2]));
            if (third.board.phase === 'win') report.stages[2].shot = await shot(page, 'balance_win_stage3.png');
          }
        }
      }
    }

    if (!stage1Only) {
      await page.goto(URL, { waitUntil: 'load' });
      await page.waitForSelector('[data-screen="title"]:not([hidden])');
      await installReader(page);
      const tIdle = Date.now();
      await page.locator('[data-action="start"]').click();
      await page.waitForFunction(() => document.body.dataset.phase === 'play');
      let idleBoard = null;
      let idleLog = 0;
      while (Date.now() - tIdle < 90000) {
        idleBoard = await readBoard(page);
        if (idleBoard.phase === 'lose' || idleBoard.phase === 'win') break;
        if (Date.now() - idleLog > 5000) {
          idleLog = Date.now();
          console.log('IDLE', ((Date.now() - tIdle) / 1000).toFixed(1), idleBoard.hearth, idleBoard.crown, idleBoard.phase);
        }
        await sleep(200);
      }
      const idleSeconds = (Date.now() - tIdle) / 1000;
      report.idle = {
        seconds: idleSeconds,
        phase: idleBoard ? idleBoard.phase : '',
        crown: idleBoard ? idleBoard.crown : '',
        hearth: idleBoard ? idleBoard.hearth : '',
      };
      if (idleBoard && idleBoard.phase === 'lose') report.idle.shot = await shot(page, 'balance_idle_loss.png');
      console.log('IDLE_DONE', JSON.stringify(report.idle));
    }

    report.errors = errors.slice();
    console.log('ERRORS', errors.length, JSON.stringify(errors));
    console.log('REPORT', JSON.stringify(report, null, 2));

    const h = report.horde;
    let failed = false;
    if (!idleOnly) {
      if (!h || h.t1.raiders < 50 || h.t5.raiders < 50) failed = true;
      if (!h || !(h.t5.frontY > h.t1.frontY + 30)) failed = true;
      const s1 = report.stages[0];
      if (!s1 || s1.phase !== 'win' || s1.seconds < 60 || s1.seconds > 120) failed = true;
      if (!stage1Only) {
        if (!report.stages[1] || report.stages[1].phase !== 'win') failed = true;
        if (!report.stages[2] || report.stages[2].phase !== 'win') failed = true;
      }
    }
    if (!stage1Only) {
      if (!report.idle || report.idle.phase !== 'lose') failed = true;
    }
    if (errors.length) failed = true;
    if (failed) process.exitCode = 1;
  } finally {
    await browser.close();
    if (server) server.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('FAIL', err && err.stack ? err.stack : err);
  process.exit(1);
});
