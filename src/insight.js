// Seeing and understanding a run: ride telemetry, the Toy Critics' ratings (Fun · Thrill · Dizzy),
// records, awards and Classic coasters, the news strip, run reports with graphs, the heat map
// painted on the track, and a ghost ball that keeps riding the predicted path.
import * as THREE from 'three';

const SAMPLE = 0.02; // seconds of simulated time between telemetry samples
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- the critics
// Thrill: speed, g-force, air time, big drops, upside-down moments.
// Dizzy: spinning round (spirals, funnels), sideways forces, loops.
// Fun: a long ride with variety, music and gadgets, air time, near misses, nice decorations and a
// goal at the end — but not too scary, not too dizzy and never boring.
export function rate(run) {
  const thrill = clamp(1.2 * run.maxV + 0.7 * Math.max(0, run.maxG - 1) + 2.5 * Math.min(run.airLongest, 1.5) + 3 * Math.min(run.biggestDrop, 1.2) + 0.8 * run.inversions, 0, 10);
  const dizzy = clamp(1.7 * Math.sqrt(run.turns) + 0.8 * run.maxLat + 0.7 * run.inversions, 0, 10);
  const parts = [];
  const add = (v, text) => { if (Math.abs(v) >= 0.05) parts.push([v, text]); return v; };
  let fun = 0;
  fun += add(2.5 * (1 - Math.exp(-run.time / 12)), 'a long ride');
  fun += add(Math.min(2.8, 0.35 * run.variety), 'lots of different pieces');
  fun += add(Math.min(2, 0.25 * run.gadgets), 'music and gadgets');
  fun += add(Math.min(1.2, 0.4 * run.airMoments), 'air time');
  fun += add(Math.min(1.2, 0.3 * run.nearMisses), 'near misses under the track');
  fun += add(Math.min(1.5, 0.25 * run.scenery), 'nice decorations');
  if (run.result === 'goal') fun += add(1, 'a goal at the end');
  if (run.boring > 3) fun += add(-Math.min(2, 0.15 * (run.boring - 3)), 'a slow, boring stretch');
  if (thrill > 8) fun += add(-(thrill - 8) * 0.8, 'too scary');
  if (thrill < 2) fun += add(-(2 - thrill) * 0.5, 'not very exciting');
  if (dizzy > 6.5) fun += add(-(dizzy - 6.5) * 0.9, 'too dizzy');
  if (run.result === 'fall') fun += add(-1, 'the ball fell off');
  fun = clamp(fun, 0, 10);
  parts.sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]));
  return { fun, thrill, dizzy, stars: Math.round(fun) / 2, parts };
}
export const starText = (s) => '★'.repeat(Math.floor(s)) + (s % 1 >= 0.5 ? '½' : '') ;

