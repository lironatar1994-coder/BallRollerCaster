// The other rooms to build in: kitchen, bathroom, garden and attic. They use the same kit as the
// kid's room (room.js): modelled in design metres inside a group shrunk by ROOM_SCALE, colliders
// built in design units and scaled once at the end, lights added to the scene and scaled by hand.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';
import { PlaneCollider, BoxCollider, SphereCollider, CylinderCollider, RevolveCollider, arc, SURFACES } from './physics.js';
import * as TX from './textures.js';
import { buildRoom, ROOM_SCALE, scaleCollider, disposeTree } from './room.js';

// the room picker, in tour order
export const ROOM_KINDS = [
  { kind: 'kids', name: "Kid's Room", icon: '🧸' },
  { kind: 'kitchen', name: 'Kitchen', icon: '🍳' },
  { kind: 'bath', name: 'Bathroom', icon: '🛁' },
  { kind: 'garden', name: 'Garden', icon: '🌻' },
  { kind: 'attic', name: 'Attic', icon: '🕯️' },
];

export function buildRoomKind(scene, kind) {
  if (kind === 'kids') return buildRoom(scene);
  const build = BUILDERS[kind];
  if (!build) throw new Error(`Unknown room kind: ${kind}`);
  return build(scene);
}

// every room has the kid's room footprint, so the cameras behave the same everywhere
const DESIGN = { x0: -2.4, x1: 2.4, z0: -2.0, z1: 2.0, h: 2.6 };
const TAU = Math.PI * 2;
const DAY_BG = '#f3eee6', NIGHT_BG = '#14132a';

// local → room coordinates for something standing at (x, z), turned by ry (0 = facing +z)
const turn = (x, z, ry) => {
  const c = Math.cos(ry), s = Math.sin(ry);
  return (dx, dz) => [x + dx * c + dz * s, z - dx * s + dz * c];
};

// the paddling pool's inflated rings: RevolveCollider gives exact torus contacts, the distance
// function lets the build checks see them too. Built straight in world units (scaleCollider
// only knows the plain colliders).
class RingsCollider extends RevolveCollider {
  constructor(cx, cz, R, ys, r, surf) {
    super(new THREE.Vector3(cx, 0, cz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), ys.map(y => arc(R, y, r, 0, TAU)), surf);
    this.ringX = cx; this.ringZ = cz; this.ringR = R; this.ringYs = ys; this.tubeR = r;
  }
  sdf(x, y, z) {
    const d = Math.hypot(x - this.ringX, z - this.ringZ) - this.ringR;
    let m = Infinity;
    for (const ty of this.ringYs) m = Math.min(m, Math.hypot(d, y - ty) - this.tubeR);
    return m;
  }
}

// ---------------------------------------------------------------- the shared kit
function kit(scene, kind, roomH = DESIGN.h) {
  const S = ROOM_SCALE;
  const group = new THREE.Group();
  group.name = 'room-' + kind;
  group.scale.setScalar(S);
  scene.add(group);
  const colliders = [], placeables = [], solids = [], glow = [], lights = [], water = [];
  const { x0, x1, z0, z1 } = DESIGN;
  const W = x1 - x0, D = z1 - z0;
  const bounds = { x0: x0 * S, x1: x1 * S, z0: z0 * S, z1: z1 * S, h: roomH * S };
  const V = (x, y, z) => new THREE.Vector3(x, y, z).multiplyScalar(S);

  // the studio reflections are for the toys; walls and furniture only take a little of them
  const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.75, metalness: 0, envMapIntensity: 0.25 }, o));
  const M = {
    white: std({ color: '#f6f1e9', roughness: 0.6 }),
    furniture: std({ color: '#fbf7f0', roughness: 0.55 }),
    wood: std({ map: TX.woodTexture('#e6c28e'), roughness: 0.6 }),
    darkwood: std({ map: TX.woodTexture('#b98454'), roughness: 0.6 }),
    blue: std({ color: '#7fb8ff', roughness: 0.5 }),
    pink: std({ color: '#ff9fc0', roughness: 0.6 }),
    yellow: std({ color: '#ffd45e', roughness: 0.5 }),
    green: std({ color: '#7fdc9b', roughness: 0.6 }),
    mint: std({ color: '#a8ecd6', roughness: 0.6 }),
    peach: std({ color: '#ffc49f', roughness: 0.6 }),
    red: std({ color: '#ff6b6b', roughness: 0.5 }),
    teddy: std({ color: '#c8925a', roughness: 0.95 }),
    teddyLight: std({ color: '#ecc9a0', roughness: 0.95 }),
    black: std({ color: '#2b2b33', roughness: 0.4 }),
    chrome: std({ color: '#dfe6ee', metalness: 0.9, roughness: 0.18, envMapIntensity: 1 }),
    gold: std({ color: '#ffcf5c', metalness: 0.6, roughness: 0.3 }),
  };

  // yaw is applied last, so a tilted part keeps its tilt when the whole thing is turned
  const mesh = (geo, mat, x, y, z, o = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
    m.castShadow = o.cast !== false; m.receiveShadow = true;
    if (o.place) { m.userData.place = true; placeables.push(m); }
    if (o.solid !== false) { m.userData.solid = true; solids.push(m); }
    (o.parent || group).add(m);
    return m;
  };
  const box = (w, h, d, x, y, z, mat, o = {}) => {
    const geo = o.round ? new RoundedBoxGeometry(w, h, d, 3, Math.min(o.round, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
    const m = mesh(geo, mat, x, y, z, o);
    if (o.surf) colliders.push(new BoxCollider(x, y, z, w / 2, h / 2, d / 2, o.ry || 0, o.surf));
    return m;
  };
  const cyl = (r, h, x, y0, z, mat, o = {}) => {
    const m = mesh(new THREE.CylinderGeometry(o.rTop ?? r, r, h, o.seg || 28), mat, x, y0 + h / 2, z, o);
    if (o.surf) colliders.push(new CylinderCollider(x, z, y0, y0 + h, Math.max(r, o.rTop ?? r), o.surf));
    return m;
  };
  // small spheres get fewer segments: there are a lot of them
  const ball = (r, x, y, z, mat, o = {}) => {
    const m = mesh(new THREE.SphereGeometry(r, r > 0.05 ? 28 : 14, r > 0.05 ? 18 : 10), mat, x, y, z, o);
    if (o.surf) colliders.push(new SphereCollider(x, y, z, r, o.surf));
    return m;
  };
  // a flat panel that only shows and takes shadows: walls, pictures, glass
  const panel = (w, h, mat, x, y, z, ry = 0, rx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0, 'YXZ'); m.receiveShadow = true; group.add(m);
    return m;
  };

  // ---- floor, walls, ceiling
  // the floor plus the physics planes of the four walls and the ceiling (in the garden that
  // ceiling is just an invisible lid high above the lawn)
  const floor = (mat, surf) => {
    const f = mesh(new THREE.PlaneGeometry(W, D), mat, 0, 0, 0, { rx: -Math.PI / 2, cast: false, place: true });
    f.userData.surface = 'floor';
    colliders.push(new PlaneCollider(0, 1, 0, 0, surf));
    colliders.push(new PlaneCollider(0, 0, 1, z0, SURFACES.wall), new PlaneCollider(0, 0, -1, -z1, SURFACES.wall));
    colliders.push(new PlaneCollider(1, 0, 0, x0, SURFACES.wall), new PlaneCollider(-1, 0, 0, -x1, SURFACES.wall));
    colliders.push(new PlaneCollider(0, -1, 0, -roomH, SURFACES.wall));
    return f;
  };
  // four walls of height h from y0; mats = [back & front, left & right]
  const walls = (mats, h = roomH, y0 = 0) => {
    panel(W, h, mats[0], 0, y0 + h / 2, z0, 0);
    panel(W, h, mats[0], 0, y0 + h / 2, z1, Math.PI);
    panel(D, h, mats[1], x0, y0 + h / 2, 0, Math.PI / 2);
    panel(D, h, mats[1], x1, y0 + h / 2, 0, -Math.PI / 2);
  };
  const ceiling = (mat) => panel(W, D, mat, 0, roomH, 0, 0, Math.PI / 2);
  // a strip round all four walls: skirting boards, tile trims
  const trim = (mat, y = 0.04, h = 0.08, t = 0.015) => {
    box(W, h, t, 0, y, z0 + t / 2, mat, { solid: false, cast: false });
    box(W, h, t, 0, y, z1 - t / 2, mat, { solid: false, cast: false });
    box(t, h, D, x0 + t / 2, y, 0, mat, { solid: false, cast: false });
    box(t, h, D, x1 - t / 2, y, 0, mat, { solid: false, cast: false });
  };

  // the picture of the sky in the windows (it turns to night with the lights)
  let skyMat = null;
  const sky = () => (skyMat = skyMat || new THREE.MeshBasicMaterial({ map: TX.skyTexture() }));
  const setSky = (on) => { if (skyMat) { skyMat.map = on ? TX.nightSkyTexture() : TX.skyTexture(); skyMat.needsUpdate = true; } };
  // a window in the back wall: frame, cross bars and a sill you can build on; returns the sill top
  const backWindow = (cx, wy, ww, wh) => {
    panel(ww, wh, sky(), cx, wy, z0 + 0.002);
    const fr = M.white;
    box(ww + 0.1, 0.05, 0.05, cx, wy + wh / 2 + 0.025, z0 + 0.025, fr, { solid: false });
    box(ww + 0.1, 0.05, 0.05, cx, wy - wh / 2 - 0.025, z0 + 0.025, fr, { solid: false });
    box(0.05, wh, 0.05, cx - ww / 2 - 0.025, wy, z0 + 0.025, fr, { solid: false });
    box(0.05, wh, 0.05, cx + ww / 2 + 0.025, wy, z0 + 0.025, fr, { solid: false });
    box(0.025, wh, 0.03, cx, wy, z0 + 0.015, fr, { solid: false, cast: false });
    box(ww, 0.025, 0.03, cx, wy, z0 + 0.015, fr, { solid: false, cast: false });
    const sill = wy - wh / 2 - 0.045;
    box(ww + 0.18, 0.03, 0.14, cx, sill - 0.015, z0 + 0.07, fr, { place: true, surf: SURFACES.wood });
    return sill;
  };
  // a door in the front wall; the visitor walks in through it
  const frontDoor = (x, w = 0.85, dh = 2.05, color = '#fff4e0') => {
    const d = new THREE.Mesh(new THREE.BoxGeometry(w, dh, 0.04), std({ color }));
    d.position.set(x, dh / 2, z1 - 0.02); d.receiveShadow = true; group.add(d);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 12), M.gold);
    knob.position.set(x + w / 2 - 0.085, dh * 0.49, z1 - 0.05); group.add(knob);
    return { p: V(x, 0, z1 - 0.25), out: V(x, 0, z1 + 0.4) };
  };

  // ---- toys every room can have
  // a teddy bear sitting on a surface at height y, facing ry; returns the top of its head (world)
  const teddyBear = (x, y, z, ry = 0) => {
    const at = turn(x, z, ry);
    const part = (r, dx, dy, dz, mat, surf) => {
      const [px, pz] = at(dx, dz);
      ball(r, px, y + dy, pz, mat, surf ? { surf: SURFACES.soft } : { solid: false, cast: r > 0.04 });
    };
    part(0.105, 0, 0.1, 0, M.teddy, true);
    part(0.075, 0, 0.26, -0.01, M.teddy, true);
    for (const s of [-1, 1]) {
      part(0.03, s * 0.06, 0.32, -0.01, M.teddy);
      part(0.009, s * 0.028, 0.285, 0.06, M.black);
      part(0.05, s * 0.11, 0.12, 0.04, M.teddy);
      part(0.05, s * 0.06, 0.045, 0.1, M.teddy);
    }
    part(0.032, 0, 0.245, 0.06, M.teddyLight);
    part(0.012, 0, 0.255, 0.09, M.black);
    const [hx, hz] = at(0, 0);
    return V(hx, y + 0.34, hz);
  };
  // a rubber duck with its waterline at y, facing ry, k times the usual size; returns its head top
  let duckMat = null, beakMat = null;
  const duck = (x, y, z, ry, k = 1) => {
    duckMat = duckMat || std({ color: '#ffd23f', roughness: 0.35, envMapIntensity: 0.6 });
    beakMat = beakMat || std({ color: '#ff8c42', roughness: 0.4 });
    const at = turn(x, z, ry);
    const part = (geo, mat, dx, dy, dz, sc, o = {}) => {
      const [px, pz] = at(dx * k, dz * k);
      const m = mesh(geo, mat, px, y + dy * k, pz, Object.assign({ ry, solid: false, cast: k > 0.9 }, o));
      if (sc) m.scale.set(sc[0], sc[1], sc[2]);
      return m;
    };
    part(new THREE.SphereGeometry(0.1 * k, 22, 14), duckMat, 0, 0.025, 0, [1, 0.72, 1.25]);
    part(new THREE.SphereGeometry(0.062 * k, 18, 12), duckMat, 0, 0.12, 0.07);
    part(new THREE.SphereGeometry(0.03 * k, 12, 8), beakMat, 0, 0.105, 0.135, [1.3, 0.45, 1.1]);
    for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.01 * k, 8, 6), M.black, s * 0.032, 0.14, 0.12);
    part(new THREE.ConeGeometry(0.035 * k, 0.07 * k, 10), duckMat, 0, 0.07, -0.12, null, { rx: -0.9 });
    const [hx, hz] = at(0, 0.07 * k);
    return V(hx, y + 0.18 * k, hz);
  };
  // a sagging string of coloured bulbs from a to b; they glow brighter at night
  const bulbMats = new Map();
  const stringLights = (a, b, sag, n, cols = ['#ffd166', '#ff8fa3', '#8bd3ff', '#b8f2a0']) => {
    const mid = a.clone().lerp(b, 0.5); mid.y -= sag * 2;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.004, 4), M.black));
    const geo = new THREE.SphereGeometry(0.018, 10, 8);
    for (let i = 0; i < n; i++) {
      const col = cols[i % cols.length];
      if (!bulbMats.has(col)) {
        const m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.2 });
        bulbMats.set(col, m); glow.push([m, 1.2, 5]);
      }
      const bulb = new THREE.Mesh(geo, bulbMats.get(col));
      bulb.position.copy(curve.getPoint((i + 0.5) / n)); group.add(bulb);
    }
  };

  // ---- water: a translucent glossy surface to look at, axis-aligned boxes for the physics
  let waterMat = null;
  const waterSurface = (geo, x, y, z) => {
    waterMat = waterMat || new THREE.MeshStandardMaterial({ color: '#7cc8f0', transparent: true, opacity: 0.6, roughness: 0.05, metalness: 0.1, envMapIntensity: 1.2, depthWrite: false });
    const m = mesh(geo, waterMat, x, y, z, { rx: -Math.PI / 2, cast: false, solid: false });
    m.renderOrder = 1;
    return m;
  };
  const waterBox = (ax, ay, az, bx, surf, bz) => water.push({ min: V(ax, ay, az), max: V(bx, surf, bz), surf: surf * S });

  // ---- lights live in the scene, so their positions are scaled by hand
  const light = (l, p, t) => {
    l.position.set(p[0] * S, p[1] * S, p[2] * S);
    scene.add(l); lights.push(l);
    if (t) { l.target.position.set(t[0] * S, t[1] * S, t[2] * S); scene.add(l.target); lights.push(l.target); }
    return l;
  };
  const sunLight = (color, intensity, p, t) => {
    const sun = light(new THREE.DirectionalLight(color, intensity), p, t);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -3.2, right: 3.2, top: 3.2, bottom: -3.2, near: 0.5, far: 9 });
    sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.012;
    return sun;
  };
  const background = (col) => {
    if (scene.background && scene.background.isColor) scene.background.set(col);
    else scene.background = new THREE.Color(col);
  };
  const glowAll = (on) => { for (const [m, day, night] of glow) m.emissiveIntensity = on ? night : day; };

  // colliders were built in design units: scale them once; `world` ones are already in world units
  const finish = (o) => {
    for (const c of colliders) { c.room = true; scaleCollider(c, S); }
    for (const c of o.world || []) { c.room = true; colliders.push(c); }
    return {
      kind, name: ROOM_KINDS.find(r => r.kind === kind).name, group, colliders, placeables, solids,
      sun: o.sun, setNight: o.setNight, scale: S, bounds,
      teddy: o.teddy, seats: o.seats, door: o.door, water,
      dispose() { scene.remove(group, ...lights); disposeTree(group); },
    };
  };

  return {
    S, group, colliders, glow, M, std, mesh, box, cyl, ball, panel, V, x0, x1, z0, z1, W, D, roomH,
    floor, walls, ceiling, trim, sky, setSky, backWindow, frontDoor, teddyBear, duck, stringLights,
    waterSurface, waterBox, light, sunLight, background, glowAll, finish,
  };
}

