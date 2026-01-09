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

  // ---------- Colony info panel (tap to view traits + mutations) ----------
  const MUT_CAP_PER_COLONY = 16;

  function ensureColonyPanel() {
    // Prefer existing elements if you already built UI
    const existing = $("colonyPanel") || $("colonyInfo");
    if (existing) return existing;

    const panel = document.createElement("div");
    panel.id = "colonyPanel";
    panel.style.cssText = `
      position:relative;
      width:100%;
      box-sizing:border-box;
      margin-top:12px;
      padding:12px 12px;
      border-radius:16px;
      border:1px solid rgba(255,255,255,.12);
      background:rgba(0,0,0,.35);
      backdrop-filter: blur(10px);
      color:rgba(240,245,255,.92);
      font: 600 12px/1.25 system-ui, -apple-system, Inter, sans-serif;
    `;

    panel.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div id="colTitle" style="font-weight:800; letter-spacing:.2px;">Colony</div>
        <div id="colBadge" style="opacity:.85; font-weight:800;"></div>
      </div>
      <div id="colTraits" style="margin-top:8px; opacity:.92; font-weight:600;"></div>
      <div style="margin-top:10px; opacity:.75; font-weight:800; letter-spacing:.25px;">Recent mutations</div>
      <div id="colMuts" style="margin-top:6px; display:flex; flex-direction:column; gap:6px; max-height:140px; overflow:auto;"></div>
    `;

    // Try to append under your controls area if present; otherwise append to body (below sim isn't possible from JS)
    const mount =
      document.querySelector(".controls") ||
      document.querySelector(".panel") ||
      document.querySelector("#controls") ||
      document.querySelector("main") ||
      document.body;

    mount.appendChild(panel);
    return panel;
  }

  const panelEl = ensureColonyPanel();
  const panelTitle = panelEl ? panelEl.querySelector("#colTitle") : null;
  const panelBadge = panelEl ? panelEl.querySelector("#colBadge") : null;
  const panelTraits = panelEl ? panelEl.querySelector("#colTraits") : null;
  const panelMuts = panelEl ? panelEl.querySelector("#colMuts") : null;

  function fmtTraitRow(label, value) {
    return `<span style="opacity:.75">${label}</span> <span style="opacity:.98">${value}</span>`;
  }

  function updateColonyPanel() {
    if (!panelEl) return;
    const c = colonies[selected];
    if (!c) return;

    const idx = selected + 1;
    if (panelTitle) panelTitle.textContent = `Colony #${idx}`;

    if (panelBadge) {
      panelBadge.textContent = `DNA ${c.id}`;
      panelBadge.style.color = `hsla(${c.dna.hue},95%,70%,.95)`;
      panelBadge.style.textShadow = `0 0 12px hsla(${c.dna.hue},95%,65%,.35)`;
    }

    if (panelTraits) {
      const traits = [
        fmtTraitRow("Biome:", c.dna.biome),
        fmtTraitRow("Temper:", c.dna.temperament),
        fmtTraitRow("Style:", c.dna.style),
        fmtTraitRow("Chaos:", c.dna.chaos.toFixed(2)),
        fmtTraitRow("Drift:", c.dna.drift.toFixed(2)),
        fmtTraitRow("Aura:", c.dna.aura.toFixed(2)),
        fmtTraitRow("Limbiness:", c.dna.limbiness.toFixed(2)),
        fmtTraitRow("Hue:", Math.round(c.dna.hue))
      ];
      panelTraits.innerHTML =
        `<div style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px 14px;">` +
        traits.map(t => `<div>${t}</div>`).join("") +
        `</div>`;
    }

    if (panelMuts) {
      const muts = c.mutations || [];
      if (!muts.length) {
        panelMuts.innerHTML = `<div style="opacity:.7; font-weight:650;">No mutations yet — feed/buy to evolve.</div>`;
      } else {
        panelMuts.innerHTML = muts
          .slice(0, MUT_CAP_PER_COLONY)
          .map(m => {
            const hue = m.hue ?? c.dna.hue;
            return `
              <div style="
                padding:8px 10px;
                border-radius:12px;
                border:1px solid rgba(255,255,255,.10);
                background:rgba(0,0,0,.25);
                box-shadow: 0 0 0 1px rgba(255,255,255,.03) inset;
              ">
                <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
                  <div style="font-weight:850; color: hsla(${hue},95%,70%,.95); text-shadow:0 0 10px hsla(${hue},95%,60%,.25);">
                    ${m.kind}
                  </div>
                  <div style="opacity:.6; font-weight:750;">${m.when}</div>
                </div>
                <div style="margin-top:4px; opacity:.9; font-weight:650;">${m.msg}</div>
              </div>
            `;
          })
          .join("");
      }
    }
  }

  function pushColonyMutation(col, kind, msg, hue) {
    const when = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    col.mutations = col.mutations || [];
    col.mutations.unshift({ kind, msg, when, hue });
    if (col.mutations.length > MUT_CAP_PER_COLONY) col.mutations.length = MUT_CAP_PER_COLONY;
    if (colonies[selected] === col) updateColonyPanel();
  }

  // ---------- Canvas sizing (iOS safe + performance) ----------
  let W = 1, H = 1, DPR = 1;
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // rebuild background tiles for new DPR (prevents shimmer)
    __space = null;
  }
  window.addEventListener("resize", resizeCanvas, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 120));

  // iOS Safari: viewport changes while scrolling
  let __resizeRAF = 0;
  function scheduleResize() {
    cancelAnimationFrame(__resizeRAF);
    __resizeRAF = requestAnimationFrame(resizeCanvas);
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleResize, { passive: true });
    window.visualViewport.addEventListener("scroll", scheduleResize, { passive: true });
  }

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
  let camX = 0, camY = 0, zoom = 0.78; // start zoomed out
  let dragging = false, lastX = 0, lastY = 0;
  let selected = 0;
  let focusOn = false;

  // performance: render "lite" while interacting
  let isInteracting = false;

  // tap-vs-drag detection (fix tap-to-select colonies)
  let downX = 0, downY = 0, moved = false, downTime = 0;
  const TAP_PX = 8;     // movement threshold in px
  const TAP_MS = 350;   // max time to count as a tap

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
    return (best !== -1 && bestD < 280 * 280) ? best : -1;
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    dragging = true;
    isInteracting = true;

    downX = e.clientX; downY = e.clientY;
    lastX = e.clientX; lastY = e.clientY;
    downTime = performance.now();
    moved = false;
  }, { passive: true });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;

    const totalDx = e.clientX - downX;
    const totalDy = e.clientY - downY;
    if (!moved && (Math.abs(totalDx) > TAP_PX || Math.abs(totalDy) > TAP_PX)) moved = true;

    lastX = e.clientX; lastY = e.clientY;

    camX += dx / zoom;
    camY += dy / zoom;
  }, { passive: true });

  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    isInteracting = false;

    const elapsed = performance.now() - downTime;
    const totalDx = e.clientX - downX;
    const totalDy = e.clientY - downY;

    const isTap = !moved && elapsed < TAP_MS && (Math.abs(totalDx) <= TAP_PX && Math.abs(totalDy) <= TAP_PX);

    if (isTap) {
      const w = toWorld(e.clientX, e.clientY);
      const idx = pickColony(w.x, w.y);
      if (idx !== -1) {
        selected = idx;
        log(`Selected Colony #${idx + 1}`, "INFO");
        updateColonyPanel();
        if (focusOn) centerOnSelected(false);
      }
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
    zoom = clamp(zoom * k, 0.6, 2.6);
    clearTimeout(canvas.__wheelTO);
    canvas.__wheelTO = setTimeout(() => (isInteracting = false), 120);
  }, { passive: false });

  // double tap center (kept)
  let lastTap = 0;
  canvas.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - lastTap < 280) centerOnSelected(false);
    lastTap = now;
  }, { passive: true });

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
      shock: [],
      mutations: []
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
      isBoss: false,

      // NEW: independent drift so they don't “rush one way”
      vx: Math.cos(rand(0, Math.PI * 2)) * rand(0.2, 1.0),
      vy: Math.sin(rand(0, Math.PI * 2)) * rand(0.2, 1.0),

      orbitDir: Math.random() < 0.5 ? -1 : 1,
      orbitR: rand(150, 240),
      seedA: rand(-1000, 1000),
      seedB: rand(-1000, 1000),
      wander: rand(0.7, 1.6),
      flow: rand(0.2, 1.0)
    };

    // spawn around colony ring so motion is balanced
    const a0 = rand(0, Math.PI * 2);
    const r0 = rand(120, 210);
    let px = col.x + Math.cos(a0) * r0;
    let py = col.y + Math.sin(a0) * r0;

    // start tangent (orbit) so they don't all shoot toward center
    let ang = a0 + (Math.PI / 2) * w.orbitDir;

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

  // ---------- Fit view (zoomed out start) ----------
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
    zoom = clamp(fit * 0.92, 0.6, 1.6);

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
      pushColonyMutation(c, "BOSS", "A boss worm erupted from the core.", 120);
    }
  }

  function trySplitByMcap() {
    while (mcap >= nextSplitAt && colonies.length < MAX_COLONIES) {
      const base = colonies[0];
      const ang = rand(0, Math.PI * 2);
      const dist = rand(260, 420);
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
      pushColonyMutation(nc, "SPLIT", `Colony formed at ${fmt(nextSplitAt)} market cap.`, nc.dna.hue);
      nextSplitAt += MC_STEP;

      // keep view comfortable as new colonies appear
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
      pushColonyMutation(c, "COLOR", `Worm ${w.id} shifted hue.`, w.hue);
    } else if (r < 0.56) {
      w.speed *= rand(1.05, 1.25);
      log(`Aggression spike • Worm ${w.id}`, "MUTATION");
      pushColonyMutation(c, "AGGRESSION", `Worm ${w.id} speed increased.`, w.hue);
    } else if (r < 0.78) {
      w.width = clamp(w.width * rand(1.05, 1.25), 3.5, 16);
      log(`Body growth • Worm ${w.id}`, "MUTATION");
      pushColonyMutation(c, "GROWTH", `Worm ${w.id} body thickened.`, w.hue);
    } else {
      addLimb(w, c, Math.random() < 0.35);
      log(`Limb growth • Worm ${w.id}`, "MUTATION");
      pushColonyMutation(c, "LIMB", `Worm ${w.id} grew a limb.`, w.hue);
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
      // not logging every hatch to mutations to avoid spam
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
    const c = colonies[selected] || colonies[0];
    pushColonyMutation(c, "NUTRITION", "Nutrients absorbed — growth accelerated.", c.dna.hue);
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

  bind("zoomIn", () => (zoom = clamp(zoom * 1.12, 0.6, 2.6)));
  bind("zoomOut", () => (zoom = clamp(zoom * 0.88, 0.6, 2.6)));

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

  // ---------- Rendering helpers ----------
  function aura(x, y, r, hue, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue},95%,72%,${a})`);
    g.addColorStop(0.35, `hsla(${hue},95%,62%,${a * 0.62})`);
    g.addColorStop(1, `hsla(${hue},95%,55%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    const g2 = ctx.createRadialGradient(x, y, 0, x, y, r * 0.28);
    g2.addColorStop(0, `hsla(${hue},95%,80%,${a * 0.55})`);
    g2.addColorStop(1, `hsla(${hue},95%,68%,0)`);
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  function irregularBlob(col, time) {
    const baseHue = col.dna.hue;

    if (!isInteracting) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < col.nodes.length; i++) {
        const n = col.nodes[i];
        const x = col.x + n.ox + Math.sin(time * 0.001 * n.sp + n.ph) * 12;
        const y = col.y + n.oy + Math.cos(time * 0.001 * n.sp + n.ph) * 12;
        aura(x, y, n.r * 1.35, (baseHue + i * 16) % 360, 0.22);
        aura(x, y, n.r * 0.85, (baseHue + i * 22 + 45) % 360, 0.13);
      }
      ctx.restore();
    } else {
      aura(col.x, col.y, 180 * col.dna.aura, baseHue, 0.14);
    }

    const R = 138;
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

    if (!isInteracting) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `hsla(${w.hue}, 92%, 62%, ${w.isBoss ? 0.36 : 0.20})`;
      ctx.lineWidth = w.width + (w.isBoss ? 10 : 7);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = `hsla(${w.hue}, 95%, 66%, ${w.isBoss ? 0.98 : 0.92})`;
    ctx.lineWidth = w.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

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

  // ---------- Worm behavior (orbit-drive so they don’t “rush right”) ----------
  function wormBehavior(col, w, time, dt) {
    const head = w.segs[0];

    const dx = head.x - col.x;
    const dy = head.y - col.y;
    const d = Math.max(1, hypot(dx, dy));
    const nx = dx / d;
    const ny = dy / d;

    const tx = -ny * w.orbitDir;
    const ty = nx * w.orbitDir;

    const err = (w.orbitR - d);
    const corr = clamp(err / 120, -1, 1);

    const fx = Math.sin((head.y + w.seedA) * 0.002 + time * 0.00055) * 0.7
             + Math.cos((head.x + w.seedB) * 0.002 - time * 0.0005) * 0.7;
    const fy = Math.cos((head.x + w.seedA) * 0.002 + time * 0.00055) * 0.7
             + Math.sin((head.y + w.seedB) * 0.002 - time * 0.0005) * 0.7;

    const wa = Math.sin(time * 0.0012 + w.phase) * w.wander;
    const wx = Math.cos(wa);
    const wy = Math.sin(wa);

    let dirX = 0, dirY = 0;

    if (w.type === "DRIFTER") {
      dirX = tx * 0.85 + (-nx) * (0.20 * corr) + fx * 0.40 * w.flow + wx * 0.28;
      dirY = ty * 0.85 + (-ny) * (0.20 * corr) + fy * 0.40 * w.flow + wy * 0.28;
    } else if (w.type === "ORBITER") {
      dirX = tx * 1.05 + (-nx) * (0.28 * corr) + fx * 0.28 * w.flow + wx * 0.14;
      dirY = ty * 1.05 + (-ny) * (0.28 * corr) + fy * 0.28 * w.flow + wy * 0.14;
    } else {
      const bite = Math.sin(time * 0.003 + w.phase) * 0.55;
      dirX = tx * 0.90 + (-nx) * (0.34 * corr + 0.06 * bite) + fx * 0.35 * w.flow + wx * 0.20;
      dirY = ty * 0.90 + (-ny) * (0.34 * corr + 0.06 * bite) + fy * 0.35 * w.flow + wy * 0.20;
    }

    const dl = Math.max(1e-6, hypot(dirX, dirY));
    dirX /= dl; dirY /= dl;

    const boost = w.isBoss ? 2.0 : 1.0;
    const baseSpd = w.speed * 2.1 * boost;

    const targetVX = dirX * baseSpd;
    const targetVY = dirY * baseSpd;

    const steer = clamp(0.08 + dt * 3.2, 0.06, 0.18);
    w.vx = lerp(w.vx, targetVX, steer);
    w.vy = lerp(w.vy, targetVY, steer);

    w.vx *= 0.995;
    w.vy *= 0.995;

    head.x += w.vx;
    head.y += w.vy;
    head.a = Math.atan2(w.vy, w.vx);

    const maxR = 360;
    if (d > maxR) {
      head.x = col.x + nx * maxR;
      head.y = col.y + ny * maxR;
      w.vx = tx * baseSpd * 0.9;
      w.vy = ty * baseSpd * 0.9;
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

  // ===============================
  // SPACE BACKGROUND + STABLE GRID (no shimmer on iOS)
  // ===============================
  let __space = null;

  function initSpace() {
    __space = {
      stars: [
        makeStarLayer(220, 0.10, 0.22), // far
        makeStarLayer(160, 0.18, 0.38), // mid
        makeStarLayer(110, 0.28, 0.60)  // near
      ],
      nebulas: makeNebulas(5),
      grid: makeGridTile()
    };
  }

  function makeStarLayer(count, parallax, alpha) {
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        x: Math.random() * 1e6,
        y: Math.random() * 1e6,
        r: 0.6 + Math.random() * 1.8,
        a: alpha * (0.6 + Math.random() * 0.8),
        tw: 0.4 + Math.random() * 1.6,
        ph: Math.random() * Math.PI * 2,
        p: parallax,
        tint: Math.random() < 0.12 ? (Math.random() < 0.5 ? "blue" : "pink") : "white"
      });
    }
    return arr;
  }

  function makeNebulas(k) {
    const arr = [];
    for (let i = 0; i < k; i++) {
      arr.push({
        x: (Math.random() - 0.5) * 3000,
        y: (Math.random() - 0.5) * 3000,
        r: 520 + Math.random() * 900,
        h: Math.random() * 360,
        a: 0.08 + Math.random() * 0.10,
        drift: 0.00008 + Math.random() * 0.00018,
        ph: Math.random() * Math.PI * 2
      });
    }
    return arr;
  }

  function makeGridTile() {
    const tile = document.createElement("canvas");
    const g = tile.getContext("2d", { alpha: true });

    // world spacing
    const GRID_W = 240;

    // base tile size in CSS px, scaled at draw time
    const TILE_PX = 240;

    tile.width = TILE_PX * DPR;
    tile.height = TILE_PX * DPR;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, TILE_PX, TILE_PX);

    // subtle minor cross
    g.strokeStyle = "rgba(255,255,255,0.05)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0.5, TILE_PX / 2 + 0.5);
    g.lineTo(TILE_PX + 0.5, TILE_PX / 2 + 0.5);
    g.moveTo(TILE_PX / 2 + 0.5, 0.5);
    g.lineTo(TILE_PX / 2 + 0.5, TILE_PX + 0.5);
    g.stroke();

    // major edges
    g.strokeStyle = "rgba(255,255,255,0.12)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0.5, 0.5);
    g.lineTo(TILE_PX + 0.5, 0.5);
    g.moveTo(0.5, 0.5);
    g.lineTo(0.5, TILE_PX + 0.5);
    g.stroke();

    return { canvas: tile, GRID_W, TILE_PX };
  }

  function drawSpaceBackground(time) {
    if (!__space) initSpace();

    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // base gradient
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "rgba(2,6,10,1)");
    bg.addColorStop(1, "rgba(3,10,14,1)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // nebulas (galaxy-ish blobs)
    for (const n of __space.nebulas) {
      const t = time * n.drift;
      const nx = (W * 0.5) + (n.x + Math.cos(t + n.ph) * 180) * 0.10 + camX * zoom * 0.02;
      const ny = (H * 0.45) + (n.y + Math.sin(t + n.ph) * 180) * 0.10 + camY * zoom * 0.02;
      const r = n.r * 0.22;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, r);
      g.addColorStop(0, `hsla(${n.h}, 90%, 62%, ${n.a})`);
      g.addColorStop(0.55, `hsla(${n.h}, 90%, 56%, ${n.a * 0.55})`);
      g.addColorStop(1, `hsla(${n.h}, 90%, 56%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // star layers
    for (const layer of __space.stars) {
      for (const s of layer) {
        const tw = 0.75 + 0.25 * Math.sin(time * 0.0012 * s.tw + s.ph);

        const sx = (s.x - camX * 1200 * layer.p) % 1e6;
        const sy = (s.y - camY * 1200 * layer.p) % 1e6;

        const x = (sx / 1e6) * W;
        const y = (sy / 1e6) * H;

        const rr = s.r * tw;
        const a = s.a * tw * (isInteracting ? 0.75 : 1);

        if (s.tint === "blue") ctx.fillStyle = `rgba(210,235,255,${a})`;
        else if (s.tint === "pink") ctx.fillStyle = `rgba(255,225,245,${a})`;
        else ctx.fillStyle = `rgba(255,255,255,${a})`;

        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.fill();

        // occasional glow star
        if (!isInteracting && rr > 1.8 && Math.random() < 0.015) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          const gg = ctx.createRadialGradient(x, y, 0, x, y, rr * 10);
          gg.addColorStop(0, `rgba(255,255,255,${a * 0.35})`);
          gg.addColorStop(1, `rgba(255,255,255,0)`);
          ctx.fillStyle = gg;
          ctx.beginPath();
          ctx.arc(x, y, rr * 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    ctx.restore();
  }

  function drawGridStable() {
    if (!__space) initSpace();
    if (zoom < 0.62) return;

    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    const { canvas: tile, GRID_W, TILE_PX } = __space.grid;

    const desired = GRID_W * zoom;     // px between major grid repeats
    if (desired < 24) { ctx.restore(); return; }

    const ps = desired / TILE_PX;

    const pattern = ctx.createPattern(tile, "repeat");
    if (!pattern) { ctx.restore(); return; }

    const phaseX = (camX * zoom) % desired;
    const phaseY = (camY * zoom) % desired;

    // Use DOMMatrix if available
    const m = new DOMMatrix();
    m.a = ps; m.d = ps;
    m.e = -phaseX;
    m.f = -phaseY;

    if (pattern.setTransform) pattern.setTransform(m);

    ctx.globalAlpha = isInteracting ? 0.55 : 1.0;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  // ---------- Simulation step ----------
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
      for (const w of c.worms) wormBehavior(c, w, time, dt);
    }

    if (focusOn) centerOnSelected(true);

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
    // SCREEN SPACE background + stable grid (no shimmer)
    drawSpaceBackground(time);
    drawGridStable();

    // WORLD SPACE render
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(camX, camY);

    for (let i = 0; i < colonies.length; i++) {
      const c = colonies[i];

      irregularBlob(c, time);

      if (i === selected) {
        ctx.strokeStyle = `hsla(${c.dna.hue}, 95%, 65%, .55)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 115 * c.dna.aura, 0, Math.PI * 2);
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

  // ---------- Main loop (performance throttles) ----------
  let last = performance.now();

  // render at capped FPS
  let renderAccum = 0;
  const RENDER_FPS = 40;        // try 30 if your phone is older
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
    resizeCanvas();
    zoomOutToFitAll();
    updateStats();
    updateColonyPanel();
    log("Simulation ready", "INFO");
    requestAnimationFrame(tick);
  }

  window.addEventListener("load", boot);
  if (document.readyState === "complete") boot();
})();
