// Track pieces: path generation, meshes, colliders and moving devices.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { SweepCollider, RevolveCollider, BoxCollider, CylinderCollider, SphereCollider, RotorBody, SURFACES, seg, arc, polyline, roomClearance } from './physics.js';
import * as TX from './textures.js';

export const RC = 0.016;   // inner radius of the channel
export const TH = 0.0035;  // wall thickness
export const WALL = 0.006; // wall top above centerline
const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

export const COLORS = {
  wood: '#e0b97f', red: '#ff5d5d', orange: '#ff9f43', yellow: '#ffd23f', green: '#3ccf7a',
  teal: '#2ec4b6', blue: '#4c8dff', purple: '#9b6bff', pink: '#ff77b7', white: '#f4f1ea',
};
export const RAINBOW = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

export const heading = (psi, out = V()) => out.set(Math.cos(psi), 0, -Math.sin(psi));
export const leftOf = (psi, out = V()) => out.set(-Math.sin(psi), 0, -Math.cos(psi));
export const dirOf = (psi, phi, out = V()) => { const c = Math.cos(phi); return out.set(Math.cos(psi) * c, -Math.sin(phi), -Math.sin(psi) * c); };
const ease = (t) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const lerpE = (a, b, t) => a + (b - a) * ease(t);
const normAng = (a) => { a %= TAU; if (a > PI) a -= TAU; if (a < -PI) a += TAU; return a; };

export class Sample { constructor(p, T, U, s) { this.p = p; this.T = T; this.U = U; this.s = s; } }

function frame(psi, phi, bank, T, U) {
  const cphi = Math.cos(phi), sphi = Math.sin(phi), cps = Math.cos(psi), sps = Math.sin(psi);
  T.set(cps * cphi, -sphi, -sps * cphi);
  U.set(cps * sphi, cphi, -sps * sphi);
  if (bank) {
    const R = V().crossVectors(T, U);
    U.multiplyScalar(Math.cos(bank)).addScaledVector(R, Math.sin(bank));
  }
}

// integrates a centerline from yaw/pitch/bank functions of arc length
function turtle(p0, L, fn, s0 = 0) {
  const steps = Math.max(8, Math.ceil(L / 0.001)), ds = L / steps;
  const every = Math.max(1, Math.round(0.008 / ds));
  const p = p0.clone(), T = V(), U = V(), out = [];
  let st = fn(0);
  frame(st.psi, st.phi, st.bank || 0, T, U);
  out.push(new Sample(p.clone(), T.clone(), U.clone(), s0));
  for (let k = 0; k < steps; k++) {
    st = fn((k + 0.5) * ds);
    frame(st.psi, st.phi, st.bank || 0, T, U);
    p.addScaledVector(T, ds);
    if ((k + 1) % every === 0 || k === steps - 1) {
      st = fn((k + 1) * ds);
      frame(st.psi, st.phi, st.bank || 0, T, U);
      out.push(new Sample(p.clone(), T.clone(), U.clone(), s0 + (k + 1) * ds));
    }
  }
  return out;
}
function join(a, b) { for (let i = 1; i < b.length; i++) a.push(b[i]); return a; }
const last = (s) => s[s.length - 1];
const endPort = (s, psi, phi) => ({ p: last(s).p.clone(), psi: normAng(psi), phi });
export const portFromData = (q) => ({ p: V(q.x, q.y, q.z), psi: q.psi, phi: q.phi || 0 });
export const portToData = (q) => ({ x: +q.p.x.toFixed(5), y: +q.p.y.toFixed(5), z: +q.p.z.toFixed(5), psi: +q.psi.toFixed(5), phi: +(q.phi || 0).toFixed(5) });

// resample a parametric curve by arc length, frames from its tangent (no bank)
function curveSamples(fn, N = 600, step = 0.007) {
  const pts = [];
  for (let i = 0; i <= N; i++) pts.push(fn(i / N));
  const out = [];
  let acc = 0, s = 0;
  const pushAt = (i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N, i + 1)];
    const T = b.clone().sub(a).normalize();
    const psi = Math.atan2(-T.z, T.x), phi = Math.asin(Math.max(-1, Math.min(1, -T.y)));
    const TT = V(), U = V();
    frame(psi, phi, 0, TT, U);
    out.push(new Sample(pts[i].clone(), T, U, s));
  };
  pushAt(0);
  for (let i = 1; i <= N; i++) {
    const d = pts[i].distanceTo(pts[i - 1]);
    acc += d; s += d;
    if (acc >= step || i === N) { pushAt(i); acc = 0; }
  }
  return out;
}

// ---------------------------------------------------------------- profiles
function arcPts(R, a0, a1, n, inward) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n, c = Math.cos(a), s = Math.sin(a);
    out.push([c * R, s * R, inward ? -c : c, inward ? -s : s]);
  }
  return out;
}
const PROFILES = {};
// a round bead along the top of each wall — the chunky rim of a toy track
const RB = 0.0027;
const bead = (cx, side) => ({ side, pts: arcPts(RB, 0, TAU, 12, false).map(([u, v, nu, nv]) => [u + cx, v + WALL, nu, nv]) });
const beadCap = (cx) => arcPts(RB, 0, TAU, 12, false).slice(0, -1).map(([u, v]) => [u + cx, v + WALL]);
function makeChannel() {
  const Ro = RC + TH, bx = RC + TH / 2;
  const prims = [
    arc(0, 0, RC, PI, TAU, { side: 0 }),
    seg(-RC, 0, -RC, WALL, { side: -1 }), seg(RC, 0, RC, WALL, { side: 1 }),
    arc(-bx, WALL, RB, 0, TAU, { side: -1 }), arc(bx, WALL, RB, 0, TAU, { side: 1 }),
    seg(-Ro, 0, -Ro, WALL, { side: -1 }), seg(Ro, 0, Ro, WALL, { side: 1 }),
    arc(0, 0, Ro, PI, TAU, { side: 0 }),
  ];
  const strips = [
    { side: -1, pts: [[-RC, WALL, 1, 0], [-RC, 0, 1, 0]] },
    { side: 0, pts: arcPts(RC, PI, TAU, 16, true) },
    { side: 1, pts: [[RC, 0, -1, 0], [RC, WALL, -1, 0]] },
    bead(-bx, -1), bead(bx, 1),
    { side: 1, pts: [[Ro, WALL, 1, 0], [Ro, 0, 1, 0]] },
    { side: 0, pts: arcPts(Ro, TAU, PI, 16, false) },
    { side: -1, pts: [[-Ro, 0, -1, 0], [-Ro, WALL, -1, 0]] },
  ];
  const cap = [[-Ro, WALL], [-RC, WALL], ...arcPts(RC, PI, TAU, 16, true).map(p => [p[0], p[1]]), [RC, WALL], [Ro, WALL], ...arcPts(Ro, TAU, PI, 16, false).map(p => [p[0], p[1]])];
  return { prims, strips, cap, capExtra: [beadCap(-bx), beadCap(bx)] };
}
function makeTube() {
  const Ro = RC + TH;
  return {
    prims: [arc(0, 0, RC, 0, TAU, { side: 0 }), arc(0, 0, Ro, 0, TAU, { side: 0 })],
    strips: [{ side: 0, pts: arcPts(RC, 0, TAU, 24, true) }, { side: 0, pts: arcPts(Ro, TAU, 0, 24, false) }],
    capOuter: arcPts(Ro, 0, TAU, 24, false).slice(0, -1).map(p => [p[0], p[1]]),
    capInner: arcPts(RC, 0, TAU, 24, false).slice(0, -1).map(p => [p[0], p[1]]),
  };
}
function makeFlat() {
  const Ro = RC + TH, F = -RC;
  const prims = [
    seg(-RC, F, RC, F, { side: 0 }), seg(-RC, F, -RC, WALL, { side: -1 }), seg(RC, F, RC, WALL, { side: 1 }),
    seg(-Ro, WALL, -RC, WALL, { side: -1 }), seg(RC, WALL, Ro, WALL, { side: 1 }),
    seg(-Ro, F - TH, -Ro, WALL, { side: -1 }), seg(Ro, F - TH, Ro, WALL, { side: 1 }), seg(-Ro, F - TH, Ro, F - TH, { side: 0 }),
  ];
  const strips = [
    { side: -1, pts: [[-RC, WALL, 1, 0], [-RC, F, 1, 0]] },
    { side: 0, pts: [[-RC, F, 0, 1], [RC, F, 0, 1]] },
    { side: 1, pts: [[RC, F, -1, 0], [RC, WALL, -1, 0]] },
    { side: -1, pts: [[-Ro, WALL, 0, 1], [-RC, WALL, 0, 1]] },
    { side: 1, pts: [[RC, WALL, 0, 1], [Ro, WALL, 0, 1]] },
    { side: 1, pts: [[Ro, WALL, 1, 0], [Ro, F - TH, 1, 0]] },
    { side: 0, pts: [[Ro, F - TH, 0, -1], [-Ro, F - TH, 0, -1]] },
    { side: -1, pts: [[-Ro, F - TH, -1, 0], [-Ro, WALL, -1, 0]] },
  ];
  const cap = [[-Ro, WALL], [-RC, WALL], [-RC, F], [RC, F], [RC, WALL], [Ro, WALL], [Ro, F - TH], [-Ro, F - TH]];
  return { prims, strips, cap };
}
// laser-cut plywood: flat floor, tall side plates with cut-outs (mat 1 = plate texture with holes)
function makePly() {
  const Ro = RC + 0.003, F = -RC, B = F - 0.004, Wt = 0.02;
  const prims = [
    seg(-RC, F, RC, F, { side: 0 }), seg(-RC, F, -RC, Wt, { side: -1 }), seg(RC, F, RC, Wt, { side: 1 }),
    seg(-Ro, Wt, -RC, Wt, { side: -1 }), seg(RC, Wt, Ro, Wt, { side: 1 }),
    seg(-Ro, B, -Ro, Wt, { side: -1 }), seg(Ro, B, Ro, Wt, { side: 1 }), seg(-Ro, B, Ro, B, { side: 0 }),
  ];
  const strips = [
    { side: 0, pts: [[-RC, F, 0, 1], [RC, F, 0, 1]] },
    { side: 0, pts: [[Ro, B, 0, -1], [-Ro, B, 0, -1]] },
    { side: -1, mat: 1, vh: [B, Wt], pts: [[-RC, Wt, 1, 0], [-RC, F, 1, 0]] },
    { side: -1, mat: 1, vh: [B, Wt], pts: [[-Ro, B, -1, 0], [-Ro, Wt, -1, 0]] },
    { side: 1, mat: 1, vh: [B, Wt], pts: [[RC, F, -1, 0], [RC, Wt, -1, 0]] },
    { side: 1, mat: 1, vh: [B, Wt], pts: [[Ro, Wt, 1, 0], [Ro, B, 1, 0]] },
    { side: -1, pts: [[-Ro, Wt, 0, 1], [-RC, Wt, 0, 1]] },
    { side: 1, pts: [[RC, Wt, 0, 1], [Ro, Wt, 0, 1]] },
  ];
  const cap = [[-Ro, Wt], [-RC, Wt], [-RC, F], [RC, F], [RC, Wt], [Ro, Wt], [Ro, B], [-Ro, B]];
  return { prims, strips, cap };
}
// roller-coaster rails: two running rails under the ball and two guard rails beside it
function makeRails() {
  const a = 0.007, rr = 0.0025, vr = -0.0164, ga = 0.017, gv = -0.003;
  const ring = (cx, cy) => ({ side: Math.sign(cx), pts: arcPts(rr, 0, TAU, 8, false).map(([u, v, nu, nv]) => [u + cx, v + cy, nu, nv]) });
  return {
    prims: [arc(-a, vr, rr, 0, TAU, { side: -1 }), arc(a, vr, rr, 0, TAU, { side: 1 }), arc(-ga, gv, rr, 0, TAU, { side: -1 }), arc(ga, gv, rr, 0, TAU, { side: 1 })],
    strips: [ring(-a, vr), ring(a, vr), ring(-ga, gv), ring(ga, gv)],
    rails: { a, rr, vr, ga, gv },
  };
}
// visual only: the arch of a tunnel
function makeArch() {
  const R1 = 0.036, R2 = 0.042, cy = -0.014, a0 = -0.15, a1 = PI + 0.15;
  return {
    prims: [],
    strips: [{ side: 0, pts: arcPts(R1, a1, a0, 20, true).map(([u, v, nu, nv]) => [u, v + cy, nu, nv]) }, { side: 0, pts: arcPts(R2, a0, a1, 20, false).map(([u, v, nu, nv]) => [u, v + cy, nu, nv]) }],
  };
}
PROFILES.channel = makeChannel();
PROFILES.tube = makeTube();
PROFILES.flat = makeFlat();
PROFILES.ply = makePly();
PROFILES.rails = makeRails();
PROFILES.arch = makeArch();
export const STYLES = ['channel', 'tube', 'ply', 'rails'];

// copy of profile prims with one side switched off before arc length s0 (used by the switch's Y split)
// side 1 or -1 opens that wall from s0 on; side 2 opens both
const cutsSide = (cut, side) => cut.side === 2 ? !!side : side === cut.side;
function cutPrims(prims, side, s0) {
  return prims.map(p => (side && cutsSide({ side }, p.side)) ? Object.assign({}, p, { s0, s1: Infinity }) : p);
}

// ---------------------------------------------------------------- geometry
function sweepGeometry(samples, profile, cut) {
  const pos = [], nor = [], uv = [], idxBy = [[], []];
  let idx = idxBy[0];
  const R = V();
  for (const st of profile.strips) {
    const list = (cut && cutsSide(cut, st.side)) ? samples.filter(s => s.s >= cut.s0) : samples;
    if (list.length < 2) continue;
    const pts = st.pts, np = pts.length;
    const per = [0];
    for (let k = 1; k < np; k++) per.push(per[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    const base = pos.length / 3;
    for (const sm of list) {
      R.crossVectors(sm.T, sm.U);
      for (let k = 0; k < np; k++) {
        const [u, v, nu, nv] = pts[k];
        pos.push(sm.p.x + R.x * u + sm.U.x * v, sm.p.y + R.y * u + sm.U.y * v, sm.p.z + R.z * u + sm.U.z * v);
        nor.push(R.x * nu + sm.U.x * nv, R.y * nu + sm.U.y * nv, R.z * nu + sm.U.z * nv);
        // plates map v by height so both faces line up (their cut-outs go right through)
        uv.push(sm.s * 5, st.vh ? (v - st.vh[0]) / (st.vh[1] - st.vh[0]) : per[k] * 25);
      }
    }
    const dx = pts[1][0] - pts[0][0], dy = pts[1][1] - pts[0][1];
    const flip = (dy * pts[0][2] - dx * pts[0][3]) < 0;
    const out = idxBy[st.mat || 0];
    for (let i = 0; i < list.length - 1; i++) for (let k = 0; k < np - 1; k++) {
      const a = base + i * np + k, b = a + np, c = a + 1, d = b + 1;
      if (!flip) out.push(a, b, c, c, b, d); else out.push(a, c, b, c, d, b);
    }
  }
  // end caps
  const capAt = (sm, sign, contour, holes = []) => {
    const all = contour.concat(...holes);
    const tris = THREE.ShapeUtils.triangulateShape(contour.map(p => new THREE.Vector2(p[0], p[1])), holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1]))));
    R.crossVectors(sm.T, sm.U);
    const base = pos.length / 3;
    for (const [u, v] of all) {
      pos.push(sm.p.x + R.x * u + sm.U.x * v, sm.p.y + R.y * u + sm.U.y * v, sm.p.z + R.z * u + sm.U.z * v);
      nor.push(sm.T.x * sign, sm.T.y * sign, sm.T.z * sign);
      uv.push(u * 20, v * 20);
    }
    for (const t of tris) {
      const [a, b, c] = t;
      const area = (all[b][0] - all[a][0]) * (all[c][1] - all[a][1]) - (all[c][0] - all[a][0]) * (all[b][1] - all[a][1]);
      // CCW in (u,v) faces -T
      if ((area > 0) === (sign < 0)) idx.push(base + a, base + b, base + c); else idx.push(base + a, base + c, base + b);
    }
  };
  if (!cut) {
    const caps = profile.cap ? [[profile.cap, []]] : profile.capOuter ? [[profile.capOuter, [profile.capInner]]] : [];
    for (const extra of profile.capExtra || []) caps.push([extra, []]);
    for (const [contour, holes] of caps) { capAt(samples[0], -1, contour, holes); capAt(last(samples), 1, contour, holes); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idxBy[0].concat(idxBy[1]));
  g.addGroup(0, idxBy[0].length, 0);
  if (idxBy[1].length) g.addGroup(idxBy[0].length, idxBy[1].length, 1);
  return g;
}

// sleepers and guard-rail posts under a rails track
function railTies(samples, prof) {
  const { a, rr, vr, ga, gv } = prof.rails;
  const geos = [], m = new THREE.Matrix4(), R = V();
  let next = 0.01;
  for (const sm of samples) {
    if (sm.s < next) continue;
    next = sm.s + 0.03;
    R.crossVectors(sm.T, sm.U);
    const tie = new THREE.BoxGeometry(0.004, 0.003, ga * 2 + 0.004);
    m.makeBasis(sm.T, sm.U, R).setPosition(sm.p.clone().addScaledVector(sm.U, vr - rr - 0.0015));
    tie.applyMatrix4(m); geos.push(tie);
    for (const sx of [-1, 1]) {
      const h = gv - (vr - rr - 0.003);
      const post = new THREE.BoxGeometry(0.003, h, 0.0025);
      m.makeBasis(sm.T, sm.U, R).setPosition(sm.p.clone().addScaledVector(R, sx * ga).addScaledVector(sm.U, gv - h / 2));
      post.applyMatrix4(m); geos.push(post);
    }
  }
  void a;
  if (!geos.length) return null;
  const g = mergeGeometries(geos);
  geos.forEach(x => x.dispose());
  return g;
}