// ---------------------------------------------------------------- kitchen
function buildKitchen(scene) {
  const K = kit(scene, 'kitchen');
  const { group, M, std, mesh, box, cyl, ball, panel, glow, V, x1, z0, z1, roomH: h } = K;

  // ---- floor & walls
  K.floor(std({ map: TX.tilesTexture(['#fff2e0', '#ffc9ad'], '#ecdccb', 4, 3, 2.5), roughness: 0.35 }), SURFACES.floor);
  K.walls([std({ map: TX.wallpaperTexture('#fdeccf'), roughness: 0.9 }), std({ map: TX.wallpaperTexture('#fde3d3'), roughness: 0.9 })]);
  K.ceiling(std({ color: '#fffaf2', roughness: 1 }));
  K.trim(M.white);

  // ---- fridge (back-left corner): a big rounded retro one with magnets; its top is a high perch
  const fx = -1.99, fz = -1.65, fTop = 1.7, fFront = fz + 0.33;
  box(0.78, fTop, 0.66, fx, fTop / 2, fz, std({ color: '#a9d8f5', roughness: 0.35, envMapIntensity: 0.6 }), { round: 0.06, place: true, surf: SURFACES.metal });
  box(0.74, 0.012, 0.01, fx, 1.2, fFront + 0.002, std({ color: '#7fa9c7' }), { solid: false, cast: false });
  for (const [y0, y1] of [[1.3, 1.58], [0.72, 1.05]]) {
    cyl(0.014, y1 - y0, fx + 0.31, y0, fFront + 0.035, M.chrome, { solid: false });
    for (const y of [y0 + 0.02, y1 - 0.02]) box(0.02, 0.02, 0.035, fx + 0.31, y, fFront + 0.0175, M.chrome, { solid: false, cast: false });
  }
  for (const [ch, col, x, y] of [['A', '#ff6b6b', -2.22, 0.6], ['B', '#4c8dff', -2.13, 0.64], ['C', '#3ccf7a', -2.04, 0.59]]) {
    box(0.06, 0.06, 0.012, x, y, fFront + 0.006, std({ map: TX.blockTexture(ch, col), roughness: 0.5 }), { round: 0.004, rz: (x + 2.13) * 2, solid: false, cast: false });
  }
  mesh(new THREE.CircleGeometry(0.045, 5), M.yellow, -1.84, 1.44, fFront + 0.004, { solid: false, cast: false });
  mesh(new THREE.CircleGeometry(0.035, 20), M.pink, -2.18, 1.38, fFront + 0.004, { solid: false, cast: false });
  panel(0.24, 0.18, std({ map: TX.posterTexture('rainbow'), roughness: 0.8 }), -1.98, 0.88, fFront + 0.003);

  // ---- counter along the back wall: cupboards, a sink under the window, the stove
  const cz = -1.7, cTop = 0.9, cab = M.furniture;
  const cupboard = (xa, xb) => {
    const w = xb - xa, x = (xa + xb) / 2;
    box(w, 0.86, 0.6, x, 0.43, cz, cab, { surf: SURFACES.wood });
    box(w, 0.04, 0.62, x, 0.88, cz + 0.01, M.wood, { place: true, surf: SURFACES.wood });
    const n = w > 0.7 ? 2 : 1, dw = w / n - 0.04;
    for (let i = 0; i < n; i++) {
      const dx = xa + (i + 0.5) * w / n;
      box(dw, 0.7, 0.02, dx, 0.43, cz + 0.31, M.mint, { round: 0.008, solid: false, cast: false });
      ball(0.018, dx + (n === 2 && i ? -1 : 1) * (dw / 2 - 0.06), 0.62, cz + 0.335, M.yellow, { solid: false, cast: false });
    }
  };
  cupboard(-1.5, -0.32); cupboard(0.32, 1.25); cupboard(1.95, x1);
  // the sink: a steel basin between the cupboards, open on top so a ball can drop in
  const sTop = 0.66;
  box(0.64, sTop, 0.6, 0, sTop / 2, cz, cab, { surf: SURFACES.metal });
  box(0.64, cTop - sTop, 0.04, 0, (sTop + cTop) / 2, cz + 0.28, cab, { surf: SURFACES.wood });
  box(0.64, cTop - sTop, 0.18, 0, (sTop + cTop) / 2, z0 + 0.09, M.wood, { surf: SURFACES.wood });
  for (const [w, hh, d, x, y, z] of [[0.64, 0.006, 0.38, 0, sTop + 0.003, -1.63], [0.64, 0.24, 0.006, 0, 0.78, -1.817], [0.64, 0.24, 0.006, 0, 0.78, -1.443], [0.006, 0.24, 0.38, -0.317, 0.78, -1.63], [0.006, 0.24, 0.38, 0.317, 0.78, -1.63]]) {
    box(w, hh, d, x, y, z, M.chrome, { solid: false, cast: false });
  }
  box(0.58, 0.52, 0.02, 0, 0.32, cz + 0.31, M.mint, { round: 0.008, solid: false, cast: false });
  ball(0.018, 0, 0.5, cz + 0.335, M.yellow, { solid: false, cast: false });
  cyl(0.02, 0.2, 0, cTop, -1.93, M.chrome, { surf: SURFACES.metal });
  cyl(0.014, 0.18, 0, 1.0, -1.84, M.chrome, { rx: Math.PI / 2, solid: false });
  cyl(0.014, 0.05, 0, 1.04, -1.755, M.chrome, { solid: false, cast: false });
  // a striped mat in front of the sink
  box(0.9, 0.012, 0.45, 0, 0.006, -1.12, std({ map: TX.stripesTexture(['#8bd3ff', '#ffffff', '#ffd166', '#ffffff']), roughness: 1 }), { round: 0.005, place: true, surf: SURFACES.carpet, cast: false });

  // stove: white enamel, four burners, an oven window and a little clock that glows at night
  const sx = 1.6, enamel = std({ color: '#fffdf8', roughness: 0.3, envMapIntensity: 0.5 });
  box(0.7, cTop, 0.6, sx, cTop / 2, cz, enamel, { round: 0.015, surf: SURFACES.metal });
  box(0.7, 0.16, 0.06, sx, cTop + 0.08, z0 + 0.03, enamel, { round: 0.01, surf: SURFACES.metal });
  const burner = new THREE.CylinderGeometry(0.075, 0.075, 0.01, 24);
  for (const [bx, bz] of [[-0.16, 0.12], [0.16, 0.12], [-0.16, -0.14], [0.16, -0.14]]) mesh(burner, M.black, sx + bx, cTop + 0.005, cz + bz, { solid: false, cast: false });
  const clockMat = new THREE.MeshStandardMaterial({ color: '#173a2a', emissive: '#5dffa8', emissiveIntensity: 0.4 });
  glow.push([clockMat, 0.4, 2.2]);
  panel(0.12, 0.05, clockMat, sx, cTop + 0.09, z0 + 0.061);
  box(0.6, 0.48, 0.02, sx, 0.4, cz + 0.31, enamel, { round: 0.008, solid: false, cast: false });
  panel(0.4, 0.2, std({ color: '#3a3346', roughness: 0.15, envMapIntensity: 0.8 }), sx, 0.42, cz + 0.321);
  mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.44, 10), M.chrome, sx, 0.6, cz + 0.345, { rz: Math.PI / 2, solid: false, cast: false });
  ['#ff6b6b', '#ffd45e', '#7fdc9b', '#7fb8ff'].forEach((col, i) => {
    mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.025, 14), std({ color: col }), sx - 0.21 + i * 0.14, 0.78, cz + 0.312, { rx: Math.PI / 2, solid: false, cast: false });
  });
  // a pot on the back burner
  cyl(0.1, 0.12, sx - 0.16, cTop, cz - 0.14, M.red, { surf: SURFACES.metal });
  cyl(0.104, 0.012, sx - 0.16, cTop + 0.12, cz - 0.14, M.red, { solid: false });
  ball(0.016, sx - 0.16, cTop + 0.14, cz - 0.14, M.white, { solid: false, cast: false });
  for (const s of [-1, 1]) box(0.04, 0.012, 0.025, sx - 0.16 + s * 0.115, cTop + 0.1, cz - 0.14, M.black, { solid: false, cast: false });

  // window over the sink, tiles behind the counter, gingham café curtains
  const sill = K.backWindow(0, 1.65, 1.0, 0.8);
  panel(3.9, 0.27, std({ map: TX.tilesTexture(['#c9f0e4', '#e2f8f0'], '#ffffff', 4, 7, 0.5), roughness: 0.3 }), 0.45, cTop + 0.135, z0 + 0.003);
  {
    const mat = new THREE.MeshStandardMaterial({ map: TX.ginghamTexture('#ffc94d', 8, 1, 3), roughness: 1, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const g = new THREE.PlaneGeometry(0.28, 1.0, 14, 1);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 40) * 0.02);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.position.set(side * 0.72, 1.62, z0 + 0.06); group.add(m);
    }
    mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.7, 8), M.darkwood, 0, 2.15, z0 + 0.06, { rz: Math.PI / 2, solid: false, cast: false });
  }

  // open shelf over the counter: jars, and a light strip underneath for the evening
  const shX = 1.625, shW = 1.35, shY = 1.5, shZ = z0 + 0.12;
  box(shW, 0.03, 0.24, shX, shY, shZ, M.wood, { place: true, surf: SURFACES.wood });
  for (const bx of [shX - 0.55, shX + 0.55]) box(0.03, 0.14, 0.2, bx, shY - 0.085, z0 + 0.1, M.white, { solid: false, cast: false });
  const glass = std({ color: '#fffaf2', roughness: 0.3, envMapIntensity: 0.5 });
  ['#ff9fc0', '#ffd45e', '#7fdc9b', '#8bd3ff'].forEach((col, i) => {
    const x = 1.35 + i * 0.25, jh = 0.14 + (i % 2) * 0.04, lid = std({ color: col });
    cyl(0.055, jh, x, shY + 0.015, shZ, glass);
    cyl(0.0565, 0.05, x, shY + 0.05, shZ, lid, { solid: false, cast: false });
    cyl(0.058, 0.03, x, shY + 0.015 + jh, shZ, lid, { solid: false, cast: false });
  });
  K.colliders.push(new BoxCollider(1.725, shY + 0.125, shZ, 0.43, 0.11, 0.06, 0, SURFACES.plastic));
  const stripMat = new THREE.MeshStandardMaterial({ color: '#fff8e8', emissive: '#ffe6b0', emissiveIntensity: 0.3 });
  glow.push([stripMat, 0.3, 2.4]);
  box(shW - 0.1, 0.012, 0.03, shX, shY - 0.021, z0 + 0.2, stripMat, { solid: false, cast: false });

  // ---- sideboard on the right wall, a cake on a stand, a wall clock above
  const sbx = 2.19, sbz = 0.1, sbTop = 0.83;
  box(0.42, 0.8, 1.2, sbx, 0.4, sbz, std({ color: '#ffd9c7', roughness: 0.6 }), { round: 0.02, surf: SURFACES.wood });
  box(0.45, 0.03, 1.24, sbx - 0.015, sbTop - 0.015, sbz, M.wood, { place: true, surf: SURFACES.wood });
  for (const dz of [-0.4, 0, 0.4]) {
    box(0.02, 0.2, 0.36, sbx - 0.215, 0.64, sbz + dz, M.white, { round: 0.006, solid: false, cast: false });
    ball(0.018, sbx - 0.235, 0.64, sbz + dz, M.yellow, { solid: false, cast: false });
  }
  for (const dz of [-0.29, 0.29]) {
    box(0.02, 0.44, 0.56, sbx - 0.215, 0.27, sbz + dz, M.white, { round: 0.006, solid: false, cast: false });
    ball(0.018, sbx - 0.235, 0.4, sbz + dz - Math.sign(dz) * 0.22, M.yellow, { solid: false, cast: false });
  }
  {
    const [kx, kz] = [2.18, -0.3];
    cyl(0.03, 0.08, kx, sbTop, kz, M.white, { surf: SURFACES.plastic });
    cyl(0.15, 0.015, kx, sbTop + 0.08, kz, M.white, { surf: SURFACES.plastic });
    cyl(0.11, 0.1, kx, sbTop + 0.095, kz, M.pink, { surf: SURFACES.soft });
    cyl(0.113, 0.022, kx, sbTop + 0.185, kz, std({ color: '#fffaf2' }), { solid: false });
    ball(0.025, kx, sbTop + 0.23, kz, M.red, { solid: false });
    // plates leaning on the wall
    for (const [pz, col] of [[0.1, '#ffffff'], [0.3, '#a8ecd6']]) mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 24), std({ color: col, roughness: 0.35 }), 2.36, sbTop + 0.11, pz, { rz: Math.PI / 2 - 0.15, solid: false });
  }
  {
    const cy = 1.75, cx = x1 - 0.012;
    mesh(new THREE.CircleGeometry(0.19, 32), M.white, cx, cy, sbz, { ry: -Math.PI / 2, solid: false, cast: false });
    mesh(new THREE.TorusGeometry(0.2, 0.022, 8, 36), M.peach, cx, cy, sbz, { ry: -Math.PI / 2, solid: false, cast: false });
    // hands at two o'clock (seen from the room, +z is to the right)
    for (const [len, a] of [[0.1, 1.05], [0.15, 0]]) box(0.006, len, 0.012, cx - 0.006, cy + Math.cos(a) * len / 2, sbz + Math.sin(a) * len / 2, M.black, { rx: a, solid: false, cast: false });
    ball(0.012, cx - 0.01, cy, sbz, M.black, { solid: false, cast: false });
  }

  // ---- pinboard with drawings, and the door (front wall)
  box(0.9, 0.6, 0.02, -0.35, 1.45, z1 - 0.01, std({ color: '#d9a066', roughness: 0.95 }), { solid: false, cast: false });
  panel(0.3, 0.4, std({ map: TX.posterTexture('rocket') }), -0.55, 1.45, z1 - 0.022, Math.PI);
  panel(0.32, 0.32, std({ map: TX.posterTexture('abc') }), -0.13, 1.47, z1 - 0.022, Math.PI);
  for (const [px, py] of [[-0.55, 1.63], [-0.13, 1.61]]) ball(0.012, px, py, z1 - 0.03, M.red, { solid: false, cast: false });
  const door = K.frontDoor(1.3);

  // ---- kitchen table with a gingham cloth: the big build surface
  const tx = -1.25, tz = 0.85, tTop = 0.76, clothTop = tTop + 0.012;
  box(1.5, 0.04, 0.95, tx, tTop - 0.02, tz, M.wood, { round: 0.01, surf: SURFACES.wood });
  for (const [lx, lz] of [[-0.67, -0.4], [0.67, -0.4], [-0.67, 0.4], [0.67, 0.4]]) cyl(0.03, tTop - 0.04, tx + lx, 0, tz + lz, M.wood, { rTop: 0.035, surf: SURFACES.wood });
  box(1.62, 0.012, 1.07, tx, tTop + 0.006, tz, std({ map: TX.ginghamTexture('#ff8fa3', 8, 5, 3.3), roughness: 0.95 }), { place: true, surf: SURFACES.wood, cast: false });
  // the cloth hangs over the edges
  {
    const long = std({ map: TX.ginghamTexture('#ff8fa3', 8, 5, 0.5), roughness: 0.95, side: THREE.DoubleSide });
    const short = std({ map: TX.ginghamTexture('#ff8fa3', 8, 3.3, 0.5), roughness: 0.95, side: THREE.DoubleSide });
    const fy = clothTop - 0.08;
    panel(1.62, 0.16, long, tx, fy, tz + 0.535, 0);
    panel(1.62, 0.16, long, tx, fy, tz - 0.535, Math.PI);
    panel(1.07, 0.16, short, tx - 0.81, fy, tz, -Math.PI / 2);
    panel(1.07, 0.16, short, tx + 0.81, fy, tz, Math.PI / 2);
  }
  // chairs, facing ry (0 = towards +z); returns the seat top
  const chair = (x, z, ry, mat) => {
    const at = turn(x, z, ry), seat = 0.44;
    let [px, pz] = at(0, 0);
    box(0.4, 0.035, 0.4, px, seat, pz, mat, { ry, round: 0.012, place: true, surf: SURFACES.wood });
    [px, pz] = at(0, -0.185);
    box(0.4, 0.42, 0.035, px, seat + 0.2275, pz, mat, { ry, round: 0.012, surf: SURFACES.wood });
    for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) {
      [px, pz] = at(lx, lz);
      cyl(0.016, seat - 0.0175, px, 0, pz, M.white, { surf: SURFACES.wood });
    }
    return seat + 0.0175;
  };
  const chairMat = std({ color: '#ffd45e', roughness: 0.5 });
  const seatTop = chair(tx, tz - 0.75, 0, chairMat);
  chair(tx + 1.05, tz, -Math.PI / 2, M.mint);
  chair(tx, tz + 0.75, Math.PI, chairMat);
  // Teddy came for tea
  const teddy = K.teddyBear(tx, seatTop, tz - 0.79, 0);
  // fruit bowl at the end of the table
  {
    const bx = tx - 0.55, bz = tz;
    const bowl = mesh(new THREE.SphereGeometry(0.15, 24, 8, 0, TAU, Math.PI / 2, Math.PI / 2), std({ color: '#8bd3ff', roughness: 0.3, side: THREE.DoubleSide }), bx, clothTop + 0.0825, bz);
    bowl.scale.y = 0.55;
    K.colliders.push(new CylinderCollider(bx, bz, clothTop, clothTop + 0.12, 0.15, SURFACES.plastic));
    const orange = std({ color: '#ffa43a', roughness: 0.6 });
    ball(0.045, bx - 0.05, clothTop + 0.07, bz - 0.02, M.red, { solid: false });
    ball(0.043, bx + 0.05, clothTop + 0.07, bz + 0.03, M.green, { solid: false });
    ball(0.044, bx - 0.01, clothTop + 0.075, bz + 0.07, orange, { solid: false });
    ball(0.04, bx + 0.01, clothTop + 0.12, bz - 0.005, orange, { solid: false });
    mesh(new THREE.TorusGeometry(0.075, 0.016, 6, 14, 2.2), M.yellow, bx - 0.02, clothTop + 0.11, bz - 0.06, { rx: 0.5, rz: 0.4, solid: false });
  }
  // pendant lamp over the table
  const lampY = 1.75;
  mesh(new THREE.CylinderGeometry(0.006, 0.006, h - lampY - 0.22, 6), M.black, tx, (h + lampY + 0.22) / 2, tz, { solid: false, cast: false });
  mesh(new THREE.SphereGeometry(0.22, 28, 10, 0, TAU, 0, Math.PI / 2), std({ color: '#ff9f80', roughness: 0.5, side: THREE.DoubleSide }), tx, lampY, tz);
  K.colliders.push(new CylinderCollider(tx, tz, lampY, lampY + 0.22, 0.22, SURFACES.plastic));
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff1c8', emissiveIntensity: 2 });
  glow.push([bulbMat, 2, 4]);
  ball(0.05, tx, lampY - 0.01, tz, bulbMat, { solid: false, cast: false });

  // ---- lights
  const hemi = K.light(new THREE.HemisphereLight('#fff4e0', '#ffe4c8', 0.75), [0, 2, 0]);
  const sun = K.sunLight('#fff0d4', 2.3, [0.8, 3.6, -3.6], [-0.4, 0, 0.5]);
  const lamp = K.light(new THREE.PointLight('#ffd9a8', 2.0, 7, 1.2), [tx, lampY - 0.12, tz]);
  const fill = K.light(new THREE.DirectionalLight('#dbe8ff', 0.5), [2, 2, 3]);
  const under = K.light(new THREE.PointLight('#ffd27a', 0, 3, 1.4), [shX, shY - 0.12, z0 + 0.3]);
  const setNight = (on) => {
    sun.intensity = on ? 0.35 : 2.3; sun.color.set(on ? '#8fa8ff' : '#fff0d4');
    hemi.intensity = on ? 0.14 : 0.75; hemi.color.set(on ? '#7d8cff' : '#fff4e0'); hemi.groundColor.set(on ? '#2b1f3a' : '#ffe4c8');
    lamp.intensity = on ? 1.6 : 2.0; lamp.color.set(on ? '#ffb86b' : '#ffd9a8');
    fill.intensity = on ? 0.05 : 0.5;
    under.intensity = on ? 1.4 : 0;
    K.setSky(on); K.glowAll(on); K.background(on ? NIGHT_BG : DAY_BG);
  };

  return K.finish({
    sun, setNight, teddy, door,
    // fridge top, window sill, sideboard, shelf, counter, the front chair (the first four get toys)
    seats: [V(fx, fTop, fz), V(0.3, sill, z0 + 0.07), V(sbx - 0.01, sbTop, 0.5), V(1.05, shY + 0.015, shZ), V(2.2, cTop, cz), V(tx, seatTop, tz + 0.75)],
  });
}

