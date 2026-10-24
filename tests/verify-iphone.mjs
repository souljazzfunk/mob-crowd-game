/**
 * Live-site check for Emberline on Playwright WebKit, emulating iPhone 13
 * in portrait. No ?debug and no other query. Touch only: touchscreen.tap
 * for buttons, and pointer events with pointerType "touch" for drags
 * (this WebKit build rejects the Touch constructor). Does not use
 * window.__EMBERLINE__.
 *
 *   node tests/verify-iphone.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { webkit, devices } from 'playwright';

const URL = 'https://souljazzfunk.github.io/mob-crowd-game/';
const ART = process.env.ARTIFACTS || '/opt/cursor/artifacts';
const device = devices['iPhone 13'];

const shots = {
  enemies: path.join(ART, 'gameplay_enemies.png'),
  gateBefore: path.join(ART, 'gate_count_before.png'),
  gateAfter: path.join(ART, 'gate_count_after.png'),
  win: path.join(ART, 'win_screen.png'),
  stage2: path.join(ART, 'stage2_after_next.png'),
  winRetry: path.join(ART, 'stage1_after_win_retry.png'),
  lose: path.join(ART, 'lose_screen.png'),
  loseRetry: path.join(ART, 'stage1_after_lose_retry.png'),
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pointer(page, type, x, y) {
  await page.evaluate(({ type, x, y }) => {
    const target = document.getElementById('view');
    const buttons = type === 'pointerup' || type === 'pointercancel' ? 0 : 1;
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      buttons,
      width: 24,
      height: 24,
      pressure: buttons ? 0.5 : 0,
    }));
  }, { type, x, y });
}

async function touchDrag(page, x1, x2, y) {
  await pointer(page, 'pointerdown', x1, y);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await pointer(page, 'pointermove', x1 + (x2 - x1) * (i / steps), y);
    await sleep(16);
  }
}

async function metrics(page) {
  return page.evaluate(() => {
    const vv = window.visualViewport;
    const probe = getComputedStyle(document.getElementById('safe-probe'));
    const hud = document.getElementById('hud');
    const hudCs = getComputedStyle(hud);
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.x, y: r.y, w: r.width, h: r.height,
        top: r.top, right: r.right, bottom: r.bottom, left: r.left,
      };
    };
    return {
      href: location.href,
      search: location.search,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scale: vv ? vv.scale : null,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      vvWidth: vv ? vv.width : null,
      vvHeight: vv ? vv.height : null,
      insets: {
        top: parseFloat(probe.paddingTop) || 0,
        right: parseFloat(probe.paddingRight) || 0,
        bottom: parseFloat(probe.paddingBottom) || 0,
        left: parseFloat(probe.paddingLeft) || 0,
      },
      hudPadding: {
        top: hudCs.paddingTop,
        right: hudCs.paddingRight,
        bottom: hudCs.paddingBottom,
        left: hudCs.paddingLeft,
      },
      hook: typeof window.__EMBERLINE__,
      phase: document.body.dataset.phase || '',
      stage: document.body.dataset.stage || '',
      kicker: document.getElementById('stage-kicker').textContent,
      name: document.getElementById('stage-name').textContent,
      crown: document.getElementById('enemy-hp').textContent,
      hearth: document.getElementById('player-hp').textContent,
      hudHidden: document.getElementById('hud').hidden,
      boxes: {
        hud: box(hud),
        row: box(document.querySelector('.hud-row')),
        kicker: box(document.getElementById('stage-kicker')),
        name: box(document.getElementById('stage-name')),
        hp: box(document.querySelector('.hp-block')),
        crown: box(document.getElementById('enemy-hp')),
        hearth: box(document.getElementById('player-hp')),
      },
      maxTouchPoints: navigator.maxTouchPoints,
    };
  });
}

async function installReader(page) {
  await page.evaluate(() => {
    if (window.__readBoard) return;
    const view = document.getElementById('view');
    const buf = document.createElement('canvas');
    const bctx = buf.getContext('2d', { willReadFrequently: true });
    const tmpl = document.createElement('canvas');
    const tctx = tmpl.getContext('2d', { willReadFrequently: true });
    const cache = new Map();

    function whiteAt(d, cw, x, y) {
      const i = (y * cw + x) * 4;
      return d[i] > 230 && d[i + 1] > 210 && d[i + 2] > 185;
    }

    function kindAt(r, g, b) {
      if (g > 155 && b > 145 && r < 130 && g > r + 40 && Math.abs(g - b) < 55) return 'teal';
      if (g > 175 && g > r + 18 && g > b + 35 && r > 120 && r < 230 && b > 80) return 'green';
      if (r > 200 && g < 150 && b > 80 && b < 190 && r > g + 50 && r > b + 40) return 'red';
      if (r > 220 && g > 110 && g < 185 && b < 100 && r - g > 50) return 'orange';
      if (r > 200 && g > 160 && g < 220 && b > 60 && b < 130 && g - b > 50 && r - g < 70) return 'gold';
      return '';
    }

    function norm(mask, w, h, dw, dh) {
      const out = new Uint8Array(dw * dh);
      for (let y = 0; y < dh; y++) {
        const sy = Math.min(h - 1, (y * h / dh) | 0);
        for (let x = 0; x < dw; x++) {
          const sx = Math.min(w - 1, (x * w / dw) | 0);
          out[y * dw + x] = mask[sy * w + sx];
        }
      }
      return out;
    }

    function renderDigit(ch, fontPx) {
      const key = fontPx + ':' + ch;
      if (cache.has(key)) return cache.get(key);
      const w = Math.ceil(fontPx * 1.15);
      const h = Math.ceil(fontPx * 1.45);
      tmpl.width = w;
      tmpl.height = h;
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.clearRect(0, 0, w, h);
      tctx.font = '700 ' + fontPx + 'px Georgia, "Liberation Serif", "Times New Roman", serif';
      tctx.textAlign = 'left';
      tctx.textBaseline = 'top';
      tctx.lineWidth = 5;
      tctx.strokeStyle = 'rgba(18, 8, 16, 0.72)';
      tctx.strokeText(ch, 6, 6);
      tctx.fillStyle = '#fff4e4';
      tctx.fillText(ch, 6, 6);
      const img = tctx.getImageData(0, 0, w, h).data;
      let minX = w, minY = h, maxX = 0, maxY = 0, any = false;
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const r = img[i * 4], g = img[i * 4 + 1], b = img[i * 4 + 2], a = img[i * 4 + 3];
        if (a > 20 && r > 210 && g > 190 && b > 160) {
          mask[i] = 1;
          any = true;
          const x = i % w;
          const y = (i / w) | 0;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
      let packed = new Uint8Array(24 * 36);
      if (any) {
        const cw = maxX - minX + 1;
        const ch = maxY - minY + 1;
        const cropped = new Uint8Array(cw * ch);
        for (let y = 0; y < ch; y++) {
          for (let x = 0; x < cw; x++) cropped[y * cw + x] = mask[(y + minY) * w + (x + minX)];
        }
        packed = norm(cropped, cw, ch, 24, 36);
      }
      cache.set(key, packed);
      return packed;
    }

    function readCount(d, cw, ch) {
      const yA = Math.floor(ch * 0.7);
      const yB = Math.floor(ch * 0.92);
      const row = new Int16Array(ch);
      for (let y = yA; y < yB; y++) {
        let n = 0;
        for (let x = 0; x < cw; x++) if (whiteAt(d, cw, x, y)) n++;
        row[y] = n;
      }
      const win = 42;
      let bestY = yA;
      let bestSum = -1;
      for (let y = yA; y + win < yB; y++) {
        let s = 0;
        for (let k = 0; k < win; k++) s += row[y + k];
        if (s > bestSum) { bestSum = s; bestY = y; }
      }
      let y0 = bestY;
      let y1 = bestY + win;
      let runA = -1;
      let denseA = y0;
      let denseB = y0;
      let denseBest = 0;
      for (let y = y0; y <= y1; y++) {
        const on = y < y1 && row[y] >= 8;
        if (on && runA < 0) runA = y;
        if (!on && runA >= 0) {
          if (y - runA > denseBest) { denseBest = y - runA; denseA = runA; denseB = y; }
          runA = -1;
        }
      }
      if (denseBest >= 24) { y0 = denseA; y1 = denseB; }
      const cols = new Int16Array(cw);
      for (let y = y0; y < y1; y++) {
        for (let x = 0; x < cw; x++) if (whiteAt(d, cw, x, y)) cols[x]++;
      }
      const segs = [];
      let start = -1;
      for (let x = 0; x <= cw; x++) {
        const on = x < cw && cols[x] > 3;
        if (on && start < 0) start = x;
        if (!on && start >= 0) {
          if (x - start >= 6 && x - start <= 42) segs.push([start, x]);
          start = -1;
        }
      }
      if (!segs.length || bestSum < 80) {
        return { count: null, confident: false, cannonX: null, glyphs: [] };
      }
      let text = '';
      let confident = true;
      let scoreSum = 0;
      const glyphs = [];
      for (let s = 0; s < segs.length; s++) {
        const x0 = segs[s][0];
        const x1 = segs[s][1];
        const w = x1 - x0;
        const h = y1 - y0;
        const mask = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) if (whiteAt(d, cw, x0 + x, y0 + y)) mask[y * w + x] = 1;
        }
        let minY = h, maxY = 0;
        for (let i = 0; i < mask.length; i++) if (mask[i]) {
          const y = (i / w) | 0;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        const th = Math.max(1, maxY - minY + 1);
        if (th < 24) continue;
        const trimmed = new Uint8Array(w * th);
        for (let y = 0; y < th; y++) {
          for (let x = 0; x < w; x++) trimmed[y * w + x] = mask[(y + minY) * w + x];
        }
        const fontPx = Math.max(40, Math.min(72, Math.round(th / 0.7)));
        const glyph = norm(trimmed, w, th, 24, 36);
        let bestCh = '?';
        let best = -1e9;
        let second = -1e9;
        for (let di = 0; di < 10; di++) {
          const ch = String(di);
          const t = renderDigit(ch, fontPx);
          let sc = 0;
          let inter = 0;
          let uni = 0;
          for (let p = 0; p < glyph.length; p++) {
            if (glyph[p] && t[p]) { sc += 2; inter++; }
            else if (glyph[p] || t[p]) sc -= 1;
            if (glyph[p] || t[p]) uni++;
          }
          if (sc > best) { second = best; best = sc; bestCh = ch; }
          else if (sc > second) second = sc;
        }
        const margin = best - second;
        if (best < 320 || margin < 80) confident = false;
        text += bestCh;
        scoreSum += best;
        glyphs.push({ ch: bestCh, score: Math.round(best), margin: Math.round(margin), x: x0, w, h: th });
      }
      const count = /^\d+$/.test(text) ? parseInt(text, 10) : null;
      const cannonX = (segs[0][0] + segs[segs.length - 1][1]) / 2;
      return {
        count: confident ? count : count,
        confident: confident && count !== null,
        cannonX,
        glyphs,
        scoreSum: Math.round(scoreSum),
        band: [y0, y1],
      };
    }

    function mergeGates(list) {
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const g = list[i];
        let hit = null;
        for (let j = 0; j < out.length; j++) {
          const o = out[j];
          if (o.op !== g.op) continue;
          if (Math.abs(o.cy - g.cy) < 26 && Math.abs(o.cx - g.cx) < Math.max(o.w, g.w) * 0.8) {
            hit = o;
            break;
          }
        }
        if (!hit) {
          out.push({ op: g.op, x: g.x, y: g.y, w: g.w, h: g.h, cx: g.cx, cy: g.cy });
        } else {
          const x1 = Math.min(hit.x, g.x);
          const y1 = Math.min(hit.y, g.y);
          const x2 = Math.max(hit.x + hit.w, g.x + g.w);
          const y2 = Math.max(hit.y + hit.h, g.y + g.h);
          hit.x = x1;
          hit.y = y1;
          hit.w = x2 - x1;
          hit.h = y2 - y1;
          hit.cx = (x1 + x2) / 2;
          hit.cy = (y1 + y2) / 2;
        }
      }
      return out;
    }

    window.__readBoard = function () {
      const cw = view.clientWidth;
      const ch = view.clientHeight;
      if (buf.width !== cw || buf.height !== ch) {
        buf.width = cw;
        buf.height = ch;
      }
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.drawImage(view, 0, 0, cw, ch);
      const img = bctx.getImageData(0, 0, cw, ch);
      const d = img.data;
      const stride = 2;
      const gw = Math.ceil(cw / stride);
      const gh = Math.ceil(ch / stride);
      const grid = new Uint8Array(gw * gh);
      const idOf = { green: 1, red: 2, gold: 3, teal: 4, orange: 5 };
      let orange = 0;
      for (let y = 0; y < ch; y += stride) {
        for (let x = 0; x < cw; x += stride) {
          const i = (y * cw + x) * 4;
          const k = kindAt(d[i], d[i + 1], d[i + 2]);
          if (!k) continue;
          if (k === 'orange') orange++;
          const gx = (x / stride) | 0;
          const gy = (y / stride) | 0;
          grid[gy * gw + gx] = idOf[k];
        }
      }
      const seen = new Uint8Array(gw * gh);
      const blobs = [];
      for (let p = 0; p < grid.length; p++) {
        const id = grid[p];
        if (!id || seen[p] || id === 5) continue;
        const stack = [p];
        seen[p] = 1;
        let n = 0, minX = gw, maxX = 0, minY = gh, maxY = 0;
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
        const name = ['green', 'red', 'gold', 'teal'][id - 1];
        if (!name) continue;
        blobs.push({
          name, n,
          x: minX * stride,
          y: minY * stride,
          w: (maxX - minX + 1) * stride,
          h: (maxY - minY + 1) * stride,
        });
      }
      const gates = mergeGates(blobs.filter((b) => {
        if (b.name !== 'green' && b.name !== 'red' && b.name !== 'gold') return false;
        if (b.y < 150 || b.w < 36 || b.w > 200 || b.h < 16 || b.h > 72 || b.n < 30) return false;
        return true;
      }).map((b) => ({
        op: b.name === 'gold' ? 'mul' : b.name === 'green' ? 'add' : 'sub',
        x: b.x, y: b.y, w: b.w, h: b.h,
        cx: b.x + b.w / 2,
        cy: b.y + b.h / 2,
      })));
      const foes = blobs.filter((b) => b.name === 'teal' && b.n >= 8 && b.w <= 36 && b.h <= 36 && b.y > 90).length;
      const count = readCount(d, cw, ch);
      return {
        gates: gates.map((g) => ({ op: g.op, x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h), cx: Math.round(g.cx), cy: Math.round(g.cy) })),
        foes,
        orange,
        count: count.count,
        confident: count.confident,
        cannonX: count.cannonX,
        glyphs: count.glyphs,
        phase: document.body.dataset.phase || '',
        stage: document.body.dataset.stage || '',
        crown: document.getElementById('enemy-hp').textContent,
        hearth: document.getElementById('player-hp').textContent,
        hook: typeof window.__EMBERLINE__,
      };
    };
  });
}

function chooseAim(gates, width, preferAdd) {
  let bestX = width * 0.5;
  let best = -1e9;
  for (let x = 20; x <= width - 20; x += 4) {
    let mul = 0;
    let add = 0;
    let sub = 0;
    let low = 0;
    for (let i = 0; i < gates.length; i++) {
      const g = gates[i];
      if (x < g.x + 6 || x > g.x + g.w - 6) continue;
      if (g.op === 'mul') {
        mul += 1;
        if (g.y > low) low = g.y;
      } else if (g.op === 'add') add += 1;
      else sub += 1;
    }
    const score = mul * (preferAdd ? 40 : 100) + add * (preferAdd ? 80 : 16) - sub * 55 + low * 0.01;
    if (score > best) {
      best = score;
      bestX = x;
    }
  }
  return bestX;
}

async function readBoard(page) {
  return page.evaluate(() => window.__readBoard());
}

async function sampleFps(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const deltas = [];
    let last = 0;
    const t0 = performance.now();
    function step(now) {
      if (last) deltas.push(now - last);
      last = now;
      if (now - t0 < 3000) requestAnimationFrame(step);
      else {
        let sum = 0, min = 1e9, max = 0;
        for (let i = 0; i < deltas.length; i++) {
          const d = deltas[i];
          sum += d;
          if (d < min) min = d;
          if (d > max) max = d;
        }
        const avg = deltas.length ? sum / deltas.length : 0;
        resolve({
          frames: deltas.length,
          seconds: deltas.length ? sum / 1000 : 0,
          avgMs: avg,
          fps: avg > 0 ? 1000 / avg : 0,
          minMs: min,
          maxMs: max,
        });
      }
    }
    requestAnimationFrame(step);
  }));
}

function scrollOk(m) {
  return m.scrollX === 0 && m.scrollY === 0 && m.scale === 1;
}

async function playToWin(page, opts) {
  const width = device.viewport.width;
  const y = Math.round(device.viewport.height * 0.8);
  const deadline = Date.now() + opts.timeoutMs;
  const started = Date.now();
  let held = false;
  let aim = width * 0.5;
  let lastBeat = 0;
  let lastCrown = null;
  let stallSince = Date.now();
  const series = [];
  while (Date.now() < deadline) {
    const board = await readBoard(page);
    if (board.phase === 'win') return { board, series, won: true };
    if (board.phase === 'lose') return { board, series, won: false, lost: true };
    if (opts.preferAdd && Date.now() - started > 8000) opts.preferAdd = false;
    const preferAdd = !!opts.preferAdd;
    if (board.gates.length) aim = chooseAim(board.gates, width, preferAdd);
    if (!held) {
      await pointer(page, 'pointerdown', aim, y);
      held = true;
    } else {
      await pointer(page, 'pointermove', aim, y);
    }
    const now = Date.now();
    series.push({
      t: now,
      count: board.count,
      confident: board.confident,
      foes: board.foes,
      orange: board.orange,
      crown: Number(board.crown),
      hearth: Number(board.hearth),
      cannonX: board.cannonX,
      glyphs: board.glyphs,
    });
    if (opts.onTick) await opts.onTick(board, series);
    if (lastCrown === null || board.crown !== lastCrown) {
      lastCrown = board.crown;
      stallSince = now;
    } else if (now - stallSince > 8000) {
      await pointer(page, 'pointerup', aim, y);
      await pointer(page, 'pointerdown', aim, y);
      stallSince = now;
    }
    if (now - lastBeat > 5000) {
      lastBeat = now;
      console.log('PLAY', JSON.stringify({
        crown: board.crown,
        hearth: board.hearth,
        count: board.count,
        confident: board.confident,
        foes: board.foes,
        aim: Math.round(aim),
        gates: board.gates.map((g) => g.op + '@' + g.cx + ',' + g.cy),
      }));
    }
    await sleep(opts.intervalMs || 160);
  }
  const board = await readBoard(page);
  return { board, series, won: board.phase === 'win', lost: board.phase === 'lose', timeout: true };
}

function findGateJump(series) {
  let prev = null;
  for (let i = 0; i < series.length; i++) {
    const row = series[i];
    if (!row.confident || row.count === null) continue;
    if (prev) {
      const dt = row.t - prev.t;
      const delta = row.count - prev.count;
      const rate = dt > 0 ? delta / (dt / 1000) : 0;
      if (delta >= 8 && dt >= 80 && dt <= 1100 && rate >= 20) {
        return { before: prev.count, after: row.count, windowMs: dt, perSecond: Math.round(rate) };
      }
    }
    if (!prev || row.t - prev.t > 450 || row.count < prev.count) prev = row;
  }
  return null;
}

function findCollision(series) {
  let best = null;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    if (a.foes >= 2 && b.foes < a.foes && a.hearth === b.hearth && b.hearth > 0) {
      const foeDrop = a.foes - b.foes;
      const countDrop = (a.confident && b.confident && a.count !== null && b.count !== null) ? a.count - b.count : null;
      const score = foeDrop * 10 + (countDrop > 0 ? countDrop : 0);
      if (!best || score > best.score) {
        best = { before: a, after: b, foeDrop, countDrop, score };
      }
    }
  }
  return best;
}

async function visibleText(page, selector) {
  return page.locator(selector).innerText();
}

// Playwright WebKit sends touchstart and touchend together, so the synthesized
// click lands on about half of taps. Retry until the game actually advances.
async function tapAction(page, selector, readyExpr) {
  let lastPhase = '';
  for (let attempt = 1; attempt <= 8; attempt++) {
    await page.locator(selector).tap({ timeout: 5000 });
    try {
      await page.waitForFunction(readyExpr, null, { timeout: 700 });
      return attempt;
    } catch (err) {
      lastPhase = await page.evaluate(() => document.body.dataset.phase || '');
    }
  }
  throw new Error('touchscreen.tap did not activate ' + selector + ' (last phase ' + lastPhase + ')');
}

async function main() {
  await mkdir(ART, { recursive: true });
  const errors = [];
  const scrollSamples = [];
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({ ...device });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push({ kind: 'console', text: msg.text() });
  });
  page.on('pageerror', (err) => {
    errors.push({ kind: 'pageerror', text: String(err && err.stack ? err.stack : err) });
  });

  const report = {
    url: URL,
    browser: 'webkit',
    device: 'iPhone 13',
    emulation: 'Playwright WebKit device emulation, not a physical iPhone',
    viewport: device.viewport,
    hasTouch: device.hasTouch,
    isMobile: device.isMobile,
    deviceScaleFactor: device.deviceScaleFactor,
    items: {},
  };

  try {
    if (!device.hasTouch || !device.isMobile) throw new Error('iPhone 13 descriptor is not a touch mobile profile');
    if (!(device.viewport.height > device.viewport.width)) throw new Error('iPhone 13 viewport is not portrait');

    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('[data-screen="title"]:not([hidden])');
    const opened = await metrics(page);
    scrollSamples.push({ when: 'after load', ...pickScroll(opened) });
    if (opened.search) throw new Error('landed with a query string: ' + opened.href);
    if (opened.hook !== 'undefined') throw new Error('debug hook present without ?debug');
    report.opened = {
      href: opened.href,
      hook: opened.hook,
      viewport: page.viewportSize(),
      maxTouchPoints: opened.maxTouchPoints,
      insets: opened.insets,
    };
    console.log('OPEN', JSON.stringify(report.opened));

    const beforeStart = await metrics(page);
    scrollSamples.push({ when: 'before start tap', ...pickScroll(beforeStart) });
    const startAttempts = await tapAction(page, '[data-action="start"]', () => document.body.dataset.phase === 'play' && document.body.dataset.stage === '1');
    console.log('START attempts', startAttempts);
    await installReader(page);
    await sleep(350);

    const playing = await metrics(page);
    scrollSamples.push({ when: 'after start', ...pickScroll(playing) });
    const initial = {
      crown: playing.crown,
      hearth: playing.hearth,
      kicker: playing.kicker,
      name: playing.name,
    };
    report.initial = initial;
    console.log('STAGE1', JSON.stringify(initial));

    const hud = assessHud(playing);
    report.hud = hud;

    const yDrag = Math.round(device.viewport.height * 0.78);
    const xMid = Math.round(device.viewport.width * 0.55);
    const xLeft = Math.round(device.viewport.width * 0.18);
    const xRight = Math.round(device.viewport.width * 0.82);
    let gatePair = null;
    const beforeDragMetrics = await metrics(page);
    let beforeDragBoard = await readBoard(page);
    for (let i = 0; i < 6 && !beforeDragBoard.confident; i++) {
      await sleep(120);
      beforeDragBoard = await readBoard(page);
    }
    if (beforeDragBoard.confident) await page.screenshot({ path: shots.gateBefore });
    scrollSamples.push({ when: 'before first drag', ...pickScroll(beforeDragMetrics) });
    await pointer(page, 'pointerdown', xMid, yDrag);
    const sweepReads = [beforeDragBoard];
    const sweepStart = Date.now();
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      await pointer(page, 'pointermove', xMid + (xLeft - xMid) * (i / steps), yDrag);
      await sleep(40);
      const board = await readBoard(page);
      sweepReads.push(board);
      const dt = Math.max(1, Date.now() - sweepStart);
      const delta = board.count - beforeDragBoard.count;
      if (!gatePair && beforeDragBoard.confident && board.confident && delta >= 8 && delta / (dt / 1000) >= 18) {
        await page.screenshot({ path: shots.gateAfter });
        gatePair = {
          before: beforeDragBoard.count,
          after: board.count,
          beforeGlyphs: beforeDragBoard.glyphs,
          afterGlyphs: board.glyphs,
          beforeCannonX: beforeDragBoard.cannonX,
          afterCannonX: board.cannonX,
          orangeBefore: beforeDragBoard.orange,
          orangeAfter: board.orange,
          crown: board.crown,
          hearth: board.hearth,
          windowMs: dt,
          perSecond: Math.round(delta / (dt / 1000)),
          where: 'opening sweep toward the left gate row',
        };
        console.log('GATE', JSON.stringify(gatePair));
      }
    }
    await sleep(220);
    const afterLeftMetrics = await metrics(page);
    const afterLeftBoard = await readBoard(page);
    scrollSamples.push({ when: 'after drag to left', ...pickScroll(afterLeftMetrics) });
    const leftDt = Math.max(1, Date.now() - sweepStart);
    const leftDelta = afterLeftBoard.count - beforeDragBoard.count;
    if (!gatePair && beforeDragBoard.confident && afterLeftBoard.confident && leftDelta >= 8 && leftDelta / (leftDt / 1000) >= 18) {
      await page.screenshot({ path: shots.gateAfter });
      gatePair = {
        before: beforeDragBoard.count,
        after: afterLeftBoard.count,
        beforeGlyphs: beforeDragBoard.glyphs,
        afterGlyphs: afterLeftBoard.glyphs,
        beforeCannonX: beforeDragBoard.cannonX,
        afterCannonX: afterLeftBoard.cannonX,
        orangeBefore: beforeDragBoard.orange,
        orangeAfter: afterLeftBoard.orange,
        crown: afterLeftBoard.crown,
        hearth: afterLeftBoard.hearth,
        windowMs: leftDt,
        perSecond: Math.round(leftDelta / (leftDt / 1000)),
        where: 'after opening left drag',
      };
      console.log('GATE', JSON.stringify(gatePair));
    }
    for (let i = 1; i <= steps; i++) {
      await pointer(page, 'pointermove', xLeft + (xRight - xLeft) * (i / steps), yDrag);
      await sleep(30);
    }
    await sleep(220);
    const afterRightMetrics = await metrics(page);
    const afterRightBoard = await readBoard(page);
    scrollSamples.push({ when: 'after drag to right', ...pickScroll(afterRightMetrics) });

    const drag = {
      before: { cannonX: beforeDragBoard.cannonX, count: beforeDragBoard.count, confident: beforeDragBoard.confident, glyphs: beforeDragBoard.glyphs },
      left: { cannonX: afterLeftBoard.cannonX, count: afterLeftBoard.count, confident: afterLeftBoard.confident, glyphs: afterLeftBoard.glyphs },
      right: { cannonX: afterRightBoard.cannonX, count: afterRightBoard.count, confident: afterRightBoard.confident, glyphs: afterRightBoard.glyphs },
      sweepCounts: sweepReads.filter((b) => b.count !== null).map((b) => ({ count: b.count, confident: b.confident, cannonX: b.cannonX })),
    };
    report.drag = drag;
    console.log('DRAG', JSON.stringify(drag));

    let enemiesShot = false;
    let fpsInfo = null;
    let anchor = null;
    const firstOpts = {
      timeoutMs: 170000,
      preferAdd: true,
      intervalMs: 170,
    };
    firstOpts.onTick = async (board) => {
        if (!enemiesShot && board.foes >= 2) {
          await page.screenshot({ path: shots.enemies });
          enemiesShot = true;
          console.log('SHOT enemies', shots.enemies, 'foes', board.foes, 'count', board.count);
        }
        if (!gatePair && board.confident && board.count !== null) {
          const now = Date.now();
          const dt = anchor ? now - anchor.t : 0;
          const delta = anchor ? board.count - anchor.count : 0;
          const rate = dt > 0 ? delta / (dt / 1000) : 0;
          // Firing alone is about 12/s. A gate burst is a faster jump.
          if (anchor && delta >= 8 && dt >= 80 && dt <= 1100 && rate >= 20) {
            await page.screenshot({ path: shots.gateAfter });
            gatePair = {
              before: anchor.count,
              after: board.count,
              perSecond: Math.round(rate),
              beforeGlyphs: anchor.glyphs,
              afterGlyphs: board.glyphs,
              beforeCannonX: anchor.cannonX,
              afterCannonX: board.cannonX,
              orangeBefore: anchor.orange,
              orangeAfter: board.orange,
              crown: board.crown,
              hearth: board.hearth,
              windowMs: dt,
              beforeShotCount: anchor.shotCount,
            };
            firstOpts.preferAdd = false;
            console.log('GATE', JSON.stringify(gatePair));
          } else if (!anchor || dt > 450 || board.count < anchor.count) {
            const shotCount = anchor && anchor.shotCount;
            const needShot = !anchor || board.count < anchor.count || shotCount == null || now - (anchor.shotAt || 0) > 1400;
            if (needShot) await page.screenshot({ path: shots.gateBefore });
            anchor = {
              t: now,
              count: board.count,
              glyphs: board.glyphs,
              cannonX: board.cannonX,
              orange: board.orange,
              shotCount: needShot ? board.count : shotCount,
              shotAt: needShot ? now : anchor.shotAt,
            };
          }
        }
        if (!fpsInfo && Number(board.crown) > 0 && Number(board.crown) <= 3000 && board.orange >= 250) {
          const before = { count: board.count, foes: board.foes, crown: board.crown, glyphs: board.glyphs };
          const fps = await sampleFps(page);
          const after = await readBoard(page);
          fpsInfo = { before, fps, afterCount: after.count, afterFoes: after.foes, afterCrown: after.crown, afterConfident: after.confident };
          console.log('FPS', JSON.stringify(fpsInfo));
        }
    };
    const result = await playToWin(page, firstOpts);

    const mPlayEnd = await metrics(page);
    scrollSamples.push({ when: 'end of first play', ...pickScroll(mPlayEnd) });
    report.seriesTail = result.series.slice(-6).map(slim);
    report.winAttempt = { won: result.won, lost: !!result.lost, timeout: !!result.timeout, samples: result.series.length };

    if (!fpsInfo) {
      const snap = await readBoard(page);
      if (snap.phase === 'play') {
        const fps = await sampleFps(page);
        const after = await readBoard(page);
        fpsInfo = { before: { count: snap.count, foes: snap.foes, crown: snap.crown, glyphs: snap.glyphs, late: true }, fps, afterCount: after.count, afterFoes: after.foes, afterCrown: after.crown };
        console.log('FPS late', JSON.stringify(fpsInfo));
      }
    }
    report.fps = fpsInfo;
    report.gate = gatePair;
    report.collision = findCollision(result.series);
    report.gateFromSeries = findGateJump(result.series.map((row) => ({
      t: row.t,
      count: row.count,
      confident: row.confident,
    })));
    if (!enemiesShot) {
      await page.screenshot({ path: shots.enemies });
      report.enemiesShotDuring = 'fallback at end of first play, foes may be absent';
    }

    let winRetry = null;
    let stage2 = null;
    if (result.won) {
      await pointer(page, 'pointerup', device.viewport.width / 2, yDrag);
      await page.waitForSelector('[data-screen="win"]:not([hidden])');
      const winText = await visibleText(page, '[data-screen="win"]');
      await page.screenshot({ path: shots.win });
      const mWin = await metrics(page);
      scrollSamples.push({ when: 'win screen', ...pickScroll(mWin) });
      report.winText = winText;

      const retryAttempts = await tapAction(page, '[data-screen="win"] [data-action="retry"]', () => document.body.dataset.phase === 'play' && document.body.dataset.stage === '1');
      console.log('WIN RETRY attempts', retryAttempts);
      await sleep(200);
      await installReader(page);
      winRetry = await metrics(page);
      await page.screenshot({ path: shots.winRetry });
      scrollSamples.push({ when: 'after win retry', ...pickScroll(winRetry) });
      console.log('WIN RETRY', JSON.stringify({
        phase: winRetry.phase, stage: winRetry.stage, kicker: winRetry.kicker,
        name: winRetry.name, crown: winRetry.crown, hearth: winRetry.hearth,
      }));

      const second = await playToWin(page, { timeoutMs: 170000, preferAdd: false, intervalMs: 180 });
      report.secondWin = { won: second.won, lost: !!second.lost, timeout: !!second.timeout, samples: second.series.length };
      if (second.won) {
        await pointer(page, 'pointerup', device.viewport.width / 2, yDrag);
        await page.waitForSelector('[data-screen="win"]:not([hidden])');
        const nextAttempts = await tapAction(page, '[data-screen="win"] [data-action="next"]', () => document.body.dataset.phase === 'play' && document.body.dataset.stage === '2');
        console.log('NEXT attempts', nextAttempts);
        await sleep(250);
        stage2 = await metrics(page);
        await page.screenshot({ path: shots.stage2 });
        scrollSamples.push({ when: 'stage 2', ...pickScroll(stage2) });
        console.log('STAGE2', JSON.stringify({
          phase: stage2.phase, stage: stage2.stage, kicker: stage2.kicker,
          name: stage2.name, crown: stage2.crown, hearth: stage2.hearth,
        }));
      } else {
        await page.screenshot({ path: shots.stage2 });
      }
    } else {
      await page.screenshot({ path: shots.win });
      console.log('NO WIN', result.board && result.board.phase, result.board && result.board.crown);
    }
    report.winRetry = winRetry && {
      phase: winRetry.phase, stage: winRetry.stage, kicker: winRetry.kicker,
      name: winRetry.name, crown: winRetry.crown, hearth: winRetry.hearth, hudHidden: winRetry.hudHidden,
    };
    report.stage2 = stage2 && {
      phase: stage2.phase, stage: stage2.stage, kicker: stage2.kicker,
      name: stage2.name, crown: stage2.crown, hearth: stage2.hearth, hudHidden: stage2.hudHidden,
    };

    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('[data-screen="title"]:not([hidden])');
    const reopened = await metrics(page);
    scrollSamples.push({ when: 'reload title', ...pickScroll(reopened) });
    if (reopened.search) throw new Error('reload added a query string: ' + reopened.href);
    if (reopened.hook !== 'undefined') throw new Error('debug hook present after reload');
    const loseStartAttempts = await tapAction(page, '[data-action="start"]', () => document.body.dataset.phase === 'play' && document.body.dataset.stage === '1');
    console.log('LOSE START attempts', loseStartAttempts);
    await sleep(400);
    const loseStart = await metrics(page);
    const leftX = Math.round(device.viewport.width * 0.12);
    const rightX = Math.round(device.viewport.width * 0.88);
    const y = Math.round(device.viewport.height * 0.8);
    await pointer(page, 'pointerdown', leftX, y);
    let side = 0;
    let loseBoard = null;
    const loseDeadline = Date.now() + 110000;
    let loseBeat = 0;
    const loseTrace = [{ t: 0, hearth: loseStart.hearth, crown: loseStart.crown }];
    while (Date.now() < loseDeadline) {
      const phase = await page.evaluate(() => document.body.dataset.phase);
      if (phase === 'lose') break;
      side = 1 - side;
      const x = side ? rightX : leftX;
      await pointer(page, 'pointermove', x, y);
      const holdUntil = Date.now() + 1000;
      while (Date.now() < holdUntil) {
        const snap = await page.evaluate(() => ({
          phase: document.body.dataset.phase,
          hearth: document.getElementById('player-hp').textContent,
          crown: document.getElementById('enemy-hp').textContent,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          scale: window.visualViewport ? window.visualViewport.scale : null,
        }));
        if (snap.phase === 'lose') break;
        if (Date.now() - loseBeat > 5000) {
          loseBeat = Date.now();
          loseTrace.push({ t: Date.now(), hearth: snap.hearth, crown: snap.crown });
          scrollSamples.push({ when: 'lose chase', scrollX: snap.scrollX, scrollY: snap.scrollY, scale: snap.scale });
          console.log('LOSE CHASE', snap.hearth, snap.crown);
        }
        await sleep(120);
      }
    }
    await pointer(page, 'pointerup', side ? rightX : leftX, y);
    const losePhase = await page.evaluate(() => document.body.dataset.phase);
    let loseText = '';
    let loseRetry = null;
    if (losePhase === 'lose') {
      await page.waitForSelector('[data-screen="lose"]:not([hidden])');
      loseText = await visibleText(page, '[data-screen="lose"]');
      await page.screenshot({ path: shots.lose });
      const mLose = await metrics(page);
      scrollSamples.push({ when: 'lose screen', ...pickScroll(mLose) });
      loseBoard = { phase: mLose.phase, text: loseText };
      const loseRetryAttempts = await tapAction(page, '[data-screen="lose"] [data-action="retry"]', () => document.body.dataset.phase === 'play' && document.body.dataset.stage === '1');
      console.log('LOSE RETRY attempts', loseRetryAttempts);
      await sleep(250);
      loseRetry = await metrics(page);
      await page.screenshot({ path: shots.loseRetry });
      scrollSamples.push({ when: 'after lose retry', ...pickScroll(loseRetry) });
      console.log('LOSE RETRY', JSON.stringify({
        phase: loseRetry.phase, kicker: loseRetry.kicker, name: loseRetry.name,
        crown: loseRetry.crown, hearth: loseRetry.hearth,
      }));
    } else {
      await page.screenshot({ path: shots.lose });
      console.log('NO LOSE', losePhase, JSON.stringify(loseTrace));
    }
    report.lose = {
      trace: loseTrace,
      text: loseText,
      reached: losePhase === 'lose',
      retry: loseRetry && {
        phase: loseRetry.phase, stage: loseRetry.stage, kicker: loseRetry.kicker,
        name: loseRetry.name, crown: loseRetry.crown, hearth: loseRetry.hearth,
      },
    };

    const finalMetrics = await metrics(page);
    scrollSamples.push({ when: 'final', ...pickScroll(finalMetrics) });
    report.scrollSamples = scrollSamples;
    report.errors = errors;

    const movedLeft = num(beforeDragBoard.cannonX) !== null && num(afterLeftBoard.cannonX) !== null
      && afterLeftBoard.cannonX < beforeDragBoard.cannonX - 30;
    const movedRight = num(afterLeftBoard.cannonX) !== null && num(afterRightBoard.cannonX) !== null
      && afterRightBoard.cannonX > afterLeftBoard.cannonX + 30;
    const scrollPass = scrollSamples.every((s) => s.scrollX === 0 && s.scrollY === 0 && s.scale === 1);
    report.items['1'] = {
      pass: movedLeft && movedRight && scrollPass,
      detail: {
        cannonX: { before: beforeDragBoard.cannonX, left: afterLeftBoard.cannonX, right: afterRightBoard.cannonX },
        movedLeft, movedRight, scrollPass,
        samples: scrollSamples,
      },
    };

    const gateEvidence = gatePair || (report.gateFromSeries && {
      before: report.gateFromSeries.before.count,
      after: report.gateFromSeries.after.count,
      fromSeriesOnly: true,
    });
    report.items['2'] = {
      pass: !!(gateEvidence && gateEvidence.after > gateEvidence.before),
      detail: gatePair || gateEvidence || { note: 'no confident count jump of at least 8' },
    };

    const collision = report.collision;
    report.items['3'] = {
      pass: !!(collision && collision.foeDrop > 0 && enemiesShot),
      detail: {
        collision,
        enemiesScreenshot: shots.enemies,
        enemiesCapturedWhenVisible: enemiesShot && !report.enemiesShotDuring,
      },
    };

    const winOk = result.won && /crown cracked/i.test(report.winText || '') && /stage 1 clear/i.test(report.winText || '') && /kindling yard/i.test(report.winText || '');
    const retryOk = !!(winRetry && winRetry.phase === 'play' && winRetry.stage === '1' && winRetry.name === initial.name && winRetry.crown === initial.crown && winRetry.hearth === initial.hearth);
    const nextOk = !!(stage2 && stage2.phase === 'play' && stage2.stage === '2' && stage2.name === 'Cinder Span' && stage2.crown !== initial.crown);
    report.items['4'] = {
      pass: winOk && retryOk && nextOk,
      detail: { winOk, retryOk, nextOk, winText: report.winText, winRetry: report.winRetry, stage2: report.stage2 },
    };

    const loseOk = report.lose.reached && /line broken/i.test(loseText) && /hearth lost/i.test(loseText);
    const loseRetryOk = !!(report.lose.retry && report.lose.retry.phase === 'play' && report.lose.retry.stage === '1' && report.lose.retry.name === initial.name && report.lose.retry.crown === initial.crown && report.lose.retry.hearth === initial.hearth);
    report.items['5'] = {
      pass: loseOk && loseRetryOk,
      detail: { loseOk, loseRetryOk, lose: report.lose },
    };

    report.items['6'] = {
      pass: hud.pass,
      detail: hud,
    };

    report.items['7'] = {
      pass: errors.length === 0,
      detail: { errors },
    };

    const fpsOk = !!(fpsInfo && fpsInfo.fps && fpsInfo.fps.frames >= 30 && fpsInfo.fps.seconds >= 2.5);
    report.items['8'] = {
      pass: fpsOk,
      detail: fpsInfo,
    };

    console.log('--- ITEM RESULTS ---');
    let all = true;
    for (let n = 1; n <= 8; n++) {
      const item = report.items[String(n)];
      const label = item.pass ? 'PASS' : 'FAIL';
      if (!item.pass) all = false;
      console.log('ITEM ' + n + ' ' + label);
      console.log(JSON.stringify(item.detail));
    }
    console.log(all ? 'PASS verify-iphone' : 'FAIL verify-iphone');
    console.log('ARTIFACTS ' + JSON.stringify(shots));
    if (!all) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

function pickScroll(m) {
  return { scrollX: m.scrollX, scrollY: m.scrollY, scale: m.scale };
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function slim(row) {
  return { count: row.count, confident: row.confident, foes: row.foes, crown: row.crown, hearth: row.hearth };
}

function assessHud(m) {
  const inset = m.insets;
  const vw = m.innerWidth;
  const vh = m.innerHeight;
  const names = ['row', 'kicker', 'name', 'hp', 'crown', 'hearth'];
  const checks = [];
  let pass = true;
  for (let i = 0; i < names.length; i++) {
    const b = m.boxes[names[i]];
    const inside = !!b && b.w > 0 && b.h > 0
      && b.left >= inset.left - 0.5
      && b.top >= inset.top - 0.5
      && b.right <= vw - inset.right + 0.5
      && b.bottom <= vh - inset.bottom + 0.5;
    if (!inside) pass = false;
    checks.push({ name: names[i], box: b, inside });
  }
  const zeroInsets = inset.top === 0 && inset.right === 0 && inset.bottom === 0 && inset.left === 0;
  return {
    pass,
    zeroInsets,
    insets: inset,
    hudPadding: m.hudPadding,
    viewport: { w: vw, h: vh },
    boxes: checks,
    note: zeroInsets
      ? 'Playwright WebKit reported env(safe-area-inset-*) as 0 via #safe-probe. The safe area is the full viewport, so this check only shows the HUD content sits inside that viewport. It does not show clearance under a real iPhone notch or home indicator.'
      : 'Non-zero safe-area insets were reported; HUD content was compared with them.',
  };
}

main().catch((err) => {
  console.error('FAIL', err && err.stack ? err.stack : err);
  process.exit(1);
});