// ---------------------------------------------------------------- materials
const matCache = new Map();
export function trackMaterial(color, style) {
  const key = color + '|' + style;
  if (matCache.has(key)) return matCache.get(key);
  let m;
  if (style === 'tube') {
    const c = new THREE.Color(COLORS[color] || '#ffffff').lerp(new THREE.Color('#ffffff'), 0.55);
    m = new THREE.MeshPhysicalMaterial({ color: c, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide });
  } else if (style === 'ply') {
    const tint = new THREE.Color(COLORS[color] || '#ffffff').lerp(new THREE.Color('#ffffff'), color === 'wood' ? 1 : 0.55);
    m = [
      new THREE.MeshStandardMaterial({ map: TX.plyTexture(), color: tint, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ map: TX.plyPlateTexture(), color: tint, roughness: 0.7, alphaTest: 0.5, side: THREE.DoubleSide }),
    ];
  } else if (style === 'rails') {
    m = new THREE.MeshStandardMaterial({ color: '#d7dbe2', metalness: 0.85, roughness: 0.25 });
  } else if (style === 'arch') {
    m = new THREE.MeshStandardMaterial({ map: TX.brickTexture(COLORS[color] || COLORS.wood), roughness: 0.85, side: THREE.DoubleSide });
  } else if (color === 'wood') {
    m = new THREE.MeshStandardMaterial({ map: TX.woodTexture('#e6c08a'), roughness: 0.55 });
  } else {
    m = new THREE.MeshPhysicalMaterial({ color: COLORS[color] || '#ffffff', roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.25 });
  }
  matCache.set(key, m);
  return m;
}
const solidMat = (color) => trackMaterial(color === 'clear' ? 'white' : color, 'solid');
const plainMat = (hex, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: hex, roughness: 0.5 }, o));
const MAT = {
  pillar: new THREE.MeshStandardMaterial({ map: TX.woodTexture('#efd3a6'), roughness: 0.6 }),
  kit: new THREE.MeshPhysicalMaterial({ color: '#f4efe6', roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4 }),
  dark: plainMat('#5b4a3a'),
  metal: plainMat('#c9ccd3', { metalness: 0.7, roughness: 0.3 }),
  red: plainMat('#ff4d5e', { roughness: 0.35 }),
  black: plainMat('#2e2e38', { roughness: 0.6 }),
  globe: new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, roughness: 0.02, clearcoat: 1, depthWrite: false }),
  acrylic: new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.16, roughness: 0.05, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide }),
  gold: new THREE.MeshStandardMaterial({ color: '#f5c242', metalness: 0.9, roughness: 0.25 }),
  white: plainMat('#fbf8f2', { roughness: 0.4 }),
  yellow: plainMat('#ffd23f', { roughness: 0.4 }),
  blue: plainMat('#4c8dff', { roughness: 0.4 }),
  orange: plainMat('#ff9f43', { roughness: 0.4 }),
  bristle: plainMat('#4a4458', { roughness: 0.95 }),
  leaf: plainMat('#4fbf6a', { roughness: 0.7 }),
  water: new THREE.MeshPhysicalMaterial({ color: '#59b8ff', transparent: true, opacity: 0.42, roughness: 0.04, clearcoat: 1, depthWrite: false }),
  lampGlow: new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffd27a', emissiveIntensity: 0.6 }),
};
// a little gear beside a switch shows which others it is linked to
function gearBadge(P, colour) {
  const g = new THREE.Mesh(gearGeometry(0.014, 8, 0.004), REMOTE_MAT[colour] || MAT.metal);
  g.rotation.x = PI / 2; g.position.copy(P.p).addScaledVector(heading(P.psi), 0.03).addScaledVector(leftOf(P.psi), RC + TH + 0.02).add(V(0, 0.012, 0));
  return g;
}
// gates, flip-flops and turnstiles worked by a remote button wear its colour
const REMOTE_MAT = { red: MAT.red, green: plainMat('#3ccf7a', { roughness: 0.4 }), blue: MAT.blue };
export const SENSOR_COLORS = { confetti: '#ff77b7', lights: '#ffd23f', cheer: '#3ccf7a', music: '#9b6bff', gate: '#4c8dff', count: '#9b6bff' };
const PENNANT = new THREE.BufferGeometry().setFromPoints([V(-0.013, 0, 0), V(0.013, 0, 0), V(0, -0.034, 0)]);
PENNANT.computeVertexNormals(); PENNANT.userData.shared = true;
const PINBLADE = new THREE.BufferGeometry().setFromPoints([V(0, 0, 0), V(0.032, 0.004, 0.006), V(0.01, 0.03, 0.002)]);
PINBLADE.computeVertexNormals(); PINBLADE.userData.shared = true;
let BLOCK_GEO = null;
const blockGeo = (bs) => { if (!BLOCK_GEO) { BLOCK_GEO = new THREE.BoxGeometry(bs * 0.985, bs * 0.985, bs * 0.985); BLOCK_GEO.userData.shared = true; } return BLOCK_GEO; };
const blockMat = (ch, col) => {
  const key = 'block|' + ch + col;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ map: TX.blockTexture(ch, col), roughness: 0.5 }));
  return matCache.get(key);
};
// the track sample nearest to arc length x
const sampleAt = (s, x) => s.reduce((a, c) => Math.abs(c.s - x) < Math.abs(a.s - x) ? c : a);

// ---------------------------------------------------------------- gear mesh (for the lift)
const gearCache = new Map();
function gearGeometry(R, teeth, depth) {
  const key = R + '|' + teeth + '|' + depth;
  if (gearCache.has(key)) return gearCache.get(key);
  const sh = new THREE.Shape();
  const Rr = R * 0.84, n = teeth;
  for (let i = 0; i < n; i++) {
    const a0 = i / n * TAU, a1 = (i + 0.25) / n * TAU, a2 = (i + 0.5) / n * TAU, a3 = (i + 0.75) / n * TAU;
    const P = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
    const p0 = P(a0, Rr), p1 = P(a1, R), p2 = P(a2, R), p3 = P(a3, Rr);
    if (i === 0) sh.moveTo(...p0); else sh.lineTo(...p0);
    sh.lineTo(...p1); sh.lineTo(...p2); sh.lineTo(...p3);
  }
  sh.closePath();
  const holes = Math.max(3, Math.round(teeth / 4));
  for (let i = 0; i < holes; i++) {
    const a = i / holes * TAU, h = new THREE.Path();
    h.absarc(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, R * 0.17, 0, TAU, true);
    sh.holes.push(h);
  }
  const ax = new THREE.Path(); ax.absarc(0, 0, R * 0.09, 0, TAU, true); sh.holes.push(ax);
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  g.userData.shared = true;
  gearCache.set(key, g);
  return g;
}
// a toothed ring (open in the middle so you can see the balls inside the water-wheel)
function gearRingGeometry(R, Ri, teeth, depth) {
  const key = 'ring' + R + '|' + Ri + '|' + teeth;
  if (gearCache.has(key)) return gearCache.get(key);
  const sh = new THREE.Shape(), Rr = R * 0.93;
  for (let i = 0; i < teeth; i++) {
    const P = (f, r) => [Math.cos((i + f) / teeth * TAU) * r, Math.sin((i + f) / teeth * TAU) * r];
    if (i === 0) sh.moveTo(...P(0, Rr)); else sh.lineTo(...P(0, Rr));
    sh.lineTo(...P(0.25, R)); sh.lineTo(...P(0.5, R)); sh.lineTo(...P(0.75, Rr));
  }
  sh.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, Ri, 0, TAU, true); sh.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 24 });
  g.translate(0, 0, -depth / 2);
  g.userData.shared = true;
  gearCache.set(key, g);
  return g;
}

// ---------------------------------------------------------------- devices
export class SwitchDevice {
  // n ways: the flip-flop has two, the turnstile three
  constructor(inP, n = 2) { this.inP = inP; this.n = n; this.flipper = null; this.angle = 0; this.branches = []; }
  initState() { return { next: 0, assign: new Map(), tick: 0 }; }
  allow(world, b, idx) {
    const st = world.devState(this);
    let a = st.assign.get(b.id);
    if (!a || world.time - a.t > 0.4) {
      const ds = this.branches.length === this.n ? this.branches.map(c => Math.sqrt(c.nearest({ i: -1 }, b.pos.x, b.pos.y, b.pos.z))) : [0];
      const lo = Math.min(...ds);
      if (Math.max(...ds) - lo < 0.004) {
        // a ball arriving at the entrance takes the flipper's side, then the flipper moves on
        // (one steered by a remote button stays put until its button is pressed)
        a = { idx: st.next, t: world.time };
        if (!this.remote) {
          st.next = (st.next + 1) % this.n; world.emit('switch', this, a.idx);
          // linked by gears: every switch with the same gear colour moves on with it
          if (this.link) for (const d of world.devices) if (d !== this && d.link === this.link && d instanceof SwitchDevice) { const o = world.devState(d); o.next = (o.next + 1) % d.n; }
        }
      } else {
        // a ball coming back (or dropped in) belongs to the branch it is actually on
        a = { idx: ds.indexOf(lo), t: world.time };
      }
      st.assign.set(b.id, a);
    }
    a.t = world.time;
    return a.idx === idx;
  }
  step(world) {
    const st = world.devState(this);
    if ((++st.tick & 1023) === 0) for (const [k, a] of st.assign) if (world.time - a.t > 2) st.assign.delete(k);
  }
  update(world, dt) {
    if (!this.flipper) return;
    const next = world.devState(this).next, target = this.n === 3 ? [0.38, 0, -0.38][next] : next ? -0.32 : 0.32;
    this.angle += (target - this.angle) * Math.min(1, dt * 18);
    this.flipper.rotation.y = this.angle;
  }
}

// The music box: a drum with pegs in four lanes turns once every 16 steps; each peg drops a ball
// down its lane's chute and plucks that lane's note. It plays two turns each time it is started.
export const LANE_NOTES = [0, 2, 4, 7]; // C, E, G and high C on the xylophone's scale
export class MusicBoxDevice {
  constructor(o) { Object.assign(this, o); this.drum = null; } // pattern [4 × 16-bit], bpm, spawns
  initState() { return { playing: false, t0: 0, step: -1 }; }
  get stepDur() { return 30 / this.bpm; } // two steps to a beat
  play(world) { Object.assign(world.devState(this), { playing: true, t0: world.time, step: -1 }); }
  // the lanes whose pegs came round since last asked
  due(world) {
    const st = world.devState(this);
    if (!st.playing) return [];
    const k = Math.floor((world.time - st.t0) / this.stepDur), out = [];
    for (let s = st.step + 1; s <= Math.min(k, 31); s++) for (let l = 0; l < 4; l++) if (this.pattern[l] >> (s % 16) & 1) out.push(l);
    st.step = k;
    if (k >= 31) st.playing = false;
    return out;
  }
  update(world) {
    if (!this.drum) return;
    const st = world.devState(this);
    // peg s comes round to the top just as its step plays
    const turn = st.playing ? (world.time - st.t0) / (this.stepDur * 16) : 0;
    this.drum.rotation.z = turn * TAU;
  }
}

// the plinko board's bins: a ball that comes to rest in one scores its points
export class PlinkoDevice {
  constructor(o, psi, pitch, pts, yB) { this.o = o; this.h = heading(psi); this.S = leftOf(psi); this.pitch = pitch; this.pts = pts; this.yB = yB; }
  initState() { return { timers: new Map() }; }
  step(world, dt) {
    const st = world.devState(this), W = this.pitch * this.pts.length;
    for (const b of world.balls) {
      if (b.captured || b.dead || b.collected) continue;
      const dx = b.pos.x - this.o.x, dz = b.pos.z - this.o.z, u = dx * this.h.x + dz * this.h.z;
      if (u > 0 && u < W && Math.abs(dx * this.S.x + dz * this.S.z) < 0.02 && b.pos.y < this.yB + 0.04 && b.pos.y > this.yB - 0.01 && b.vel.lengthSq() < 0.04) {
        const t = (st.timers.get(b.id) || 0) + dt;
        if (t > 0.3) { b.collected = true; b.plinko = this.pts[Math.min(this.pts.length - 1, Math.floor(u / this.pitch))]; st.timers.delete(b.id); world.emit('goal', this, b); }
        else st.timers.set(b.id, t);
      }
    }
  }
}

export class GoalDevice {
  constructor(center, R, yB, yTop) { this.c = center; this.R = R; this.yB = yB; this.yTop = yTop; this.label = null; this.shown = -1; }
  initState() { return { count: 0, timers: new Map() }; }
  step(world, dt) {
    const st = world.devState(this), R2 = this.R * this.R;
    for (const b of world.balls) {
      if (b.captured || b.dead || b.collected) continue;
      const dx = b.pos.x - this.c.x, dz = b.pos.z - this.c.z;
      if (dx * dx + dz * dz < R2 && b.pos.y < this.yTop + 0.004 && b.pos.y > this.yB - 0.01 && b.vel.lengthSq() < 0.09) {
        const t = (st.timers.get(b.id) || 0) + dt;
        if (t > 0.25) { b.collected = true; st.count++; st.timers.delete(b.id); world.emit('goal', this, b); }
        else st.timers.set(b.id, t);
      }
    }
  }
  update(world) {
    const n = world.devState(this).count;
    if (this.label && n !== this.shown) {
      this.shown = n;
      // the score badge only appears once the cup has caught something
      this.label.visible = n > 0;
      if (n > 0) {
        this.label.material.map = TX.badgeTexture(String(n), '#ffb300');
        this.label.material.needsUpdate = true;
      }
    }
  }
}

export class LiftDevice {
  constructor(o) {
    Object.assign(this, o); // Pk, h (heading), side, H, speed, rs, exitPos, exitDir
    this.Lc = 2 * this.H + TAU * this.rs;
    this.N = Math.max(4, Math.round(this.Lc / 0.075));
    this.sp = this.Lc / this.N;
    this.F = this.Pk.clone().addScaledVector(this.h, 0.016);
    this.links = null; this.scoops = null; this.gears = [];
  }
  initState() { return { carried: new Map() }; }
  // point on the chain loop, its tangent and outward normal (in the h/up plane)
  chain(c, P, T, N) {
    const H = this.H, rs = this.rs, h = this.h, top = H + PI * rs, back = top + H;
    c = ((c % this.Lc) + this.Lc) % this.Lc;
    const F = this.F;
    if (c < H) { P.copy(F).addScaledVector(UP, c); T.copy(UP); N.copy(h).negate(); }
    else if (c < top) {
      const a = (c - H) / rs; // 0..π, from front over the top to the back
      const C = F.clone().addScaledVector(h, rs).addScaledVector(UP, H);
      N.copy(h).multiplyScalar(-Math.cos(a)).addScaledVector(UP, Math.sin(a));
      P.copy(C).addScaledVector(N, rs);
      T.copy(h).multiplyScalar(Math.sin(a)).addScaledVector(UP, Math.cos(a));
    } else if (c < back) { P.copy(F).addScaledVector(h, 2 * rs).addScaledVector(UP, H - (c - top)); T.copy(UP).negate(); N.copy(h); }
    else {
      const a = (c - back) / rs;
      const C = F.clone().addScaledVector(h, rs);
      N.copy(h).multiplyScalar(Math.cos(a)).addScaledVector(UP, -Math.sin(a));
      P.copy(C).addScaledVector(N, rs);
      T.copy(h).multiplyScalar(-Math.sin(a)).addScaledVector(UP, -Math.cos(a));
    }
  }
  step(world, dt) {
    const st = world.devState(this);
    const ph0 = world.time * this.speed, ph1 = ph0 + this.speed * dt, Lc = this.Lc, sp = this.sp;
    for (let i = 0; i < this.N; i++) {
      if (st.carried.has(i)) continue;
      if (Math.floor((ph1 + i * sp) / Lc) > Math.floor((ph0 + i * sp) / Lc)) {
        let best = null, bd = 0.04 * 0.04;
        for (const b of world.balls) {
          if (b.captured || b.dead || b.collected) continue;
          const d = b.pos.distanceToSquared(this.Pk);
          if (d < bd && b.vel.lengthSq() < 0.8) { bd = d; best = b; }
        }
        if (best) { best.captured = { dev: this, i }; st.carried.set(i, best); world.emit('lift', this, best); }
      }
    }
    for (const [i, b] of st.carried) {
      if (b.dead || b.collected) { st.carried.delete(i); continue; }
      const c = (ph1 + i * sp) % Lc;
      if (c >= this.H) {
        b.captured = null; b.cache.clear();
        b.pos.copy(this.exitPos); b.vel.copy(this.exitDir).multiplyScalar(0.22); b.w.set(0, 0, 0);
        world.refreshCandidates(b, 0.05);
        st.carried.delete(i);
        world.emit('liftdrop', this, b);
      } else {
        b.pos.copy(this.Pk).addScaledVector(UP, c + 0.001);
        b.vel.set(0, this.speed, 0); b.w.multiplyScalar(0.98);
      }
    }
  }
  update(world) {
    const ph = world.time * this.speed;
    const P = V(), T = V(), N = V(), S = V().crossVectors(this.h, UP).normalize(), m = new THREE.Matrix4(), X = V();
    if (this.links) {
      const n = this.links.count, ls = this.Lc / n;
      for (let j = 0; j < n; j++) {
        this.chain(ph + j * ls, P, T, N);
        X.crossVectors(S, T);
        m.makeBasis(S, T, X).setPosition(P);
        this.links.setMatrixAt(j, m);
      }
      this.links.instanceMatrix.needsUpdate = true;
    }
    if (this.scoops) {
      for (let i = 0; i < this.N; i++) {
        this.chain(ph + i * this.sp, P, T, N);
        P.addScaledVector(N, 0.016).addScaledVector(T, -0.0135);
        X.crossVectors(S, T);
        m.makeBasis(S, T, X).setPosition(P);
        this.scoops.setMatrixAt(i, m);
      }
      this.scoops.instanceMatrix.needsUpdate = true;
    }
    for (const g of this.gears) g.mesh.rotation.z = g.dir * ph / g.r;
  }
}

// a row of dominoes: each one is a RotorBody hinged at its front edge; when one lands on the
// next it hands over its spin
export class DominoRow {
  constructor(bodies) { this.bodies = bodies; }
  initState() { return { done: [], all: false }; }
  step(world) {
    const st = world.devState(this), bs = this.bodies;
    for (let i = 0; i < bs.length; i++) {
      const s = world.devState(bs[i]);
      if (s.hitW && !st.done[i]) {
        st.done[i] = true;
        world.emit('domino', this, i, -s.hitW);
        if (i + 1 < bs.length) world.devState(bs[i + 1]).w += s.hitW * 0.8;
      }
      s.hitW = 0;
    }
    if (!st.all && bs.every(b => world.devState(b).th < -0.35)) { st.all = true; world.emit('dominoes', this); }
  }
  reset(world) { world.state.delete(this); for (const b of this.bodies) world.state.delete(b); }
}

export class BellDevice {
  constructor(size) { this.size = size; this.holder = null; this.t = 10; this.amp = 0; }
  ring(v) { this.t = 0; this.amp = Math.min(0.35, 0.08 + v * 0.12); }
  update(world, dt) {
    this.t += dt;
    if (this.holder) this.holder.rotation.z = Math.sin(this.t * 22) * this.amp * Math.exp(-this.t * 3);
  }
}

export class BumperDevice {
  constructor() { this.cap = null; this.t = 10; }
  flash() { this.t = 0; }
  update(world, dt) {
    this.t += dt;
    if (this.cap) { const k = Math.exp(-this.t * 7); this.cap.material.emissiveIntensity = 0.2 + k * 2.5; this.cap.scale.setScalar(1 + k * 0.15); }
  }
}

export class TrampolineDevice {
  constructor() { this.pad = null; this.t = 10; }
  bounce() { this.t = 0; }
  update(world, dt) {
    this.t += dt;
    if (this.pad) this.pad.position.y = -0.0015 - Math.exp(-this.t * 8) * Math.abs(Math.sin(this.t * 40)) * 0.008;
  }
}


// ---------------------------------------------------------------- gadgets
// the ball is touching this sweep right now (its contact time is this very substep)
const onCol = (world, b, col, slack = 0.002) => !b.captured && !b.dead && !b.collected && b.tkCol === col && world.time - b.tkT < slack;

// soft brushes on both walls: a fast ball is combed down to the set speed, a slow one passes
export class BrakeDevice {
  constructor(vmax) { this.vmax = vmax; this.col = null; }
  step(world, dt) {
    for (const b of world.balls) {
      if (!onCol(world, b, this.col)) continue;
      const sp = b.vel.length();
      if (sp <= this.vmax) continue;
      const k = Math.max(this.vmax / sp, 1 / (1 + 14 * dt));
      b.vel.multiplyScalar(k); b.w.multiplyScalar(k);
      const st = world.devState(this);
      if (world.time - (st.last ?? -9) > 0.3) { st.last = world.time; world.emit('brush', this, b, sp); }
    }
  }
}

