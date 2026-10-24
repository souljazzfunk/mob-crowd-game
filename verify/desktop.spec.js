import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const LIVE = 'https://souljazzfunk.github.io/mob-crowd-game/';
const URL = process.env.VERIFY_URL || LIVE;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.VERIFY_SHOTS || path.join(DIR, 'surge-screenshots');
const ONLY = process.env.VERIFY_ONLY || '';
const STAGE_V = { 1: 0.46, 2: 0.48, 3: 0.5 };

function readScreen() {
  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  const vv = window.visualViewport;
  const cssW = vv ? vv.width : window.innerWidth;
  const cssH = vv ? vv.height : window.innerHeight;
  const cs = getComputedStyle(document.getElementById('safe-probe'));
  const safe = {
    t: parseFloat(cs.paddingTop) || 0,
    r: parseFloat(cs.paddingRight) || 0,
    b: parseFloat(cs.paddingBottom) || 0,
    l: parseFloat(cs.paddingLeft) || 0,
  };
  const top = safe.t + 64;
  const bottom = safe.b + 16;
  const left = safe.l + 10;
  const right = safe.r + 10;
  let availW = cssW - left - right;
  let availH = cssH - top - bottom;
  if (availW < 80) availW = 80;
  if (availH < 160) availH = 160;
  const maxW = availH * (9 / 16);
  const lw = availW < maxW ? availW : maxW;
  const lane = {
    x: left + (availW - lw) * 0.5,
    y: top,
    w: lw,
    h: availH,
  };
  const dpr = canvas.width / cssW || 1;
  const fontSize = Math.max(34, Math.min(72, lane.w * 0.16));
  return { canvas, ctx, cssW, cssH, lane, dpr, fontSize };
}

function isCore(r, g, b) {
  return r >= 220 && r <= 252 && g >= 250 && b >= 248 && b > r && g >= r;
}

function isCyan(r, g, b) {
  return r <= 40 && g >= 220 && b >= 190 && g - r >= 160;
}

function isFriend(r, g, b) {
  return r >= 242 && g >= 136 && g <= 170 && b >= 42 && b <= 82 && r - g >= 80;
}

function isAdd(r, g, b) {
  return r >= 155 && r <= 210 && g >= 200 && g <= 248 && b >= 110 && b <= 170 && g - r >= 20 && g - b >= 45;
}

function isMul(r, g, b) {
  return r >= 215 && g >= 172 && g <= 220 && b >= 60 && b <= 120 && r - b >= 100 && g - b >= 60 && r - g < 80;
}

function isSub(r, g, b) {
  return r >= 215 && g >= 85 && g <= 145 && b >= 100 && b <= 160 && r - g >= 85;
}

function bright(r, g, b, a) {
  return a > 140 && r > 220 && g > 190 && b > 165 && r >= b - 5;
}

function ocrTemplates(fontSize) {
  const key = '__verifyOcrCache';
  const box = window[key] || (window[key] = { fontSize: 0, map: null });
  if (box.fontSize === fontSize && box.map) return box.map;
  const map = new Map();
  box.fontSize = fontSize;
  box.map = map;
  return map;
}

function renderCount(text, fontSize) {
  const map = ocrTemplates(fontSize);
  if (map.has(text)) return map.get(text);
  const font = '700 ' + fontSize + 'px Georgia, "Liberation Serif", "Times New Roman", serif';
  const c = document.createElement('canvas');
  const w = Math.ceil(fontSize * (0.7 * String(text).length + 0.6));
  const h = Math.ceil(fontSize * 1.35);
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(18, 8, 16, 0.72)';
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = '#fff4e4';
  ctx.fillText(text, w / 2, h / 2);
  const img = ctx.getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let n = 0;
  const raw = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!bright(img[i], img[i + 1], img[i + 2], img[i + 3])) continue;
      raw[y * w + x] = 1;
      n++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!n) {
    const empty = { w: 1, h: 1, mask: new Uint8Array(1), n: 0, text: String(text) };
    map.set(text, empty);
    return empty;
  }
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const mask = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) mask[y * tw + x] = raw[(y + minY) * w + (x + minX)];
  }
  const tpl = { w: tw, h: th, mask, n, text: String(text) };
  map.set(text, tpl);
  return tpl;
}

function scoreTemplate(roi, roiW, roiH, tpl) {
  let best = -1e9;
  const cx = (roiW - tpl.w) / 2;
  const cy = (roiH - tpl.h) / 2;
  for (let dy = -6; dy <= 6; dy += 3) {
    for (let dx = -12; dx <= 12; dx += 3) {
      const ox = Math.round(cx + dx);
      const oy = Math.round(cy + dy);
      let hit = 0;
      let miss = 0;
      let extra = 0;
      for (let y = 0; y < tpl.h; y++) {
        const ry = y + oy;
        const rowOk = ry >= 0 && ry < roiH;
        for (let x = 0; x < tpl.w; x++) {
          const on = tpl.mask[y * tpl.w + x];
          if (!on) {
            if (!rowOk) continue;
            const rx = x + ox;
            if (rx >= 0 && rx < roiW && roi[ry * roiW + rx]) extra++;
            continue;
          }
          if (!rowOk) {
            miss++;
            continue;
          }
          const rx = x + ox;
          if (rx >= 0 && rx < roiW && roi[ry * roiW + rx]) hit++;
          else miss++;
        }
      }
      let outside = 0;
      const y1 = Math.max(0, oy);
      const y2 = Math.min(roiH, oy + tpl.h);
      const left = ox - 2;
      const right = ox + tpl.w + 2;
      for (let y = y1; y < y2; y++) {
        const row = y * roiW;
        for (let x = 0; x < roiW; x++) {
          if (!roi[row + x]) continue;
          if (x < left || x >= right) outside++;
        }
      }
      const score = tpl.n ? (hit - miss - 0.25 * extra - 0.55 * outside) / tpl.n : -1;
      if (score > best) best = score;
    }
  }
  return best;
}

