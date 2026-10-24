import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIVE = 'https://souljazzfunk.github.io/mob-crowd-game/';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(DIR, 'screenshots');
const PROBE = process.env.VERIFY_PROBE === '1';
const STAGE_V = { 1: 0.33, 2: 0.35, 3: 0.37 };

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

function classify(r, g, b) {
  if (r >= 242 && g >= 136 && g <= 170 && b >= 42 && b <= 82 && r - g >= 80) return 'friend';
  if (r <= 90 && g >= 180 && b >= 165 && g - r >= 90 && Math.abs(g - b) <= 40) return 'enemy';
  if (r >= 155 && r <= 210 && g >= 200 && g <= 248 && b >= 110 && b <= 170 && g - r >= 20 && g - b >= 45) return 'add';
  if (r >= 215 && g >= 172 && g <= 220 && b >= 60 && b <= 120 && r - b >= 100 && g - b >= 60 && r - g < 80) return 'mul';
  if (r >= 215 && g >= 85 && g <= 145 && b >= 100 && b <= 160 && r - g >= 85) return 'sub';
  return '';
}

function bright(r, g, b, a) {
  return a > 140 && r > 220 && g > 190 && b > 165 && r >= b - 5;
}

function ocrTemplates(fontSize) {
  const key = '__verifyOcrCache';
  const box = window[key] || (window[key] = { fontSize: 0, map: null });
  if (box.fontSize === fontSize && box.map) return box.map;
  const map = new Map();
  const font = '700 ' + fontSize + 'px Georgia, "Liberation Serif", "Times New Roman", serif';
  box.fontSize = fontSize;
  box.map = map;
  box.font = font;
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
  const cx = aimX * dpr;
  const cy = (lane.y + lane.h - 36 - 58) * dpr;
  const rw = Math.max(40, Math.round(fontSize * dpr * 3.1));
  const rh = Math.max(30, Math.round(fontSize * dpr * 1.15));
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
  if (brightN < 12) return { count: null, score: 0, alts: [], brightN, sx, sy, sw, sh };
  let from = 0;
  let to = 30;
  if (lastCount != null && lastCount >= 0) {
    from = Math.max(0, lastCount - 4);
    to = Math.min(560, lastCount + (wide ? 40 : 8));
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
    sx,
    sy,
    sw,
    sh,
  };
}

function blobsIn(mask, w, h, y0, y1, minSize) {
  const seen = new Uint8Array(w * h);
  let blobs = 0;
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  const yStart = Math.max(0, y0);
  const yEnd = Math.min(h, y1);
  for (let y = yStart; y < yEnd; y++) {
    for (let x = 0; x < w; x++) {
      const s = y * w + x;
      if (!mask[s] || seen[s]) continue;
      let head = 0;
      let tail = 0;
      let size = 0;
      let keep = false;
      seen[s] = 1;
      qx[tail] = x;
      qy[tail] = y;
      tail++;
      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
        size++;
        if (cy >= yStart && cy < yEnd) keep = true;
        if (cx > 0) {
          const n = cy * w + cx - 1;
          if (mask[n] && !seen[n]) {
            seen[n] = 1;
            qx[tail] = cx - 1;
            qy[tail] = cy;
            tail++;
          }
        }
        if (cx + 1 < w) {
          const n = cy * w + cx + 1;
          if (mask[n] && !seen[n]) {
            seen[n] = 1;
            qx[tail] = cx + 1;
            qy[tail] = cy;
            tail++;
          }
        }
        if (cy > 0) {
          const n = (cy - 1) * w + cx;
          if (mask[n] && !seen[n]) {
            seen[n] = 1;
            qx[tail] = cx;
            qy[tail] = cy - 1;
            tail++;
          }
        }
        if (cy + 1 < h) {
          const n = (cy + 1) * w + cx;
          if (mask[n] && !seen[n]) {
            seen[n] = 1;
            qx[tail] = cx;
            qy[tail] = cy + 1;
            tail++;
          }
        }
      }
      if (keep && size >= minSize) blobs++;
    }
  }
  return blobs;
}