// a spring kicker (no magnets): a paddle snaps forward and gives the ball its speed back
export class BoosterDevice {
  constructor(v, s0, s1, T) { this.v = v; this.s0 = s0; this.s1 = s1; this.T = T; this.col = null; this.paddle = null; this.rest = null; }
  initState() { return { kicked: new Map(), last: -9 }; }
  step(world) {
    const st = world.devState(this);
    for (const b of world.balls) {
      if (!onCol(world, b, this.col) || b.tkS < this.s0 || b.tkS > this.s1) continue;
      if (world.time - (st.kicked.get(b.id) ?? -9) < 0.6) continue;
      const along = b.vel.dot(this.T);
      if (along >= this.v) continue;
      b.vel.addScaledVector(this.T, this.v - along);
      st.kicked.set(b.id, world.time); st.last = world.time;
      if (st.kicked.size > 200) st.kicked.clear();
      world.emit('boost', this, b);
    }
  }
  update(world) {
    if (!this.paddle) return;
    const k = Math.exp(-(world.time - world.devState(this).last) * 9);
    this.paddle.position.copy(this.rest).addScaledVector(this.T, 0.03 * k);
  }
}

// a gate that holds balls: opens every few seconds (or when a sensor says so) to let one through
class GateCollider extends BoxCollider {
  constructor(gate, ...a) { super(...a); this.gate = gate; }
  collide(b, world) { if (world && world.devState(this.gate).open) return; super.collide(b); }
}
export class GateDevice {
  constructor(o) { Object.assign(this, o); this.col = null; this.flap = null; } // mode, interval, sHold
  initState() { return { open: false, tOpen: -9, last: -9, trigger: false, angle: 0 }; }
  step(world) {
    const st = world.devState(this), now = world.time;
    if (st.open) { if (now - st.tOpen > 0.3) st.open = false; return; }
    let waiting = false;
    for (const b of world.balls) if (onCol(world, b, this.col, 0.01) && b.tkS > this.sHold - 0.05) { waiting = true; break; }
    if (!waiting) return;
    // a button gate opens only if its button was pressed in the last 0.6 s
    const go = this.remote ? now - (st.pressed ?? -9) < 0.6 : this.mode === 'sensor' ? st.trigger : now - st.last > this.interval;
    if (!go) return;
    st.trigger = false; st.open = true; st.tOpen = now; st.last = now;
    world.emit('gate', this);
  }
  update(world, dt) {
    if (!this.flap) return;
    const st = world.devState(this);
    st.angle += ((st.open ? 1.4 : 0) - st.angle) * Math.min(1, dt * 18);
    this.flap.rotation.z = st.angle;
  }
}

// fires when a ball rolls past its middle: sensors trigger toys and gates, the photo booth snaps
export class SensorDevice {
  constructor(o) { Object.assign(this, o); this.col = null; this.led = null; } // sMid, effect, kind ('sensor' | 'photo')
  initState() { return { seen: new Map(), last: -9 }; }
  step(world) {
    const st = world.devState(this);
    for (const b of world.balls) {
      if (!onCol(world, b, this.col, 0.02)) continue;
      const prev = st.seen.get(b.id);
      st.seen.set(b.id, b.tkS);
      if (prev === undefined || prev >= this.sMid || b.tkS < this.sMid) continue;
      st.last = world.time;
      if (this.effect === 'gate') for (const d of world.devices) if (d instanceof GateDevice && d.mode === 'sensor') world.devState(d).trigger = true;
      if (this.effect === 'count') st.count = (st.count || 0) + 1;
      world.emit(this.kind, this, b);
    }
    if (st.seen.size > 200) st.seen.clear();
  }
  update(world) {
    const st = world.devState(this);
    if (this.led) this.led.material.emissiveIntensity = 0.3 + 3 * Math.exp(-(world.time - st.last) * 5);
    if (this.label && (st.count || 0) !== this.shown) { this.shown = st.count || 0; this.label.material.map = TX.badgeTexture(String(this.shown), '#9b6bff'); this.label.material.needsUpdate = true; }
  }
}

// The hammer: a heavy pendulum held cocked back by a latch. When a ball has come to rest in the
// dip below it, the latch lets go: it swings down, whacks the ball up the ramp, and a few seconds
// later winds itself back up.
export class HammerBody extends RotorBody {
  initState() { return { th: this.th0, w: 0, hitW: 0, latched: true, still: 0, freeAt: 0 }; }
  step(world, dt) {
    const st = world.devState(this);
    if (st.latched) {
      st.th = this.th0; st.w = 0;
      // a ball sitting still in the dip trips the latch
      let waiting = false;
      for (const b of world.balls) if (!b.dead && !b.collected && b.tkCol === this.dip && world.time - b.tkT < 0.01 && b.vel.lengthSq() < 0.05 * 0.05) { waiting = true; break; }
      st.still = waiting ? st.still + dt : 0;
      if (st.still > 0.35) { st.latched = false; st.freeAt = world.time; world.emit('gate', this); }
      return;
    }
    if (world.time - st.freeAt > 2.6) {
      // wind back up, slowly, then latch again
      st.w = 0; st.th += Math.sign(this.th0 - st.th) * Math.min(Math.abs(this.th0 - st.th), 1.6 * dt);
      if (Math.abs(st.th - this.th0) < 1e-3) { st.latched = true; st.still = 0; }
      return;
    }
    super.step(world, dt);
  }
}

// the magic hat: a ball rolling past its middle is turned into the next material
export class HatDevice {
  constructor(o) { Object.assign(this, o); this.col = null; } // sMid
  initState() { return { seen: new Map() }; }
  step(world) {
    const st = world.devState(this);
    for (const b of world.balls) {
      if (!onCol(world, b, this.col, 0.02)) continue;
      const prev = st.seen.get(b.id);
      st.seen.set(b.id, b.tkS);
      if (prev !== undefined && prev < this.sMid && b.tkS >= this.sMid) world.emit('hat', this, b);
    }
    if (st.seen.size > 200) st.seen.clear();
  }
}

// Archimedes screw: the ball sits in the thread and is wound slowly upwards
export class ScrewDevice {
  constructor(o) { Object.assign(this, o); this.rotor = null; } // Pk, axis, h, S, R, H, pitch, vy, exitPos, exitDir
  initState() { return { carried: new Map() }; }
  posAt(y, out) {
    const th = Math.PI + TAU * y / this.pitch;
    return out.copy(this.axis).addScaledVector(this.h, Math.cos(th) * this.R).addScaledVector(this.S, Math.sin(th) * this.R).addScaledVector(UP, y);
  }
  step(world, dt) {
    const st = world.devState(this);
    const busy = [...st.carried.values()].some(y => y < this.pitch * 0.9);
    if (!busy) {
      for (const b of world.balls) {
        if (b.captured || b.dead || b.collected || b.pos.distanceToSquared(this.Pk) > 0.03 * 0.03 || b.vel.lengthSq() > 0.6) continue;
        b.captured = { dev: this }; st.carried.set(b, 0); world.emit('lift', this, b);
        break;
      }
    }
    for (const [b, y0] of st.carried) {
      if (b.dead || b.collected) { st.carried.delete(b); continue; }
      const y = y0 + this.vy * dt;
      if (y >= this.H) {
        b.captured = null; b.cache.clear();
        b.pos.copy(this.exitPos); b.vel.copy(this.exitDir).multiplyScalar(0.2); b.w.set(0, 0, 0);
        world.refreshCandidates(b, 0.05);
        st.carried.delete(b);
        world.emit('liftdrop', this, b);
        continue;
      }
      st.carried.set(b, y);
      this.posAt(y, b.pos);
      b.vel.set(0, this.vy, 0); b.w.multiplyScalar(0.98);
    }
  }
  update(world) { if (this.rotor) this.rotor.rotation.y = -world.time * TAU * this.vy / this.pitch; }
}

// a little cup on a pole: waits for a ball, rides up, tips it out, comes back down
export class ElevatorDevice {
  constructor(o) { Object.assign(this, o); this.cup = null; this.tip = null; } // Pk, H, h, v, exitPos, exitDir
  initState() { return { phase: 'wait', y: 0, t: 0, ball: null }; }
  step(world, dt) {
    const st = world.devState(this);
    if (st.phase === 'wait') {
      for (const b of world.balls) {
        if (b.captured || b.dead || b.collected || b.pos.distanceToSquared(this.Pk) > 0.025 * 0.025 || b.vel.lengthSq() > 0.4) continue;
        b.captured = { dev: this }; st.ball = b; st.phase = 'up'; world.emit('lift', this, b);
        break;
      }
    } else if (st.phase === 'up') {
      st.y = Math.min(this.H, st.y + this.v * dt);
      if (st.ball) { st.ball.pos.copy(this.Pk).addScaledVector(UP, st.y); st.ball.vel.set(0, this.v, 0); }
      if (st.y >= this.H) { st.phase = 'tip'; st.t = 0; }
    } else if (st.phase === 'tip') {
      st.t += dt;
      if (st.t > 0.35 && st.ball) {
        const b = st.ball; st.ball = null;
        if (!b.dead && !b.collected) {
          b.captured = null; b.cache.clear();
          b.pos.copy(this.exitPos); b.vel.copy(this.exitDir).multiplyScalar(0.25); b.w.set(0, 0, 0);
          world.refreshCandidates(b, 0.05);
          world.emit('liftdrop', this, b);
        }
      }
      if (st.t > 0.7) st.phase = 'down';
    } else {
      st.y = Math.max(0, st.y - this.v * 1.6 * dt);
      if (st.y <= 0) st.phase = 'wait';
    }
    if (st.ball && (st.ball.dead || st.ball.collected)) st.ball = null;
  }
  update(world) {
    if (!this.cup) return;
    const st = world.devState(this);
    this.cup.position.y = this.base + st.y;
    const k = st.phase === 'tip' ? Math.sin(Math.min(1, st.t / 0.35) * PI / 2) : 0;
    this.tip.rotation.z = -k * 0.9;
  }
}

export class PinwheelDevice {
  constructor() { this.rotor = null; }
  update(world, dt) { if (this.rotor) this.rotor.rotation.z += dt * 2.2; }
}

// ---------------------------------------------------------------- piece catalog
const CUP_SURF = SURFACES.plastic;

function funnelParts(B, center, yRim, Rf, inPort, side, phiOut) {
  const rhoW = Rf + RC + 0.002, rhoH = RC, D = 0.045 + Rf * 0.25;
  const k = D / (1 / rhoH - 1 / rhoW);
  const top = [];
  for (let i = 0; i <= 30; i++) { const t = i / 30, rho = rhoH + (rhoW - rhoH) * t * t; top.push([rho, -k * (1 / rho - 1 / rhoW)]); }
  const bottom = top.map(([r, h]) => [r, h - 0.004]);
  const thP = Math.atan2(-(inPort.p.z - center.z), inPort.p.x - center.x);
  const gap = side > 0 ? [thP - 1.0, thP + 0.06] : [thP - 0.06, thP + 1.0];
  const prims = [
    ...polyline(top), ...polyline(bottom), seg(rhoH, -D, rhoH, -D - 0.004),
    seg(rhoW, -0.001, rhoW, 0.022, { gap }), seg(rhoW, 0.022, rhoW + TH, 0.022, { gap }), seg(rhoW + TH, 0.022, rhoW + TH, -0.004, { gap }),
  ];
  const C = V(center.x, yRim, center.z);
  B.colliders.push(new RevolveCollider(C, UP, V(1, 0, 0), prims, SURFACES.plastic));
  // meshes
  const lathePts = [...top.map(([r, h]) => new THREE.Vector2(r, h)), new THREE.Vector2(rhoW, -0.004), ...bottom.slice().reverse().map(([r, h]) => new THREE.Vector2(r, h)), new THREE.Vector2(rhoH, -D)];
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(lathePts, 64), null);
  bowl.position.copy(C); bowl.userData.paint = 'spiral';
  const wallPts = [new THREE.Vector2(rhoW, -0.004), new THREE.Vector2(rhoW, 0.022), new THREE.Vector2(rhoW + TH, 0.022), new THREE.Vector2(rhoW + TH, -0.004)];
  const gl = gap[1] - gap[0];
  const wallM = new THREE.Mesh(new THREE.LatheGeometry(wallPts, 64, gap[1] + PI / 2, TAU - gl), null);
  wallM.position.copy(C); wallM.userData.paint = 'solid';
  B.meshes.push(bowl, wallM);
  // exit tube, straight down then bending to the exit heading
  const psi = inPort.psi, rb = 0.035, Ld = 0.03, La = (PI / 2 - phiOut) * rb, Lh = 0.03;
  const ex0 = V(center.x, yRim - D + 0.006, center.z);
  const s = turtle(ex0, Ld + La + Lh, x => ({ psi, phi: x < Ld ? PI / 2 : x < Ld + La ? PI / 2 + (x - Ld) / La * (phiOut - PI / 2) : phiOut }));
  B.paths.push({ samples: s, profile: 'tube', margin0: 0 });
  B.outs.push(endPort(s, psi, phiOut));
  // legs
  for (let i = 0; i < 3; i++) {
    const a = thP + PI / 3 + i * TAU / 3;
    B.pillarPts.push(V(center.x + Math.cos(a) * rhoW * 0.75, yRim - k * (1 / (rhoW * 0.75) - 1 / rhoW) - 0.006, center.z - Math.sin(a) * rhoW * 0.75));
  }
  // rim probes, except along the open entry gap where the incoming track lies
  B.probes = B.probes || [];
  for (let i = 0; i < 16; i++) {
    const th = i / 16 * TAU;
    let a = th - gap[0]; a -= Math.floor(a / TAU) * TAU;
    if (a < gap[1] - gap[0] + 0.3) continue;
    B.probes.push(V(C.x + Math.cos(th) * rhoW, yRim + 0.01, C.z - Math.sin(th) * rhoW));
  }
  ringProbes(B, C, rhoW * 0.6, yRim - k * (1 / (rhoW * 0.6) - 1 / rhoW), 10);
  B.radius = rhoW;
}

function cupParts(B, center, Rc, depth, yTop, surf = CUP_SURF) {
  const yB = yTop - depth;
  const prims = [seg(0, -depth, Rc, -depth), seg(Rc, -depth, Rc, 0), seg(Rc, 0, Rc + 0.004, 0), seg(Rc + 0.004, 0, Rc + 0.004, -depth - 0.005), seg(0, -depth - 0.005, Rc + 0.004, -depth - 0.005)];
  const C = V(center.x, yTop, center.z);
  B.colliders.push(new RevolveCollider(C, UP, V(1, 0, 0), prims, surf));
  const pts = [[0.0001, -depth], [Rc, -depth], [Rc, 0], [Rc + 0.004, 0], [Rc + 0.004, -depth - 0.005], [0.0001, -depth - 0.005]].map(([a, b]) => new THREE.Vector2(a, b));
  const cup = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), null);
  cup.position.copy(C); cup.userData.paint = 'solid';
  B.meshes.push(cup);
  // star sticker + counter
  const star = new THREE.Mesh(new THREE.CircleGeometry(Rc * 0.45, 5), plainMat('#ffd23f', { emissive: '#ffb000', emissiveIntensity: 0.3 }));
  star.rotation.x = -PI / 2; star.position.set(center.x, yB + 0.0008, center.z);
  B.meshes.push(star);
  const goal = new GoalDevice(V(center.x, 0, center.z), Rc, yB, yTop);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
  label.visible = false;
  label.scale.set(0.034, 0.034, 1); label.position.set(center.x, yTop + 0.045, center.z); label.renderOrder = 5;
  label.raycast = () => {};
  goal.label = label;
  B.meshes.push(label);
  B.devices.push(goal);
  B.pillarPts.push(V(center.x, yB - 0.006, center.z));
  ringProbes(B, C, Rc, yTop, 10);
  B.probes.push(V(center.x, yB, center.z));
  B.radius = Rc;
}

function addStop(B, pos, psi, along = 0.003) {
  const c = new BoxCollider(pos.x, pos.y, pos.z, along, 0.02, RC + TH, psi, SURFACES.wood);
  B.colliders.push(c);
  const m = new THREE.Mesh(new THREE.BoxGeometry(along * 2, 0.04, (RC + TH) * 2), null);
  m.position.copy(pos); m.rotation.y = psi; m.userData.paint = 'solid';
  B.meshes.push(m);
}