function readCount(ctx, canvas, lane, dpr, fontSize, aimX, lastCount, wide) {
  const countY = (lane.y + lane.h - 36 - 58) * dpr;
  const seekHalf = Math.max(12, Math.round(fontSize * dpr * 0.32));
  const seekX = Math.max(0, Math.floor((lane.x + 8) * dpr));
  const seekW = Math.max(8, Math.min(canvas.width - seekX, Math.floor((lane.w - 16) * dpr)));
  let seekY = Math.round(countY - seekHalf);
  if (seekY < 0) seekY = 0;
  const seekH = Math.min(seekHalf * 2, canvas.height - seekY);
  let cx = aimX * dpr;
  if (seekW > 8 && seekH > 8) {
    const seek = ctx.getImageData(seekX, seekY, seekW, seekH);
    let n = 0;
    let minX = seekW;
    let maxX = 0;
    for (let i = 0; i < seekW * seekH; i++) {
      const o = i * 4;
      if (!bright(seek.data[o], seek.data[o + 1], seek.data[o + 2], seek.data[o + 3])) continue;
      const x = i % seekW;
      n++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    if (n >= 12) cx = seekX + (minX + maxX) / 2;
  }
  const cy = countY;
  const rw = Math.max(40, Math.round(fontSize * dpr * 2.6));
  const rh = Math.max(24, Math.round(fontSize * dpr * 0.9));
  let sx = Math.round(cx - rw / 2);
  let sy = Math.round(cy - rh / 2);
  if (sx < 0) sx = 0;
  if (sy < 0) sy = 0;
  if (sx + rw > canvas.width) sx = Math.max(0, canvas.width - rw);
  if (sy + rh > canvas.height) sy = Math.max(0, canvas.height - rh);
  const sw = Math.min(rw, canvas.width - sx);
  const sh = Math.min(rh, canvas.height - sy);
  if (sw < 8 || sh < 8) return { count: null, score: 0, alts: [] };
  const img = ctx.getImageData(sx, sy, sw, sh);
  const roi = new Uint8Array(sw * sh);
  let brightN = 0;
  for (let i = 0; i < sw * sh; i++) {
    const o = i * 4;
    if (bright(img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3])) {
      roi[i] = 1;
      brightN++;
    }
  }
  if (brightN < 12) return { count: null, score: 0, alts: [], brightN };
  let from = 0;
  let to = 48;
  if (lastCount != null && lastCount >= 0) {
    from = Math.max(0, lastCount - 6);
    to = Math.min(560, lastCount + (wide ? 60 : 16));
  }
  let best = null;
  const alts = [];
  for (let n = from; n <= to; n++) {
    const tpl = renderCount(String(n), fontSize);
    if (!tpl.n) continue;
    const score = scoreTemplate(roi, sw, sh, tpl);
    if (!best || score > best.score) best = { count: n, score };
    if (alts.length < 3) alts.push({ count: n, score });
    else if (score > alts[2].score) {
      alts[2] = { count: n, score };
      alts.sort((a, b) => b.score - a.score);
    }
  }
  alts.sort((a, b) => b.score - a.score);
  return {
    count: best && best.score >= 0.42 ? best.count : null,
    score: best ? best.score : 0,
    alts: alts.slice(0, 3).map((a) => ({ count: a.count, score: Math.round(a.score * 1000) / 1000 })),
    brightN,
  };
}

function floodBlobs(mask, w, h, minSize, maxSize, maxSide) {
  const seen = new Uint8Array(w * h);
  const out = [];
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = y * w + x;
      if (!mask[s] || seen[s]) continue;
      let head = 0;
      let tail = 0;
      let n = 0;
      let sx = 0;
      let sy = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      seen[s] = 1;
      qx[tail] = x;
      qy[tail] = y;
      tail++;
      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
        n++;
        sx += cx;
        sy += cy;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        if (cx > 0) {
          const ni = cy * w + cx - 1;
          if (mask[ni] && !seen[ni]) {
            seen[ni] = 1;
            qx[tail] = cx - 1;
            qy[tail] = cy;
            tail++;
          }
        }
        if (cx + 1 < w) {
          const ni = cy * w + cx + 1;
          if (mask[ni] && !seen[ni]) {
            seen[ni] = 1;
            qx[tail] = cx + 1;
            qy[tail] = cy;
            tail++;
          }
        }
        if (cy > 0) {
          const ni = (cy - 1) * w + cx;
          if (mask[ni] && !seen[ni]) {
            seen[ni] = 1;
            qx[tail] = cx;
            qy[tail] = cy - 1;
            tail++;
          }
        }
        if (cy + 1 < h) {
          const ni = (cy + 1) * w + cx;
          if (mask[ni] && !seen[ni]) {
            seen[ni] = 1;
            qx[tail] = cx;
            qy[tail] = cy + 1;
            tail++;
          }
        }
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (n < minSize || n > maxSize || bw > maxSide || bh > maxSide) continue;
      out.push({ cx: sx / n, cy: sy / n, n });
    }
  }
  return out;
}

function paintLane(screen) {
  const { canvas, ctx, lane, dpr } = screen;
  const x0 = Math.max(0, Math.floor(lane.x * dpr));
  const y0 = Math.max(0, Math.floor(lane.y * dpr));
  const lw = Math.max(1, Math.min(canvas.width - x0, Math.floor(lane.w * dpr)));
  const lh = Math.max(1, Math.min(canvas.height - y0, Math.floor(lane.h * dpr)));
  const image = ctx.getImageData(x0, y0, lw, lh);
  return { image, lw, lh, x0, y0 };
}

