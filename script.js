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
  const hypot = Math.hypot;

  // deterministic tile hashing for stars/nebula (stable in world space)
  const fract = (x) => x - Math.floor(x);
  function hash2(ix, iy, salt = 0) {
    const n = Math.sin(ix * 127.1 + iy * 311.7 + salt * 73.3) * 43758.5453123;
    return fract(n);
  }

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

  // ---------- Canvas sizing ----------
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
    camX += dx / zoom;
    camY += dy / zoom;
  }, { passive: true });

  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    isInteracting = false;
    const w = toWorld(e.clientX, e.clientY);
    const idx = pickColony(w.x, w.y);
    if (idx !== -1) {
      selected = idx;
      log(`Selected Colony #${idx + 1}`, "INFO");
      if (focusOn) centerOnSelected(true);
    }
  }, { passive: true });

  canvas.addEventListener("pointercancel", () => {
    dragging = false;
    isInteracting = false;
  }, { passive: true });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    isInteracting = true;
    const k = e.deltaY > 0 ? 0.92 : 1.08;
    zoom = clamp(zoom * k, 0.55, 2.6);
    clearTimeout(canvas.__wheelTO);
    canvas.__wheelTO = setTimeout(() => (isInteracting = false), 140);
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
      r: rand(55, 125),
      ph: rand(0, Math.PI * 2),
      sp: rand(0.35, 1.1)
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

    const hue = (col.dna.hue + rand(-160, 160) + 360) % 360;
    const orbitDir = Math.random() < 0.5 ? -1 : 1;

    const w = {
      id: Math.random().toString(16).slice(2, 6),
      type,
      hue,
      width: big ? rand(7, 11) : rand(4.2, 7),
      speed: big ? rand(0.38, 0.75) : rand(0.5, 1.05),
      phase: rand(0, Math.PI * 2),
      limbs: [],
      segs: [],
      isBoss: false,

      // NEW: velocity steering so no global heading bias
      vx: rand(-0.6, 0.6),
      vy: rand(-0.6, 0.6),
      orbitDir,
      seedA: rand(-1000, 1000),
      seedB: rand(-1000, 1000),
      wander: rand(0.6, 1.5),
      flow: rand(0.2, 1.0)
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

    // initialize velocity to match initial heading
    w.vx = Math.cos(ang) * 0.8;
    w.vy = Math.sin(ang) * 0.8;

    return w;
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

  const colonies = [newColony(0, 0, 150)];
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], false));
  colonies[0].worms.push(newWorm(colonies[0], true));

  // ---------- Fit view ----------
  function zoomOutToFitAll() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const pad = 620;

    for (const c of colonies) {
      minX = Math.min(minX, c.x - pad);
      minY = Math.min(minY, c.y - pad);
      maxX = Math.max(maxX, c.x + pad);
      maxY = Math.max(maxY, c.y + pad);
    }

    const bw = Math.max(260, maxX - minX);
    const bh = Math.max(260, maxY - minY);

    const fit = Math.min(W / bw, H / bh);
    zoom = clamp(fit * 0.90, 0.52, 1.55);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    camX = -cx;
    camY = -cy;
  }

  // ---------- Events / mechanics ----------
  function shockwave(col, strength = 1) {
    col.shock.push({ r: 0, v: 2.6 + strength * 1.2, a: 0.85, w: 2 + strength });
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
      const dist = rand(260, 520);
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
    if (focusOn) centerOnSelected(false);
  });

  bind("zoomIn", () => (zoom = clamp(zoom * 1.12, 0.52, 2.6)));
  bind("zoomOut", () => (zoom = clamp(zoom * 0.88, 0.52, 2.6)));

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

  // ---------- Rendering helpers (UPGRADED AURAS) ----------
  function aura(x, y, r, hue, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue},95%,70%,${a})`);
    g.addColorStop(0.35, `hsla(${hue},95%,62%,${a * 0.55})`);
    g.addColorStop(1, `hsla(${hue},95%,55%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // inner hot core (nicer “energy”)
    const g2 = ctx.createRadialGradient(x, y, 0, x, y, r * 0.28);
    g2.addColorStop(0, `hsla(${hue},95%,78%,${a * 0.55})`);
    g2.addColorStop(1, `hsla(${hue},95%,68%,0)`);
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  // WORLD-SPACE BACKGROUND: more “space”
  function drawBackground(time) {
    const halfW = (W / 2) / zoom;
    const halfH = (H / 2) / zoom;
    const minX = -camX - halfW;
    const maxX = -camX + halfW;
    const minY = -camY - halfH;
    const maxY = -camY + halfH;

    // Larger grid (subtle)
    const GRID = 240;
    const SUB = GRID / 2;

    const gridAlpha = clamp(0.12 + (zoom - 0.7) * 0.07, 0.05, 0.16);
    const subAlpha  = gridAlpha * 0.5;

    ctx.lineWidth = 1 / zoom;
    ctx.strokeStyle = `rgba(255,255,255,${gridAlpha})`;

    let x0 = Math.floor(minX / GRID) * GRID;
    let x1 = Math.ceil(maxX / GRID) * GRID;
    let y0 = Math.floor(minY / GRID) * GRID;
    let y1 = Math.ceil(maxY / GRID) * GRID;

    ctx.beginPath();
    for (let x = x0; x <= x1; x += GRID) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = y0; y <= y1; y += GRID) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();

    if (!isInteracting) {
      ctx.strokeStyle = `rgba(255,255,255,${subAlpha})`;
      ctx.beginPath();
      let sx0 = Math.floor(minX / SUB) * SUB;
      let sx1 = Math.ceil(maxX / SUB) * SUB;
      let sy0 = Math.floor(minY / SUB) * SUB;
      let sy1 = Math.ceil(maxY / SUB) * SUB;
      for (let x = sx0; x <= sx1; x += SUB) {
        if (Math.abs((x % GRID + GRID) % GRID) < 0.001) continue;
        ctx.moveTo(x, sy0); ctx.lineTo(x, sy1);
      }
      for (let y = sy0; y <= sy1; y += SUB) {
        if (Math.abs((y % GRID + GRID) % GRID) < 0.001) continue;
        ctx.moveTo(sx0, y); ctx.lineTo(sx1, y);
      }
      ctx.stroke();
    }

    // Nebula haze tiles (very soft)
    if (!isInteracting) {
      const NT = 820;
      const ntx0 = Math.floor(minX / NT);
      const ntx1 = Math.ceil(maxX / NT);
      const nty0 = Math.floor(minY / NT);
      const nty1 = Math.ceil(maxY / NT);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let ty = nty0; ty <= nty1; ty++) {
        for (let tx = ntx0; tx <= ntx1; tx++) {
          const h = hash2(tx, ty, 9);
          if (h < 0.55) continue;

          const cx = (tx + hash2(tx, ty, 10)) * NT;
          const cy = (ty + hash2(tx, ty, 11)) * NT;

          const hue = 190 + hash2(tx, ty, 12) * 140; // teal->purple
          const rad = 520 + hash2(tx, ty, 13) * 900;
          const a = 0.05 + hash2(tx, ty, 14) * 0.08;

          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
          g.addColorStop(0, `hsla(${hue},90%,60%,${a})`);
          g.addColorStop(1, `hsla(${hue},90%,60%,0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // Stars (denser + a few bright stars)
    const TILE = 320;
    const baseStars = isInteracting ? 2 : 6;      // MORE stars
    const brightStars = isInteracting ? 0 : 1;    // a few bright ones

    const tx0 = Math.floor(minX / TILE);
    const tx1 = Math.ceil(maxX / TILE);
    const ty0 = Math.floor(minY / TILE);
    const ty1 = Math.ceil(maxY / TILE);

    ctx.save();
    ctx.globalCompositeOperation = "source-over";

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        for (let k = 0; k < baseStars; k++) {
          const hx = hash2(tx, ty, k * 11 + 1);
          const hy = hash2(tx, ty, k * 11 + 2);
          const hs = hash2(tx, ty, k * 11 + 3);

          const sx = (tx + hx) * TILE;
          const sy = (ty + hy) * TILE;

          const tw = 0.65 + 0.35 * Math.sin(time * 0.001 + (tx * 13 + ty * 7 + k) * 0.9);
          const a = (0.22 + 0.60 * hs) * tw;

          const r = 0.6 + hs * 1.25;
          ctx.fillStyle = `rgba(255,255,255,${a * (isInteracting ? 0.55 : 0.85)})`;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fill();
        }

        for (let b = 0; b < brightStars; b++) {
          const hb = hash2(tx, ty, 99 + b);
          if (hb < 0.88) continue;
          const bx = (tx + hash2(tx, ty, 101 + b)) * TILE;
          const by = (ty + hash2(tx, ty, 102 + b)) * TILE;
          const br = 1.8 + hash2(tx, ty, 103 + b) * 2.2;
          const ba = 0.35 + hash2(tx, ty, 104 + b) * 0.35;

          // tiny bloom
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          const g = ctx.createRadialGradient(bx, by, 0, bx, by, br * 10);
          g.addColorStop(0, `rgba(255,255,255,${ba * 0.35})`);
          g.addColorStop(1, `rgba(255,255,255,0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(bx, by, br * 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          ctx.fillStyle = `rgba(255,255,255,${ba})`;
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.restore();
  }

  function irregularBlob(col, time) {
    const baseHue = col.dna.hue;

    // better glow layering
    if (!isInteracting) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < col.nodes.length; i++) {
        const n = col.nodes[i];
        const x = col.x + n.ox + Math.sin(time * 0.001 * n.sp + n.ph) * 12;
        const y = col.y + n.oy + Math.cos(time * 0.001 * n.sp + n.ph) * 12;

        aura(x, y, n.r * 1.25, (baseHue + i * 16) % 360, 0.20);
        aura(x, y, n.r * 0.82, (baseHue + i * 22 + 45) % 360, 0.12);
      }
      ctx.restore();
    } else {
      aura(col.x, col.y, 170 * col.dna.aura, baseHue, 0.14);
    }

    // outline ring
    const R = 135;
    ctx.strokeStyle = `hsla(${baseHue}, 90%, 66%, .30)`;
    ctx.lineWidth = 1.8;
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

    // upgraded outer bloom
    if (!isInteracting) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `hsla(${w.hue}, 92%, 62%, ${w.isBoss ? 0.34 : 0.20})`;
      ctx.lineWidth = w.width + (w.isBoss ? 10 : 7);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    // core
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = `hsla(${w.hue}, 95%, 66%, ${w.isBoss ? 0.98 : 0.92})`;
    ctx.lineWidth = w.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    // beads
    if (!isInteracting) {
      for (let i = 0; i < pts.length; i += 4) {
        const p = pts[i];
        const r = Math.max(2.2, w.width * 0.36);
        ctx.fillStyle = `hsla(${(w.hue + 18) % 360}, 95%, 70%, .86)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
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
          (pts[at]?.a || 0) +
          L.ang +
          Math.sin(time * 0.002 * L.wob + w.phase) * 0.35;

        const lx = base.x + Math.cos(baseAng) * L.len;
        const ly = base.y + Math.sin(baseAng) * L.len;

        ctx.strokeStyle = `hsla(${(w.hue + 45) % 360}, 95%, 68%, ${isInteracting ? 0.34 : 0.58})`;
        ctx.lineWidth = Math.max(2, w.width * 0.36);
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
  }

  // ---------- FIX: worms no longer “rush right” (velocity steering) ----------
  function wormBehavior(col, w, time, dt) {
    const head = w.segs[0];

    // vector to colony center
    const dx = col.x - head.x;
    const dy = col.y - head.y;
    const d = Math.max(1, hypot(dx, dy));
    const nx = dx / d;
    const ny = dy / d;

    // tangential direction for orbit
    const tx = -ny * w.orbitDir;
    const ty = nx * w.orbitDir;

    // smooth flow field (mean ~0, not biased to +X)
    const fx = Math.sin((head.y + w.seedA) * 0.002 + time * 0.0005) * 0.6 + Math.cos((head.x + w.seedB) * 0.002 - time * 0.00045) * 0.6;
    const fy = Math.cos((head.x + w.seedA) * 0.002 + time * 0.0005) * 0.6 + Math.sin((head.y + w.seedB) * 0.002 - time * 0.00045) * 0.6;

    // wander
    const wa = Math.sin(time * 0.0012 + w.phase) * w.wander;
    const wx = Math.cos(wa);
    const wy = Math.sin(wa);

    // choose desired direction by worm type
    let dirX = 0, dirY = 0;

    if (w.type === "DRIFTER") {
      // mostly drift with gentle pull toward colony
      dirX = nx * 0.55 + tx * 0.20 + fx * 0.55 * w.flow + wx * 0.25;
      dirY = ny * 0.55 + ty * 0.20 + fy * 0.55 * w.flow + wy * 0.25;
    } else if (w.type === "ORBITER") {
      // orbit strongly, with slight inward pull so it stays near colony
      dirX = tx * 0.95 + nx * 0.22 + fx * 0.35 * w.flow + wx * 0.10;
      dirY = ty * 0.95 + ny * 0.22 + fy * 0.35 * w.flow + wy * 0.10;
    } else {
      // hunter: more decisive movement with “bite” wobble
      const bite = Math.sin(time * 0.003 + w.phase) * 0.55;
      dirX = nx * (0.78 + bite * 0.08) + tx * 0.30 + fx * 0.40 * w.flow + wx * 0.18;
      dirY = ny * (0.78 + bite * 0.08) + ty * 0.30 + fy * 0.40 * w.flow + wy * 0.18;
    }

    // normalize desired direction
    const dl = Math.max(1e-6, hypot(dirX, dirY));
    dirX /= dl; dirY /= dl;

    // target velocity
    const boost = w.isBoss ? 2.0 : 1.0;
    const baseSpd = w.speed * 2.15 * boost;

    // soft boundary: if too far, increase inward pull (prevents drifting offscreen)
    const maxR = 320;
    const pull = clamp((d - 160) / (maxR - 160), 0, 1);
    const inX = nx * pull;
    const inY = ny * pull;

    const targetVX = (dirX + inX * 0.85) * baseSpd;
    const targetVY = (dirY + inY * 0.85) * baseSpd;

    // steer velocity (key fix)
    const steer = clamp(0.08 + dt * 3.2, 0.06, 0.18);
    w.vx = lerp(w.vx, targetVX, steer);
    w.vy = lerp(w.vy, targetVY, steer);

    // tiny damping to prevent runaway drift
    w.vx *= 0.995;
    w.vy *= 0.995;

    // move head
    head.x += w.vx;
    head.y += w.vy;

    // heading angle for drawing / limb orientation
    head.a = Math.atan2(w.vy, w.vx);

    // keep within a soft radius without “snap flip”
    if (d > maxR) {
      head.x = col.x + (head.x - col.x) * 0.95;
      head.y = col.y + (head.y - col.y) * 0.95;
      w.vx = w.vx * 0.85 + nx * baseSpd * 0.25;
      w.vy = w.vy * 0.85 + ny * baseSpd * 0.25;
    }

    // follow segments
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

  // ---------- Step / Render ----------
  let mutTimer = 0;
  function step(dt, time) {
    ensureBoss();
    trySplitByMcap();

    for (const c of colonies) {
      c.vx += rand(-0.02, 0.02) * c.dna.drift;
      c.vy += rand(-0.02, 0.02) * c.dna.drift;
      c.vx *= 0.985;
      c.vy *= 0.985;
      c.x += c.vx;
      c.y += c.vy;

      for (const s of c.shock) { s.r += s.v; s.a *= 0.96; }
      c.shock = c.shock.filter((s) => s.a > 0.06);
    }

    for (const c of colonies) {
      for (const w of c.worms) wormBehavior(c, w, time, dt);
    }

    if (focusOn) centerOnSelected(true);

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
    ctx.clearRect(0, 0, W, H);
    ctx.save();

    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(camX, camY);

    // space background + grid + stars + nebula
    drawBackground(time);

    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];

      irregularBlob(c, time);

      if (!isInteracting) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        aura(c.x, c.y, 170 * c.dna.aura, c.dna.hue, 0.20);
        aura(c.x, c.y, 110 * c.dna.aura, (c.dna.hue + 40) % 360, 0.12);
        ctx.restore();
      }

      if (i === selected) {
        ctx.strokeStyle = `hsla(${c.dna.hue}, 95%, 65%, .55)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 105 * c.dna.aura, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (const s of c.shock) {
        ctx.strokeStyle = `hsla(${c.dna.hue}, 92%, 62%, ${s.a})`;
        ctx.lineWidth = s.w;
        ctx.beginPath();
        ctx.arc(c.x, c.y, s.r, 0, Math.PI * 2);
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
  const IDLE_FPS = 40;
  const INTERACT_FPS = 60;

  function tick(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    step(dt, now);

    const fps = isInteracting ? INTERACT_FPS : IDLE_FPS;
    const targetDt = 1 / fps;

    renderAccum += dt;
    if (renderAccum >= targetDt) {
      renderAccum = 0;
      render(now);
    }

    requestAnimationFrame(tick);
  }

  // ---------- Boot ----------
  function boot() {
    resizeCanvas();
    zoomOutToFitAll();
    updateStats();
    log("Simulation ready", "INFO");
    requestAnimationFrame(tick);
  }

  window.addEventListener("load", boot);
  if (document.readyState === "complete") boot();
})();
