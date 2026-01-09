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

  // HARD GUARD: never feed non-finite values to canvas
  const fin = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
  const finPos = (v) => fin(v, 0);
  const finScale = (v) => fin(v, 1);
  const finRadius = (v) => (Number.isFinite(v) && v > 0 ? v : 1);
  const finLine = (v) => (Number.isFinite(v) && v > 0 ? v : 1);

  // ---------- DOM ----------
  const canvas = $("simCanvas") || $("c");
  if (!canvas) return showErr("Canvas not found (expected #simCanvas).");

  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!ctx) return showErr("Canvas context failed.");

  const elBuyers = $("buyers");
  const elVolume = $("volume");
  const elMcap = $("mcap");
  const elColonies = $("colonies");
  const elWorms = $("worms");
  const logEl = $("log");

  // Optional selection UI (if your HTML has these IDs)
  const elSelName  = $("selName");  // e.g. "Colony #1"
  const elSelDNA   = $("selDNA");   // e.g. "CALM • TOXIC"
  const elSelBiome = $("selBiome"); // e.g. "NEON GARDEN"
  const elSelStyle = $("selStyle"); // e.g. "COMET / ARC"

  function setSelectedUI(c, index) {
    if (!c) return;
    if (elSelName)  elSelName.textContent  = `Colony #${index + 1}`;
    if (elSelDNA)   elSelDNA.textContent   = `${c.dna.temperament}`;
    if (elSelBiome) elSelBiome.textContent = `${c.dna.biome}`;
    if (elSelStyle) elSelStyle.textContent = `${c.dna.style}`;
  }

  // ---------- Log (cap + spam merge) ----------
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

  // ---------- Canvas sizing (iOS safe + performance) ----------
  let W = 1, H = 1, DPR = 1;

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();

    // If layout isn't ready yet, defer (prevents 0x0 => NaN later)
    const cssW = rect.width;
    const cssH = rect.height;

    if (!Number.isFinite(cssW) || !Number.isFinite(cssH) || cssW < 2 || cssH < 2) {
      // Try again on next frame
      requestAnimationFrame(resizeCanvas);
      return;
    }

    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1)); // cap retina cost

    W = Math.max(1, cssW);
    H = Math.max(1, cssH);

    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);

    // reset transform to match CSS pixels
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 180));
  setTimeout(resizeCanvas, 0);

  // ---------- Economy / triggers ----------
  let buyers = 0;
  let volume = 0;
  let mcap = 0;

  const MAX_COLONIES = 8;
  const MC_STEP = 50000;
  let nextSplitAt = MC_STEP;
  let bossSpawned = false;

  function growthScore() {
    return (mcap / 20000) + (volume / 6000) + (buyers / 10);
  }

  // ---------- Camera + interaction ----------
  let camX = 0, camY = 0, zoom = 0.78; // start a bit zoomed out
  let dragging = false, lastX = 0, lastY = 0;
  let selected = 0;
  let focusOn = false;
  let isInteracting = false;

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
    lastX = e.clientX; lastY = e.clientY;
  }, { passive: true });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    const z = finScale(zoom);
    camX = finPos(camX) + dx / z;
    camY = finPos(camY) + dy / z;
  }, { passive: true });

  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    isInteracting = false;

    // treat as tap if movement was small
    const w = toWorld(e.clientX, e.clientY);
    const idx = pickColony(w.x, w.y);
    if (idx !== -1) {
      selected = idx;
      setSelectedUI(colonies[selected], selected);
      log(`Selected Colony #${idx + 1}`, "INFO");
      if (focusOn) centerOnSelected(false);
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
    zoom = clamp(finScale(zoom) * k, 0.55, 2.6);
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

    return {
      id: Math.random().toString(16).slice(2, 6).toUpperCase(),
      x, y,
      vx: rand(-0.18, 0.18),
      vy: rand(-0.18, 0.18),
      dna,
      nodes,
      worms: [],
      shock: []
    };
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

    // Randomize initial heading so they don't bias right
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

  // ---------- Fit view (zoomed out start) ----------
  function zoomOutToFitAll() {
    // IMPORTANT: if W/H not ready yet, skip (prevents NaN)
    if (!Number.isFinite(W) || !Number.isFinite(H) || W < 2 || H < 2) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const pad = 520; // more space feel

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

  // ---------- Events / mechanics ----------
  function shockwave(col, strength = 1) {
    col.shock.push({ r: 0, v: 2.6 + strength * 1.2, a: 0.85, w: 2 + strength });
  }

  function addLimb(w, col, big = false) {
    if (!w.segs.length) return;
    const at = randi(2, w.segs.length - 3);
    w.limbs.push({
      at,
      len: big ? rand(35, 90) : rand(22, 70),
      ang: rand(-1.3, 1.3),
      wob: rand(0.7, 1.6)
    });
  }

  function ensureBoss() {
    if (bossSpawned) return;
    if (mcap >= 50000) {
      const c = colonies[0];
      const boss = newWorm(c, true);
      boss.isBoss = true;
      boss.width *= 1.6;
      boss.speed *= 0.7;
      boss.hue = 120;
      for (let i = 0; i < 4; i++) addLimb(boss, c, true);
      c.worms.push(boss);
      bossSpawned = true;
      shockwave(c, 1.4);
      log("Boss worm emerged", "EVENT");
    }
  }

  function trySplitByMcap() {
    while (mcap >= nextSplitAt && colonies.length < MAX_COLONIES) {
      const base = colonies[0];
      const ang = rand(0, Math.PI * 2);
      const dist = rand(300, 520);
      const nc = newColony(
        base.x + Math.cos(ang) * dist,
        base.y + Math.sin(ang) * dist,
        (base.dna.hue + rand(-90, 90) + 360) % 360
      );

      const g = growthScore();
      const starters = clamp(Math.floor(2 + g / 2), 2, 6);
      for (let i = 0; i < starters; i++) nc.worms.push(newWorm(nc, Math.random() < 0.25));

      shockwave(nc, 1.1);
      colonies.push(nc);

      log(`New colony spawned at ${fmt(nextSplitAt)} MC`, "EVENT");
      nextSplitAt += MC_STEP;

      // keep view a bit more zoomed out as colonies grow
      zoomOutToFitAll();
    }
  }

  function mutateRandom() {
    const c = colonies[randi(0, colonies.length - 1)];
    if (!c?.worms?.length) return;
    const w = c.worms[randi(0, c.worms.length - 1)];
    const r = Math.random();

    if (r < 0.30) {
      w.hue = (w.hue + rand(30, 140)) % 360;
      log(`Color shift • Worm ${w.id} (Colony #${colonies.indexOf(c) + 1})`, "MUTATION");
    } else if (r < 0.56) {
      w.speed *= rand(1.05, 1.25);
      log(`Aggression spike • Worm ${w.id}`, "MUTATION");
    } else if (r < 0.78) {
      w.width = clamp(w.width * rand(1.05, 1.25), 3.5, 16);
      log(`Body growth • Worm ${w.id}`, "MUTATION");
    } else {
      addLimb(w, c, Math.random() < 0.35);
      log(`Limb growth • Worm ${w.id}`, "MUTATION");
    }

    if (Math.random() < 0.22) shockwave(c, 0.9);
  }

  // ---------- Worm population scaling ----------
  let mutTimer = 0;
  let spawnTimer = 0;

  function maybeSpawnWorms(dt) {
    const g = growthScore();
    const target = clamp(Math.floor(3 + g * 2.2), 3, 80);

    const total = colonies.reduce((a, c) => a + c.worms.length, 0);
    if (total >= target) return;

    spawnTimer += dt;
    const rate = clamp(1.2 - g * 0.04, 0.15, 1.2);
    if (spawnTimer >= rate) {
      spawnTimer = 0;
      const c = colonies[selected] || colonies[0];
      c.worms.push(newWorm(c, Math.random() < 0.18));
      if (Math.random() < 0.35) shockwave(c, 0.6);
      log("New worm hatched", "INFO");
    }
  }

  // ---------- Controls ----------
  function bind(action, fn) {
    const btn = document.querySelector(`button[data-action="${action}"]`);
    if (btn) btn.addEventListener("click", fn);
  }

  bind("feed", () => {
    volume += rand(20, 90);
    mcap += rand(120, 460);
    log("Feed + nutrients", "INFO");
  });

  bind("smallBuy", () => {
    buyers += 1;
    const dv = rand(180, 900);
    const dm = rand(900, 3200);
    volume += dv;
    mcap += dm;
    log(`Buy • +1 buyers • +${fmt(dv)} vol • +${fmt(dm)} MC`, "INFO");
    if (Math.random() < 0.3) shockwave(colonies[0], 0.55);
  });

  bind("whaleBuy", () => {
    const b = randi(2, 5);
    const dv = rand(2500, 8500);
    const dm = rand(9000, 22000);
    buyers += b;
    volume += dv;
    mcap += dm;
    shockwave(colonies[0], 1.2);
    log(`Whale Buy • +${b} buyers • +${fmt(dv)} vol • +${fmt(dm)} MC`, "EVENT");
  });

  bind("sell", () => {
    const dv = rand(600, 2600);
    const dm = rand(2200, 9000);
    volume = Math.max(0, volume - dv);
    mcap = Math.max(0, mcap - dm);
    log(`Sell-off • -${fmt(dv)} vol • -${fmt(dm)} MC`, "WARN");
  });

  bind("storm", () => {
    const dv = rand(5000, 18000);
    const dm = rand(2000, 8000);
    volume += dv;
    mcap += dm;
    shockwave(colonies[0], 1.0);
    log(`Volume Storm • +${fmt(dv)} vol • +${fmt(dm)} MC`, "EVENT");
  });

  bind("mutate", () => mutateRandom());

  bind("focus", () => {
    focusOn = !focusOn;
    const btn = document.querySelector(`button[data-action="focus"]`);
    if (btn) btn.textContent = `Focus: ${focusOn ? "On" : "Off"}`;
    if (focusOn) centerOnSelected(true);
  });

  bind("zoomIn", () => (zoom = clamp(finScale(zoom) * 1.12, 0.55, 2.6)));
  bind("zoomOut", () => (zoom = clamp(finScale(zoom) * 0.88, 0.55, 2.6)));

  bind("capture", () => {
    try {
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "worm_colony.png";
      a.click();
      log("Capture saved", "INFO");
    } catch {
      log("Capture blocked by iOS — try screenshot/share", "WARN");
    }
  });

  bind("reset", () => location.reload());

  // ---------- Stats update ----------
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

  // ---------- Background: stars + galaxies + grid (drawn in-canvas, no scroll glitch) ----------
  const STAR_COUNT = 520;
  const stars = Array.from({ length: STAR_COUNT }, () => ({
    x: rand(-2200, 2200),
    y: rand(-2200, 2200),
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
    // Draw in world space so it moves with camera smoothly
    // (no CSS background = no “grid glitch” while scrolling)
    const t = time * 0.001;

    // galaxies (soft nebula blobs)
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

    // subtle grid (lighter + stable)
    const grid = 240;
    const left = -camX - (W / 2) / finScale(zoom);
    const right = -camX + (W / 2) / finScale(zoom);
    const top = -camY - (H / 2) / finScale(zoom);
    const bottom = -camY + (H / 2) / finScale(zoom);

    const startX = Math.floor(left / grid) * grid;
    const endX = Math.floor(right / grid) * grid;
    const startY = Math.floor(top / grid) * grid;
    const endY = Math.floor(bottom / grid) * grid;

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += grid) {
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += grid) {
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
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

    // better auras
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

    // outline wobble ring
    const R = 135;
    ctx.strokeStyle = `hsla(${baseHue}, 90%, 65%, .26)`;
    ctx.lineWidth = 1.6;
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

    // outer glow (skip during interaction)
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

    // core
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = `hsla(${w.hue}, 95%, 65%, ${w.isBoss ? 0.98 : 0.9})`;
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(finPos(pts[0].x), finPos(pts[0].y));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(finPos(pts[i].x), finPos(pts[i].y));
    ctx.stroke();

    // beads (disabled while interacting)
    if (!isInteracting) {
      for (let i = 0; i < pts.length; i += 4) {
        const p = pts[i];
        const r = Math.max(2.2, lw * 0.35);
        ctx.fillStyle = `hsla(${(w.hue + 20) % 360}, 95%, 65%, .82)`;
        ctx.beginPath();
        ctx.arc(finPos(p.x), finPos(p.y), finRadius(r), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // limbs
    if (w.limbs?.length) {
      ctx.globalCompositeOperation = isInteracting ? "source-over" : "lighter";
      for (const L of w.limbs) {
        const at = clamp(L.at, 0, pts.length - 1);
        const base = pts[at];
        const baseAng =
          fin(base.a, 0) +
          L.ang +
          Math.sin(time * 0.002 * L.wob + w.phase) * 0.35;

        const lx = finPos(base.x) + Math.cos(baseAng) * L.len;
        const ly = finPos(base.y) + Math.sin(baseAng) * L.len;

        ctx.strokeStyle = `hsla(${(w.hue + 40) % 360}, 95%, 66%, ${isInteracting ? 0.35 : 0.55})`;
        ctx.lineWidth = finLine(Math.max(2, lw * 0.35));
        ctx.beginPath();
        ctx.moveTo(finPos(base.x), finPos(base.y));
        ctx.quadraticCurveTo(
          finPos(base.x) + Math.cos(baseAng) * (L.len * 0.55),
          finPos(base.y) + Math.sin(baseAng) * (L.len * 0.55),
          finPos(lx),
          finPos(ly)
        );
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }

  // ---------- Simulation step ----------
  function wormBehavior(col, w, time) {
    const head = w.segs[0];

    // random walk + toward colony center + orbit variety
    const jitter = Math.sin(time * 0.002 + w.phase) * 0.12;
    head.a += (Math.random() - 0.5) * w.turn + jitter;

    const dx = col.x - head.x;
    const dy = col.y - head.y;
    const toward = Math.atan2(dy, dx);

    // big fix for “everyone rushing right”:
    // force each worm to have its own orbit direction & bias
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

    const boost = w.isBoss ? 2.0 : 1.0;
    head.x += Math.cos(head.a) * w.speed * 2.2 * boost;
    head.y += Math.sin(head.a) * w.speed * 2.2 * boost;

    const d = Math.hypot(head.x - col.x, head.y - col.y);
    if (d > 280) {
      // steer back inward
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

  function step(dt, time) {
    ensureBoss();
    trySplitByMcap();

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
        s.a *= 0.96;
      }
      c.shock = c.shock.filter((s) => s.a > 0.06);
    }

    for (const c of colonies) {
      for (const w of c.worms) wormBehavior(c, w, time);
    }

    if (focusOn) centerOnSelected(false);

    // auto mutations based on activity
    mutTimer += dt;
    const g = growthScore();
    const mutRate = clamp(2.2 - g * 0.08, 0.4, 2.2);
    if (mutTimer >= mutRate) {
      mutTimer = 0;
      if (Math.random() < 0.65) mutateRandom();
    }

    maybeSpawnWorms(dt);
    updateStats();
  }

  function render(time) {
    // SAFETY: if something somehow goes non-finite, reset
    zoom = clamp(finScale(zoom), 0.55, 2.6);
    camX = finPos(camX);
    camY = finPos(camY);

    ctx.clearRect(0, 0, W, H);
    ctx.save();

    // camera
    ctx.translate(finPos(W / 2), finPos(H / 2));
    ctx.scale(finScale(zoom), finScale(zoom));
    ctx.translate(finPos(camX), finPos(camY));

    // background drawn in world space (no scroll glitch)
    drawSpaceBG(time);

    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];

      irregularBlob(c, time);

      if (i === selected) {
        ctx.strokeStyle = `hsla(${c.dna.hue}, 95%, 65%, .55)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(finPos(c.x), finPos(c.y), finRadius(105 * c.dna.aura), 0, Math.PI * 2);
        ctx.stroke();
      }

      for (const s of c.shock) {
        ctx.strokeStyle = `hsla(${c.dna.hue}, 92%, 62%, ${clamp(s.a, 0, 1)})`;
        ctx.lineWidth = finLine(s.w);
        ctx.beginPath();
        ctx.arc(finPos(c.x), finPos(c.y), finRadius(s.r), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    for (const c of colonies) {
      for (const w of c.worms) drawWorm(w, time);
    }

    ctx.restore();
    dbg.textContent = "JS LOADED ✓ (rendering)";
  }

  // ---------- Main loop (performance throttles) ----------
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

  // ---------- Boot ----------
  function boot() {
    try {
      resizeCanvas();
      // delay fit slightly so iOS layout is fully computed
      setTimeout(() => {
        resizeCanvas();
        zoomOutToFitAll();
        centerOnSelected(true);
      }, 60);

      updateStats();
      log("Simulation ready", "INFO");
      requestAnimationFrame(tick);
    } catch (e) {
      showErr(e);
    }
  }

  window.addEventListener("load", boot);
  if (document.readyState === "complete") boot();
})();