function sampleHorde() {
  const t0 = performance.now();
  const screen = readScreen();
  const { lane, dpr } = screen;
  const painted = paintLane(screen);
  const { image, lw, lh } = painted;
  const data = image.data;
  const gw = Math.floor(lw / 2);
  const gh = Math.floor(lh / 2);
  const core = new Uint8Array(gw * gh);
  let cyanPx = 0;
  let frontEdge = -1;
  const yMin = Math.floor(lh * 0.11);
  const yMax = Math.floor(lh - 78 * dpr);
  const odd = [];
  for (let y = 0; y < lh; y += 2) {
    for (let x = 0; x < lw; x += 2) {
      const o = (y * lw + x) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      if (isCyan(r, g, b)) {
        cyanPx++;
        if (y >= yMin && y <= yMax && y > frontEdge) frontEdge = y;
      } else if (odd.length < 6 && g > 190 && b > 170 && r < 90) {
        odd.push([r, g, b]);
      }
      if (y < yMin || y > yMax) continue;
      if (!isCore(r, g, b)) continue;
      const mx = x >> 1;
      const my = y >> 1;
      if (mx < gw && my < gh) core[my * gw + mx] = 1;
    }
  }
  const blobs = floodBlobs(core, gw, gh, 3, 90, 16);
  let frontY = null;
  let meetE = 0;
  const meet0 = lh * 0.56;
  for (let i = 0; i < blobs.length; i++) {
    const cssY = lane.y + (blobs[i].cy * 2) / dpr;
    if (frontY == null || cssY > frontY) frontY = cssY;
    if (blobs[i].cy * 2 >= meet0 && blobs[i].cy * 2 <= yMax) meetE++;
  }
  return {
    phase: document.body.dataset.phase || '',
    stage: document.body.dataset.stage || '',
    name: document.getElementById('stage-name').textContent,
    crown: document.getElementById('enemy-hp').textContent,
    hearth: document.getElementById('player-hp').textContent,
    hook: typeof window.__EMBERLINE__,
    enemyCount: blobs.length,
    frontY,
    frontEdgeY: frontEdge < 0 ? null : lane.y + frontEdge / dpr,
    cyanPx,
    meetE,
    odd,
    lane,
    dpr,
    ms: Math.round(performance.now() - t0),
  };
}

function observe(arg) {
  const t0 = performance.now();
  const aimX = arg && arg.aimX ? arg.aimX : 640;
  const lastCount = arg && typeof arg.lastCount === 'number' ? arg.lastCount : null;
  const wide = !!(arg && arg.wide);
  const screen = readScreen();
  const { canvas, ctx, lane, dpr, fontSize } = screen;
  const painted = paintLane(screen);
  const { image, lw, lh } = painted;
  const data = image.data;
  const cell = 8;
  const cols = Math.ceil(lw / cell);
  const rows = Math.ceil(lh / cell);
  const mulC = new Uint16Array(cols * rows);
  const addC = new Uint16Array(cols * rows);
  const subC = new Uint16Array(cols * rows);
  const gw = Math.floor(lw / 2);
  const gh = Math.floor(lh / 2);
  const friendMask = new Uint8Array(gw * gh);
  const coreMask = new Uint8Array(gw * gh);
  let friendPx = 0;
  let cyanPx = 0;
  let mulPx = 0;
  let addPx = 0;
  let subPx = 0;
  let meetFpx = 0;
  const yMin = Math.floor(lh * 0.11);
  const yMax = Math.floor(lh - 78 * dpr);
  const meet0 = lh * 0.56;
  for (let y = 0; y < lh; y += 2) {
    const inMeet = y >= meet0 && y <= yMax;
    for (let x = 0; x < lw; x += 2) {
      const o = (y * lw + x) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      if (isFriend(r, g, b)) {
        friendPx++;
        if (inMeet) meetFpx++;
        const mx = x >> 1;
        const my = y >> 1;
        if (mx < gw && my < gh) friendMask[my * gw + mx] = 1;
      } else if (isCyan(r, g, b)) cyanPx++;
      else if (isMul(r, g, b)) {
        mulPx++;
        mulC[(Math.floor(y / cell)) * cols + Math.floor(x / cell)]++;
      } else if (isAdd(r, g, b)) {
        addPx++;
        addC[(Math.floor(y / cell)) * cols + Math.floor(x / cell)]++;
      } else if (isSub(r, g, b)) {
        subPx++;
        subC[(Math.floor(y / cell)) * cols + Math.floor(x / cell)]++;
      }
      if (y < yMin || y > yMax) continue;
      if (!isCore(r, g, b)) continue;
      const mx = x >> 1;
      const my = y >> 1;
      if (mx < gw && my < gh) coreMask[my * gw + mx] = 1;
    }
  }
  const friends = floodBlobs(friendMask, gw, gh, 3, 80, 18);
  const cores = floodBlobs(coreMask, gw, gh, 3, 90, 16);
  let meetF = 0;
  let meetE = 0;
  let frontY = null;
  for (let i = 0; i < friends.length; i++) {
    const py = friends[i].cy * 2;
    if (py >= meet0 && py <= yMax) meetF++;
  }
  for (let i = 0; i < cores.length; i++) {
    const py = cores[i].cy * 2;
    const cssY = lane.y + py / dpr;
    if (frontY == null || cssY > frontY) frontY = cssY;
    if (py >= meet0 && py <= yMax) meetE++;
  }

  function rectsFor(cells, kind) {
    const seen = new Uint8Array(cols * rows);
    const out = [];
    const qx = new Int32Array(cols * rows);
    const qy = new Int32Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const s = y * cols + x;
        if (seen[s] || cells[s] < 6) continue;
        let head = 0;
        let tail = 0;
        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;
        let hits = 0;
        seen[s] = 1;
        qx[tail] = x;
        qy[tail] = y;
        tail++;
        while (head < tail) {
          const cx = qx[head];
          const cy = qy[head];
          head++;
          hits += cells[cy * cols + cx];
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;
          const nbrs = [
            [cx - 1, cy],
            [cx + 1, cy],
            [cx, cy - 1],
            [cx, cy + 1],
          ];
          for (let i = 0; i < 4; i++) {
            const nx = nbrs[i][0];
            const ny = nbrs[i][1];
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const ni = ny * cols + nx;
            if (seen[ni] || cells[ni] < 6) continue;
            seen[ni] = 1;
            qx[tail] = nx;
            qy[tail] = ny;
            tail++;
          }
        }
        const rw = (maxX - minX + 1) * cell;
        const rh = (maxY - minY + 1) * cell;
        if (rw < 40 || rh < 18 || hits < 30) continue;
        const gx = lane.x + (minX * cell) / dpr;
        const gy = lane.y + (minY * cell) / dpr;
        out.push({
          kind,
          x: gx,
          y: gy,
          w: rw / dpr,
          h: rh / dpr,
          cx: gx + rw / dpr / 2,
          cy: gy + rh / dpr / 2,
        });
      }
    }
    return out;
  }

  const gates = rectsFor(mulC, 'mul').concat(rectsFor(addC, 'add'), rectsFor(subC, 'sub'));
  const ocr = readCount(ctx, canvas, lane, dpr, fontSize, aimX, lastCount, wide);
  return {
    phase: document.body.dataset.phase || '',
    stage: Number(document.body.dataset.stage || '0'),
    kicker: document.getElementById('stage-kicker').textContent,
    stageName: document.getElementById('stage-name').textContent,
    crown: document.getElementById('enemy-hp').textContent,
    hearth: document.getElementById('player-hp').textContent,
    hook: typeof window.__EMBERLINE__,
    lane,
    aimY: lane.y + lane.h - 70,
    fontSize,
    friendPx,
    cyanPx,
    mulPx,
    addPx,
    subPx,
    meetF,
    meetE,
    meetFpx,
    enemyCount: cores.length,
    frontY,
    count: ocr.count,
    countScore: Math.round(ocr.score * 1000) / 1000,
    countAlts: ocr.alts,
    gates,
    ms: Math.round(performance.now() - t0),
  };
}