// ---------------------------------------------------------------- module
export function createInsight(app) {
  const { L, store, $ } = app;
  const lineMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const heatGroup = new THREE.Group(); app.scene.add(heatGroup);
  const ghost = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 18, 12), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false }));
  ghost.visible = false; ghost.renderOrder = 8; app.scene.add(ghost);
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.014, 0.019, 24), new THREE.MeshBasicMaterial({ color: '#7fd6ff', transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
  ghost.add(halo);
  const scrub = new THREE.Mesh(new THREE.SphereGeometry(0.013, 18, 12), new THREE.MeshBasicMaterial({ color: '#ff7a00', transparent: true, opacity: 0.8, depthWrite: false }));
  scrub.visible = false; scrub.renderOrder = 9; app.scene.add(scrub);

  const pieceStats = new Map(); // pieceId → { balls, maxV, falls }
  let lastRun = null, runs = 0;
  const recordsKey = () => 'bc.records.' + app.roomKind();
  let records = store.get(recordsKey(), {});
  const classics = new Set(store.get('bc.classics', []));
  const classicCount = store.get('bc.classicCount', {});

  // ------------------------------------------------ news strip
  const newsEl = $('news');
  function news(icon, text, at, onClick) {
    // the same line again (many balls, one run): keep the one already there a little longer
    const key = icon + text, same = [...newsEl.children].find(c => c.dataset.key === key && !c.classList.contains('gone'));
    const el = same || document.createElement('button');
    if (!same) {
      el.className = 'newsItem'; el.dataset.key = key;
      el.innerHTML = `<i>${icon}</i><span>${text}</span>${at ? '<b>📍</b>' : ''}`;
    }
    el.onclick = () => {
      if (onClick) onClick();
      else if (at) { const off = app.camera.position.clone().sub(app.controls.target).setLength(0.55); app.flyTo(at.clone().add(off), at.clone()); }
      el.classList.add('gone'); setTimeout(() => el.remove(), 300);
    };
    newsEl.prepend(el);
    while (newsEl.children.length > 3) newsEl.lastChild.remove();
    clearTimeout(el.goneT);
    el.goneT = setTimeout(() => { el.classList.add('gone'); setTimeout(() => el.remove(), 400); }, 7000);
    return el;
  }

  // ------------------------------------------------ telemetry
  function begin(b) {
    b.tm = { samples: [], acc: 0, t0: app.world.time, types: new Set(), ev: {}, near: 0, nearT: -9, lastV: b.vel.clone(), turns: 0, lastYaw: null, inv: 0, invOn: false, air: 0, airLongest: 0, airMoments: 0, boring: 0, boringRun: 0, lastEvT: app.world.time, lastPiece: null, done: false };
  }
  function event(type, b) {
    if (!b || !b.tm) return;
    b.tm.ev[type] = (b.tm.ev[type] || 0) + 1;
    b.tm.lastEvT = app.world.time;
  }
  const nearPts = () => app.trackPoints();
  function sample(b, dt) {
    const T = b.tm, w = app.world, v = b.vel, sp = v.length();
    // felt acceleration in g: (a - g) / g, split along the track normal and sideways
    const a0 = v.clone().sub(T.lastV).divideScalar(Math.max(dt, 1e-4)); T.lastV.copy(v);
    a0.y += w.g; a0.divideScalar(w.g);
    // what a rider feels: averaged over ~0.1 s, so a single clack against a wall isn't a 5 g moment
    T.acc5 = T.acc5 || [];
    T.acc5.push(a0); if (T.acc5.length > 5) T.acc5.shift();
    const a = T.acc5.reduce((m, x) => m.add(x), V()).divideScalar(T.acc5.length);
    const touching = w.time - b.lastTouch < 0.04;
    const n = touching ? b.normal : V(0, 1, 0);
    const vert = a.dot(n), along = sp > 0.02 ? a.dot(v) / sp : 0;
    const lat = Math.sqrt(Math.max(0, a.lengthSq() - vert * vert - along * along));
    const pid = b.tkCol && w.time - b.tkT < 0.05 ? b.tkCol.pieceId : null;
    if (pid != null) { T.types.add(b.tkCol.pieceType); T.lastPiece = pid; const ps = stat(pid); ps.balls.add(b.id); ps.maxV = Math.max(ps.maxV, sp); }
    // turning round: how far the heading has swung. Swirling round a funnel bowl (touching, but not
    // on a track) counts much less than a spiral you ride through
    if (Math.hypot(v.x, v.z) > 0.05) {
      const yaw = Math.atan2(v.z, v.x);
      if (T.lastYaw !== null) {
        let d = yaw - T.lastYaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        T.turns += Math.abs(d) / (2 * Math.PI) * (pid != null ? 1 : touching ? 0.12 : 0);
      }
      T.lastYaw = yaw;
    }
    const upside = touching && b.normal.y < -0.4;
    if (upside && !T.invOn) T.inv++;
    T.invOn = upside;
    const airborne = !touching && !b.captured;
    if (airborne) T.air += dt; else { if (T.air > 0.18) T.airMoments++; T.airLongest = Math.max(T.airLongest, T.air); T.air = 0; }
    // boring: crawling with nothing happening
    if (sp < 0.3 && !b.captured && w.time - T.lastEvT > 1) T.boringRun += dt; else T.boringRun = 0;
    T.boring = Math.max(T.boring, T.boringRun);
    // near miss: rushing just under another piece of track
    if (sp > 0.4 && w.time - T.nearT > 0.8) {
      for (const q of nearPts()) {
        if (q.id === pid) continue;
        const dy = q.p.y - b.pos.y;
        if (dy > 0.03 && dy < 0.11 && Math.hypot(q.p.x - b.pos.x, q.p.z - b.pos.z) < 0.045) { T.near++; T.nearT = w.time; break; }
      }
    }
    T.samples.push({ t: w.time - T.t0, x: b.pos.x, y: b.pos.y, z: b.pos.z, v: sp, g: Math.abs(vert), lat, air: airborne });
    if (T.samples.length > 6000) T.samples.splice(0, 1000);
  }
  function stat(pid) { let s = pieceStats.get(pid); if (!s) { s = { balls: new Set(), maxV: 0, falls: 0 }; pieceStats.set(pid, s); } return s; }

  function finish(b, result) {
    const T = b.tm;
    if (!T || T.done) return;
    T.done = true;
    if (T.samples.length < 10) return;
    if (result === 'fall' && T.lastPiece != null) stat(T.lastPiece).falls++;
    const S = T.samples;
    // a drop is height lost while plunging steeply (more than ~25°); a gentle slope doesn't count
    let biggestDrop = 0, plunge = 0;
    for (let i = 1; i < S.length; i++) {
      const dy = S[i].y - S[i - 1].y, dl = Math.max(1e-6, S[i].v * (S[i].t - S[i - 1].t));
      if (dy < 0 && -dy / dl > 0.42) { plunge -= dy; biggestDrop = Math.max(biggestDrop, plunge); } else if (dy > -0.0005) plunge = 0;
    }
    const ev = T.ev;
    const gadgets = ['note', 'bell', 'splash', 'boost', 'sensor', 'photo', 'domino', 'switch', 'lift', 'kick', 'brush', 'gate'].filter(k => ev[k]).length;
    const scen = app.decorNear(S);
    const run = {
      id: b.id, ball: b.type, color: b.color, result, time: S[S.length - 1].t,
      maxV: Math.max(...S.map(s => s.v)), maxG: Math.max(...S.map(s => s.g)), maxLat: Math.max(...S.map(s => s.lat)),
      airLongest: Math.max(T.airLongest, T.air), airMoments: T.airMoments, biggestDrop, inversions: T.inv, turns: T.turns,
      variety: T.types.size, gadgets, notes: ev.note || 0, bells: ev.bell || 0, nearMisses: T.near, scenery: scen, boring: T.boring,
      samples: S, end: V(b.pos.x, b.pos.y, b.pos.z),
    };
    run.rating = rate(run);
    lastRun = run; runs++;
    afterRun(run);
    return run;
  }

  // ------------------------------------------------ records, awards, classic
  const AWARDS = [
    ['longest', '⏳', 'Longest Ride', (r) => r.time, (v) => `${v.toFixed(1)} s`, 8],
    ['speed', '⚡', 'Speed Demon', (r) => r.maxV, (v) => `${v.toFixed(2)} m/s`, 1.5],
    ['air', '🚀', 'Big Air', (r) => r.airLongest, (v) => `${v.toFixed(2)} s`, 0.3],
    ['loud', '🎵', 'Loudest Run', (r) => r.notes + r.bells, (v) => `${v}`, 6],
    ['dizzy', '🌀', 'Dizziest Ride', (r) => r.rating.dizzy, (v) => v.toFixed(1), 6],
    ['fun', '🎉', 'Most Fun', (r) => r.rating.fun, (v) => v.toFixed(1), 6],
  ];
  function afterRun(run) {
    const r = run.rating;
    const card = news('📋', L('Run: Fun {0} · Thrill {1} · Dizzy {2}', r.fun.toFixed(1), r.thrill.toFixed(1), r.dizzy.toFixed(1)) + ` <em>${starText(r.stars)}</em>`, null, () => app.openWindow('run'));
    card.classList.add('run');
    for (const [key, icon, name, get, fmt, min] of AWARDS) {
      const v = get(run);
      if (v < min || v <= (records[key]?.v ?? -1)) continue;
      const first = !records[key];
      records[key] = { v, at: Date.now() };
      if (!first || runs > 1) { news('🏆', L('New award: {0} — {1}', L(name), fmt(v))); app.sound.fanfare(); app.onAward?.(key); }
    }
    store.set(recordsKey(), records);
    // a coaster that keeps being great becomes a Classic
    if (r.fun >= 8 && run.result === 'goal') {
      const h = app.designHash();
      classicCount[h] = (classicCount[h] || 0) + 1;
      store.set('bc.classicCount', classicCount);
      if (classicCount[h] >= 5 && !classics.has(h)) {
        classics.add(h); store.set('bc.classics', [...classics]);
        news('🏅', L('Your coaster is now a Classic!')); app.sound.fanfare(); app.onClassic?.();
      }
    }
    app.onRun?.(run);
    renderWindow();
  }
  const isClassic = () => classics.has(app.designHash());

  // ------------------------------------------------ per-frame
  function tick(adv) {
    if (adv <= 0) return;
    for (const b of app.world.balls) {
      if (!b.tm) begin(b);
      const T = b.tm;
      if (T.done) continue;
      if (b.collected) { finish(b, 'goal'); continue; }
      if (b.dead) { finish(b, 'fall'); continue; }
      if (b.still > 1.5) { finish(b, b.onRoomFloor ? 'fall' : 'stuck'); continue; }
      // resting on the track (not riding a lift) for a while: that ride is over
      T.rest = !b.captured && b.vel.lengthSq() < 0.005 * 0.005 ? (T.rest || 0) + adv : 0;
      if (T.rest > 2.5) { finish(b, 'stuck'); continue; }
      T.acc += adv;
      if (T.acc >= SAMPLE) { sample(b, T.acc); T.acc = 0; }
    }
  }
  function ballGone(b) { if (b.tm && !b.tm.done) finish(b, b.collected ? 'goal' : 'fall'); }

  // ------------------------------------------------ heat map painted on the track
  let heatKey = '';
  function heat(mode) {
    heatGroup.clear();
    heatKey = '';
    if (!mode || mode === 'off') return;
    const runsP = app.pred.runs.filter(R => R.n > 2);
    if (!runsP.length) return;
    // a coarse spatial hash of predicted samples
    const cell = 0.04, grid = new Map();
    const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    for (const R of runsP) {
      const a = R.line.geometry.attributes.position.array;
      for (let i = 0; i < R.n; i++) {
        const p = [a[i * 3], a[i * 3 + 1] - 0.014, a[i * 3 + 2]];
        const k = key(...p); if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push([p, mode === 'speed' ? R.v[i] : mode === 'g' ? (R.gs ? R.gs[i] : 1) : (R.lats ? R.lats[i] : 0)]);
      }
    }
    const look = (p) => {
      let best = 0.03 * 0.03, val = null;
      const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        const l = grid.get(`${cx + i},${cy + j},${cz + k}`); if (!l) continue;
        for (const [q, v] of l) { const d = (q[0] - p.x) ** 2 + (q[1] - p.y) ** 2 + (q[2] - p.z) ** 2; if (d < best) { best = d; val = v; } }
      }
      return val;
    };
    const col = new THREE.Color();
    const paint = (v) => {
      if (v === null) return col.set('#b9bccb');
      const t = mode === 'speed' ? clamp(v / 2.5, 0, 1) : mode === 'g' ? clamp((v - 0.5) / 3.5, 0, 1) : clamp(v / 2, 0, 1);
      return col.setHSL(0.62 - t * 0.62, 0.9, 0.5);
    };
    for (const inst of app.insts.values()) {
      for (const path of inst.paths) {
        const sm = path.samples, pos = [], cols = [], idx = [];
        for (let i = 0; i < sm.length; i += 2) {
          const s = sm[i], R = V().crossVectors(s.T, s.U);
          const base = s.p.clone().addScaledVector(s.U, -(0.016 - 0.0022));
          const c = paint(look(s.p.clone().addScaledVector(s.U, -0.0045)));
          for (const sd of [-1, 1]) { const q = base.clone().addScaledVector(R, sd * 0.0068); pos.push(q.x, q.y, q.z); cols.push(c.r, c.g, c.b); }
        }
        for (let i = 0; i < pos.length / 6 - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        if (!idx.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
        g.setIndex(idx);
        const m = new THREE.Mesh(g, lineMat); m.renderOrder = 3; m.raycast = () => {};
        m.material.side = THREE.DoubleSide;
        heatGroup.add(m);
      }
    }
    heatKey = mode;
  }

  // ------------------------------------------------ ghost ball on the predicted path
  let ghostT = 0;
  function updateGhost(dt) {
    const R = app.pred.runs[0];
    const show = app.S.ghostBall && R && R.n > 10 && app.S.cam === 'orbit' && !app.S.photo && !app.S.replay && app.S.predict;
    ghost.visible = !!show;
    if (!show) return;
    ghostT += dt;
    const per = 0.01, n = R.n, len = n * per + 0.8;
    const i = Math.min(n - 1, Math.floor((ghostT % len) / per));
    const a = R.line.geometry.attributes.position.array;
    ghost.position.set(a[i * 3], a[i * 3 + 1] - 0.014, a[i * 3 + 2]);
    halo.lookAt(app.camera.position);
    halo.position.set(0, 0, 0);
    ghost.material.opacity = 0.35 + 0.2 * Math.sin(ghostT * 6);
  }

  // ------------------------------------------------ the coaster window (side panel tabs)
  const graphs = { metric: 'v', scrubT: null };
  function drawGraph() {
    const cv = $('runGraph'); if (!cv || !lastRun) return;
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, S = lastRun.samples;
    ctx.clearRect(0, 0, W, H);
    const m = graphs.metric, get = m === 'v' ? (s) => s.v : m === 'y' ? (s) => s.y * 100 : (s) => s.g;
    const vals = S.map(get), mx = Math.max(0.01, ...vals) * 1.1, t1 = S[S.length - 1].t || 1;
    ctx.strokeStyle = '#eceef5'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, H * i / 4); ctx.lineTo(W, H * i / 4); ctx.stroke(); }
    // air time shaded
    ctx.fillStyle = 'rgba(76,141,255,0.12)';
    S.forEach((s, i) => { if (s.air) ctx.fillRect(s.t / t1 * W, 0, Math.max(1, W / S.length), H); });
    ctx.beginPath();
    S.forEach((s, i) => { const x = s.t / t1 * W, y = H - get(s) / mx * (H - 6) - 3; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = m === 'v' ? '#ff7a59' : m === 'y' ? '#4c8dff' : '#9b6bff'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = '#80859c'; ctx.font = '20px Fredoka, sans-serif';
    ctx.fillText(`${mx.toFixed(m === 'y' ? 0 : 1)} ${m === 'v' ? 'm/s' : m === 'y' ? 'cm' : 'g'}`, 6, 22);
    if (graphs.scrubT !== null) {
      const x = graphs.scrubT / t1 * W;
      ctx.strokeStyle = '#2b2d42'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
  }
  function scrubTo(f) {
    if (!lastRun) return;
    const S = lastRun.samples, t = f * S[S.length - 1].t;
    graphs.scrubT = t;
    const s = S.reduce((a, c) => Math.abs(c.t - t) < Math.abs(a.t - t) ? c : a);
    scrub.position.set(s.x, s.y, s.z); scrub.visible = true;
    $('runScrubInfo').textContent = `${s.t.toFixed(1)} s · ${s.v.toFixed(2)} m/s · ${(s.y * 100).toFixed(0)} cm · ${s.g.toFixed(1)} g${s.air ? ' · ✈' : ''}`;
    drawGraph();
  }
  function renderWindow() {
    const el = $('runBody'); if (!el) return;
    if (!lastRun) { el.innerHTML = `<p class="muted small">${L('Release a ball and its ride report shows up here.')}</p>`; return; }
    const r = lastRun, k = r.rating;
    const meter = (label, v, cls, tip) => `<div class="meter ${cls}" title="${tip}"><span>${label}</span><i style="width:${v * 10}%"></i><b>${v.toFixed(1)}</b></div>`;
    el.innerHTML = `
      <div class="critics">
        ${meter(L('Fun'), k.fun, 'fun', L('Higher is better'))}
        ${meter(L('Thrill'), k.thrill, 'thrill', L('Best between 4 and 7'))}
        ${meter(L('Dizzy'), k.dizzy, 'dizzy', L('Keep it under 6'))}
        <div class="stars">${starText(k.stars) || '—'} <small>${L(r.result === 'goal' ? 'scored!' : r.result === 'fall' ? 'fell off' : 'stopped')}</small></div>
      </div>
      <div class="why">${k.parts.slice(0, 6).map(([v, t]) => `<span class="${v > 0 ? 'pos' : 'neg'}">${v > 0 ? '+' : '−'} ${L(t)}</span>`).join('')}</div>
      <div class="kv small">
        <span>${L('Ride time')}</span><b>${r.time.toFixed(1)} s</b>
        <span>${L('Top speed')}</span><b>${r.maxV.toFixed(2)} m/s</b>
        <span>${L('Longest air time')}</span><b>${r.airLongest.toFixed(2)} s</b>
        <span>${L('Biggest g-force')}</span><b>${r.maxG.toFixed(1)} g</b>
        <span>${L('Biggest drop')}</span><b>${(r.biggestDrop * 100).toFixed(0)} cm</b>
        <span>${L('Upside down')}</span><b>${r.inversions}</b>
        <span>${L('Turns round')}</span><b>${r.turns.toFixed(1)}</b>
        <span>${L('Notes played')}</span><b>${r.notes + r.bells}</b>
        <span>${L('Near misses')}</span><b>${r.nearMisses}</b>
      </div>
      <div class="graphTabs">${[['v', L('Speed')], ['y', L('Height')], ['g', L('g-force')]].map(([k2, l]) => `<button data-metric="${k2}" class="${graphs.metric === k2 ? 'on' : ''}">${l}</button>`).join('')}</div>
      <canvas id="runGraph" width="560" height="150"></canvas>
      <input type="range" id="runScrub" min="0" max="1000" value="0">
      <div id="runScrubInfo" class="small muted">${L('Drag the slider to see where the ball was')}</div>`;
    el.querySelectorAll('[data-metric]').forEach(b => b.onclick = () => { graphs.metric = b.dataset.metric; renderWindow(); });
    $('runScrub').oninput = (e) => scrubTo(+e.target.value / 1000);
    graphs.scrubT = null; scrub.visible = false;
    drawGraph();
  }
  function renderAwards() {
    const el = $('awardsBody'); if (!el) return;
    records = store.get(recordsKey(), {});
    el.innerHTML = AWARDS.map(([key, icon, name, , fmt, min]) => {
      const r = records[key];
      return `<div class="award ${r ? 'won' : ''}"><i>${icon}</i><div><b>${L(name)}</b><span class="small muted">${r ? fmt(r.v) : L('Beat {0}', fmt(min))}</span></div></div>`;
    }).join('') + (isClassic() ? `<div class="award won classic"><i>🏅</i><div><b>${L('Classic coaster')}</b><span class="small muted">${L('Great fun, ride after ride')}</span></div></div>` : `<div class="award"><i>🏅</i><div><b>${L('Classic coaster')}</b><span class="small muted">${L('Score 8+ fun five times')}</span></div></div>`);
  }
  function pieceInfo(id) {
    const s = pieceStats.get(id);
    if (!s || !s.balls.size) return '';
    return L('📊 {0} balls · top {1} m/s', s.balls.size, s.maxV.toFixed(2)) + (s.falls ? ' · ' + L('{0} fell off here', s.falls) : '');
  }
  function roomChanged() { records = store.get(recordsKey(), {}); pieceStats.clear(); lastRun = null; renderWindow(); renderAwards(); }

  return {
    news, tick, event, ballGone, heat, updateGhost, renderWindow, renderAwards, pieceInfo, isClassic, roomChanged,
    get lastRun() { return lastRun; },
    get heatKey() { return heatKey; },
    get heatGroup() { return heatGroup; },
    hideScrub() { scrub.visible = false; },
  };
}
