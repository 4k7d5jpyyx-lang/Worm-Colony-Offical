(() => {
  "use strict";

  // =========================
  // DOM
  // =========================
  const $ = (id) => document.getElementById(id);

  const canvas = $("simCanvas");
  const toast = $("toast");
  const elStatus = $("simStatus");

  const elBuyers = $("buyers");
  const elVolume = $("volume");
  const elMcap = $("mcap");
  const elColonies = $("colonies");
  const elWorms = $("worms");
  const eventLogEl = $("eventLog");

  // Inspector (overlay)
  const insBox = $("inspector");
  const insTitle = $("insTitle");
  const insDNA = $("insDNA");
  const insTemp = $("insTemp");
  const insBiome = $("insBiome");
  const insStyle = $("insStyle");
  const insMutList = $("insMutList");
  const insClose = $("insClose");

  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return;

  const fmt = (n) => "$" + Math.max(0, Math.round(n)).toLocaleString();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const lerp = (a, b, t) => a + (b - a) * t;

  // =========================
  // Canvas sizing
  // =========================
  let W = 1, H = 1, DPR = 1;
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1)); // cap for iOS perf
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 120));
  setTimeout(resizeCanvas, 0);

  // =========================
  // Event log (capped + merge spam)
  // =========================
  const LOG_CAP = 40;
  let lastLog = { msg: "", t: 0, count: 0, badge: "" };

  function pushLog(badge, msg, meta = "") {
    if (!eventLogEl) return;
    const now = Date.now();

    if (msg === lastLog.msg && badge === lastLog.badge && now - lastLog.t < 1200) {
      lastLog.count++;
      const first = eventLogEl.firstChild;
      if (first) {
        const txt = first.querySelector(".eventText");
        if (txt) txt.textContent = `${msg} (x${lastLog.count})`;
      }
      lastLog.t = now;
      return;
    }
    lastLog = { msg, t: now, count: 1, badge };

    const row = document.createElement("div");
    row.className = "eventRow";

    const b = document.createElement("div");
    b.className = `badge ${badge}`;
    b.textContent =
      badge === "mut" ? "MUTATION" :
      badge === "mile" ? "MILESTONE" :
      badge === "boss" ? "SPECIAL" : "EVENT";

    const wrap = document.createElement("div");

    const t = document.createElement("div");
    t.className = "eventText";
    t.textContent = msg;

    const m = document.createElement("div");
    m.className = "eventMeta";
    m.textContent = meta || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    wrap.appendChild(t);
    wrap.appendChild(m);

    row.appendChild(b);
    row.appendChild(wrap);

    eventLogEl.prepend(row);

    while (eventLogEl.children.length > LOG_CAP) {
      eventLogEl.removeChild(eventLogEl.lastChild);
    }
  }

  // =========================
  // iOS-friendly sound (unlocks on first tap)
  // =========================
  let audioCtx = null;
  let audioUnlocked = false;

  function ensureAudio() {
    if (audioUnlocked) return true;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      audioUnlocked = true;
      return true;
    } catch {
      return false;
    }
  }

  function playSfx(type = "ping", intensity = 1) {
    if (!ensureAudio() || !audioCtx) return;

    const now = audioCtx.currentTime;
    const out = audioCtx.createGain();
    out.gain.value = 0.0001;
    out.connect(audioCtx.destination);

    const g = audioCtx.createGain();
    g.connect(out);

    const o = audioCtx.createOscillator();
    o.type = "sine";

    const n = audioCtx.createOscillator();
    n.type = "triangle";

    const A = 0.005;

    if (type === "mut") {
      o.frequency.setValueAtTime(320 + 80 * intensity, now);
      o.frequency.exponentialRampToValueAtTime(120, now + 0.18);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.12, now + A);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    } else if (type === "shock") {
      o.frequency.setValueAtTime(90, now);
      o.frequency.exponentialRampToValueAtTime(45, now + 0.35);
      n.frequency.setValueAtTime(140, now);
      n.frequency.exponentialRampToValueAtTime(60, now + 0.35);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.22, now + A);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
      n.connect(g);
      n.start(now);
      n.stop(now + 0.4);
    } else if (type === "fire") {
      o.frequency.setValueAtTime(220, now);
      o.frequency.exponentialRampToValueAtTime(520, now + 0.12);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.24, now + A);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    } else if (type === "ice") {
      o.frequency.setValueAtTime(520, now);
      o.frequency.exponentialRampToValueAtTime(260, now + 0.18);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.18, now + A);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    } else {
      o.frequency.setValueAtTime(420, now);
      o.frequency.exponentialRampToValueAtTime(220, now + 0.25 + intensity * 0.2);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.10, now + A);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    }

    o.connect(g);
    o.start(now);
    o.stop(now + 0.5);

    out.gain.setValueAtTime(0.0001, now);
    out.gain.linearRampToValueAtTime(1.0, now + 0.01);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
  }

  window.addEventListener("pointerdown", () => ensureAudio(), { passive: true, once: true });

  // =========================
  // Economy / triggers
  // =========================
  let buyers = 0;
  let volume = 0;
  let mcap = 0;

  const MAX_COLONIES = 16;
  const MC_STEP = 25000;
  let nextSplitAt = MC_STEP;

  let bossSpawned = false;

  const milestone100k = { hit: false };
  const milestone250k = { hit: false };

  function growthScore() {
    return (mcap / 24000) + (volume / 7000) + (buyers / 12);
  }

  // =========================
  // Camera + interaction
  // =========================
  let camX = 0, camY = 0, zoom = 0.82;
  let selected = 0;
  let focusOn = false;
  let isInteracting = false;

  // ---- robust input state (tap vs drag) ----
  const input = {
    down: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: 0,
    downTime: 0,
    wasDrag: false,
    tapWorld: null
  };

  function canvasLocalFromClient(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function toWorldFromCanvasLocal(px, py) {
    return {
      x: (px - W / 2) / zoom - camX,
      y: (py - H / 2) / zoom - camY
    };
  }

  function dist2(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  }

  function pickColony(wx, wy) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];
      const d = dist2(wx, wy, c.x, c.y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return (best !== -1 && bestD < 320 * 320) ? best : -1;
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    ensureAudio();

    input.down = true;
    input.pointerId = e.pointerId;
    input.downTime = performance.now();

    input.startX = e.clientX;
    input.startY = e.clientY;
    input.lastX = e.clientX;
    input.lastY = e.clientY;
    input.moved = 0;
    input.wasDrag = false;

    isInteracting = true;
  }, { passive: true });

  canvas.addEventListener("pointermove", (e) => {
    if (!input.down || e.pointerId !== input.pointerId) return;

    const dx = e.clientX - input.lastX;
    const dy = e.clientY - input.lastY;
    input.lastX = e.clientX;
    input.lastY = e.clientY;

    input.moved += Math.abs(dx) + Math.abs(dy);

    // if moved enough -> treat as drag
    if (input.moved > 6) input.wasDrag = true;

    // pan only if dragging
    if (input.wasDrag) {
      camX += dx / zoom;
      camY += dy / zoom;
    }
  }, { passive: true });

  canvas.addEventListener("pointerup", (e) => {
    if (!input.down || e.pointerId !== input.pointerId) return;

    input.down = false;
    isInteracting = false;

    const elapsed = performance.now() - input.downTime;
    const moved = input.moved;

    // TAP rule: small movement + short time
    const isTap = moved <= 10 && elapsed <= 350;

    if (isTap) {
      const loc = canvasLocalFromClient(e.clientX, e.clientY);
      const w = toWorldFromCanvasLocal(loc.x, loc.y);
      input.tapWorld = w; // consumed by sim loop (prevents UI breaking sim)
    }

    input.pointerId = null;
  }, { passive: true });

  canvas.addEventListener("pointercancel", () => {
    input.down = false;
    input.pointerId = null;
    isInteracting = false;
  }, { passive: true });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    isInteracting = true;
    const k = e.deltaY > 0 ? 0.92 : 1.08;
    zoom = clamp(zoom * k, 0.55, 2.8);
    clearTimeout(canvas.__wheelTO);
    canvas.__wheelTO = setTimeout(() => (isInteracting = false), 120);
  }, { passive: false });

  let lastTap = 0;
  canvas.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - lastTap < 280) centerOnSelected(false);
    lastTap = now;
  }, { passive: true });

  function centerOnSelected(smooth = true) {
    const c = colonies[selected];
    if (!c) return;
    if (!smooth) { camX = -c.x; camY = -c.y; return; }
    camX = lerp(camX, -c.x, 0.18);
    camY = lerp(camY, -c.y, 0.18);
  }

  function zoomOutToFitAll() {
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
    zoom = clamp(fit * 0.92, 0.55, 1.7);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    camX = -cx; camY = -cy;
  }

  // =========================
  // Background (stars + nebula + galaxy swirls)
  // =========================
  const bg = {
    canvas: document.createElement("canvas"),
    ctx: null,
    w: 0, h: 0
  };
  bg.ctx = bg.canvas.getContext("2d");

  function makeStarfield() {
    bg.w = 900;
    bg.h = 900;
    bg.canvas.width = bg.w;
    bg.canvas.height = bg.h;

    const b = bg.ctx;
    b.clearRect(0, 0, bg.w, bg.h);

    for (let i = 0; i < 10; i++) {
      const x = rand(0, bg.w), y = rand(0, bg.h);
      const r = rand(160, 360);
      const hue = rand(180, 320);
      const g = b.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `hsla(${hue}, 95%, 60%, ${rand(0.08, 0.16)})`);
      g.addColorStop(1, `hsla(${hue}, 95%, 60%, 0)`);
      b.fillStyle = g;
      b.beginPath();
      b.arc(x, y, r, 0, Math.PI * 2);
      b.fill();
    }

    b.globalCompositeOperation = "lighter";
    for (let i = 0; i < 7; i++) {
      const cx = rand(0, bg.w), cy = rand(0, bg.h);
      const baseR = rand(120, 260);
      const hue = rand(170, 310);
      b.strokeStyle = `hsla(${hue}, 95%, 70%, ${rand(0.06, 0.12)})`;
      b.lineWidth = rand(1.2, 2.4);
      for (let k = 0; k < 6; k++) {
        b.beginPath();
        const start = rand(0, Math.PI * 2);
        const span = rand(Math.PI * 0.6, Math.PI * 1.2);
        for (let t = 0; t <= 1.001; t += 0.06) {
          const a = start + span * t;
          const rr = baseR * (0.55 + t * 0.75) + Math.sin(t * 6 + i) * 10;
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr;
          if (t === 0) b.moveTo(x, y);
          else b.lineTo(x, y);
        }
        b.stroke();
      }
    }
    b.globalCompositeOperation = "source-over";

    for (let i = 0; i < 1400; i++) {
      const x = rand(0, bg.w), y = rand(0, bg.h);
      const r = Math.random() < 0.90 ? rand(0.3, 1.2) : rand(1.2, 2.2);
      const a = Math.random() < 0.92 ? rand(0.35, 0.75) : rand(0.75, 0.95);
      const hue = Math.random() < 0.85 ? 210 : rand(180, 320);
      b.fillStyle = `hsla(${hue}, 95%, 85%, ${a})`;
      b.beginPath();
      b.arc(x, y, r, 0, Math.PI * 2);
      b.fill();

      if (r > 1.5 && Math.random() < 0.25) {
        b.strokeStyle = `hsla(${hue}, 95%, 90%, ${a * 0.55})`;
        b.lineWidth = 1;
        b.beginPath();
        b.moveTo(x - 4, y);
        b.lineTo(x + 4, y);
        b.moveTo(x, y - 4);
        b.lineTo(x, y + 4);
        b.stroke();
      }
    }
  }
  makeStarfield();

  function drawBackground() {
    const px = (-camX * zoom * 0.10) % bg.w;
    const py = (-camY * zoom * 0.10) % bg.h;
    for (let ix = -1; ix <= 1; ix++) {
      for (let iy = -1; iy <= 1; iy++) {
        ctx.drawImage(bg.canvas, px + ix * bg.w, py + iy * bg.h);
      }
    }

    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255,255,255,.015)";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
  }

  // =========================
  // Colony / worm models
  // =========================
  const DNA_TEMPS = ["CALM", "AGGRESSIVE", "CHAOTIC", "TOXIC", "HYPER", "ZEN", "FERAL", "ROYAL"];
  const DNA_BIOMES = ["NEON GARDEN", "DEEP SEA", "VOID BLOOM", "GLASS CAVE", "ARC STORM", "EMBER WASTE", "ICE TEMPLE", "STARFIELD"];
  const DNA_STYLES = ["COMET", "CROWN", "ARC", "SPIRAL", "DRIFT", "RIBBON", "FRACTAL", "ORBIT"];

  function makeDnaCode(c) {
    const a = Math.floor((c.dna.hue % 360));
    const b = Math.floor(c.dna.chaos * 99);
    const d = Math.floor(c.dna.drift * 99);
    const e = Math.floor(c.dna.aura * 99);
    const f = Math.floor(c.dna.limbiness * 99);
    return `H${a}-C${b}-D${d}-A${e}-L${f}`;
  }

  function makeColonyOutline(dna) {
    const pts = [];
    const baseR = 120 * dna.aura;
    const spikes = randi(9, 16);
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      const wob =
        Math.sin(a * (2.0 + dna.chaos) + dna.seed) * (18 + 18 * dna.chaos) +
        Math.sin(a * (5.0 + dna.drift) - dna.seed * 0.7) * (10 + 12 * dna.drift);
      const r = baseR + wob;
      pts.push({ a, r });
    }
    return pts;
  }

  function newColony(x, y, hue = rand(0, 360)) {
    const id = Math.random().toString(16).slice(2, 6).toUpperCase();
    const dna = {
      hue,
      chaos: rand(0.55, 1.45),
      drift: rand(0.55, 1.45),
      aura: rand(1.0, 1.8),
      limbiness: rand(0.20, 1.25),
      temperament: DNA_TEMPS[randi(0, DNA_TEMPS.length - 1)],
      biome: DNA_BIOMES[randi(0, DNA_BIOMES.length - 1)],
      style: DNA_STYLES[randi(0, DNA_STYLES.length - 1)],
      seed: rand(0, 9999)
    };

    return {
      id,
      x, y,
      vx: rand(-0.18, 0.18),
      vy: rand(-0.18, 0.18),
      dna,
      outline: makeColonyOutline(dna),
      worms: [],
      shock: [],
      freezeT: 0
    };
  }

  function addLimb(w, col, big = false) {
    if (!w.segs.length) return;
    const at = randi(2, w.segs.length - 3);
    w.limbs.push({
      at,
      len: big ? rand(40, 110) : rand(24, 78),
      ang: rand(-1.4, 1.4),
      wob: rand(0.7, 1.9)
    });
  }

  function newWorm(col, big = false, special = null) {
    const type = ["DRIFTER", "ORBITER", "HUNTER"][randi(0, 2)];
    const segCount = big ? randi(18, 30) : randi(12, 20);
    const baseLen = big ? rand(10, 16) : rand(7, 12);

    // spawn around colony (prevents global drift)
    const spawnAng = rand(0, Math.PI * 2);
    const spawnRad = rand(40, 120);
    let px = col.x + Math.cos(spawnAng) * spawnRad;
    let py = col.y + Math.sin(spawnAng) * spawnRad;
    let ang = rand(0, Math.PI * 2);

    const paletteShift = rand(-160, 160);
    const hueBase = (col.dna.hue + paletteShift + 360) % 360;

    const w = {
      id: Math.random().toString(16).slice(2, 6),
      type,
      hue: hueBase,
      width: big ? rand(7, 12) : rand(4.4, 7.2),
      speed: big ? rand(0.36, 0.78) : rand(0.48, 1.08),
      turn: rand(0.010, 0.024) * col.dna.chaos,
      phase: rand(0, Math.PI * 2),
      orbitDir: Math.random() < 0.5 ? -1 : 1,
      roamBias: rand(0.10, 0.28),
      pat: {
        stripe: Math.random() < 0.75,
        dots: Math.random() < 0.45,
        dual: Math.random() < 0.45,
        hue2: (hueBase + rand(40, 150)) % 360,
        sparkle: Math.random() < 0.35,
      },
      limbs: [],
      segs: [],
      isBoss: false,
      special: special || null,
      breath: []
    };

    for (let i = 0; i < segCount; i++) {
      w.segs.push({ x: px, y: py, a: ang, len: baseLen * rand(0.85, 1.22) });
      px -= Math.cos(ang) * baseLen;
      py -= Math.sin(ang) * baseLen;
      ang += rand(-0.35, 0.35) * col.dna.chaos;
    }

    if (special === "FIRE_DOGE") {
      w.isBoss = true;
      w.width *= 1.8;
      w.speed *= 0.92;
      w.hue = 22;
      w.pat.hue2 = 55;
      w.pat.sparkle = true;
    }
    if (special === "ICE_QUEEN") {
      w.isBoss = true;
      w.width *= 2.0;
      w.speed *= 0.86;
      w.hue = 200;
      w.pat.hue2 = 265;
      w.pat.sparkle = true;
    }

    const limbChance = clamp(0.10 + col.dna.limbiness * 0.22, 0.12, 0.55);
    if (Math.random() < limbChance) addLimb(w, col, big || w.isBoss);

    return w;
  }

  // =========================
  // World state
  // =========================
  const colonies = [newColony(0, 0, 150)];
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], true));

  // Keep recent mutations per colony for inspector
  for (const c of colonies) c.recentMut = [];

  // =========================
  // Shockwaves
  // =========================
  function shockwave(col, strength = 1, hueOverride = null) {
    col.shock.push({
      r: 0,
      v: 2.8 + strength * 1.4,
      a: 0.92,
      w: 2 + strength * 1.2,
      hue: hueOverride
    });
    playSfx("shock", strength);
  }

  // =========================
  // Flow field (prevents global “always right” drift)
  // =========================
  function flowAngle(x, y, time) {
    const t = time * 0.00025;
    const nx = x * 0.0022;
    const ny = y * 0.0022;
    return (
      Math.sin(nx + t) * 1.2 +
      Math.cos(ny - t * 1.3) * 1.0 +
      Math.sin((nx + ny) * 0.7 + t * 1.8) * 0.8
    );
  }

  function lerpAngle(a, b, t) {
    const d = (((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    return a + d * t;
  }

  // =========================
  // Drawing
  // =========================
  function aura(x, y, r, hue, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue},95%,65%,${a})`);
    g.addColorStop(1, `hsla(${hue},95%,65%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function strokePath(points, width, color, glow = null) {
    if (glow) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = glow;
      ctx.lineWidth = width + 7;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }

  function drawWorm(w, time) {
    const pts = w.segs;
    if (!pts.length) return;

    const glowA = w.isBoss
      ? `hsla(${w.hue}, 95%, 65%, .26)`
      : `hsla(${w.hue}, 95%, 65%, .14)`;

    if (!isInteracting) {
      strokePath(pts, w.width, `hsla(${w.hue}, 95%, 65%, .92)`, glowA);
    } else {
      strokePath(pts, w.width, `hsla(${w.hue}, 95%, 65%, .92)`, null);
    }

    if (!isInteracting) {
      for (let i = 0; i < pts.length; i += 2) {
        const p = pts[i];
        const t = i / Math.max(1, pts.length - 1);
        const stripeOn = w.pat.stripe && (i % 6 < 3);
        const useHue = (w.pat.dual && stripeOn) ? w.pat.hue2 : w.hue;

        const r = Math.max(1.6, w.width * (0.30 + 0.18 * Math.sin(t * 10 + w.phase)));
        ctx.fillStyle = `hsla(${useHue}, 95%, ${stripeOn ? 68 : 62}%, .85)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();

        if (w.pat.dots && (i % 8 === 0)) {
          ctx.fillStyle = `hsla(${(useHue + 30) % 360}, 95%, 76%, .75)`;
          ctx.beginPath();
          ctx.arc(
            p.x + Math.sin(t * 8 + time * 0.003) * 2,
            p.y + Math.cos(t * 8 + time * 0.003) * 2,
            r * 0.55,
            0, Math.PI * 2
          );
          ctx.fill();
        }

        if (w.pat.sparkle && (i % 10 === 0)) {
          ctx.strokeStyle = `hsla(${(useHue + 90) % 360}, 95%, 85%, .25)`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x - 3, p.y);
          ctx.lineTo(p.x + 3, p.y);
          ctx.moveTo(p.x, p.y - 3);
          ctx.lineTo(p.x, p.y + 3);
          ctx.stroke();
        }
      }
    }

    if (w.limbs?.length) {
      ctx.globalCompositeOperation = isInteracting ? "source-over" : "lighter";
      for (const L of w.limbs) {
        const at = clamp(L.at, 0, pts.length - 1);
        const base = pts[at];
        const baseAng =
          (pts[at]?.a || 0) +
          L.ang +
          Math.sin(time * 0.002 * L.wob + w.phase) * 0.35;

        const lx = base.x + Math.cos(baseAng) * L.len;
        const ly = base.y + Math.sin(baseAng) * L.len;

        ctx.strokeStyle = `hsla(${(w.hue + 40) % 360}, 95%, 66%, ${isInteracting ? 0.30 : 0.55})`;
        ctx.lineWidth = Math.max(2, w.width * 0.35);
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.quadraticCurveTo(
          base.x + Math.cos(baseAng) * (L.len * 0.55),
          base.y + Math.sin(baseAng) * (L.len * 0.55),
          lx, ly
        );
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    if (w.special === "FIRE_DOGE" && w.breath.length) {
      ctx.globalCompositeOperation = "lighter";
      for (const p of w.breath) {
        ctx.fillStyle = `hsla(${p.h}, 95%, 65%, ${p.a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }

  function drawColony(col, time) {
    const hue = col.dna.hue;

    if (!isInteracting) {
      aura(col.x, col.y, 190 * col.dna.aura, hue, 0.16);
      aura(col.x, col.y, 140 * col.dna.aura, (hue + 40) % 360, 0.10);
      aura(col.x, col.y, 95 * col.dna.aura, (hue + 110) % 360, 0.06);
    } else {
      aura(col.x, col.y, 145 * col.dna.aura, hue, 0.12);
    }

    ctx.strokeStyle = `hsla(${hue}, 90%, 65%, .28)`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < col.outline.length; i++) {
      const o = col.outline[i];
      const wob = Math.sin(time * 0.0014 + o.a * 3 + col.dna.seed) * 8;
      const r = o.r + wob;
      const px = col.x + Math.cos(o.a) * r;
      const py = col.y + Math.sin(o.a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    if (colonies[selected] === col) {
      ctx.strokeStyle = `hsla(${hue}, 95%, 65%, .55)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(col.x, col.y, 105 * col.dna.aura, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const s of col.shock) {
      const hh = (s.hue ?? hue);
      ctx.strokeStyle = `hsla(${hh}, 92%, 62%, ${s.a})`;
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.arc(col.x, col.y, s.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (col.freezeT > 0) {
      ctx.globalCompositeOperation = "lighter";
      aura(col.x, col.y, 220 * col.dna.aura, 200, 0.10 * clamp(col.freezeT / 2.0, 0, 1));
      ctx.globalCompositeOperation = "source-over";
    }
  }

  // =========================
  // Worm behavior
  // =========================
  function wormBehavior(col, w, time, dt) {
    const head = w.segs[0];
    const freezeSlow = col.freezeT > 0 ? 0.55 : 1.0;

    const jitter = Math.sin(time * 0.002 + w.phase) * 0.12;
    const field = flowAngle(head.x, head.y, time);

    const dx = col.x - head.x;
    const dy = col.y - head.y;
    const toward = Math.atan2(dy, dx);

    const orbit = toward + w.orbitDir * (0.75 + 0.35 * Math.sin(time * 0.001 + w.phase));
    const desired =
      (w.type === "DRIFTER")
        ? lerpAngle(toward, field, w.roamBias)
        : (w.type === "ORBITER")
          ? lerpAngle(orbit, field, w.roamBias + 0.08)
          : lerpAngle(lerpAngle(toward, orbit, 0.5), field, w.roamBias + 0.10);

    const turnAmt = w.turn * (0.9 + 0.25 * Math.sin(time * 0.001 + w.phase));
    head.a = lerpAngle(head.a, desired, clamp(turnAmt * 9.0, 0.06, 0.22));
    head.a += (Math.random() - 0.5) * turnAmt + jitter * 0.55;

    const boost = w.isBoss ? 1.6 : 1.0;
    const sp = w.speed * 2.15 * boost * freezeSlow;
    head.x += Math.cos(head.a) * sp;
    head.y += Math.sin(head.a) * sp;

    const d = Math.hypot(head.x - col.x, head.y - col.y);
    const leash = 300 + 65 * col.dna.aura;
    if (d > leash) {
      head.x = col.x + (head.x - col.x) * 0.92;
      head.y = col.y + (head.y - col.y) * 0.92;
      head.a = lerpAngle(head.a, toward, 0.25);
    }

    for (let i = 1; i < w.segs.length; i++) {
      const prev = w.segs[i - 1];
      const seg = w.segs[i];

      const vx = seg.x - prev.x;
      const vy = seg.y - prev.y;
      const ang = Math.atan2(vy, vx);

      const targetX = prev.x + Math.cos(ang) * seg.len;
      const targetY = prev.y + Math.sin(ang) * seg.len;

      seg.x = seg.x * 0.22 + targetX * 0.78;
      seg.y = seg.y * 0.22 + targetY * 0.78;
      seg.a = ang;
    }

    // FIRE DOGE breath (every 8-14 sec)
    if (w.special === "FIRE_DOGE") {
      if (!w.__nextBreath) w.__nextBreath = time + rand(8000, 14000);

      if (time >= w.__nextBreath) {
        w.__nextBreath = time + rand(8000, 14000);

        shockwave(col, 2.2, 22);
        pushLog("mile", "🔥 100k Special: Fire-Breathing Doge Worm unleashes a blast!");
        playSfx("fire", 1.2);

        const hx = head.x, hy = head.y;
        const dir = head.a;
        for (let k = 0; k < 60; k++) {
          w.breath.push({
            x: hx + Math.cos(dir) * rand(10, 30) + rand(-8, 8),
            y: hy + Math.sin(dir) * rand(10, 30) + rand(-8, 8),
            vx: Math.cos(dir) * rand(2.6, 4.8) + rand(-0.6, 0.6),
            vy: Math.sin(dir) * rand(2.6, 4.8) + rand(-0.6, 0.6),
            r: rand(2.2, 5.0),
            a: rand(0.55, 0.90),
            h: rand(10, 45)
          });
        }
      }

      for (const p of w.breath) {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.965;
        p.vy *= 0.965;
        p.a *= 0.94;
        p.r *= 0.985;
      }
      w.breath = w.breath.filter(p => p.a > 0.05 && p.r > 0.6);
    }
  }

  // =========================
  // Mutations
  // =========================
  let mutTimer = 0;
  let spawnTimer = 0;

  function rememberMutation(col, msg) {
    if (!col.recentMut) col.recentMut = [];
    col.recentMut.unshift(msg);
    if (col.recentMut.length > 10) col.recentMut.length = 10;
  }

  function mutateRandom() {
    const c = colonies[randi(0, colonies.length - 1)];
    if (!c?.worms?.length) return;
    const w = c.worms[randi(0, c.worms.length - 1)];

    const roll = Math.random();
    let msg = "";

    if (roll < 0.18) {
      w.hue = (w.hue + rand(40, 160)) % 360;
      w.pat.hue2 = (w.hue + rand(40, 150)) % 360;
      msg = `Color morph • Worm ${w.id}`;
    } else if (roll < 0.34) {
      w.speed *= rand(1.05, 1.30);
      msg = `Aggression spike • Worm ${w.id}`;
    } else if (roll < 0.50) {
      w.width = clamp(w.width * rand(1.05, 1.35), 3.5, 20);
      msg = `Body growth • Worm ${w.id}`;
    } else if (roll < 0.66) {
      w.turn *= rand(1.10, 1.45);
      msg = `Turn instability • Worm ${w.id}`;
    } else if (roll < 0.80) {
      w.pat.stripe = !w.pat.stripe;
      w.pat.dots = !w.pat.dots;
      msg = `Pattern shift • Worm ${w.id}`;
    } else {
      addLimb(w, c, Math.random() < 0.4);
      msg = `Limb growth • Worm ${w.id}`;
    }

    rememberMutation(c, msg);
    pushLog("mut", msg);
    playSfx("mut", 1);
    if (Math.random() < 0.25) shockwave(c, 0.9);
  }

  function maybeSpawnWorms(dt) {
    const g = growthScore();
    const target = clamp(Math.floor(3 + g * 2.1), 3, 120);

    const total = colonies.reduce((a, c) => a + c.worms.length, 0);
    if (total >= target) return;

    spawnTimer += dt;
    const rate = clamp(1.2 - g * 0.035, 0.12, 1.2);
    if (spawnTimer >= rate) {
      spawnTimer = 0;
      const c = colonies[selected] || colonies[0];
      c.worms.push(newWorm(c, Math.random() < 0.18));
      if (Math.random() < 0.22) shockwave(c, 0.55);
      pushLog("event", "New worm hatched");
    }
  }

  // =========================
  // Colonies spawning by MC
  // =========================
  function trySplitByMcap() {
    while (mcap >= nextSplitAt && colonies.length < MAX_COLONIES) {
      const base = colonies[0];
      const ang = rand(0, Math.PI * 2);
      const dist = rand(260, 460);
      const nc = newColony(
        base.x + Math.cos(ang) * dist,
        base.y + Math.sin(ang) * dist,
        (base.dna.hue + rand(-100, 100) + 360) % 360
      );

      const g = growthScore();
      const starters = clamp(Math.floor(2 + g / 2), 2, 7);
      for (let i = 0; i < starters; i++) nc.worms.push(newWorm(nc, Math.random() < 0.25));
      nc.recentMut = [];

      shockwave(nc, 1.1);
      colonies.push(nc);

      pushLog("event", `New colony spawned at ${fmt(nextSplitAt)} MC`);
      nextSplitAt += MC_STEP;
    }
  }

  // =========================
  // Boss + Milestone Specials
  // =========================
  function ensureBoss() {
    if (bossSpawned) return;
    if (mcap >= 50000) {
      const c = colonies[0];
      const boss = newWorm(c, true, "BOSS");
      boss.isBoss = true;
      boss.width *= 1.65;
      boss.speed *= 0.78;
      boss.hue = 120;
      for (let i = 0; i < 4; i++) addLimb(boss, c, true);
      c.worms.push(boss);
      bossSpawned = true;
      shockwave(c, 1.4, 120);
      pushLog("boss", "Boss worm emerged");
    }
  }

  function checkMilestones() {
    if (!milestone100k.hit && mcap >= 100000) {
      milestone100k.hit = true;
      const c = colonies[0];
      const fire = newWorm(c, true, "FIRE_DOGE");
      for (let i = 0; i < 5; i++) addLimb(fire, c, true);
      c.worms.push(fire);
      shockwave(c, 2.0, 22);
      pushLog("mile", "🔥 100k Milestone: Fire-Breathing Doge Worm has arrived!");
      playSfx("fire", 1.2);
    }

    if (!milestone250k.hit && mcap >= 250000) {
      milestone250k.hit = true;
      const c = colonies[0];
      const queen = newWorm(c, true, "ICE_QUEEN");
      for (let i = 0; i < 6; i++) addLimb(queen, c, true);
      c.worms.push(queen);

      c.freezeT = 2.6;
      shockwave(c, 2.2, 200);
      pushLog("mile", "❄️ 250k Milestone: Ice Queen hatch — the colony chills!");
      playSfx("ice", 1.2);
    }
  }

  // =========================
  // Controls
  // =========================
  function bind(action, fn) {
    const btn = document.querySelector(`button[data-action="${action}"]`);
    if (btn) btn.addEventListener("click", () => { ensureAudio(); fn(); });
  }

  bind("feed", () => { volume += rand(20, 90); mcap += rand(120, 460); });
  bind("smallBuy", () => { buyers += 1; volume += rand(180, 900); mcap += rand(900, 3200); });
  bind("whaleBuy", () => { buyers += randi(2, 5); volume += rand(2500, 8500); mcap += rand(9000, 22000); shockwave(colonies[0], 1.2); });
  bind("sell", () => { volume = Math.max(0, volume - rand(600, 2600)); mcap = Math.max(0, mcap - rand(2200, 9000)); });
  bind("storm", () => { volume += rand(5000, 18000); mcap += rand(2000, 8000); shockwave(colonies[0], 1.0); });
  bind("mutate", () => mutateRandom());

  bind("focus", () => {
    focusOn = !focusOn;
    const btn = $("focusBtn");
    if (btn) btn.textContent = `Focus: ${focusOn ? "On" : "Off"}`;
    if (focusOn) centerOnSelected(false);
  });

  bind("zoomIn", () => (zoom = clamp(zoom * 1.12, 0.55, 2.8)));
  bind("zoomOut", () => (zoom = clamp(zoom * 0.88, 0.55, 2.8)));

  bind("capture", () => {
    try {
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "worm_colony.png";
      a.click();
      pushLog("event", "Capture saved");
    } catch {
      pushLog("event", "Capture blocked by iOS — screenshot/share instead");
    }
  });

  bind("reset", () => location.reload());

  // Inspector close
  if (insClose && insBox) {
    insClose.addEventListener("click", () => insBox.classList.add("hidden"));
  }

  // =========================
  // UI updates (safe)
  // =========================
  function updateStats() {
    if (elBuyers) elBuyers.textContent = String(buyers);
    if (elVolume) elVolume.textContent = fmt(volume);
    if (elMcap) elMcap.textContent = fmt(mcap);
    if (elColonies) elColonies.textContent = String(colonies.length);
    if (elWorms) {
      const total = colonies.reduce((a, c) => a + c.worms.length, 0);
      elWorms.textContent = String(total);
    }
  }

  function updateInspector() {
    if (!insBox) return;
    const c = colonies[selected];
    if (!c) return;

    // show if hidden and user selects
    insBox.classList.remove("hidden");

    if (insTitle) insTitle.textContent = `Colony #${selected + 1} • ${c.id}`;
    if (insDNA) insDNA.textContent = makeDnaCode(c);
    if (insTemp) insTemp.textContent = c.dna.temperament;
    if (insBiome) insBiome.textContent = c.dna.biome;
    if (insStyle) insStyle.textContent = c.dna.style;

    if (insMutList) {
      insMutList.innerHTML = "";
      const list = (c.recentMut && c.recentMut.length) ? c.recentMut : ["No recent mutations."];
      for (const item of list) {
        const d = document.createElement("div");
        d.className = "insMutItem";
        d.textContent = item;
        insMutList.appendChild(d);
      }
    }
  }

  // =========================
  // Selection consume (tap)
  // =========================
  function consumeTapSelection() {
    if (!input.tapWorld) return;
    const w = input.tapWorld;
    input.tapWorld = null;

    const idx = pickColony(w.x, w.y);
    if (idx !== -1) {
      selected = idx;
      pushLog("event", `Selected Colony #${idx + 1}`);
      updateInspector();
      if (focusOn) centerOnSelected(true);
    }
  }

  // =========================
  // Main step/render
  // =========================
  function step(dt, time) {
    consumeTapSelection();

    ensureBoss();
    trySplitByMcap();
    checkMilestones();

    for (const c of colonies) {
      c.vx += rand(-0.02, 0.02) * c.dna.drift;
      c.vy += rand(-0.02, 0.02) * c.dna.drift;
      c.vx *= 0.985;
      c.vy *= 0.985;
      c.x += c.vx;
      c.y += c.vy;

      if (c.freezeT > 0) c.freezeT = Math.max(0, c.freezeT - dt);

      for (const s of c.shock) {
        s.r += s.v;
        s.a *= 0.962;
      }
      c.shock = c.shock.filter((s) => s.a > 0.06);
    }

    for (const c of colonies) {
      for (const w of c.worms) wormBehavior(c, w, time, dt);
    }

    if (focusOn) centerOnSelected(true);

    mutTimer += dt;
    const g = growthScore();
    const mutRate = clamp(2.2 - g * 0.07, 0.35, 2.2);
    if (mutTimer >= mutRate) {
      mutTimer = 0;
      if (Math.random() < 0.65) mutateRandom();
    }

    maybeSpawnWorms(dt);
    updateStats();
  }

  function render(time) {
    ctx.clearRect(0, 0, W, H);

    // background in screen space
    drawBackground(time);

    // world
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(camX, camY);

    for (const c of colonies) drawColony(c, time);
    for (const c of colonies) for (const w of c.worms) drawWorm(w, time);

    ctx.restore();

    if (toast) toast.textContent = "JS LOADED ✓ (rendering)";
    if (elStatus) elStatus.textContent = "Simulation Active";
  }

  // =========================
  // Loop (capped render FPS)
  // =========================
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

  // =========================
  // Boot
  // =========================
  function boot() {
    resizeCanvas();
    zoomOutToFitAll();
    updateStats();
    updateInspector();

    pushLog("event", "Simulation ready");
    if (toast) toast.textContent = "Loading…";

    requestAnimationFrame(tick);
  }

  window.addEventListener("load", boot);
  if (document.readyState === "complete") boot();
})();