export const PIECES = {
  start: {
    label: 'Start Tower', kind: 'place', defaults: { height: 0.45 },
    build(d, B) {
      const base = V(d.port.x, d.port.y, d.port.z), psi = d.port.psi, H = d.opts.height;
      const top = base.clone().add(V(0, H, 0));
      const L = 0.085, phi0 = 0.95, phi1 = d.slope;
      const s = turtle(top, L, x => ({ psi, phi: phi0 + (phi1 - phi0) * (x / L) }));
      B.paths.push({ samples: s, profile: 'channel', margin0: 0.02 });
      B.outs.push(endPort(s, psi, phi1));
      const h = heading(psi);
      addStop(B, top.clone().addScaledVector(h, -0.014).add(V(0, 0.012, 0)), psi);
      B.spawn = top.clone().add(V(0, 0.04, 0)).addScaledVector(h, 0.006);
      // tower, base, globe and the big red button
      const col = d.color === 'wood' ? 'wood' : d.color;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, H - 0.02, 20), null);
      pillar.position.copy(base).add(V(0, (H - 0.02) / 2, 0)).addScaledVector(h, -0.004); pillar.userData.paint = 'solid';
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.012, 32), null);
      foot.position.copy(base).add(V(0, 0.006, 0)); foot.userData.paint = 'solid';
      const g0 = top.clone().add(V(0, 0.085, 0)).addScaledVector(h, -0.004);
      const globe = new THREE.Mesh(new THREE.SphereGeometry(0.048, 32, 20), MAT.globe);
      globe.position.copy(g0);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(RC + TH, RC + TH, 0.05, 20, 1, true), MAT.globe);
      neck.position.copy(top).add(V(0, 0.055, 0)).addScaledVector(h, 0.004);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.006, 10, 40), null);
      ring.position.copy(g0); ring.rotation.x = PI / 2; ring.userData.paint = 'solid';
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.02, 24), MAT.red);
      btn.position.copy(g0).add(V(0, 0.054, 0)); btn.userData.release = true;
      B.meshes.push(pillar, foot, globe, neck, ring, btn);
      const mcols = ['#ff5d5d', '#4c8dff', '#ffd23f', '#3ccf7a', '#9b6bff'];
      for (let i = 0; i < 5; i++) {
        const mb = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 16, 12), new THREE.MeshPhysicalMaterial({ color: mcols[i], roughness: 0.1, clearcoat: 1 }));
        mb.position.copy(g0).add(V(Math.cos(i * 2.4) * 0.022, -0.03 + (i > 2 ? 0.018 : 0), Math.sin(i * 2.4) * 0.022));
        B.meshes.push(mb);
      }
      B.releaseBtn = btn;
      B.noPillars = true;
      B.probes = [g0.clone()];
      for (let y = base.y + 0.05; y < top.y - 0.03; y += 0.05) B.probes.push(V(base.x, y, base.z));
      void col;
    },
  },
  musicbox: {
    label: 'Music Box', kind: 'place', defaults: { height: 0.12, bpm: 120, pattern: [0x0101, 0x0404, 0x1010, 0x4040] },
    build(d, B) {
      // a wooden box with a pegged drum on top and four chutes out of the front, one per note
      const base = V(d.port.x, d.port.y, d.port.z), psi = d.port.psi, h = heading(psi), S = leftOf(psi), Hb = d.opts.height;
      const W = 0.16, D = 0.1, LANE = ['#ff5d5d', '#ffd23f', '#3ccf7a', '#4c8dff'];
      const box = new THREE.Mesh(new THREE.BoxGeometry(D, Hb, W + 0.012), null);
      box.position.copy(base).add(V(0, Hb / 2, 0)); box.rotation.y = psi; box.userData.paint = 'solid';
      B.meshes.push(box);
      B.colliders.push(new BoxCollider(box.position.x, box.position.y, box.position.z, D / 2, Hb / 2, W / 2 + 0.006, psi, SURFACES.wood));
      // the drum turns about a sideways axis; its pegs show the song
      const holder = new THREE.Group(); holder.position.copy(base).add(V(0, Hb + 0.034, 0)); holder.rotation.y = psi;
      const drum = new THREE.Group(); holder.add(drum);
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, W - 0.008, 32), MAT.gold);
      cyl.rotation.x = PI / 2; drum.add(cyl);
      const pegGeos = LANE.map(() => []);
      for (let l = 0; l < 4; l++) for (let s = 0; s < 16; s++) {
        if (!(d.opts.pattern[l] >> s & 1)) continue;
        const a = s / 16 * TAU, g = new THREE.SphereGeometry(0.0045, 8, 6);
        g.translate(Math.sin(a) * 0.032, Math.cos(a) * 0.032, (l - 1.5) * 0.04); pegGeos[l].push(g);
      }
      pegGeos.forEach((gs, l) => { if (gs.length) { drum.add(new THREE.Mesh(mergeGeometries(gs), plainMat(LANE[l], { roughness: 0.35 }))); gs.forEach(g => g.dispose()); } });
      for (const sd of [-1, 1]) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 16), MAT.metal); cap.rotation.x = PI / 2; cap.position.z = sd * (W / 2); holder.add(cap); }
      B.meshes.push(holder);
      // four lanes: a stop at the back, a steep little chute out of the front
      const spawns = [];
      for (let l = 0; l < 4; l++) {
        const top = base.clone().add(V(0, Hb + 0.016, 0)).addScaledVector(h, D / 2 + 0.006).addScaledVector(S, (1.5 - l) * 0.04);
        const s = turtle(top, 0.08, x => ({ psi, phi: 0.7 + (Math.max(d.slope, 0.05) - 0.7) * (x / 0.08) }));
        B.paths.push({ samples: s, profile: 'channel', margin0: 0.02, noAuto: true });
        B.outs.push(endPort(s, psi, Math.max(d.slope, 0.05)));
        addStop(B, top.clone().addScaledVector(h, -0.014).add(V(0, 0.012, 0)), psi);
        spawns.push(top.clone().add(V(0, 0.03, 0)).addScaledVector(h, 0.006));
        const tag = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.016, 0.03), plainMat(LANE[l], { roughness: 0.4 }));
        tag.position.copy(base).add(V(0, Hb * 0.55, 0)).addScaledVector(h, D / 2 + 0.002).addScaledVector(S, (1.5 - l) * 0.04); tag.rotation.y = psi;
        B.meshes.push(tag);
      }
      const dev = new MusicBoxDevice({ pattern: d.opts.pattern, bpm: d.opts.bpm, spawns });
      dev.drum = drum;
      B.devices.push(dev);
      B.noPillars = true;
      B.probes = [];
      for (const u of [-D / 2, D / 2]) for (const v of [-W / 2, W / 2]) for (const y of [0.02, Hb]) B.probes.push(base.clone().addScaledVector(h, u).addScaledVector(S, v).add(V(0, y, 0)));
    },
  },
  straight: {
    label: 'Straight', kind: 'append', defaults: { len: 0.2 },
    build(d, B, P) {
      const L = d.opts.len, ph1 = d.slope;
      const s = turtle(P.p, L, x => ({ psi: P.psi, phi: lerpE(P.phi, ph1, x / L) }));
      B.paths.push({ samples: s, profile: d.style });
      B.outs.push(endPort(s, P.psi, ph1));
    },
  },
  curve: {
    label: 'Curve', kind: 'append', defaults: { angle: 90, radius: 0.12, dir: 1, bank: 0 },
    build(d, B, P) {
      const ang = d.opts.angle * PI / 180, R = d.opts.radius, dir = d.opts.dir, L = ang * R, ph1 = d.slope;
      // banked towards the inside of the turn, easing in and out so both ends stay level
      const bank = (d.opts.bank || 0) * PI / 180, Le = Math.min(0.05, L * 0.3);
      const s = turtle(P.p, L, x => ({ psi: P.psi + dir * ang * x / L, phi: lerpE(P.phi, ph1, x / L), bank: -dir * bank * Math.min(ease(x / Le), ease((L - x) / Le)) }));
      B.paths.push({ samples: s, profile: d.style });
      B.outs.push(endPort(s, P.psi + dir * ang, ph1));
    },
  },
  helix: {
    label: 'Spiral', kind: 'append', defaults: { turns: 1, radius: 0.11, dir: 1 },
    build(d, B, P) {
      const R = d.opts.radius, n = d.opts.turns, dir = d.opts.dir;
      const phH = Math.max(d.slope, 0.09);
      const L = TAU * R * n / Math.cos(phH), Le = Math.min(0.1, L * 0.12);
      const s = turtle(P.p, L, x => {
        const ramp = Math.min(ease(x / Le), ease((L - x) / Le));
        return { psi: P.psi + dir * TAU * n * x / L, phi: lerpE(P.phi, phH, x / Le), bank: -dir * 0.22 * ramp };
      });
      // held up like a real kit spiral: one tower in the middle with spokes out to the track
      B.paths.push({ samples: s, profile: d.style, noAuto: true });
      B.outs.push(endPort(s, P.psi + dir * TAU * n, phH));
      let cx = 0, cz = 0;
      for (const q of s) { cx += q.p.x; cz += q.p.z; }
      B.column = { x: cx / s.length, z: cz / s.length, samples: s, step: TAU * R / 3 };
    },
  },
  loop: {
    label: 'Loop', kind: 'append', defaults: { radius: 0.08 },
    build(d, B, P) {
      const R = d.opts.radius, w = 0.046;
      const a = turtle(P.p, 0.06, x => ({ psi: P.psi, phi: lerpE(P.phi, 0, x / 0.06) }));
      const L0 = last(a).p.clone(), h = heading(P.psi), rv = V().crossVectors(h, UP);
      const N = Math.ceil(TAU * R / 0.006);
      const lp = [];
      let sAcc = last(a).s, prev = L0.clone();
      for (let i = 0; i <= N; i++) {
        const th = i / N * TAU;
        const sh = w * (th - Math.sin(th)) / TAU;
        const p = L0.clone().addScaledVector(h, R * Math.sin(th)).addScaledVector(UP, R * (1 - Math.cos(th))).addScaledVector(rv, sh);
        const T = h.clone().multiplyScalar(R * Math.cos(th)).addScaledVector(UP, R * Math.sin(th)).addScaledVector(rv, w * (1 - Math.cos(th)) / TAU).normalize();
        const c = L0.clone().addScaledVector(UP, R).addScaledVector(rv, sh);
        const U = c.sub(p); U.addScaledVector(T, -U.dot(T)).normalize();
        sAcc += p.distanceTo(prev); prev = p;
        lp.push(new Sample(p, T, U, sAcc));
      }
      join(a, lp);
      const b = turtle(last(a).p, 0.06, x => ({ psi: P.psi, phi: lerpE(0, d.slope, x / 0.06) }), last(a).s);
      join(a, b);
      B.paths.push({ samples: a, profile: d.style });
      B.outs.push(endPort(a, P.psi, d.slope));
    },
  },
  drop: {
    label: 'Drop Tube', kind: 'append', defaults: { height: 0.2 },
    build(d, B, P) {
      const H = d.opts.height, rb = 0.045, ph1 = d.slope;
      const L1 = Math.max(0.01, (PI / 2 - P.phi) * rb), L2 = (PI / 2 - ph1) * rb, L = L1 + H + L2;
      const s = turtle(P.p, L, x => ({ psi: P.psi, phi: x < L1 ? P.phi + (x / L1) * (PI / 2 - P.phi) : x < L1 + H ? PI / 2 : PI / 2 + (x - L1 - H) / L2 * (ph1 - PI / 2) }));
      B.paths.push({ samples: s, profile: 'tube' });
      B.outs.push(endPort(s, P.psi, ph1));
    },
  },
  jump: {
    label: 'Jump Ramp', kind: 'append', defaults: { angle: 30 },
    build(d, B, P) {
      const L = 0.12, end = -d.opts.angle * PI / 180;
      const s = turtle(P.p, L, x => ({ psi: P.psi, phi: lerpE(P.phi, end, x / L) }));
      B.paths.push({ samples: s, profile: 'channel', margin1: 0 });
      B.outs.push(endPort(s, P.psi, end));
    },
  },
  switch: {
    label: 'Flip-Flop', kind: 'append', defaults: {},
    build(d, B, P) {
      const L = 0.18, A = 0.4, ph1 = Math.max(d.slope, 0.04);
      const dev = new SwitchDevice(P.p.clone());
      dev.remote = d.opts.remote || null; dev.link = d.opts.link || null;
      if (dev.link) B.meshes.push(gearBadge(P, dev.link));
      for (const side of [1, -1]) {
        const s = turtle(P.p, L, x => ({ psi: P.psi + side * A * Math.sin(PI * x / L), phi: lerpE(P.phi, ph1, x / L) }));
        B.paths.push({ samples: s, profile: 'channel', cut: { side: side > 0 ? 1 : -1, s0: L * 0.55 }, branchDev: dev, branchIdx: side > 0 ? 0 : 1 });
        B.outs.push(endPort(s, P.psi, ph1));
      }
      const fl = new THREE.Group();
      const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.004), dev.remote ? REMOTE_MAT[dev.remote] : MAT.red);
      paddle.position.set(0.03, 0, 0); fl.add(paddle);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.03, 12), MAT.metal);
      fl.add(pin);
      fl.position.copy(P.p).addScaledVector(heading(P.psi), 0.05).add(V(0, -0.004, 0));
      const holder = new THREE.Group(); holder.position.copy(fl.position); holder.rotation.y = P.psi; fl.position.set(0, 0, 0); holder.add(fl);
      dev.flipper = fl;
      B.meshes.push(holder);
      B.devices.push(dev);
    },
  },
  turnstile: {
    label: 'Turnstile', kind: 'append', defaults: {},
    build(d, B, P) {
      // three ways out: each ball takes the next one round (exits 9 cm apart, room to build on each)
      const L = 0.24, A = 0.62, ph1 = Math.max(d.slope, 0.04);
      const dev = new SwitchDevice(P.p.clone(), 3);
      dev.remote = d.opts.remote || null; dev.link = d.opts.link || null;
      if (dev.link) B.meshes.push(gearBadge(P, dev.link));
      for (const [side, cut, idx] of [[1, 1, 0], [0, 2, 1], [-1, -1, 2]]) {
        const s = turtle(P.p, L, x => ({ psi: P.psi + side * A * Math.sin(PI * x / L), phi: lerpE(P.phi, ph1, x / L) }));
        B.paths.push({ samples: s, profile: 'channel', cut: { side: cut, s0: L * 0.5 }, branchDev: dev, branchIdx: idx });
        B.outs.push(endPort(s, P.psi, ph1));
      }
      const fl = new THREE.Group();
      const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.004), dev.remote ? REMOTE_MAT[dev.remote] : MAT.blue);
      paddle.position.set(0.03, 0, 0); fl.add(paddle);
      fl.add(new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.03, 12), MAT.metal));
      const holder = new THREE.Group();
      holder.position.copy(P.p).addScaledVector(heading(P.psi), 0.06).add(V(0, -0.004, 0)); holder.rotation.y = P.psi; holder.add(fl);
      dev.flipper = fl;
      B.meshes.push(holder);
      B.devices.push(dev);
    },
  },
  splitter: {
    label: 'Speed Splitter', kind: 'append', defaults: { speed: 0.75 },
    build(d, B, P) {
      // a gap in the track: a fast ball flies over it and carries on, a slow one drops through
      // to the chute below. The far side sits 12 mm lower. The gap for a split at `speed` was
      // measured with the real physics: the ball's own width carries it a good part of the way.
      const drop = 0.012, G = Math.max(0.03, (d.opts.speed + 0.03) / 14.3);
      const h = heading(P.psi), La = 0.09;
      const a = turtle(P.p, La, x => ({ psi: P.psi, phi: lerpE(P.phi, 0, x / La) }));
      B.paths.push({ samples: a, profile: 'channel', margin1: 0, noAuto: true });
      const e = last(a).p, ph1 = Math.max(d.slope, 0.03), Lb = 0.1;
      const b = turtle(e.clone().addScaledVector(h, G).add(V(0, -drop, 0)), Lb, x => ({ psi: P.psi, phi: lerpE(0, ph1, x / Lb) }));
      B.paths.push({ samples: b, profile: 'channel', margin0: 0, noAuto: true });
      B.outs.push(endPort(b, P.psi, ph1));
      // the slow chute runs on under the whole gap, then turns aside on a banked bend (a ball
      // that only just missed the jump is still quick); a backstop at its start
      const back = 0.03, Ls = back + G + 0.04, R = 0.13, dir = -1, phc = 0.06, Lt = R * PI / 2;
      const c0 = e.clone().addScaledVector(h, -back).add(V(0, -0.06, 0));
      const c = turtle(c0, Ls + Lt, x => {
        const k = Math.max(0, x - Ls) / Lt;
        return { psi: P.psi + dir * k * PI / 2, phi: phc, bank: -dir * 0.5 * Math.min(ease(k / 0.3), ease((1 - k) / 0.3)) };
      });
      B.paths.push({ samples: c, profile: 'channel' });
      B.outs.push(endPort(c, P.psi + dir * PI / 2, phc));
      const stop = c0.clone().addScaledVector(h, -0.002).add(V(0, 0.004, 0));
      B.colliders.push(new BoxCollider(stop.x, stop.y, stop.z, 0.002, 0.018, RC + TH, P.psi, SURFACES.wood));
      const stopM = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.036, (RC + TH) * 2), null);
      stopM.position.copy(stop); stopM.rotation.y = P.psi; stopM.userData.paint = 'solid';
      B.meshes.push(stopM);
      B.pillarPts.push(P.p.clone().addScaledVector(h, 0.02).add(V(0, -RC - TH - 0.004, 0)), last(b).p.clone().add(V(0, -RC - TH - 0.004, 0)));
      // a little speed sign by the gap
      const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.003, 20), MAT.orange);
      sign.quaternion.setFromUnitVectors(UP, leftOf(P.psi));
      sign.position.copy(e).addScaledVector(h, G / 2).addScaledVector(leftOf(P.psi), RC + TH + 0.012).add(V(0, 0.02, 0));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.03, 8), MAT.metal);
      pole.position.copy(sign.position).add(V(0, -0.016, 0));
      B.meshes.push(sign, pole);
    },
  },
  hammer: {
    label: 'Hammer', kind: 'append', defaults: {},
    build(d, B, P) {
      // the track dips into a little felt-lined valley (a ball soon comes to rest there) and climbs
      // out up a ramp too high to roll up alone; the hammer hangs over the valley
      const h = heading(P.psi), S = V().crossVectors(h, UP).normalize();
      const a0 = 0.04, W = 0.14, up = 0.2, flat = 0.1, ph1 = Math.max(d.slope, 0.02);
      const phiAt = (x) => x < a0 ? lerpE(P.phi, 0.3, x / a0) : x < a0 + W ? 0.3 - 0.7 * (x - a0) / W : x < a0 + W + up ? -0.4 : lerpE(-0.4, ph1, (x - a0 - W - up) / flat);
      const sLow = a0 + W * 0.3 / 0.7, sSplit = sLow + 0.03;
      const s1 = turtle(P.p, sSplit, x => ({ psi: P.psi, phi: phiAt(x) }));
      const s2 = turtle(last(s1).p, a0 + W + up + flat - sSplit, x => ({ psi: P.psi, phi: phiAt(sSplit + x) }));
      const felt = { samples: s1, profile: 'channel', surf: SURFACES.soft, margin1: 0.004 };
      B.paths.push(felt, { samples: s2, profile: 'channel', margin0: 0.004 });
      B.outs.push(endPort(s2, P.psi, ph1));
      // where a ball comes to rest: the bottom of the valley
      const low = sampleAt(s1, sLow), ball = low.p.clone().addScaledVector(low.U, -(RC - 0.0115));
      const Lh = 0.14, head = 0.009;
      const pivot = ball.clone().add(V(0, Lh, 0)).addScaledVector(h, -(0.0115 + head + 0.001));
      const boxes = [{ x: 0, y: -Lh, z: 0, hu: head, hv: head, hw: RC - 0.003 }];
      const mass = 0.045; // heavy enough that even a clay ball makes it up the ramp
      const body = new HammerBody({ pivot, axis: S, e1: h, boxes, J: mass * Lh * Lh + 2e-6, mass, com: [0, -Lh], damping: 2e-5, min: -2.4, max: 1.9, th0: -2.2, bounce: 0.2, surf: SURFACES.wood });
      felt.bind = (col) => { body.dip = col; };
      B.colliders.push(body.collider); B.devices.push(body);
      // the look: a wooden mallet on a red arm, hung from a little gallows beside the track
      const holder = new THREE.Group();
      holder.position.copy(pivot);
      holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(h, UP, S));
      const arm = new THREE.Group(); holder.add(arm);
      const stick = new THREE.Mesh(new THREE.BoxGeometry(0.006, Lh, 0.006), MAT.red); stick.position.y = -Lh / 2 + 0.004; arm.add(stick);
      const mallet = new THREE.Mesh(new THREE.CylinderGeometry(head * 1.1, head * 1.1, (RC - 0.003) * 2, 20), MAT.pillar);
      mallet.rotation.x = PI / 2; mallet.position.y = -Lh; arm.add(mallet);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, (RC + TH) * 2 + 0.03, 10), MAT.metal); pin.rotation.x = PI / 2; holder.add(pin);
      for (const sd of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.008, Lh + 0.03, 0.008), null);
        post.position.set(0, -(Lh + 0.03) / 2 + 0.006, sd * (RC + TH + 0.014)); post.userData.paint = 'solid'; holder.add(post);
      }
      body.view = (th) => { arm.rotation.z = th; };
      B.meshes.push(holder);
      B.probes = [pivot.clone(), pivot.clone().addScaledVector(h, -Lh * 0.9).add(V(0, Lh * 0.3, 0))];
    },
  },
  bucket: {
    label: 'Tipping Bucket', kind: 'append', defaults: { n: 3 },
    build(d, B, P) {
      // Balls drop off the track into a bucket on a pivot. A counterweight holds it upright until about
      // n glass marbles are inside (more of the lighter ones); then it tips forward, pours them all into
      // the chute below, and swings back. Nothing is scripted: the marbles' weight does it.
      const h = heading(P.psi), S = V().crossVectors(h, UP).normalize();
      const bl = 0.03, bw = RC, H = 0.05, ux = 0.04, lip = 0.006; // half length, half width, wall height, centre ahead of the pivot, front lip
      // the track bends straight down in a short glass tube, so marbles drop gently into the back of the
      // bucket instead of flying across it
      const Rt = 0.04, Lt = Math.max(0.01, (PI / 2 - P.phi) * Rt);
      const tube = turtle(P.p, Lt, x => ({ psi: P.psi, phi: P.phi + (PI / 2 - P.phi) * x / Lt }));
      B.paths.push({ samples: tube, profile: 'tube', margin1: 0 });
      const te = last(tube).p, rBall = 0.0115;
      const pivot = te.clone().addScaledVector(h, -(ux - bl + rBall + 0.002)).add(V(0, -0.04, 0));
      // a scoop: floor, back and side walls, and only a low lip at the front, so marbles pour out over it
      // once the bucket has tipped about 40° (where it meets its stop)
      const boxes = [
        { x: ux, y: -0.012, hu: bl, hv: 0.002, hw: bw + 0.0015 },
        { x: ux - bl, y: -0.01 + H / 2, hu: 0.0015, hv: H / 2, hw: bw + 0.0015 },
        { x: ux + bl, y: -0.01 + lip / 2, hu: 0.0015, hv: lip / 2, hw: bw + 0.0015 },
        { x: ux, y: -0.01 + H / 2, z: -bw, hu: bl, hv: H / 2, hw: 0.0015 },
        { x: ux, y: -0.01 + H / 2, z: bw, hu: bl, hv: H / 2, hw: 0.0015 },
      ];
      // own weight: a light scoop ahead of the pivot, a counterweight hanging behind and below it, so it
      // always pulls the scoop back. At rest it leans back 7°, so marbles roll to the back wall (2.15 cm
      // ahead of the pivot), the next sits in front of it (4.45 cm), the third on top (≈3.3 cm). The weight
      // is set between those sums, so it tips as the nth glass marble lands (more of the lighter ones);
      // tipping, the marbles roll to the lip and the lean grows, so it goes all the way and pours
      const mb = 0.004, cwx = -0.03, cwy = -0.015, ballM = 0.0057;
      // above what one marble fewer weighs even rolled up to the lip, below what n marbles weigh at the back
      const arms = { 2: 0.062, 3: 0.097 }[d.opts.n] || 0.062;
      const mcw = (mb * ux + arms * ballM) / -cwx, M = mb + mcw;
      const com = [(mb * ux + mcw * cwx) / M, (mb * 0.012 + mcw * cwy) / M];
      // a heavy hub (+3e-4 kg·m²) so one landing marble can't knock it over
      const body = new RotorBody({ pivot, axis: S, e1: h, boxes, J: mb * 0.0012 + mcw * (cwx * cwx + cwy * cwy) + 3e-4, mass: M, com, damping: 4e-4, min: -1.3, max: 0.12, th0: 0.12, bounce: 0.05, surf: SURFACES.soft }); // tips to 75°: past 61° a marble rolls over the 6 mm lip
      B.colliders.push(body.collider); B.devices.push(body);
      // the chute that catches the pour, just below the lip when the scoop has tipped
      const q = pivot.clone().addScaledVector(h, 0.02).add(V(0, -0.092, 0));
      const ex = turtle(q, 0.16, x => ({ psi: P.psi, phi: lerpE(0.2, Math.max(d.slope, 0.03), x / 0.16) }));
      B.paths.push({ samples: ex, profile: 'channel', margin0: 0.02 });
      B.outs.push(endPort(ex, P.psi, Math.max(d.slope, 0.03)));
      // the look: the bucket in the track's colour, a dark weight on an arm, a stand and a pin
      const holder = new THREE.Group();
      holder.position.copy(pivot);
      holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(h, UP, S));
      const tub = new THREE.Group(); holder.add(tub);
      for (const bx of boxes) { const m = new THREE.Mesh(new THREE.BoxGeometry(bx.hu * 2, bx.hv * 2, bx.hw * 2), null); m.position.set(bx.x, bx.y, bx.z || 0); m.userData.paint = 'solid'; tub.add(m); }
      const rod = new THREE.Mesh(new THREE.BoxGeometry(-cwx, 0.004, 0.006), MAT.metal); rod.position.set(cwx / 2, cwy, 0); tub.add(rod);
      const weight = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.02, 18), MAT.dark); weight.rotation.x = PI / 2; weight.position.set(cwx, cwy, 0); tub.add(weight);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, (bw + 0.0015) * 2 + 0.02, 8), MAT.metal); pin.rotation.x = PI / 2; holder.add(pin);
      for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.04, 0.006), null); post.position.set(0, -0.02, sd * (bw + 0.012)); post.userData.paint = 'solid'; holder.add(post); }
      body.view = (th) => { tub.rotation.z = th; };
      B.meshes.push(holder);
      B.pillarPts.push(pivot.clone().add(V(0, -0.04, 0)));
      B.probes = [pivot.clone().addScaledVector(h, ux).add(V(0, 0.02, 0)), pivot.clone().addScaledVector(h, cwx), q.clone()];
    },
  },
  hat: {
    label: 'Magic Hat', kind: 'append', defaults: {},
    build(d, B, P) {
      // the ball rolls in under a top hat… and a different marble rolls out
      const L = 0.16, ph1 = Math.max(d.slope, 0.03), sMid = 0.08;
      const s = turtle(P.p, L, x => ({ psi: P.psi, phi: lerpE(P.phi, ph1, x / L) }));
      const dev = new HatDevice({ sMid });
      B.paths.push({ samples: s, profile: 'channel', bind: (col) => { dev.col = col; } });
      B.outs.push(endPort(s, P.psi, ph1));
      B.devices.push(dev);
      const c = sampleAt(s, sMid).p.clone(), y0 = c.y - RC + 0.012;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.075, 32), MAT.black);
      crown.position.set(c.x, y0 + 0.0375, c.z);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.004, 40), MAT.black);
      brim.position.set(c.x, y0, c.z);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0405, 0.0405, 0.014, 32, 1, true), MAT.red);
      band.position.set(c.x, y0 + 0.012, c.z);
      const star = new THREE.Mesh(new THREE.CircleGeometry(0.014, 5), plainMat('#ffd23f', { emissive: '#ffb000', emissiveIntensity: 0.4 }));
      star.rotation.x = -PI / 2; star.position.set(c.x, y0 + 0.0755, c.z);
      B.meshes.push(crown, brim, band, star);
      B.probes = [crown.position.clone()];
    },
  },
  airhill: {
    label: 'Floaty Hill', kind: 'append', defaults: { v: 1.2, k: 0.4 },
    build(d, B, P) {
      // A hill whose top follows the ball's own flight: up a curve, over a parabola that a ball
      // arriving at speed v flies along by itself (so it floats, weightless), and down again.
      // Along a ballistic path the pitch turns at dφ/ds = g·cos³φ / vx², vx being its speed across.
      const g = 9.81, th = 25 * DEG, R1 = 0.1, ph1 = Math.max(d.slope, 0.03), p0 = P.phi;
      // the climbing curve rises R1·(cos p0 − cos θ); the parabola's first half another vx²·tan²θ / 2g.
      // Rolling, a part of the energy is spin (factor 2/(1+k)), so at the top: vx² = (v² − f·g·rise) / (1 + f·tan²θ / 2)
      const rise1 = R1 * (Math.cos(p0) - Math.cos(th)), f = 2 / (1 + d.opts.k);
      let vx2 = (d.opts.v ** 2 - f * g * rise1) / (1 + f * Math.tan(th) ** 2 / 2);
      vx2 = Math.max(0.04, vx2);
      // build the pitch as a function of arc length, step by step
      const ds = 0.001, phis = [];
      let ph = p0;
      while (ph > -th) { phis.push(ph); ph -= ds / R1; }
      while (ph < th) { phis.push(ph); ph += g * Math.cos(ph) ** 3 / vx2 * ds; if (phis.length > 4000) break; }
      while (ph > ph1) { phis.push(ph); ph -= ds / R1; }
      phis.push(ph1);
      const L = (phis.length - 1) * ds;
      const s = turtle(P.p, L, x => ({ psi: P.psi, phi: phis[Math.min(phis.length - 1, Math.round(x / ds))] }));
      B.paths.push({ samples: s, profile: d.style, margin1: 0.003 });
      B.outs.push(endPort(s, P.psi, ph1));
    },
  },
  plinko: {
    label: 'Plinko', kind: 'append', defaults: { size: 0.26 },
    build(d, B, P) {
      // an upright board of pegs between two clear panes; the bin a ball lands in scores 1, 3 or 5
      const h = heading(P.psi), S = leftOf(P.psi), PTS = [1, 3, 5, 3, 1], pitch = 0.044, W = pitch * PTS.length;
      const half = 0.0145; // the panes stand 29 mm apart: room for every ball, not for two side by side
      const yT = P.p.y + 0.035, yB = yT - d.opts.size, ym = (yT + yB) / 2;
      const at = (u, y, s = 0) => P.p.clone().addScaledVector(h, u).addScaledVector(S, s).setY(y);
      const box = (u, y, hx, hy, hz, surf = SURFACES.plastic) => { const c = at(u, y); B.colliders.push(new BoxCollider(c.x, c.y, c.z, hx, hy, hz, P.psi, surf)); };
      // panes, ends, a lid (open where the ball comes in) and the floor
      for (const sd of [-1, 1]) { const c = at(W / 2, ym, sd * (half + 0.0015)); B.colliders.push(new BoxCollider(c.x, c.y, c.z, W / 2 + 0.004, d.opts.size / 2, 0.0015, P.psi, SURFACES.glass)); }
      const yIn = P.p.y - 0.022;
      box(-0.0035, (yB + yIn) / 2, 0.0015, (yIn - yB) / 2, half);
      box(W + 0.0035, ym, 0.0015, d.opts.size / 2, half);
      box((0.035 + W) / 2, yT + 0.0015, (W - 0.035) / 2, 0.0015, half);
      box(W / 2, yB - 0.0015, W / 2 + 0.004, 0.0015, half, SURFACES.wood);
      // pegs in staggered rows; bins with dividers at the bottom
      const pegGeos = [], binTop = yB + 0.05;
      for (let j = 0, y = P.p.y - 0.045; y > binTop + 0.02; j++, y -= 0.038) {
        for (let u = pitch * (j % 2 ? 1 : 0.5); u < W - 0.03; u += pitch) {
          if (u < 0.03) continue; // no peg so near a wall that a ball could wedge in between
          const c = at(u, y);
          B.colliders.push(new SphereCollider(c.x, c.y, c.z, 0.0045, SURFACES.wood));
          const g = new THREE.CylinderGeometry(0.0035, 0.0035, half * 2, 10);
          g.rotateX(PI / 2); g.rotateY(P.psi); g.translate(c.x, c.y, c.z); pegGeos.push(g);
        }
      }
      for (let k = 1; k < PTS.length; k++) {
        box(k * pitch, yB + 0.025, 0.0015, 0.025, half);
        const g = new THREE.BoxGeometry(0.003, 0.05, half * 2);
        g.rotateY(P.psi); const c = at(k * pitch, yB + 0.025); g.translate(c.x, c.y, c.z); pegGeos.push(g);
      }
      const pegs = new THREE.Mesh(mergeGeometries(pegGeos), MAT.gold);
      pegGeos.forEach(g => g.dispose());
      const pane = new THREE.Mesh(new THREE.BoxGeometry(W + 0.008, d.opts.size, half * 2 + 0.006), MAT.acrylic);
      pane.position.copy(at(W / 2, ym)); pane.rotation.y = P.psi;
      B.meshes.push(pegs, pane);
      // a solid frame in the track's colour: base, both sides and the top rail
      const part = (u, y, sx, sy) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, half * 2 + 0.01), null); m.position.copy(at(u, y)); m.rotation.y = P.psi; m.userData.paint = 'solid'; B.meshes.push(m); };
      part(W / 2, yB - 0.004, W + 0.016, 0.008);
      part(-0.0045, (yB + yIn) / 2, 0.006, yIn - yB);
      part(W + 0.0045, ym, 0.006, d.opts.size);
      part((0.035 + W) / 2 + 0.002, yT + 0.003, W - 0.031, 0.006);
      // bin numbers, and a gold floor under the 5
      PTS.forEach((n, k) => {
        const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.badgeTexture(String(n), n === 5 ? '#ffb300' : n === 3 ? '#4c8dff' : '#3ccf7a'), transparent: true }));
        lab.scale.set(0.022, 0.022, 1); lab.position.copy(at((k + 0.5) * pitch, yB + 0.012, half + 0.012)); lab.raycast = () => {};
        B.meshes.push(lab);
      });
      const gold = new THREE.Mesh(new THREE.BoxGeometry(pitch - 0.004, 0.002, half * 2), MAT.gold);
      gold.position.copy(at(2.5 * pitch, yB + 0.001)); gold.rotation.y = P.psi;
      B.meshes.push(gold);
      B.devices.push(new PlinkoDevice(P.p.clone(), P.psi, pitch, PTS, yB));
      B.pillarPts.push(at(0.03, yB - 0.009), at(W - 0.03, yB - 0.009));
      B.probes = []; B.solidPts = [];
      for (const u of [0.01, W / 2, W - 0.01]) for (const y of [yB + 0.015, ym, yT]) { B.probes.push(at(u, y)); B.solidPts.push(at(u, y)); }
    },
  },
  xylo: {
    label: 'Xylophone', kind: 'append', defaults: {},
    build(d, B, P) {
      const L = 0.42, ph1 = Math.max(d.slope, 0.06);
      const s = turtle(P.p, L, x => ({ psi: P.psi, phi: lerpE(P.phi, ph1, x / L) }));
      const bars = [];
      for (let k = 0; k < 8; k++) bars.push(0.045 + k * 0.047);
      const onRoll = (world, b, sNow, ce) => {
        if (ce.ls >= 0) for (let k = 0; k < bars.length; k++) {
          const sb = bars[k];
          if ((ce.ls < sb && sNow >= sb) || (ce.ls > sb && sNow <= sb)) world.emit('note', k, b);
        }
        ce.ls = sNow;
      };
      B.paths.push({ samples: s, profile: 'flat', onRoll });
      B.outs.push(endPort(s, P.psi, ph1));
      const rainbow = ['#ff5d5d', '#ff9f43', '#ffd23f', '#3ccf7a', '#2ec4b6', '#4c8dff', '#9b6bff', '#ff77b7'];
      const findAt = (sv) => s.reduce((a, c) => Math.abs(c.s - sv) < Math.abs(a.s - sv) ? c : a);
      bars.forEach((sb, k) => {
        const sm = findAt(sb);
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.004, RC * 2 + 0.002), plainMat(rainbow[k], { roughness: 0.25, metalness: 0.2 }));
        const R = V().crossVectors(sm.T, sm.U);
        m.matrixAutoUpdate = false;
        const pos = sm.p.clone().addScaledVector(sm.U, -RC - 0.0019);
        m.matrix.makeBasis(sm.T, sm.U, R).setPosition(pos);
        B.meshes.push(m);
      });
    },
  },
  funnel: {
    label: 'Funnel', kind: 'append', defaults: { size: 0.1, dir: 1 },
    build(d, B, P) {
      const Rf = d.opts.size, side = d.opts.dir;
      const c = P.p.clone().addScaledVector(leftOf(P.psi), side * Rf);
      funnelParts(B, c, P.p.y - RC - 0.0015, Rf, P, side, d.slope);
    },
  },
  lift: {
    label: 'Lift', kind: 'append', defaults: { height: 0.3, exit: 'back' },
    build(d, B, P) {
      const H = d.opts.height, h = heading(P.psi), S = V().crossVectors(h, UP).normalize();
      const inlet = turtle(P.p, 0.06, x => ({ psi: P.psi, phi: lerpE(P.phi, 0.03, x / 0.06) }));
      B.paths.push({ samples: inlet, profile: 'channel', margin1: 0.02 });
      const E = last(inlet).p;
      addStop(B, E.clone().addScaledVector(h, 0.0145).add(V(0, 0.004, 0)), P.psi);
      const r = 0.0115;
      const Pk = E.clone().addScaledVector(h, 0.011 - r).add(V(0, -(RC - r), 0));
      const exitPsi = P.psi + (d.opts.exit === 'left' ? PI / 2 : d.opts.exit === 'right' ? -PI / 2 : PI);
      const xs = Pk.clone().add(V(0, H + (RC - r) + 0.004, 0)).addScaledVector(heading(exitPsi), 0.012);
      const ex = turtle(xs, 0.1, x => ({ psi: exitPsi, phi: lerpE(0.12, d.slope, x / 0.1) }));
      B.paths.push({ samples: ex, profile: 'channel', margin0: 0.02 });
      B.outs.push(endPort(ex, exitPsi, d.slope));
      addStop(B, xs.clone().addScaledVector(heading(exitPsi), -0.017).add(V(0, 0.006, 0)), exitPsi);
      const rs = 0.03;
      const dev = new LiftDevice({ Pk, h, H, speed: 0.24, rs, exitPos: xs.clone().add(V(0, -(RC - r) + 0.002, 0)).addScaledVector(heading(exitPsi), 0.01), exitDir: heading(exitPsi) });
      B.devices.push(dev);
      // chain + scoops
      const nl = Math.round(dev.Lc / 0.012);
      const links = new THREE.InstancedMesh(new THREE.BoxGeometry(0.008, 0.011, 0.004), MAT.dark, nl);
      const scoopGeo = mergeGeometries([new THREE.BoxGeometry(0.024, 0.003, 0.022).translate(0, 0, 0), new THREE.BoxGeometry(0.024, 0.016, 0.003).translate(0, 0.007, -0.011)]);
      const scoops = new THREE.InstancedMesh(scoopGeo, MAT.red, dev.N);
      links.frustumCulled = scoops.frustumCulled = false;
      dev.links = links; dev.scoops = scoops;
      B.meshes.push(links, scoops);
      // sprockets + decorative gear + frame
      const mkGear = (R, teeth, center, dir, paint) => {
        const g = new THREE.Mesh(gearGeometry(R, teeth, 0.006), null);
        const holder = new THREE.Group();
        holder.position.copy(center);
        holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(h, UP, S.clone().negate()));
        holder.add(g); g.userData.paint = paint;
        dev.gears.push({ mesh: g, r: R, dir });
        B.meshes.push(holder);
        return holder;
      };
      const Ct = dev.F.clone().addScaledVector(h, rs).addScaledVector(UP, H), Cb = dev.F.clone().addScaledVector(h, rs);
      mkGear(rs * 1.05, 12, Ct.clone().addScaledVector(S, 0.006), 1, 'solid');
      mkGear(rs * 1.05, 12, Cb.clone().addScaledVector(S, 0.006), 1, 'solid');
      mkGear(rs * 1.6, 18, Ct.clone().addScaledVector(h, rs * 2.65).addScaledVector(S, 0.012), -1.05 / 1.6, 'wood');
      const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 8), MAT.metal);
      crank.position.copy(Ct).addScaledVector(h, rs * 2.65).addScaledVector(S, 0.036); crank.rotation.x = PI / 2;
      crank.quaternion.setFromUnitVectors(UP, S);
      B.meshes.push(crank);
      for (const sgn of [1, -1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.01, H + 0.12, 0.012), null);
        post.position.copy(dev.F).addScaledVector(h, rs).addScaledVector(S, sgn * 0.024).add(V(0, H / 2, 0));
        post.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(h, UP, S.clone().negate()));
        post.userData.paint = 'solid';
        B.meshes.push(post);
        B.pillarPts.push(post.position.clone().add(V(0, -H / 2 - 0.06, 0)));
      }
      B.liftTop = Ct;
      B.probes = [];
      for (let y = 0.03; y <= H + rs; y += 0.03) B.probes.push(dev.F.clone().addScaledVector(h, rs).add(V(0, y, 0)));
      B.probes.push(Ct.clone().addScaledVector(h, rs * 2.65));
    },
  },
  cup: {
    label: 'Goal Cup', kind: 'append', defaults: {},
    build(d, B, P) {
      const Rc = 0.04, h = heading(P.psi), c = P.p.clone().addScaledVector(h, Rc + 0.003);
      const yTop = P.p.y - RC - 0.004;
      cupParts(B, c, Rc, 0.05, yTop);
      // backboard so fast balls bounce down into the cup
      const bb = c.clone().addScaledVector(h, Rc + 0.006); bb.y = yTop + 0.035;
      B.colliders.push(new BoxCollider(bb.x, bb.y, bb.z, 0.003, 0.04, Rc + 0.01, P.psi, SURFACES.wood));
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.08, (Rc + 0.01) * 2), null);
      m.position.copy(bb); m.rotation.y = P.psi; m.userData.paint = 'solid';
      B.meshes.push(m);
      const side = leftOf(P.psi);
      for (const f of [-1, 0, 1]) for (const dy of [0, 0.035]) B.probes.push(bb.clone().addScaledVector(side, f * (Rc + 0.005)).add(V(0, dy, 0)));
    },
  },
  catcher: {
    label: 'Catcher', kind: 'place', defaults: { height: 0.3, size: 0.17 },
    build(d, B) {
      const base = V(d.port.x, d.port.y, d.port.z), psi = d.port.psi, Rf = d.opts.size;
      const D = 0.045 + Rf * 0.25, H = Math.max(d.opts.height, D + 0.12);
      const yRim = base.y + H, inP = { p: base.clone().addScaledVector(leftOf(psi), -Rf), psi, phi: 0 };
      inP.p.y = yRim + RC + 0.0015;
      funnelParts(B, V(base.x, 0, base.z), yRim, Rf, inP, 1, d.slope);
      B.ins.push(inP);
      for (let y = base.y + 0.05; y < yRim - D - 0.05; y += 0.05) B.probes.push(V(base.x, y, base.z));
    },
  },
  basket: {
    label: 'Basket', kind: 'place', defaults: { height: 0.0 },
    build(d, B) {
      const base = V(d.port.x, d.port.y, d.port.z), Rc = 0.07, depth = 0.07;
      // a soft fabric basket: it swallows the bounce
      cupParts(B, base, Rc, depth, base.y + d.opts.height + depth + 0.005, SURFACES.soft);
      B.ins.push({ p: base.clone().add(V(0, d.opts.height + depth + 0.03, 0)).addScaledVector(heading(d.port.psi), -Rc - 0.004), psi: d.port.psi, phi: 0 });
      if (d.opts.height < 0.02) B.pillarPts.length = 0;
    },
  },
  tramp: {
    label: 'Trampoline', kind: 'place', defaults: { height: 0.07, tilt: 20 },
    build(d, B) {
      const base = V(d.port.x, d.port.y, d.port.z), psi = d.port.psi, R = 0.065, tilt = d.opts.tilt * PI / 180;
      const h = heading(psi), n = V().addScaledVector(h, Math.sin(tilt)).addScaledVector(UP, Math.cos(tilt)).normalize();
      const C = base.clone().add(V(0, d.opts.height + R * Math.sin(tilt), 0));
      const e1 = V().crossVectors(n, V().crossVectors(h, UP)).normalize();
      const dev = new TrampolineDevice();
      const prims = [seg(0, 0, R, 0), arc(R + 0.006, 0.002, 0.006, 0, TAU), seg(0, -0.004, R, -0.004)];
      const col = new RevolveCollider(C, n, e1, prims, SURFACES.trampoline, { device: dev });
      col.device = dev;
      B.colliders.push(col);
      B.devices.push(dev);
      const holder = new THREE.Group();
      holder.position.copy(C);
      holder.quaternion.setFromUnitVectors(UP, n);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.003, 40), plainMat('#30305a', { roughness: 0.8 }));
      pad.position.y = -0.0015;
      dev.pad = pad;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.006, 0.006, 12, 48), null);
      ring.rotation.x = PI / 2; ring.position.y = 0.002; ring.userData.paint = 'solid';
      holder.add(pad, ring);
      B.meshes.push(holder);
      for (let i = 0; i < 4; i++) {
        const a = i * PI / 2 + PI / 4;
        const lp = V(Math.cos(a) * (R + 0.006), 0, Math.sin(a) * (R + 0.006)).applyQuaternion(holder.quaternion).add(C);
        B.pillarPts.push(lp);
      }
      ringProbes(B, C, R, C.y, 10);
      B.probes.push(C.clone());
      B.radius = R;
    },
  },
  tunnel: {
    label: 'Tunnel', kind: 'append', defaults: { len: 0.25 },
    build(d, B, P) {
      const L = d.opts.len, ph1 = d.slope;
      const s = turtle(P.p, L, x => ({ psi: P.psi, phi: lerpE(P.phi, ph1, x / L) }));
      B.paths.push({ samples: s, profile: d.style === 'tube' ? 'channel' : d.style, arch: true });
      B.outs.push(endPort(s, P.psi, ph1));
    },
  },
  wheel: {
    label: 'Water Wheel', kind: 'append', defaults: { size: 0.075 },
    build(d, B, P) {
      const R = d.opts.size, w = RC + 0.0025, hub = 0.012;
      const h = heading(P.psi), S = V().crossVectors(h, UP).normalize();
      const lead = turtle(P.p, 0.05, x => ({ psi: P.psi, phi: lerpE(P.phi, 0.03, x / 0.05) }));
      B.paths.push({ samples: lead, profile: 'channel', margin1: 0.008 });
      const E = last(lead).p;
      const C = E.clone().addScaledVector(h, R * 0.55).add(V(0, -(RC + 0.012 + R), 0));
      // static: side plates, hub, and the front casing that keeps a ball in its bucket on the way down
      B.colliders.push(new RevolveCollider(C, S, h, [
        seg(0, -w - 0.0015, R + 0.006, -w - 0.0015), seg(0, w + 0.0015, R + 0.006, w + 0.0015),
        seg(hub, -w, hub, w),
        seg(R + 0.004, -w - 0.0015, R + 0.004, w + 0.0015, { gap: [70 * DEG, 300 * DEG] }),
      ], SURFACES.plastic));
      // a clear guard above the front, so a fast ball is knocked down into a bucket instead of flying over
      const guard = C.clone().addScaledVector(h, R + 0.006).add(V(0, R * 0.94 + 0.03, 0));
      B.colliders.push(new BoxCollider(guard.x, guard.y, guard.z, 0.002, 0.032, w + 0.0015, P.psi, SURFACES.plastic));
      const gm = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.064, (w + 0.0015) * 2), MAT.acrylic);
      gm.position.copy(guard); gm.rotation.y = P.psi;
      B.meshes.push(gm);
      // the paddles turn freely: the balls' weight drives the wheel
      const boxes = [], N = 8, rc = (hub + R) / 2;
      for (let k = 0; k < N; k++) { const a = k / N * TAU; boxes.push({ x: Math.cos(a) * rc, y: Math.sin(a) * rc, z: 0, phi: a, hu: (R - hub) / 2, hv: 0.0015, hw: w - 0.0008 }); }
      const body = new RotorBody({ pivot: C.clone(), axis: S, e1: h, boxes, J: 0.6 * 0.035 * R * R, damping: 4e-4, friction: 3e-5, surf: SURFACES.wood });
      B.colliders.push(body.collider); B.devices.push(body);
      const xs = C.clone().add(V(0, -(R + 0.032), 0)).addScaledVector(h, -0.005);
      const ex = turtle(xs, 0.13, x => ({ psi: P.psi, phi: lerpE(0.05, d.slope, x / 0.13) }));
      B.paths.push({ samples: ex, profile: 'channel', margin0: 0.02 });
      B.outs.push(endPort(ex, P.psi, d.slope));
      addStop(B, xs.clone().addScaledVector(h, -0.017).add(V(0, 0.006, 0)), P.psi);
      // looks
      const holder = new THREE.Group();
      holder.position.copy(C);
      holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(h, UP, S));
      const spin = new THREE.Group(); holder.add(spin);
      for (const bx of boxes) { const m = new THREE.Mesh(new THREE.BoxGeometry(bx.hu * 2, bx.hv * 2, bx.hw * 2), null); m.position.set(bx.x, bx.y, 0); m.rotation.z = bx.phi; m.userData.paint = 'solid'; spin.add(m); }
      for (const sz of [-1, 1]) { const disc = new THREE.Mesh(new THREE.CircleGeometry(R + 0.006, 40), MAT.acrylic); disc.position.z = sz * (w + 0.0015); spin.add(disc); }
      const ring = new THREE.Mesh(gearRingGeometry(R + 0.012, R - 0.004, 30, 0.004), null); ring.position.z = w + 0.0045; ring.userData.paint = 'wood'; spin.add(ring);
      const ring2 = new THREE.Mesh(gearRingGeometry(R + 0.012, R - 0.004, 30, 0.004), null); ring2.position.z = -w - 0.0045; ring2.userData.paint = 'wood'; spin.add(ring2);
      const hubM = new THREE.Mesh(new THREE.CylinderGeometry(hub, hub, w * 2, 16), null); hubM.rotation.x = PI / 2; hubM.userData.paint = 'solid'; spin.add(hubM);
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, w * 2 + 0.05, 10), MAT.metal); axle.rotation.x = PI / 2; holder.add(axle);
      const casing = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.0045, R + 0.0045, w * 2 + 0.003, 32, 1, true, 30 * DEG, 130 * DEG).rotateX(PI / 2), MAT.acrylic);
      holder.add(casing);
      for (const sz of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(R * 0.7, 0.006, 0.006), MAT.dark);
        arm.position.set(-R * 0.35, 0, sz * (w + 0.025)); holder.add(arm);
        B.pillarPts.push(C.clone().addScaledVector(h, -R * 0.7).addScaledVector(S, sz * (w + 0.025)).add(V(0, -0.003, 0)));
      }
      body.view = (th) => { spin.rotation.z = th; };
      B.meshes.push(holder);
      B.probes = [];
      for (let k = 0; k < 10; k++) { const a = k / 10 * TAU; B.probes.push(C.clone().addScaledVector(h, Math.cos(a) * R).addScaledVector(UP, Math.sin(a) * R)); }
    },
  },
  seesaw: {
    label: 'Seesaw', kind: 'append', defaults: {},
    build(d, B, P) {
      const h = heading(P.psi), S = V().crossVectors(h, UP).normalize();
      // the pivot sits close to the entrance so even a slow ball rolls past it
      const near = 0.02, far = 0.14, top = 3 * DEG, bottom = -14 * DEG;
      const dirAt = (th) => h.clone().multiplyScalar(Math.cos(th)).addScaledVector(UP, Math.sin(th));
      // at rest the near end sits just under the incoming track
      const pivot = P.p.clone().add(V(0, -RC - 0.0015, 0)).addScaledVector(dirAt(top), near);
      const mid = (far - near) / 2, hl = (far + near) / 2, wz = RC + 0.0015;
      const boxes = [
        { x: mid, y: -0.002, z: 0, hu: hl, hv: 0.002, hw: wz + 0.0015 },
        { x: mid, y: 0.009, z: -wz, hu: hl, hv: 0.011, hw: 0.0015 },
        { x: mid, y: 0.009, z: wz, hu: hl, hv: 0.011, hw: 0.0015 },
      ];
      // a counterweight under the near end holds it down until a ball rolls past the pivot
      // a light balsa plank: even a 1 g ball a couple of cm past the pivot outweighs it
      const body = new RotorBody({ pivot, axis: S, e1: h, boxes, J: 2e-5, mass: 0.006, com: [-0.0035, -0.004], damping: 4e-5, min: bottom, max: top, th0: top, bounce: 0.15, surf: SURFACES.wood });
      B.colliders.push(body.collider); B.devices.push(body);
      const tip = pivot.clone().addScaledVector(dirAt(bottom), far);
      const xs = tip.clone().addScaledVector(h, 0.008).add(V(0, RC - 0.006, 0));
      const ex = turtle(xs, 0.1, x => ({ psi: P.psi, phi: lerpE(0.08, d.slope, x / 0.1) }));
      B.paths.push({ samples: ex, profile: 'channel', margin0: 0.015 });
      B.outs.push(endPort(ex, P.psi, d.slope));
      const holder = new THREE.Group();
      holder.position.copy(pivot);
      holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(h, UP, S));
      const plank = new THREE.Group(); holder.add(plank);
      for (const bx of boxes) { const m = new THREE.Mesh(new THREE.BoxGeometry(bx.hu * 2, bx.hv * 2, bx.hw * 2), null); m.position.set(bx.x, bx.y, bx.z); m.userData.paint = 'solid'; plank.add(m); }
      const cw = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.012, wz * 2), MAT.dark); cw.position.set(-near + 0.012, -0.01, 0); plank.add(cw);
      const fulcrum = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.016, 0.026, 3), null);
      fulcrum.userData.paint = 'wood'; fulcrum.position.set(0, -0.017, 0); fulcrum.rotation.y = PI / 2; holder.add(fulcrum);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, wz * 2 + 0.012, 8), MAT.metal); pin.rotation.x = PI / 2; holder.add(pin);
      body.view = (th) => { plank.rotation.z = th; };
      B.meshes.push(holder);
      B.pillarPts.push(pivot.clone().add(V(0, -0.03, 0)));
      B.probes = [];
      for (const th of [top, bottom]) for (const x of [-near, 0, far * 0.5, far]) B.probes.push(pivot.clone().addScaledVector(dirAt(th), x));
    },
  },
  dominoes: {
    label: 'Dominoes', kind: 'place', defaults: { count: 10 },
    build(d, B) {
      const base = V(d.port.x, d.port.y, d.port.z), h = heading(d.port.psi), S = V().crossVectors(h, UP).normalize();
      const N = d.opts.count, T = 0.008, W = 0.032, H = 0.05, gap = 0.032, m = 0.006;
      const hit = -Math.asin((gap - T) / H);
      const bodies = [];
      const cols = ['#ff5d5d', '#ff9f43', '#ffd23f', '#3ccf7a', '#2ec4b6', '#4c8dff', '#9b6bff', '#ff77b7'];
      B.probes = [];
      for (let i = 0; i < N; i++) {
        const pivot = base.clone().addScaledVector(h, i * gap + T / 2);
        const body = new RotorBody({ pivot, axis: S, e1: h, boxes: [{ x: -T / 2, y: H / 2, z: 0, hu: T / 2, hv: H / 2, hw: W / 2 }], J: m * (H * H + T * T) / 3, mass: m, com: [-T / 2, H / 2], min: i === N - 1 ? -88 * DEG : hit, max: 0, bounce: 0.05, damping: 1e-7, surf: SURFACES.wood });
        bodies.push(body);
        B.colliders.push(body.collider); B.devices.push(body);
        const holder = new THREE.Group();
        holder.position.copy(pivot);
        holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(h, UP, S));
        const tilt = new THREE.Group(); holder.add(tilt);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(T, H, W), new THREE.MeshPhysicalMaterial({ map: TX.dominoTexture(cols[i % cols.length]), roughness: 0.35, clearcoat: 0.6 }));
        mesh.position.set(-T / 2, H / 2, 0); tilt.add(mesh);
        body.view = (th) => { tilt.rotation.z = th; };
        B.meshes.push(holder);
        B.probes.push(pivot.clone().add(V(0, H, 0)));
      }
      const row = new DominoRow(bodies);
      B.devices.push(row);
    },
  },
  bell: {
    label: 'Bell', kind: 'place', defaults: { height: 0.15, size: 1 },
    build(d, B) {
      const base = V(d.port.x, d.port.y, d.port.z), sc = d.opts.size, Rb = 0.03 * sc;
      const C = V(base.x, base.y + d.opts.height + 0.012, base.z);
      const prof = [[Rb, 0], [Rb * 0.92, Rb * 0.25], [Rb * 0.72, Rb * 0.7], [Rb * 0.5, Rb], [Rb * 0.2, Rb * 1.15], [0.0005, Rb * 1.18]];
      const dev = new BellDevice(sc);
      const col = new RevolveCollider(C, UP, V(1, 0, 0), polyline(prof), SURFACES.bell, { device: dev });
      B.colliders.push(col);
      B.colliders.push(new CylinderCollider(base.x, base.z, base.y, C.y + Rb * 0.5, 0.004, SURFACES.wood));
      B.devices.push(dev);
      const holder = new THREE.Group(); holder.position.copy(C);
      const inner = prof.map(([r, y]) => [Math.max(0.0005, r - 0.0025), y - 0.002]).reverse();
      const bell = new THREE.Mesh(new THREE.LatheGeometry([...prof, ...inner].map(([r, y]) => new THREE.Vector2(r, y)), 40), MAT.gold);
      bell.material.side = THREE.DoubleSide;
      const clap = new THREE.Mesh(new THREE.SphereGeometry(Rb * 0.18, 12, 8), MAT.metal); clap.position.y = Rb * 0.25;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(Rb * 0.16, 12, 8), MAT.gold); knob.position.y = Rb * 1.2;
      holder.add(bell, clap, knob);
      dev.holder = holder;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, C.y - base.y, 10), null);
      pole.position.set(base.x, (base.y + C.y) / 2, base.z); pole.userData.paint = 'solid';
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.008, 24), null);
      foot.position.set(base.x, base.y + 0.004, base.z); foot.userData.paint = 'solid';
      B.meshes.push(holder, pole, foot);
      ringProbes(B, C, Rb, C.y + Rb * 0.5, 8);
    },
  },
  bumper: {
    label: 'Bumper', kind: 'place', defaults: {},
    build(d, B) {
      const base = V(d.port.x, d.port.y, d.port.z), R = 0.028, H = 0.03;
      const dev = new BumperDevice();
      const col = new CylinderCollider(base.x, base.z, base.y, base.y + H, R, SURFACES.bumper);
      col.device = dev;
      B.colliders.push(col); B.devices.push(dev);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.9, R, H, 32), MAT.white);
      body.position.set(base.x, base.y + H / 2, base.z);
      const band = new THREE.Mesh(new THREE.TorusGeometry(R, 0.005, 10, 36), MAT.red);
      band.rotation.x = PI / 2; band.position.set(base.x, base.y + H * 0.45, base.z);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.75, R * 0.85, 0.008, 32), new THREE.MeshStandardMaterial({ color: COLORS[d.color] || '#ffd23f', emissive: COLORS[d.color] || '#ffd23f', emissiveIntensity: 0.2, roughness: 0.3 }));
      cap.position.set(base.x, base.y + H + 0.003, base.z);
      dev.cap = cap;
      B.meshes.push(body, band, cap);
      ringProbes(B, base, R, base.y + H / 2, 8);
    },
  },
  brake: {
    label: 'Brake', kind: 'append', defaults: { len: 0.15, speed: 0.6 },
    build(d, B, P) {
      const L = d.opts.len, ph1 = d.slope;
      const s = turtle(P.p, L, x => ({ psi: P.psi, phi: lerpE(P.phi, ph1, x / L) }));
      const dev = new BrakeDevice(d.opts.speed);
      B.paths.push({ samples: s, profile: 'channel', bind: (col) => { dev.col = col; } });
      B.outs.push(endPort(s, P.psi, ph1));
      B.devices.push(dev);
      // tufts of bristles on both walls, reaching in to brush the ball's sides
      const geos = [], m4 = new THREE.Matrix4();
      for (let x = 0.012; x < L - 0.008; x += 0.01) {
        const sm = sampleAt(s, x), R = V().crossVectors(sm.T, sm.U);
        for (const sd of [-1, 1]) {
          const g = new THREE.BoxGeometry(0.004, 0.009, 0.0075);
          m4.makeBasis(sm.T, sm.U, R).setPosition(sm.p.clone().addScaledVector(R, sd * (RC - 0.0035)).addScaledVector(sm.U, -0.004));
          geos.push(g.applyMatrix4(m4));
        }
      }
      const tufts = new THREE.Mesh(mergeGeometries(geos), MAT.bristle);
      geos.forEach(g => g.dispose());
      B.meshes.push(tufts);
    },
  },
  booster: {
    label: 'Booster', kind: 'append', defaults: { power: 1.4 },
    build(d, B, P) {
      const L = 0.16, ph1 = d.slope;
      const s = turtle(P.p, L, x => ({ psi: P.psi, phi: lerpE(P.phi, ph1, x / L) }));
      const sm = sampleAt(s, 0.035), R = V().crossVectors(sm.T, sm.U);
      const dev = new BoosterDevice(d.opts.power, 0.025, 0.1, sampleAt(s, 0.06).T.clone());
      B.paths.push({ samples: s, profile: 'channel', bind: (col) => { dev.col = col; } });
      B.outs.push(endPort(s, P.psi, ph1));
      B.devices.push(dev);
      // the spring housing beside the track and a paddle arm that sweeps over the channel
      const basis = new THREE.Matrix4().makeBasis(sm.T, sm.U, R);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.022, 0.016), MAT.red);
      housing.quaternion.setFromRotationMatrix(basis);
      housing.position.copy(sm.p).addScaledVector(R, RC + TH + 0.01).addScaledVector(sm.T, 0.02);
      const coil = new THREE.Mesh(new THREE.TorusKnotGeometry(0.006, 0.0012, 48, 6, 1, 8), MAT.metal);
      coil.quaternion.copy(housing.quaternion); coil.position.copy(housing.position).addScaledVector(sm.U, 0.016);
      const paddle = new THREE.Group();
      paddle.quaternion.setFromRotationMatrix(basis);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, RC * 2 + 0.03), MAT.white);
      arm.position.set(0, 0.012, -(RC + 0.008));
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.02, RC * 1.3), MAT.red);
      pad.position.set(0, 0.0, 0);
      paddle.add(arm, pad);
      dev.rest = sm.p.clone().addScaledVector(sm.U, -0.002); dev.paddle = paddle; paddle.position.copy(dev.rest);
      // yellow arrows painted in the channel
      for (const x of [0.09, 0.115, 0.14]) {
        const q = sampleAt(s, x), tri = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.012, 3), MAT.yellow);
        tri.scale.set(1, 1, 0.25);
        tri.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V().crossVectors(q.T, q.U).negate(), q.T, q.U));
        tri.position.copy(q.p).addScaledVector(q.U, -(RC - 0.0012));
        B.meshes.push(tri);
      }
      B.meshes.push(housing, coil, paddle);
      B.probes = [housing.position.clone()];
    },
  },
  gate: {
    label: 'Gate', kind: 'append', defaults: { mode: 'timer', interval: 2 },
    build(d, B, P) {
      const L = 0.14, ph1 = d.slope, sHold = 0.085;
      const s = turtle(P.p, L, x => ({ psi: P.psi, phi: lerpE(P.phi, ph1, x / L) }));
      const remote = ['red', 'green', 'blue'].includes(d.opts.mode) ? d.opts.mode : null;
      const dev = new GateDevice({ mode: d.opts.mode, interval: d.opts.interval, sHold, remote });
      B.paths.push({ samples: s, profile: 'channel', bind: (col) => { dev.col = col; } });
      B.outs.push(endPort(s, P.psi, ph1));
      B.devices.push(dev);
      const sm = sampleAt(s, sHold), R = V().crossVectors(sm.T, sm.U);
      const c = sm.p.clone().addScaledVector(sm.T, 0.003);
      B.colliders.push(new GateCollider(dev, c.x, c.y, c.z, 0.003, 0.02, RC, P.psi, SURFACES.wood));
      // two posts, a crossbar and a flap hinged on it
      for (const sd of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.05, 0.008), null);
        post.position.copy(c).addScaledVector(R, sd * (RC + TH + 0.005)).add(V(0, 0.012, 0)); post.userData.paint = 'solid';
        B.meshes.push(post);
      }
      const hinge = new THREE.Group();
      hinge.position.copy(c).add(V(0, 0.034, 0)); hinge.rotation.y = P.psi;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, RC * 2 + TH * 2 + 0.018, 10), MAT.metal);
      bar.rotation.x = PI / 2; hinge.add(bar);
      const flapHolder = new THREE.Group(); hinge.add(flapHolder);
      const gm = remote ? REMOTE_MAT[remote] : d.opts.mode === 'sensor' ? MAT.blue : MAT.yellow;
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.036, RC * 2 - 0.002), gm);
      flap.position.y = -0.019; flapHolder.add(flap);
      dev.flap = flapHolder;
      const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.003, 20), gm);
      sign.rotation.x = PI / 2; sign.position.set(0, 0.012, 0); hinge.add(sign);
      B.meshes.push(hinge);
      B.probes = [hinge.position.clone()];
    },
  },
  sensor: {
    label: 'Sensor', kind: 'append', defaults: { effect: 'confetti' },
    build(d, B, P) {
      const L = 0.12, ph1 = d.slope, sMid = 0.06;
      const s = turtle(P.p, L, x => ({ psi: P.psi, phi: lerpE(P.phi, ph1, x / L) }));
      const dev = new SensorDevice({ sMid, effect: d.opts.effect, kind: 'sensor' });
      B.paths.push({ samples: s, profile: d.style === 'tube' ? 'tube' : 'channel', bind: (col) => { dev.col = col; } });
      B.outs.push(endPort(s, P.psi, ph1));
      B.devices.push(dev);
      const sm = sampleAt(s, sMid), R = V().crossVectors(sm.T, sm.U);
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(RC + TH + 0.007, 0.0035, 8, 28, PI), null);
      hoop.userData.paint = 'solid';
      hoop.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(R, sm.U, sm.T));
      hoop.position.copy(sm.p).addScaledVector(sm.U, -0.004);
      const col = SENSOR_COLORS[d.opts.effect] || '#4cc9f0';
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 14, 10), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.3 }));
      led.position.copy(sm.p).addScaledVector(sm.U, RC + TH + 0.006);
      dev.led = led;
      B.meshes.push(hoop, led);
      if (d.opts.effect === 'count') {
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.badgeTexture('0', '#9b6bff'), transparent: true }));
        label.scale.set(0.03, 0.03, 1); label.position.copy(led.position).add(V(0, 0.028, 0)); label.raycast = () => {}; label.renderOrder = 5;
        dev.label = label; dev.shown = 0; B.meshes.push(label);
      }
      B.probes = [led.position.clone()];
    },
  },
  photo: {
    label: 'Photo Booth', kind: 'append', defaults: {},
    build(d, B, P) {
      const L = 0.16, ph1 = d.slope, sMid = 0.08;
      const s = turtle(P.p, L, x => ({ psi: P.psi, phi: lerpE(P.phi, ph1, x / L) }));
      const dev = new SensorDevice({ sMid: sMid - 0.01, kind: 'photo' });
      B.paths.push({ samples: s, profile: d.style === 'tube' ? 'tube' : 'channel', bind: (col) => { dev.col = col; } });
      B.outs.push(endPort(s, P.psi, ph1));
      B.devices.push(dev);
      const sm = sampleAt(s, sMid), R = V().crossVectors(sm.T, sm.U);
      const side = R.clone().setY(0).normalize();
      const foot = sm.p.clone().addScaledVector(side, 0.075);
      const top = foot.clone().add(V(0, 0.06, 0));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.07, 8), MAT.metal);
      pole.position.copy(foot).add(V(0, 0.025, 0));
      const cam = new THREE.Group(); cam.position.copy(top);
      cam.lookAt(sm.p);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.018), null); body.userData.paint = 'solid';
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.008, 0.012, 16), MAT.black);
      lens.rotation.x = PI / 2; lens.position.z = 0.014;
      const flash = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.006, 0.004), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.3 }));
      flash.position.set(0.008, 0.013, 0.006);
      cam.add(body, lens, flash);
      dev.led = flash;
      // the photo is taken from just in front of the lens
      dev.camPos = top.clone().addScaledVector(sm.p.clone().sub(top).normalize(), 0.03); dev.look = sm.p.clone();
      B.meshes.push(pole, cam);
      B.pillarPts.push(foot.clone().add(V(0, -0.012, 0)));
      B.probes = [top.clone()];
    },
  },
  screw: {
    label: 'Screw Lift', kind: 'append', defaults: { height: 0.3, exit: 'back' },
    build(d, B, P) {
      const H = d.opts.height, h = heading(P.psi), S = V().crossVectors(h, UP).normalize();
      const inlet = turtle(P.p, 0.06, x => ({ psi: P.psi, phi: lerpE(P.phi, 0.03, x / 0.06) }));
      B.paths.push({ samples: inlet, profile: 'channel', margin1: 0.02 });
      const E = last(inlet).p, r = 0.0115, R = 0.022;
      addStop(B, E.clone().addScaledVector(h, 0.0145).add(V(0, 0.004, 0)), P.psi);
      const Pk = E.clone().addScaledVector(h, 0.011 - r).add(V(0, -(RC - r), 0));
      const axis = Pk.clone().addScaledVector(h, R);
      const exitPsi = P.psi + (d.opts.exit === 'left' ? PI / 2 : d.opts.exit === 'right' ? -PI / 2 : PI);
      const ed = heading(exitPsi);
      // choose the pitch so the thread delivers the ball right at the exit side
      const te = Math.atan2(ed.dot(S), ed.dot(h));
      let base = te - PI; while (base <= 0) base += TAU;
      const n = Math.max(0, Math.round(H / 0.055 - base / TAU));
      const pitch = TAU * H / (base + TAU * n);
      const xs = axis.clone().addScaledVector(ed, R + 0.006).add(V(0, H + (RC - r) + 0.004, 0));
      const ex = turtle(xs, 0.1, x => ({ psi: exitPsi, phi: lerpE(0.12, d.slope, x / 0.1) }));
      B.paths.push({ samples: ex, profile: 'channel', margin0: 0.02 });
      B.outs.push(endPort(ex, exitPsi, d.slope));
      const dev = new ScrewDevice({ Pk, axis, h, S, R, H, pitch, vy: 0.07, exitPos: xs.clone().add(V(0, -(RC - r) + 0.002, 0)).addScaledVector(ed, 0.008), exitDir: ed });
      B.devices.push(dev);
      // clear barrel, a turning shaft with its thread, a cap and a foot
      const y0 = Pk.y - r - 0.006, y1 = Pk.y + H + 0.02;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(R + r + 0.004, R + r + 0.004, y1 - y0, 28, 1, true), MAT.acrylic);
      barrel.position.set(axis.x, (y0 + y1) / 2, axis.z);
      const rotor = new THREE.Group(); rotor.position.set(axis.x, 0, axis.z);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, y1 - y0, 12), MAT.white);
      shaft.position.y = (y0 + y1) / 2;
      const pts = [];
      for (let y = 0; y <= H + 0.001; y += pitch / 24) {
        const th = PI + TAU * y / pitch;
        pts.push(V(Math.cos(th) * h.x * (R - 0.004) + Math.sin(th) * S.x * (R - 0.004), Pk.y + y - r - 0.002, Math.cos(th) * h.z * (R - 0.004) + Math.sin(th) * S.z * (R - 0.004)));
      }
      const thread = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(24, pts.length * 2), 0.004, 6), null);
      thread.userData.paint = 'solid';
      rotor.add(shaft, thread);
      dev.rotor = rotor;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(R + r + 0.008, R + r + 0.008, 0.008, 28), null);
      cap.position.set(axis.x, y1 + 0.004, axis.z); cap.userData.paint = 'solid';
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(R + r + 0.008, R + r + 0.01, 0.008, 28), null);
      foot.position.set(axis.x, y0 - 0.004, axis.z); foot.userData.paint = 'solid';
      B.meshes.push(barrel, rotor, cap, foot);
      B.pillarPts.push(V(axis.x, y0 - 0.008, axis.z));
      B.probes = [];
      for (let y = y0 + 0.03; y <= y1; y += 0.03) B.probes.push(V(axis.x, y, axis.z));
    },
  },
  elevator: {
    label: 'Elevator', kind: 'append', defaults: { height: 0.3, exit: 'back' },
    build(d, B, P) {
      const H = d.opts.height, h = heading(P.psi), S = V().crossVectors(h, UP).normalize();
      const inlet = turtle(P.p, 0.06, x => ({ psi: P.psi, phi: lerpE(P.phi, 0.03, x / 0.06) }));
      B.paths.push({ samples: inlet, profile: 'channel', margin1: 0.02 });
      const E = last(inlet).p, r = 0.0115;
      addStop(B, E.clone().addScaledVector(h, 0.0145).add(V(0, 0.004, 0)), P.psi);
      const Pk = E.clone().addScaledVector(h, 0.011 - r).add(V(0, -(RC - r), 0));
      const exitPsi = P.psi + (d.opts.exit === 'left' ? PI / 2 : d.opts.exit === 'right' ? -PI / 2 : PI);
      const ed = heading(exitPsi);
      const xs = Pk.clone().add(V(0, H + (RC - r) + 0.008, 0)).addScaledVector(ed, 0.026);
      const ex = turtle(xs, 0.1, x => ({ psi: exitPsi, phi: lerpE(0.12, d.slope, x / 0.1) }));
      B.paths.push({ samples: ex, profile: 'channel', margin0: 0.02 });
      B.outs.push(endPort(ex, exitPsi, d.slope));
      const base = Pk.y - r - 0.003;
      const dev = new ElevatorDevice({ Pk, H, v: 0.28, base, exitPos: xs.clone().add(V(0, -(RC - r) + 0.004, 0)).addScaledVector(ed, 0.006), exitDir: ed });
      B.devices.push(dev);
      // the cup rides a pole on the side; a pulley wheel sits on top
      const pole = Pk.clone().addScaledVector(S, -(0.03));
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.01, H + 0.08, 0.01), null);
      mast.position.set(pole.x, base + (H + 0.08) / 2 - 0.01, pole.z); mast.userData.paint = 'solid';
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, 8, 20), MAT.metal);
      wheel.position.set(pole.x, base + H + 0.07, pole.z); wheel.rotation.y = P.psi;
      const cup = new THREE.Group(); cup.position.set(Pk.x, base, Pk.z); cup.rotation.y = exitPsi;
      const tip = new THREE.Group(); tip.position.set(0.016, 0, 0); cup.add(tip);
      const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.014, 0.018, 20, 1, true), MAT.yellow);
      bucket.material = MAT.yellow; bucket.position.set(-0.016, 0.009, 0);
      const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.002, 20), MAT.yellow);
      bottom.position.set(-0.016, 0.001, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.03), MAT.metal);
      arm.position.set(-0.016, 0.01, -0.025);
      tip.add(bucket, bottom, arm);
      dev.cup = cup; dev.tip = tip;
      B.meshes.push(mast, wheel, cup);
      B.pillarPts.push(V(pole.x, base - 0.012, pole.z));
      B.probes = [];
      for (let y = base + 0.04; y <= base + H + 0.06; y += 0.03) B.probes.push(V(pole.x, y, pole.z));
    },
  },
  pool: {
    label: 'Water Tub', kind: 'place', defaults: { size: 0.24, height: 0 },
    build(d, B) {
      const yaw = d.port.psi || 0, c = Math.cos(yaw), sn = Math.sin(yaw);
      const W = d.opts.size, D = W * 0.7, Hh = 0.075, t = 0.004, y0 = d.port.y + d.opts.height;
      const base = V(d.port.x, y0, d.port.z);
      // local (x along the tub, z across) → world
      const at = (lx, ly, lz) => V(base.x + lx * c + lz * sn, base.y + ly, base.z - lx * sn + lz * c);
      const wall = (lx, ly, lz, hx, hy, hz, mat) => {
        const p = at(lx, ly, lz);
        B.colliders.push(new BoxCollider(p.x, p.y, p.z, hx, hy, hz, yaw, SURFACES.plastic));
        const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), mat);
        m.position.copy(p); m.rotation.y = yaw;
        B.meshes.push(m);
      };
      wall(0, t / 2, 0, W / 2, t / 2, D / 2, null);
      wall(0, Hh / 2, D / 2 - t / 2, W / 2, Hh / 2, t / 2, MAT.acrylic);
      wall(0, Hh / 2, -D / 2 + t / 2, W / 2, Hh / 2, t / 2, MAT.acrylic);
      wall(W / 2 - t / 2, Hh / 2, 0, t / 2, Hh / 2, D / 2, MAT.acrylic);
      wall(-W / 2 + t / 2, Hh / 2, 0, t / 2, Hh / 2, D / 2, MAT.acrylic);
      for (const [lx, lz, w, dd] of [[0, D / 2, W, 0.008], [0, -D / 2, W, 0.008], [W / 2, 0, 0.008, D], [-W / 2, 0, 0.008, D]]) {
        const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.004, 0.006, dd + 0.004), null);
        rim.position.copy(at(lx, Hh, lz)); rim.rotation.y = yaw; rim.userData.paint = 'solid';
        B.meshes.push(rim);
      }
      const surf = y0 + Hh * 0.72;
      const water = new THREE.Mesh(new THREE.BoxGeometry(W - 2 * t, surf - y0 - t, D - 2 * t), MAT.water);
      water.position.copy(at(0, (surf - y0 + t) / 2, 0)); water.rotation.y = yaw;
      const duck = new THREE.Group();
      const db = new THREE.Mesh(new THREE.SphereGeometry(0.014, 14, 10), MAT.yellow); db.scale.set(1.25, 0.8, 1);
      const dh = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), MAT.yellow); dh.position.set(0.01, 0.012, 0);
      const bk = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.008, 8), MAT.orange); bk.rotation.z = -PI / 2; bk.position.set(0.021, 0.011, 0);
      duck.add(db, dh, bk); duck.position.copy(at(-W * 0.25, surf - y0 + 0.002, D * 0.15)); duck.rotation.y = yaw + 0.6;
      B.meshes.push(water, duck);
      B.water = [{ min: V(base.x - W / 2 + t, y0 + t, base.z - D / 2 + t), max: V(base.x + W / 2 - t, surf, base.z + D / 2 - t), surf, cx: base.x, cz: base.z, rc: Math.cos(yaw), rs: Math.sin(yaw) }];
      B.probes = [];
      for (const fx of [-0.5, 0, 0.5]) for (const fz of [-0.5, 0.5]) B.probes.push(at(fx * W, Hh * 0.5, fz * D));
    },
  },
  blocks: {
    label: 'Blocks', kind: 'place', defaults: { layers: 2, size: 2 },
    build(d, B) {
      const yaw = d.port.psi || 0, bs = 0.065, n = d.opts.layers, per = d.opts.size, side = per * bs, Hh = n * bs;
      const base = V(d.port.x, d.port.y, d.port.z);
      const holder = new THREE.Group(); holder.position.copy(base); holder.rotation.y = yaw;
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789';
      const cols = ['#ff6b6b', '#4c8dff', '#3ccf7a', '#ffd23f', '#9b6bff', '#ff9f43', '#ff77b7', '#2ec4b6'];
      let k = Math.abs(Math.round(base.x * 97 + base.z * 61));
      for (let i = 0; i < n; i++) for (let gx = 0; gx < per; gx++) for (let gz = 0; gz < per; gz++) {
        k++;
        const m = new THREE.Mesh(blockGeo(bs), blockMat(letters[k % letters.length], cols[k % cols.length]));
        m.position.set((gx - (per - 1) / 2) * bs, i * bs + bs / 2, (gz - (per - 1) / 2) * bs);
        m.rotation.y = ((k * 7) % 4) * PI / 2;
        if (i === n - 1) m.userData.place = true;
        holder.add(m);
      }
      B.meshes.push(holder);
      B.colliders.push(new BoxCollider(base.x, base.y + Hh / 2, base.z, side / 2, Hh / 2, side / 2, yaw, SURFACES.wood));
      B.blockBox = { c: V(base.x, base.y + Hh / 2, base.z), hx: side / 2, hy: Hh / 2, hz: side / 2, yaw };
      B.top = base.y + Hh;
    },
  },
  decor: {
    label: 'Decoration', kind: 'place', defaults: { kind: 'flags', height: 0 },
    build(d, B) {
      const yaw = d.port.psi || 0, base = V(d.port.x, d.port.y + (d.opts.height || 0), d.port.z), kind = d.opts.kind;
      const g = new THREE.Group(); g.position.copy(base); g.rotation.y = yaw;
      const toWorld = (x, y, z) => V(x, y, z).applyAxisAngle(UP, yaw).add(base);
      const pole = (x, z, hgt, r = 0.004) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.2, hgt, 10), null);
        m.position.set(x, hgt / 2, z); m.userData.paint = 'solid'; g.add(m);
        const f = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.006, 18), null);
        f.position.set(x, 0.003, z); f.userData.paint = 'solid'; g.add(f);
        const w = toWorld(x, 0, z);
        B.colliders.push(new CylinderCollider(w.x, w.z, base.y, base.y + hgt, r + 0.001, SURFACES.wood));
        for (let y = 0.03; y < hgt; y += 0.04) B.probes.push(toWorld(x, y, z));
      };
      B.probes = [];
      if (kind === 'flags') {
        pole(-0.15, 0, 0.24); pole(0.15, 0, 0.24);
        const cols = ['#ff6b6b', '#ffd23f', '#3ccf7a', '#4c8dff', '#9b6bff', '#ff77b7'];
        for (let i = 0; i < 9; i++) {
          const t = (i + 0.5) / 9, x = -0.15 + t * 0.3, y = 0.235 - Math.sin(t * PI) * 0.04;
          const tri = new THREE.Mesh(PENNANT, new THREE.MeshStandardMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide, roughness: 0.7 }));
          tri.position.set(x, y, 0); g.add(tri);
        }
        const cord = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(V(-0.15, 0.24, 0), V(0, 0.16, 0), V(0.15, 0.24, 0)), 16, 0.0012, 4), MAT.white);
        g.add(cord);
      } else if (kind === 'arch') {
        const cols = ['#ff6b6b', '#ffd23f', '#3ccf7a', '#4c8dff'];
        cols.forEach((col, i) => {
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.16 - i * 0.012, 0.0062, 8, 40, PI), new THREE.MeshStandardMaterial({ color: col, roughness: 0.75 }));
          g.add(band);
        });
        for (const sx of [-1, 1]) {
          const cl = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), MAT.white); cl.scale.set(1.2, 0.7, 0.8);
          cl.position.set(sx * 0.142, 0.012, 0); g.add(cl);
          B.probes.push(toWorld(sx * 0.142, 0.02, 0));
        }
      } else if (kind === 'lamp') {
        pole(0, 0, 0.2, 0.004);
        const globe = new THREE.Mesh(new THREE.SphereGeometry(0.022, 18, 12), MAT.lampGlow);
        globe.position.set(0, 0.215, 0); g.add(globe);
        const hat = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.02, 18), null); hat.position.set(0, 0.245, 0); hat.userData.paint = 'solid'; g.add(hat);
        B.glow = globe;
      } else if (kind === 'pinwheel') {
        pole(0, 0, 0.2, 0.003);
        const dev = new PinwheelDevice();
        const rotor = new THREE.Group(); rotor.position.set(0, 0.2, 0.008);
        const cols = ['#ff6b6b', '#ffd23f', '#3ccf7a', '#4c8dff'];
        for (let i = 0; i < 4; i++) {
          const blade = new THREE.Mesh(PINBLADE, new THREE.MeshStandardMaterial({ color: cols[i], side: THREE.DoubleSide, roughness: 0.6 }));
          blade.rotation.z = i * PI / 2; rotor.add(blade);
        }
        const pin = new THREE.Mesh(new THREE.SphereGeometry(0.005, 10, 8), MAT.white); rotor.add(pin);
        dev.rotor = rotor; g.add(rotor);
        B.devices.push(dev);
      } else {
        // a toy tree: stacked cones on a trunk
        pole(0, 0, 0.08, 0.009);
        [[0.07, 0.09, 0.075], [0.055, 0.08, 0.135], [0.038, 0.07, 0.185]].forEach(([r, hh, y]) => {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(r, hh, 16), MAT.leaf);
          cone.position.set(0, y, 0); g.add(cone);
          B.probes.push(toWorld(0, y, 0));
        });
      }
      B.meshes.push(g);
      B.decor = kind;
    },
  },
  bridge: {
    label: 'Connector', kind: 'connect', defaults: {},
    build(d, B, P) {
      const Q = portFromData(d.to);
      const T0 = dirOf(P.psi, P.phi), T1 = dirOf(Q.psi, Q.phi);
      const k = P.p.distanceTo(Q.p) * 1.1;
      const fn = (t) => {
        const t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
        return P.p.clone().multiplyScalar(h00).addScaledVector(T0, h10 * k).addScaledVector(Q.p, h01).addScaledVector(T1, h11 * k);
      };
      const s = curveSamples(fn);
      s[0].p.copy(P.p); last(s).p.copy(Q.p);
      B.paths.push({ samples: s, profile: d.style });
      B.outs.push({ p: Q.p.clone(), psi: Q.psi, phi: Q.phi });
    },
  },
};

