// Hidden stars: three in every room, floating where only a well-built run can carry a ball —
// over the highest piece of furniture, out in a far corner, and in mid-air over the room.
// A ball that rolls or flies through one collects it. All three in a room earn a sticker;
// all of them everywhere turn new balls into golden marbles.
import * as THREE from 'three';
import { roomClearance } from './physics.js';
import { L } from './i18n.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PER_ROOM = 3;

// a small chunky star, shared by all of them
const starGeo = (() => {
  const sh = new THREE.Shape();
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.0065 : 0.015;
    if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelSize: 0.0015, bevelThickness: 0.0015, bevelSegments: 2 });
  g.translate(0, 0, -0.003);
  return g;
})();
const starMat = new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#ffb000', emissiveIntensity: 0.55, metalness: 0.5, roughness: 0.3 });

export function createCollectibles(app) {
  const { scene, sound, store } = app;
  const group = new THREE.Group(); scene.add(group);
  let stars = [];
  const found = () => store.get('bc.found', {});

  // three spots worked out from the room itself, the same every time
  function spots(room) {
    const box = new THREE.Box3(), tops = [];
    for (const m of room.placeables || []) {
      box.setFromObject(m);
      if (box.isEmpty() || box.max.y < 0.02) continue;
      tops.push({ p: V((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2), area: (box.max.x - box.min.x) * (box.max.z - box.min.z) });
    }
    const b = room.bounds;
    const clear = (p) => p.x > b.x0 + 0.06 && p.x < b.x1 - 0.06 && p.z > b.z0 + 0.06 && p.z < b.z1 - 0.06 && p.y < b.h - 0.08 && roomClearance(room.colliders, p.x, p.y, p.z) > 0.05;
    const out = [];
    // 1. over the highest surface that is really inside the room and has open air above it
    tops.sort((u, v) => v.p.y - u.p.y);
    const hi = tops.map(t => t.p.clone().add(V(0, 0.08, 0))).find(clear);
    if (hi) out.push(hi);
    // 2. low in the far back corner
    for (const f of [0.75, 0.6, 0.45]) { const p = V(b.x0 + (b.x1 - b.x0) * (1 - f) * 0.5, 0.06, b.z0 + (b.z1 - b.z0) * 0.12); if (clear(p)) { out.push(p); break; } }
    // 3. in mid-air, somewhere different in every room; and another one if a room had no clear top
    let seed = [...room.kind].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
    const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
    for (let tries = 0; out.length < PER_ROOM && tries < 60; tries++) {
      const p = V(b.x0 + (b.x1 - b.x0) * (0.25 + rnd() * 0.5), 0.3 + rnd() * 0.25, b.z0 + (b.z1 - b.z0) * (0.25 + rnd() * 0.5));
      if (clear(p) && out.every(q => q.distanceTo(p) > 0.4)) out.push(p);
    }
    while (out.length < PER_ROOM) out.push(V((b.x0 + b.x1) / 2, 0.25 + out.length * 0.1, (b.z0 + b.z1) / 2));
    return out.slice(0, PER_ROOM);
  }
  function build(room) {
    for (const s of stars) group.remove(s.mesh);
    const got = found()[room.kind] || [];
    stars = spots(room).map((p, i) => {
      const mesh = new THREE.Mesh(starGeo, starMat);
      mesh.position.copy(p); mesh.visible = !got.includes(i);
      mesh.castShadow = true;
      group.add(mesh);
      return { p, i, mesh, got: got.includes(i) };
    });
  }
  // a fast ball moves several cm between frames: test the whole stretch it moved, not just where it is
  const prev = new WeakMap(), seg = new THREE.Line3(), _q = V();
  function tick(dt, now) {
    const moves = [];
    for (const b of app.world.balls) {
      if (b.dead || b.collected) continue;
      const a = prev.get(b) || b.pos.clone();
      moves.push([a.clone(), b.pos.clone()]);
      prev.set(b, a.copy(b.pos));
    }
    for (const s of stars) {
      if (s.got) continue;
      s.mesh.rotation.y += dt * 1.6;
      s.mesh.position.y = s.p.y + Math.sin(now * 0.002 + s.i) * 0.006;
      if (moves.some(([a, b]) => seg.set(a, b).closestPointToPoint(s.p, true, _q).distanceToSquared(s.p) < 0.035 * 0.035)) collect(s);
    }
  }
  function collect(s) {
    s.got = true; s.mesh.visible = false;
    const kind = app.room.kind, all = found();
    all[kind] = [...new Set([...(all[kind] || []), s.i])];
    store.set('bc.found', all);
    sound.star(Math.min(2, all[kind].length - 1)); app.sparkle(s.p, '#ffd23f', 14);
    const n = all[kind].length;
    app.news('🌟', n < PER_ROOM ? L('You found a hidden star! {0} / {1} in this room', n, PER_ROOM) : L('All the hidden stars in this room! 🌟🌟🌟'));
    if (n === PER_ROOM) app.sticker('stars');
    if (golden()) { app.sticker('golden'); app.news('✨', L('Every hidden star found — your marbles are golden now!')); }
  }
  const total = () => Object.values(found()).reduce((a, l) => a + l.length, 0);
  const golden = () => total() >= PER_ROOM * app.roomCount;
  const countIn = (kind) => (found()[kind] || []).length;

  return { build, tick, golden, countIn, PER_ROOM };
}