function observe(arg) {
  const t0 = performance.now();
  const aimX = arg && arg.aimX ? arg.aimX : 640;
  const lastCount = arg && typeof arg.lastCount === 'number' ? arg.lastCount : null;
  const wide = !!(arg && arg.wide);
  const screen = readScreen();
  const { canvas, ctx, lane, dpr, fontSize } = screen;
  const x0 = Math.max(0, Math.floor(lane.x * dpr));
  const y0 = Math.max(0, Math.floor(lane.y * dpr));
  const lw = Math.max(1, Math.min(canvas.width - x0, Math.floor(lane.w * dpr)));
  const lh = Math.max(1, Math.min(canvas.height - y0, Math.floor(lane.h * dpr)));
  const image = ctx.getImageData(x0, y0, lw, lh);
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
  const enemyMask = new Uint8Array(gw * gh);
  let friendPx = 0;
  let enemyPx = 0;
  let mulPx = 0;
  let addPx = 0;
  let subPx = 0;
  let muzzleN = 0;
  let muzzleSum = 0;
  const muzzleY = (lane.h - 110) * dpr;
  for (let y = 0; y < lh; y += 2) {
    for (let x = 0; x < lw; x += 2) {
      const o = (y * lw + x) * 4;
      const k = classify(data[o], data[o + 1], data[o + 2]);
      if (!k) continue;
      if (k === 'friend') {
        friendPx++;
        const mx = x >> 1;
        const my = y >> 1;
        if (mx < gw && my < gh) friendMask[my * gw + mx] = 1;
        if (y >= muzzleY) {
          muzzleN++;
          muzzleSum += x;
        }
      } else if (k === 'enemy') {
        enemyPx++;
        const mx = x >> 1;
        const my = y >> 1;
        if (mx < gw && my < gh) enemyMask[my * gw + mx] = 1;
      } else if (k === 'mul') {
        mulPx++;
        mulC[(Math.floor(y / cell)) * cols + Math.floor(x / cell)]++;
      } else if (k === 'add') {
        addPx++;
        addC[(Math.floor(y / cell)) * cols + Math.floor(x / cell)]++;
      } else if (k === 'sub') {
        subPx++;
        subC[(Math.floor(y / cell)) * cols + Math.floor(x / cell)]++;
      }
    }
  }
  const mid0 = Math.floor(gh * 0.16);
  const mid1 = Math.floor(gh * 0.56);
  const midF = blobsIn(friendMask, gw, gh, mid0, mid1, 4);
  const midE = blobsIn(enemyMask, gw, gh, mid0, mid1, 4);
  const laneF = blobsIn(friendMask, gw, gh, 0, gh, 4);
  const laneE = blobsIn(enemyMask, gw, gh, 0, gh, 4);

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
        if (rw < 46 || rh < 22) continue;
        if (hits < rw * rh * 0.04) continue;
        const gx = lane.x + (x0 + minX * cell) / dpr;
        const gy = lane.y + (y0 + minY * cell) / dpr;
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
  const stage = Number(document.body.dataset.stage || '0');
  const out = {
    phase: document.body.dataset.phase || '',
    stage,
    kicker: document.getElementById('stage-kicker').textContent,
    stageName: document.getElementById('stage-name').textContent,
    crown: document.getElementById('enemy-hp').textContent,
    hearth: document.getElementById('player-hp').textContent,
    winVisible: !document.querySelector('[data-screen="win"]').hidden,
    loseVisible: !document.querySelector('[data-screen="lose"]').hidden,
    winKicker: document.getElementById('win-kicker').textContent,
    winCopy: document.getElementById('win-copy').textContent,
    lane,
    aimY: lane.y + lane.h - 70,
    fontSize,
    dpr,
    cssW: screen.cssW,
    cssH: screen.cssH,
    friendPx,
    enemyPx,
    mulPx,
    addPx,
    subPx,
    midF,
    midE,
    laneF,
    laneE,
    muzzleCx: muzzleN ? (x0 + muzzleSum / muzzleN) / dpr : null,
    count: ocr.count,
    countScore: ocr.score,
    countAlts: ocr.alts,
    gates,
    ms: Math.round(performance.now() - t0),
  };
  return out;
}