// ---------------------------------------------------------------- building a piece instance
export function buildPiece(d) {
  const def = PIECES[d.type];
  const B = { paths: [], outs: [], ins: [], colliders: [], devices: [], meshes: [], pillarPts: [], spawn: null, releaseBtn: null };
  const P = d.port && def.kind !== 'place' ? portFromData(d.port) : null;
  if (P) B.ins.push(P);
  def.build(d, B, P);
  // colliders + meshes for swept paths
  const group = new THREE.Group();
  group.userData.pieceId = d.id;
  const color = d.color || 'wood';
  for (const path of B.paths) {
    const prof = PROFILES[path.profile] || PROFILES.channel;
    const prims = path.cut ? cutPrims(prof.prims, path.cut.side, path.cut.s0) : prof.prims;
    const pf = path.profile;
    const surf = path.surf || (pf === 'tube' ? SURFACES.glass : pf === 'rails' ? SURFACES.metal : (color === 'wood' || pf === 'ply') ? SURFACES.wood : SURFACES.plastic);
    const col = new SweepCollider(path.samples, prims, surf, { margin0: path.margin0, margin1: path.margin1, branchDev: path.branchDev, branchIdx: path.branchIdx, onRoll: path.onRoll });
    if (path.branchDev) path.branchDev.branches[path.branchIdx] = col;
    if (path.bind) path.bind(col);
    B.colliders.push(col);
    const style = pf === 'tube' || pf === 'ply' || pf === 'rails' ? pf : 'solid';
    const mesh = new THREE.Mesh(sweepGeometry(path.samples, prof, path.cut), trackMaterial(color, style));
    mesh.castShadow = pf !== 'tube'; mesh.receiveShadow = true;
    mesh.userData.pieceId = d.id;
    group.add(mesh);
    if (pf === 'rails') {
      const tg = railTies(path.samples, prof);
      if (tg) { const tm = new THREE.Mesh(tg, solidMat(color)); tm.castShadow = true; tm.userData.pieceId = d.id; group.add(tm); }
    }
    if (path.arch) {
      // a tunnel arch over the track, with chunky portals at both ends
      const am = new THREE.Mesh(sweepGeometry(path.samples, PROFILES.arch), trackMaterial(color, 'arch'));
      am.castShadow = true; am.receiveShadow = true; am.userData.pieceId = d.id;
      group.add(am);
      for (const sm of [path.samples[0], last(path.samples)]) {
        const portal = new THREE.Mesh(new THREE.TorusGeometry(0.039, 0.007, 8, 24, PI + 0.3), solidMat(color));
        const R = V().crossVectors(sm.T, sm.U);
        portal.matrixAutoUpdate = false;
        portal.matrix.makeBasis(R, sm.U, sm.T).multiply(new THREE.Matrix4().makeRotationZ(-0.15)).setPosition(sm.p.clone().addScaledVector(sm.U, -0.014));
        portal.userData.pieceId = d.id;
        group.add(portal);
      }
    }
    if (path.profile === 'tube') {
      // colored collars at both ends of a tube
      for (const sm of [path.samples[0], last(path.samples)]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(RC + TH, 0.0025, 8, 24), solidMat(color));
        ring.position.copy(sm.p); ring.quaternion.setFromUnitVectors(V(0, 0, 1), sm.T);
        group.add(ring);
      }
    }
    if (!B.noPillars && !path.noAuto) {
      // supports for the track itself; nearby duplicates are dropped later
      B.autoPillars = B.autoPillars || new Set();
      const len = last(path.samples).s;
      const pts = [];
      for (let sv = Math.min(0.2, len * 0.5); sv <= len - 0.1; sv += 0.45) pts.push(sv);
      if (len > 0.25) pts.push(len - 0.03);
      for (const sv of pts) {
        const sm = path.samples.reduce((a, c) => Math.abs(c.s - sv) < Math.abs(a.s - sv) ? c : a);
        if (sm.U.y > 0.85 && path.profile !== 'tube') {
          const q = sm.p.clone().addScaledVector(sm.U, -(RC + TH));
          B.pillarPts.push(q); B.autoPillars.add(q);
        }
      }
    }
  }
  for (const m of B.meshes) {
    m.traverse(o => {
      if (!o.isMesh || o.material) return;
      const paint = o.userData.paint;
      if (paint === 'spiral') {
        const key = 'spiral|' + color;
        if (!matCache.has(key)) matCache.set(key, new THREE.MeshPhysicalMaterial({ map: TX.spiralTexture(COLORS[color] || COLORS.wood, '#ffffff'), roughness: 0.35, clearcoat: 0.6, side: THREE.DoubleSide }));
        o.material = matCache.get(key);
      }
      else if (paint === 'wood') o.material = trackMaterial('wood', 'solid');
      else o.material = solidMat(color);
    });
    m.traverse(o => { if (o.isMesh && !o.isInstancedMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } o.userData.pieceId = d.id; });
    group.add(m);
  }
  return { d, group, B, colliders: B.colliders, devices: B.devices, outs: B.outs, ins: B.ins, paths: B.paths, spawn: B.spawn, releaseBtn: B.releaseBtn, pillars: null };
}