const BROWSER = new Function(
  'arg',
  [
    readScreen,
    isCore,
    isCyan,
    isFriend,
    isAdd,
    isMul,
    isSub,
    bright,
    ocrTemplates,
    renderCount,
    scoreTemplate,
    readCount,
    floodBlobs,
    paintLane,
    sampleHorde,
    observe,
  ].map((fn) => fn.toString()).join('\n') +
    '\n if (arg && arg.op === "horde") return sampleHorde();\n return observe(arg || {});'
);

function readHud() {
  const lose = document.querySelector('[data-screen="lose"]');
  const win = document.querySelector('[data-screen="win"]');
  const plain = (root, sel) => {
    const el = root ? root.querySelector(sel) : null;
    return el ? el.textContent : '';
  };
  return {
    phase: document.body.dataset.phase || '',
    stage: document.body.dataset.stage || '',
    kicker: document.getElementById('stage-kicker') ? document.getElementById('stage-kicker').textContent : '',
    name: document.getElementById('stage-name') ? document.getElementById('stage-name').textContent : '',
    crown: document.getElementById('enemy-hp') ? document.getElementById('enemy-hp').textContent : '',
    hearth: document.getElementById('player-hp') ? document.getElementById('player-hp').textContent : '',
    winKicker: document.getElementById('win-kicker') ? document.getElementById('win-kicker').textContent : '',
    winCopy: document.getElementById('win-copy') ? document.getElementById('win-copy').textContent : '',
    winH2: plain(win, 'h2'),
    loseH2: plain(lose, 'h2'),
    loseCopy: plain(lose, 'p:not(.kicker)'),
    hook: typeof window.__EMBERLINE__,
    href: location.href,
    build: (document.querySelector('meta[name="emberline-build"]') || {}).content || '',
  };
}

function installFps() {
  const box = { stamps: [], active: true, winStart: 0 };
  window.__fpsRead = box;
  const loop = (t) => {
    if (!box.active) return;
    box.stamps.push(t);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return true;
}

function armFps() {
  window.__fpsRead.winStart = performance.now();
  return window.__fpsRead.winStart;
}

function takeFps() {
  const box = window.__fpsRead;
  const t0 = box.winStart;
  const stamps = [];
  const all = box.stamps;
  for (let i = 0; i < all.length; i++) if (all[i] > t0 + 40) stamps.push(all[i]);
  box.active = false;
  return { stamps, t0 };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let o = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const parts = [];
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o);
    o += 4;
    const type = buf.toString('ascii', o, o + 4);
    o += 4;
    const data = buf.subarray(o, o + len);
    o += len + 4;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') parts.push(data);
    else if (type === 'IEND') break;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bpp || bitDepth !== 8) throw new Error('png color ' + colorType + '/' + bitDepth);
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * bpp;
  const rows = Buffer.alloc(height * stride);
  let i = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[i++];
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[i++];
      const left = x >= bpp ? rows[row + x - bpp] : 0;
      const up = y > 0 ? rows[prev + x] : 0;
      const ul = x >= bpp && y > 0 ? rows[prev + x - bpp] : 0;
      let value = v;
      if (filter === 1) value = (v + left) & 255;
      else if (filter === 2) value = (v + up) & 255;
      else if (filter === 3) value = (v + ((left + up) >> 1)) & 255;
      else if (filter === 4) value = (v + paeth(left, up, ul)) & 255;
      else if (filter !== 0) throw new Error('png filter ' + filter);
      rows[row + x] = value;
    }
  }
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    if (bpp === 4) {
      out[p * 4] = rows[p * 4];
      out[p * 4 + 1] = rows[p * 4 + 1];
      out[p * 4 + 2] = rows[p * 4 + 2];
      out[p * 4 + 3] = rows[p * 4 + 3];
    } else {
      out[p * 4] = rows[p * 3];
      out[p * 4 + 1] = rows[p * 3 + 1];
      out[p * 4 + 2] = rows[p * 3 + 2];
      out[p * 4 + 3] = 255;
    }
  }
  return { width, height, data: out };
}

function analyzePng(file, lane) {
  try {
    return analyzePngUnsafe(file, lane);
  } catch (err) {
    return { width: 0, height: 0, enemyCount: 0, frontY: null, frontEdgeY: null, cyanPx: 0, error: String(err) };
  }
}

