// The build camera's helpers. All of them are on by default, because a new player who fights the
// camera gives up before building anything:
// - whatever the camera looks at sits in the middle of the part of the screen that is free (not under
//   the top bar, the dock, a sheet or a side panel)
// - a tabletop camera: never from below or flat along the floor, never wandering off to look at nothing
// - double-tap (or double-click) a spot to look at it
// - 👁 cycles: from above, from the side, along the track
// - if the coaster has been off the screen for a few seconds, a big "Back to my coaster" button
import * as THREE from 'three';
import { L } from './i18n.js';

const DEG = Math.PI / 180, UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;

export function createCameraAssist(app) {
  const { S, $, camera, controls, canvas } = app;
  controls.minPolarAngle = 8 * DEG;
  controls.maxPolarAngle = 76 * DEG;
  controls.maxDistance = 4.5;

  // ------------------------------------------------ the free part of the screen
  const free = { l: 0, t: 0, r: window.innerWidth, b: window.innerHeight };
  let measuredAt = -1e9;
  const shown = (el) => { if (!el || el.classList.contains('hidden')) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
  function measure() {
    const W = window.innerWidth, H = window.innerHeight;
    let t = 0, b = H, l = 0, r = W;
    const top = shown($('top'));
    if (top) t = Math.max(t, top.bottom);
    // whatever sits along the bottom: the dock (with a sheet in it), the build pad
    for (const id of ['dock', 'buildPad']) {
      const q = shown($(id));
      if (q && q.bottom > H * 0.7 && q.top > t) b = Math.min(b, q.top);
    }
    const sel = $('selPop');
    if (sel.classList.contains('aside')) { const q = shown(sel); if (q) r = Math.min(r, q.left); }
    if (document.body.classList.contains('side-open')) { const q = shown($('side')); if (q && q.left > W * 0.4) r = Math.min(r, q.left); }
    // never squeeze the view into a sliver
    if (b - t < H * 0.3) b = Math.min(H, t + H * 0.3);
    if (r - l < W * 0.4) r = l + W * 0.4;
    Object.assign(free, { l, t, r, b });
  }
  const off = { x: 0, y: 0 };
  function updateOffset(dt, now) {
    if (now - measuredAt > 150) { measuredAt = now; measure(); }
    const W = window.innerWidth, H = window.innerHeight;
    const on = S.cam === 'orbit' && !S.photo && !S.replay;
    const gx = on ? W / 2 - (free.l + free.r) / 2 : 0, gy = on ? H / 2 - (free.t + free.b) / 2 : 0;
    const k = app.reduceMotion() ? 1 : 1 - Math.exp(-dt * 6);
    off.x += (gx - off.x) * k; off.y += (gy - off.y) * k;
    if (Math.abs(off.x) < 0.5 && Math.abs(off.y) < 0.5 && !gx && !gy) { if (camera.view && camera.view.enabled) camera.clearViewOffset(); return; }
    camera.setViewOffset(W, H, off.x, off.y, W, H);
  }
  // how wide the camera sees across the free part, as half-angles (for framing things)
  function halfAngles() {
    const H = window.innerHeight, W = window.innerWidth, tv = Math.tan(camera.fov * DEG / 2);
    return { v: Math.atan(tv * (free.b - free.t) / H), h: Math.atan(tv * camera.aspect * (free.r - free.l) / W) };
  }
  // is a point comfortably inside the free part of the screen? (margin in pixels)
  const _p = new THREE.Vector3();
  function onScreen(p, margin = 0) {
    _p.copy(p).project(camera);
    if (_p.z > 1) return false;
    const r = canvas.getBoundingClientRect();
    const x = r.left + (_p.x + 1) / 2 * r.width, y = r.top + (1 - _p.y) / 2 * r.height;
    return x > free.l + margin && x < free.r - margin && y > free.t + margin && y < free.b - margin;
  }

  // ------------------------------------------------ in the room
  // what the camera looks at stays inside the room. The camera itself may step back through a wall
  // (walls are see-through from behind, like a dollhouse) but not too far, nor through the floor or
  // the ceiling.
  const inner = () => { const b = app.room.bounds; return { x0: b.x0 + 0.05, x1: b.x1 - 0.05, y0: 0.04, y1: b.h - 0.05, z0: b.z0 + 0.05, z1: b.z1 - 0.05 }; };
  const OUT = 1.2;
  const outer = () => { const B = inner(); return { ...B, x0: B.x0 - OUT, x1: B.x1 + OUT, z0: B.z0 - OUT, z1: B.z1 + OUT }; };
  // how far from c the camera can go along dir before reaching that limit (the floor, the ceiling...)
  function reach(c, dir) {
    const B = outer();
    let t = Infinity;
    for (const [a, lo, hi] of [['x', B.x0, B.x1], ['y', B.y0, B.y1], ['z', B.z0, B.z1]]) {
      const d = dir[a];
      if (d > 1e-6) t = Math.min(t, (hi - c[a]) / d); else if (d < -1e-6) t = Math.min(t, (lo - c[a]) / d);
    }
    return Math.max(0, t);
  }
  // a camera spot looking at c from about dir, dist away, that is inside the room. If a wall is in
  // the way the camera swings round a little rather than squeezing up against it.
  function spot(c, dir, dist, swing = true) {
    const d0 = dir.clone().normalize();
    let best = null;
    for (const a of swing ? [0, 20, -20, 40, -40, 65, -65, 90, -90, 135, -135, 180] : [0]) {
      const d = d0.clone().applyAxisAngle(UP, a * DEG);
      const can = Math.min(dist, reach(c, d));
      if (!best || can > best.can + 0.02 + Math.abs(a) * 0.0006) best = { d, can };
      if (can >= dist * 0.97) break;
    }
    return c.clone().addScaledVector(best.d, Math.max(0.05, best.can));
  }
  // after the controls have moved the camera: the point it looks at stays in the room (so you can't
  // slide off into nothing), and so does the camera
  function keepInRoom() {
    const B = inner(), O = outer(), t = controls.target, p = camera.position;
    const tx = clamp(t.x, B.x0, B.x1), ty = clamp(t.y, 0, B.y1 - 0.05), tz = clamp(t.z, B.z0, B.z1);
    if (tx !== t.x || ty !== t.y || tz !== t.z) { p.x += tx - t.x; p.y += ty - t.y; p.z += tz - t.z; t.set(tx, ty, tz); }
    p.set(clamp(p.x, O.x0, O.x1), clamp(p.y, O.y0, O.y1), clamp(p.z, O.z0, O.z1));
  }

  // ------------------------------------------------ calmer fingers
  canvas.addEventListener('pointerdown', (e) => {
    const touch = e.pointerType === 'touch';
    controls.rotateSpeed = touch ? 0.6 : 1;
    controls.panSpeed = touch ? 0.8 : 1;
  }, true);
  let gestures = 0;
  controls.addEventListener('end', () => { gestures++; });

  // ------------------------------------------------ double-tap to look there
  let lastTap = null;
  function lookAt(p) {
    const cur = camera.position.clone().sub(controls.target);
    const d = clamp(cur.length() * 0.6, 0.28, 1.1);
    app.flyTo(spot(p, cur, d), p.clone());
    app.sound.click();
  }
  // called with each quick tap or click on the room (the ray is already set); true when it was the
  // second tap of a double-tap and the camera went to look
  function doubleTap(e) {
    const now = performance.now();
    const dbl = lastTap && now - lastTap.t < 400 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
    lastTap = dbl ? null : { t: now, x: e.clientX, y: e.clientY };
    if (!dbl || S.cam !== 'orbit' || S.tool !== 'select' || S.move || S.replay || S.photo) return false;
    const h = app.pickLook();
    if (!h) return false;
    lookAt(h.point);
    return true;
  }

  // ------------------------------------------------ framing
  // fly so that p sits in the middle of the free part (keeping how far away and from where), unless
  // it is already comfortably on screen
  function keepVisible(p, margin = 50, pull = 1) {
    if (!p || S.cam !== 'orbit' || onScreen(p, margin)) return false;
    const offv = camera.position.clone().sub(controls.target), t = controls.target.clone().lerp(p, pull);
    app.flyTo(spot(t, offv, offv.length()), t);
    return true;
  }
  // a close look at something about `size` big: a good angle (not flat, not straight down) and a
  // distance that fits it in the free part
  function frame(p, size = 0.1, instant) {
    const cur = camera.position.clone().sub(controls.target);
    if (cur.lengthSq() < 1e-6) cur.set(0, 0.6, 1);
    cur.normalize(); cur.y = clamp(cur.y, 0.45, 0.82); cur.normalize();
    const A = halfAngles(), dist = clamp(size / Math.sin(Math.min(A.v, A.h)) * 1.15, 0.2, 1.4);
    // already there? then stay put (no wobble after every piece)
    if (controls.target.distanceTo(p) < size * 0.25 && Math.abs(camera.position.distanceTo(controls.target) - dist) < dist * 0.2) return;
    app.flyTo(spot(p, cur, dist), p.clone(), instant);
  }
  // the distance at which a ball of radius r fits the free part
  const fitDistance = (r) => { const A = halfAngles(); return r / Math.sin(Math.min(A.v, A.h)) * 0.95; };

  // ------------------------------------------------ 👁 from above, from the side, along the track
  const VIEWS = [
    { name: 'From above', icon: '⬇', polar: 14 },
    { name: 'From the side', icon: '↔', polar: 68, side: true },
    { name: 'Along the track', icon: '➜', polar: 50, along: true },
  ];
  let viewI = -1;
  function cycleView() {
    if (S.cam !== 'orbit') app.setCam('orbit');
    viewI = (viewI + 1) % VIEWS.length;
    const v = VIEWS[viewI];
    const ring = S.ringInfo && S.ringInfo.p;
    const c = S.selected && app.insts.has(S.selected) ? S.selAnchor.clone() : ring && onScreen(ring) ? ring.clone() : controls.target.clone();
    const port = app.headingPort();
    const cur = camera.position.clone().sub(controls.target), flat = new THREE.Vector3(cur.x, 0, cur.z);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
    flat.normalize();
    const h = port ? new THREE.Vector3(Math.cos(port.psi), 0, -Math.sin(port.psi)) : flat.clone().negate();
    let hz = flat;
    if (v.side) { const n = new THREE.Vector3(-h.z, 0, h.x); hz = n.dot(flat) >= 0 ? n : n.negate(); }
    else if (v.along) hz = h.clone().negate();
    const dir = hz.multiplyScalar(Math.sin(v.polar * DEG)).add(new THREE.Vector3(0, Math.cos(v.polar * DEG), 0));
    const dist = clamp(cur.length(), 0.4, 1.6);
    app.flyTo(spot(c, dir, dist, false), c);
    app.toast(`${v.icon} ${L(v.name)}`);
    app.sound.click();
  }

  // ------------------------------------------------ lost? a big button back to the coaster
  let lostSince = 0, checkedAt = 0, lostShown = false, bornAt = performance.now();
  const _q = new THREE.Vector3();
  function coasterSeen(box) {
    for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 2; k++) {
      _q.set(THREE.MathUtils.lerp(box.min.x, box.max.x, i / 2), THREE.MathUtils.lerp(box.min.y, box.max.y, j / 2), THREE.MathUtils.lerp(box.min.z, box.max.z, k / 2));
      if (onScreen(_q, 10)) return true;
    }
    return false;
  }
  function lostTick(now) {
    if (now - checkedAt < 250) return;
    checkedAt = now;
    let lost = false;
    // (not while you are choosing a spot for a new tower or toy: then looking elsewhere is the point)
    if (S.cam === 'orbit' && !S.photo && !S.replay && !S.move && !S.stroke && !app.placing() && now - bornAt > 4000) {
      const box = app.coasterBox();
      lost = !box.isEmpty() && !coasterSeen(box);
    }
    if (!lost) lostSince = 0; else if (!lostSince) lostSince = now;
    const show = !!lostSince && now - lostSince > 3000 && !app.flying();
    if (show !== lostShown) { lostShown = show; $('lostBtn').classList.toggle('hidden', !show); }
  }
  $('lostBtn').onclick = () => { app.fitView(); app.sound.click(); lostSince = 0; lostShown = false; $('lostBtn').classList.add('hidden'); };

  function tick(dt, now) {
    updateOffset(dt, now);
    lostTick(now);
  }

  return { tick, keepInRoom, doubleTap, keepVisible, frame, fitDistance, spot, cycleView, onScreen, free: () => free, measure: () => { measuredAt = -1e9; }, gestures: () => gestures };
}