// sample points used for overlap tests
export function pieceProbePoints(inst) {
  const pts = [];
  for (const path of inst.paths) for (let i = 0; i < path.samples.length; i += 2) pts.push(path.samples[i].p);
  if (inst.B.probes) pts.push(...inst.B.probes);
  return pts;
}
function ringProbes(B, c, R, y, n) {
  B.probes = B.probes || [];
  for (let i = 0; i < n; i++) { const a = i / n * TAU; B.probes.push(V(c.x + Math.cos(a) * R, y, c.z + Math.sin(a) * R)); }
}

function inBlock(k, p, pad) {
  const dx = p.x - k.c.x, dz = p.z - k.c.z, c = Math.cos(k.yaw), s = Math.sin(k.yaw);
  return Math.abs(c * dx - s * dz) < k.hx + pad && Math.abs(s * dx + c * dz) < k.hz + pad && Math.abs(p.y - k.c.y) < k.hy + pad;
}
// returns null when OK or a reason string
export function validatePiece(inst, others, roomColliders) {
  validatePiece.hit = null; // [other piece id or null, where] — for showing what it bumps into
  const pts = [];
  for (const path of inst.paths) for (let i = 0; i < path.samples.length; i += 2) pts.push(path.samples[i].p);
  for (const p of inst.B.solidPts || []) pts.push(p); // pieces without a track (the plinko board) must clear floor and furniture too
  const skip = [];
  if (inst.d.port && PIECES[inst.d.type].kind !== 'place') skip.push(portFromData(inst.d.port).p);
  if (inst.d.to) skip.push(portFromData(inst.d.to).p);
  const near = (p, r) => skip.some(s => p.distanceTo(s) < r);
  const clearR = RC + TH - 0.001;
  for (const p of pts) {
    if (p.y < RC + TH + 0.004) { validatePiece.hit = [null, p.clone()]; return 'Too low — it would go through the floor'; }
    if (near(p, 0.05)) continue;
    if (roomClearance(roomColliders, p.x, p.y, p.z) < clearR) { validatePiece.hit = [null, p.clone()]; return 'Bumps into furniture'; }
  }
  const own = new Set(inst.B.probes || []);
  const all = pts.concat(inst.B.probes || []);
  for (const o of others) {
    if (o.B.blockBox) { const p = pts.find(q => inBlock(o.B.blockBox, q, clearR)); if (p) { validatePiece.hit = [o.d.id, p.clone()]; return 'Bumps into the blocks'; } }
    if (inst.B.blockBox && pieceProbePoints(o).some(p => inBlock(inst.B.blockBox, p, 0.004))) return 'Overlaps another track';
    const op = pieceProbePoints(o);
    for (const p of all) {
      if (near(p, own.has(p) ? 0.11 : 0.06)) continue;
      for (const q of op) if (p.distanceToSquared(q) < 0.034 * 0.034) { validatePiece.hit = [o.d.id, p, q]; return 'Overlaps another track'; }
    }
  }
  for (const path of inst.paths) for (const s of path.samples) if (s.p.y > 2.4) return 'Too high!';
  return null;
}