function analyzePngUnsafe(file, lane) {
  const decoded = decodePng(fs.readFileSync(file));
  const { width, height, data } = decoded;
  const x0 = Math.max(0, Math.floor(lane.x));
  const y0 = Math.max(0, Math.floor(lane.y));
  const x1 = Math.min(width, Math.ceil(lane.x + lane.w));
  const y1 = Math.min(height, Math.ceil(lane.y + lane.h));
  const lw = x1 - x0;
  const lh = y1 - y0;
  const gw = Math.floor(lw / 2);
  const gh = Math.floor(lh / 2);
  const core = new Uint8Array(gw * gh);
  let cyanPx = 0;
  let frontEdge = -1;
  const yMin = Math.floor(lh * 0.11);
  const yMax = lh - 78;
  for (let y = 0; y < lh; y += 2) {
    for (let x = 0; x < lw; x += 2) {
      const sx = x0 + x;
      const sy = y0 + y;
      const o = (sy * width + sx) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      if (isCyan(r, g, b)) {
        cyanPx++;
        if (y >= yMin && y <= yMax && y > frontEdge) frontEdge = y;
      }
      if (y < yMin || y > yMax || !isCore(r, g, b)) continue;
      const mx = x >> 1;
      const my = y >> 1;
      if (mx < gw && my < gh) core[my * gw + mx] = 1;
    }
  }
  const blobs = floodBlobs(core, gw, gh, 3, 90, 16);
  let frontY = null;
  for (let i = 0; i < blobs.length; i++) {
    const cssY = y0 + blobs[i].cy * 2;
    if (frontY == null || cssY > frontY) frontY = cssY;
  }
  return {
    width,
    height,
    enemyCount: blobs.length,
    frontY,
    frontEdgeY: frontEdge < 0 ? null : y0 + frontEdge,
    cyanPx,
  };
}

function fpsStats(stamps) {
  if (!stamps || stamps.length < 8) return null;
  let worst = 0;
  for (let i = 1; i < stamps.length; i++) {
    const d = stamps[i] - stamps[i - 1];
    if (d > worst) worst = d;
  }
  const span = stamps[stamps.length - 1] - stamps[0];
  if (span <= 0) return null;
  return {
    frames: stamps.length,
    spanMs: Math.round(span * 10) / 10,
    average: Math.round(((stamps.length - 1) / (span / 1000)) * 100) / 100,
    minimum: Math.round((1000 / worst) * 100) / 100,
    worstFrameMs: Math.round(worst * 10) / 10,
  };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function secs(ms) {
  return round3(ms / 1000);
}

function predictGates(gates, prev, dt, stage, lane) {
  const friendlyV = STAGE_V[stage] || 0.46;
  const speed = friendlyV * lane.h;
  const spawnY = lane.y + lane.h - 36 - 28;
  return gates.map((g) => {
    let vx = 0;
    if (prev && dt > 0.02 && dt < 0.8) {
      let best = null;
      let bestD = 1e9;
      for (const p of prev) {
        if (p.kind !== g.kind) continue;
        const d = Math.abs(p.cx - g.cx) + Math.abs(p.cy - g.cy) * 0.25;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best && bestD < 160) vx = (g.cx - best.cx) / dt;
      if (vx > 80) vx = 80;
      if (vx < -80) vx = -80;
    }
    const travel = Math.max(0, (spawnY - (g.y + g.h)) / Math.max(speed, 1));
    let pred = g.cx + vx * Math.min(travel, 1.6);
    pred = Math.max(lane.x + 16, Math.min(lane.x + lane.w - 16, pred));
    return { ...g, predCx: pred, vx };
  });
}

function hitsKind(gates, x, kind) {
  for (const g of gates) {
    if (g.kind !== kind) continue;
    if (x >= g.predCx - g.w / 2 && x <= g.predCx + g.w / 2) return true;
  }
  return false;
}

function chooseX(gates, lane, mode) {
  const clampX = (x) => Math.max(lane.x + 18, Math.min(lane.x + lane.w - 18, x));
  if (mode === 'add') {
    const adds = gates.filter((g) => g.kind === 'add');
    if (!adds.length) return clampX(lane.x + lane.w * 0.77);
    adds.sort((a, b) => b.cy - a.cy);
    const g = adds[0];
    const candidates = [g.predCx, g.x + 18, g.x + g.w - 18];
    for (const x of candidates) {
      if (!hitsKind(gates, x, 'sub')) return clampX(x);
    }
    return clampX(g.predCx);
  }
  let bestX = lane.x + lane.w * 0.22;
  let best = -1e9;
  const cands = [];
  for (let x = lane.x + 18; x <= lane.x + lane.w - 18; x += 8) cands.push(x);
  for (const g of gates) if (g.kind === 'mul') cands.push(g.predCx);
  for (const x of cands) {
    let gold = 0;
    let green = 0;
    let red = 0;
    for (const g of gates) {
      if (x < g.predCx - g.w / 2 || x > g.predCx + g.w / 2) continue;
      if (g.kind === 'mul') gold++;
      else if (g.kind === 'add') green++;
      else red++;
    }
    const score = gold * 100 + green * 8 - red * 90;
    if (score > best) {
      best = score;
      bestX = x;
    }
  }
  return clampX(bestX);
}

function findGateJump(history) {
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const cur = history[i];
    if (prev.count == null || cur.count == null) continue;
    if (prev.countScore < 0.5 || cur.countScore < 0.5) continue;
    const delta = cur.count - prev.count;
    const addDrop = prev.addPx > 250 && cur.addPx < prev.addPx * 0.55;
    if (delta >= 8 && addDrop && String(prev.crown) === String(cur.crown)) {
      return {
        before: prev.count,
        after: cur.count,
        delta,
        secondsBefore: round3(prev.t),
        secondsAfter: round3(cur.t),
        beforeScore: prev.countScore,
        afterScore: cur.countScore,
        addPxBefore: prev.addPx,
        addPxAfter: cur.addPx,
        crownBefore: String(prev.crown),
        crownAfter: String(cur.crown),
      };
    }
  }
  return null;
}

function findCollision(history) {
  let best = null;
  let bestScore = 0;
  for (let i = 1; i < history.length; i++) {
    const b = history[i];
    for (let j = i - 1; j >= 0; j--) {
      const dt = b.t - history[j].t;
      if (dt < 0.3) continue;
      if (dt > 1.05) break;
      const a = history[j];
      if (String(a.hearth) !== String(b.hearth)) continue;
      const eDrop = a.meetE - b.meetE;
      const fDrop = a.meetF - b.meetF;
      if (a.meetE < 3 || a.meetF < 4) continue;
      if (eDrop < 2 || fDrop < 2) continue;
      const score = eDrop * 6 + Math.min(fDrop, 40);
      if (score <= bestScore) continue;
      bestScore = score;
      best = {
        secondsBefore: round3(a.t),
        secondsAfter: round3(b.t),
        dt: round3(dt),
        meetFriendBefore: a.meetF,
        meetFriendAfter: b.meetF,
        meetEnemyBefore: a.meetE,
        meetEnemyAfter: b.meetE,
        meetFriendPxBefore: a.meetFpx,
        meetFriendPxAfter: b.meetFpx,
        hearth: String(b.hearth),
        crownBefore: String(a.crown),
        crownAfter: String(b.crown),
      };
    }
  }
  return best;
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, name);
  await page.screenshot({ path: file, type: 'png' });
  return file;
}