function predictGates(gates, prev, dt, stage, lane) {
  const friendlyV = STAGE_V[stage] || 0.33;
  const speed = friendlyV * lane.h;
  const spawnY = lane.y + lane.h - 36 - 28;
  return gates.map((g) => {
    let vx = 0;
    if (prev && dt > 0.02 && dt < 0.8) {
      let best = null;
      let bestD = 1e9;
      for (const p of prev) {
        if (p.kind !== g.kind) continue;
        const d = Math.abs(p.cx - g.cx) + Math.abs(p.cy - g.cy) * 0.3;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best && bestD < 140) vx = (g.cx - best.cx) / dt;
      if (vx > 90) vx = 90;
      if (vx < -90) vx = -90;
    }
    const travel = Math.max(0, (spawnY - g.cy) / Math.max(speed, 1));
    let pred = g.cx + vx * Math.min(travel, 2.4);
    pred = Math.max(lane.x + 10, Math.min(lane.x + lane.w - 10, pred));
    return { ...g, predCx: pred, vx };
  });
}

function chooseX(gates, lane, mode) {
  const clampX = (x) => Math.max(lane.x + 12, Math.min(lane.x + lane.w - 12, x));
  if (mode === 'hold') return clampX(lane.x + lane.w * 0.5);
  if (mode === 'add') {
    const adds = gates.filter((g) => g.kind === 'add');
    if (!adds.length) return clampX(lane.x + lane.w * 0.5);
    adds.sort((a, b) => b.cy - a.cy);
    return clampX(adds[0].predCx);
  }
  if (mode === 'lose') {
    let bestX = lane.x + lane.w * 0.08;
    let best = 1e9;
    for (let x = lane.x + 14; x <= lane.x + lane.w - 14; x += 8) {
      let gold = 0;
      let green = 0;
      for (const g of gates) {
        const half = g.w / 2;
        if (x < g.predCx - half || x > g.predCx + half) continue;
        if (g.kind === 'mul') gold++;
        else if (g.kind === 'add') green++;
      }
      const score = gold * 10 + green * 4 + Math.abs(x - (lane.x + 18)) * 0.002;
      if (score < best) {
        best = score;
        bestX = x;
      }
    }
    return clampX(bestX);
  }
  let bestX = lane.x + lane.w * 0.22;
  let best = -1e9;
  const cands = [];
  for (let x = lane.x + 12; x <= lane.x + lane.w - 12; x += 6) cands.push(x);
  for (const g of gates) if (g.kind === 'mul') cands.push(g.predCx);
  for (const x of cands) {
    let gold = 0;
    let green = 0;
    let red = 0;
    for (const g of gates) {
      const half = g.w / 2;
      if (x < g.predCx - half || x > g.predCx + half) continue;
      if (g.kind === 'mul') gold++;
      else if (g.kind === 'add') green++;
      else red++;
    }
    const score = gold * 100 + green * 12 - red * 90;
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
    if (prev.countScore < 0.55 || cur.countScore < 0.55) continue;
    const delta = cur.count - prev.count;
    const addDrop = prev.addPx > 400 && cur.addPx < prev.addPx * 0.55;
    if (delta >= 8 && addDrop && String(prev.crown) === String(cur.crown)) {
      return {
        before: prev.count,
        after: cur.count,
        delta,
        tBefore: prev.t,
        tAfter: cur.t,
        beforeScore: prev.countScore,
        afterScore: cur.countScore,
        addPxBefore: prev.addPx,
        addPxAfter: cur.addPx,
        crownBefore: prev.crown,
        crownAfter: cur.crown,
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
    if (b.t > 12) continue;
    for (let j = i - 1; j >= 0; j--) {
      const dt = b.t - history[j].t;
      if (dt < 0.4) continue;
      if (dt > 1.1) break;
      const a = history[j];
      if (String(a.hearth) !== String(b.hearth)) continue;
      const eDrop = a.midE - b.midE;
      const fDrop = a.midF - b.midF;
      const laneEDrop = a.laneE - b.laneE;
      if (a.midE < 3 || a.midF < 4) continue;
      if (eDrop < 2 || fDrop < 2) continue;
      const score = eDrop * 8 + Math.min(fDrop, 30) + laneEDrop;
      if (score <= bestScore) continue;
      bestScore = score;
      best = {
        tBefore: round3(a.t),
        tAfter: round3(b.t),
        dt: round3(dt),
        midFriendBefore: a.midF,
        midFriendAfter: b.midF,
        midEnemyBefore: a.midE,
        midEnemyAfter: b.midE,
        laneFriendBefore: a.laneF,
        laneFriendAfter: b.laneF,
        laneEnemyBefore: a.laneE,
        laneEnemyAfter: b.laneE,
        onScreenCountBefore: a.count,
        onScreenCountAfter: b.count,
        hearth: String(b.hearth),
        crownBefore: String(a.crown),
        crownAfter: String(b.crown),
      };
    }
  }
  return best;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

const OBSERVE_FN = new Function(
  'arg',
  [readScreen, classify, bright, ocrTemplates, renderCount, scoreTemplate, readCount, blobsIn, observe]
    .map((fn) => fn.toString())
    .join('\n') + '\nreturn observe(arg);\n'
);

function slim(obs, t) {
  return {
    t: round3(t),
    count: obs.count,
    countScore: obs.countScore == null ? 0 : Math.round(obs.countScore * 1000) / 1000,
    addPx: obs.addPx,
    mulPx: obs.mulPx,
    subPx: obs.subPx,
    friendPx: obs.friendPx,
    enemyPx: obs.enemyPx,
    midF: obs.midF,
    midE: obs.midE,
    laneF: obs.laneF,
    laneE: obs.laneE,
    crown: obs.crown,
    hearth: obs.hearth,
    phase: obs.phase,
    stage: obs.stage,
    kicker: obs.kicker,
    muzzleCx: obs.muzzleCx == null ? null : Math.round(obs.muzzleCx),
    gates: obs.gates.map((g) => ({ kind: g.kind, cx: Math.round(g.cx), cy: Math.round(g.cy), w: Math.round(g.w), h: Math.round(g.h) })),
    ms: obs.ms,
    alts: obs.countAlts,
  };
}

test('live desktop Chromium verification', async ({ page }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    errors.push(String(err && err.stack ? err.stack : err));
  });

  const report = {
    url: LIVE,
    viewport: { width: 1280, height: 800 },
    items: {},
    errors: [],
    notes: [],
    stage1ClearSeconds: null,
  };

  const vp = page.viewportSize();
  if (!vp || vp.width !== 1280 || vp.height !== 800) {
    throw new Error('viewport is ' + JSON.stringify(vp));
  }

  const response = await page.goto(LIVE, { waitUntil: 'load', timeout: 45000 });
  const finalUrl = page.url();
  const parsed = new URL(finalUrl);
  report.finalUrl = finalUrl;
  report.httpStatus = response ? response.status() : null;
  if (!response || !response.ok()) throw new Error('live site HTTP ' + report.httpStatus);
  if (parsed.search) throw new Error('page URL has query params: ' + parsed.search);
  if (parsed.origin + parsed.pathname !== 'https://souljazzfunk.github.io/mob-crowd-game/') {
    throw new Error('unexpected url ' + finalUrl);
  }
  await page.waitForFunction(() => document.body.dataset.phase === 'title');
  report.build = await page.locator('meta[name="emberline-build"]').getAttribute('content');

  await page.locator('[data-action="start"]').click();
  const playMark = Date.now();
  await page.waitForFunction(() => document.body.dataset.phase === 'play' && document.body.dataset.stage === '1');

  let obs = await page.evaluate(OBSERVE_FN, { aimX: 640, lastCount: null, wide: true });
  report.layout = { lane: obs.lane, cssW: obs.cssW, cssH: obs.cssH, dpr: obs.dpr, fontSize: obs.fontSize, observeMs: obs.ms };
  const aimY = obs.aimY;
  const center = obs.lane.x + obs.lane.w * 0.5;
  const left = obs.lane.x + obs.lane.w * 0.2;
  const right = obs.lane.x + obs.lane.w * 0.8;

  await page.mouse.move(center, aimY);
  await page.mouse.down();
  await page.mouse.move(left, aimY, { steps: 16 });
  await page.waitForTimeout(280);
  const leftObs = await page.evaluate(OBSERVE_FN, { aimX: left, lastCount: null, wide: true });
  await page.mouse.move(right, aimY, { steps: 16 });
  await page.waitForTimeout(280);
  const rightObs = await page.evaluate(OBSERVE_FN, { aimX: right, lastCount: leftObs.count, wide: true });
  await page.mouse.move(center, aimY, { steps: 12 });
  await page.waitForTimeout(220);
  report.drag = {
    leftMuzzleCx: leftObs.muzzleCx,
    rightMuzzleCx: rightObs.muzzleCx,
    leftCount: leftObs.count,
    rightCount: rightObs.count,
    separated: leftObs.muzzleCx != null && rightObs.muzzleCx != null && rightObs.muzzleCx - leftObs.muzzleCx > 40,
  };
  console.log('DRAG ' + JSON.stringify(report.drag));

  let lastCount = rightObs.count;
  let prevGates = null;
  let prevT = Date.now();
  let lastAim = center;
  let winAt = null;
  const history = [];
  let gateEvidence = null;
  let collisionEvidence = null;
  let collisionShot = false;
  const openingUntil = Date.now() + 7000;
  const firstWinBudget = Date.now() + 5 * 60 * 1000;
  const probeUntil = Date.now() + Number(process.env.VERIFY_PROBE_MS || 18000);

  async function sample(wide) {
    const now = Date.now();
    const reading = await page.evaluate(OBSERVE_FN, { aimX: lastAim, lastCount, wide });
    const t = (now - playMark) / 1000;
    const row = slim(reading, t);
    history.push(row);
    if (history.length > 500) history.shift();
    if (reading.count != null && reading.countScore >= 0.5) lastCount = reading.count;
    if (!gateEvidence) gateEvidence = findGateJump(history);
    if (!collisionEvidence) collisionEvidence = findCollision(history);
    if (!collisionShot && reading.midF >= 3 && reading.midE >= 3) {
      await page.screenshot({ path: path.join(SHOTS, 'collision.png') });
      collisionShot = true;
      report.notes.push('collision screenshot at t=' + row.t + ' midF=' + reading.midF + ' midE=' + reading.midE);
    }
    return { reading, row, now };
  }

  while (Date.now() < (PROBE ? probeUntil : firstWinBudget)) {
    const mode = !collisionEvidence && Date.now() < openingUntil ? 'hold' : !gateEvidence ? 'add' : 'clear';
    const snap = await sample(mode !== 'clear');
    if (snap.reading.winVisible) {
      winAt = Date.now();
      break;
    }
    const now = snap.now;
    const dt = (now - prevT) / 1000;
    const gates = predictGates(snap.reading.gates, prevGates, dt, snap.reading.stage || 1, snap.reading.lane);
    prevGates = snap.reading.gates;
    prevT = now;
    lastAim = chooseX(gates, snap.reading.lane, mode);
    await page.mouse.move(lastAim, snap.reading.aimY);
    if (PROBE || history.length % 8 === 0) {
      console.log(
        'TICK t=' + snap.row.t.toFixed(1) +
          ' mode=' + mode +
          ' count=' + snap.row.count +
          ' score=' + snap.row.countScore +
          ' mid=' + snap.row.midF + '/' + snap.row.midE +
          ' lane=' + snap.row.laneF + '/' + snap.row.laneE +
          ' add=' + snap.row.addPx +
          ' crown=' + snap.row.crown +
          ' hearth=' + snap.row.hearth +
          ' gates=' + snap.reading.gates.length +
          ' aim=' + Math.round(lastAim) +
          ' ms=' + snap.row.ms +
          ' alts=' + JSON.stringify(snap.row.alts)
      );
    }
    await page.waitForTimeout(70);
  }

  if (PROBE) {
    report.probe = true;
    report.gateEvidence = gateEvidence;
    report.collisionEvidence = collisionEvidence;
    report.historyTail = history.slice(-40);
    report.errors = errors.slice();
    fs.writeFileSync(path.join(SHOTS, 'probe-report.json'), JSON.stringify(report, null, 2));
    await page.screenshot({ path: path.join(SHOTS, 'probe.png') });
    console.log('PROBE gate ' + JSON.stringify(gateEvidence));
    console.log('PROBE collision ' + JSON.stringify(collisionEvidence));
    console.log('PROBE errors ' + JSON.stringify(errors));
    return;
  }

  if (!collisionShot) {
    await page.screenshot({ path: path.join(SHOTS, 'collision.png') });
    report.notes.push('collision screenshot taken at end of opening because a meeting frame was not flagged');
  }

  const firstWin = await page.evaluate(OBSERVE_FN, { aimX: lastAim, lastCount, wide: false });
  if (firstWin.winVisible && !winAt) winAt = Date.now();

  await page.mouse.up();
  const clearSeconds = ((winAt || Date.now()) - playMark) / 1000;
  if (firstWin && firstWin.winVisible) {
    report.stage1ClearSeconds = Math.round(clearSeconds * 100) / 100;
    await page.screenshot({ path: path.join(SHOTS, 'win.png') });
  } else {
    await page.screenshot({ path: path.join(SHOTS, 'failure-win.png') });
  }

  report.items.gate = gateEvidence
    ? { pass: true, ...gateEvidence }
    : { pass: false, reason: 'no add-gate count jump of at least 8 while an add gate deactivated', tail: history.slice(-12) };
  report.items.collision = collisionEvidence
    ? { pass: true, ...collisionEvidence, screenshot: 'verify/screenshots/collision.png' }
    : { pass: false, reason: 'no window where mid-lane friendly and enemy blob counts both dropped with hearth HP unchanged', tail: history.filter((h) => h.t < 20).slice(-25) };

  console.log('ITEM gate ' + JSON.stringify(report.items.gate));
  console.log('ITEM collision ' + JSON.stringify(report.items.collision));
  console.log('CLEAR seconds=' + report.stage1ClearSeconds + ' win=' + !!(firstWin && firstWin.winVisible));

  if (!(firstWin && firstWin.winVisible)) {
    report.items.stage1 = { pass: false, reason: 'win screen did not appear within 5 minutes', clearSeconds };
    report.items.lose = { pass: false, reason: 'not attempted because stage 1 was not cleared' };
    report.items.console = { pass: errors.length === 0, errors: errors.slice() };
    report.errors = errors.slice();
    fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 2));
    throw new Error('stage 1 win screen did not appear');
  }

  const winText = {
    kicker: await page.locator('[data-screen="win"] .kicker').innerText(),
    heading: await page.locator('[data-screen="win"] h2').innerText(),
    copy: await page.locator('#win-copy').innerText(),
    next: await page.locator('[data-screen="win"] [data-action="next"]').isVisible(),
    retry: await page.locator('[data-screen="win"] [data-action="retry"]').isVisible(),
  };

  await page.locator('[data-screen="win"] [data-action="retry"]').click();
  await page.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 5000 });
  const afterRetry = await page.evaluate(() => ({
    phase: document.body.dataset.phase,
    stage: document.body.dataset.stage,
    kicker: document.getElementById('stage-kicker').textContent,
    stageName: document.getElementById('stage-name').textContent,
    crown: document.getElementById('enemy-hp').textContent,
    hearth: document.getElementById('player-hp').textContent,
    hudHidden: document.getElementById('hud').hidden,
    winHidden: document.querySelector('[data-screen="win"]').hidden,
  }));
  const retryOk = afterRetry.phase === 'play'
    && afterRetry.stage === '1'
    && afterRetry.kicker === 'Stage 1'
    && afterRetry.stageName === 'Kindling Yard'
    && afterRetry.crown === '3200'
    && afterRetry.hearth === '46'
    && afterRetry.hudHidden === false
    && afterRetry.winHidden === true;

  const secondMark = Date.now();
  await page.mouse.move(center, aimY);
  await page.mouse.down();
  lastAim = center;
  lastCount = null;
  prevGates = null;
  prevT = Date.now();
  let secondWin = false;
  const secondBudget = Date.now() + 5 * 60 * 1000;
  while (Date.now() < secondBudget) {
    const reading = await page.evaluate(OBSERVE_FN, { aimX: lastAim, lastCount, wide: false });
    if (reading.winVisible) {
      secondWin = true;
      break;
    }
    if (reading.count != null && reading.countScore >= 0.5) lastCount = reading.count;
    const now = Date.now();
    const dt = (now - prevT) / 1000;
    const gates = predictGates(reading.gates, prevGates, dt, reading.stage || 1, reading.lane);
    prevGates = reading.gates;
    prevT = now;
    lastAim = chooseX(gates, reading.lane, 'clear');
    await page.mouse.move(lastAim, reading.aimY);
    if (Math.round(now / 1000) % 5 === 0 && now - prevT < 200) {
      console.log('RETRY-CLEAR crown=' + reading.crown + ' hearth=' + reading.hearth + ' count=' + reading.count + ' t=' + ((now - secondMark) / 1000).toFixed(1));
    }
    await page.waitForTimeout(80);
  }
  await page.mouse.up();
  if (!secondWin) {
    await page.screenshot({ path: path.join(SHOTS, 'failure-second-win.png') });
  }
  let nextOk = false;
  let afterNext = null;
  if (secondWin) {
    await page.locator('[data-screen="win"] [data-action="next"]').click();
    await page.waitForFunction(() => document.body.dataset.phase === 'play' && document.body.dataset.stage === '2', null, { timeout: 5000 });
    afterNext = await page.evaluate(() => ({
      phase: document.body.dataset.phase,
      stage: document.body.dataset.stage,
      kicker: document.getElementById('stage-kicker').textContent,
      stageName: document.getElementById('stage-name').textContent,
      crown: document.getElementById('enemy-hp').textContent,
      hearth: document.getElementById('player-hp').textContent,
      winHidden: document.querySelector('[data-screen="win"]').hidden,
    }));
    nextOk = afterNext.phase === 'play'
      && afterNext.stage === '2'
      && afterNext.kicker === 'Stage 2'
      && afterNext.stageName === 'Cinder Span'
      && afterNext.crown === '5200'
      && afterNext.hearth === '36'
      && afterNext.winHidden === true;
  }

  report.items.stage1 = {
    pass: !!(firstWin && firstWin.winVisible) && retryOk && nextOk,
    clearSeconds: report.stage1ClearSeconds,
    winText,
    retry: afterRetry,
    retryOk,
    secondClearSeconds: secondWin ? Math.round((Date.now() - secondMark) / 10) / 100 : null,
    next: afterNext,
    nextOk,
  };
  console.log('ITEM stage1 ' + JSON.stringify(report.items.stage1));

  let loseEvidence = null;
  if (nextOk) {
    const stage2Mark = Date.now();
    await page.mouse.move(center, aimY);
    await page.mouse.down();
    lastAim = center;
    lastCount = null;
    prevGates = null;
    prevT = Date.now();
    let stage2Won = false;
    let stage2Steps = 0;
    const stage2Budget = Date.now() + 6 * 60 * 1000;
    while (Date.now() < stage2Budget) {
      stage2Steps += 1;
      const reading = await page.evaluate(OBSERVE_FN, { aimX: lastAim, lastCount, wide: false });
      if (reading.winVisible && reading.stage === 2) {
        stage2Won = true;
        break;
      }
      if (reading.loseVisible) {
        loseEvidence = { reached: true, stage: reading.stage, how: 'stage 2 lose while trying to clear' };
        break;
      }
      if (reading.count != null && reading.countScore >= 0.5) lastCount = reading.count;
      const now = Date.now();
      const gates = predictGates(reading.gates, prevGates, (now - prevT) / 1000, reading.stage || 2, reading.lane);
      prevGates = reading.gates;
      prevT = now;
      lastAim = chooseX(gates, reading.lane, 'clear');
      await page.mouse.move(lastAim, reading.aimY);
      if (stage2Steps % 12 === 0) {
        console.log('STAGE2 t=' + ((now - stage2Mark) / 1000).toFixed(1) + ' crown=' + reading.crown + ' hearth=' + reading.hearth + ' count=' + reading.count + ' gates=' + reading.gates.length);
      }
      await page.waitForTimeout(80);
    }
    await page.mouse.up();
    if (stage2Won && !loseEvidence) {
      await page.locator('[data-screen="win"] [data-action="next"]').click();
      await page.waitForFunction(() => document.body.dataset.phase === 'play' && document.body.dataset.stage === '3', null, { timeout: 5000 });
      const stage3 = await page.evaluate(() => ({
        kicker: document.getElementById('stage-kicker').textContent,
        stageName: document.getElementById('stage-name').textContent,
        crown: document.getElementById('enemy-hp').textContent,
        hearth: document.getElementById('player-hp').textContent,
      }));
      console.log('STAGE3 start ' + JSON.stringify(stage3));
      await page.mouse.move(stage3 ? center : center, aimY);
      await page.mouse.down();
      lastAim = center;
      lastCount = null;
      prevGates = null;
      prevT = Date.now();
      const loseMark = Date.now();
      const loseBudget = Date.now() + 4 * 60 * 1000;
      const hearthTrace = [];
      while (Date.now() < loseBudget) {
        const reading = await page.evaluate(OBSERVE_FN, { aimX: lastAim, lastCount, wide: false });
        hearthTrace.push({ t: Math.round((Date.now() - loseMark) / 100) / 10, hearth: reading.hearth, crown: reading.crown, phase: reading.phase });
        if (reading.loseVisible || reading.phase === 'lose') {
          loseEvidence = {
            reached: true,
            stage: 3,
            stageName: 'Crown Kiln',
            how: 'aimed off the multiply and add gates so the unmultiplied line lost the trade and raiders reached the hearth',
            hearthTrace: hearthTrace.filter((_, i) => i % 4 === 0).slice(-20),
            seconds: Math.round((Date.now() - loseMark) / 100) / 100,
          };
          break;
        }
        const now = Date.now();
        const gates = predictGates(reading.gates, prevGates, (now - prevT) / 1000, 3, reading.lane);
        prevGates = reading.gates;
        prevT = now;
        lastAim = chooseX(gates, reading.lane, 'lose');
        await page.mouse.move(lastAim, reading.aimY);
        if (hearthTrace.length % 10 === 0) {
          console.log('LOSE-TRY t=' + ((now - loseMark) / 1000).toFixed(1) + ' hearth=' + reading.hearth + ' crown=' + reading.crown + ' aim=' + Math.round(lastAim));
        }
        await page.waitForTimeout(90);
      }
      await page.mouse.up();
      if (!loseEvidence) {
        loseEvidence = { stage: 3, passHint: false, hearthTrace: hearthTrace.filter((_, i) => i % 3 === 0).slice(-30) };
      }
    } else if (!loseEvidence) {
      await page.screenshot({ path: path.join(SHOTS, 'failure-stage2.png') });
      loseEvidence = { passHint: false, reason: 'stage 2 was not cleared, so stage 3 was not reached; stage 1 hearth did not fall while the cannon kept firing' };
    }
  }

  let loseRetry = null;
  if (loseEvidence && loseEvidence.reached) {
    const heading = await page.locator('[data-screen="lose"] h2').innerText().catch(() => '');
    const copy = await page.locator('[data-screen="lose"] p').innerText().catch(() => '');
    await page.screenshot({ path: path.join(SHOTS, 'lose.png') });
    const before = await page.evaluate(() => ({
      stage: document.body.dataset.stage,
      kicker: document.getElementById('stage-kicker').textContent,
      stageName: document.getElementById('stage-name').textContent,
    }));
    await page.locator('[data-screen="lose"] [data-action="retry"]').click();
    await page.waitForFunction(() => document.body.dataset.phase === 'play', null, { timeout: 5000 });
    loseRetry = await page.evaluate(() => ({
      phase: document.body.dataset.phase,
      stage: document.body.dataset.stage,
      kicker: document.getElementById('stage-kicker').textContent,
      stageName: document.getElementById('stage-name').textContent,
      crown: document.getElementById('enemy-hp').textContent,
      hearth: document.getElementById('player-hp').textContent,
      loseHidden: document.querySelector('[data-screen="lose"]').hidden,
      hudHidden: document.getElementById('hud').hidden,
    }));
    const expect = before.stage === '3'
      ? { crown: '5600', hearth: '30', name: 'Crown Kiln', kicker: 'Stage 3' }
      : before.stage === '2'
        ? { crown: '5200', hearth: '36', name: 'Cinder Span', kicker: 'Stage 2' }
        : { crown: '3200', hearth: '46', name: 'Kindling Yard', kicker: 'Stage 1' };
    loseEvidence.screen = { heading, copy };
    loseEvidence.retry = loseRetry;
    loseEvidence.retryOk = loseRetry.phase === 'play'
      && loseRetry.stage === before.stage
      && loseRetry.kicker === expect.kicker
      && loseRetry.stageName === expect.name
      && loseRetry.crown === expect.crown
      && loseRetry.hearth === expect.hearth
      && loseRetry.loseHidden === true
      && loseRetry.hudHidden === false;
  } else if (!loseEvidence || loseEvidence.reason || loseEvidence.passHint === false) {
    await page.screenshot({ path: path.join(SHOTS, 'failure-lose.png') });
  }

  const losePass = !!(loseEvidence && loseEvidence.retryOk && loseEvidence.screen && loseEvidence.screen.heading);
  report.items.lose = losePass
    ? { pass: true, ...loseEvidence }
    : { pass: false, ...(loseEvidence || { reason: 'lose screen not reached' }) };

  report.items.console = { pass: errors.length === 0, errors: errors.slice() };
  report.errors = errors.slice();
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify(report, null, 2));

  console.log('ITEM lose ' + JSON.stringify(report.items.lose));
  console.log('ITEM console ' + JSON.stringify(report.items.console));
  console.log('STAGE1_CLEAR_SECONDS ' + report.stage1ClearSeconds);

  const failed = ['gate', 'collision', 'stage1', 'lose', 'console'].filter((k) => !report.items[k] || !report.items[k].pass);
  if (failed.length) {
    throw new Error('verification failures: ' + failed.join(', '));
  }
});