// ---------------------------------------------------------------- bathroom
function buildBath(scene) {
  const K = kit(scene, 'bath');
  const { group, M, std, mesh, box, cyl, ball, glow, V, x0, x1, z0, z1, roomH: h } = K;

  // ---- floor & walls: tiles up to a mint trim, soft paint above
  K.floor(std({ map: TX.tilesTexture(['#f6fbff', '#afd9f1'], '#d9e6ee', 4, 6, 5), roughness: 0.3 }), SURFACES.floor);
  const tileH = 1.25;
  const tiles = (rx) => std({ map: TX.tilesTexture(['#e4f4ff', '#f7fcff'], '#cfe3ee', 4, rx, tileH / 0.6), roughness: 0.3, envMapIntensity: 0.4 });
  K.walls([tiles(8), tiles(6.7)], tileH);
  K.walls([std({ color: '#fde2ea', roughness: 0.9 }), std({ color: '#dcf2e8', roughness: 0.9 })], h - tileH, tileH);
  K.ceiling(std({ color: '#fffaf2', roughness: 1 }));
  K.trim(M.mint, tileH, 0.05, 0.02);
  K.trim(M.white);

  // ---- bathtub in the back-right corner, full of water
  const tub = { x0: 0.92, x1: 2.32, z0: -1.94, z1: -1.28, y0: 0.1, top: 0.55, surf: 0.42 };
  const tw = tub.x1 - tub.x0, td = tub.z1 - tub.z0, tcx = (tub.x0 + tub.x1) / 2, tcz = (tub.z0 + tub.z1) / 2;
  const enamel = std({ color: '#ffffff', roughness: 0.25, envMapIntensity: 0.6 });
  // the front faces (+z) of the outside are a pink panel
  const front = [enamel, enamel, enamel, enamel, std({ color: '#ffb3c7', roughness: 0.4 }), enamel];
  box(0.22, tub.top, 0.8, 0.81, tub.top / 2, -1.6, front, { round: 0.03, place: true, surf: SURFACES.plastic });
  box(0.08, tub.top, 0.8, 2.36, tub.top / 2, -1.6, front, { round: 0.03, surf: SURFACES.plastic });
  box(tw, tub.top, 0.06, tcx, tub.top / 2, -1.97, enamel, { round: 0.02, surf: SURFACES.plastic });
  box(tw, tub.top, 0.08, tcx, tub.top / 2, -1.24, front, { round: 0.02, surf: SURFACES.plastic });
  box(tw, tub.y0, td, tcx, tub.y0 / 2, tcz, std({ color: '#d8f1ff', roughness: 0.25 }), { surf: SURFACES.plastic, cast: false });
  K.waterSurface(new THREE.PlaneGeometry(tw, td), tcx, tub.surf, tcz);
  K.waterBox(tub.x0, tub.y0, tub.z0, tub.x1, tub.surf, tub.z1);
  // ducks and foam
  const teddy = K.duck(1.35, tub.surf, -1.58, 0.7, 1.25);
  K.duck(1.98, tub.surf, -1.72, -0.6, 0.8);
  {
    const foam = std({ color: '#ffffff', roughness: 0.4, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 9; i++) {
      const b = ball(0.03 + (i % 3) * 0.015, 2.08 + Math.cos(i * 2.4) * 0.16, tub.surf + 0.005, -1.5 + Math.sin(i * 2.4) * 0.11, foam, { solid: false, cast: false });
      b.scale.y = 0.5;
    }
  }
  // tap, knobs and shower on the right wall
  mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 12), M.chrome, x1 - 0.08, 0.74, -1.6, { rz: Math.PI / 2, solid: false });
  cyl(0.022, 0.05, x1 - 0.155, 0.69, -1.6, M.chrome, { solid: false, cast: false });
  for (const [dz, col] of [[-0.13, '#ff6b6b'], [0.13, '#4c8dff']]) {
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 14), M.chrome, x1 - 0.025, 0.86, -1.6 + dz, { rz: Math.PI / 2, solid: false, cast: false });
    ball(0.014, x1 - 0.052, 0.86, -1.6 + dz, std({ color: col }), { solid: false, cast: false });
  }
  cyl(0.012, 1.0, x1 - 0.03, 0.86, -1.6, M.chrome, { solid: false, cast: false });
  mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8), M.chrome, x1 - 0.09, 1.86, -1.6, { rz: Math.PI / 2, solid: false, cast: false });
  cyl(0.065, 0.03, x1 - 0.15, 1.82, -1.6, M.chrome, { rTop: 0.03, solid: false, cast: false });
  // shower curtain, bunched up at the tap end
  mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.7, 10), M.chrome, 1.55, 1.98, -1.22, { rz: Math.PI / 2, solid: false, cast: false });
  {
    const g = new THREE.PlaneGeometry(0.42, 1.2, 16, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 45) * 0.03);
    g.computeVertexNormals();
    const c = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: TX.ginghamTexture('#7fd8c9', 8, 1.5, 4), roughness: 1, side: THREE.DoubleSide }));
    c.position.set(2.17, 1.37, -1.22); group.add(c);
  }
  // little window over the tub
  const sill = K.backWindow(1.55, 1.62, 0.7, 0.5);

  // ---- vanity, basin and a round mirror with bulbs (left wall)
  const vx = -2.13, vz = -1.0, vTop = 0.86, mY = 1.7;
  box(0.54, 0.82, 1.0, vx, 0.41, vz, std({ color: '#bfe8d8', roughness: 0.55 }), { round: 0.02, surf: SURFACES.wood });
  box(0.58, 0.04, 1.04, vx + 0.02, vTop - 0.02, vz, M.white, { round: 0.01, place: true, surf: SURFACES.plastic });
  for (const dz of [-0.25, 0.25]) {
    box(0.02, 0.62, 0.46, vx + 0.28, 0.42, vz + dz, M.white, { round: 0.008, solid: false, cast: false });
    ball(0.018, vx + 0.3, 0.6, vz + dz * 0.2, M.yellow, { solid: false, cast: false });
  }
  cyl(0.1, 0.13, -2.12, vTop, vz, M.white, { rTop: 0.17, surf: SURFACES.plastic });
  mesh(new THREE.CircleGeometry(0.15, 28), std({ color: '#dcefff', roughness: 0.2 }), -2.12, vTop + 0.131, vz, { rx: -Math.PI / 2, solid: false, cast: false });
  cyl(0.016, 0.22, -2.33, vTop, vz, M.chrome, { surf: SURFACES.metal });
  mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 10), M.chrome, -2.27, vTop + 0.21, vz, { rz: Math.PI / 2, solid: false, cast: false });
  cyl(0.035, 0.1, -2.27, vTop, -1.38, M.yellow, { surf: SURFACES.plastic });
  for (const [s, col] of [[-1, '#ff9fc0'], [1, '#7fb8ff']]) mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6), std({ color: col }), -2.27 + s * 0.012, vTop + 0.14, -1.38, { rz: s * 0.2, solid: false, cast: false });
  box(0.09, 0.03, 0.06, -2.25, vTop + 0.015, -0.64, M.pink, { round: 0.012, solid: false, cast: false });
  // a pale glossy mirror with two cartoon glints (a true mirror would only show the dark studio)
  mesh(new THREE.CircleGeometry(0.36, 40), std({ color: '#d4ecf8', metalness: 0.2, roughness: 0.08, envMapIntensity: 1.2 }), x0 + 0.012, mY, vz, { ry: Math.PI / 2, solid: false, cast: false });
  for (const [dz, dy, len] of [[-0.1, 0.08, 0.32], [0.04, -0.02, 0.18]]) box(0.004, len, 0.035, x0 + 0.016, mY + dy, vz + dz, M.white, { rx: -0.75, solid: false, cast: false });
  mesh(new THREE.TorusGeometry(0.38, 0.035, 10, 44), M.yellow, x0 + 0.02, mY, vz, { ry: Math.PI / 2, solid: false, cast: false });
  {
    const bulb = new THREE.MeshStandardMaterial({ color: '#fffaf0', emissive: '#fff1c8', emissiveIntensity: 0.4 });
    glow.push([bulb, 0.4, 3]);
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ball(0.022, x0 + 0.05, mY + Math.sin(a) * 0.38, vz + Math.cos(a) * 0.38, bulb, { solid: false, cast: false }); }
  }
  // a step stool so you can reach the basin
  box(0.36, 0.22, 0.3, -1.6, 0.11, vz, M.yellow, { round: 0.03, place: true, surf: SURFACES.plastic });

  // ---- toilet (back wall), lid down
  const tlx = -0.55;
  box(0.44, 0.38, 0.18, tlx, 0.62, z0 + 0.1, M.white, { round: 0.03, surf: SURFACES.plastic });
  box(0.48, 0.04, 0.21, tlx, 0.83, z0 + 0.105, M.white, { round: 0.015, place: true, surf: SURFACES.plastic });
  cyl(0.02, 0.012, tlx + 0.12, 0.85, z0 + 0.1, M.chrome, { solid: false, cast: false });
  cyl(0.15, 0.38, tlx, 0, -1.6, M.white, { rTop: 0.19, surf: SURFACES.plastic });
  cyl(0.2, 0.03, tlx, 0.38, -1.6, std({ color: '#bfe3f5', roughness: 0.4 }), { place: true, surf: SURFACES.plastic });
  // toilet roll
  mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 18), std({ color: '#ffffff', roughness: 0.9 }), -1.05, 0.62, z0 + 0.08, { rz: Math.PI / 2, solid: false });
  mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 6), M.chrome, -1.05, 0.62, z0 + 0.08, { rz: Math.PI / 2, solid: false, cast: false });
  box(0.02, 0.02, 0.08, -1.12, 0.62, z0 + 0.04, M.chrome, { solid: false, cast: false });

  // ---- bath mat
  box(1.0, 0.014, 0.55, 1.55, 0.007, -0.85, std({ map: TX.stripesTexture(['#ffd6e0', '#ffffff', '#c1e7ff', '#ffffff']), roughness: 1 }), { round: 0.006, place: true, surf: SURFACES.carpet, cast: false });

  // ---- shelves with bottles and folded towels (right wall)
  const shx = x1 - 0.12, shZ = -0.1, shLow = 1.15, shHigh = 1.55;
  for (const y of [shLow, shHigh]) {
    box(0.24, 0.03, 1.2, shx, y, shZ, M.white, { place: true, surf: SURFACES.wood });
    for (const dz of [-0.5, 0.5]) box(0.2, 0.1, 0.02, x1 - 0.1, y - 0.065, shZ + dz, M.white, { solid: false, cast: false });
  }
  [['#ff9fc0', 0.2, 0.045], ['#8bd3ff', 0.16, 0.04], ['#ffd45e', 0.22, 0.04], ['#a8ecd6', 0.14, 0.05], ['#c9b6ff', 0.18, 0.038]].forEach(([col, bh, r], i) => {
    const bz = -0.58 + i * 0.17;
    cyl(r, bh, shx, shLow + 0.015, bz, std({ color: col, roughness: 0.3, envMapIntensity: 0.6 }));
    cyl(r * 0.45, 0.04, shx, shLow + 0.015 + bh, bz, M.white, { solid: false, cast: false });
  });
  K.colliders.push(new BoxCollider(shx, shLow + 0.145, -0.24, 0.06, 0.13, 0.4, 0, SURFACES.plastic));
  ['#ff9fc0', '#a8ecd6', '#ffd45e'].forEach((col, i) => box(0.2, 0.06, 0.3, shx, shHigh + 0.045 + i * 0.06, 0.1, std({ color: col, roughness: 1 }), { round: 0.025, surf: SURFACES.soft }));
  cyl(0.06, 0.1, shx, shHigh + 0.015, -0.45, M.peach, { rTop: 0.07, surf: SURFACES.plastic });
  for (let i = 0; i < 5; i++) {
    const leaf = ball(0.05, shx + Math.cos(i * 1.3) * 0.03, shHigh + 0.16 + (i % 2) * 0.04, -0.45 + Math.sin(i * 1.3) * 0.03, std({ color: i % 2 ? '#4fbf6a' : '#66d17f' }), { solid: false, cast: false });
    leaf.scale.set(0.5, 1.3, 0.5);
  }

  // ---- towel rail on the front wall, the laundry basket, the door
  mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 10), M.chrome, -0.45, 1.2, z1 - 0.06, { rz: Math.PI / 2, solid: false, cast: false });
  for (const ex of [-0.95, 0.05]) box(0.02, 0.02, 0.06, ex, 1.2, z1 - 0.03, M.chrome, { solid: false, cast: false });
  box(0.42, 0.7, 0.025, -0.7, 0.87, z1 - 0.06, std({ map: TX.stripesTexture(['#ff9fc0', '#ffffff', '#ff9fc0', '#ff9fc0']), roughness: 1 }), { round: 0.01, solid: false });
  box(0.42, 0.6, 0.025, -0.2, 0.92, z1 - 0.06, std({ map: TX.stripesTexture(['#8bd3ff', '#ffffff', '#8bd3ff', '#8bd3ff']), roughness: 1 }), { round: 0.01, solid: false });
  const lbx = -1.95, lbz = 1.5;
  cyl(0.21, 0.5, lbx, 0, lbz, std({ map: TX.woodTexture('#e8cfa0'), roughness: 0.9 }), { rTop: 0.24, surf: SURFACES.wood });
  cyl(0.255, 0.04, lbx, 0.5, lbz, M.mint, { place: true, surf: SURFACES.wood });
  const door = K.frontDoor(1.2);

  // ---- ceiling lamp and a little moon night-light
  {
    const lampMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff3d6', emissiveIntensity: 1.2 });
    glow.push([lampMat, 1.2, 2.2]);
    const l = mesh(new THREE.SphereGeometry(0.3, 28, 10, 0, TAU, Math.PI / 2, Math.PI / 2), lampMat, 0.2, h, -0.2, { solid: false, cast: false });
    l.scale.y = 0.4;
    const moon = new THREE.MeshStandardMaterial({ color: '#fff4b0', emissive: '#ffe680', emissiveIntensity: 0.15 });
    glow.push([moon, 0.15, 3]);
    mesh(new THREE.CircleGeometry(0.05, 20), moon, x0 + 0.012, 0.4, 0.5, { ry: Math.PI / 2, solid: false, cast: false });
  }

  // ---- lights
  const hemi = K.light(new THREE.HemisphereLight('#e8f6ff', '#fff0e6', 0.8), [0, 2, 0]);
  const sun = K.sunLight('#fff3dc', 2.2, [1.5, 3.6, -3.8], [0.2, 0, 0.3]);
  const lamp = K.light(new THREE.PointLight('#ffe2b8', 2.0, 7, 1.2), [0.2, h - 0.3, -0.2]);
  const fill = K.light(new THREE.DirectionalLight('#dbe8ff', 0.5), [2, 2, 3]);
  const mirrorLight = K.light(new THREE.PointLight('#ffd9a0', 0, 3, 1.3), [-1.9, mY, vz]);
  const setNight = (on) => {
    sun.intensity = on ? 0.35 : 2.2; sun.color.set(on ? '#8fa8ff' : '#fff3dc');
    hemi.intensity = on ? 0.14 : 0.8; hemi.color.set(on ? '#7d8cff' : '#e8f6ff'); hemi.groundColor.set(on ? '#2b1f3a' : '#fff0e6');
    lamp.intensity = on ? 1.1 : 2.0; lamp.color.set(on ? '#ffb86b' : '#ffe2b8');
    fill.intensity = on ? 0.05 : 0.5;
    mirrorLight.intensity = on ? 1.2 : 0;
    K.setSky(on); K.glowAll(on); K.background(on ? NIGHT_BG : DAY_BG);
  };

  return K.finish({
    sun, setNight, teddy, door,
    // vanity, toilet tank, tub ledge, shelf, laundry basket lid, step stool (the first four get toys)
    seats: [V(-1.98, vTop, -1.38), V(tlx, 0.85, z0 + 0.105), V(0.81, tub.top, -1.6), V(shx, shLow + 0.015, 0.38), V(lbx, 0.54, lbz), V(-1.6, 0.22, vz)],
  });
}

