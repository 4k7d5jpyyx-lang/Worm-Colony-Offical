(() => {
  "use strict";

  // ---------- On-screen debug ----------
  const dbg = document.createElement("div");
  dbg.style.cssText = `
    position:fixed; left:10px; top:10px; z-index:999999;
    padding:8px 10px; border-radius:12px;
    background:rgba(0,0,0,.55); border:1px solid rgba(255,255,255,.18);
    color:rgba(235,240,248,.92); font:600 12px/1.2 system-ui, -apple-system, Inter, sans-serif;
    backdrop-filter: blur(10px);
    max-width: 78vw;
  `;
  dbg.textContent = "JS LOADED ✓";
  document.body.appendChild(dbg);

  function showErr(e) {
    dbg.textContent = "JS ERROR ✕ " + (e?.message || e);
    dbg.style.background = "rgba(120,0,20,.55)";
    console.error(e);
  }
  window.addEventListener("error", (ev) => showErr(ev.error || ev.message));
  window.addEventListener("unhandledrejection", (ev) => showErr(ev.reason));

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => "$" + Math.max(0, Math.round(n)).toLocaleString();

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };

  const fin = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
  const finPos = (v) => fin(v, 0);
  const finScale = (v) => fin(v, 1);
  const finRadius = (v) => (Number.isFinite(v) && v > 0 ? v : 1);
  const finLine = (v) => (Number.isFinite(v) && v > 0 ? v : 1);

  // ---------- DOM ----------
  const canvas = $("simCanvas") || $("c");
  if (!canvas) return showErr("Canvas not found (expected #simCanvas).");
  canvas.style.touchAction = "none"; // IMPORTANT: stop iOS scroll/gesture conflicts

  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return showErr("Canvas context failed.");

  const elBuyers = $("buyers");
  const elVolume = $("volume");
  const elMcap = $("mcap");
  const elColonies = $("colonies");
  const elWorms = $("worms");
  const logEl = $("log");

  const elSelName  = $("selName");
  const elSelDNA   = $("selDNA");
  const elSelBiome = $("selBiome");
  const elSelStyle = $("selStyle");

  function setSelectedUI(c, index) {
    if (!c) return;
    if (elSelName)  elSelName.textContent  = `Colony #${index + 1}`;
    if (elSelDNA)   elSelDNA.textContent   = `${c.dna.temperament}`;
    if (elSelBiome) elSelBiome.textContent = `${c.dna.biome}`;
    if (elSelStyle) elSelStyle.textContent = `${c.dna.style}`;
  }

  // ---------- Log ----------
  const LOG_CAP = 45;
  let lastLog = { msg: "", t: 0, count: 0 };
  function log(msg, kind = "INFO") {
    if (!logEl) return;
    const now = Date.now();
    if (msg === lastLog.msg && now - lastLog.t < 1300) {
      lastLog.count++;
      const top = logEl.firstChild;
      if (top) top.textContent = `${kind}: ${msg} (x${lastLog.count})`;
      lastLog.t = now;
      return;
    }
    lastLog = { msg, t: now, count: 1 };
    const d = document.createElement("div");
    d.textContent = `${kind}: ${msg}`;
    logEl.prepend(d);
    while (logEl.children.length > LOG_CAP) logEl.removeChild(logEl.lastChild);
  }

  // ---------- Canvas sizing ----------
  let W = 1, H = 1, DPR = 1;
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;

    if (!Number.isFinite(cssW) || !Number.isFinite(cssH) || cssW < 2 || cssH < 2) {
      requestAnimationFrame(resizeCanvas);
      return;
    }

    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.max(1, cssW);
    H = Math.max(1, cssH);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 180));
  setTimeout(resizeCanvas, 0);

  // ---------- Economy ----------
  let buyers = 0, volume = 0, mcap = 0;

  const MAX_COLONIES = 8;
  const MC_STEP = 50000;
  let nextSplitAt = MC_STEP;
  let bossSpawned = false;

  function growthScore() {
    return (mcap / 20000) + (volume / 6000) + (buyers / 10);
  }

  // ---------- Camera + interaction ----------
  let camX = 0, camY = 0, zoom = 0.78;
  let dragging = false;
  let selected = 0;
  let focusOn = false;
  let isInteracting = false;

  // tap detection
  let downX = 0, downY = 0, lastX = 0, lastY = 0, downT = 0;
  const TAP_MOVE_PX = 10;   // <= 10px movement counts as tap
  const TAP_TIME_MS = 330;  // <= 330ms counts as tap

  function toWorld(px, py) {
    const z = finScale(zoom);
    return {
      x: (px - W / 2) / z - finPos(camX),
      y: (py - H / 2) / z - finPos(camY)
    };
  }

  function pickColony(wx, wy) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];
      const d = dist2(wx, wy, c.x, c.y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return (best !== -1 && bestD < 260 * 260) ? best : -1;
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    dragging = true;
    isInteracting = true;
    downX = lastX = e.clientX;
    downY = lastY = e.clientY;
    downT = performance.now();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;

    const z = finScale(zoom);
    camX = finPos(camX) + dx / z;
    camY = finPos(camY) + dy / z;
  });

  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    isInteracting = false;

    const upT = performance.now();
    const move = Math.hypot(e.clientX - downX, e.clientY - downY);

    // ONLY select on real taps (prevents drag from blocking selection)
    if (move <= TAP_MOVE_PX && (upT - downT) <= TAP_TIME_MS) {
      const w = toWorld(e.clientX, e.clientY);
      const idx = pickColony(w.x, w.y);
      if (idx !== -1) {
        selected = idx;
        setSelectedUI(colonies[selected], selected);
        log(`Selected Colony #${idx + 1}`, "INFO");
        if (focusOn) centerOnSelected(true);
      }
    }
  });

  canvas.addEventListener("pointercancel", () => {
    dragging = false;
    isInteracting = false;
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    isInteracting = true;
    const k = e.deltaY > 0 ? 0.92 : 1.08;
    zoom = clamp(finScale(zoom) * k, 0.55, 2.6);
    clearTimeout(canvas.__wheelTO);
    canvas.__wheelTO = setTimeout(() => (isInteracting = false), 120);
  }, { passive: false });

  function centerOnSelected(snap = true) {
    const c = colonies[selected];
    if (!c) return;
    if (snap) {
      camX = -c.x;
      camY = -c.y;
    } else {
      camX = lerp(finPos(camX), -c.x, 0.18);
      camY = lerp(finPos(camY), -c.y, 0.18);
    }
  }

  // ---------- Colony / worm models ----------
  function newColony(x, y, hue = rand(0, 360)) {
    const dna = {
      hue,
      chaos: rand(0.55, 1.35),
      drift: rand(0.55, 1.35),
      aura: rand(0.9, 1.6),
      limbiness: rand(0.25, 1.1),
      temperament: ["CALM", "AGGRESSIVE", "CHAOTIC", "TOXIC"][randi(0, 3)],
      biome: ["NEON GARDEN", "DEEP SEA", "VOID BLOOM", "GLASS CAVE", "ARC STORM"][randi(0, 4)],
      style: ["COMET", "CROWN", "ARC", "SPIRAL", "DRIFT"][randi(0, 4)]
    };

    const nodes = Array.from({ length: randi(4, 7) }, () => ({
      ox: rand(-70, 70),
      oy: rand(-70, 70),
      r: rand(50, 110),
      ph: rand(0, Math.PI * 2),
      sp: rand(0.4, 1.2)
    }));

    return { x, y, vx: rand(-0.18, 0.18), vy: rand(-0.18, 0.18), dna, nodes, worms: [], shock: [] };
  }

  function newWorm(col, big = false) {
    const type = ["DRIFTER", "ORBITER", "HUNTER"][randi(0, 2)];
    const segCount = big ? randi(18, 28) : randi(10, 18);
    const baseLen = big ? rand(10, 16) : rand(7, 12);
    const hue = (col.dna.hue + rand(-140, 140) + 360) % 360;

    const w = {
      id: Math.random().toString(16).slice(2, 6),
      type,
      hue,
      width: big ? rand(7, 11) : rand(4.2, 7),
      speed: big ? rand(0.38, 0.75) : rand(0.5, 1.05),
      turn: rand(0.008, 0.02) * col.dna.chaos,
      phase: rand(0, Math.PI * 2),
      limbs: [],
      segs: [],
      isBoss: false
    };

    let px = col.x + rand(-55, 55);
    let py = col.y + rand(-55, 55);
    let ang = rand(0, Math.PI * 2);

    for (let i = 0; i < segCount; i++) {
      w.segs.push({ x: px, y: py, a: ang, len: baseLen * rand(0.85, 1.22) });
      px -= Math.cos(ang) * baseLen;
      py -= Math.sin(ang) * baseLen;
      ang += rand(-0.3, 0.3) * col.dna.chaos;
    }
    return w;
  }

  const colonies = [newColony(0, 0, 150)];
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], true));
  setSelectedUI(colonies[0], 0);

  function zoomOutToFitAll() {
    if (!Number.isFinite(W) || !Number.isFinite(H) || W < 2 || H < 2) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const pad = 520;

    for (const c of colonies) {
      minX = Math.min(minX, c.x - pad);
      minY = Math.min(minY, c.y - pad);
      maxX = Math.max(maxX, c.x + pad);
      maxY = Math.max(maxY, c.y + pad);
    }

    const bw = Math.max(240, maxX - minX);
    const bh = Math.max(240, maxY - minY);

    const fit = Math.min(W / bw, H / bh);
    zoom = clamp(finScale(fit) * 0.92, 0.55, 1.6);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    camX = -cx;
    camY = -cy;
  }

  // ---------- Background (stars + galaxies + grid) ----------
  const STAR_COUNT = 520;
  const stars = Array.from({ length: STAR_COUNT }, () => ({
    x: rand(-2400, 2400),
    y: rand(-2400, 2400),
    r: rand(0.35, 1.4),
    a: rand(0.15, 0.9),
    tw: rand(0.6, 1.6),
    ph: rand(0, Math.PI * 2)
  }));

  const galaxies = [
    { x: -900, y: -550, r: 520, hue: 285, a: 0.12 },
    { x:  980, y:  620, r: 640, hue: 205, a: 0.10 },
    { x:  240, y: -980, r: 460, hue: 120, a: 0.08 }
  ];

  function drawSpaceBG(time) {
    const t = time * 0.001;

    // galaxies
    for (const g0 of galaxies) {
      const gx = g0.x + Math.sin(t * 0.15 + g0.hue) * 30;
      const gy = g0.y + Math.cos(t * 0.12 + g0.hue) * 30;
      const rr = g0.r;

      const grd = ctx.createRadialGradient(gx, gy, 0, gx, gy, rr);
      grd.addColorStop(0, `hsla(${g0.hue}, 95%, 65%, ${g0.a})`);
      grd.addColorStop(0.35, `hsla(${(g0.hue + 40) % 360}, 95%, 55%, ${g0.a * 0.65})`);
      grd.addColorStop(1, `hsla(${g0.hue}, 95%, 60%, 0)`);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(gx, gy, rr, 0, Math.PI * 2);
      ctx.fill();
    }

    // stars
    ctx.globalCompositeOperation = "lighter";
    for (const s of stars) {
      const tw = 0.65 + 0.35 * Math.sin(t * s.tw + s.ph);
      const a = clamp(s.a * tw, 0.06, 0.95);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    // --- FIXED GRID (no shimmer/glitch) ---
    // Use world bounds from toWorld() so it stays stable.
    const z = finScale(zoom);
    const TL = toWorld(0, 0);
    const BR = toWorld(W, H);

    const left = Math.min(TL.x, BR.x);
    const right = Math.max(TL.x, BR.x);
    const top = Math.min(TL.y, BR.y);
    const bottom = Math.max(TL.y, BR.y);

    const grid = 240;
    let startX = Math.floor(left / grid) * grid;
    let endX = Math.floor(right / grid) * grid;
    let startY = Math.floor(top / grid) * grid;
    let endY = Math.floor(bottom / grid) * grid;

    // keep grid lines 1px on screen regardless of zoom
    ctx.lineWidth = 1 / z;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";

    // snap to pixel grid to prevent shimmering:
    const snap = (v) => (Math.round(v * z) + 0.5) / z;

    ctx.beginPath();
    for (let x = startX; x <= endX; x += grid) {
      const sx = snap(x);
      ctx.moveTo(sx, startY);
      ctx.lineTo(sx, endY);
    }
    for (let y = startY; y <= endY; y += grid) {
      const sy = snap(y);
      ctx.moveTo(startX, sy);
      ctx.lineTo(endX, sy);
    }
    ctx.stroke();
  }

  // ---------- Rendering helpers ----------
  function aura(x, y, r, hue, a) {
    x = finPos(x); y = finPos(y);
    r = finRadius(r);
    hue = fin(hue, 200);
    a = clamp(fin(a, 0.1), 0, 1);

    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue},95%,65%,${a})`);
    g.addColorStop(1, `hsla(${hue},95%,65%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function irregularBlob(col, time) {
    const baseHue = col.dna.hue;

    if (!isInteracting) {
      for (let i = 0; i < col.nodes.length; i++) {
        const n = col.nodes[i];
        const x = col.x + n.ox + Math.sin(time * 0.001 * n.sp + n.ph) * 10;
        const y = col.y + n.oy + Math.cos(time * 0.001 * n.sp + n.ph) * 10;
        aura(x, y, n.r * 1.15, (baseHue + i * 18) % 360, 0.18);
        aura(x, y, n.r * 0.78, (baseHue + i * 22 + 40) % 360, 0.12);
      }
      aura(col.x, col.y, 155 * col.dna.aura, baseHue, 0.18);
      aura(col.x, col.y, 115 * col.dna.aura, (baseHue + 35) % 360, 0.10);
    } else {
      aura(col.x, col.y, 145 * col.dna.aura, baseHue, 0.12);
    }

    const R = 135;
    ctx.strokeStyle = `hsla(${baseHue}, 90%, 65%, .26)`;
    ctx.lineWidth = 1.6 / finScale(zoom);
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.001; a += Math.PI / 20) {
      const wob =
        Math.sin(a * 3 + time * 0.0015) * 10 +
        Math.sin(a * 7 - time * 0.0011) * 6;
      const rr = R + wob * col.dna.chaos;
      const px = col.x + Math.cos(a) * rr;
      const py = col.y + Math.sin(a) * rr;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  function drawWorm(w, time) {
    const pts = w.segs;
    if (!pts || pts.length < 2) return;

    const lw = finLine(w.width);

    if (!isInteracting) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `hsla(${w.hue}, 92%, 62%, ${w.isBoss ? 0.26 : 0.14})`;
      ctx.lineWidth = finLine(lw + (w.isBoss ? 8 : 6));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(finPos(pts[0].x), finPos(pts[0].y));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(finPos(pts[i].x), finPos(pts[i].y));
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = `hsla(${w.hue}, 95%, 65%, ${w.isBoss ? 0.98 : 0.9})`;
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(finPos(pts[0].x), finPos(pts[0].y));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(finPos(pts[i].x), finPos(pts[i].y));
    ctx.stroke();
  }

  // ---------- Worm behavior ----------
  function wormBehavior(col, w, time) {
    const head = w.segs[0];
    const jitter = Math.sin(time * 0.002 + w.phase) * 0.12;
    head.a += (Math.random() - 0.5) * w.turn + jitter;

    const dx = col.x - head.x;
    const dy = col.y - head.y;
    const toward = Math.atan2(dy, dx);

    const dir = Math.sin(w.phase) >= 0 ? 1 : -1;

    if (w.type === "DRIFTER") {
      head.a = head.a * 0.90 + toward * 0.10 + dir * 0.02;
    } else if (w.type === "ORBITER") {
      const orbit = toward + dir * (0.95 + 0.25 * Math.sin(time * 0.001 + w.phase));
      head.a = head.a * 0.86 + orbit * 0.14;
    } else {
      const bite = toward + dir * 0.25 + Math.sin(time * 0.003 + w.phase) * 0.35;
      head.a = head.a * 0.82 + bite * 0.18;
    }

    head.x += Math.cos(head.a) * w.speed * 2.2;
    head.y += Math.sin(head.a) * w.speed * 2.2;

    const d = Math.hypot(head.x - col.x, head.y - col.y);
    if (d > 280) {
      head.a = toward + dir * 1.0;
      head.x = col.x + (head.x - col.x) * 0.90;
      head.y = col.y + (head.y - col.y) * 0.90;
    }

    for (let i = 1; i < w.segs.length; i++) {
      const prev = w.segs[i - 1];
      const seg = w.segs[i];

      const vx = seg.x - prev.x;
      const vy = seg.y - prev.y;
      const ang = Math.atan2(vy, vx);

      const targetX = prev.x + Math.cos(ang) * seg.len;
      const targetY = prev.y + Math.sin(ang) * seg.len;

      seg.x = seg.x * 0.2 + targetX * 0.8;
      seg.y = seg.y * 0.2 + targetY * 0.8;
      seg.a = ang;
    }
  }

  // ---------- Stats ----------
  function updateStats() {
    if (elBuyers) elBuyers.textContent = String(buyers);
    if (elVolume) elVolume.textContent = fmt(volume);
    if (elMcap) elMcap.textContent = fmt(mcap);
    if (elColonies) elColonies.textContent = String(colonies.length);
    if (elWorms) elWorms.textContent = String(colonies.reduce((a, c) => a + c.worms.length, 0));
  }

  // ---------- Step / Render ----------
  function step(dt, time) {
    for (const c of colonies) {
      c.vx += rand(-0.02, 0.02) * c.dna.drift;
      c.vy += rand(-0.02, 0.02) * c.dna.drift;
      c.vx *= 0.985;
      c.vy *= 0.985;
      c.x += c.vx;
      c.y += c.vy;
    }

    for (const c of colonies) {
      for (const w of c.worms) wormBehavior(c, w, time);
    }

    if (focusOn) centerOnSelected(false);
    updateStats();
  }

  function render(time) {
    zoom = clamp(finScale(zoom), 0.55, 2.6);
    camX = finPos(camX);
    camY = finPos(camY);

    ctx.clearRect(0, 0, W, H);
    ctx.save();

    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(camX, camY);

    drawSpaceBG(time);

    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];
      irregularBlob(c, time);
      if (i === selected) {
        ctx.strokeStyle = `hsla(${c.dna.hue}, 95%, 65%, .55)`;
        ctx.lineWidth = 2 / finScale(zoom);
        ctx.beginPath();
        ctx.arc(c.x, c.y, 105 * c.dna.aura, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    for (const c of colonies) {
      for (const w of c.worms) drawWorm(w, time);
    }

    ctx.restore();
    dbg.textContent = "JS LOADED ✓ (rendering)";
  }

  // ---------- Main loop ----------
  let last = performance.now();
  let renderAccum = 0;
  const RENDER_FPS = 40;
  const RENDER_DT = 1 / RENDER_FPS;

  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    step(dt, now);

    renderAccum += dt;
    if (renderAccum >= RENDER_DT) {
      renderAccum = 0;
      render(now);
    }
    requestAnimationFrame(tick);
  }

  function boot() {
    resizeCanvas();
    setTimeout(() => {
      resizeCanvas();
      zoomOutToFitAll();
      centerOnSelected(true);
    }, 60);

    updateStats();
    log("Simulation ready", "INFO");
    requestAnimationFrame(tick);
  }

  window.addEventListener("load", boot);
  if (document.readyState === "complete") boot();
})();