// support pillars from points down to the first surface below
// toy-kit supports: a cream post with height notches, a coloured foot, and a clip that
// hugs the track from below. Returns a group, or null when nothing needs holding up.
export function buildPillars(inst, raycaster, targets, taken = []) {
  const posts = [], accents = [];
  const down = V(0, -1, 0);
  const S = V(), m4 = new THREE.Matrix4();
  for (const p of inst.B.pillarPts) {
    const auto = inst.B.autoPillars?.has(p);
    // a support already stands right here (e.g. where two pieces meet): skip this one
    if (auto && taken.some(t => (t.x - p.x) ** 2 + (t.z - p.z) ** 2 < 0.15 * 0.15 && Math.abs(t.y - p.y) < 0.08)) continue;
    taken.push(p);
    let best = null, sm = null;
    const tries = [V(0, 0, 0)];
    // try sideways offsets when the straight drop would land on another track
    const path = inst.paths[0];
    if (path) {
      sm = path.samples.reduce((a, c) => a.p.distanceToSquared(p) < c.p.distanceToSquared(p) ? a : c);
      S.crossVectors(sm.T, sm.U).setY(0);
      if (S.lengthSq() > 1e-6) { S.normalize(); tries.push(S.clone().multiplyScalar(0.034), S.clone().multiplyScalar(-0.034)); }
    }
    for (const off of tries) {
      const o = p.clone().add(off).add(V(0, -0.004, 0));
      raycaster.set(o, down); raycaster.far = 3;
      const hit = raycaster.intersectObjects(targets, true).find(h => h.object.userData.pieceId !== inst.d.id);
      if (!hit) continue;
      const onTrack = hit.object.userData.pieceId !== undefined;
      const cand = { off, top: o, y: hit.point.y, onTrack };
      if (!best || (best.onTrack && !onTrack)) best = cand;
      if (!onTrack) break;
    }
    if (!best) continue;
    const len = best.top.y - best.y;
    if (len < 0.006) continue;
    const { x, z } = best.top;
    const post = new THREE.CylinderGeometry(0.0085, 0.0085, len, 16);
    post.translate(x, best.y + len / 2, z);
    posts.push(post);
    // notches every 3 cm, like stackable height pieces
    for (let h = 0.03; h < len - 0.012; h += 0.03) {
      const ring = new THREE.CylinderGeometry(0.0099, 0.0099, 0.0036, 16);
      ring.translate(x, best.y + h, z);
      posts.push(ring);
    }
    if (!best.onTrack) {
      const foot = new THREE.CylinderGeometry(0.016, 0.02, 0.007, 28);
      foot.translate(x, best.y + 0.003, z);
      accents.push(foot);
    }
    if (best.off.lengthSq() > 0) {
      const mid = p.clone().addScaledVector(best.off, 0.5), bl = best.off.length();
      const arm = new THREE.BoxGeometry(bl + 0.01, 0.008, 0.01);
      arm.rotateY(Math.atan2(-best.off.z, best.off.x));
      arm.translate(mid.x, p.y - 0.004, mid.z);
      posts.push(arm);
    }
    // the clip: a saddle under the channel with two cheeks up its sides
    if (auto && sm) {
      const R = V().crossVectors(sm.T, sm.U);
      m4.makeBasis(sm.T, sm.U, R).setPosition(p);
      const w = RC + TH + 0.0025;
      const saddle = new THREE.BoxGeometry(0.018, 0.006, w * 2 + 0.004);
      saddle.translate(0, -0.002, 0);
      saddle.applyMatrix4(m4); accents.push(saddle);
      for (const sx of [-1, 1]) {
        const cheek = new THREE.BoxGeometry(0.018, 0.016, 0.004);
        cheek.translate(0, 0.006, sx * (w + 0.0005));
        cheek.applyMatrix4(m4); accents.push(cheek);
      }
    }
  }
  // a spiral's tower: a fat post in the middle from the floor to the top, spokes out to the track
  const col = inst.B.column;
  if (col) {
    const top = Math.max(...col.samples.map(q => q.p.y)) - RC - TH;
    raycaster.set(V(col.x, top, col.z), down); raycaster.far = 3;
    const hit = raycaster.intersectObjects(targets, true).find(h => h.object.userData.pieceId !== inst.d.id);
    const base = hit ? hit.point.y : 0, len = top - base;
    if (len > 0.01) {
      const tower = new THREE.CylinderGeometry(0.012, 0.012, len, 20);
      tower.translate(col.x, base + len / 2, col.z); posts.push(tower);
      for (let h = 0.03; h < len - 0.012; h += 0.03) { const ring = new THREE.CylinderGeometry(0.0138, 0.0138, 0.004, 20); ring.translate(col.x, base + h, col.z); posts.push(ring); }
      const cap = new THREE.CylinderGeometry(0.016, 0.014, 0.008, 20); cap.translate(col.x, top + 0.004, col.z); accents.push(cap);
      if (!hit || hit.object.userData.pieceId === undefined) { const foot = new THREE.CylinderGeometry(0.024, 0.028, 0.008, 28); foot.translate(col.x, base + 0.004, col.z); accents.push(foot); }
      // a spoke every third of a turn, from the tower to the underside of the channel
      for (let sv = col.step * 0.5; sv < col.samples[col.samples.length - 1].s - 0.02; sv += col.step) {
        const q = col.samples.reduce((a, c) => Math.abs(c.s - sv) < Math.abs(a.s - sv) ? c : a);
        const under = q.p.clone().addScaledVector(q.U, -(RC + TH));
        const dx = under.x - col.x, dz = under.z - col.z, dist = Math.hypot(dx, dz);
        if (dist < 0.02) continue;
        const spoke = new THREE.BoxGeometry(dist - 0.008, 0.007, 0.01);
        spoke.rotateY(Math.atan2(-dz, dx));
        spoke.translate((col.x + under.x) / 2, under.y - 0.004, (col.z + under.z) / 2);
        posts.push(spoke);
        const clip = new THREE.BoxGeometry(0.016, 0.006, (RC + TH) * 2 + 0.004);
        const R = V().crossVectors(q.T, q.U);
        clip.applyMatrix4(m4.makeBasis(q.T, q.U, R).setPosition(under));
        accents.push(clip);
      }
    }
  }
  if (!posts.length) return null;
  const group = new THREE.Group();
  const make = (geos, mat) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = true; m.receiveShadow = true;
    geos.forEach(g => g.dispose());
    group.add(m);
  };
  make(posts, MAT.kit);
  make(accents, solidMat(inst.d.color || 'wood'));
  return group;
}

export function disposeGroup(g) {
  g.traverse(o => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
}