// ---------------------------------------------------------------- garden
function buildGarden(scene) {
  const top = 3.0;
  const K = kit(scene, 'garden', top);
  const { group, M, std, mesh, box, cyl, ball, V, S, x0, x1, z0, z1, D } = K;

  // ---- lawn inside the fence (you build on it) and more lawn out to the sky
  K.floor(std({ map: TX.grassTexture(4, 3.4), roughness: 0.95 }), SURFACES.carpet);
  {
    const outer = new THREE.Shape();
    outer.absarc(0, 0, 11.8, 0, TAU, false);
    const hole = new THREE.Path();
    hole.moveTo(x0, z0); hole.lineTo(x1, z0); hole.lineTo(x1, z1); hole.lineTo(x0, z1); hole.closePath();
    outer.holes.push(hole);
    // shape UVs are in metres: the same 1.2 m grass tile as inside
    mesh(new THREE.ShapeGeometry(outer, 48), std({ map: TX.grassTexture(0.83, 0.83), roughness: 1 }), 0, -0.002, 0, { rx: -Math.PI / 2, cast: false, solid: false });
  }
  // the sky dome, drawn first behind everything
  const skyMat = new THREE.MeshBasicMaterial({ map: TX.skyDomeTexture(false), side: THREE.BackSide, depthWrite: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(12, 32, 16), skyMat);
  dome.renderOrder = -1; group.add(dome);
  // hills and trees far away
  {
    const hill = std({ color: '#9fdc8c', roughness: 1 });
    for (const [x, z, r, sy] of [[-7, -8, 4.5, 0.32], [5, -8.5, 5, 0.26], [9, 1, 4, 0.3], [-9, 2, 4, 0.28]]) {
      const m = mesh(new THREE.SphereGeometry(r, 24, 10), hill, x, 0, z, { cast: false, solid: false });
      m.scale.y = sy;
    }
    const leaf = std({ map: TX.leafTexture('#6cc070', 2, 1), roughness: 1 }), bark = std({ map: TX.woodTexture('#9c6b43'), roughness: 0.9 });
    for (const [x, z, s] of [[-4.5, -5.5, 1.1], [-1.5, -6.5, 0.9], [3.2, -6, 1.2], [6.2, -3.5, 1], [-6.5, -1.5, 1], [6.5, 3.5, 0.9], [-5.5, 4.5, 1.1]]) {
      cyl(0.12 * s, 1.2 * s, x, 0, z, bark, { solid: false, cast: false });
      ball(0.7 * s, x, 1.6 * s, z, leaf, { solid: false, cast: false });
    }
  }

  // ---- picket fence on three sides (one instanced mesh), the gate in the right fence
  const fenceMat = std({ color: '#fffaf2', roughness: 0.6 });
  const gateZ = 0, gateW = 0.8;
  const picket = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-0.04, 0), new THREE.Vector2(0.04, 0), new THREE.Vector2(0.04, 0.74), new THREE.Vector2(0, 0.8), new THREE.Vector2(-0.04, 0.74)]), { depth: 0.022, bevelEnabled: false });
  picket.translate(0, 0, -0.011);
  {
    // the pickets stand just outside the bounds, so the wall planes are their inner faces
    const spots = [];
    for (let x = -1.88; x < x1 - 0.05; x += 0.13) spots.push([x, z0 - 0.011, 0], [x, z1 + 0.011, 0]);
    for (let z = z0 + 0.08; z < z1 - 0.05; z += 0.13) if (Math.abs(z - gateZ) > gateW / 2 + 0.04) spots.push([x1 + 0.011, z, Math.PI / 2]);
    const fence = new THREE.InstancedMesh(picket, fenceMat, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    spots.forEach(([x, z, ry], i) => fence.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(up, ry), one)));
    fence.castShadow = fence.receiveShadow = true;
    group.add(fence);
    const rails = (len, x, z, ry) => { for (const y of [0.2, 0.58]) box(len, 0.06, 0.025, x, y, z, fenceMat, { ry, solid: false, cast: false }); };
    rails(x1 + 1.95, (x1 - 1.95) / 2, z0 - 0.04, 0);
    rails(x1 + 1.95, (x1 - 1.95) / 2, z1 + 0.04, 0);
    const ga = gateZ - gateW / 2 - 0.04, gb = gateZ + gateW / 2 + 0.04;
    rails(ga - z0, x1 + 0.04, (z0 + ga) / 2, Math.PI / 2);
    rails(z1 - gb, x1 + 0.04, (z1 + gb) / 2, Math.PI / 2);
    const post = (x, z, ph = 0.95) => { box(0.08, ph, 0.08, x, ph / 2, z, fenceMat, { solid: false }); ball(0.05, x, ph + 0.03, z, fenceMat, { solid: false, cast: false }); };
    post(x1 + 0.02, z0 - 0.02); post(x1 + 0.02, z1 + 0.02); post(-1.93, z0 - 0.02); post(-1.93, z1 + 0.02);
    for (const s of [-1, 1]) post(x1 + 0.03, gateZ + s * (gateW / 2 + 0.03), 1.05);
    // the gate: blue pickets on two rails and a brace
    const gateMat = std({ color: '#8bd3ff', roughness: 0.5 });
    for (let i = 0; i < 6; i++) mesh(picket, gateMat, x1 + 0.011, 0.02, gateZ - 0.33 + i * 0.132, { ry: Math.PI / 2, solid: false });
    for (const y of [0.22, 0.6]) box(gateW - 0.04, 0.06, 0.025, x1 + 0.04, y, gateZ, gateMat, { ry: Math.PI / 2, solid: false, cast: false });
    box(0.025, 0.5, 0.05, x1 + 0.04, 0.41, gateZ, gateMat, { rx: 0.8, solid: false, cast: false });
  }

  // ---- the hedge along the left: a long topiary you can build on
  box(0.45, 1.0, D, x0 + 0.225, 0.5, 0, std({ map: TX.leafTexture('#5fb35a', 4, 1), roughness: 0.95 }), { round: 0.08, place: true, surf: SURFACES.soft });

  // ---- tree with a swing (back right); Teddy sits on the swing
  const bark = std({ map: TX.woodTexture('#9c6b43'), roughness: 0.9 });
  const trx = 1.65, trz = -1.38;
  cyl(0.15, 1.8, trx, 0, trz, bark, { rTop: 0.11, surf: SURFACES.wood });
  cyl(0.22, 0.14, trx, 0, trz, bark, { rTop: 0.15, surf: SURFACES.wood });
  mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.85, 10), bark, trx - 0.42, 1.62, trz, { rz: Math.PI / 2 });
  {
    const leaf = std({ map: TX.leafTexture('#66c46a', 3, 2), roughness: 0.9 });
    for (const [dx, y, dz, r] of [[0, 2.15, 0.03, 0.62], [-0.52, 1.98, 0.15, 0.42], [0.38, 1.95, 0.36, 0.4], [0.1, 2.5, -0.2, 0.42]]) ball(r, trx + dx, y, trz + dz, leaf, { surf: SURFACES.soft });
  }
  const swx = 1.05, swTop = 0.4475;
  for (const s of [-1, 1]) cyl(0.008, 1.15, swx + s * 0.17, 0.45, trz, std({ color: '#e8d5b0', roughness: 1 }), { solid: false, cast: false });
  box(0.46, 0.035, 0.2, swx, swTop - 0.0175, trz, M.pink, { round: 0.01, place: true, surf: SURFACES.wood });
  const teddy = K.teddyBear(swx, swTop, trz - 0.02, 0);

  // ---- picnic table and benches (back left), lemonade, lanterns strung to the tree
  const ptx = -1.15, ptz = -1.15, ptTop = 0.76, clothTop = ptTop + 0.008;
  box(1.3, 0.04, 0.72, ptx, ptTop - 0.02, ptz, M.wood, { round: 0.01, surf: SURFACES.wood });
  box(1.36, 0.008, 0.78, ptx, ptTop + 0.004, ptz, std({ map: TX.ginghamTexture('#ff6b6b', 8, 4, 2.4), roughness: 0.95 }), { place: true, surf: SURFACES.wood, cast: false });
  for (const side of [-1, 1]) box(1.3, 0.035, 0.26, ptx, 0.43, ptz + side * 0.6, M.wood, { round: 0.008, place: true, surf: SURFACES.wood });
  for (const e of [-1, 1]) {
    // A-frame legs and the bar that carries the benches; one box collider for the frame
    for (const side of [-1, 1]) box(0.06, 0.81, 0.08, ptx + e * 0.55, 0.36, ptz + side * 0.235, M.darkwood, { rx: -side * 0.47 });
    box(0.06, 0.05, 1.48, ptx + e * 0.55, 0.385, ptz, M.darkwood, { surf: SURFACES.wood });
    K.colliders.push(new BoxCollider(ptx + e * 0.55, 0.36, ptz, 0.03, 0.36, 0.42, 0, SURFACES.wood));
  }
  {
    const jx = ptx - 0.45, jz = ptz - 0.12;
    cyl(0.06, 0.17, jx, clothTop, jz, std({ color: '#fff3a8', roughness: 0.2, envMapIntensity: 0.8 }), { surf: SURFACES.plastic });
    mesh(new THREE.TorusGeometry(0.045, 0.01, 6, 14, Math.PI), std({ color: '#fff3a8', roughness: 0.2 }), jx + 0.06, clothTop + 0.09, jz, { rz: -Math.PI / 2, solid: false, cast: false });
    cyl(0.03, 0.07, jx + 0.18, clothTop, jz + 0.05, M.pink, { rTop: 0.035, surf: SURFACES.plastic });
    cyl(0.03, 0.07, jx + 0.12, clothTop, jz + 0.22, M.blue, { rTop: 0.035, surf: SURFACES.plastic });
  }
  cyl(0.035, 1.75, -1.88, 0, -1.92, M.darkwood, { surf: SURFACES.wood });
  K.stringLights(new THREE.Vector3(-1.88, 1.72, -1.92), new THREE.Vector3(1.5, 1.72, -1.3), 0.22, 16, ['#ffd166', '#ff9f6b', '#fff1b0', '#ff8fa3']);

  // ---- potting bench against the back fence: flower pots and a watering can
  const pbx = 0.3, pbz = -1.78, pbTop = 0.85;
  box(1.0, 0.04, 0.4, pbx, pbTop - 0.02, pbz, M.wood, { round: 0.008, place: true, surf: SURFACES.wood });
  box(0.94, 0.03, 0.34, pbx, 0.25, pbz, M.wood, { place: true, surf: SURFACES.wood });
  for (const [lx, lz] of [[-0.46, -0.16], [0.46, -0.16], [-0.46, 0.16], [0.46, 0.16]]) box(0.05, pbTop - 0.04, 0.05, pbx + lx, (pbTop - 0.04) / 2, pbz + lz, M.darkwood, { surf: SURFACES.wood });
  // flowers share their geometry
  const stemGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 5), petalGeo = new THREE.CircleGeometry(0.045, 8), dotGeo = new THREE.SphereGeometry(0.016, 8, 6);
  const stemMat = std({ color: '#5fae52' }), dotMat = std({ color: '#ffd23f' }), petalMats = new Map();
  const flower = (x, y, z, col, fh, ry = 0) => {
    const st = mesh(stemGeo, stemMat, x, y + fh / 2, z, { solid: false, cast: false });
    st.scale.y = fh;
    if (!petalMats.has(col)) petalMats.set(col, std({ color: col, roughness: 0.6, side: THREE.DoubleSide }));
    mesh(petalGeo, petalMats.get(col), x, y + fh, z, { rx: -Math.PI / 2 + 0.5, ry, solid: false, cast: false });
    mesh(dotGeo, dotMat, x, y + fh + 0.006, z, { solid: false, cast: false });
  };
  const terracotta = std({ color: '#e98b5f', roughness: 0.8 }), soil = std({ color: '#7a5233', roughness: 1 });
  [['#ff8fa3', -0.3], ['#c9b6ff', -0.08]].forEach(([col, dx]) => {
    cyl(0.07, 0.13, pbx + dx, pbTop, pbz, terracotta, { rTop: 0.09, surf: SURFACES.plastic });
    mesh(new THREE.CircleGeometry(0.085, 18), soil, pbx + dx, pbTop + 0.12, pbz, { rx: -Math.PI / 2, solid: false, cast: false });
    for (let i = 0; i < 3; i++) flower(pbx + dx + (i - 1) * 0.035, pbTop + 0.12, pbz + (i % 2) * 0.03, i === 1 ? '#ffffff' : col, 0.12 + i * 0.03);
  });
  {
    const can = std({ color: '#7fdc9b', roughness: 0.4, envMapIntensity: 0.6 }), cx = pbx + 0.36;
    cyl(0.07, 0.14, cx, pbTop, pbz, can, { surf: SURFACES.metal });
    mesh(new THREE.CylinderGeometry(0.01, 0.016, 0.2, 8), can, cx + 0.13, pbTop + 0.14, pbz, { rz: -0.9, solid: false, cast: false });
    mesh(new THREE.TorusGeometry(0.06, 0.01, 6, 16, Math.PI), can, cx, pbTop + 0.14, pbz, { solid: false, cast: false });
  }
  // a flower bed along the front fence and sunflowers by the gate
  box(0.7, 0.06, 0.2, 0.25, 0.03, z1 - 0.12, soil, { solid: false, cast: false });
  ['#ff8fa3', '#ffd45e', '#ffffff', '#c9b6ff', '#ff6b6b', '#8bd3ff', '#ffd45e'].forEach((col, i) => flower(-0.04 + i * 0.1, 0.06, z1 - 0.12 + (i % 2) * 0.05, col, 0.16 + (i * 7 % 5) * 0.03, Math.PI));
  {
    const petals = std({ color: '#ffd23f', roughness: 0.6, side: THREE.DoubleSide }), seeds = std({ color: '#8a5a2b', roughness: 0.9, side: THREE.DoubleSide });
    for (const [z, fh] of [[-0.58, 1.0], [-0.8, 1.15]]) {
      cyl(0.014, fh, x1 - 0.15, 0, z, stemMat, { solid: false });
      for (const s of [-1, 1]) {
        const lf = mesh(new THREE.SphereGeometry(0.06, 10, 6), stemMat, x1 - 0.15, fh * (0.45 + s * 0.08), z + s * 0.07, { solid: false, cast: false });
        lf.scale.set(0.3, 0.5, 1.2);
      }
      mesh(new THREE.CircleGeometry(0.13, 14), petals, x1 - 0.17, fh, z, { ry: -Math.PI / 2, rx: -0.2, solid: false });
      mesh(new THREE.CircleGeometry(0.065, 16), seeds, x1 - 0.175, fh, z, { ry: -Math.PI / 2, rx: -0.2, solid: false, cast: false });
    }
  }

  // ---- sandbox (front left): sand to build on, a castle, a bucket and spade
  const sbx = -1.3, sbz = 1.25, sbs = 1.1, rim = 0.2;
  const frameMat = std({ color: '#8bd3ff', roughness: 0.5 }), sand = std({ color: '#f3dca6', roughness: 1 });
  for (const s of [-1, 1]) {
    box(sbs, rim, 0.08, sbx, rim / 2, sbz + s * (sbs / 2 - 0.04), frameMat, { round: 0.01, place: true, surf: SURFACES.wood });
    box(0.08, rim, sbs - 0.16, sbx + s * (sbs / 2 - 0.04), rim / 2, sbz, frameMat, { round: 0.01, place: true, surf: SURFACES.wood });
  }
  box(sbs - 0.16, 0.14, sbs - 0.16, sbx, 0.07, sbz, sand, { place: true, surf: SURFACES.soft, cast: false });
  const cornerSeat = [sbx - sbs / 2 + 0.11, rim + 0.03, sbz + sbs / 2 - 0.11];
  box(0.22, 0.03, 0.22, cornerSeat[0], rim + 0.015, cornerSeat[2], frameMat, { round: 0.008, place: true, surf: SURFACES.wood });
  {
    const cs = std({ color: '#ecd29a', roughness: 1 }), cx = sbx - 0.12, cz = sbz - 0.12;
    cyl(0.13, 0.12, cx, 0.14, cz, cs, { rTop: 0.11, surf: SURFACES.soft });
    cyl(0.06, 0.12, cx, 0.26, cz, cs, { rTop: 0.05, surf: SURFACES.soft });
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.4, px = cx + Math.cos(a) * 0.12, pz = cz + Math.sin(a) * 0.12;
      cyl(0.045, 0.16, px, 0.14, pz, cs, { rTop: 0.038, surf: SURFACES.soft });
      mesh(new THREE.ConeGeometry(0.045, 0.06, 12), cs, px, 0.33, pz, { solid: false, cast: false });
    }
    cyl(0.004, 0.14, cx, 0.38, cz, M.darkwood, { solid: false, cast: false });
    mesh(new THREE.CircleGeometry(0.04, 3), M.pink, cx + 0.03, 0.49, cz, { solid: false, cast: false });
    cyl(0.06, 0.11, sbx + 0.25, 0.14, sbz + 0.2, M.red, { rTop: 0.075, surf: SURFACES.plastic });
    mesh(new THREE.TorusGeometry(0.07, 0.006, 6, 18, Math.PI), M.yellow, sbx + 0.25, 0.25, sbz + 0.2, { solid: false, cast: false });
    box(0.02, 0.02, 0.22, sbx + 0.12, 0.152, sbz + 0.32, M.yellow, { ry: 0.6, solid: false, cast: false });
    box(0.08, 0.012, 0.09, sbx + 0.2, 0.147, sbz + 0.43, M.yellow, { ry: 0.6, solid: false, cast: false });
  }
  // a tree stump to sit on
  cyl(0.17, 0.3, -0.35, 0, 1.65, bark, { surf: SURFACES.wood });
  cyl(0.165, 0.012, -0.35, 0.3, 1.65, std({ color: '#f0cf9a', roughness: 0.8 }), { place: true, surf: SURFACES.wood, cast: false });
  mesh(new THREE.RingGeometry(0.07, 0.08, 24), std({ color: '#c99a62', roughness: 0.9 }), -0.35, 0.3125, 1.65, { rx: -Math.PI / 2, solid: false, cast: false });

  // ---- paddling pool (front right): two inflated rings round a blue floor, full of water
  const plx = 1.35, plz = 1.25, ringR = 0.56, tube = 0.085, ys = [tube, tube * 3], surf = 0.22, inner = ringR - tube;
  [std({ color: '#7fc8ff', roughness: 0.3, envMapIntensity: 0.6 }), std({ color: '#ff9fc0', roughness: 0.3, envMapIntensity: 0.6 })].forEach((mat, i) => {
    mesh(new THREE.TorusGeometry(ringR, tube, 14, 56), mat, plx, ys[i], plz, { rx: Math.PI / 2 });
  });
  mesh(new THREE.CircleGeometry(inner + 0.01, 40), std({ color: '#cdeeff', roughness: 0.4 }), plx, 0.004, plz, { rx: -Math.PI / 2, cast: false, solid: false });
  K.colliders.push(new CylinderCollider(plx, plz, 0, 0.008, inner, SURFACES.plastic));
  K.waterSurface(new THREE.CircleGeometry(inner + 0.005, 40), plx, surf, plz);
  // the round pool as five strips of water inside the circle
  const cuts = [-0.9, -0.55, -0.2, 0.2, 0.55, 0.9];
  for (let i = 0; i < 5; i++) {
    const a = cuts[i], b = cuts[i + 1], hw = inner * Math.sqrt(1 - Math.max(a * a, b * b));
    K.waterBox(plx - hw, 0, plz + a * inner, plx + hw, surf, plz + b * inner);
  }
  K.duck(plx - 0.18, surf, plz - 0.12, 0.8, 0.75);
  ball(0.09, plx + 0.2, surf + 0.04, plz + 0.15, std({ map: TX.stripesTexture(['#ff6b6b', '#ffffff', '#4c8dff', '#ffffff', '#ffd23f', '#ffffff']), roughness: 0.35 }), { solid: false });
  const rings = new RingsCollider(plx * S, plz * S, ringR * S, ys.map(y => y * S), tube * S, SURFACES.plastic);

  // ---- fireflies, only out at night
  const flies = new THREE.Group();
  flies.visible = false; group.add(flies);
  {
    const mat = new THREE.MeshStandardMaterial({ color: '#f6ffb0', emissive: '#e8ff7a', emissiveIntensity: 3 });
    const geo = new THREE.SphereGeometry(0.014, 8, 6);
    for (let i = 0; i < 18; i++) {
      const f = new THREE.Mesh(geo, mat);
      if (i % 2) f.position.set(-1.85 + TX.rnd() * 0.5, 0.4 + TX.rnd() * 1.1, -1.6 + TX.rnd() * 3.2);
      else f.position.set(0.9 + TX.rnd() * 1.4, 0.5 + TX.rnd() * 1.2, -1.8 + TX.rnd() * 1.4);
      flies.add(f);
    }
  }

  // ---- lights
  const hemi = K.light(new THREE.HemisphereLight('#d6ecff', '#9ed38a', 0.9), [0, 2, 0]);
  const sun = K.sunLight('#fff3d6', 2.8, [-3.2, 5.2, 2.4], [0.4, 0, -0.3]);
  const fill = K.light(new THREE.DirectionalLight('#e6f0ff', 0.45), [3, 2.5, 3]);
  const lantern = K.light(new THREE.PointLight('#ffcf8a', 0, 5, 1.4), [-0.6, 1.45, -1.55]);
  const setNight = (on) => {
    sun.intensity = on ? 0.5 : 2.8; sun.color.set(on ? '#9fb4ff' : '#fff3d6');
    hemi.intensity = on ? 0.2 : 0.9; hemi.color.set(on ? '#6f7fd8' : '#d6ecff'); hemi.groundColor.set(on ? '#1d2b24' : '#9ed38a');
    fill.intensity = on ? 0.06 : 0.45;
    lantern.intensity = on ? 1.8 : 0;
    skyMat.map = TX.skyDomeTexture(on); skyMat.needsUpdate = true;
    flies.visible = on;
    K.glowAll(on); K.background(on ? '#0d1433' : '#bfe6ff');
  };

  return K.finish({
    sun, setNight, teddy, world: [rings],
    door: { p: V(x1 - 0.3, 0, gateZ), out: V(x1 + 0.6, 0, gateZ) },
    // hedge top, picnic table, potting bench, the pool's rim, sandbox corner, stump (the first four get toys)
    seats: [V(x0 + 0.225, 1.0, 0.4), V(-0.68, clothTop, -1.4), V(pbx + 0.14, pbTop, pbz + 0.03), V(plx + ringR * Math.cos(0.4), ys[1] + tube, plz - ringR * Math.sin(0.4)), V(cornerSeat[0], cornerSeat[1], cornerSeat[2]), V(-0.35, 0.312, 1.65)],
  });
}