test('live crowd-surge desktop verification', async ({ page }) => {
  test.setTimeout(18 * 60 * 1000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err && err.stack ? err.stack : err)));

  const report = {
    url: URL,
    only: ONLY || 'full',
    viewport: '1280x800',
    browser: 'headless Chromium',
    input: 'page.mouse pointer drag; button clicks only for Start, Retry, and Next',
    clocks: 'seconds = elapsedMilliseconds / 1000',
    enemyCountMethod: 'one #F4FFFD highlight core per raider, below the crown and above the cannon',
    frontY: 'lowest core centroid in CSS pixels; larger y is toward the player',
    checks: {},
  };

  if (URL.includes('?')) throw new Error('refusing a URL with a query string');

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('[data-screen="title"]:not([hidden])');
  const opened = await page.evaluate(readHud);
  report.opened = opened;
  if (opened.href.includes('?')) throw new Error('page landed with a query: ' + opened.href);
  if (opened.hook !== 'undefined') throw new Error('debug hook is present on the live page');

  const stageStart = Date.now();
  await page.locator('[data-action="start"]').click();
  await page.waitForFunction(() => document.body.dataset.phase === 'play');
  const playSeen = Date.now();
  await page.evaluate(installFps);

  const waitUntil = async (at) => {
    const left = at - Date.now();
    if (left > 0) await page.waitForTimeout(left);
  };

  await waitUntil(stageStart + 1000);
  const horde1At = Date.now();
  const live1 = await page.evaluate(BROWSER, { op: 'horde' });
  const t1Path = await shot(page, 't1s.png');
  const png1 = analyzePng(t1Path, live1.lane);
  await page.evaluate(armFps);
  const fpsWindowStart = Date.now();

  await waitUntil(stageStart + 5000);
  const fpsPayload = await page.evaluate(takeFps);
  const fpsWindowEnd = Date.now();
  const live5At = Date.now();
  const live5 = await page.evaluate(BROWSER, { op: 'horde' });
  const t5Path = await shot(page, 't5s.png');
  const png5 = analyzePng(t5Path, live5.lane);

  const use1 = png1.enemyCount >= 20 ? png1 : live1;
  const use5 = png5.enemyCount >= 20 ? png5 : live5;
  const frontDelta = (use5.frontY == null || use1.frontY == null) ? null : round3(use5.frontY - use1.frontY);
  const sizeOk = png1.width === 1280 && png1.height === 800 && png5.width === 1280 && png5.height === 800;
  const hordePass = sizeOk && use1.enemyCount >= 40 && use5.enemyCount >= 40 && frontDelta != null && frontDelta >= 100;
  report.checks.horde = {
    pass: hordePass,
    t1: {
      secondsAfterStart: secs(horde1At - stageStart),
      enemyCount: use1.enemyCount,
      frontY: use1.frontY == null ? null : round3(use1.frontY),
      frontEdgeY: use1.frontEdgeY == null ? null : round3(use1.frontEdgeY),
      cyanSamples: use1.cyanPx,
      source: png1.enemyCount >= 20 ? 'screenshot' : 'canvas',
      canvasEnemyCount: live1.enemyCount,
      canvasFrontY: live1.frontY == null ? null : round3(live1.frontY),
      png: png1,
      observeMs: live1.ms,
      shot: 't1s.png',
      odd: live1.odd,
    },
    t5: {
      secondsAfterStart: secs(live5At - stageStart),
      enemyCount: use5.enemyCount,
      frontY: use5.frontY == null ? null : round3(use5.frontY),
      frontEdgeY: use5.frontEdgeY == null ? null : round3(use5.frontEdgeY),
      cyanSamples: use5.cyanPx,
      source: png5.enemyCount >= 20 ? 'screenshot' : 'canvas',
      canvasEnemyCount: live5.enemyCount,
      canvasFrontY: live5.frontY == null ? null : round3(live5.frontY),
      png: png5,
      observeMs: live5.ms,
      shot: 't5s.png',
      odd: live5.odd,
    },
    frontDeltaY: frontDelta,
    note: 'Positive frontDeltaY means the front rank moved down, toward the player.',
  };
  console.log('HORDE', JSON.stringify(report.checks.horde));

  const fps = fpsStats(fpsPayload.stamps);
  report.checks.fps = {
    pass: !!(fps && fps.frames >= 30 && fps.spanMs >= 1500),
    environment: 'headless Chromium on a cloud VM',
    method: 'requestAnimationFrame timestamps stored on window.__fpsRead; the observer does not write game state',
    window: 'after the t=1s screenshot through the read just before the t=5s screenshot, dropping the first 40ms after the window was armed',
    windowStartSeconds: secs(fpsWindowStart - stageStart),
    windowEndSeconds: secs(fpsWindowEnd - stageStart),
    average: fps ? fps.average : null,
    minimum: fps ? fps.minimum : null,
    frames: fps ? fps.frames : 0,
    spanMs: fps ? fps.spanMs : 0,
    worstFrameMs: fps ? fps.worstFrameMs : null,
    minimumMeans: '1000 / longest gap between consecutive rAF timestamps in the window',
  };
  console.log('FPS', JSON.stringify(report.checks.fps));

  if (ONLY === 'horde') {
    fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
    expect(report.checks.horde.pass, JSON.stringify(report.checks.horde)).toBe(true);
    expect(report.checks.fps.pass, JSON.stringify(report.checks.fps)).toBe(true);
    return;
  }

  const idleTrace = [];
  let idlePhase = 'play';
  let loseAt = 0;
  while (Date.now() - stageStart < 90000) {
    const hud = await page.evaluate(readHud);
    idlePhase = hud.phase;
    idleTrace.push({
      seconds: secs(Date.now() - stageStart),
      phase: hud.phase,
      hearth: hud.hearth,
      crown: hud.crown,
    });
    if (hud.phase !== 'play') {
      loseAt = Date.now();
      break;
    }
    await page.waitForTimeout(400);
  }
  if (!loseAt) loseAt = Date.now();
  const loseHud = await page.evaluate(readHud);
  if (loseHud.phase === 'lose') await shot(page, 'lose.png');
  else await shot(page, 'fail-idle.png');
  const loseSeconds = secs(loseAt - stageStart);
  report.checks.idleLose = {
    pass: loseHud.phase === 'lose' && loseSeconds > 1 && loseSeconds < 90,
    seconds: loseSeconds,
    milliseconds: loseAt - stageStart,
    formula: '(loseVisibleWallClock - stageStartWallClock) / 1000',
    phase: loseHud.phase,
    heading: loseHud.loseH2,
    copy: loseHud.loseCopy,
    hearth: loseHud.hearth,
    crown: loseHud.crown,
    trace: idleTrace,
    shot: loseHud.phase === 'lose' ? 'lose.png' : 'fail-idle.png',
    input: 'Start click, then no pointer and no keyboard until the lose screen',
  };
  console.log('LOSE', JSON.stringify({ seconds: loseSeconds, phase: loseHud.phase, heading: loseHud.loseH2, copy: loseHud.loseCopy }));

  let loseRetry = { pass: false };
  let clearOrigin = 0;
  if (loseHud.phase === 'lose') {
    clearOrigin = Date.now();
    await page.locator('[data-screen="lose"] [data-action="retry"]').click();
    await page.waitForFunction(() => document.body.dataset.phase === 'play' && document.body.dataset.stage === '1');
    const again = await page.evaluate(readHud);
    loseRetry = {
      pass: again.phase === 'play' && again.stage === '1' && again.name === 'Kindling Yard' && again.crown === '1700' && again.hearth === '48',
      phase: again.phase,
      stage: again.stage,
      kicker: again.kicker,
      name: again.name,
      crown: again.crown,
      hearth: again.hearth,
    };
  }
  report.checks.loseRetry = loseRetry;
  console.log('LOSE_RETRY', JSON.stringify(loseRetry));

  async function playClear(preferAdd, label, origin) {
    const started = origin || Date.now();
    await page.waitForFunction(() => document.body.dataset.phase === 'play');
    const hud0 = await page.evaluate(readHud);
    const layout = await page.evaluate(BROWSER, { op: 'horde' });
    const lane = layout.lane;
    let aimX = lane.x + lane.w * (preferAdd ? 0.77 : 0.22);
    const aimY = lane.y + lane.h - 70;
    let held = false;
    const down = async (x) => {
      if (!held) {
        await page.mouse.move(x, aimY);
        await page.mouse.down();
        held = true;
      } else {
        await page.mouse.move(x, aimY, { steps: 3 });
      }
    };
    const up = async () => {
      if (!held) return;
      await page.mouse.up();
      held = false;
    };
    await down(aimX);
    const history = [];
    let gate = null;
    let collision = null;
    let collisionShot = false;
    let prevGates = null;
    let prevT = 0;
    let lastCount = null;
    let end = null;
    let lastLog = 0;
    while (Date.now() - started < 240000) {
      const now = Date.now();
      const t = (now - started) / 1000;
      let view;
      try {
        view = await page.evaluate(BROWSER, {
          aimX,
          lastCount,
          wide: !gate,
        });
      } catch (err) {
        end = { phase: 'error', error: String(err) };
        break;
      }
      if (view.phase !== 'play') {
        end = view;
        break;
      }
      if (view.count != null) lastCount = view.count;
      const row = {
        t,
        count: view.count,
        countScore: view.countScore,
        addPx: view.addPx,
        mulPx: view.mulPx,
        subPx: view.subPx,
        meetF: view.meetF,
        meetE: view.meetE,
        meetFpx: view.meetFpx,
        hearth: view.hearth,
        crown: view.crown,
        phase: view.phase,
      };
      history.push(row);
      if (t < 4 && view.count != null && (history.length < 3 || history[history.length - 2].count !== view.count || history[history.length - 2].addPx !== view.addPx)) {
        console.log('COUNT', JSON.stringify({ t: round3(t), count: view.count, score: view.countScore, addPx: view.addPx, alts: view.countAlts }));
      }
      if (!gate) {
        gate = findGateJump(history);
        if (gate) console.log('GATE', JSON.stringify(gate));
      }
      if (!collision) {
        collision = findCollision(history);
        if (collision && !collisionShot) {
          await shot(page, 'collision.png');
          collisionShot = true;
          collision.shot = 'collision.png';
        }
      }
      const dt = prevT ? t - prevT : 0;
      const predicted = predictGates(view.gates, prevGates, dt, view.stage, view.lane);
      prevGates = view.gates;
      prevT = t;
      const mode = preferAdd && !gate && t < 3.2 ? 'add' : 'mul';
      aimX = chooseX(predicted, view.lane, mode);
      await down(aimX);
      if (now - lastLog > 5000) {
        lastLog = now;
        console.log(label, JSON.stringify({
          t: round3(t),
          crown: view.crown,
          hearth: view.hearth,
          count: view.count,
          score: view.countScore,
          meetF: view.meetF,
          meetE: view.meetE,
          addPx: view.addPx,
          mode,
          aimX: Math.round(aimX),
          ms: view.ms,
        }));
      }
      await page.waitForTimeout(70);
    }
    await up();
    const hudEnd = await page.evaluate(readHud);
    if (!end) end = hudEnd;
    else end = { ...end, ...hudEnd };
    const finished = Date.now();
    return {
      label,
      seconds: secs(finished - started),
      milliseconds: finished - started,
      phase: end.phase,
      winKicker: end.winKicker || '',
      winCopy: end.winCopy || '',
      winH2: end.winH2 || '',
      crown: end.crown,
      hearth: end.hearth,
      stage: end.stage,
      name: end.stageName || end.name || hud0.name,
      gate,
      collision,
      samples: history.length,
      last: history.slice(-3),
      startHud: { crown: hud0.crown, hearth: hud0.hearth, name: hud0.name, stage: hud0.stage },
    };
  }

  if (ONLY === 'idle') {
    fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
    expect(report.checks.horde.pass, JSON.stringify(report.checks.horde)).toBe(true);
    expect(report.checks.idleLose.pass, 'idle lose').toBe(true);
    expect(report.checks.loseRetry.pass, 'lose retry').toBe(true);
    expect(report.checks.fps.pass, JSON.stringify(report.checks.fps)).toBe(true);
    return;
  }

  if (!loseRetry.pass) {
    report.checks.gate = { pass: false, note: 'stage 1 was not restarted from the lose screen' };
    report.checks.collision = { pass: false, note: 'stage 1 was not restarted from the lose screen' };
    report.checks.clear = { pass: false, note: 'stage 1 was not restarted from the lose screen' };
    report.checks.winRetry = { pass: false };
    report.checks.clear2 = { pass: false };
    report.checks.next = { pass: false };
    report.checks.console = {
      pass: consoleErrors.length === 0 && pageErrors.length === 0,
      consoleErrors,
      pageErrors,
    };
    fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
    expect(report.checks.idleLose.pass, JSON.stringify(report.checks.idleLose)).toBe(true);
    expect(loseRetry.pass, JSON.stringify(loseRetry)).toBe(true);
    return;
  }

  const clear1 = await playClear(true, 'CLEAR1', clearOrigin);
  if (clear1.phase === 'win') await shot(page, 'win.png');
  else await shot(page, 'fail-clear.png');
  report.checks.gate = clear1.gate
    ? { pass: true, ...clear1.gate }
    : { pass: false, note: 'no on-screen count jump with the add gate collapsing', last: clear1.last };
  report.checks.collision = clear1.collision
    ? { pass: true, ...clear1.collision }
    : { pass: false, note: 'meeting-area counts did not drop on both sides', last: clear1.last };
  report.checks.clear = {
    pass: clear1.phase === 'win',
    seconds: clear1.seconds,
    milliseconds: clear1.milliseconds,
    formula: '(winVisibleWallClock - stageStartWallClock) / 1000',
    phase: clear1.phase,
    heading: clear1.winH2,
    kicker: clear1.winKicker,
    copy: clear1.winCopy,
    input: 'pointer drag only after the lose-screen Retry restarted stage 1',
    shot: clear1.phase === 'win' ? 'win.png' : 'fail-clear.png',
    startHud: clear1.startHud,
  };
  console.log('CLEAR1', JSON.stringify({ seconds: clear1.seconds, phase: clear1.phase, gate: report.checks.gate, collision: report.checks.collision }));

  let winRetry = { pass: false };
  let clear2 = null;
  let nextStage = { pass: false };
  if (clear1.phase === 'win') {
    const retryOrigin = Date.now();
    await page.locator('[data-screen="win"] [data-action="retry"]').click();
    await page.waitForFunction(() => document.body.dataset.phase === 'play' && document.body.dataset.stage === '1');
    const restarted = await page.evaluate(readHud);
    winRetry = {
      pass: restarted.phase === 'play' && restarted.stage === '1' && restarted.name === 'Kindling Yard' && restarted.kicker === 'Stage 1' && restarted.crown === '1700' && restarted.hearth === '48',
      phase: restarted.phase,
      stage: restarted.stage,
      kicker: restarted.kicker,
      name: restarted.name,
      crown: restarted.crown,
      hearth: restarted.hearth,
    };
    report.checks.winRetry = winRetry;
    console.log('WIN_RETRY', JSON.stringify(winRetry));
    clear2 = await playClear(false, 'CLEAR2', retryOrigin);
    report.checks.clear2 = {
      pass: clear2.phase === 'win',
      seconds: clear2.seconds,
      phase: clear2.phase,
      heading: clear2.winH2,
      kicker: clear2.winKicker,
    };
    console.log('CLEAR2', JSON.stringify(report.checks.clear2));
    if (clear2.phase === 'win') {
      await page.locator('[data-screen="win"] [data-action="next"]').click();
      await page.waitForFunction(() => document.body.dataset.phase === 'play' && document.body.dataset.stage === '2');
      const stage2 = await page.evaluate(readHud);
      nextStage = {
        pass: stage2.phase === 'play' && stage2.stage === '2' && stage2.name === 'Cinder Span' && stage2.kicker === 'Stage 2' && stage2.crown === '3200' && stage2.hearth === '30',
        phase: stage2.phase,
        stage: stage2.stage,
        kicker: stage2.kicker,
        name: stage2.name,
        crown: stage2.crown,
        hearth: stage2.hearth,
      };
    }
  } else {
    report.checks.winRetry = winRetry;
    report.checks.clear2 = { pass: false, note: 'stage 1 did not clear' };
  }
  report.checks.next = nextStage;
  console.log('NEXT', JSON.stringify(nextStage));

  report.checks.console = {
    pass: consoleErrors.length === 0 && pageErrors.length === 0,
    consoleErrors,
    pageErrors,
  };
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
  console.log('REPORT_WRITTEN', path.join(SHOTS, 'report.json'));

  expect(report.checks.horde.pass, JSON.stringify(report.checks.horde)).toBe(true);
  expect(report.checks.gate.pass, JSON.stringify(report.checks.gate)).toBe(true);
  expect(report.checks.collision.pass, JSON.stringify(report.checks.collision)).toBe(true);
  expect(report.checks.clear.pass, JSON.stringify(report.checks.clear)).toBe(true);
  expect(report.checks.winRetry.pass, JSON.stringify(report.checks.winRetry)).toBe(true);
  expect(report.checks.next.pass, JSON.stringify(report.checks.next)).toBe(true);
  expect(report.checks.idleLose.pass, JSON.stringify({ seconds: report.checks.idleLose.seconds, phase: report.checks.idleLose.phase, heading: report.checks.idleLose.heading })).toBe(true);
  expect(report.checks.loseRetry.pass, JSON.stringify(report.checks.loseRetry)).toBe(true);
  expect(report.checks.fps.pass, JSON.stringify(report.checks.fps)).toBe(true);
  expect(report.checks.console.pass, JSON.stringify(report.checks.console)).toBe(true);
});
