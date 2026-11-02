// Animated characters for the room: a visiting kid who walks over to inspect the coaster, and
// little toy spectators that sit on the furniture and react to it.
// Everything is driven from update(dt) — no timers, no requestAnimationFrame. Sizes are world
// metres, so add the groups to the scene itself (not to the 0.7-scaled room group). Forward is +Z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';

const TAU = Math.PI * 2;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// 0 → 1 between a and a+fin, back to 0 between b-fout and b
const bell = (t, a, b, fin, fout) => sstep(a, a + fin, t) * (1 - sstep(b - fout, b, t));
const backOut = (t) => { const c = 1.9, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const rand = (a, b) => a + Math.random() * (b - a);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q1 = new THREE.Quaternion();

// ---------------------------------------------------------------- geometry / material kit
// One kit per character: geometries and materials are shared inside it and freed by dispose().
function makeKit() {
  const geos = new Map(), mats = new Map();
  const geo = (key, make) => { let g = geos.get(key); if (!g) { g = make(); geos.set(key, g); } return g; };
  const kit = {
    geo,
    std(color, roughness = 0.75, o = {}) {
      const key = 's|' + color + '|' + roughness + '|' + JSON.stringify(o);
      let m = mats.get(key);
      if (!m) { m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness, metalness: 0, envMapIntensity: 0.3 }, o)); mats.set(key, m); }
      return m;
    },
    basic(color) {
      let m = mats.get('b|' + color);
      if (!m) { m = new THREE.MeshBasicMaterial({ color }); mats.set('b|' + color, m); }
      return m;
    },
    node(parent, x = 0, y = 0, z = 0, order) {
      const n = new THREE.Group();
      n.position.set(x, y, z);
      if (order) n.rotation.order = order;
      parent.add(n);
      return n;
    },
    add(parent, g, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, shadow = true) {
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y, z); m.scale.set(sx, sy, sz);
      m.castShadow = shadow; m.receiveShadow = shadow;
      parent.add(m);
      return m;
    },
    // unit sphere scaled into place (ellipsoids are just scales)
    sphere(parent, r, mat, x, y, z, sx = 1, sy = 1, sz = 1, shadow) {
      return kit.add(parent, geo('sphere', () => new THREE.SphereGeometry(1, 18, 14)), mat, x, y, z, r * sx, r * sy, r * sz, shadow);
    },
    cyl(parent, rTop, rBot, h, mat, x, y, z, shadow) {
      const k = (rTop / rBot).toFixed(2);
      return kit.add(parent, geo('cyl' + k, () => new THREE.CylinderGeometry(rTop / rBot, 1, 1, 16)), mat, x, y, z, rBot, h, rBot, shadow);
    },
    capsule(parent, r, len, mat, x, y, z, shadow) {
      return kit.add(parent, geo(`cap${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10)), mat, x, y, z, 1, 1, 1, shadow);
    },
    rbox(parent, w, h, d, rad, mat, x, y, z, shadow) {
      return kit.add(parent, geo(`rb${w}|${h}|${d}|${rad}`, () => new RoundedBoxGeometry(w, h, d, 3, rad)), mat, x, y, z, 1, 1, 1, shadow);
    },
    dispose() {
      for (const g of geos.values()) g.dispose();
      for (const m of mats.values()) m.dispose();
      geos.clear(); mats.clear();
    },
  };
  return kit;
}

// place obj on a sphere of radius r (centre = parent origin), its +Z along the surface normal
function onSphere(obj, r, yaw, pitch, out = 0) {
  const n = _v1.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  obj.position.copy(n).multiplyScalar(r + out);
  obj.quaternion.setFromUnitVectors(Z_AXIS, n);
  return obj;
}

function starGeometry(r, ri) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? ri : r;
    if (i) s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return new THREE.ExtrudeGeometry(s, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1 });
}

// ---------------------------------------------------------------- pose layers
// A pose is a flat object of channel → number. Gestures blend in over the pose below them, play,
// then blend out; a new gesture cross-fades the old one away. Stances (crouch, sleep) hold until
// released and sit underneath the gestures.
function makeLayers(keys) {
  const stances = [], gestures = [], pool = [];
  let calls = [];
  const out = { mouth: null, look: null };
  const fadeOut = (L, d) => { L.fading = true; L.ft = 0; L.fdur = d; L.fw = L.w; };
  const step = (L, dt) => {
    const g = L.g;
    L.t += dt;
    if (g.stance) {
      L.w = sstep(0, g.fin, L.t);
      if (!L.arrived && L.t >= g.fin) { L.arrived = true; if (L.onDone) calls.push(L.onDone); }
    } else {
      L.w = sstep(0, g.fin, L.t) * (1 - sstep(g.dur - g.fout, g.dur, L.t));
      if (!L.fading && L.t >= g.dur) { L.dead = true; if (L.onDone) calls.push(L.onDone); }
    }
    if (L.fading) {
      L.ft += dt;
      L.w = L.fw * (1 - sstep(0, L.fdur, L.ft));
      if (L.ft >= L.fdur) { L.dead = true; if (L.onRelease) calls.push(L.onRelease); }
    }
  };
  return {
    play(g, onDone, data = {}) {
      if (!g.stance) for (const L of gestures) if (!L.fading) fadeOut(L, 0.3);
      const L = { g, t: 0, w: 0, fading: false, ft: 0, fdur: 0, fw: 0, onDone, data, arrived: false, dead: false };
      (g.stance ? stances : gestures).push(L);
      return L;
    },
    release(g, onDone) {
      let found = false;
      for (const L of stances) if (L.g === g && !L.fading) { fadeOut(L, g.fout); L.onRelease = onDone; found = true; }
      return found;
    },
    has(g) { return stances.some(L => L.g === g && !L.fading) || gestures.some(L => L.g === g && !L.fading); },
    busy() { return gestures.some(L => !L.fading); },
    clear() { for (const L of stances) if (!L.fading) fadeOut(L, 0.3); for (const L of gestures) if (!L.fading) fadeOut(L, 0.3); },
    evaluate(p, dt, ctx) {
      out.mouth = null; out.look = null;
      let depth = 0;
      for (const list of [stances, gestures]) {
        for (const L of list) {
          step(L, dt);
          if (L.w <= 0.0005) continue;
          const tmp = pool[depth] || (pool[depth] = {});
          depth++;
          for (const k of keys) tmp[k] = p[k];
          L.g.pose(tmp, L.g.stance ? L.t : Math.min(L.t, L.g.dur), L, ctx);
          for (const k of keys) p[k] += (tmp[k] - p[k]) * L.w;
          if (L.w > 0.4) { if (L.g.mouth) out.mouth = L.g.mouth; if (L.data.look) out.look = L.data.look; }
        }
        for (let i = list.length - 1; i >= 0; i--) if (list[i].dead) list.splice(i, 1);
      }
      if (calls.length) { const c = calls; calls = []; for (const f of c) f(); }
      return out;
    },
  };
}

// ================================================================ the visiting kid
export const KID_HEIGHT = 0.78;
export const KID_LOOKS = [
  { name: 'Noa', skin: '#f3c4a0', hair: '#d4733a', hairStyle: 'pigtails', shirt: '#ffd45e', pants: '#7fb8ff', shoes: '#ff6b6b', overalls: true },
  { name: 'Ari', skin: '#d99a6c', hair: '#3b2a21', hairStyle: 'tuft', shirt: '#7fdc9b', pants: '#6f8fe0', shoes: '#ff8a5c', overalls: false },
  { name: 'Zuri', skin: '#8a5537', hair: '#221812', hairStyle: 'curly', shirt: '#c7a6ff', pants: '#ffb27a', shoes: '#7fb8ff', overalls: true },
  { name: 'Sol', skin: '#f6d0b1', hair: '#efc25a', hairStyle: 'bob', shirt: '#ff9fc0', pants: '#7fd4c8', shoes: '#ffd45e', overalls: false },
];

// skeleton (metres). Hip joint → knee → ankle, ankle 5 cm above the sole.
const K = { hipY: 0.33, thigh: 0.135, shin: 0.133, upper: 0.095, fore: 0.085, shX: 0.088, shY: 0.178, neckY: 0.205, headR: 0.102, headC: 0.108, headS: 1.07, speed: 0.45, cycle: 0.36 };

const KID_KEYS = ['lift', 'bend', 'hipsOff', 'hipsRy', 'hipsRz', 'spineX', 'spineY', 'spineZ', 'neckX', 'neckY', 'headX', 'headY', 'headZ',
  'shLX', 'shLY', 'shLZ', 'shRX', 'shRY', 'shRZ', 'elLX', 'elLZ', 'elRX', 'elRZ', 'haLX', 'haLY', 'haLZ', 'haRX', 'haRY', 'haRZ',
  'thumbL', 'thumbR', 'fingerL', 'fingerR', 'hipLX', 'hipLZ', 'hipRX', 'hipRZ', 'kneeL', 'kneeR', 'ankL', 'ankR',
  'brow', 'browTilt', 'eyeOpen', 'eyeWide', 'wink'];
// arm channels are anatomical and mirrored: z > 0 lifts the arm out to its side, y > 0 twists it
// inward, x < 0 swings it forward; elbow x < 0 folds the forearm forward, elbow z > 0 folds it outward
const KID_REST = { shLX: 0.04, shRX: 0.04, shLZ: 0.1, shRZ: 0.1, elLX: -0.2, elRX: -0.2, hipLZ: 0.03, hipRZ: 0.03, eyeOpen: 1 };
const SIDE = {
  L: { x: 'shLX', y: 'shLY', z: 'shLZ', ex: 'elLX', ez: 'elLZ', hx: 'haLX', hy: 'haLY', hz: 'haLZ', th: 'thumbL', fi: 'fingerL' },
  R: { x: 'shRX', y: 'shRY', z: 'shRZ', ex: 'elRX', ez: 'elRZ', hx: 'haRX', hy: 'haRY', hz: 'haRZ', th: 'thumbR', fi: 'fingerR' },
};
function setArm(p, side, x, y, z, ex, ez = 0, w = 1) {
  const a = SIDE[side];
  p[a.x] = mix(p[a.x], x, w); p[a.y] = mix(p[a.y], y, w); p[a.z] = mix(p[a.z], z, w);
  p[a.ex] = mix(p[a.ex], ex, w); p[a.ez] = mix(p[a.ez], ez, w);
}

// Gestures. pose(p, t, layer, kid) edits the pose it is given; t runs 0 → dur.
const KG = {
  wave: { dur: 2.2, fin: 0.35, fout: 0.45, mouth: 'smile', pose(p, t) {
    const amp = sstep(0.2, 0.5, t), sw = Math.sin((t - 0.2) * 11) * amp;
    setArm(p, 'R', -0.25, 0.1, 2.05, -0.1, 0.6 + 0.42 * sw);
    p.haRZ = 0.3 * Math.sin((t - 0.2) * 11 - 0.8) * amp;
    p.headZ += 0.12; p.spineZ -= 0.05; p.brow = 0.5;
  } },
  point: { dur: 2.3, fin: 0.4, fout: 0.45, mouth: 'open', pose(p, t, L, kid) {
    const side = L.data.side, d = kid._armDir(side, L.data.target);
    const z = Math.asin(clamp(d.x, -1, 1));
    let x = Math.atan2(-d.z, -d.y);
    if (x > 1.0) x -= TAU;
    setArm(p, side, clamp(x, -3.3, 1.0), 0, clamp(side === 'L' ? z : -z, -0.35, 2.6), -0.06, 0);
    const a = SIDE[side];
    p[a.fi] = sstep(0.12, 0.4, t); p[a.hx] = 0; p[a.hz] = 0;
    p.brow = 0.6; p.eyeWide = 0.4;
    p.spineX += 0.04;
  } },
  crouch: { stance: true, fin: 0.6, fout: 0.55, pose(p) {
    p.bend = 1.05; p.spineX += 0.55; p.neckX -= 0.2;
    setArm(p, 'L', -0.85, 0.3, 0.22, -0.55); setArm(p, 'R', -0.85, 0.3, 0.22, -0.55);
    p.hipLZ += 0.16; p.hipRZ += 0.16;
  } },
  jump: { dur: 1.1, fin: 0.1, fout: 0.25, mouth: 'open', pose(p, t) {
    const sq = 0.6 * bell(t, 0.0, 0.33, 0.22, 0.08) + 0.5 * bell(t, 0.6, 1.05, 0.06, 0.4);
    const air = t > 0.32 && t < 0.64 ? Math.sin(Math.PI * (t - 0.32) / 0.32) : 0;
    const up = bell(t, 0.24, 0.85, 0.12, 0.3);
    p.bend += sq; p.lift += 0.085 * air;
    p.kneeL += 0.7 * air; p.kneeR += 0.7 * air; p.hipLX -= 0.35 * air; p.hipRX -= 0.35 * air;
    p.ankL += 0.3 * air; p.ankR += 0.3 * air;
    setArm(p, 'L', 0.55, 0, 0.25, -0.3, 0, sq); setArm(p, 'R', 0.55, 0, 0.25, -0.3, 0, sq);
    setArm(p, 'L', -0.4, 0, 2.5, -0.2, 0.2, up); setArm(p, 'R', -0.4, 0, 2.5, -0.2, 0.2, up);
    p.spineX += 0.25 * sq - 0.08 * air; p.headX -= 0.12 * up; p.brow = up; p.eyeWide = 0.6 * up;
  } },
  clap: { dur: 2.0, fin: 0.3, fout: 0.35, mouth: 'smile', pose(p, t) {
    const amp = sstep(0.2, 0.4, t) * (1 - sstep(1.6, 1.8, t));
    const c = 0.5 + 0.5 * Math.cos((t - 0.2) * TAU * 3.0); // 1 = hands apart, 0 = together
    const open = 1 - amp * (1 - Math.pow(c, 0.6));
    setArm(p, 'L', -1.0, 0.75 - 0.35 * open, -0.12 + 0.3 * open, -1.15, -0.1);
    setArm(p, 'R', -1.0, 0.75 - 0.35 * open, -0.12 + 0.3 * open, -1.15, -0.1);
    p.haLY = p.haRY = 0.4;
    p.bend += 0.05 * amp * (1 - c); p.headX += 0.04 * amp * Math.sin((t - 0.2) * TAU * 3.0);
    p.eyeOpen = 0.62; p.brow = 0.3;
  } },
  scratchHead: { dur: 2.3, fin: 0.4, fout: 0.45, mouth: 'flat', pose(p, t) {
    const sc = Math.sin(t * 17) * sstep(0.35, 0.55, t);
    setArm(p, 'R', -0.35, 0.3, 2.0, -0.15, 1.95 + 0.14 * sc);
    p.haRX = -0.3;
    p.headZ -= 0.16; p.headX -= 0.06; p.spineZ += 0.04;
    p.browTilt = 1; p.brow = -0.2;
  } },
  thumbsUp: { dur: 1.9, fin: 0.35, fout: 0.4, mouth: 'smile', pose(p, t) {
    setArm(p, 'R', -0.45, -0.1, 0.55, -1.55, 0);
    p.haRX = 0.15; p.haRY = 0.0; p.thumbR = sstep(0.15, 0.4, t);
    p.headX += 0.12 * Math.sin(Math.PI * clamp((t - 0.6) / 0.5, 0, 1));
    p.headZ += 0.1; p.wink = bell(t, 0.5, 1.3, 0.12, 0.15); p.brow = 0.4;
  } },
  wow: { dur: 2.1, fin: 0.3, fout: 0.45, mouth: 'open', pose(p, t) {
    setArm(p, 'L', -1.65, 0.25, 0.05, -1.95, 0); setArm(p, 'R', -1.65, 0.25, 0.05, -1.95, 0);
    p.haLX = p.haRX = -0.35;
    p.spineX -= 0.1; p.headX -= 0.08; p.lift += 0.008 * bell(t, 0.1, 1.9, 0.3, 0.4);
    p.brow = 1; p.eyeWide = 1;
    p.headZ += 0.08 * Math.sin(t * 3.2) * sstep(0.4, 0.8, t);
  } },
  nod: { dur: 1.1, fin: 0.12, fout: 0.2, mouth: 'smile', pose(p, t) {
    const n = Math.pow(Math.sin(Math.PI * clamp(t / 0.47, 0, 2)), 2);
    p.headX += 0.26 * n; p.neckX += 0.08 * n; p.brow = 0.3;
  } },
  shakeHead: { dur: 1.3, fin: 0.15, fout: 0.25, mouth: 'flat', pose(p, t) {
    const s = Math.sin(t * TAU * 2.3) * (1 - sstep(0.6, 1.25, t));
    p.headY += 0.42 * s; p.neckY += 0.12 * s; p.headX += 0.05;
    p.brow = -0.4; p.browTilt = 0.3;
  } },
  handsOnHips: { dur: 2.7, fin: 0.45, fout: 0.45, mouth: 'smile', pose(p, t) {
    setArm(p, 'L', 0.18, -0.25, 0.8, -0.35, -1.95); setArm(p, 'R', 0.18, -0.25, 0.8, -0.35, -1.95);
    p.haLZ = p.haRZ = -0.2;
    p.spineX -= 0.07; p.headX -= 0.05; p.headZ += 0.1 * sstep(0.4, 1.0, t);
    p.hipsRz += 0.03; p.brow = 0.25;
  } },
};

/**
 * createKid({ look?: index|name, palette?: { skin, hair, hairStyle: 'tuft'|'pigtails'|'curly'|'bob', shirt, pants, shoes, overalls } })
 * A child ~0.78 m tall, feet at y = 0, facing +Z. Drive it with update(dt).
 */
export function createKid(opts = {}) {
  const preset = typeof opts.look === 'number' ? KID_LOOKS[((opts.look % KID_LOOKS.length) + KID_LOOKS.length) % KID_LOOKS.length]
    : KID_LOOKS.find(l => l.name === opts.look) || KID_LOOKS[Math.floor(Math.random() * KID_LOOKS.length)];
  const look = Object.assign({}, preset, opts.palette || {});
  const kit = makeKit();
  const hex = (c, dl = 0, ds = 0) => '#' + new THREE.Color(c).offsetHSL(0, ds, dl).getHexString();
  const M = {
    skin: kit.std(look.skin, 0.6),
    nose: kit.std(hex(look.skin, -0.05, 0.04), 0.6),
    hair: kit.std(look.hair, 0.62),
    hairCap: kit.std(look.hair, 0.62, { side: THREE.DoubleSide }),
    brow: kit.std(hex(look.hair, -0.1), 0.7),
    shirt: kit.std(look.shirt, 0.85),
    trim: kit.std(hex(look.shirt, -0.1, 0.05), 0.85),
    pants: kit.std(look.pants, 0.85),
    shoes: kit.std(look.shoes, 0.5),
    white: kit.std('#fbf8f2', 0.6),
    eye: kit.std('#2b2233', 0.25, { envMapIntensity: 0.9 }),
    shine: kit.basic('#ffffff'),
    cheek: kit.std('#' + new THREE.Color(look.skin).lerp(new THREE.Color('#ff6f86'), 0.42).getHexString(), 0.9),
    mouth: kit.std('#6e2a35', 0.6),
    tongue: kit.std('#ff8b98', 0.7),
    button: kit.std('#ffe07a', 0.4),
    tie: kit.std(look.shoes, 0.5),
  };

  // ---- skeleton + meshes
  const group = new THREE.Group(); group.name = 'kid';
  const rig = kit.node(group);
  const hips = kit.node(rig, 0, K.hipY, 0);
  kit.rbox(hips, 0.158, 0.09, 0.114, 0.038, M.pants, 0, 0.004, 0);
  const spine = kit.node(hips, 0, 0.012, 0);
  kit.rbox(spine, 0.162, 0.2, 0.118, 0.04, M.shirt, 0, 0.098, 0);
  kit.add(spine, kit.geo('collar', () => new THREE.TorusGeometry(0.035, 0.009, 8, 20)), M.trim, 0, 0.196, 0).rotation.x = Math.PI / 2;
  if (look.overalls) {
    kit.rbox(spine, 0.104, 0.095, 0.014, 0.006, M.pants, 0, 0.058, 0.056);
    kit.rbox(spine, 0.04, 0.026, 0.004, 0.003, M.trim, 0, 0.07, 0.064);
    for (const s of [-1, 1]) {
      kit.rbox(spine, 0.02, 0.1, 0.012, 0.005, M.pants, s * 0.042, 0.148, 0.05).rotation.x = -0.12;
      kit.rbox(spine, 0.02, 0.17, 0.012, 0.005, M.pants, s * 0.042, 0.11, -0.056);
      kit.sphere(spine, 0.0085, M.button, s * 0.038, 0.1, 0.064, 1, 1, 0.5, false);
    }
  } else {
    const star = kit.add(spine, kit.geo('star', () => starGeometry(0.026, 0.012)), M.white, 0, 0.105, 0.0585, 1, 1, 1, false);
    star.rotation.z = 0.15;
    kit.rbox(spine, 0.166, 0.022, 0.122, 0.01, M.trim, 0, 0.006, 0);
  }
  const neck = kit.node(spine, 0, K.neckY, 0, 'YXZ');
  kit.cyl(neck, 0.028, 0.03, 0.05, M.skin, 0, 0.005, 0);
  const head = kit.node(neck, 0, 0, 0, 'YXZ');
  const hc = kit.node(head, 0, K.headC, 0); // head centre (the head is modelled at radius headR, then scaled)
  hc.scale.setScalar(K.headS);
  const R = K.headR;
  kit.sphere(hc, R, M.skin, 0, 0, 0);
  if (look.hairStyle !== 'bob') for (const s of [-1, 1]) kit.sphere(hc, 0.024, M.skin, s * 0.097, -0.01, -0.004, 0.55, 1, 0.8);
  const face = (parent, yaw, pitch, out = 0) => onSphere(kit.node(parent), R, yaw, pitch, out);

  // eyes slide over the face a little ahead of the head when looking around
  const eyesRig = kit.node(hc, 0, 0, 0, 'YXZ');
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = face(eyesRig, s * 0.36, -0.03, -0.004);
    kit.sphere(e, 0.0185, M.eye, 0, 0, 0, 0.86, 1.12, 0.5, false);
    kit.sphere(e, 0.0058, M.shine, -0.0052, 0.0075, 0.0085, 1, 1, 0.5, false);
    kit.sphere(e, 0.003, M.shine, 0.0058, -0.0072, 0.0085, 1, 1, 0.5, false);
    eyes.push(e); // [0] = right eye (-X), [1] = left eye (+X)
  }
  const brows = [];
  for (const s of [-1, 1]) {
    const piv = kit.node(hc);
    const holder = face(piv, s * 0.36, 0.24, -0.001);
    const b = kit.capsule(holder, 0.0042, 0.019, M.brow, 0, 0, 0, false);
    brows.push({ piv, b, s });
  }
  for (const s of [-1, 1]) kit.sphere(face(hc, s * 0.62, -0.2, -0.004), 0.019, M.cheek, 0, 0, 0, 1, 0.62, 0.3, false);
  kit.sphere(face(hc, 0, -0.13, -0.002), 0.011, M.nose, 0, 0, 0, 1.15, 0.85, 0.6, false);
  const mouthH = face(hc, 0, -0.37, -0.001);
  const arc = kit.geo('smile', () => new THREE.TorusGeometry(0.019, 0.0045, 6, 16, Math.PI));
  const mouths = {
    smile: kit.node(mouthH), sad: kit.node(mouthH), flat: kit.node(mouthH), open: kit.node(mouthH),
  };
  kit.add(mouths.smile, arc, M.mouth, 0, 0.008, 0, 1, 1, 1, false).rotation.z = Math.PI;
  kit.add(mouths.sad, arc, M.mouth, 0, -0.012, 0, 0.85, 0.7, 1, false);
  kit.capsule(mouths.flat, 0.0042, 0.016, M.mouth, 0, 0, 0, false).rotation.z = Math.PI / 2;
  kit.sphere(mouths.open, 0.016, M.mouth, 0, -0.002, 0, 0.85, 1, 0.35, false);
  kit.sphere(mouths.open, 0.009, M.tongue, 0, -0.01, 0.003, 1.15, 0.55, 0.3, false);
  const mouthAmt = { smile: 1, sad: 0, flat: 0, open: 0 };

  // hair
  const hairR = R * 1.06;
  const cap = (theta, tilt) => {
    const m = kit.add(hc, kit.geo('cap' + theta, () => new THREE.SphereGeometry(1, 20, 12, 0, TAU, 0, theta)), M.hairCap, 0, 0, 0, hairR, hairR, hairR);
    m.rotation.x = -tilt;
  };
  const fringe = (n = 2, spread = 0.27) => {
    for (let i = -n; i <= n; i++) kit.sphere(face(hc, i * spread, 0.6 - Math.abs(i) * 0.06, -0.008), 0.03, M.hair, 0, 0, 0, 1.15, 0.72, 0.45);
  };
  const style = look.hairStyle || 'tuft';
  if (style === 'curly') {
    cap(1.72, 0.45);
    const N = 56;
    for (let i = 0; i < N; i++) {
      const yv = 1 - (i + 0.5) / N * 1.55, rr = Math.sqrt(Math.max(0, 1 - yv * yv)), a = i * 2.39996;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const pitch = Math.asin(clamp(yv, -1, 1)), yaw = Math.atan2(x, z);
      if (pitch < -0.55 || (z > 0.25 && pitch < 0.62 - 0.4 * Math.abs(x))) continue;
      kit.sphere(onSphere(kit.node(hc), hairR, yaw, pitch, -0.006), 0.027, M.hair, 0, 0, 0, 1, 1, 0.75);
    }
  } else {
    cap(1.62, 0.5);
    fringe();
    if (style === 'tuft') {
      kit.sphere(face(hc, 0.05, 1.18, -0.004), 0.021, M.hair, 0, 0, 0, 0.55, 0.55, 1.5);
      kit.sphere(face(hc, 0.4, 1.08, -0.004), 0.016, M.hair, 0, 0, 0, 0.55, 0.55, 1.4);
    } else if (style === 'pigtails') {
      for (const s of [-1, 1]) {
        kit.sphere(hc, 0.041, M.hair, s * 0.112, 0.018, -0.03);
        const t = kit.add(hc, kit.geo('tie', () => new THREE.TorusGeometry(0.016, 0.0055, 6, 14)), M.tie, s * 0.093, 0.022, -0.026);
        t.rotation.y = Math.PI / 2; t.rotation.x = s * 0.3;
      }
    } else if (style === 'bob') {
      for (const s of [-1, 1]) kit.sphere(hc, 0.062, M.hair, s * 0.083, -0.03, -0.012, 0.45, 1, 0.92);
      kit.sphere(hc, 0.088, M.hair, 0, -0.02, -0.05, 1, 0.85, 0.62);
    }
  }

  // arms: shoulder (XZY) → elbow → wrist; mitten hands with a thumb and a pointing finger
  const arms = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const sh = kit.node(spine, s * K.shX, K.shY, 0, 'XZY');
    kit.sphere(sh, 0.034, M.shirt, 0, -0.004, 0);
    kit.cyl(sh, 0.032, 0.034, 0.056, M.shirt, 0, -0.03, 0);
    kit.cyl(sh, 0.023, 0.023, K.upper - 0.02, M.skin, 0, -K.upper / 2 - 0.01, 0);
    const el = kit.node(sh, 0, -K.upper, 0, 'XZY');
    kit.sphere(el, 0.0225, M.skin);
    kit.cyl(el, 0.022, 0.0205, K.fore, M.skin, 0, -K.fore / 2, 0);
    const ha = kit.node(el, 0, -K.fore, 0, 'XZY');
    kit.sphere(ha, 0.029, M.skin, 0, -0.018, 0.002, 0.8, 1, 0.92);
    const th = kit.node(ha, -s * 0.012, -0.008, 0.013);
    th.rotation.z = -s * 0.25;
    kit.capsule(th, 0.0085, 0.009, M.skin, 0, -0.008, 0);
    const fi = kit.node(ha, 0, -0.035, 0.006);
    kit.capsule(fi, 0.0075, 0.016, M.skin, 0, -0.009, 0);
    fi.visible = false;
    arms[side] = { sh, el, ha, th, fi };
  }
  // legs: hip (XZY) → knee → ankle; shorts, socks and sneakers
  const legs = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const hp = kit.node(hips, s * 0.043, -0.012, 0, 'XZY');
    kit.cyl(hp, 0.037, 0.035, look.overalls ? 0.085 : 0.072, M.pants, 0, look.overalls ? -0.035 : -0.028, 0);
    kit.cyl(hp, 0.0295, 0.028, K.thigh, M.skin, 0, -K.thigh / 2, 0);
    const kn = kit.node(hp, 0, -K.thigh, 0);
    kit.sphere(kn, 0.0282, M.skin);
    kit.cyl(kn, 0.0275, 0.023, K.shin, M.skin, 0, -K.shin / 2, 0);
    kit.cyl(kn, 0.0255, 0.0245, 0.032, M.white, 0, -K.shin + 0.016, 0);
    const an = kit.node(kn, 0, -K.shin, 0);
    kit.rbox(an, 0.058, 0.04, 0.094, 0.018, M.shoes, 0, -0.026, 0.016);
    kit.rbox(an, 0.062, 0.014, 0.1, 0.006, M.white, 0, -0.043, 0.016);
    kit.sphere(an, 0.024, M.white, 0, -0.032, 0.047, 1.15, 0.55, 0.72);
    kit.rbox(an, 0.026, 0.006, 0.028, 0.003, M.white, 0, -0.006, 0.026, false).rotation.x = 0.3;
    legs[side] = { hp, kn, an };
  }
  group.traverse(o => { if (o.isMesh) o.userData.character = 'kid'; });

  // ---- runtime state
  const P = {};
  const layers = makeLayers(KID_KEYS);
  let time = rand(0, 10), disposed = false, baseMouth = 'smile';
  const loco = { path: [], target: null, onArrive: null, speed: 0, legAmt: 0, phase: 0, faceYaw: null, startY: 0, endY: null, total: 0, yawVel: 0 };
  const gaze = { target: null, yaw: 0, pitch: 0, eyeYaw: 0, eyePitch: 0, glanceYaw: 0, glancePitch: 0, glanceT: rand(1, 3) };
  const blink = { t: rand(1, 3), ph: -1, again: false };
  const L1L2 = K.thigh + K.shin;

  const parentScale = () => (group.parent ? group.parent.getWorldScale(_v2).x : 1);
  const toLocal = (pt, out) => { out.copy(pt); if (group.parent) { group.parent.updateWorldMatrix(true, false); group.parent.worldToLocal(out); } return out; };
  const worldY = () => (group.parent ? group.parent.localToWorld(_v2.copy(group.position)).y : group.position.y);

  function nextWaypoint() {
    const pt = loco.path.shift();
    if (!pt) { loco.target = null; return; }
    const hasY = typeof pt.y === 'number' && !Number.isNaN(pt.y);
    loco.target = toLocal(_v1.set(pt.x, hasY ? pt.y : worldY(), pt.z), new THREE.Vector3());
    loco.startY = group.position.y;
    loco.endY = hasY ? loco.target.y : null;
    loco.total = Math.max(1e-4, Math.hypot(loco.target.x - group.position.x, loco.target.z - group.position.z));
  }
  function turnToward(yaw, dt) {
    const d = wrap(yaw - group.rotation.y);
    const stepMax = 4.0 * dt;
    const st = clamp(d * (1 - Math.exp(-7 * dt)), -stepMax, stepMax);
    group.rotation.y = wrap(group.rotation.y + st);
    return d;
  }

  function locomotion(dt) {
    const ps = parentScale(), speedMax = K.speed / ps;
    const yaw0 = group.rotation.y;
    let targetSpeed = 0;
    if (loco.target) {
      const tg = loco.target, last = loco.path.length === 0;
      const dx = tg.x - group.position.x, dz = tg.z - group.position.z, dist = Math.hypot(dx, dz);
      if (dist < (last ? 0.015 : 0.06) / ps) {
        if (last) {
          if (loco.endY !== null) group.position.y = loco.endY;
          loco.target = null;
          const cb = loco.onArrive; loco.onArrive = null;
          if (cb) cb();
        } else nextWaypoint();
      } else {
        const diff = turnToward(Math.atan2(dx, dz), dt);
        const align = clamp((Math.cos(diff) - 0.25) / 0.75, 0, 1);
        const decel = last ? clamp(dist * ps / 0.16, 0.22, 1) : 1;
        targetSpeed = speedMax * align * decel;
        if (loco.endY !== null) group.position.y = mix(loco.startY, loco.endY, 1 - clamp(dist / loco.total, 0, 1));
      }
    } else if (loco.faceYaw !== null) {
      if (Math.abs(turnToward(loco.faceYaw, dt)) < 0.01) loco.faceYaw = null;
    }
    const acc = 1.6 / ps * dt;
    loco.speed = clamp(targetSpeed, loco.speed - acc * 1.4, loco.speed + acc);
    if (loco.speed > 1e-5) {
      group.position.x += Math.sin(group.rotation.y) * loco.speed * dt;
      group.position.z += Math.cos(group.rotation.y) * loco.speed * dt;
    }
    loco.yawVel = dt > 0 ? Math.abs(wrap(group.rotation.y - yaw0)) / dt : 0;
    const walk = loco.speed / speedMax, turn = clamp(loco.yawVel / 2.5, 0, 1) * 0.6;
    loco.legAmt = damp(loco.legAmt, Math.max(walk, turn), 10, dt);
    loco.phase += (loco.speed * ps + loco.yawVel * 0.07) / K.cycle * TAU * dt;
  }

  function basePose(dt) {
    for (const k of KID_KEYS) P[k] = KID_REST[k] || 0;
    // idle: breathing, a slow weight shift, a little arm sway
    const br = Math.sin(time * TAU / 3.4);
    P.spineX += 0.014 * br; P.hipsOff += 0.0015 * br;
    P.shLZ += 0.02 * br; P.shRZ += 0.02 * br;
    P.shLX += 0.02 * Math.sin(time * 0.9); P.shRX += 0.02 * Math.sin(time * 0.9 + 1.3);
    P.hipsRz += 0.014 * Math.sin(time * 0.45); P.spineZ -= 0.02 * Math.sin(time * 0.45);
    P.headZ += 0.025 * Math.sin(time * 0.53 + 1);
    // walk cycle, scaled by how fast we are moving
    const a = loco.legAmt;
    if (a > 0.001) {
      const ph = loco.phase, s = Math.sin(ph), c = Math.cos(ph);
      const kl = 0.1 + 0.85 * Math.pow(Math.max(0, c), 2), kr = 0.1 + 0.85 * Math.pow(Math.max(0, -c), 2);
      P.hipLX += -0.5 * s * a; P.hipRX += 0.5 * s * a;
      P.kneeL += kl * a; P.kneeR += kr * a;
      P.ankL += (-0.45 * kl - 0.18 * Math.max(0, s) + 0.15 * Math.max(0, -s)) * a;
      P.ankR += (-0.45 * kr - 0.18 * Math.max(0, -s) + 0.15 * Math.max(0, s)) * a;
      P.shLX += 0.5 * s * a; P.shRX -= 0.5 * s * a;
      P.elLX -= (0.2 + 0.25 * Math.max(0, -s)) * a; P.elRX -= (0.2 + 0.25 * Math.max(0, s)) * a;
      P.shLZ += 0.06 * a; P.shRZ += 0.06 * a;
      P.hipsOff += (0.012 * Math.cos(2 * ph) - 0.01) * a;
      P.hipsRy -= 0.1 * s * a; P.spineY += 0.16 * s * a;
      P.hipsRz += 0.035 * c * a; P.spineZ -= 0.03 * c * a;
      P.spineX += 0.07 * a; P.neckX -= 0.05 * a;
      P.headX += 0.035 * Math.sin(2 * ph + 0.9) * a; P.headZ -= 0.03 * c * a;
    }
  }

  function updateLook(dt, override) {
    let dy = gaze.glanceYaw, dp = gaze.glancePitch;
    const tg = override || gaze.target;
    if (tg) {
      hc.getWorldPosition(_v1);
      _v1.subVectors(tg, _v1).applyQuaternion(spine.getWorldQuaternion(_q1).invert());
      dy = Math.atan2(_v1.x, _v1.z); dp = Math.atan2(-_v1.y, Math.hypot(_v1.x, _v1.z));
      if (Math.abs(dy) > 2.6) dy = 0; // right behind us: don't twist round
    } else if ((gaze.glanceT -= dt) <= 0) {
      const away = Math.random() < 0.6 && loco.legAmt < 0.2;
      gaze.glanceYaw = away ? rand(-0.45, 0.45) : 0; gaze.glancePitch = away ? rand(-0.12, 0.18) : 0;
      gaze.glanceT = rand(2.5, 6);
    }
    dy = clamp(dy, -1.2, 1.2); dp = clamp(dp, -0.6, 0.9);
    gaze.yaw = damp(gaze.yaw, dy, 6, dt); gaze.pitch = damp(gaze.pitch, dp, 6, dt);
    gaze.eyeYaw = damp(gaze.eyeYaw, clamp((dy - gaze.yaw) * 0.6, -0.16, 0.16), 22, dt);
    gaze.eyePitch = damp(gaze.eyePitch, clamp((dp - gaze.pitch) * 0.5, -0.1, 0.1), 22, dt);
    P.neckY += 0.35 * gaze.yaw; P.headY += 0.65 * gaze.yaw;
    P.neckX += 0.35 * gaze.pitch; P.headX += 0.55 * gaze.pitch;
    P.spineX += 0.18 * Math.max(0, gaze.pitch - 0.4);
    eyesRig.rotation.set(gaze.eyePitch, gaze.eyeYaw, 0);
  }

  function updateFace(dt, mouth) {
    // blink every 2–5 s, sometimes twice
    let closed = 0;
    if (blink.ph >= 0) {
      blink.ph += dt;
      closed = Math.sin(Math.PI * clamp(blink.ph / 0.15, 0, 1));
      if (blink.ph >= 0.15) { blink.ph = blink.again ? -0.08 : -1; blink.again = false; }
    } else if (blink.ph < -0.5) {
      if ((blink.t -= dt) <= 0) { blink.ph = 0; blink.t = rand(2, 5); blink.again = Math.random() < 0.18; }
    } else if ((blink.ph += dt) >= 0) blink.ph = 0; // gap before the double blink
    const open = clamp(P.eyeOpen, 0.05, 1.2) * (1 - 0.92 * closed), wide = 1 + 0.18 * P.eyeWide;
    eyes[0].scale.set(wide, wide * Math.max(0.06, open), wide);
    eyes[1].scale.set(wide, wide * Math.max(0.06, open * (1 - 0.93 * P.wink)), wide);
    for (const { piv, b, s } of brows) {
      piv.rotation.x = -0.1 * P.brow - s * 0.09 * P.browTilt;
      b.rotation.z = Math.PI / 2 - s * 0.12 + s * 0.3 * Math.max(0, -P.brow) + 0.22 * P.browTilt;
    }
    const want = mouth || baseMouth;
    for (const k in mouths) {
      mouthAmt[k] = damp(mouthAmt[k], k === want ? 1 : 0, 16, dt);
      const m = mouths[k];
      m.visible = mouthAmt[k] > 0.02;
      m.scale.setScalar(Math.max(1e-3, mouthAmt[k]));
    }
  }

  function applyPose() {
    rig.position.y = P.lift;
    hips.position.y = K.hipY + P.hipsOff - L1L2 * (1 - Math.cos(P.bend));
    hips.rotation.set(0, P.hipsRy, P.hipsRz);
    spine.rotation.set(P.spineX, P.spineY, P.spineZ);
    neck.rotation.set(P.neckX, P.neckY, 0);
    head.rotation.set(P.headX, P.headY, P.headZ);
    const A = arms.L, B = arms.R;
    A.sh.rotation.set(P.shLX, -P.shLY, P.shLZ); B.sh.rotation.set(P.shRX, P.shRY, -P.shRZ);
    A.el.rotation.set(P.elLX, 0, P.elLZ); B.el.rotation.set(P.elRX, 0, -P.elRZ);
    A.ha.rotation.set(P.haLX, -P.haLY, P.haLZ); B.ha.rotation.set(P.haRX, P.haRY, -P.haRZ);
    A.th.rotation.x = -1.6 * P.thumbL; B.th.rotation.x = -1.6 * P.thumbR;
    A.th.scale.setScalar(1 + 0.35 * P.thumbL); B.th.scale.setScalar(1 + 0.35 * P.thumbR);
    for (const [f, v] of [[A.fi, P.fingerL], [B.fi, P.fingerR]]) { f.visible = v > 0.02; f.scale.set(1, Math.max(0.01, v), 1); }
    const l = legs.L, r = legs.R;
    l.hp.rotation.set(P.hipLX - P.bend, 0, P.hipLZ); r.hp.rotation.set(P.hipRX - P.bend, 0, -P.hipRZ);
    l.kn.rotation.x = P.kneeL + 2 * P.bend; r.kn.rotation.x = P.kneeR + 2 * P.bend;
    l.an.rotation.x = P.ankL - P.bend; r.an.rotation.x = P.ankR - P.bend;
  }

  function update(dt) {
    if (disposed) return;
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    time += dt;
    locomotion(dt);
    basePose(dt);
    const res = layers.evaluate(P, dt, api);
    updateLook(dt, res.look);
    updateFace(dt, res.mouth);
    applyPose();
  }

  const playG = (name, onDone, data) => { if (!disposed) layers.play(KG[name], onDone, data); return api; };
  const api = {
    group, palette: look, height: KID_HEIGHT,
    update,
    walkTo(point, onArrive) { return api.walkPath([point], onArrive); },
    walkPath(points, onArrive) {
      if (!points || !points.length) { if (onArrive) onArrive(); return api; }
      if (layers.has(KG.crouch)) layers.release(KG.crouch);
      loco.path = points.slice(); loco.onArrive = onArrive || null; loco.faceYaw = null;
      nextWaypoint();
      return api;
    },
    stop() { loco.path = []; loco.target = null; loco.onArrive = null; loco.faceYaw = null; return api; },
    isWalking() { return !!loco.target; },
    faceTo(point) {
      const v = toLocal(point, new THREE.Vector3());
      const dx = v.x - group.position.x, dz = v.z - group.position.z;
      if (dx * dx + dz * dz > 1e-8 && !loco.target) loco.faceYaw = Math.atan2(dx, dz);
      return api;
    },
    lookAt(point) { gaze.target = point ? new THREE.Vector3().copy(point) : null; return api; },
    point(target, onDone) {
      const tg = new THREE.Vector3().copy(target);
      group.updateWorldMatrix(true, false);
      const loc = group.worldToLocal(_v1.copy(tg));
      if (Math.abs(Math.atan2(loc.x, loc.z)) > 1.3 && !loco.target) api.faceTo(tg);
      return playG('point', onDone, { target: tg, look: tg, side: loc.x >= 0 ? 'L' : 'R' });
    },
    crouch(onDone) { if (layers.has(KG.crouch)) { if (onDone) onDone(); return api; } return playG('crouch', onDone); },
    stand(onDone) { if (!layers.release(KG.crouch, onDone) && onDone) onDone(); return api; },
    isCrouching() { return layers.has(KG.crouch); },
    jump: (onDone) => playG('jump', onDone),
    clap: (onDone) => playG('clap', onDone),
    scratchHead: (onDone) => playG('scratchHead', onDone),
    thumbsUp: (onDone) => playG('thumbsUp', onDone),
    wow: (onDone) => playG('wow', onDone),
    wave: (onDone) => playG('wave', onDone),
    nod: (onDone) => playG('nod', onDone),
    shakeHead: (onDone) => playG('shakeHead', onDone),
    handsOnHips: (onDone) => playG('handsOnHips', onDone),
    isBusy() { return layers.busy(); },
    setMouth(m) { if (m in mouths) baseMouth = m; return api; },
    headWorldPosition(out = new THREE.Vector3()) {
      hc.updateWorldMatrix(true, false);
      hc.getWorldPosition(out);
      out.y += (R * K.headS + 0.035) * group.getWorldScale(_v2).y;
      return out;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      kit.dispose();
    },
    // internal: unit direction from a shoulder to a world point, in the spine's frame
    _armDir(side, target) {
      arms[side].sh.getWorldPosition(_v1);
      _v1.subVectors(target, _v1).applyQuaternion(spine.getWorldQuaternion(_q1).invert());
      return _v1.lengthSq() > 1e-10 ? _v1.normalize() : _v1.set(0, -1, 0);
    },
  };
  update(0);
  return api;
}

// ================================================================ toy spectators
export const TOY_KINDS = ['robot', 'dino', 'bunny', 'duck', 'bear'];
export const TOY_NAMES = { robot: 'Bolt', dino: 'Pickle', bunny: 'Clover', duck: 'Puddle', bear: 'Button' };

// eyes: a holder on the head sphere (scaled on y to blink) with a glossy ball and a highlight
function toyEye(kit, parent, R, yaw, pitch, r, mat, shine) {
  const e = onSphere(kit.node(parent), R, yaw, pitch, -r * 0.2);
  kit.sphere(e, r, mat, 0, 0, 0, 0.92, 1.1, 0.55, false);
  if (shine) kit.sphere(e, r * 0.34, shine, -r * 0.3, r * 0.4, r * 0.45, 1, 1, 0.5, false);
  return e;
}
// a unit sphere with knitted ribs and rows pressed into it
function knitSphere() {
  const g = new THREE.SphereGeometry(1, 40, 22);
  const pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const lon = Math.atan2(v.x, v.z), lat = Math.asin(clamp(v.y, -1, 1));
    const k = 1 + 0.028 * Math.pow(Math.abs(Math.sin(lon * 10 + lat * 1.5)), 0.7) + 0.01 * Math.sin(lat * 26);
    pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}

// Each builder fills `root` (pivot at the base) and returns its moving parts.
const TOY_BUILDERS = {
  robot(kit, root) {
    const blue = kit.std('#7fb8ff', 0.4, { metalness: 0.1 }), white = kit.std('#eef2f7', 0.45), grey = kit.std('#b9c3d1', 0.35, { metalness: 0.3 });
    const yellow = kit.std('#ffd45e', 0.4), screen = kit.std('#27304a', 0.25, { envMapIntensity: 0.8 });
    const glow = kit.std('#7ff6ff', 0.3, { emissive: '#4fe8ff', emissiveIntensity: 1.3 });
    kit.rbox(root, 0.07, 0.058, 0.054, 0.014, blue, 0, 0.045, 0);
    kit.rbox(root, 0.04, 0.026, 0.006, 0.003, white, 0, 0.047, 0.026);
    ['#ff6b6b', '#ffd45e', '#7fdc9b'].forEach((c, i) => kit.sphere(root, 0.0045, kit.std(c, 0.35), (i - 1) * 0.011, 0.047, 0.03, 1, 1, 0.5, false));
    for (const s of [-1, 1]) {
      kit.rbox(root, 0.022, 0.018, 0.04, 0.006, grey, s * 0.019, 0.012, 0.022);
      kit.rbox(root, 0.027, 0.022, 0.016, 0.007, blue, s * 0.019, 0.013, 0.046);
    }
    const arm = (s) => {
      const a = kit.node(root, s * 0.041, 0.063, 0, 'XZY');
      kit.sphere(a, 0.0095, yellow);
      kit.cyl(a, 0.0052, 0.0052, 0.026, grey, 0, -0.016, 0);
      const claw = kit.add(a, kit.geo('claw', () => new THREE.TorusGeometry(0.0075, 0.0032, 6, 12, Math.PI * 1.4)), yellow, 0, -0.034, 0);
      claw.rotation.set(0, Math.PI / 2, -Math.PI * 0.2 - Math.PI / 2);
      return a;
    };
    const armL = arm(1), armR = arm(-1);
    kit.cyl(root, 0.007, 0.008, 0.014, grey, 0, 0.078, 0);
    const head = kit.node(root, 0, 0.08, 0, 'YXZ');
    const hc = kit.node(head, 0, 0.03, 0);
    kit.rbox(hc, 0.078, 0.056, 0.058, 0.016, white, 0, 0, 0);
    kit.rbox(hc, 0.062, 0.038, 0.008, 0.008, screen, 0, -0.001, 0.027);
    const eyes = [];
    for (const s of [-1, 1]) {
      const e = kit.node(hc, s * 0.014, 0.003, 0.0315);
      kit.sphere(e, 0.0072, glow, 0, 0, 0, 1, 1.3, 0.4, false);
      eyes.push(e);
      const bolt = kit.cyl(hc, 0.0095, 0.0095, 0.008, yellow, s * 0.042, 0, 0);
      bolt.rotation.z = Math.PI / 2;
    }
    kit.add(hc, kit.geo('rmouth', () => new THREE.TorusGeometry(0.0065, 0.0017, 5, 12, Math.PI)), glow, 0, -0.008, 0.0312, 1, 1, 1, false).rotation.z = Math.PI;
    const ant = kit.node(hc, 0, 0.028, 0);
    kit.cyl(ant, 0.0022, 0.0028, 0.019, grey, 0, 0.0095, 0);
    kit.sphere(ant, 0.0065, kit.std('#ff6b6b', 0.35, { emissive: '#ff3b3b', emissiveIntensity: 0.35 }), 0, 0.022, 0);
    return { head, hc, armL, armR, eyes, headTop: 0.064, rest: {},
      jiggles: [{ n: ant, ax: 'x', gy: 1.2, gl: 0 }, { n: ant, ax: 'z', gy: 0, gl: 1.4 }] };
  },

  dino(kit, root) {
    const green = kit.std('#8ed98a', 0.6), belly = kit.std('#eef7c8', 0.7), spike = kit.std('#ffb45e', 0.5);
    const dark = kit.std('#2b2233', 0.25, { envMapIntensity: 0.9 }), shine = kit.basic('#ffffff'), white = kit.std('#fbf8f2', 0.5);
    const cheek = kit.std('#ff9fae', 0.9), mouth = kit.std('#2f5a33', 0.6);
    kit.sphere(root, 0.045, green, 0, 0.045, -0.004, 1, 1.04, 1);
    kit.sphere(root, 0.03, belly, 0, 0.041, 0.031, 1, 1.15, 0.52);
    const cone = kit.geo('spike', () => new THREE.ConeGeometry(1, 1, 10));
    for (const [a, sz] of [[0.25, 0.8], [0.7, 1], [1.15, 0.85]]) {
      const m = kit.add(root, cone, spike, 0, 0.045 + 0.046 * Math.sin(a), -0.004 - 0.046 * Math.cos(a), 0.0085 * sz, 0.018 * sz, 0.0085 * sz);
      m.rotation.x = a - Math.PI / 2;
    }
    const tail = kit.node(root, 0, 0.02, -0.04);
    for (let i = 0; i < 4; i++) kit.sphere(tail, 0.019 - i * 0.004, green, i * i * 0.0035, 0.002 - i * 0.003, -0.012 - i * 0.015);
    kit.add(tail, cone, spike, 0.03, 0.002, -0.06, 0.005, 0.01, 0.005).rotation.x = -0.4;
    for (const s of [-1, 1]) {
      kit.sphere(root, 0.019, green, s * 0.027, 0.017, 0.028, 0.95, 0.9, 1.3);
      for (const t of [-1, 0, 1]) kit.sphere(root, 0.004, white, s * 0.027 + t * 0.008, 0.012, 0.052, 1, 0.8, 1, false);
    }
    const arm = (s) => {
      const a = kit.node(root, s * 0.034, 0.063, 0.02, 'XZY');
      kit.capsule(a, 0.0075, 0.012, green, 0, -0.009, 0.001);
      return a;
    };
    const armL = arm(1), armR = arm(-1);
    const head = kit.node(root, 0, 0.083, 0.004, 'YXZ');
    const hc = kit.node(head, 0, 0.03, 0);
    const R = 0.034;
    kit.sphere(hc, R, green, 0, 0, 0, 1, 0.95, 1);
    kit.sphere(hc, 0.025, green, 0, -0.009, 0.023, 1.05, 0.8, 0.95);
    for (const s of [-1, 1]) {
      kit.sphere(hc, 0.0028, dark, s * 0.008, -0.003, 0.0465, 1, 1, 1, false);
      kit.sphere(onSphere(kit.node(hc), R, s * 0.75, -0.15, -0.002), 0.008, cheek, 0, 0, 0, 1, 0.65, 0.3, false);
    }
    kit.add(hc, kit.geo('dsmile', () => new THREE.TorusGeometry(0.011, 0.0022, 5, 12, Math.PI)), mouth, 0, -0.012, 0.0415, 1, 1, 1, false).rotation.set(-0.35, 0, Math.PI);
    for (const [a, sz] of [[1.25, 0.7], [1.75, 0.6]]) {
      const m = kit.add(hc, cone, spike, 0, R * Math.sin(a), R * Math.cos(a), 0.007 * sz, 0.016 * sz, 0.007 * sz);
      m.rotation.x = a - Math.PI / 2;
    }
    const eyes = [-1, 1].map(s => toyEye(kit, hc, R, s * 0.42, 0.3, 0.0068, dark, shine));
    return { head, hc, armL, armR, eyes, headTop: 0.05, rest: { aLX: -0.6, aRX: -0.6, aLZ: 0.15, aRZ: 0.15 },
      jiggles: [{ n: tail, ax: 'y', gy: 0, gl: 2.5, wag: 0.12 }] };
  },

  bunny(kit, root) {
    const fur = kit.std('#cdb8ff', 0.85), cream = kit.std('#fff6fb', 0.85), pink = kit.std('#ffb3cc', 0.8);
    const dark = kit.std('#2b2233', 0.25, { envMapIntensity: 0.9 }), shine = kit.basic('#ffffff'), white = kit.std('#ffffff', 0.5);
    kit.sphere(root, 0.04, fur, 0, 0.043, 0, 1, 1.08, 0.95);
    kit.sphere(root, 0.027, cream, 0, 0.04, 0.028, 1, 1.1, 0.55);
    kit.sphere(root, 0.014, cream, 0, 0.022, -0.04);
    for (const s of [-1, 1]) {
      kit.sphere(root, 0.017, fur, s * 0.024, 0.009, 0.036, 0.78, 0.5, 1.35);
      kit.sphere(root, 0.008, pink, s * 0.024, 0.011, 0.058, 1, 1, 0.35, false);
    }
    const arm = (s) => {
      const a = kit.node(root, s * 0.034, 0.066, 0.006, 'XZY');
      kit.sphere(a, 0.012, fur, 0, -0.014, 0, 0.85, 1.5, 0.85);
      return a;
    };
    const armL = arm(1), armR = arm(-1);
    const head = kit.node(root, 0, 0.077, 0.002, 'YXZ');
    const hc = kit.node(head, 0, 0.028, 0);
    const R = 0.034;
    kit.sphere(hc, R, fur, 0, 0, 0, 1.1, 0.95, 1);
    const jiggles = [];
    for (const s of [-1, 1]) {
      const ear = kit.node(hc, s * 0.014, 0.025, -0.004);
      ear.rotation.set(-0.2, 0, s > 0 ? -0.22 : 0.95); // one ear flops over
      kit.capsule(ear, 0.0088, 0.025, fur, 0, 0.02, 0).scale.z = 0.62;
      kit.capsule(ear, 0.0052, 0.02, pink, 0, 0.02, 0.0035, false).scale.z = 0.4;
      jiggles.push({ n: ear, ax: 'x', gy: -1.6, gl: 0, base: -0.2 }, { n: ear, ax: 'z', gy: 0, gl: s * 1.2, base: s > 0 ? -0.22 : 0.95 });
      kit.sphere(onSphere(kit.node(hc), R, s * 0.62, -0.22, -0.002), 0.0085, pink, 0, 0, 0, 1, 0.65, 0.3, false);
    }
    kit.sphere(hc, 0.0055, pink, 0, -0.006, R + 0.0005, 1.35, 0.9, 0.7, false);
    kit.rbox(hc, 0.0085, 0.007, 0.003, 0.0012, white, 0, -0.0135, R - 0.002, false);
    const eyes = [-1, 1].map(s => toyEye(kit, hc, R, s * 0.42, 0.06, 0.0064, dark, shine));
    return { head, hc, armL, armR, eyes, headTop: 0.075, rest: {}, jiggles };
  },

  duck(kit, root) {
    const yellow = kit.std('#ffd45e', 0.4, { envMapIntensity: 0.5 }), orange = kit.std('#ff9b3d', 0.45), orange2 = kit.std('#f07d24', 0.5);
    const dark = kit.std('#2b2233', 0.25, { envMapIntensity: 0.9 }), shine = kit.basic('#ffffff'), cheek = kit.std('#ffab7a', 0.9);
    kit.sphere(root, 0.046, yellow, 0, 0.04, -0.004, 1, 0.88, 1.12);
    const tail = kit.node(root, 0, 0.05, -0.048);
    kit.sphere(tail, 0.019, yellow, 0, 0.006, -0.004, 0.8, 0.8, 1.3).rotation.x = -0.7;
    for (const s of [-1, 1]) kit.sphere(root, 0.016, orange, s * 0.022, 0.005, 0.044, 1, 0.3, 1.4);
    const wing = (s) => {
      const a = kit.node(root, s * 0.043, 0.056, -0.004, 'XZY');
      kit.sphere(a, 0.021, yellow, 0, -0.012, -0.004, 0.36, 1, 1.25);
      return a;
    };
    const armL = wing(1), armR = wing(-1);
    const head = kit.node(root, 0, 0.068, 0.012, 'YXZ');
    const hc = kit.node(head, 0, 0.034, 0);
    const R = 0.033;
    kit.sphere(hc, R, yellow);
    kit.sphere(hc, 0.016, orange, 0, -0.004, 0.031, 1.3, 0.5, 1.1);
    kit.sphere(hc, 0.014, orange2, 0, -0.011, 0.028, 1.1, 0.38, 0.95);
    const tuft = kit.node(hc, 0, R - 0.002, 0.004);
    for (const [rz, rx, l] of [[0, -0.2, 1], [0.55, -0.1, 0.8], [-0.55, -0.1, 0.8]]) {
      const c = kit.node(tuft); c.rotation.set(rx, 0, rz);
      kit.capsule(c, 0.0035, 0.011 * l, yellow, 0, 0.007 * l, 0);
    }
    for (const s of [-1, 1]) kit.sphere(onSphere(kit.node(hc), R, s * 0.85, -0.12, -0.002), 0.008, cheek, 0, 0, 0, 1, 0.65, 0.3, false);
    const eyes = [-1, 1].map(s => toyEye(kit, hc, R, s * 0.5, 0.18, 0.0066, dark, shine));
    return { head, hc, armL, armR, eyes, headTop: 0.048, rest: { aLX: -0.1, aRX: -0.1, aLZ: 0.08, aRZ: 0.08 },
      jiggles: [{ n: tail, ax: 'x', gy: 1.5, gl: 0 }, { n: tail, ax: 'y', gy: 0, gl: 2, wag: 0.06 }, { n: tuft, ax: 'x', gy: -1.4, gl: 0 }, { n: tuft, ax: 'z', gy: 0, gl: 1.2 }] };
  },

  bear(kit, root) {
    const knit = kit.std('#e3876b', 0.95, { envMapIntensity: 0.15 }), cream = kit.std('#f7e6cc', 0.95, { envMapIntensity: 0.15 });
    const scarf = kit.std('#8fd8c0', 0.9), dark = kit.std('#33262a', 0.3, { envMapIntensity: 0.8 }), shine = kit.basic('#ffffff');
    const kg = kit.geo('knit', knitSphere);
    const ks = (parent, r, mat, x, y, z, sx = 1, sy = 1, sz = 1) => kit.add(parent, kg, mat, x, y, z, r * sx, r * sy, r * sz);
    ks(root, 0.042, knit, 0, 0.044, 0, 1, 1.05, 0.92);
    ks(root, 0.026, cream, 0, 0.04, 0.03, 1, 1.1, 0.5);
    kit.sphere(root, 0.0085, scarf, -0.02, 0.058, 0.032, 1, 1, 0.35, false); // a darned patch
    for (const s of [-1, 1]) {
      ks(root, 0.018, knit, s * 0.026, 0.016, 0.03, 0.95, 0.9, 1.35);
      kit.sphere(root, 0.0105, cream, s * 0.027, 0.017, 0.054, 1, 1, 0.4, false);
    }
    const arm = (s) => {
      const a = kit.node(root, s * 0.038, 0.07, 0.004, 'XZY');
      ks(a, 0.0135, knit, 0, -0.017, 0, 0.9, 1.55, 0.9);
      return a;
    };
    const armL = arm(1), armR = arm(-1);
    const sc = kit.add(root, kit.geo('scarf', () => new THREE.TorusGeometry(0.026, 0.0075, 8, 20)), scarf, 0, 0.081, 0);
    sc.rotation.x = Math.PI / 2;
    const tailEnd = kit.rbox(root, 0.014, 0.034, 0.006, 0.003, scarf, 0.014, 0.064, 0.03);
    tailEnd.rotation.set(-0.35, 0, 0.25);
    const head = kit.node(root, 0, 0.083, 0, 'YXZ');
    const hc = kit.node(head, 0, 0.031, 0);
    const R = 0.036;
    ks(hc, R, knit, 0, 0, 0, 1.06, 0.96, 1);
    const jiggles = [];
    for (const s of [-1, 1]) {
      const ear = kit.node(hc, s * 0.026, 0.025, -0.004);
      ks(ear, 0.0125, knit, 0, 0.004, 0, 1, 1, 0.62);
      kit.sphere(ear, 0.0075, cream, 0, 0.003, 0.0075, 1, 1, 0.35, false);
      jiggles.push({ n: ear, ax: 'z', gy: 0, gl: s * 0.6 }, { n: ear, ax: 'x', gy: -0.5, gl: 0 });
    }
    ks(hc, 0.016, cream, 0, -0.011, 0.03, 1.2, 0.85, 0.75);
    kit.sphere(hc, 0.0062, dark, 0, -0.005, 0.0425, 1.25, 0.8, 0.8, false);
    const eyes = [-1, 1].map(s => toyEye(kit, hc, R, s * 0.38, 0.1, 0.0058, dark, shine));
    return { head, hc, armL, armR, eyes, headTop: 0.052, rest: {}, jiggles };
  },
};

const TOY_KEYS = ['y', 'lean', 'roll', 'twist', 'squash', 'hX', 'hY', 'hZ', 'aLX', 'aLZ', 'aRX', 'aRZ', 'eyeOpen', 'eyeWide'];
const TOY_REST = { aLX: -0.35, aRX: -0.35, aLZ: 0.3, aRZ: 0.3, eyeOpen: 1 };
const arms2 = (p, x, z, w = 1, dx = 0) => {
  p.aLX = mix(p.aLX, x + dx, w); p.aRX = mix(p.aRX, x - dx, w);
  p.aLZ = mix(p.aLZ, z, w); p.aRZ = mix(p.aRZ, z, w);
};
// hops: height of a series of `n` hops, each `per` seconds long, starting at t0
const hops = (t, t0, per, n) => (t > t0 && t < t0 + per * n ? Math.sin(Math.PI * (((t - t0) / per) % 1)) : 0);

const TG = {
  cheer: { dur: 1.6, fin: 0.12, fout: 0.4, pose(p, t) {
    const up = backOut(sstep(0, 0.3, t)), f = Math.sin(t * 16) * 0.2 * sstep(0.25, 0.45, t);
    arms2(p, -2.75, 0.55, up, f);
    const h = hops(t, 0.12, 0.42, 3);
    p.y += 0.02 * h; p.squash += 0.07 * h - 0.06 * bell(t, 0.05, 0.2, 0.05, 0.1);
    p.hX -= 0.18 * up; p.lean -= 0.06 * up; p.eyeWide = 0.4;
  } },
  coverEyes: { dur: 2.3, fin: 0.22, fout: 0.45, pose(p, t) {
    arms2(p, -2.6, -0.55);
    p.hX += 0.34; p.lean += 0.12; p.squash -= 0.06;
    p.roll += 0.025 * Math.sin(t * 42) * sstep(0.2, 0.4, t);
    p.eyeOpen = 0.08;
  } },
  bounce: { dur: 1.05, fin: 0.06, fout: 0.15, pose(p, t) {
    const h = hops(t, 0.02, 0.33, 3);
    p.y += 0.024 * h; p.squash += 0.06 * h - 0.05 * (1 - h) * bell(t, 0, 1.0, 0.05, 0.1);
    arms2(p, -0.8 - 0.6 * h, 0.5 + 0.3 * h);
    p.hX -= 0.08 * h;
  } },
  nod: { dur: 1.0, fin: 0.1, fout: 0.15, pose(p, t) {
    p.hX += 0.32 * Math.pow(Math.sin(Math.PI * clamp(t / 0.43, 0, 2)), 2);
  } },
  shakeHead: { dur: 1.15, fin: 0.12, fout: 0.2, pose(p, t) {
    p.hY += 0.5 * Math.sin(t * TAU * 2.4) * (1 - sstep(0.5, 1.1, t)); p.hX += 0.05;
  } },
  gasp: { dur: 1.5, fin: 0.1, fout: 0.55, pose(p, t) {
    p.lean -= 0.28; p.hX -= 0.2; p.squash += 0.05 * bell(t, 0, 0.6, 0.08, 0.4);
    arms2(p, -1.2, 0.85);
    p.eyeWide = 1; p.y += 0.006 * bell(t, 0, 0.35, 0.08, 0.2);
  } },
  dance: { dur: 2.1, fin: 0.25, fout: 0.3, pose(p, t) {
    const b = TAU * 2.2 * t, s = Math.sin(b);
    p.roll += 0.2 * s; p.twist += 0.28 * Math.sin(b / 2); p.hZ -= 0.22 * s;
    p.y += 0.01 * Math.abs(Math.sin(b)); p.squash += 0.03 * Math.cos(2 * b);
    p.aLX = -1.6 - 1.0 * s; p.aRX = -1.6 + 1.0 * s; p.aLZ = 0.7 + 0.3 * s; p.aRZ = 0.7 - 0.3 * s;
    p.eyeOpen = 0.55;
  } },
  sleep: { stance: true, fin: 1.2, fout: 0.6, pose(p, t) {
    p.eyeOpen = 0; p.hX += 0.38; p.hZ += 0.16; p.lean += 0.06;
    arms2(p, -0.05, 0.12);
    p.squash += 0.035 * Math.sin(t * 1.7); p.roll *= 0.3;
  } },
  stretch: { dur: 1.4, fin: 0.3, fout: 0.5, pose(p, t) {
    arms2(p, -2.7, 0.7, bell(t, 0, 1.3, 0.4, 0.5));
    p.lean -= 0.12; p.hX -= 0.2; p.squash += 0.06; p.eyeOpen = mix(0.15, 1, sstep(0.6, 1.2, t));
  } },
};

/**
 * createToy(kind) — kind is one of TOY_KINDS. A sitting toy 0.13–0.17 m tall, base at y = 0,
 * facing +Z. Drive it with update(dt).
 */
export function createToy(kind = 'bear') {
  if (!TOY_BUILDERS[kind]) kind = 'bear';
  const kit = makeKit();
  const group = new THREE.Group(); group.name = 'toy-' + kind;
  const root = kit.node(group, 0, 0, 0, 'YXZ');
  const parts = TOY_BUILDERS[kind](kit, root);
  const { head, hc, armL, armR, eyes } = parts;
  const rest = Object.assign({}, TOY_REST, parts.rest);
  const eyeBase = eyes.map(e => e.scale.clone());
  const jig = parts.jiggles.map(j => Object.assign({ base: j.n.rotation[j.ax] }, j));
  // tiny toys: no self-shadowing (it only shows as acne at this scale), they still cast shadows
  group.traverse(o => { if (o.isMesh) { o.userData.character = kind; o.receiveShadow = false; } });

  const P = {};
  const layers = makeLayers(TOY_KEYS);
  const seed = rand(0, 100);
  let time = 0, disposed = false, faceYaw = null, turnPh = 0, turnAmt = 0;
  const gaze = { target: null, yaw: 0, pitch: 0, glanceYaw: 0, glancePitch: 0, glanceT: rand(1, 4) };
  const blink = { t: rand(1, 4), ph: -1 };
  const spr = { y: 0, vy: 0, l: 0, vl: 0, prevY: 0, prevVY: 0, prevL: 0, prevVL: 0 };

  function update(dt) {
    if (disposed) return;
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    time += dt;
    for (const k of TOY_KEYS) P[k] = rest[k] || 0;
    // idle sway and breathing
    P.roll += 0.03 * Math.sin(time * 1.3 + seed); P.hZ += 0.06 * Math.sin(time * 0.8 + seed * 2);
    P.squash += 0.014 * Math.sin(time * 2.4 + seed); P.hX += 0.03 * Math.sin(time * 0.6 + seed);
    P.aLX += 0.05 * Math.sin(time * 1.1 + seed); P.aRX += 0.05 * Math.sin(time * 1.1 + seed + 1.7);
    // turning on the spot: little shuffle hops
    if (faceYaw !== null) {
      const d = wrap(faceYaw - group.rotation.y);
      const st = clamp(d * (1 - Math.exp(-6 * dt)), -3 * dt, 3 * dt);
      group.rotation.y = wrap(group.rotation.y + st);
      turnAmt = dt > 0 ? Math.min(1, Math.abs(st) / dt / 1.5) : 0;
      if (Math.abs(d) < 0.005) faceYaw = null;
    } else turnAmt = damp(turnAmt, 0, 10, dt);
    turnPh += dt * 16 * (turnAmt > 0.05 ? 1 : 0);
    P.y += 0.007 * Math.abs(Math.sin(turnPh)) * turnAmt;
    layers.evaluate(P, dt, api);
    const asleep = layers.has(TG.sleep);
    // look
    let dy = gaze.glanceYaw, dp = gaze.glancePitch;
    if (gaze.target && !asleep) {
      hc.getWorldPosition(_v1);
      _v1.subVectors(gaze.target, _v1).applyQuaternion(root.getWorldQuaternion(_q1).invert());
      dy = Math.atan2(_v1.x, _v1.z); dp = Math.atan2(-_v1.y, Math.hypot(_v1.x, _v1.z));
      if (Math.abs(dy) > 2.6) dy = 0;
    } else if ((gaze.glanceT -= dt) <= 0) {
      const away = Math.random() < 0.55;
      gaze.glanceYaw = away ? rand(-0.6, 0.6) : 0; gaze.glancePitch = away ? rand(-0.2, 0.2) : 0;
      gaze.glanceT = rand(2, 6);
    }
    if (asleep) { dy = 0; dp = 0; }
    gaze.yaw = damp(gaze.yaw, clamp(dy, -1.2, 1.2), 5, dt); gaze.pitch = damp(gaze.pitch, clamp(dp, -0.6, 0.6), 5, dt);
    P.hY += gaze.yaw; P.hX += gaze.pitch;
    // blink
    let closed = 0;
    if (blink.ph >= 0) { blink.ph += dt; closed = Math.sin(Math.PI * clamp(blink.ph / 0.14, 0, 1)); if (blink.ph >= 0.14) blink.ph = -1; }
    else if ((blink.t -= dt) <= 0) { blink.ph = 0; blink.t = rand(2, 5); }
    const open = Math.max(0.07, clamp(P.eyeOpen, 0, 1.2) * (1 - 0.93 * closed)), wide = 1 + 0.25 * P.eyeWide;
    eyes.forEach((e, i) => e.scale.set(eyeBase[i].x * wide, eyeBase[i].y * wide * open, eyeBase[i].z * wide));
    // apply
    root.position.y = P.y;
    root.rotation.set(P.lean, P.twist, P.roll);
    root.scale.set(1 - P.squash * 0.5, 1 + P.squash, 1 - P.squash * 0.5);
    head.rotation.set(P.hX, P.hY, P.hZ);
    armL.rotation.set(P.aLX, 0, P.aLZ); armR.rotation.set(P.aRX, 0, -P.aRZ);
    // secondary motion: ears / antenna / tails lag behind bounces and head turns
    if (dt > 0) {
      const vy = (P.y + P.squash * 0.05 - spr.prevY) / dt, ay = clamp((vy - spr.prevVY) / dt, -40, 40);
      const lv = (P.hY + P.roll - spr.prevL) / dt, al = clamp((lv - spr.prevVL) / dt, -200, 200);
      spr.prevY = P.y + P.squash * 0.05; spr.prevVY = vy; spr.prevL = P.hY + P.roll; spr.prevVL = lv;
      spr.vy += (-320 * spr.y - 9 * spr.vy - ay * 0.6) * dt; spr.y += spr.vy * dt;
      spr.vl += (-260 * spr.l - 8 * spr.vl - al * 0.004) * dt; spr.l += spr.vl * dt;
      spr.y = clamp(spr.y, -0.6, 0.6); spr.l = clamp(spr.l, -0.6, 0.6);
    }
    for (const j of jig) j.n.rotation[j.ax] = j.base + j.gy * spr.y + j.gl * spr.l + (j.wag ? j.wag * Math.sin(time * 2.2 + seed) * (asleep ? 0.2 : 1) : 0);
  }

  const playG = (g, onDone) => { if (!disposed) layers.play(g, onDone); return api; };
  const api = {
    kind, name: TOY_NAMES[kind], group,
    update,
    lookAt(point) { gaze.target = point ? new THREE.Vector3().copy(point) : null; return api; },
    faceTo(point) {
      const v = _v2.copy(point);
      if (group.parent) { group.parent.updateWorldMatrix(true, false); group.parent.worldToLocal(v); }
      const dx = v.x - group.position.x, dz = v.z - group.position.z;
      if (dx * dx + dz * dz > 1e-8) faceYaw = Math.atan2(dx, dz);
      return api;
    },
    cheer: (onDone) => playG(TG.cheer, onDone),
    coverEyes: (onDone) => playG(TG.coverEyes, onDone),
    bounce: (onDone) => playG(TG.bounce, onDone),
    nod: (onDone) => playG(TG.nod, onDone),
    shakeHead: (onDone) => playG(TG.shakeHead, onDone),
    gasp: (onDone) => playG(TG.gasp, onDone),
    dance: (onDone) => playG(TG.dance, onDone),
    sleep(onDone) { if (layers.has(TG.sleep)) { if (onDone) onDone(); return api; } return playG(TG.sleep, onDone); },
    wake(onDone) { if (layers.release(TG.sleep)) playG(TG.stretch, onDone); else if (onDone) onDone(); return api; },
    isAsleep() { return layers.has(TG.sleep); },
    isBusy() { return layers.busy(); },
    headWorldPosition(out = new THREE.Vector3()) {
      hc.updateWorldMatrix(true, false);
      hc.getWorldPosition(out);
      out.y += parts.headTop * group.getWorldScale(_v2).y;
      return out;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      kit.dispose();
    },
  };
  update(0);
  return api;
}
