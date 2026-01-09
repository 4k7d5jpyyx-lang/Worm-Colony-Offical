(() => {
  "use strict";

  // ----------------------------
  // DOM helpers
  // ----------------------------
  const $ = (id) => document.getElementById(id);
  const fmtMoney = (n) => "$" + Math.max(0, Math.round(n)).toLocaleString();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ----------------------------
  // Elements
  // ----------------------------
  const canvas = $("simCanvas");
  const ctx = canvas?.getContext("2d", { alpha: true, desynchronized: true });

  const elBuyers = $("buyers");
  const elVolume = $("volume");
  const elMcap = $("mcap");
  const elColonies = $("colonies");
  const elWorms = $("worms");
  const logEl = $("log");
  const toastEl = $("toast");
  const simStatus = $("simStatus");

  const inspector = $("inspector");
  const closeInspector = $("closeInspector");
  const selName = $("selName");
  const dnaVal = $("dnaVal");
  const tempVal = $("tempVal");
  const biomeVal = $("biomeVal");
  const styleVal = $("styleVal");
  const mutList = $("mutList");

  if (!canvas || !ctx) {
    if (simStatus) simStatus.textContent = "Canvas failed";
    return;
  }

  // ----------------------------
  // Toast
  // ----------------------------
  let toastTO = null;
  function setToast(msg, ms = 900) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.style.opacity = "0.92";
    clearTimeout(toastTO);
    toastTO = setTimeout(() => {
      toastEl.style.opacity = "0.0";
    }, ms);
  }

  // ----------------------------
  // Event log (cap + spam merge)
  // ----------------------------
  const LOG_CAP = 60;
  let lastLog = { msg: "", t: 0, count: 0 };
  function addEvent(kind, msg) {
    if (!logEl) return;
    const now = Date.now();

    // merge spam
    if (msg === lastLog.msg && now - lastLog.t < 1200) {
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

  // ----------------------------
  // Audio (iOS: only after first tap)
  // ----------------------------
  let audioReady = false;
  let audioCtx = null;
  let masterGain = null;

  function ensureAudio() {
    if (audioReady) return true;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.25;
      masterGain.connect(audioCtx.destination);
      audioReady = true;
      return true;
    } catch {
      return false;
    }
  }

  function blip(type = "mut", intensity = 1) {
    if (!audioReady || !audioCtx || !masterGain) return;

    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g);
    g.connect(masterGain);

    const base = type === "milestone" ? 220 : type === "spawn" ? 300 : type === "boss" ? 140 : 420;
    const freq = base * (1 + rand(-0.08, 0.08));
    o.type = type === "boss" ? "sawtooth" : "triangle";

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08 * intensity, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (type === "boss" ? 0.22 : 0.14));

    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * (type === "milestone" ? 1.7 : 1.25), t + 0.08);

    o.start(t);
    o.stop(t + 0.25);
  }

  window.addEventListener("pointerdown", () => {
    if (!audioReady) {
      if (ensureAudio()) setToast("Sound unlocked", 700);
    }
  }, { passive: true, once: false });

  // ----------------------------
  // Canvas sizing (perf friendly)
  // ----------------------------
  let W = 1, H = 1, DPR = 1;
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 120));
  setTimeout(resizeCanvas, 0);

  // ----------------------------
  // Economy / triggers (still sim-driven)
  // ----------------------------
  let buyers = 0;
  let volume = 0;
  let mcap = 0;

  const MAX_COLONIES = 16;
  const MC_STEP = 25000; // your new increment
  let nextSplitAt = MC_STEP;

  // Special milestone events (visual + audio + log)
  // You can add more easily later.
  const milestoneEvents = [
    { at: 50000,  name: "Boss Emergence", kind: "boss" },
    { at: 75000,  name: "Chromatic Bloom", kind: "milestone" },
    { at: 100000, name: "Nebula Surge", kind: "milestone" },
    { at: 150000, name: "Spore Storm", kind: "milestone" },
    { at: 200000, name: "Void Eclipse", kind: "milestone" },
    { at: 250000, name: "Worm Convergence", kind: "milestone" },
    { at: 300000, name: "Arc Supernova", kind: "milestone" }
  ];
  const firedMilestones = new Set();

  function growthScore() {
    return (mcap / 20000) + (volume / 6000) + (buyers / 10);
  }

  // ----------------------------
  // Camera + interaction
  // ----------------------------
  let camX = 0, camY = 0, zoom = 0.78;
  let dragging = false, lastX = 0, lastY = 0;
  let selected = 0;
  let focusOn = false;
  let isInteracting = false;

  function toWorld(px, py) {
    return {
      x: (px - W / 2) / zoom - camX,
      y: (py - H / 2) / zoom - camY
    };
  }

  function pickColony(wx, wy) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];
      const dx = wx - c.x, dy = wy - c.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return (best !== -1 && bestD < 320 * 320) ? best : -1;
  }

  function centerOnSelected(smooth = true) {
    const c = colonies[selected];
    if (!c) return;
    if (!smooth) {
      camX = -c.x;
      camY = -c.y;
      return;
    }
    camX = lerp(camX, -c.x, 0.18);
    camY = lerp(camY, -c.y, 0.18);
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    dragging = true;
    isInteracting = true;
    lastX = e.clientX; lastY = e.clientY;
  }, { passive: true });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    camX += dx / zoom;
    camY += dy / zoom;
  }, { passive: true });

  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    isInteracting = false;

    // Treat as tap if small movement
    const w = toWorld(e.clientX, e.clientY);
    const idx = pickColony(w.x, w.y);
    if (idx !== -1) {
      selected = idx;
      showInspectorFor(selected);
      addEvent("INFO", `Selected Colony #${idx + 1}`);
      blip("spawn", 0.9);
      if (focusOn) centerOnSelected(true);
    }
  }, { passive: true });

  canvas.addEventListener("pointercancel", () => {
    dragging = false;
    isInteracting = false;
  }, { passive: true });

  // wheel zoom (desktop)
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    isInteracting = true;
    const k = e.deltaY > 0 ? 0.92 : 1.08;
    zoom = clamp(zoom * k, 0.55, 2.8);
    clearTimeout(canvas.__wheelTO);
    canvas.__wheelTO = setTimeout(() => (isInteracting = false), 120);
  }, { passive: false });

  // double tap center (mobile)
  let lastTap = 0;
  canvas.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - lastTap < 280) centerOnSelected(false);
    lastTap = now;
  }, { passive: true });

  // inspector close
  if (closeInspector) {
    closeInspector.addEventListener("click", () => {
      inspector?.classList?.add("hidden");
    });
  }

  // ----------------------------
  // PRNG for stable “space” + colony silhouettes
  // ----------------------------
  function xorshift32(seed) {
    let x = seed | 0;
    return () => {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      return ((x >>> 0) / 4294967296);
    };
  }
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // ----------------------------
  // Background: stars + galaxies (stable, non-glitch)
  // ----------------------------
  const bg = {
    stars1: null,
    stars2: null,
    nebula: null,
    seed: hashStr("WORM-COLONY"),
    intensity: 1.0
  };

  function makeStarLayer(w, h, density, seed, tintHue = 210) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    const rnd = xorshift32(seed);

    g.clearRect(0,0,w,h);
    for (let i = 0; i < density; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = 0.3 + rnd() * 1.6;
      const a = 0.18 + rnd() * 0.75;
      const hue = (tintHue + (rnd() * 60 - 30) + 360) % 360;

      g.fillStyle = `hsla(${hue}, 90%, ${65 + rnd()*25}%, ${a})`;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI*2);
      g.fill();

      // occasional sparkle cross
      if (rnd() < 0.05) {
        g.strokeStyle = `hsla(${hue}, 95%, 80%, ${a*0.55})`;
        g.lineWidth = 0.6;
        g.beginPath();
        g.moveTo(x - 4, y); g.lineTo(x + 4, y);
        g.moveTo(x, y - 4); g.lineTo(x, y + 4);
        g.stroke();
      }
    }
    return c;
  }

  function makeNebula(w, h, seed) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    const rnd = xorshift32(seed);

    g.clearRect(0,0,w,h);
    // big soft blobs
    for (let i = 0; i < 10; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = 140 + rnd() * 260;
      const hue = (180 + rnd()*180) % 360;
      const a = 0.05 + rnd() * 0.10;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `hsla(${hue}, 90%, 55%, ${a})`);
      grad.addColorStop(1, `hsla(${hue}, 90%, 55%, 0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI*2);
      g.fill();
    }

    // faint diagonal galaxy band
    g.save();
    g.translate(w*0.3, h*0.35);
    g.rotate(-0.35);
    const band = g.createLinearGradient(0, 0, w*0.8, 0);
    band.addColorStop(0, "rgba(0,0,0,0)");
    band.addColorStop(0.35, "rgba(180,120,255,.07)");
    band.addColorStop(0.50, "rgba(0,255,191,.06)");
    band.addColorStop(0.65, "rgba(255,43,214,.06)");
    band.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = band;
    g.fillRect(-w*0.2, -80, w*1.2, 160);
    g.restore();

    return c;
  }

  function rebuildBackground() {
    // fixed size textures, independent of pan/zoom (prevents glitch)
    bg.stars1 = makeStarLayer(900, 700, 520, bg.seed ^ 0xA91, 210);
    bg.stars2 = makeStarLayer(900, 700, 280, bg.seed ^ 0xB72, 280);
    bg.nebula = makeNebula(900, 700, bg.seed ^ 0xC33);
  }

  // ----------------------------
  // Colony + worm DNA
  // ----------------------------
  const TEMPS = ["CALM","AGGRESSIVE","CHAOTIC","TOXIC","CURIOUS","ELDRITCH"];
  const BIOMES = ["NEON GARDEN","DEEP SEA","VOID BLOOM","GLASS CAVE","ARC STORM","DUST BELT","SINGULARITY"];
  const STYLES = ["COMET","CROWN","ARC","SPIRAL","DRIFT","TENDRIL","FRACTAL"];

  function newColony(x, y, hue = rand(0, 360), seedText = "") {
    const seed = hashStr(seedText || (Math.random().toString(16).slice(2)));
    const rnd = xorshift32(seed);

    const dna = {
      hue,
      chaos: rand(0.55, 1.45),
      drift: rand(0.55, 1.35),
      aura: rand(0.95, 1.85),
      limbiness: rand(0.25, 1.25),
      curiosity: rand(0.35, 1.25),
      aggression: rand(0.35, 1.35),
      patternBias: rand(0.2, 1.6),
      signature: randi(1000, 9999),
      temperament: TEMPS[randi(0, TEMPS.length-1)],
      biome: BIOMES[randi(0, BIOMES.length-1)],
      style: STYLES[randi(0, STYLES.length-1)],
      seed,
      rnd
    };

    // metaball nodes
    const nodes = Array.from({ length: randi(5, 9) }, () => ({
      ox: rand(-95, 95),
      oy: rand(-95, 95),
      r: rand(70, 150),
      ph: rand(0, Math.PI * 2),
      sp: rand(0.35, 1.15)
    }));

    // organic silhouette params (non-circle)
    const silhouette = {
      baseR: rand(120, 180),
      lobes: randi(4, 9),
      wobA: rand(0.18, 0.42),
      wobB: rand(0.10, 0.28),
      wobC: rand(0.06, 0.18),
      rot: rand(0, Math.PI*2),
      seed
    };

    return {
      id: Math.random().toString(16).slice(2, 6).toUpperCase(),
      x, y,
      vx: rand(-0.18, 0.18),
      vy: rand(-0.18, 0.18),
      dna,
      nodes,
      silhouette,
      worms: [],
      shock: [],
      mutations: [] // for inspector list
    };
  }

  function pickPalette(colHue) {
    const type = ["AURORA","SYNTH","TOXIN","OCEAN","CANDY","EMBER","PRISM"][randi(0,6)];
    const base = colHue;
    const pals = {
      AURORA: [base, (base+40)%360, (base+160)%360],
      SYNTH:  [base, (base+300)%360, (base+90)%360],
      TOXIN:  [120, 90, (base+200)%360],
      OCEAN:  [200, 220, (base+20)%360],
      CANDY:  [320, 285, (base+60)%360],
      EMBER:  [18, 42, (base+340)%360],
      PRISM:  [base, (base+120)%360, (base+240)%360]
    };
    return { type, hues: pals[type] };
  }

  function newWorm(col, big = false) {
    const type = ["DRIFTER", "ORBITER", "HUNTER", "SCOUT"][randi(0, 3)];
    const segCount = big ? randi(18, 30) : randi(12, 22);
    const baseLen = big ? rand(10, 16) : rand(7.2, 12.8);

    const palette = pickPalette(col.dna.hue);
    const stripeFreq = rand(0.35, 1.55) * col.dna.patternBias;
    const shimmer = rand(0.25, 1.15);
    const speckle = rand(0.05, 0.30);
    const hueJitter = rand(18, 140);

    const w = {
      id: Math.random().toString(16).slice(2, 6),
      type,
      paletteType: palette.type,
      hues: palette.hues,
      hueJitter,
      stripeFreq,
      shimmer,
      speckle,
      width: big ? rand(7, 11.5) : rand(4.2, 7.2),
      speed: big ? rand(0.34, 0.70) : rand(0.45, 1.05),
      turn: rand(0.007, 0.02) * col.dna.chaos,
      phase: rand(0, Math.PI * 2),
      limbs: [],
      segs: [],
      isBoss: false,
      dash: { t: rand(8, 14), cd: rand(8, 14), active: 0, dir: 0 }
    };

    // spawn heading with symmetric randomness (prevents “all right”)
    let px = col.x + rand(-75, 75);
    let py = col.y + rand(-75, 75);
    let ang = rand(0, Math.PI * 2);

    for (let i = 0; i < segCount; i++) {
      w.segs.push({ x: px, y: py, a: ang, len: baseLen * rand(0.85, 1.24) });
      px -= Math.cos(ang) * baseLen;
      py -= Math.sin(ang) * baseLen;
      ang += rand(-0.32, 0.32) * col.dna.chaos;
    }

    // some start with limbs
    if (Math.random() < 0.25 * col.dna.limbiness) {
      for (let i = 0; i < randi(1, 2); i++) addLimb(w, col, Math.random() < 0.3);
    }

    return w;
  }

  // ----------------------------
  // Core simulation state
  // ----------------------------
  const colonies = [newColony(0, 0, 150, "GENESIS")];
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], true));

  let bossSpawned = false;

  // ----------------------------
  // Fit view
  // ----------------------------
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
    zoom = clamp(fit * 0.90, 0.55, 1.6);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    camX = -cx;
    camY = -cy;
  }

  // ----------------------------
  // Mechanics: shockwaves, limbs, boss
  // ----------------------------
  function shockwave(col, strength = 1) {
    col.shock.push({ r: 0, v: 3.0 + strength * 1.35, a: 0.9, w: 2.3 + strength * 1.2 });
  }

  function addLimb(w, col, big = false) {
    if (!w.segs.length) return;
    const at = randi(2, w.segs.length - 3);
    w.limbs.push({
      at,
      len: big ? rand(40, 105) : rand(24, 80),
      ang: rand(-1.5, 1.5),
      wob: rand(0.65, 1.8),
      tint: w.hues[randi(0, w.hues.length - 1)]
    });
  }

  function ensureBoss() {
    if (bossSpawned) return;
    if (mcap >= 50000) {
      const c = colonies[0];
      const boss = newWorm(c, true);
      boss.isBoss = true;
      boss.width *= 1.85;
      boss.speed *= 0.72;
      boss.hues = [120, 190, 300]; // very noticeable
      boss.paletteType = "BOSS";
      boss.shimmer = 1.35;
      boss.stripeFreq = 1.2;
      for (let i = 0; i < 6; i++) addLimb(boss, c, true);

      c.worms.push(boss);
      bossSpawned = true;
      shockwave(c, 1.6);
      addEvent("EVENT", "Boss worm emerged");
      blip("boss", 1.5);

      // make background slightly more intense
      bg.intensity = Math.min(1.5, bg.intensity + 0.12);
    }
  }

  // colonies spawn at MC_STEP increments up to MAX_COLONIES
  function trySplitByMcap() {
    while (mcap >= nextSplitAt && colonies.length < MAX_COLONIES) {
      const base = colonies[0];
      const ang = rand(0, Math.PI * 2);
      const dist = rand(260, 520);

      const nc = newColony(
        base.x + Math.cos(ang) * dist,
        base.y + Math.sin(ang) * dist,
        (base.dna.hue + rand(-120, 120) + 360) % 360,
        `C${nextSplitAt}`
      );

      const g = growthScore();
      const starters = clamp(Math.floor(2 + g / 2), 2, 8);
      for (let i = 0; i < starters; i++) nc.worms.push(newWorm(nc, Math.random() < 0.25));

      shockwave(nc, 1.15);
      colonies.push(nc);

      addEvent("EVENT", `New colony formed at ${fmtMoney(nextSplitAt)} MC`);
      blip("spawn", 1.05);

      nextSplitAt += MC_STEP;
      zoomOutToFitAll();
    }
  }

  // ----------------------------
  // Mutations (bigger variety + DNA edits)
  // ----------------------------
  function recordMutation(col, text) {
    col.mutations.unshift(text);
    while (col.mutations.length > 16) col.mutations.pop();
  }

  function mutateRandom() {
    const c = colonies[randi(0, colonies.length - 1)];
    if (!c?.worms?.length) return;

    const w = c.worms[randi(0, c.worms.length - 1)];
    const r = Math.random();

    const kinds = [
      "Chromatic shift",
      "Stripe re-code",
      "Shimmer spike",
      "Speckle bloom",
      "Limb growth",
      "Aggression surge",
      "Curiosity drift",
      "Turn instability",
      "Body thickening",
      "Speed recalibration"
    ];

    let msg = "";

    if (r < 0.12) {
      // colony DNA change
      c.dna.chaos = clamp(c.dna.chaos * rand(0.92, 1.12), 0.35, 2.1);
      c.dna.aura = clamp(c.dna.aura * rand(0.94, 1.18), 0.6, 2.4);
      c.dna.patternBias = clamp(c.dna.patternBias * rand(0.9, 1.25), 0.35, 2.6);
      msg = `Colony DNA rebalanced • σ${c.dna.signature}`;
      addEvent("MUTATION", msg);
      recordMutation(c, msg);
      blip("mut", 1.05);
      if (Math.random() < 0.35) shockwave(c, 0.95);
      return;
    }

    if (r < 0.26) {
      // palette + hues
      const pal = pickPalette(c.dna.hue);
      w.paletteType = pal.type;
      w.hues = pal.hues;
      w.hueJitter = clamp(w.hueJitter * rand(0.85, 1.25), 12, 190);
      msg = `${kinds[0]} • Worm ${w.id} → ${w.paletteType}`;
    } else if (r < 0.40) {
      // stripes
      w.stripeFreq = clamp(w.stripeFreq * rand(0.7, 1.45), 0.2, 3.0);
      msg = `${kinds[1]} • Worm ${w.id}`;
    } else if (r < 0.52) {
      // shimmer
      w.shimmer = clamp(w.shimmer * rand(0.7, 1.5), 0.05, 2.2);
      msg = `${kinds[2]} • Worm ${w.id}`;
    } else if (r < 0.64) {
      // speckle
      w.speckle = clamp(w.speckle * rand(0.7, 1.6), 0.02, 0.65);
      msg = `${kinds[3]} • Worm ${w.id}`;
    } else if (r < 0.76) {
      // limb
      addLimb(w, c, Math.random() < 0.35);
      msg = `${kinds[4]} • Worm ${w.id}`;
    } else if (r < 0.86) {
      // speed
      w.speed = clamp(w.speed * rand(0.9, 1.35), 0.22, 1.55);
      msg = `${kinds[9]} • Worm ${w.id}`;
    } else if (r < 0.93) {
      // width
      w.width = clamp(w.width * rand(0.9, 1.25), 3.2, 18);
      msg = `${kinds[8]} • Worm ${w.id}`;
    } else {
      // behavior
      w.turn = clamp(w.turn * rand(0.75, 1.5), 0.004, 0.045);
      msg = `${kinds[7]} • Worm ${w.id}`;
    }

    addEvent("MUTATION", msg);
    recordMutation(c, msg);
    blip("mut", 0.95);

    if (Math.random() < 0.20) shockwave(c, 0.85);
  }

  // ----------------------------
  // Milestone events
  // ----------------------------
  function applyMilestones() {
    for (const m of milestoneEvents) {
      if (mcap >= m.at && !firedMilestones.has(m.at)) {
        firedMilestones.add(m.at);

        const msg = `${m.name} at ${fmtMoney(m.at)} MC`;
        addEvent("EVENT", msg);
        blip(m.kind === "boss" ? "boss" : "milestone", 1.35);
        bg.intensity = Math.min(1.8, bg.intensity + 0.12);

        // Visual effects
        const c = colonies[selected] || colonies[0];
        shockwave(c, 1.45);

        // Special: Chromatic bloom boosts palettes
        if (m.name === "Chromatic Bloom") {
          for (const col of colonies) col.dna.patternBias = clamp(col.dna.patternBias * 1.12, 0.35, 3.0);
        }

        // Special: Nebula surge makes auras stronger
        if (m.name === "Nebula Surge") {
          for (const col of colonies) col.dna.aura = clamp(col.dna.aura * 1.10, 0.6, 3.0);
        }
      }
    }
  }

  // ----------------------------
  // Worm behavior (fix “rushing right”)
  // ----------------------------
  function wormBehavior(col, w, time, dt) {
    const head = w.segs[0];

    // balanced noise (no global bias)
    const n1 = Math.sin(time * 0.0016 + w.phase) * 0.18;
    const n2 = Math.cos(time * 0.0012 - w.phase * 1.7) * 0.14;
    head.a += (Math.random() - 0.5) * w.turn + (n1 + n2) * 0.16;

    // orbit/seek behavior around colony
    const dx = col.x - head.x;
    const dy = col.y - head.y;
    const toward = Math.atan2(dy, dx);

    const temp = col.dna.temperament;
    const aggression = col.dna.aggression;
    const curiosity = col.dna.curiosity;

    if (w.type === "DRIFTER") {
      head.a = head.a * 0.94 + toward * 0.06;
    } else if (w.type === "ORBITER") {
      const dir = (Math.sin(time * 0.0008 + w.phase) > 0 ? 1 : -1);
      const orbit = toward + dir * (0.9 + 0.25 * curiosity);
      head.a = head.a * 0.90 + orbit * 0.10;
    } else if (w.type === "SCOUT") {
      // scouts wander more
      const wander = toward + Math.sin(time * 0.0024 + w.phase) * (0.65 + 0.25 * curiosity);
      head.a = head.a * 0.84 + wander * 0.16;
    } else {
      // hunter: bites toward center with some chaos
      const bite = toward + Math.sin(time * 0.0032 + w.phase) * (0.35 + 0.25 * aggression);
      head.a = head.a * 0.86 + bite * 0.14;
    }

    // boss dash charge every 8–14s
    if (w.isBoss) {
      w.dash.t -= dt;
      if (w.dash.t <= 0 && w.dash.active <= 0) {
        w.dash.active = 0.38; // dash duration
        w.dash.dir = toward + (Math.random() > 0.5 ? 1 : -1) * 0.55;
        w.dash.cd = rand(8, 14);
        w.dash.t = w.dash.cd;

        shockwave(col, 1.75);
        addEvent("EVENT", "Boss charge dash");
        blip("boss", 1.55);
      }
      if (w.dash.active > 0) {
        w.dash.active -= dt;
        head.a = head.a * 0.78 + w.dash.dir * 0.22;
      }
    }

    // movement
    const dashBoost = (w.isBoss && w.dash.active > 0) ? 2.8 : 1.0;
    const speedBoost = w.isBoss ? 1.05 : 1.0;

    head.x += Math.cos(head.a) * w.speed * 2.2 * dashBoost * speedBoost;
    head.y += Math.sin(head.a) * w.speed * 2.2 * dashBoost * speedBoost;

    // keep near colony; bounce inward
    const d = Math.hypot(head.x - col.x, head.y - col.y);
    const maxR = 320 + 70 * col.dna.chaos;
    if (d > maxR) {
      const pull = 0.90;
      head.x = col.x + (head.x - col.x) * pull;
      head.y = col.y + (head.y - col.y) * pull;
      head.a += Math.PI * 0.65 * (Math.random() > 0.5 ? 1 : -1);
    }

    // segment follow (smooth)
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
  }

  // ----------------------------
  // Population scaling
  // ----------------------------
  let mutTimer = 0;
  let spawnTimer = 0;

  function maybeSpawnWorms(dt) {
    const g = growthScore();
    const target = clamp(Math.floor(3 + g * 2.4), 4, 120);

    const total = colonies.reduce((a, c) => a + c.worms.length, 0);
    if (total >= target) return;

    spawnTimer += dt;
    const rate = clamp(1.2 - g * 0.045, 0.14, 1.2);
    if (spawnTimer >= rate) {
      spawnTimer = 0;
      const c = colonies[selected] || colonies[0];
      c.worms.push(newWorm(c, Math.random() < 0.18));
      if (Math.random() < 0.35) shockwave(c, 0.65);
      addEvent("INFO", "New worm hatched");
      blip("spawn", 0.85);
    }
  }

  // ----------------------------
  // Stats / inspector
  // ----------------------------
  function updateStats() {
    if (elBuyers) elBuyers.textContent = String(buyers);
    if (elVolume) elVolume.textContent = fmtMoney(volume);
    if (elMcap) elMcap.textContent = fmtMoney(mcap);
    if (elColonies) elColonies.textContent = String(colonies.length);
    if (elWorms) {
      const total = colonies.reduce((a, c) => a + c.worms.length, 0);
      elWorms.textContent = String(total);
    }
  }

  function showInspectorFor(idx) {
    const c = colonies[idx];
    if (!c || !inspector) return;

    inspector.classList.remove("hidden");
    if (selName) selName.textContent = `#${idx + 1}`;
    if (dnaVal) dnaVal.textContent = `σ${c.dna.signature} • H${Math.round(c.dna.hue)} • P${c.dna.patternBias.toFixed(2)} • A${c.dna.aura.toFixed(2)}`;
    if (tempVal) tempVal.textContent = c.dna.temperament;
    if (biomeVal) biomeVal.textContent = c.dna.biome;
    if (styleVal) styleVal.textContent = c.dna.style;

    if (mutList) {
      mutList.innerHTML = "";
      const list = c.mutations.length ? c.mutations : ["No mutations yet."];
      for (const m of list) {
        const d = document.createElement("div");
        d.textContent = m;
        mutList.appendChild(d);
      }
    }
  }

  // ----------------------------
  // Rendering helpers
  // ----------------------------
  function aura(x, y, r, hue, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue},95%,65%,${a})`);
    g.addColorStop(0.55, `hsla(${hue},95%,60%,${a*0.35})`);
    g.addColorStop(1, `hsla(${hue},95%,65%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBackground(time) {
    // paint background in screen space (stable, no jitter)
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // nebula
    if (bg.nebula) {
      ctx.globalAlpha = 0.85 * bg.intensity;
      ctx.drawImage(bg.nebula, (W - bg.nebula.width)/2, (H - bg.nebula.height)/2);
    }

    // far stars (tiny parallax)
    const px = (Math.sin(time*0.00005) * 12);
    const py = (Math.cos(time*0.00006) * 10);
    if (bg.stars1) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(bg.stars1, px, py);
      ctx.drawImage(bg.stars1, px - bg.stars1.width, py);
      ctx.drawImage(bg.stars1, px, py - bg.stars1.height);
    }

    // brighter stars
    if (bg.stars2) {
      ctx.globalAlpha = 0.75;
      ctx.drawImage(bg.stars2, -px*0.6, -py*0.6);
      ctx.drawImage(bg.stars2, -px*0.6 - bg.stars2.width, -py*0.6);
      ctx.drawImage(bg.stars2, -px*0.6, -py*0.6 - bg.stars2.height);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // organic colony silhouette (non-circle)
  function drawColonySilhouette(col, time) {
    const s = col.silhouette;
    const hue = col.dna.hue;

    // outer aura
    if (!isInteracting) {
      aura(col.x, col.y, (s.baseR + 80) * col.dna.aura, hue, 0.16);
      aura(col.x, col.y, (s.baseR + 40) * col.dna.aura, (hue + 40) % 360, 0.10);
    } else {
      aura(col.x, col.y, 170 * col.dna.aura, hue, 0.12);
    }

    // metaball-ish glow points (reduced during interaction)
    if (!isInteracting) {
      for (let i = 0; i < col.nodes.length; i++) {
        const n = col.nodes[i];
        const x = col.x + n.ox + Math.sin(time * 0.001 * n.sp + n.ph) * 14;
        const y = col.y + n.oy + Math.cos(time * 0.001 * n.sp + n.ph) * 14;
        aura(x, y, n.r * 0.95, (hue + i * 18) % 360, 0.10);
      }
    }

    // silhouette outline (multi-lobed)
    const steps = 56;
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = `hsla(${hue}, 95%, 68%, ${isInteracting ? 0.22 : 0.35})`;
    ctx.beginPath();

    const rot = s.rot + time * 0.00010 * col.dna.chaos;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const wob =
        Math.sin(a * s.lobes + rot) * (s.baseR * s.wobA) +
        Math.sin(a * (s.lobes * 2.2) - rot * 1.3) * (s.baseR * s.wobB) +
        Math.sin(a * (s.lobes * 3.3) + rot * 0.7) * (s.baseR * s.wobC);

      const rr = (s.baseR + wob) * col.dna.aura;
      const px = col.x + Math.cos(a + rot) * rr;
      const py = col.y + Math.sin(a + rot) * rr;

      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // subtle tendrils “limbs” of colony
    if (!isInteracting) {
      const tendrils = clamp(Math.floor(2 + col.dna.limbiness * 3), 2, 8);
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < tendrils; i++) {
        const a = (i / tendrils) * Math.PI * 2 + rot * 0.6;
        const rr = (s.baseR * 0.75 + Math.sin(time*0.0016 + i)*18) * col.dna.aura;
        const x0 = col.x + Math.cos(a) * rr;
        const y0 = col.y + Math.sin(a) * rr;
        const len = 40 + col.dna.limbiness * 60;
        const x1 = x0 + Math.cos(a + Math.sin(time*0.002 + i)*0.3) * len;
        const y1 = y0 + Math.sin(a + Math.sin(time*0.002 + i)*0.3) * len;

        ctx.strokeStyle = `hsla(${(hue + 40) % 360}, 95%, 65%, 0.18)`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(
          (x0 + x1) * 0.5 + Math.sin(time*0.002 + i) * 12,
          (y0 + y1) * 0.5 + Math.cos(time*0.002 + i) * 12,
          x1, y1
        );
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // shockwaves
    for (const sw of col.shock) {
      ctx.strokeStyle = `hsla(${hue}, 92%, 62%, ${sw.a})`;
      ctx.lineWidth = sw.w;
      ctx.beginPath();
      ctx.arc(col.x, col.y, sw.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // tiny “selection” hint (not a big circle)
    if (col === colonies[selected]) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `hsla(${hue}, 95%, 70%, 0.45)`;
      ctx.beginPath();
      ctx.arc(col.x, col.y, 6, 0, Math.PI*2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
  }

  // worm color at segment index
  function wormColor(w, t) {
    const hues = w.hues;
    // stripe pattern along time + index, blended across palette
    const s = (Math.sin(t * 0.0014 + w.phase) * 0.5 + 0.5);
    const a = hues[0];
    const b = hues[1];
    const c = hues[2];
    const h1 = a + (b - a) * s;
    const h2 = b + (c - b) * (1 - s);
    const h = ((h1 + h2) * 0.5 + (Math.random() - 0.5) * 2) % 360;
    return (h + 360) % 360;
  }

  function drawWorm(w, time) {
    const pts = w.segs;
    if (!pts.length) return;

    const glowStrong = w.isBoss ? 0.30 : 0.14;
    const coreAlpha = w.isBoss ? 0.98 : 0.92;

    // Outer glow (skip while interacting to keep smooth)
    if (!isInteracting) {
      ctx.globalCompositeOperation = "lighter";
      const gh = wormColor(w, time);
      ctx.strokeStyle = `hsla(${gh}, 95%, 62%, ${glowStrong})`;
      ctx.lineWidth = w.width + (w.isBoss ? 10 : 7);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    // Core multi-color stroke (more detailed: segmented gradient)
    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];

      // stripe control
      const stripe = Math.sin(i * w.stripeFreq + time * 0.002 + w.phase) * 0.5 + 0.5;
      const hueBase = wormColor(w, time);
      const hue = (hueBase + (stripe - 0.5) * w.hueJitter) % 360;

      // shimmer highlight
      const sh = (Math.sin(time * 0.003 + i * 0.6 + w.phase) * 0.5 + 0.5) * w.shimmer;

      ctx.strokeStyle = `hsla(${(hue + 360) % 360}, 95%, ${58 + sh * 18}%, ${coreAlpha})`;
      ctx.lineWidth = w.width;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();

      // inner highlight line (gives “detail”)
      if (!isInteracting && i % 2 === 0) {
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = `hsla(${(hue + 25) % 360}, 95%, 75%, ${0.14 + sh * 0.08})`;
        ctx.lineWidth = Math.max(1.2, w.width * 0.34);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }

      // biolum speckles
      if (!isInteracting && Math.random() < w.speckle * 0.06) {
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `hsla(${(hue + 40) % 360}, 95%, 72%, 0.55)`;
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, 1.2 + Math.random() * 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }
    }

    // beads (less frequent during interaction)
    if (!isInteracting) {
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < pts.length; i += 4) {
        const p = pts[i];
        const stripe = Math.sin(i * w.stripeFreq + time * 0.002 + w.phase) * 0.5 + 0.5;
        const hue = (wormColor(w, time) + (stripe - 0.5) * w.hueJitter) % 360;
        const r = Math.max(2.0, w.width * 0.34);

        ctx.fillStyle = `hsla(${(hue + 360) % 360}, 95%, 70%, 0.40)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 1.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `hsla(${(hue + 25) % 360}, 95%, 78%, 0.55)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // limbs
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

        const hue = (L.tint ?? w.hues[0]) % 360;
        ctx.strokeStyle = `hsla(${hue}, 95%, 66%, ${isInteracting ? 0.32 : 0.52})`;
        ctx.lineWidth = Math.max(2, w.width * 0.38);

        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.quadraticCurveTo(
          base.x + Math.cos(baseAng) * (L.len * 0.55),
          base.y + Math.sin(baseAng) * (L.len * 0.55),
          lx,
          ly
        );
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    // boss crown pulse
    if (w.isBoss && !isInteracting) {
      ctx.globalCompositeOperation = "lighter";
      const head = pts[0];
      const pulse = (Math.sin(time * 0.004 + w.phase) * 0.5 + 0.5);
      const r = 14 + pulse * 10;
      const hue = 120;

      aura(head.x, head.y, r * 3.2, hue, 0.18 + pulse * 0.12);
      ctx.strokeStyle = `hsla(${hue}, 95%, 70%, ${0.35 + pulse * 0.20})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(head.x, head.y, r, 0, Math.PI*2);
      ctx.stroke();

      ctx.globalCompositeOperation = "source-over";
    }
  }

  // ----------------------------
  // Controls (kept simple: no buy/sell buttons)
  // ----------------------------
  function bind(action, fn) {
    const btn = document.querySelector(`button[data-action="${action}"]`);
    if (btn) btn.addEventListener("click", fn);
  }

  bind("feed", () => {
    volume += rand(40, 150);
    mcap += rand(180, 640);
    addEvent("INFO", "Nutrients absorbed");
    blip("spawn", 0.8);
    shockwave(colonies[selected] || colonies[0], 0.65);
  });

  bind("storm", () => {
    const dv = rand(5000, 22000);
    const dm = rand(3000, 12000);
    volume += dv;
    mcap += dm;
    addEvent("EVENT", `Volume Storm • +${fmtMoney(dv)} vol`);
    blip("milestone", 1.0);
    shockwave(colonies[0], 1.1);
  });

  bind("mutate", () => mutateRandom());

  bind("focus", () => {
    focusOn = !focusOn;
    const btn = document.querySelector(`button[data-action="focus"]`);
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
      addEvent("INFO", "Capture saved");
    } catch {
      addEvent("WARN", "Capture blocked — use iOS screenshot/share");
    }
  });

  bind("reset", () => location.reload());

  // ----------------------------
  // Main loop (capped render fps)
  // ----------------------------
  let last = performance.now();
  let renderAccum = 0;
  const RENDER_FPS = 40;
  const RENDER_DT = 1 / RENDER_FPS;

  function step(dt, time) {
    ensureBoss();
    trySplitByMcap();
    applyMilestones();

    // colony drift
    for (const c of colonies) {
      c.vx += rand(-0.02, 0.02) * c.dna.drift;
      c.vy += rand(-0.02, 0.02) * c.dna.drift;
      c.vx *= 0.985;
      c.vy *= 0.985;
      c.x += c.vx;
      c.y += c.vy;

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

    // auto mutations based on activity
    mutTimer += dt;
    const g = growthScore();
    const mutRate = clamp(2.2 - g * 0.08, 0.35, 2.2);
    if (mutTimer >= mutRate) {
      mutTimer = 0;
      if (Math.random() < 0.62) mutateRandom();
    }

    maybeSpawnWorms(dt);
    updateStats();

    // keep inspector updated when visible
    if (inspector && !inspector.classList.contains("hidden")) {
      showInspectorFor(selected);
    }
  }

  function render(time) {
    drawBackground(time);

    ctx.save();
    // camera
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(camX, camY);

    // colonies
    for (const c of colonies) drawColonySilhouette(c, time);

    // worms
    for (const c of colonies) {
      for (const w of c.worms) drawWorm(w, time);
    }

    ctx.restore();
  }

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

  // ----------------------------
  // Boot
  // ----------------------------
  function boot() {
    resizeCanvas();
    rebuildBackground();
    zoomOutToFitAll();
    updateStats();
    setToast("Simulation ready", 900);
    if (simStatus) simStatus.textContent = "Simulation Active";
    addEvent("INFO", "Simulation ready");
    requestAnimationFrame(tick);
  }

  window.addEventListener("load", boot);
  if (document.readyState === "complete") boot();
})();