// ---------------------------------------------------------------- attic
function buildAttic(scene) {
  const K = kit(scene, 'attic');
  const { group, M, std, mesh, box, cyl, ball, panel, glow, V, x0, x1, z0, z1, D, roomH: H } = K;
  // the roof slopes down from the ridge (along z, over the middle) to low knee walls left and right
  const KNEE = 0.9, k = (H - KNEE) / x1, a = Math.atan(k), ca = Math.cos(a), sa = Math.sin(a);
  const slope = Math.hypot(x1, H - KNEE);

  // ---- floor, knee walls, gable walls, roof
  K.floor(std({ map: TX.floorTexture(), color: '#f1e2cf', roughness: 0.6 }), SURFACES.floor);
  const knee = std({ map: TX.planksTexture('#ead6b8', D, KNEE), roughness: 0.85 });
  panel(D, KNEE, knee, x0, KNEE / 2, 0, Math.PI / 2);
  panel(D, KNEE, knee, x1, KNEE / 2, 0, -Math.PI / 2);
  // the gables: five-sided walls, with a round window in the back one (shape UVs are in metres)
  const gableMat = std({ map: TX.planksTexture('#ead6b8', 1, 1), roughness: 0.85 });
  const win = { y: 1.6, r: 0.34 };
  const gable = (hole) => {
    const s = new THREE.Shape([new THREE.Vector2(x0, 0), new THREE.Vector2(x1, 0), new THREE.Vector2(x1, KNEE), new THREE.Vector2(0, H), new THREE.Vector2(x0, KNEE)]);
    if (hole) { const p = new THREE.Path(); p.absarc(0, win.y, win.r, 0, TAU, true); s.holes.push(p); }
    return new THREE.ShapeGeometry(s, 24);
  };
  for (const [z, ry, hole] of [[z0, 0, true], [z1, Math.PI, false]]) {
    const m = new THREE.Mesh(gable(hole), gableMat);
    m.position.z = z; m.rotation.y = ry; m.receiveShadow = true; group.add(m);
  }
  const roofMat = std({ map: TX.planksTexture('#d9b48a', slope, D), roughness: 0.8 });
  for (const side of [-1, 1]) {
    // s runs up the slope from the eave, n points down into the room
    const s = new THREE.Vector3(-side * ca, sa, 0), n = new THREE.Vector3(-side * sa, -ca, 0);
    const cx = side * x1 / 2, cy = (KNEE + H) / 2;
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(slope, D), roofMat);
    roof.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(s, new THREE.Vector3(0, 0, -side), n));
    roof.position.set(cx, cy, 0); roof.receiveShadow = true; group.add(roof);
    for (const z of [-1.6, -0.8, 0, 0.8, 1.6]) mesh(new THREE.BoxGeometry(slope, 0.07, 0.07), M.darkwood, cx + n.x * 0.035, cy + n.y * 0.035, z, { rz: -side * a, solid: false, cast: false });
    box(0.1, 0.1, D, side * (x1 - 0.05), KNEE, 0, M.darkwood, { solid: false, cast: false });
    // the slope's physics plane sits on the rafters' faces
    K.colliders.push(new PlaneCollider(n.x, n.y, 0, n.x * side * x1 + n.y * KNEE + 0.04, SURFACES.wood));
  }
  box(0.14, 0.14, D, 0, H - 0.07, 0, M.darkwood, { surf: SURFACES.wood, cast: false });
  // the round window: sky behind the hole, a frame and cross bars
  mesh(new THREE.CircleGeometry(win.r + 0.01, 32), K.sky(), 0, win.y, z0 - 0.01, { solid: false, cast: false });
  mesh(new THREE.TorusGeometry(win.r, 0.04, 8, 36), M.white, 0, win.y, z0 + 0.012, { solid: false, cast: false });
  box(win.r * 2, 0.03, 0.03, 0, win.y, z0 + 0.012, M.white, { solid: false, cast: false });
  box(0.03, win.r * 2, 0.03, 0, win.y, z0 + 0.012, M.white, { solid: false, cast: false });
  // the little door in the front gable
  const door = K.frontDoor(-0.9, 0.72, 1.55, '#e9d3b5');

  // ---- old trunk against the back wall; Teddy keeps watch on it
  const trx = -1.0, trz = -1.68, trTop = 0.57;
  box(0.95, 0.45, 0.5, trx, 0.225, trz, M.darkwood, { round: 0.02, surf: SURFACES.wood });
  box(0.97, 0.12, 0.52, trx, 0.51, trz, M.darkwood, { round: 0.04, place: true, surf: SURFACES.wood });
  for (const dx of [-0.38, 0.38]) box(0.05, 0.585, 0.53, trx + dx, 0.29, trz, M.gold, { solid: false, cast: false });
  box(0.08, 0.1, 0.02, trx, 0.42, trz + 0.26, M.gold, { solid: false, cast: false });
  box(0.012, 0.03, 0.005, trx, 0.41, trz + 0.272, M.black, { solid: false, cast: false });
  const teddy = K.teddyBear(trx - 0.18, trTop, trz + 0.02, 0);

  // ---- rocking horse, built in its own group so it can be turned
  const hx = 1.15, hz = -0.45, hry = -0.5;
  const horse = new THREE.Group();
  horse.position.set(hx, 0, hz); horse.rotation.y = hry; group.add(horse);
  {
    const o = (x = {}) => Object.assign({ parent: horse }, x);
    const coat = std({ color: '#fff4e0', roughness: 0.6 });
    const R = 0.9, bend = 0.8;
    for (const s of [-1, 1]) mesh(new THREE.TorusGeometry(R, 0.022, 6, 28, bend), M.darkwood, s * 0.15, R + 0.022, 0, o({ ry: -Math.PI / 2, rz: -Math.PI / 2 - bend / 2 }));
    for (const z of [-0.24, 0.24]) mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 8), M.darkwood, 0, 0.06, z, o({ rz: Math.PI / 2, cast: false }));
    for (const [lx, lz] of [[-0.1, -0.22], [0.1, -0.22], [-0.1, 0.22], [0.1, 0.22]]) mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.32, 8), M.darkwood, lx, 0.22, lz, o());
    mesh(new THREE.CapsuleGeometry(0.13, 0.32, 6, 14), coat, 0, 0.47, 0, o({ rx: Math.PI / 2 }));
    box(0.24, 0.035, 0.2, 0, 0.605, -0.02, M.red, o({ round: 0.012 }));
    box(0.1, 0.3, 0.14, 0, 0.66, 0.26, coat, o({ rx: 0.5, round: 0.04 }));
    box(0.11, 0.12, 0.26, 0, 0.8, 0.4, coat, o({ rx: 0.35, round: 0.05 }));
    for (const s of [-1, 1]) {
      mesh(new THREE.ConeGeometry(0.022, 0.06, 8), coat, s * 0.035, 0.89, 0.31, o({ cast: false }));
      ball(0.012, s * 0.057, 0.82, 0.43, M.black, o({ solid: false, cast: false }));
    }
    for (let i = 0; i < 5; i++) ball(0.035, 0, 0.559 + 0.264 * i / 4, 0.131 + 0.144 * i / 4, M.pink, o({ cast: false }));
    ball(0.035, 0, 0.88, 0.34, M.pink, o({ cast: false }));
    mesh(new THREE.ConeGeometry(0.05, 0.22, 10), M.pink, 0, 0.47, -0.36, o({ rx: -2.3 }));
  }
  const at = turn(hx, hz, hry);
  const horseBox = (dx, y, dz, ex, ey, ez) => { const [px, pz] = at(dx, dz); K.colliders.push(new BoxCollider(px, y, pz, ex, ey, ez, hry, SURFACES.wood)); };
  horseBox(0, 0.47, 0, 0.13, 0.155, 0.29);
  horseBox(0, 0.66, 0.24, 0.05, 0.14, 0.08);
  horseBox(0, 0.8, 0.39, 0.06, 0.09, 0.15);
  for (const s of [-1, 1]) horseBox(s * 0.15, 0.06, 0, 0.025, 0.06, 0.36);
  const saddle = at(0, -0.02);

  // ---- stacked moving boxes: platforms at different heights
  const card = (label) => std({ map: TX.cardboardTexture(label), roughness: 0.9 });
  box(0.65, 0.5, 0.55, 1.6, 0.25, -1.5, card('TOYS'), { round: 0.01, place: true, surf: SURFACES.wall });
  box(0.5, 0.4, 0.45, 1.58, 0.7, -1.52, card('BOOKS'), { round: 0.01, ry: 0.18, place: true, surf: SURFACES.wall });
  box(0.6, 0.45, 0.55, -1.7, 0.225, 0.6, card('XMAS'), { round: 0.01, place: true, surf: SURFACES.wall });
  box(0.42, 0.32, 0.38, -1.75, 0.61, 0.6, card(''), { round: 0.01, ry: -0.25, place: true, surf: SURFACES.wall });
  box(0.55, 0.4, 0.5, 1.75, 0.2, 1.15, card('TOYS'), { round: 0.01, ry: -0.12, place: true, surf: SURFACES.wall });

  // ---- a faded striped rug
  box(2.0, 0.012, 1.4, 0, 0.006, 0.35, std({ map: TX.stripesTexture(['#e9b8a7', '#f3dcc0', '#a9c7c4', '#f3dcc0', '#e9d39a', '#f3dcc0']), roughness: 1 }), { round: 0.005, place: true, surf: SURFACES.carpet, cast: false });

  // ---- shelf with old books on the front gable
  const shX = 1.15, shY = 1.2, shZ = z1 - 0.12;
  box(0.7, 0.03, 0.24, shX, shY, shZ, M.darkwood, { place: true, surf: SURFACES.wood });
  for (const bx of [shX - 0.28, shX + 0.28]) box(0.03, 0.12, 0.2, bx, shY - 0.075, z1 - 0.1, M.darkwood, { solid: false, cast: false });
  ['#c97b6b', '#7b9ec9', '#d8b45a'].forEach((col, i) => box(0.05, 0.22 - i * 0.02, 0.17, shX - 0.25 + i * 0.055, shY + 0.125 - i * 0.01, shZ, std({ color: col, roughness: 0.8 }), { rz: i === 2 ? 0.25 : 0, solid: false }));
  K.colliders.push(new BoxCollider(shX - 0.2, shY + 0.125, shZ, 0.1, 0.11, 0.09, 0, SURFACES.wood));

  // ---- light: string lights under the ridge, a bare bulb on a cord
  for (const sx of [-0.6, 0.6]) {
    const y = KNEE + (x1 - 0.6) * k - 0.16;
    K.stringLights(new THREE.Vector3(sx, y, z0 + 0.15), new THREE.Vector3(sx, y, z1 - 0.15), 0.2, 18);
  }
  const bz = 0.35, bulbY = 2.0;
  cyl(0.006, H - 0.14 - bulbY - 0.06, 0, bulbY + 0.06, bz, M.black, { solid: false, cast: false });
  cyl(0.02, 0.05, 0, bulbY + 0.03, bz, M.gold, { solid: false, cast: false });
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffe2a8', emissiveIntensity: 1.5 });
  glow.push([bulbMat, 1.5, 4]);
  ball(0.045, 0, bulbY, bz, bulbMat, { surf: SURFACES.glass, cast: false });

  // ---- lights
  const hemi = K.light(new THREE.HemisphereLight('#ffeedd', '#d9b38c', 0.62), [0, 2, 0]);
  const sun = K.sunLight('#ffe6c4', 2.0, [0.4, 3.4, -4.2], [0, 0, 0.6]);
  const lamp = K.light(new THREE.PointLight('#ffd9a8', 1.8, 6, 1.2), [0, bulbY - 0.1, bz]);
  const fill = K.light(new THREE.DirectionalLight('#e8dcff', 0.4), [2, 2, 3]);
  const setNight = (on) => {
    sun.intensity = on ? 0.3 : 2.0; sun.color.set(on ? '#8fa8ff' : '#ffe6c4');
    hemi.intensity = on ? 0.12 : 0.62; hemi.color.set(on ? '#7d8cff' : '#ffeedd'); hemi.groundColor.set(on ? '#2b1f3a' : '#d9b38c');
    lamp.intensity = on ? 1.6 : 1.8; lamp.color.set(on ? '#ffb86b' : '#ffd9a8');
    fill.intensity = on ? 0.04 : 0.4;
    K.setSky(on); K.glowAll(on); K.background(on ? NIGHT_BG : DAY_BG);
  };

  return K.finish({
    sun, setNight, teddy, door,
    // trunk, box stacks, the rocking horse's saddle, a box, the shelf (the first four get toys)
    seats: [V(trx + 0.18, trTop, trz), V(1.58, 0.9, -1.52), V(-1.75, 0.77, 0.6), V(saddle[0], 0.6225, saddle[1]), V(1.75, 0.4, 1.15), V(shX + 0.15, shY + 0.015, shZ)],
  });
}

const BUILDERS = { kitchen: buildKitchen, bath: buildBath, garden: buildGarden, attic: buildAttic };
