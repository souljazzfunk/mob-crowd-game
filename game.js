'use strict';

/* Emberline — cannon column. Raiders march down in a dense crowd. */

(function () {
  var BUILD = 'emberline-2';
  var MAX_F = 640;
  var MAX_E = 960;
  var MAX_P = 480;
  var MAX_FL = 36;
  var MAX_GATES = 12;
  var STEP = 1 / 60;
  var FRAME_N = 120;
  var GW = 18;
  var GH = 28;
  var GMAX = 12;
  var HIT_X = 20;
  var HIT_Y = 20;
  var HIT_X2 = HIT_X * HIT_X;
  var HIT_Y2 = HIT_Y * HIT_Y;
  var HIT_LIM = HIT_X2 * HIT_Y2;
  var TAU = Math.PI * 2;
  var SPENT = '\u2014';
  var LABELS = ['', 'x2', 'x3', '+10', '+12', '+15', '+16', '+18', '-5', '-8', '-10', '-12'];

  var STAGES = [
    {
      name: 'Kindling Yard',
      enemyMax: 3200,
      playerMax: 46,
      fireEvery: 0.082,
      friendlyV: 0.33,
      enemyV: 0.08,
      colsWant: 8,
      openRows: 10,
      gapFrac: 0.044,
      topFrac: 0.115,
      frontLimit: 0.40,
      gates: [
        { nx: 0.04, ny: 0.58, nw: 0.36, nh: 0.074, op: 'mul', v: 2, nvx: 0.042, rate: 28 },
        { nx: 0.58, ny: 0.58, nw: 0.36, nh: 0.074, op: 'add', v: 10, nvx: -0.038 },
        { nx: 0.06, ny: 0.40, nw: 0.32, nh: 0.074, op: 'mul', v: 2, nvx: 0.055, rate: 16 },
        { nx: 0.52, ny: 0.40, nw: 0.40, nh: 0.074, op: 'sub', v: 5, nvx: -0.05 },
        { nx: 0.20, ny: 0.23, nw: 0.52, nh: 0.074, op: 'add', v: 15, nvx: 0.032 }
      ]
    },
    {
      name: 'Cinder Span',
      enemyMax: 5200,
      playerMax: 36,
      fireEvery: 0.078,
      friendlyV: 0.35,
      enemyV: 0.095,
      colsWant: 13,
      openRows: 11,
      gapFrac: 0.04,
      topFrac: 0.11,
      frontLimit: 0.42,
      gates: [
        { nx: 0.03, ny: 0.60, nw: 0.30, nh: 0.07, op: 'mul', v: 2, nvx: 0.08, rate: 26 },
        { nx: 0.38, ny: 0.60, nw: 0.26, nh: 0.07, op: 'sub', v: 8, nvx: -0.07 },
        { nx: 0.68, ny: 0.60, nw: 0.28, nh: 0.07, op: 'add', v: 12, nvx: 0.06 },
        { nx: 0.05, ny: 0.42, nw: 0.26, nh: 0.07, op: 'mul', v: 3, nvx: 0.09, rate: 18 },
        { nx: 0.42, ny: 0.42, nw: 0.50, nh: 0.07, op: 'sub', v: 10, nvx: -0.08 },
        { nx: 0.18, ny: 0.24, nw: 0.30, nh: 0.07, op: 'mul', v: 2, nvx: -0.07, rate: 20 },
        { nx: 0.58, ny: 0.24, nw: 0.32, nh: 0.07, op: 'add', v: 18, nvx: 0.055 }
      ]
    },
    {
      name: 'Crown Kiln',
      enemyMax: 5600,
      playerMax: 30,
      fireEvery: 0.074,
      friendlyV: 0.37,
      enemyV: 0.11,
      colsWant: 14,
      openRows: 12,
      gapFrac: 0.038,
      topFrac: 0.105,
      frontLimit: 0.44,
      gates: [
        { nx: 0.02, ny: 0.62, nw: 0.24, nh: 0.066, op: 'mul', v: 2, nvx: 0.11, rate: 30 },
        { nx: 0.30, ny: 0.62, nw: 0.34, nh: 0.066, op: 'sub', v: 12, nvx: -0.09 },
        { nx: 0.70, ny: 0.62, nw: 0.26, nh: 0.066, op: 'add', v: 16, nvx: 0.1 },
        { nx: 0.04, ny: 0.46, nw: 0.22, nh: 0.066, op: 'mul', v: 3, nvx: -0.12, rate: 14 },
        { nx: 0.34, ny: 0.46, nw: 0.30, nh: 0.066, op: 'sub', v: 8, nvx: 0.1 },
        { nx: 0.70, ny: 0.46, nw: 0.26, nh: 0.066, op: 'mul', v: 2, nvx: 0.08, rate: 18 },
        { nx: 0.12, ny: 0.28, nw: 0.30, nh: 0.066, op: 'sub', v: 10, nvx: 0.13 },
        { nx: 0.50, ny: 0.28, nw: 0.28, nh: 0.066, op: 'mul', v: 2, nvx: -0.11, rate: 22 }
      ]
    }
  ];

  var params = new URLSearchParams(location.search);
  var DEBUG = params.get('debug') === '1';
  var simSpeed = 1;
  var botEnabled = false;
  var stageParam = 1;
  var autostart = false;
  if (DEBUG) {
    var spd = parseFloat(params.get('speed') || '1');
    if (spd > 1) simSpeed = spd > 40 ? 40 : spd;
    botEnabled = params.get('bot') === '1';
    autostart = params.get('autostart') === '1';
    var sp = parseInt(params.get('stage') || '1', 10);
    if (sp >= 1 && sp <= STAGES.length) stageParam = sp;
  }

  var canvas = document.getElementById('view');
  var ctx = canvas.getContext('2d', { alpha: false });
  var overlayEl = document.getElementById('overlay');
  var hudEl = document.getElementById('hud');
  var stageKickerEl = document.getElementById('stage-kicker');
  var stageNameEl = document.getElementById('stage-name');
  var enemyHpEl = document.getElementById('enemy-hp');
  var enemyBarEl = document.getElementById('enemy-bar');
  var playerHpEl = document.getElementById('player-hp');
  var screenEls = overlayEl.querySelectorAll('[data-screen]');
  var winKickerEl = document.getElementById('win-kicker');
  var winCopyEl = document.getElementById('win-copy');
  var safeProbe = document.getElementById('safe-probe');

  var cssW = 1;
  var cssH = 1;
  var dpr = 1;
  var lane = { x: 0, y: 0, w: 1, h: 1 };
  var bgGrad = null;
  var glowGrad = null;
  var laneGrad = null;
  var gateFont = '700 20px Georgia, serif';
  var countFont = '700 48px Georgia, serif';
  var hintFont = '600 16px Georgia, serif';
  var floatFont = '700 18px Georgia, serif';

  var phase = 'title';
  var stageIndex = 0;
  var stage = STAGES[0];
  var enemyHp = 0;
  var enemyMax = 1;
  var playerHp = 0;
  var playerMax = 1;
  var simTime = 0;
  var fireCd = 0;
  var waveCd = 0;
  var waveSerial = 0;
  var spawnSerial = 0;
  var cannonNX = 0.5;
  var targetNX = 0.5;
  var hintT = 0;
  var shake = 0;
  var hurtFlash = 0;
  var muzzle = 0;
  var pendingEnd = '';
  var gateHits = 0;
  var spawnedTotal = 0;
  var frameId = 1;
  var trackOp = '';
  var trackVal = 0;
  var idleT = 0;
  var sndT = 0;
  var baseBlipT = 0;
  var dragging = false;
  var activePointer = -1;
  var keysLeft = false;
  var keysRight = false;
  var marchCols = 10;
  var enemyPeak = 0;

  var hudCount = -1;
  var hudEnemy = -1;
  var hudPlayer = -1;
  var countText = '0';

  var effect = { op: '', value: 0, before: 0, after: 0, seq: 0 };
  var latch = { op: '', value: 0, before: 0, after: 0 };
  var latched = false;

  var fpsValue = 0;
  var frameMsValue = 0;
  var worstMs = 0;
  var lastSlowFrames = 0;
  var sampleMinF = 0;
  var sampleMinE = 0;
  var sampling = false;
  var frameSamples = new Float64Array(FRAME_N);
  var frameSampleI = 0;
  var frameSampleCount = 0;

  var cellCount = new Uint16Array(GW * GH);
  var cellIds = new Uint16Array(GW * GH * GMAX);

  var audioCtx = null;
  var audioOk = false;

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function labelId(op, v) {
    var s = op === 'mul' ? 'x' + v : op === 'add' ? '+' + v : '-' + v;
    for (var i = 1; i < LABELS.length; i++) {
      if (LABELS[i] === s) return i;
    }
    return 0;
  }

  function makePool(n) {
    var free = new Uint16Array(n);
    for (var i = 0; i < n; i++) free[i] = i;
    return {
      cap: n,
      alive: new Uint8Array(n),
      dying: new Uint8Array(n),
      x: new Float32Array(n),
      y: new Float32Array(n),
      py: new Float32Array(n),
      vx: new Float32Array(n),
      vy: new Float32Array(n),
      r: new Float32Array(n),
      v: new Float32Array(n),
      life: new Float32Array(n),
      max: new Float32Array(n),
      size: new Float32Array(n),
      gates: new Uint32Array(n),
      born: new Uint32Array(n),
      slot: new Uint16Array(n),
      color: new Uint8Array(n),
      kind: new Uint8Array(n),
      text: new Uint8Array(n),
      order: new Uint16Array(n),
      free: free,
      freeCount: n,
      aliveCount: 0
    };
  }

  var friendly = makePool(MAX_F);
  var enemy = makePool(MAX_E);
  var particles = makePool(MAX_P);
  var floaters = makePool(MAX_FL);

  var gates = new Array(MAX_GATES);
  var gateCount = 0;
  for (var gi = 0; gi < MAX_GATES; gi++) {
    gates[gi] = {
      nx: 0, ny: 0, nw: 0.2, nh: 0.07, nvx: 0,
      gx: 0, gy: 0, gw: 10, gh: 10,
      op: 'mul', v: 2, rate: 0, tokens: 0, tokenMax: 0,
      left: 0, active: false, bit: 1, flash: 0, flashCd: 0,
      label: 'x2', labelId: 1
    };
  }

  var DUST_N = 40;
  var dustX = new Float32Array(DUST_N);
  var dustY = new Float32Array(DUST_N);
  var dustV = new Float32Array(DUST_N);
  var dustR = new Float32Array(DUST_N);
  var dustVX = new Float32Array(DUST_N);
  for (var di = 0; di < DUST_N; di++) {
    dustX[di] = (di * 97) % 300;
    dustY[di] = (di * 53) % 600;
    dustV[di] = 16 + (di % 6) * 7;
    dustR[di] = 1 + (di % 3);
    dustVX[di] = ((di % 7) - 3) * 3;
  }

  function resetPool(pool) {
    pool.aliveCount = 0;
    pool.freeCount = 0;
    var n = pool.cap;
    var alive = pool.alive;
    var dying = pool.dying;
    var free = pool.free;
    for (var i = 0; i < n; i++) {
      alive[i] = 0;
      dying[i] = 0;
      free[pool.freeCount++] = i;
    }
  }

  function acquire(pool) {
    if (pool.freeCount <= 0) return -1;
    pool.freeCount -= 1;
    var i = pool.free[pool.freeCount];
    pool.alive[i] = 1;
    pool.dying[i] = 0;
    pool.order[pool.aliveCount] = i;
    pool.aliveCount += 1;
    return i;
  }

  function killIndex(pool, i) {
    if (!pool.alive[i] || pool.dying[i]) return;
    pool.dying[i] = 1;
  }

  function sweep(pool) {
    var order = pool.order;
    var dying = pool.dying;
    var alive = pool.alive;
    var free = pool.free;
    var k = 0;
    var n = pool.aliveCount;
    while (k < n) {
      var i = order[k];
      if (dying[i]) {
        dying[i] = 0;
        alive[i] = 0;
        n -= 1;
        order[k] = order[n];
        free[pool.freeCount++] = i;
      } else {
        k += 1;
      }
    }
    pool.aliveCount = n;
  }

  function readSafe() {
    var cs = getComputedStyle(safeProbe);
    return {
      t: parseFloat(cs.paddingTop) || 0,
      r: parseFloat(cs.paddingRight) || 0,
      b: parseFloat(cs.paddingBottom) || 0,
      l: parseFloat(cs.paddingLeft) || 0
    };
  }

  function layoutDust() {
    for (var i = 0; i < DUST_N; i++) {
      dustX[i] = (i * 97) % Math.max(1, cssW);
      dustY[i] = (i * 53) % Math.max(1, cssH);
    }
  }

  function resize() {
    var vv = window.visualViewport;
    var w = vv ? vv.width : window.innerWidth;
    var h = vv ? vv.height : window.innerHeight;
    if (w < 2) w = 2;
    if (h < 2) h = 2;
    cssW = w;
    cssH = h;
    dpr = window.devicePixelRatio || 1;
    if (dpr < 1) dpr = 1;
    if (dpr > 3) dpr = 3;
    var offL = vv ? vv.offsetLeft : 0;
    var offT = vv ? vv.offsetTop : 0;
    canvas.style.left = offL + 'px';
    canvas.style.top = offT + 'px';
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    var safe = readSafe();
    var top = safe.t + 64;
    var bottom = safe.b + 16;
    var left = safe.l + 10;
    var right = safe.r + 10;
    var availW = cssW - left - right;
    var availH = cssH - top - bottom;
    if (availW < 80) availW = 80;
    if (availH < 160) availH = 160;
    var maxW = availH * (9 / 16);
    var lw = availW < maxW ? availW : maxW;
    lane.w = lw;
    lane.h = availH;
    lane.x = left + (availW - lw) * 0.5;
    lane.y = top;

    var family = 'Georgia, "Liberation Serif", "Times New Roman", serif';
    gateFont = '700 ' + Math.round(clamp(lane.w * 0.078, 16, 32)) + 'px ' + family;
    countFont = '700 ' + Math.round(clamp(lane.w * 0.16, 34, 72)) + 'px ' + family;
    hintFont = '600 ' + Math.round(clamp(lane.w * 0.045, 13, 18)) + 'px ' + family;
    floatFont = '700 ' + Math.round(clamp(lane.w * 0.055, 15, 26)) + 'px ' + family;

    bgGrad = ctx.createLinearGradient(0, 0, 0, cssH);
    bgGrad.addColorStop(0, '#3a1848');
    bgGrad.addColorStop(0.45, '#1a1022');
    bgGrad.addColorStop(1, '#100a12');
    var cx = cssW * 0.5;
    glowGrad = ctx.createRadialGradient(cx, cssH, 16, cx, cssH, Math.max(cssH * 0.72, 180));
    glowGrad.addColorStop(0, 'rgba(255, 120, 40, 0.38)');
    glowGrad.addColorStop(0.42, 'rgba(255, 90, 30, 0.08)');
    glowGrad.addColorStop(1, 'rgba(255, 90, 30, 0)');
    laneGrad = ctx.createLinearGradient(0, lane.y, 0, lane.y + lane.h);
    laneGrad.addColorStop(0, '#2a1636');
    laneGrad.addColorStop(0.55, '#3a1c30');
    laneGrad.addColorStop(1, '#4a2618');
    layoutDust();
    syncGates();
  }

  function cannonX() {
    return lane.x + cannonNX * lane.w;
  }

  function cannonY() {
    return lane.y + lane.h - 36;
  }

  function baseY() {
    return lane.y + lane.h * 0.112;
  }

  function computeCols(want) {
    var margin = 14;
    var minSpacing = 46;
    var fit = Math.floor((lane.w - margin * 2) / minSpacing);
    if (fit < 7) fit = 7;
    if (want < 7) want = 7;
    if (want > fit) want = fit;
    if (want > 14) want = 14;
    return want;
  }

  function columnSpacing() {
    return (lane.w - 28) / marchCols;
  }

  function enemyRadius() {
    var rad = columnSpacing() * 0.4;
    if (rad < 18) rad = 18;
    if (rad > 24) rad = 24;
    return rad;
  }

  function marchX(slot) {
    var spacing = columnSpacing();
    return lane.x + 14 + (slot + 0.5) * spacing;
  }

  function showScreen(name) {
    phase = name;
    var any = false;
    for (var i = 0; i < screenEls.length; i++) {
      var on = screenEls[i].getAttribute('data-screen') === name;
      screenEls[i].hidden = !on;
      if (on) any = true;
    }
    overlayEl.hidden = name === 'play' || !any;
    hudEl.hidden = name !== 'play';
    document.body.dataset.phase = phase;
    document.body.dataset.stage = String(stageIndex + 1);
  }

  function loadGates(def) {
    gateCount = def.gates.length;
    if (gateCount > MAX_GATES) gateCount = MAX_GATES;
    for (var i = 0; i < gateCount; i++) {
      var src = def.gates[i];
      var g = gates[i];
      g.nx = src.nx;
      g.ny = src.ny;
      g.nw = src.nw;
      g.nh = src.nh;
      g.nvx = src.nvx;
      g.op = src.op;
      g.v = src.v;
      g.rate = src.rate || 0;
      g.tokenMax = g.rate * 1.15;
      g.tokens = g.tokenMax;
      g.left = src.op === 'mul' ? 1000000 : src.v;
      g.active = true;
      g.bit = 1 << i;
      g.flash = 0;
      g.flashCd = 0;
      g.labelId = labelId(src.op, src.v);
      g.label = LABELS[g.labelId] || (src.op === 'mul' ? 'x' + src.v : src.op === 'add' ? '+' + src.v : '-' + src.v);
    }
    syncGates();
  }

  function syncGates() {
    for (var i = 0; i < gateCount; i++) {
      var g = gates[i];
      g.gx = lane.x + g.nx * lane.w;
      g.gy = lane.y + g.ny * lane.h;
      g.gw = g.nw * lane.w;
      g.gh = g.nh * lane.h;
    }
  }

  function moveGates(dt) {
    for (var i = 0; i < gateCount; i++) {
      var g = gates[i];
      g.nx += g.nvx * dt;
      if (g.nx < 0.015) {
        g.nx = 0.015;
        g.nvx = Math.abs(g.nvx);
      } else if (g.nx + g.nw > 0.985) {
        g.nx = 0.985 - g.nw;
        g.nvx = -Math.abs(g.nvx);
      }
      if (g.op === 'mul') {
        g.tokens += g.rate * dt;
        if (g.tokens > g.tokenMax) g.tokens = g.tokenMax;
      }
      if (g.flash > 0) g.flash -= dt * 2.2;
      if (g.flashCd > 0) g.flashCd -= dt;
    }
    syncGates();
  }

  function startStage(index) {
    if (index < 0) index = 0;
    if (index >= STAGES.length) index = 0;
    stageIndex = index;
    stage = STAGES[index];
    resetPool(friendly);
    resetPool(enemy);
    resetPool(particles);
    resetPool(floaters);
    loadGates(stage);
    enemyMax = stage.enemyMax;
    enemyHp = enemyMax;
    playerMax = stage.playerMax;
    playerHp = playerMax;
    simTime = 0;
    fireCd = 0.12;
    waveCd = 0.4;
    waveSerial = 0;
    spawnSerial = 0;
    cannonNX = 0.5;
    targetNX = 0.5;
    hintT = index === 0 ? 2.2 : 1.1;
    shake = 0;
    hurtFlash = 0;
    muzzle = 0;
    pendingEnd = '';
    gateHits = 0;
    spawnedTotal = 0;
    trackOp = '';
    trackVal = 0;
    enemyPeak = 0;
    effect.op = '';
    effect.value = 0;
    effect.before = 0;
    effect.after = 0;
    effect.seq = 0;
    latch.op = '';
    latch.value = 0;
    latch.before = 0;
    latch.after = 0;
    latched = false;
    hudCount = -1;
    hudEnemy = -1;
    hudPlayer = -1;
    marchCols = computeCols(stage.colsWant);
    spawnOpening();
    showScreen('play');
    stageKickerEl.textContent = 'Stage ' + (index + 1);
    stageNameEl.textContent = stage.name;
    updateHud(true);
  }

  function updateHud(force) {
    var alive = friendly.aliveCount;
    if (force || alive !== hudCount) {
      hudCount = alive;
      countText = String(alive);
    }
    if (force || enemyHp !== hudEnemy) {
      hudEnemy = enemyHp;
      enemyHpEl.textContent = String(enemyHp);
      var pct = enemyMax <= 0 ? 0 : Math.round((enemyHp / enemyMax) * 100);
      enemyBarEl.style.width = pct + '%';
    }
    if (force || playerHp !== hudPlayer) {
      hudPlayer = playerHp;
      playerHpEl.textContent = String(playerHp);
    }
  }

  function noteEffect(op, value, before, after) {
    effect.op = op;
    effect.value = value;
    effect.before = before;
    effect.after = after;
    effect.seq += 1;
    gateHits += 1;
    if (!latched && after > before) {
      latch.op = op;
      latch.value = value;
      latch.before = before;
      latch.after = after;
      latched = true;
    }
  }

  function spawnFriendly(x, y, gatesHit) {
    var i = acquire(friendly);
    if (i < 0) return -1;
    var minX = lane.x + 6;
    var maxX = lane.x + lane.w - 6;
    if (x < minX) x = minX;
    else if (x > maxX) x = maxX;
    if (y < lane.y + 4) y = lane.y + 4;
    friendly.x[i] = x;
    friendly.y[i] = y;
    friendly.py[i] = y;
    friendly.vx[i] = ((spawnSerial % 5) - 2) * 4;
    friendly.r[i] = 4.6;
    friendly.gates[i] = gatesHit || 0;
    friendly.born[i] = frameId;
    spawnSerial += 1;
    spawnedTotal += 1;
    return i;
  }

  function spawnEnemy(slot, y, v) {
    var i = acquire(enemy);
    if (i < 0) return -1;
    if (slot < 0) slot = 0;
    if (slot >= marchCols) slot = marchCols - 1;
    enemy.slot[i] = slot;
    enemy.y[i] = y;
    enemy.v[i] = v;
    enemy.r[i] = enemyRadius();
    enemy.x[i] = marchX(slot);
    enemy.born[i] = frameId;
    if (enemy.aliveCount > enemyPeak) enemyPeak = enemy.aliveCount;
    return i;
  }

  function spawnRow(y) {
    var v = stage.enemyV;
    var n = marchCols;
    for (var col = 0; col < n; col++) spawnEnemy(col, y, v);
    waveSerial += n;
  }

  function spawnOpening() {
    var gap = lane.h * stage.gapFrac;
    if (gap < 28) gap = 28;
    var top = lane.y + lane.h * stage.topFrac;
    var limit = lane.y + lane.h * stage.frontLimit;
    var y = top;
    var guard = 0;
    var rows = stage.openRows;
    while (y <= limit && guard < rows) {
      spawnRow(y);
      y += gap;
      guard += 1;
    }
    var speed = stage.enemyV * lane.h;
    if (speed < 1) speed = 1;
    waveCd = gap / speed;
  }

  function burst(x, y, n, color) {
    if (simSpeed > 1.05) n = 1;
    if (particles.aliveCount > 90) n = n > 1 ? 1 : n;
    if (particles.aliveCount > 160) return;
    for (var k = 0; k < n; k++) {
      var i = acquire(particles);
      if (i < 0) return;
      var a = (k / n) * TAU;
      var sp = 36 + (k % 4) * 22;
      particles.x[i] = x;
      particles.y[i] = y;
      particles.vx[i] = Math.cos(a) * sp;
      particles.vy[i] = Math.sin(a) * sp;
      particles.life[i] = 0.32;
      particles.max[i] = 0.32;
      particles.color[i] = color;
      particles.size[i] = 2 + (k % 3);
    }
  }

  function spawnFloater(x, y, textId, kind) {
    if (simSpeed > 1.05) return;
    var i = acquire(floaters);
    if (i < 0) return;
    floaters.x[i] = x;
    floaters.y[i] = y;
    floaters.text[i] = textId;
    floaters.kind[i] = kind;
    floaters.life[i] = 0.7;
    floaters.max[i] = 0.7;
  }

  function unlockAudio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(function () {}, function () {});
      }
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      audioCtx = new AC();
      audioOk = true;
    } catch (err) {
      audioOk = false;
    }
  }

  function blip(freq, dur, type, vol) {
    if (!audioOk || !audioCtx || simSpeed > 1.05) return;
    if (sndT > 0 && type !== 'triangle') return;
    try {
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = type;
      o.frequency.value = freq;
      var t = audioCtx.currentTime;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t);
      o.stop(t + dur);
      if (sndT <= 0) sndT = 0.045;
    } catch (err) {}
  }

  function applyMul(i, g) {
    var hit = friendly.gates[i] | g.bit;
    friendly.gates[i] = hit;
    var need = g.v - 1;
    if (need > 0 && g.tokens >= 1) {
      var can = g.tokens < need ? (g.tokens | 0) : need;
      if (can > 0) {
        var before = friendly.aliveCount;
        g.tokens -= can;
        var mid = (can - 1) * 0.5;
        var spawned = 0;
        var ux = friendly.x[i];
        var uy = friendly.y[i];
        for (var k = 0; k < can; k++) {
          var s = spawnFriendly(ux + (k - mid) * 8, uy - (k + 1) * 9, hit);
          if (s >= 0) {
            friendly.vx[s] = (k - mid) * 10;
            spawned += 1;
          }
        }
        if (spawned > 0) noteEffect('mul', g.v, before, before + spawned);
      }
    }
    g.flash = 1;
    if (g.flashCd <= 0) {
      spawnFloater(friendly.x[i], g.gy, g.labelId, 0);
      g.flashCd = 0.16;
      blip(540, 0.04, 'square', 0.02);
    }
  }

  function applyAdd(i, g) {
    friendly.gates[i] = friendly.gates[i] | g.bit;
    var before = friendly.aliveCount;
    var n = g.v;
    var spawned = 0;
    var hit = friendly.gates[i];
    for (var k = 0; k < n; k++) {
      var x = g.gx + ((k + 0.5) / n) * g.gw;
      var s = spawnFriendly(x, g.gy - 8, hit);
      if (s >= 0) spawned += 1;
    }
    g.left = 0;
    g.active = false;
    g.flash = 1;
    if (g.flashCd <= 0) {
      spawnFloater(g.gx + g.gw * 0.5, g.gy, g.labelId, 1);
      g.flashCd = 0.2;
      blip(680, 0.07, 'square', 0.03);
    }
    noteEffect('add', g.v, before, before + spawned);
  }

  function applySub(i, g) {
    friendly.gates[i] = friendly.gates[i] | g.bit;
    var before = friendly.aliveCount;
    killIndex(friendly, i);
    g.left -= 1;
    if (g.left <= 0) g.active = false;
    g.flash = 1;
    if (g.flashCd <= 0) {
      spawnFloater(friendly.x[i], friendly.y[i], g.labelId, 2);
      g.flashCd = 0.14;
      blip(170, 0.05, 'sawtooth', 0.02);
    }
    noteEffect('sub', g.v, before, before - 1);
  }

  function applyGates(i) {
    var x = friendly.x[i];
    var y = friendly.y[i];
    var py = friendly.py[i];
    var bits = friendly.gates[i];
    for (var gi2 = 0; gi2 < gateCount; gi2++) {
      var g = gates[gi2];
      if (!g.active) continue;
      if ((bits & g.bit) !== 0) continue;
      if (x < g.gx || x > g.gx + g.gw) continue;
      var top = g.gy;
      var bot = g.gy + g.gh;
      if (py < top) continue;
      if (y > bot) continue;
      if (g.op === 'mul') applyMul(i, g);
      else if (g.op === 'add') applyAdd(i, g);
      else applySub(i, g);
      if (friendly.dying[i]) return;
      bits = friendly.gates[i];
    }
  }

  function gateNxAt(g, delay) {
    var nx = g.nx;
    var nvx = g.nvx;
    var left = delay;
    var guard = 0;
    while (left > 0 && guard++ < 6) {
      var limit = nvx > 0 ? (0.985 - g.nw - nx) / nvx : nvx < 0 ? (0.015 - nx) / nvx : 999;
      if (limit < 0) limit = 0;
      if (limit >= left || nvx === 0) {
        nx += nvx * left;
        break;
      }
      nx += nvx * limit;
      left -= limit;
      nvx = -nvx;
    }
    if (nx < 0.015) nx = 0.015;
    if (nx + g.nw > 0.985) nx = 0.985 - g.nw;
    return nx;
  }

  function botAim(dt) {
    var bestScore = -1e9;
    var bestNX = cannonNX;
    var spawnFrac = 1 - 70 / Math.max(lane.h, 1);
    for (var i = 0; i < 21; i++) {
      var nx = (i + 0.5) / 21;
      var mul = 1;
      var add = 0;
      var sub = 0;
      for (var gi2 = 0; gi2 < gateCount; gi2++) {
        var g = gates[gi2];
        if (!g.active) continue;
        var dist = spawnFrac - (g.ny + g.nh * 0.5);
        if (dist < 0) dist = 0;
        var delay = dist / stage.friendlyV;
        var pred = gateNxAt(g, delay);
        if (nx < pred || nx > pred + g.nw) continue;
        if (g.op === 'mul') mul *= g.v;
        else if (g.op === 'add') add += g.v;
        else sub += g.v;
      }
      var prefer = Math.abs(nx - cannonNX) < 0.03 ? 8 : 0;
      var score = mul * 100 + add * 1.4 - sub * 40 + prefer;
      if (score > bestScore) {
        bestScore = score;
        bestNX = nx;
      }
    }
    var maxStep = 2.6 * dt;
    var d = bestNX - cannonNX;
    if (d > maxStep) cannonNX += maxStep;
    else if (d < -maxStep) cannonNX -= maxStep;
    else cannonNX = bestNX;
    targetNX = cannonNX;
  }

  function trackAim() {
    var found = null;
    for (var i = 0; i < gateCount; i++) {
      var g = gates[i];
      if (!g.active || g.op !== trackOp) continue;
      if (trackVal && g.v !== trackVal) continue;
      if (!found || g.ny > found.ny) found = g;
    }
    if (!found) return;
    var nx = (found.gx + found.gw * 0.5 - lane.x) / lane.w;
    cannonNX = clamp(nx, 0.05, 0.95);
    targetNX = cannonNX;
  }

  function fireCannon(dt) {
    fireCd -= dt;
    if (friendly.aliveCount >= 500) {
      if (fireCd < 0) fireCd = 0;
      return;
    }
    var guard = 0;
    var cy = cannonY();
    var cx = cannonX();
    while (fireCd <= 0 && guard < 3) {
      var j = ((spawnSerial % 5) - 2) * 3.5;
      spawnFriendly(cx + j, cy - 28, 0);
      fireCd += stage.fireEvery;
      guard += 1;
      muzzle = 1;
    }
    if (guard === 3 && fireCd < 0) fireCd = 0;
  }

  function updateWaves(dt) {
    waveCd -= dt;
    if (waveCd > 0) return;
    var gap = lane.h * stage.gapFrac;
    if (gap < 28) gap = 28;
    var speed = stage.enemyV * lane.h;
    if (speed < 1) speed = 1;
    var every = gap / speed;
    waveCd += every;
    if (waveCd < 0) waveCd = 0;
    spawnRow(lane.y + lane.h * stage.topFrac);
  }

  function moveFriendlies(dt) {
    var speed = stage.friendlyV * lane.h;
    var order = friendly.order;
    var n = friendly.aliveCount;
    var minX = lane.x + 5;
    var maxX = lane.x + lane.w - 5;
    var by = baseY();
    var xs = friendly.x;
    var ys = friendly.y;
    var pys = friendly.py;
    var vxs = friendly.vx;
    var born = friendly.born;
    var dying = friendly.dying;
    var alive = friendly.alive;
    for (var k = 0; k < n; k++) {
      var i = order[k];
      if (!alive[i] || dying[i] || born[i] === frameId) continue;
      pys[i] = ys[i];
      xs[i] += vxs[i] * dt;
      ys[i] -= speed * dt;
      vxs[i] *= 0.985;
      if (xs[i] < minX) xs[i] = minX;
      else if (xs[i] > maxX) xs[i] = maxX;
      applyGates(i);
      if (dying[i] || !alive[i]) continue;
      if (ys[i] <= by) {
        killIndex(friendly, i);
        if (enemyHp > 0) enemyHp -= 1;
        if (enemyHp < 0) enemyHp = 0;
        if (baseBlipT <= 0) {
          baseBlipT = 0.12;
          blip(880, 0.03, 'square', 0.015);
        }
        if ((spawnSerial + i) % 4 === 0) burst(xs[i], by + 4, 2, 3);
        if (enemyHp <= 0) pendingEnd = 'win';
      }
    }
  }

  function moveEnemies(dt) {
    var order = enemy.order;
    var n = enemy.aliveCount;
    var ys = enemy.y;
    var vs = enemy.v;
    var born = enemy.born;
    var dying = enemy.dying;
    var alive = enemy.alive;
    var lh = lane.h;
    var killY = cannonY() + 10;
    var rad = enemyRadius();
    for (var k = 0; k < n; k++) {
      var i = order[k];
      if (!alive[i] || dying[i] || born[i] === frameId) continue;
      ys[i] += vs[i] * lh * dt;
      enemy.r[i] = rad;
      enemy.x[i] = marchX(enemy.slot[i]);
      if (ys[i] >= killY) {
        killIndex(enemy, i);
        playerHp -= 1;
        if (playerHp < 0) playerHp = 0;
        shake = 8;
        hurtFlash = 0.18;
        blip(120, 0.08, 'sawtooth', 0.03);
        burst(enemy.x[i], killY - 8, 3, 2);
        if (playerHp <= 0 && pendingEnd !== 'win') pendingEnd = 'lose';
      }
    }
    if (enemy.aliveCount > enemyPeak) enemyPeak = enemy.aliveCount;
  }

  function collideAll() {
    if (lane.w < 8 || lane.h < 8) return;
    cellCount.fill(0);
    var x0 = lane.x;
    var y0 = lane.y;
    var cw = lane.w / GW;
    var ch = lane.h / GH;
    var eOrder = enemy.order;
    var nE = enemy.aliveCount;
    var ex = enemy.x;
    var ey = enemy.y;
    var eAlive = enemy.alive;
    var eDying = enemy.dying;
    for (var ei = 0; ei < nE; ei++) {
      var id = eOrder[ei];
      if (!eAlive[id] || eDying[id]) continue;
      var cx = (ex[id] - x0) / cw;
      var cy = (ey[id] - y0) / ch;
      if (cx < 0) cx = 0;
      else if (cx >= GW) cx = GW - 1;
      else cx = cx | 0;
      if (cy < 0) cy = 0;
      else if (cy >= GH) cy = GH - 1;
      else cy = cy | 0;
      var cell = cy * GW + cx;
      var cn0 = cellCount[cell];
      if (cn0 < GMAX) {
        cellIds[cell * GMAX + cn0] = id;
        cellCount[cell] = cn0 + 1;
      }
    }
    var fOrder = friendly.order;
    var nF = friendly.aliveCount;
    var fx = friendly.x;
    var fy = friendly.y;
    var fAlive = friendly.alive;
    var fDying = friendly.dying;
    var fBorn = friendly.born;
    for (var fk = 0; fk < nF; fk++) {
      var fi = fOrder[fk];
      if (!fAlive[fi] || fDying[fi] || fBorn[fi] === frameId) continue;
      var ux = (fx[fi] - x0) / cw;
      var uy = (fy[fi] - y0) / ch;
      if (ux < 0) ux = 0;
      else if (ux >= GW) ux = GW - 1;
      else ux = ux | 0;
      if (uy < 0) uy = 0;
      else if (uy >= GH) uy = GH - 1;
      else uy = uy | 0;
      var hit = false;
      var px = fx[fi];
      var py = fy[fi];
      for (var oy = -1; oy <= 1 && !hit; oy++) {
        var yy = uy + oy;
        if (yy < 0 || yy >= GH) continue;
        for (var ox = -1; ox <= 1 && !hit; ox++) {
          var xx = ux + ox;
          if (xx < 0 || xx >= GW) continue;
          var cidx = yy * GW + xx;
          var cn = cellCount[cidx];
          var base = cidx * GMAX;
          for (var k = 0; k < cn; k++) {
            var foe = cellIds[base + k];
            if (!eAlive[foe] || eDying[foe]) continue;
            var dx = px - ex[foe];
            var dy = py - ey[foe];
            if (dx * dx * HIT_Y2 + dy * dy * HIT_X2 <= HIT_LIM) {
              killIndex(friendly, fi);
              killIndex(enemy, foe);
              burst((px + ex[foe]) * 0.5, (py + ey[foe]) * 0.5, 2, 2);
              hit = true;
              break;
            }
          }
        }
      }
    }
  }

  function updateParticles(dt) {
    var order = particles.order;
    var n = particles.aliveCount;
    var life = particles.life;
    var xs = particles.x;
    var ys = particles.y;
    var vxs = particles.vx;
    var vys = particles.vy;
    for (var k = 0; k < n; k++) {
      var i = order[k];
      life[i] -= dt;
      if (life[i] <= 0) {
        particles.dying[i] = 1;
        continue;
      }
      xs[i] += vxs[i] * dt;
      ys[i] += vys[i] * dt;
      vys[i] += 40 * dt;
    }
    sweep(particles);
  }

  function updateFloaters(dt) {
    var order = floaters.order;
    var n = floaters.aliveCount;
    var life = floaters.life;
    var ys = floaters.y;
    for (var k = 0; k < n; k++) {
      var i = order[k];
      life[i] -= dt;
      if (life[i] <= 0) {
        floaters.dying[i] = 1;
        continue;
      }
      ys[i] -= 36 * dt;
    }
    sweep(floaters);
  }

  function updateDust(dt) {
    for (var i = 0; i < DUST_N; i++) {
      dustY[i] -= dustV[i] * dt;
      dustX[i] += dustVX[i] * dt;
      if (dustY[i] < -8) {
        dustY[i] = cssH + 6;
        dustX[i] = (i * 97 + dustY[i]) % Math.max(1, cssW);
      }
      if (dustX[i] < -8) dustX[i] = cssW + 4;
      else if (dustX[i] > cssW + 8) dustX[i] = -4;
    }
  }

  function finish(kind) {
    if (phase !== 'play') return;
    pendingEnd = '';
    trackOp = '';
    if (kind === 'win') {
      winKickerEl.textContent = 'Stage ' + (stageIndex + 1) + ' clear';
      winCopyEl.textContent = stage.name + ' goes quiet.';
      showScreen('win');
      burst(lane.x + lane.w * 0.5, baseY(), 16, 3);
      blip(523, 0.12, 'triangle', 0.05);
      blip(784, 0.2, 'triangle', 0.04);
    } else {
      showScreen('lose');
      blip(110, 0.28, 'sawtooth', 0.04);
    }
  }

  function update(dt) {
    frameId += 1;
    if (frameId > 1e9) frameId = 1;
    simTime += dt;
    if (sndT > 0) sndT -= dt;
    if (baseBlipT > 0) baseBlipT -= dt;
    if (muzzle > 0) {
      muzzle -= dt * 5.5;
      if (muzzle < 0) muzzle = 0;
    }
    if (hurtFlash > 0) hurtFlash -= dt;
    if (shake > 0) shake *= 0.86;
    if (hintT > 0) hintT -= dt;

    moveGates(dt);
    if (botEnabled) botAim(dt);
    else if (trackOp) trackAim();
    else {
      if (keysLeft) targetNX -= 0.7 * dt;
      if (keysRight) targetNX += 0.7 * dt;
      targetNX = clamp(targetNX, 0.04, 0.96);
      var k = dt * 22;
      if (k > 1) k = 1;
      cannonNX += (targetNX - cannonNX) * k;
    }
    cannonNX = clamp(cannonNX, 0.04, 0.96);

    fireCannon(dt);
    updateWaves(dt);
    moveFriendlies(dt);
    moveEnemies(dt);
    collideAll();
    sweep(friendly);
    sweep(enemy);
    updateParticles(dt);
    updateFloaters(dt);
    updateHud(false);
    if (pendingEnd === 'win' || enemyHp <= 0) finish('win');
    else if (pendingEnd === 'lose' || playerHp <= 0) finish('lose');
  }

  function roundRect(x, y, w, h, r) {
    var rr = r;
    if (rr > w * 0.5) rr = w * 0.5;
    if (rr > h * 0.5) rr = h * 0.5;
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawBackground() {
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, cssW, cssH);
    var right = lane.x + lane.w;
    ctx.fillStyle = '#120910';
    if (lane.x > 1) ctx.fillRect(0, 0, lane.x, cssH);
    if (right < cssW - 1) ctx.fillRect(right, 0, cssW - right, cssH);
    ctx.fillStyle = '#3c2a34';
    var x1 = lane.x - 14;
    var x2 = right + 8;
    ctx.beginPath();
    for (var i = 0; i < 9; i++) {
      var y = lane.y + (i + 0.45) * lane.h / 9;
      if (x1 > 6) {
        ctx.moveTo(x1 + 3.5, y);
        ctx.arc(x1, y, 3.5, 0, TAU);
      }
      if (x2 < cssW - 6) {
        ctx.moveTo(x2 + 3.5, y);
        ctx.arc(x2, y, 3.5, 0, TAU);
      }
    }
    ctx.fill();
  }

  function drawLane() {
    roundRect(lane.x, lane.y, lane.w, lane.h, 18);
    ctx.fillStyle = laneGrad;
    ctx.fill();
    ctx.save();
    roundRect(lane.x, lane.y, lane.w, lane.h, 18);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 220, 190, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    var yb = lane.y + 18;
    var yEnd = lane.y + lane.h;
    while (yb < yEnd) {
      ctx.moveTo(lane.x + 8, yb);
      ctx.lineTo(lane.x + lane.w - 8, yb);
      yb += 34;
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#6a3d58';
    ctx.lineWidth = 2;
    roundRect(lane.x + 1, lane.y + 1, lane.w - 2, lane.h - 2, 17);
    ctx.stroke();
  }

  function drawCrown() {
    var x = lane.x;
    var y = lane.y + 4;
    var w = lane.w;
    var h = lane.h * 0.09;
    ctx.fillStyle = '#3a2448';
    ctx.beginPath();
    ctx.moveTo(x + 8, y + h);
    ctx.lineTo(x + 8, y + h * 0.48);
    ctx.lineTo(x + w * 0.18, y + h * 0.75);
    ctx.lineTo(x + w * 0.28, y + h * 0.22);
    ctx.lineTo(x + w * 0.4, y + h * 0.68);
    ctx.lineTo(x + w * 0.5, y);
    ctx.lineTo(x + w * 0.6, y + h * 0.68);
    ctx.lineTo(x + w * 0.72, y + h * 0.22);
    ctx.lineTo(x + w * 0.82, y + h * 0.75);
    ctx.lineTo(x + w - 8, y + h * 0.48);
    ctx.lineTo(x + w - 8, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#f0c15a';
    ctx.lineWidth = 2;
    ctx.stroke();
    var frac = enemyMax > 0 ? enemyHp / enemyMax : 0;
    if (frac < 0) frac = 0;
    var r = 7 + frac * 12;
    var cx = x + w * 0.5;
    var cy = y + h * 0.62;
    ctx.fillStyle = '#ff5d6c';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffd5da';
    ctx.beginPath();
    ctx.arc(cx - r * 0.2, cy - r * 0.2, r * 0.38, 0, TAU);
    ctx.fill();
  }

  function drawGates() {
    ctx.font = gateFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 2;
    for (var i = 0; i < gateCount; i++) {
      var g = gates[i];
      var spent = !g.active;
      var fill = '#f0c15a';
      var ink = '#3a2508';
      if (g.op === 'add') {
        fill = '#b6e38a';
        ink = '#173216';
      } else if (g.op === 'sub') {
        fill = '#f07180';
        ink = '#3d121c';
      }
      ctx.globalAlpha = spent ? 0.3 : (g.flash > 0 ? 1 : 0.94);
      roundRect(g.gx, g.gy, g.gw, g.gh, 10);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.globalAlpha = spent ? 0.25 : 0.7;
      ctx.strokeStyle = '#fff6e8';
      roundRect(g.gx + 3, g.gy + 3, g.gw - 6, g.gh - 6, 8);
      ctx.stroke();
      ctx.globalAlpha = spent ? 0.55 : 1;
      ctx.fillStyle = ink;
      ctx.fillText(spent ? SPENT : g.label, g.gx + g.gw * 0.5, g.gy + g.gh * 0.5 + 1);
    }
    ctx.globalAlpha = 1;
  }

  function drawUnits() {
    var fOrder = friendly.order;
    var nF = friendly.aliveCount;
    var fAlive = friendly.alive;
    var fxs = friendly.x;
    var fys = friendly.y;
    var fr = friendly.r;
    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath();
    for (var i = 0; i < nF; i++) {
      var fi = fOrder[i];
      if (!fAlive[fi]) continue;
      var r = fr[fi];
      ctx.moveTo(fxs[fi] + r, fys[fi]);
      ctx.arc(fxs[fi], fys[fi], r, 0, TAU);
    }
    ctx.fill();

    var eOrder = enemy.order;
    var nE = enemy.aliveCount;
    var eAlive = enemy.alive;
    var exs = enemy.x;
    var eys = enemy.y;
    var ers = enemy.r;
    ctx.fillStyle = '#021614';
    ctx.beginPath();
    for (var a = 0; a < nE; a++) {
      var ea = eOrder[a];
      if (!eAlive[ea]) continue;
      var ro = ers[ea] + 2.6;
      ctx.moveTo(exs[ea] + ro, eys[ea]);
      ctx.arc(exs[ea], eys[ea], ro, 0, TAU);
    }
    ctx.fill();
    ctx.fillStyle = '#00F6DE';
    ctx.beginPath();
    for (var b = 0; b < nE; b++) {
      var eb = eOrder[b];
      if (!eAlive[eb]) continue;
      var rb = ers[eb];
      ctx.moveTo(exs[eb] + rb, eys[eb]);
      ctx.arc(exs[eb], eys[eb], rb, 0, TAU);
    }
    ctx.fill();
    ctx.fillStyle = '#064840';
    ctx.beginPath();
    for (var c = 0; c < nE; c++) {
      var ec = eOrder[c];
      if (!eAlive[ec]) continue;
      var rc = ers[ec];
      var xc = exs[ec];
      var yc = eys[ec];
      ctx.moveTo(xc - rc * 0.42, yc - rc * 0.08);
      ctx.lineTo(xc + rc * 0.42, yc - rc * 0.08);
      ctx.lineTo(xc, yc + rc * 0.58);
      ctx.closePath();
    }
    ctx.fill();
    ctx.fillStyle = '#F4FFFD';
    ctx.beginPath();
    for (var d = 0; d < nE; d++) {
      var ed = eOrder[d];
      if (!eAlive[ed]) continue;
      var rd = ers[ed] * 0.28;
      ctx.moveTo(exs[ed] + rd, eys[ed] - ers[ed] * 0.22);
      ctx.arc(exs[ed], eys[ed] - ers[ed] * 0.22, rd, 0, TAU);
    }
    ctx.fill();
  }

  function drawParticles() {
    var cols = ['#ffb15a', '#fff1cf', '#7ef0e4', '#ff8b96', '#f0c15a'];
    var order = particles.order;
    var n = particles.aliveCount;
    var alive = particles.alive;
    var color = particles.color;
    var xs = particles.x;
    var ys = particles.y;
    var size = particles.size;
    for (var c = 0; c < cols.length; c++) {
      ctx.fillStyle = cols[c];
      ctx.beginPath();
      var any = false;
      for (var i = 0; i < n; i++) {
        var p = order[i];
        if (!alive[p] || color[p] !== c) continue;
        any = true;
        var s = size[p];
        ctx.rect(xs[p], ys[p], s, s);
      }
      if (any) ctx.fill();
    }
  }

  function drawFloaters() {
    var cols = ['#f0c15a', '#d8ffb0', '#ffd0d6'];
    ctx.font = floatFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var order = floaters.order;
    var n = floaters.aliveCount;
    var alive = floaters.alive;
    for (var k = 0; k < n; k++) {
      var i = order[k];
      if (!alive[i]) continue;
      var life = floaters.life[i];
      var max = floaters.max[i];
      ctx.globalAlpha = max > 0 ? life / max : 1;
      var kind = floaters.kind[i];
      ctx.fillStyle = cols[kind] || cols[0];
      var label = LABELS[floaters.text[i]] || '';
      ctx.fillText(label, floaters.x[i], floaters.y[i]);
    }
    ctx.globalAlpha = 1;
  }

  function drawCannon(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(255, 140, 50, 0.22)';
    ctx.beginPath();
    ctx.ellipse(0, 18, 36, 12, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#4a2c22';
    ctx.beginPath();
    ctx.arc(-16, 14, 8, 0, TAU);
    ctx.arc(16, 14, 8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#e7c089';
    ctx.beginPath();
    ctx.arc(-16, 14, 3, 0, TAU);
    ctx.arc(16, 14, 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#8d4b28';
    ctx.fillRect(-18, 2, 36, 12);
    ctx.fillStyle = '#e0a15a';
    ctx.fillRect(-14, 4, 28, 5);
    ctx.fillStyle = '#6e3c2a';
    ctx.fillRect(-7, -28, 14, 34);
    ctx.fillStyle = '#f0c48a';
    ctx.fillRect(-5, -24, 4, 26);
    ctx.fillStyle = '#f6e0bf';
    ctx.fillRect(-9, -32, 18, 6);
    ctx.fillStyle = muzzle > 0.05 ? '#fff4d2' : '#ffb15a';
    ctx.beginPath();
    ctx.arc(0, -32, 3.2 + muzzle * 3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawCount(x, y) {
    ctx.font = countFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(18, 8, 16, 0.72)';
    ctx.strokeText(countText, x, y);
    ctx.fillStyle = '#fff4e4';
    ctx.fillText(countText, x, y);
  }

  function drawAim(x) {
    ctx.strokeStyle = 'rgba(255, 190, 120, 0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, cannonY() - 36);
    ctx.lineTo(x, baseY() + 8);
    ctx.stroke();
  }

  function render() {
    var sx = 0;
    var sy = 0;
    if (shake > 0.4 && phase === 'play') {
      sx = ((shake * 13) % 5) - 2;
      sy = ((shake * 9) % 4) - 1.5;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground();
    ctx.save();
    ctx.translate(sx, sy);
    drawLane();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#ffb15a';
    ctx.beginPath();
    for (var i = 0; i < DUST_N; i++) {
      ctx.rect(dustX[i], dustY[i], dustR[i], dustR[i]);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    drawCrown();
    var aimX = cannonX();
    if (phase !== 'play') {
      aimX = lane.x + lane.w * (0.5 + Math.sin(idleT * 0.8) * 0.12);
    }
    if (phase === 'play') drawAim(aimX);
    drawGates();
    drawUnits();
    drawParticles();
    drawCannon(aimX, cannonY());
    if (phase === 'play') {
      drawCount(aimX, cannonY() - 58);
      if (stageIndex === 0 && hintT > 0) {
        ctx.globalAlpha = hintT > 1 ? 1 : hintT;
        ctx.font = hintFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff4e4';
        ctx.fillText('drag sideways', aimX, cannonY() - 96);
        ctx.globalAlpha = 1;
      }
    }
    drawFloaters();
    ctx.restore();
    if (hurtFlash > 0 && phase === 'play') {
      ctx.fillStyle = 'rgba(255, 70, 80, 0.16)';
      ctx.fillRect(0, 0, cssW, cssH);
    }
  }

  function noteFrame(ms) {
    frameSamples[frameSampleI] = ms;
    frameSampleI += 1;
    if (frameSampleI >= FRAME_N) frameSampleI = 0;
    if (frameSampleCount < FRAME_N) frameSampleCount += 1;
    var sum = 0;
    var worst = 0;
    var slowFrames = 0;
    for (var i = 0; i < frameSampleCount; i++) {
      var v = frameSamples[i];
      sum += v;
      if (v > worst) worst = v;
      if (v > 20) slowFrames += 1;
    }
    frameMsValue = frameSampleCount ? sum / frameSampleCount : 0;
    worstMs = worst;
    fpsValue = frameMsValue > 0 ? 1000 / frameMsValue : 0;
    lastSlowFrames = slowFrames;
    if (sampling) {
      if (friendly.aliveCount < sampleMinF) sampleMinF = friendly.aliveCount;
      if (enemy.aliveCount < sampleMinE) sampleMinE = enemy.aliveCount;
    }
  }

  function aimFromClientX(clientX) {
    var rect = canvas.getBoundingClientRect();
    var x = clientX - rect.left;
    var nx = (x - lane.x) / lane.w;
    targetNX = clamp(nx, 0.04, 0.96);
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    var t = e.target;
    if (t && t.closest && t.closest('button, a, input')) return;
    if (phase !== 'play') return;
    dragging = true;
    activePointer = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    aimFromClientX(e.clientX);
    unlockAudio();
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging || e.pointerId !== activePointer) return;
    aimFromClientX(e.clientX);
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (e.pointerId !== activePointer) return;
    dragging = false;
    activePointer = -1;
  }

  function bindInput() {
    window.addEventListener('pointerdown', onPointerDown, { passive: false });
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    overlayEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button') : null;
      if (!btn) return;
      unlockAudio();
      var action = btn.getAttribute('data-action');
      if (action === 'start') startStage(0);
      else if (action === 'retry') startStage(stageIndex);
      else if (action === 'next') {
        if (stageIndex >= STAGES.length - 1) showScreen('clear');
        else startStage(stageIndex + 1);
      } else if (action === 'loop') startStage(0);
    });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        keysLeft = true;
        e.preventDefault();
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        keysRight = true;
        e.preventDefault();
      } else if (e.key === 'Enter' && phase === 'title') {
        unlockAudio();
        startStage(0);
      }
    });
    window.addEventListener('keyup', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keysLeft = false;
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keysRight = false;
    });
    document.addEventListener('touchmove', function (e) {
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturechange', function (e) { e.preventDefault(); }, { passive: false });
    var lastTouchEnd = 0;
    document.addEventListener('touchend', function (e) {
      var now = performance.now();
      if (now - lastTouchEnd < 280) e.preventDefault();
      lastTouchEnd = now;
    }, { passive: false });
    window.addEventListener('wheel', function (e) {
      if (e.ctrlKey) e.preventDefault();
    }, { passive: false });
    window.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('selectstart', function (e) { e.preventDefault(); });
    window.addEventListener('resize', resize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', resize);
      window.visualViewport.addEventListener('scroll', resize);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') resize();
    });
  }

  function fillCrowd(nF, nE) {
    var fTarget = nF > MAX_F ? MAX_F : nF;
    var guard = 0;
    while (friendly.aliveCount < fTarget && guard < MAX_F) {
      var col = guard % 16;
      var row = (guard / 16) | 0;
      var x = lane.x + ((col + 0.5) / 16) * lane.w;
      var y = lane.y + lane.h * (0.62 + (row % 7) * 0.03);
      var u = spawnFriendly(x, y, 0xffff);
      if (u < 0) break;
      friendly.born[u] = frameId > 0 ? frameId - 1 : 0;
      friendly.vx[u] = 0;
      friendly.gates[u] = 0xffff;
      guard += 1;
    }
    var eTarget = nE > MAX_E ? MAX_E : nE;
    var j = 0;
    while (enemy.aliveCount < eTarget && j < MAX_E) {
      var colE = j % marchCols;
      var rowE = (j / marchCols) | 0;
      var ey = lane.y + lane.h * (0.16 + (rowE % 8) * 0.04);
      var e = spawnEnemy(colE, ey, stage.enemyV);
      if (e < 0) break;
      enemy.born[e] = frameId > 0 ? frameId - 1 : 0;
      j += 1;
    }
  }

  function installDebug() {
    window.__EMBERLINE__ = {
      build: BUILD,
      get phase() { return phase; },
      get stage() { return stageIndex + 1; },
      get stageName() { return stage ? stage.name : ''; },
      get friendlyAlive() { return friendly.aliveCount; },
      get enemyAlive() { return enemy.aliveCount; },
      get enemyPeak() { return enemyPeak; },
      get enemyHp() { return enemyHp; },
      get playerHp() { return playerHp; },
      get cannonX() { return cannonX(); },
      get cannonNX() { return cannonNX; },
      get gateHits() { return gateHits; },
      get simTime() { return simTime; },
      get spawnedTotal() { return spawnedTotal; },
      get fps() { return fpsValue; },
      get frameMs() { return frameMsValue; },
      get worstMs() { return worstMs; },
      get lastGateEffect() { return effect; },
      gateProof: function () { return latched ? latch : null; },
      restart: function () { startStage(stageIndex); },
      setCannonX: function (px) {
        var nx = (px - lane.x) / lane.w;
        targetNX = clamp(nx, 0.04, 0.96);
        cannonNX = targetNX;
      },
      setCannonNorm: function (n) {
        targetNX = clamp(n, 0.04, 0.96);
        cannonNX = targetNX;
      },
      trackGate: function (op, value) {
        trackOp = op || '';
        trackVal = value || 0;
      },
      clearTrack: function () {
        trackOp = '';
        trackVal = 0;
      },
      setBot: function (on) { botEnabled = !!on; },
      forceWin: function () {
        if (phase !== 'play') return;
        enemyHp = 0;
        finish('win');
      },
      forceLose: function () {
        if (phase !== 'play') return;
        playerHp = 0;
        finish('lose');
      },
      fillCrowd: function (nF, nE) { fillCrowd(nF || 360, nE || 100); },
      armSample: function () {
        sampling = true;
        sampleMinF = friendly.aliveCount;
        sampleMinE = enemy.aliveCount;
        frameSampleCount = 0;
        frameSampleI = 0;
        worstMs = 0;
      },
      sample: function () {
        sampling = false;
        return {
          fps: fpsValue,
          frameMs: frameMsValue,
          worstMs: worstMs,
          slowFrames: lastSlowFrames,
          minFriendly: sampleMinF,
          minEnemy: sampleMinE,
          friendly: friendly.aliveCount,
          enemy: enemy.aliveCount,
          frames: frameSampleCount
        };
      },
      gates: function () {
        var out = [];
        for (var i = 0; i < gateCount; i++) {
          var g = gates[i];
          out.push({
            op: g.op,
            v: g.v,
            x: g.gx,
            y: g.gy,
            w: g.gw,
            h: g.gh,
            active: g.active,
            label: g.label
          });
        }
        return out;
      }
    };
  }

  var lastNow = 0;
  var acc = 0;
  var rafOn = false;

  function frame(now) {
    if (!rafOn) {
      rafOn = true;
      lastNow = now;
      render();
      requestAnimationFrame(frame);
      return;
    }
    var ms = now - lastNow;
    lastNow = now;
    if (ms < 0) ms = 0;
    if (ms > 250) ms = 250;
    noteFrame(ms);
    var dt = ms / 1000;
    idleT += dt;
    updateDust(dt);
    if (phase === 'play') {
      acc += dt * simSpeed;
      var steps = 0;
      var cap = simSpeed > 1 ? Math.min(90, Math.ceil(simSpeed) + 2) : 5;
      while (acc >= STEP && steps < cap && phase === 'play') {
        update(STEP);
        acc -= STEP;
        steps += 1;
      }
      if (steps === cap && acc > STEP) acc = 0;
    } else {
      moveGates(dt * 0.35);
      updateParticles(dt);
      updateFloaters(dt);
    }
    render();
    requestAnimationFrame(frame);
  }

  resize();
  loadGates(STAGES[0]);
  bindInput();
  if (DEBUG) installDebug();
  if (DEBUG && autostart) startStage(stageParam - 1);
  else showScreen('title');
  requestAnimationFrame(frame);
})();
