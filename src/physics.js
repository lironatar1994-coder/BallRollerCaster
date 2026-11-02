// Ball Coaster physics engine.
// Rigid rolling spheres (linear + angular momentum) against analytic geometry:
// swept track profiles, surfaces of revolution, boxes, cylinders, spheres and planes.
// Fixed 1 kHz sub-stepping, impulse-based contacts with restitution, Coulomb friction,
// rolling resistance, quadratic air drag and Magnus lift.
import * as THREE from 'three';

export const DT = 1 / 1000;
const TAU = Math.PI * 2;

// Surface materials. e = restitution factor, mu = friction, crr = rolling resistance.
export const SURFACES = {
  wood:       { e: 0.86, mu: 0.55, crr: 0.0025, sound: 'wood' },
  plastic:    { e: 0.92, mu: 0.40, crr: 0.0018, sound: 'plastic' },
  glass:      { e: 0.92, mu: 0.30, crr: 0.0012, sound: 'glass' },
  floor:      { e: 0.80, mu: 0.50, crr: 0.0040, sound: 'floor' },
  carpet:     { e: 0.30, mu: 0.90, crr: 0.0600, sound: 'soft' },
  soft:       { e: 0.15, mu: 0.90, crr: 0.2500, sound: 'soft' },
  wall:       { e: 0.70, mu: 0.50, crr: 0.0100, sound: 'wall' },
  trampoline: { e: 1.00, override: 0.9, mu: 0.80, crr: 0.0200, sound: 'boing' },
  metal:      { e: 0.85, mu: 0.30, crr: 0.0015, sound: 'metal' },
  bumper:     { e: 0.90, mu: 0.40, crr: 0.0030, sound: 'bumper', kick: 0.9 },
  bell:       { e: 0.85, mu: 0.30, crr: 0.0020, sound: 'bell' },
};

// Ball kinds — no steel here. k = I / (m r²): 2/5 solid sphere, 2/3 thin shell.
export const BALL_TYPES = {
  glass:   { name: 'Glass Marble',   radius: 0.0115, density: 2500, k: 0.4,   restitution: 0.66, friction: 0.35, rolling: 0.0012, cd: 0.47, desc: 'Heavy, slick & fast. The classic.' },
  wood:    { name: 'Wooden Ball',    radius: 0.0120, density: 650,  k: 0.4,   restitution: 0.48, friction: 0.55, rolling: 0.0035, cd: 0.47, desc: 'Light and grippy. Soft clacks.' },
  rubber:  { name: 'Bouncy Ball',    radius: 0.0110, density: 1100, k: 0.4,   restitution: 0.90, friction: 0.95, rolling: 0.0090, cd: 0.47, desc: 'Boing! Bounces off everything.' },
  plastic: { name: 'Hollow Plastic', radius: 0.0120, mass: 0.0017,  k: 2 / 3, restitution: 0.62, friction: 0.30, rolling: 0.0025, cd: 0.50, desc: 'Feather-light. Air drag & spin matter.' },
  clay:    { name: 'Clay Ball',      radius: 0.0115, density: 1700, k: 0.4,   restitution: 0.06, friction: 0.80, rolling: 0.0220, cd: 0.47, desc: 'Squishy. Zero bounce, lazy roller.' },
};

// ---------------------------------------------------------------- contacts
const MAXC = 24;
const C_NX = new Float64Array(MAXC), C_NY = new Float64Array(MAXC), C_NZ = new Float64Array(MAXC), C_D = new Float64Array(MAXC);
const C_S = new Array(MAXC), C_C = new Array(MAXC), C_B = new Array(MAXC);
const C_PX = new Float64Array(MAXC), C_PY = new Float64Array(MAXC), C_PZ = new Float64Array(MAXC);
// per-contact normal impulse and accumulated friction impulse (for the iterative friction solve)
const C_JN = new Float64Array(MAXC), C_AX = new Float64Array(MAXC), C_AY = new Float64Array(MAXC), C_AZ = new Float64Array(MAXC);
let nC = 0;
// body/px.. are only given for contacts with moving parts (they get the reaction impulse)
function addContact(nx, ny, nz, depth, surf, col, body, px, py, pz) {
  if (nC >= MAXC) return;
  C_NX[nC] = nx; C_NY[nC] = ny; C_NZ[nC] = nz; C_D[nC] = depth; C_S[nC] = surf; C_C[nC] = col;
  C_B[nC] = body || null;
  if (body) { C_PX[nC] = px; C_PY[nC] = py; C_PZ[nC] = pz; }
  nC++;
}
const VS = new THREE.Vector3();

// ---------------------------------------------------------------- 2D profile primitives
// A profile is a list of segments / arcs in a local 2D plane. Used for swept tracks (u = right, v = up)
// and surfaces of revolution (u = radius, v = height).
export function seg(ax, ay, bx, by, extra) {
  const ex = bx - ax, ey = by - ay;
  return Object.assign({ t: 0, ax, ay, bx, by, il2: 1 / Math.max(1e-12, ex * ex + ey * ey) }, extra);
}
export function arc(cx, cy, R, a0, a1, extra) {
  return Object.assign({ t: 1, cx, cy, R, a0, span: a1 - a0, full: a1 - a0 >= TAU - 1e-9 }, extra);
}
export function polyline(pts, extra) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) out.push(seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], extra));
  return out;
}
export function profileExtent(prims) {
  let m = 0;
  for (const p of prims) {
    if (p.t === 0) m = Math.max(m, Math.hypot(p.ax, p.ay), Math.hypot(p.bx, p.by));
    else m = Math.max(m, Math.hypot(p.cx, p.cy) + p.R);
  }
  return m;
}

const P_NU = new Float64Array(MAXC), P_NV = new Float64Array(MAXC), P_D = new Float64Array(MAXC);
let qx = 0, qy = 0;
function closestOnPrim(pr, u, v) {
  if (pr.t === 0) {
    const ex = pr.bx - pr.ax, ey = pr.by - pr.ay;
    let t = ((u - pr.ax) * ex + (v - pr.ay) * ey) * pr.il2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    qx = pr.ax + ex * t; qy = pr.ay + ey * t;
  } else {
    let ang = Math.atan2(v - pr.cy, u - pr.cx);
    if (!pr.full) {
      let a = ang - pr.a0;
      a -= Math.floor(a / TAU) * TAU;
      if (a > pr.span) a = (a - pr.span < TAU - a) ? pr.span : 0;
      ang = pr.a0 + a;
    }
    qx = pr.cx + pr.R * Math.cos(ang); qy = pr.cy + pr.R * Math.sin(ang);
  }
}
// fills P_NU/P_NV/P_D, returns count
function profileContacts(prims, u, v, r, s, theta) {
  let n = 0;
  const r2 = r * r;
  for (let k = 0; k < prims.length; k++) {
    const pr = prims[k];
    if (pr.s0 !== undefined && (s < pr.s0 || s > pr.s1)) continue;
    if (pr.gap) {
      let a = theta - pr.gap[0];
      a -= Math.floor(a / TAU) * TAU;
      if (a < pr.gap[1] - pr.gap[0]) continue;
    }
    closestOnPrim(pr, u, v);
    const du = u - qx, dv = v - qy;
    const d2 = du * du + dv * dv;
    if (d2 >= r2) continue;
    const d = Math.sqrt(d2);
    if (d < 1e-9) { P_NU[n] = 0; P_NV[n] = 1; } else { P_NU[n] = du / d; P_NV[n] = dv / d; }
    P_D[n] = r - d;
    if (++n >= MAXC) break;
  }
  return n;
}

// ---------------------------------------------------------------- colliders
let STAMP = 1;

export class PlaneCollider {
  constructor(nx, ny, nz, d, surf) {
    this.global = true; this.nx = nx; this.ny = ny; this.nz = nz; this.d = d; this.surf = surf;
  }
  collide(b) {
    const p = b.pos;
    const dist = this.nx * p.x + this.ny * p.y + this.nz * p.z - this.d;
    if (dist < b.r) addContact(this.nx, this.ny, this.nz, b.r - dist, this.surf, this);
  }
  sdf(x, y, z) { return this.nx * x + this.ny * y + this.nz * z - this.d; }
}

export class BoxCollider {
  // axis-aligned in local space, rotated by yaw around +Y
  constructor(cx, cy, cz, hx, hy, hz, yaw, surf) {
    this.cx = cx; this.cy = cy; this.cz = cz; this.hx = hx; this.hy = hy; this.hz = hz;
    this.c = Math.cos(yaw || 0); this.s = Math.sin(yaw || 0); this.surf = surf;
    const ex = Math.abs(this.c) * hx + Math.abs(this.s) * hz, ez = Math.abs(this.s) * hx + Math.abs(this.c) * hz;
    this.min = new THREE.Vector3(cx - ex, cy - hy, cz - ez);
    this.max = new THREE.Vector3(cx + ex, cy + hy, cz + ez);
  }
  collide(b) {
    const p = b.pos, r = b.r;
    const dx = p.x - this.cx, dy = p.y - this.cy, dz = p.z - this.cz;
    const lx = this.c * dx - this.s * dz, lz = this.s * dx + this.c * dz, ly = dy;
    const hx = this.hx, hy = this.hy, hz = this.hz;
    const qx_ = lx < -hx ? -hx : lx > hx ? hx : lx;
    const qy_ = ly < -hy ? -hy : ly > hy ? hy : ly;
    const qz_ = lz < -hz ? -hz : lz > hz ? hz : lz;
    let nx, ny, nz, depth;
    const ex = lx - qx_, ey = ly - qy_, ez = lz - qz_;
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 > 1e-14) {
      if (d2 >= r * r) return;
      const d = Math.sqrt(d2);
      nx = ex / d; ny = ey / d; nz = ez / d; depth = r - d;
    } else {
      const px = hx - Math.abs(lx), py = hy - Math.abs(ly), pz = hz - Math.abs(lz);
      if (px < py && px < pz) { nx = Math.sign(lx) || 1; ny = 0; nz = 0; depth = px + r; }
      else if (py < pz) { nx = 0; ny = Math.sign(ly) || 1; nz = 0; depth = py + r; }
      else { nx = 0; ny = 0; nz = Math.sign(lz) || 1; depth = pz + r; }
    }
    addContact(this.c * nx + this.s * nz, ny, -this.s * nx + this.c * nz, depth, this.surf, this);
  }
  sdf(x, y, z) {
    const dx = x - this.cx, dy = y - this.cy, dz = z - this.cz;
    const lx = Math.abs(this.c * dx - this.s * dz) - this.hx, ly = Math.abs(dy) - this.hy, lz = Math.abs(this.s * dx + this.c * dz) - this.hz;
    const ox = Math.max(lx, 0), oy = Math.max(ly, 0), oz = Math.max(lz, 0);
    return Math.hypot(ox, oy, oz) + Math.min(Math.max(lx, ly, lz), 0);
  }
}

export class SphereCollider {
  constructor(cx, cy, cz, R, surf) {
    this.cx = cx; this.cy = cy; this.cz = cz; this.R = R; this.surf = surf;
    this.min = new THREE.Vector3(cx - R, cy - R, cz - R); this.max = new THREE.Vector3(cx + R, cy + R, cz + R);
  }
  collide(b) {
    const dx = b.pos.x - this.cx, dy = b.pos.y - this.cy, dz = b.pos.z - this.cz;
    const rr = this.R + b.r, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= rr * rr || d2 < 1e-14) return;
    const d = Math.sqrt(d2);
    addContact(dx / d, dy / d, dz / d, rr - d, this.surf, this);
  }
  sdf(x, y, z) { return Math.hypot(x - this.cx, y - this.cy, z - this.cz) - this.R; }
}

export class CylinderCollider {
  // vertical solid cylinder
  constructor(cx, cz, y0, y1, R, surf) {
    this.cx = cx; this.cz = cz; this.y0 = y0; this.y1 = y1; this.R = R; this.surf = surf;
    this.min = new THREE.Vector3(cx - R, y0, cz - R); this.max = new THREE.Vector3(cx + R, y1, cz + R);
  }
  collide(b) {
    const p = b.pos, r = b.r, R = this.R;
    const dx = p.x - this.cx, dz = p.z - this.cz, rho = Math.hypot(dx, dz);
    const inR = rho < R, inY = p.y > this.y0 && p.y < this.y1;
    if (inR && inY) {
      const ps = R - rho, pt = this.y1 - p.y, pb = p.y - this.y0;
      if (pt < ps && pt < pb) addContact(0, 1, 0, pt + r, this.surf, this);
      else if (pb < ps) addContact(0, -1, 0, pb + r, this.surf, this);
      else { const ix = rho > 1e-9 ? dx / rho : 1, iz = rho > 1e-9 ? dz / rho : 0; addContact(ix, 0, iz, ps + r, this.surf, this); }
      return;
    }
    let qx_ = dx, qz_ = dz;
    if (!inR) { qx_ = dx / rho * R; qz_ = dz / rho * R; }
    const qy_ = p.y < this.y0 ? this.y0 : p.y > this.y1 ? this.y1 : p.y;
    const ex = dx - qx_, ey = p.y - qy_, ez = dz - qz_;
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 >= r * r || d2 < 1e-14) return;
    const d = Math.sqrt(d2);
    addContact(ex / d, ey / d, ez / d, r - d, this.surf, this);
  }
  sdf(x, y, z) {
    const dr = Math.hypot(x - this.cx, z - this.cz) - this.R;
    const dy = Math.max(this.y0 - y, y - this.y1);
    return Math.hypot(Math.max(dr, 0), Math.max(dy, 0)) + Math.min(Math.max(dr, dy), 0);
  }
}

// Surface of revolution around an axis; profile is in (radius, height) space.
export class RevolveCollider {
  constructor(center, axis, e1, prims, surf, opts = {}) {
    this.c = center.clone(); this.a = axis.clone().normalize();
    this.e1 = e1.clone().normalize(); this.e2 = new THREE.Vector3().crossVectors(this.a, this.e1);
    this.prims = prims; this.surf = surf;
    this.hasGap = prims.some(p => p.gap);
    this.device = opts.device || null;
    this.onTouch = opts.onTouch || null;
    const m = profileExtent(prims) + 0.02;
    this.min = new THREE.Vector3(center.x - m, center.y - m, center.z - m);
    this.max = new THREE.Vector3(center.x + m, center.y + m, center.z + m);
  }
  collide(b, world) {
    const a = this.a, p = b.pos;
    const dx = p.x - this.c.x, dy = p.y - this.c.y, dz = p.z - this.c.z;
    const h = dx * a.x + dy * a.y + dz * a.z;
    let rx = dx - a.x * h, ry = dy - a.y * h, rz = dz - a.z * h;
    const rho = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (rho > 1e-9) { rx /= rho; ry /= rho; rz /= rho; } else { rx = this.e1.x; ry = this.e1.y; rz = this.e1.z; }
    let theta = 0;
    if (this.hasGap) {
      const e1 = this.e1, e2 = this.e2;
      theta = Math.atan2(rx * e2.x + ry * e2.y + rz * e2.z, rx * e1.x + ry * e1.y + rz * e1.z);
    }
    const n = profileContacts(this.prims, rho, h, b.r, 0, theta);
    for (let k = 0; k < n; k++) {
      const nu = P_NU[k], nv = P_NV[k];
      addContact(rx * nu + a.x * nv, ry * nu + a.y * nv, rz * nu + a.z * nv, P_D[k], this.surf, this);
    }
    if (n > 0 && this.onTouch) this.onTouch(world, b, this);
  }
}

// A 2D profile swept along a sampled centerline with frames (T forward, U up, R = T x U right).
export class SweepCollider {
  constructor(samples, prims, surf, opts = {}) {
    const n = samples.length;
    this.n = n;
    this.P = new Float64Array(n * 3); this.T = new Float64Array(n * 3); this.U = new Float64Array(n * 3);
    this.S = new Float64Array(n); this.L = new Float64Array(n);
    const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      this.P[i * 3] = s.p.x; this.P[i * 3 + 1] = s.p.y; this.P[i * 3 + 2] = s.p.z;
      this.T[i * 3] = s.T.x; this.T[i * 3 + 1] = s.T.y; this.T[i * 3 + 2] = s.T.z;
      this.U[i * 3] = s.U.x; this.U[i * 3 + 1] = s.U.y; this.U[i * 3 + 2] = s.U.z;
      this.S[i] = s.s;
      min.min(s.p); max.max(s.p);
    }
    for (let i = 0; i < n - 1; i++) this.L[i] = this.S[i + 1] - this.S[i];
    this.prims = prims; this.surf = surf;
    this.ext = profileExtent(prims);
    const m = this.ext + 0.02;
    this.min = min.subScalar(m); this.max = max.addScalar(m);
    this.m0 = opts.margin0 ?? 0.003; this.m1 = opts.margin1 ?? 0.003;
    this.branchDev = opts.branchDev || null; this.branchIdx = opts.branchIdx || 0;
    this.onRoll = opts.onRoll || null;
    this.device = opts.device || null;
    this.length = this.S[n - 1];
  }
  segD2(i, px, py, pz) {
    const P = this.P, a = i * 3, b = a + 3;
    const ex = P[b] - P[a], ey = P[b + 1] - P[a + 1], ez = P[b + 2] - P[a + 2];
    const wx = px - P[a], wy = py - P[a + 1], wz = pz - P[a + 2];
    const l2 = ex * ex + ey * ey + ez * ez;
    let t = l2 > 0 ? (wx * ex + wy * ey + wz * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    this._t = t;
    const dx = wx - ex * t, dy = wy - ey * t, dz = wz - ez * t;
    return dx * dx + dy * dy + dz * dz;
  }
  nearest(ce, px, py, pz) {
    const ns = this.n - 1;
    let i = ce.i, best;
    if (i < 0 || i >= ns) {
      best = Infinity; i = 0;
      for (let k = 0; k < ns; k++) { const d = this.segD2(k, px, py, pz); if (d < best) { best = d; i = k; } }
    } else {
      best = this.segD2(i, px, py, pz);
      while (i + 1 < ns) { const d = this.segD2(i + 1, px, py, pz); if (d < best) { best = d; i++; } else break; }
      while (i > 0) { const d = this.segD2(i - 1, px, py, pz); if (d < best) { best = d; i--; } else break; }
    }
    best = this.segD2(i, px, py, pz);
    ce.i = i;
    return best;
  }
  // world-space query used by the ghost / overlap checks and by switch logic
  collide(b, world) {
    if (this.branchDev && !this.branchDev.allow(world, b, this.branchIdx)) return;
    let ce = b.cache.get(this);
    if (!ce) { ce = { i: -1, far: 0, ls: -1 }; b.cache.set(this, ce); }
    const p = b.pos;
    const d2 = this.nearest(ce, p.x, p.y, p.z);
    const lim = this.ext + b.r;
    if (d2 > lim * lim) { if ((++ce.far & 15) === 0) ce.i = -1; return; }
    ce.far = 0;
    const i = ce.i, t = this._t, a = i * 3, bb = a + 3;
    const P = this.P, T = this.T, U = this.U;
    const cx = P[a] + (P[bb] - P[a]) * t, cy = P[a + 1] + (P[bb + 1] - P[a + 1]) * t, cz = P[a + 2] + (P[bb + 2] - P[a + 2]) * t;
    let tx = T[a] + (T[bb] - T[a]) * t, ty = T[a + 1] + (T[bb + 1] - T[a + 1]) * t, tz = T[a + 2] + (T[bb + 2] - T[a + 2]) * t;
    let il = 1 / Math.hypot(tx, ty, tz); tx *= il; ty *= il; tz *= il;
    let ux = U[a] + (U[bb] - U[a]) * t, uy = U[a + 1] + (U[bb + 1] - U[a + 1]) * t, uz = U[a + 2] + (U[bb + 2] - U[a + 2]) * t;
    const ut = ux * tx + uy * ty + uz * tz; ux -= tx * ut; uy -= ty * ut; uz -= tz * ut;
    il = 1 / Math.hypot(ux, uy, uz); ux *= il; uy *= il; uz *= il;
    const rx = ty * uz - tz * uy, ry = tz * ux - tx * uz, rz = tx * uy - ty * ux;
    const wx = p.x - cx, wy = p.y - cy, wz = p.z - cz;
    const along = wx * tx + wy * ty + wz * tz;
    if (i === 0 && t <= 0 && along < -this.m0) return;
    if (i === this.n - 2 && t >= 1 && along > this.m1) return;
    const s = this.S[i] + t * this.L[i];
    const u = wx * rx + wy * ry + wz * rz, v = wx * ux + wy * uy + wz * uz;
    const n = profileContacts(this.prims, u, v, b.r, s, 0);
    for (let k = 0; k < n; k++) {
      const nu = P_NU[k], nv = P_NV[k];
      addContact(rx * nu + ux * nv, ry * nu + uy * nv, rz * nu + uz * nv, P_D[k], this.surf, this);
    }
    if (n > 0) {
      // remember the track frame under the ball (smooth ride camera, kid-mode helper)
      b.tkT = world.time; b.tkCol = this; b.tkS = s;
      b.tkx = tx; b.tky = ty; b.tkz = tz; b.tux = ux; b.tuy = uy; b.tuz = uz;
      if (this.onRoll) this.onRoll(world, b, s, ce);
    }
  }
  // centerline point at arc length s (extrapolated past the ends)
  pointAt(s, out) {
    const S = this.S, P = this.P, T = this.T, n = this.n;
    if (s <= 0) return out.set(P[0] + T[0] * s, P[1] + T[1] * s, P[2] + T[2] * s);
    if (s >= S[n - 1]) { const e = s - S[n - 1], a = (n - 1) * 3; return out.set(P[a] + T[a] * e, P[a + 1] + T[a + 1] * e, P[a + 2] + T[a + 2] * e); }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S[mid] <= s) lo = mid; else hi = mid; }
    const f = (s - S[lo]) / Math.max(1e-9, S[hi] - S[lo]), a = lo * 3, c = hi * 3;
    return out.set(P[a] + (P[c] - P[a]) * f, P[a + 1] + (P[c + 1] - P[a + 1]) * f, P[a + 2] + (P[c + 2] - P[a + 2]) * f);
  }
}

// ---------------------------------------------------------------- moving parts
// A rigid part that turns about a fixed axis (water-wheel, seesaw, domino). It is pushed by
// the balls through contact impulses and by gravity on its own centre of mass.
export class RotorBody {
  constructor(o) {
    Object.assign(this, { damping: 0, friction: 0, mass: 0, com: [0, 0], min: -Infinity, max: Infinity, th0: 0, spring: 0, rest: 0, bounce: 0.2, surf: SURFACES.wood }, o);
    this.axis = this.axis.clone().normalize();
    this.e1 = this.e1.clone().normalize();
    this.e2 = new THREE.Vector3().crossVectors(this.axis, this.e1);
    let R = 0;
    for (const bx of this.boxes) {
      bx.c = Math.cos(bx.phi || 0); bx.s = Math.sin(bx.phi || 0);
      R = Math.max(R, Math.hypot(bx.x, bx.y, bx.z || 0) + Math.hypot(bx.hu, bx.hv, bx.hw));
    }
    this.R = R;
    this.collider = new RotorCollider(this);
  }
  initState() { return { th: this.th0, w: 0, hitW: 0 }; }
  update(world) { if (this.view) this.view(world.devState(this).th); }
  basis(th, E1, E2) {
    const c = Math.cos(th), s = Math.sin(th), e1 = this.e1, e2 = this.e2;
    E1.set(e1.x * c + e2.x * s, e1.y * c + e2.y * s, e1.z * c + e2.z * s);
    E2.set(-e1.x * s + e2.x * c, -e1.y * s + e2.y * c, -e1.z * s + e2.z * c);
  }
  step(world, dt) {
    const st = world.devState(this), a = this.axis;
    let tau = -this.damping * st.w;
    if (this.mass) {
      this.basis(st.th, _E1, _E2);
      const rx = _E1.x * this.com[0] + _E2.x * this.com[1], rz = _E1.z * this.com[0] + _E2.z * this.com[1];
      const mg = this.mass * world.g;
      tau += mg * (rz * a.x - rx * a.z);
    }
    if (this.spring) tau -= this.spring * (st.th - this.rest);
    st.w += tau / this.J * dt;
    if (this.friction) { const f = this.friction / this.J * dt; st.w = Math.abs(st.w) <= f ? 0 : st.w - Math.sign(st.w) * f; }
    st.th += st.w * dt;
    if (st.th < this.min) { st.th = this.min; if (st.w < 0) { st.hitW = st.w; if (st.w < -0.8) world.emit('thunk', this, -st.w); st.w = -st.w * this.bounce; } }
    if (st.th > this.max) { st.th = this.max; if (st.w > 0) { if (st.w > 0.8) world.emit('thunk', this, st.w); st.w = -st.w * this.bounce; } }
  }
  velAt(world, px, py, pz, out) {
    const w = world.devState(this).w, a = this.axis, P = this.pivot;
    const rx = px - P.x, ry = py - P.y, rz = pz - P.z;
    return out.set(w * (a.y * rz - a.z * ry), w * (a.z * rx - a.x * rz), w * (a.x * ry - a.y * rx));
  }
  armAlong(px, py, pz, dx, dy, dz) {
    const a = this.axis, P = this.pivot, rx = px - P.x, ry = py - P.y, rz = pz - P.z;
    return (ry * dz - rz * dy) * a.x + (rz * dx - rx * dz) * a.y + (rx * dy - ry * dx) * a.z;
  }
  invMass(world, px, py, pz, dx, dy, dz) { const k = this.armAlong(px, py, pz, dx, dy, dz); return k * k / this.J; }
  impulse(world, px, py, pz, jx, jy, jz) { world.devState(this).w += this.armAlong(px, py, pz, jx, jy, jz) / this.J; }
}
const _E1 = new THREE.Vector3(), _E2 = new THREE.Vector3();

export class RotorCollider {
  constructor(body) {
    this.body = body; this.device = body; this.surf = body.surf;
    const P = body.pivot, R = body.R + 0.01;
    this.min = new THREE.Vector3(P.x - R, P.y - R, P.z - R);
    this.max = new THREE.Vector3(P.x + R, P.y + R, P.z + R);
  }
  collide(b, world) {
    const body = this.body, st = world.devState(body), P = body.pivot, a = body.axis, p = b.pos, r = b.r;
    body.basis(st.th, _E1, _E2);
    for (const bx of body.boxes) {
      const cx = P.x + _E1.x * bx.x + _E2.x * bx.y + a.x * (bx.z || 0);
      const cy = P.y + _E1.y * bx.x + _E2.y * bx.y + a.y * (bx.z || 0);
      const cz = P.z + _E1.z * bx.x + _E2.z * bx.y + a.z * (bx.z || 0);
      const ux = _E1.x * bx.c + _E2.x * bx.s, uy = _E1.y * bx.c + _E2.y * bx.s, uz = _E1.z * bx.c + _E2.z * bx.s;
      const vx = -_E1.x * bx.s + _E2.x * bx.c, vy = -_E1.y * bx.s + _E2.y * bx.c, vz = -_E1.z * bx.s + _E2.z * bx.c;
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
      const lu = dx * ux + dy * uy + dz * uz, lv = dx * vx + dy * vy + dz * vz, lw = dx * a.x + dy * a.y + dz * a.z;
      if (Math.abs(lu) > bx.hu + r || Math.abs(lv) > bx.hv + r || Math.abs(lw) > bx.hw + r) continue;
      const qu = Math.max(-bx.hu, Math.min(bx.hu, lu)), qv = Math.max(-bx.hv, Math.min(bx.hv, lv)), qw = Math.max(-bx.hw, Math.min(bx.hw, lw));
      const eu = lu - qu, ev = lv - qv, ew = lw - qw, d2 = eu * eu + ev * ev + ew * ew;
      let nu, nv, nw, depth;
      if (d2 > 1e-14) {
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2); nu = eu / d; nv = ev / d; nw = ew / d; depth = r - d;
      } else {
        const pu = bx.hu - Math.abs(lu), pv = bx.hv - Math.abs(lv), pw = bx.hw - Math.abs(lw);
        nu = 0; nv = 0; nw = 0;
        if (pu < pv && pu < pw) { nu = Math.sign(lu) || 1; depth = pu + r; } else if (pv < pw) { nv = Math.sign(lv) || 1; depth = pv + r; } else { nw = Math.sign(lw) || 1; depth = pw + r; }
      }
      const nx = ux * nu + vx * nv + a.x * nw, ny = uy * nu + vy * nv + a.y * nw, nz = uz * nu + vz * nv + a.z * nw;
      const qx = cx + ux * qu + vx * qv + a.x * qw, qy = cy + uy * qu + vy * qv + a.y * qw, qz = cz + uz * qu + vz * qv + a.z * qw;
      addContact(nx, ny, nz, depth, this.surf, this, body, qx, qy, qz);
    }
  }
}

// ---------------------------------------------------------------- balls
let BALL_ID = 1;
export class Ball {
  constructor(type, pos, vel) {
    const d = BALL_TYPES[type] || BALL_TYPES.glass;
    this.id = BALL_ID++;
    this.type = type; this.def = d;
    this.r = d.radius;
    this.m = d.mass ?? d.density * (4 / 3) * Math.PI * this.r ** 3;
    this.I = d.k * this.m * this.r * this.r;
    this.pos = pos.clone();
    this.vel = vel ? vel.clone() : new THREE.Vector3();
    this.w = new THREE.Vector3();
    this.quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, 0));
    this.cand = []; this.cache = new Map();
    this.captured = null; this.dead = false; this.collected = false;
    this.lastTouch = -1; this.jnAcc = 0; this.slip = 0; this.feltG = 1;
    this.tkT = -1; this.tkCol = null; this.lastTrackT = -1; this.surf = null;
    this.normal = new THREE.Vector3(0, 1, 0);
    this.onRoomFloor = false; this.still = 0; this.age = 0;
    this.color = null; this.mesh = null;
    this.stats = { born: 0, E0: null, maxSpeed: 0, maxG: 0, dist: 0, air: 0, bounces: 0 };
  }
  energy(g) {
    const v2 = this.vel.lengthSq(), w2 = this.w.lengthSq();
    const kt = 0.5 * this.m * v2, kr = 0.5 * this.I * w2, pe = this.m * g * this.pos.y;
    return { kt, kr, pe, total: kt + kr + pe };
  }
}

// ---------------------------------------------------------------- world
export class World {
  constructor(opts = {}) {
    this.g = 9.81; this.rho = 1.2; this.time = 0; this.assist = false;
    this.balls = []; this.colliders = []; this.globals = []; this.devices = [];
    this.grid = new Map(); this.cell = 0.2;
    this.silent = !!opts.silent; this.on = opts.on || null;
    this.state = new Map();
    this.maxBalls = 80;
  }
  emit(type, a, b, c, d) { if (!this.silent && this.on) this.on(type, a, b, c, d); }
  devState(dev) {
    let s = this.state.get(dev);
    if (!s) { s = dev.initState ? dev.initState() : {}; this.state.set(dev, s); }
    return s;
  }
  key(ix, iy, iz) { return ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512); }
  setColliders(colliders, devices) {
    this.colliders = colliders; this.devices = devices || [];
    this.globals = []; this.grid.clear();
    const cs = this.cell;
    for (const c of colliders) {
      if (c.global) { this.globals.push(c); continue; }
      const x0 = Math.floor(c.min.x / cs), x1 = Math.floor(c.max.x / cs);
      const y0 = Math.floor(c.min.y / cs), y1 = Math.floor(c.max.y / cs);
      const z0 = Math.floor(c.min.z / cs), z1 = Math.floor(c.max.z / cs);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const k = this.key(x, y, z);
        let l = this.grid.get(k); if (!l) { l = []; this.grid.set(k, l); }
        l.push(c);
      }
    }
    const live = new Set(this.devices);
    for (const d of [...this.state.keys()]) if (!live.has(d)) this.state.delete(d);
    for (const b of this.balls) {
      b.cache.clear(); b.cand.length = 0;
      if (b.captured && !live.has(b.captured.dev)) b.captured = null;
    }
  }
  refreshCandidates(b, horizon) {
    const out = b.cand; out.length = 0;
    for (const g of this.globals) out.push(g);
    const m = b.r + b.vel.length() * horizon + 0.03, cs = this.cell, p = b.pos;
    const stamp = ++STAMP;
    const x0 = Math.floor((p.x - m) / cs), x1 = Math.floor((p.x + m) / cs);
    const y0 = Math.floor((p.y - m) / cs), y1 = Math.floor((p.y + m) / cs);
    const z0 = Math.floor((p.z - m) / cs), z1 = Math.floor((p.z + m) / cs);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const l = this.grid.get(this.key(x, y, z));
      if (!l) continue;
      for (const c of l) {
        if (c._stamp === stamp) continue;
        c._stamp = stamp;
        if (p.x + m < c.min.x || p.x - m > c.max.x || p.y + m < c.min.y || p.y - m > c.max.y || p.z + m < c.min.z || p.z - m > c.max.z) continue;
        out.push(c);
      }
    }
  }
  addBall(b) {
    b.stats.born = this.time;
    this.balls.push(b);
    if (this.balls.length > this.maxBalls) {
      const old = this.balls.find(x => !x.captured);
      if (old) old.dead = true;
    }
    return b;
  }
  step(dt) {
    const g = this.g, rho = this.rho, balls = this.balls;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.captured || b.dead) continue;
      const v = b.vel, w = b.w;
      v.y -= g * dt;
      if (rho > 0) {
        const sp = Math.hypot(v.x, v.y, v.z);
        if (sp > 1e-4) {
          const A = Math.PI * b.r * b.r;
          // quadratic drag, integrated implicitly for stability
          const f = 0.5 * rho * b.def.cd * A / b.m * sp * dt;
          v.multiplyScalar(1 / (1 + f));
          // Magnus lift  F = ½ ρ A r C (ω × v), C ≈ 0.4
          const km = 0.2 * rho * A * b.r / b.m * dt;
          const mx = w.y * v.z - w.z * v.y, my = w.z * v.x - w.x * v.z, mz = w.x * v.y - w.y * v.x;
          v.x += km * mx; v.y += km * my; v.z += km * mz;
        }
      }
      b.pos.addScaledVector(v, dt);
    }
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.captured || b.dead) continue;
      this.collideBall(b, dt);
    }
    this.ballBall();
    for (let i = 0; i < this.devices.length; i++) { const d = this.devices[i]; if (d.step) d.step(this, dt); }
    this.time += dt;
  }
  collideBall(b, dt) {
    nC = 0;
    const p = b.pos, r = b.r;
    const cand = b.cand;
    for (let k = 0; k < cand.length; k++) {
      const c = cand[k];
      if (!c.global && (p.x + r < c.min.x || p.x - r > c.max.x || p.y + r < c.min.y || p.y - r > c.max.y || p.z + r < c.min.z || p.z - r > c.max.z)) continue;
      c.collide(b, this);
    }
    if (nC === 0) return;
    const m = b.m, I = b.I, def = b.def, v = b.vel, w = b.w;
    let corrX = 0, corrY = 0, corrZ = 0;
    let room = false;
    let jnBest = -1;
    // pass 1: push out of the surfaces and solve the normal (bounce) impulses
    for (let k = 0; k < nC; k++) {
      const nx = C_NX[k], ny = C_NY[k], nz = C_NZ[k], surf = C_S[k], col = C_C[k], body = C_B[k];
      const px = C_PX[k], py = C_PY[k], pz = C_PZ[k];
      C_JN[k] = 0; C_AX[k] = 0; C_AY[k] = 0; C_AZ[k] = 0;
      // positional projection (accounting for corrections already applied this step)
      const pen = C_D[k] - (corrX * nx + corrY * ny + corrZ * nz);
      if (pen > 0) { p.x += nx * pen; p.y += ny * pen; p.z += nz * pen; corrX += nx * pen; corrY += ny * pen; corrZ += nz * pen; }
      // moving parts: work with the velocity relative to the surface
      let vsx = 0, vsy = 0, vsz = 0;
      if (body) { body.velAt(this, px, py, pz, VS); vsx = VS.x; vsy = VS.y; vsz = VS.z; }
      // contact point offset rc = -r n ; velocity at contact = v + w x rc
      const rcx = -r * nx, rcy = -r * ny, rcz = -r * nz;
      const vcx = v.x + (w.y * rcz - w.z * rcy) - vsx, vcy = v.y + (w.z * rcx - w.x * rcz) - vsy, vcz = v.z + (w.x * rcy - w.y * rcx) - vsz;
      const vn = vcx * nx + vcy * ny + vcz * nz;
      if (vn >= 0) continue;
      const impact = -vn;
      let e = surf.override !== undefined ? def.restitution + (surf.override - def.restitution) * 0.85 : def.restitution * surf.e;
      if (e > 0.97) e = 0.97;
      if (impact < 0.06) e = 0;
      else if (impact < 0.2) e *= (impact - 0.06) / 0.14;
      // a light moving part shares the impulse with the ball (effective mass along the normal)
      const Kn = 1 / m + (body ? body.invMass(this, px, py, pz, nx, ny, nz) : 0);
      const jn = (1 + e) * impact / Kn;
      v.x += nx * jn / m; v.y += ny * jn / m; v.z += nz * jn / m;
      if (body) body.impulse(this, px, py, pz, -nx * jn, -ny * jn, -nz * jn);
      // bumpers kick back
      if (surf.kick && impact > 0.05) { v.x += nx * surf.kick; v.y += ny * surf.kick; v.z += nz * surf.kick; this.emit('kick', b, col); }
      C_JN[k] = jn;
      b.jnAcc += jn;
      if (jn > jnBest) { jnBest = jn; b.surf = surf; }
      if (impact > 0.12) { b.stats.bounces++; this.emit('impact', b, impact, surf, col); }
    }
    // pass 2: Coulomb friction at every contact point (couples spin and translation). With two
    // contacts (rails, a wall and a floor) the friction impulses are accumulated and re-solved a few
    // times so they settle on true rolling instead of fighting each other.
    const iters = nC > 1 ? 4 : 1;
    let slip = 0;
    for (let it = 0; it < iters; it++) {
      for (let k = 0; k < nC; k++) {
        const jn = C_JN[k];
        if (jn <= 0) continue;
        const nx = C_NX[k], ny = C_NY[k], nz = C_NZ[k], surf = C_S[k], body = C_B[k];
        const px = C_PX[k], py = C_PY[k], pz = C_PZ[k];
        let vsx = 0, vsy = 0, vsz = 0;
        if (body) { body.velAt(this, px, py, pz, VS); vsx = VS.x; vsy = VS.y; vsz = VS.z; }
        const rcx = -r * nx, rcy = -r * ny, rcz = -r * nz;
        const vcx = v.x + (w.y * rcz - w.z * rcy) - vsx, vcy = v.y + (w.z * rcx - w.x * rcz) - vsy, vcz = v.z + (w.x * rcy - w.y * rcx) - vsz;
        const vn2 = vcx * nx + vcy * ny + vcz * nz;
        const tx = vcx - nx * vn2, ty = vcy - ny * vn2, tz = vcz - nz * vn2;
        const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (it === iters - 1) slip = Math.max(slip, vt);
        if (vt < 1e-9) continue;
        const mu = Math.sqrt(def.friction * surf.mu);
        const K = 1 / m + r * r / I + (body ? body.invMass(this, px, py, pz, tx / vt, ty / vt, tz / vt) : 0);
        // new accumulated impulse, clamped to the friction cone
        let ax = C_AX[k] - tx / K, ay = C_AY[k] - ty / K, az = C_AZ[k] - tz / K;
        const al = Math.sqrt(ax * ax + ay * ay + az * az), lim = mu * jn;
        if (al > lim) { const s = lim / al; ax *= s; ay *= s; az *= s; }
        const dx = ax - C_AX[k], dy = ay - C_AY[k], dz = az - C_AZ[k];
        C_AX[k] = ax; C_AY[k] = ay; C_AZ[k] = az;
        v.x += dx / m; v.y += dy / m; v.z += dz / m;
        w.x += (rcy * dz - rcz * dy) / I; w.y += (rcz * dx - rcx * dz) / I; w.z += (rcx * dy - rcy * dx) / I;
        if (body) body.impulse(this, px, py, pz, -dx, -dy, -dz);
      }
    }
    b.slip = slip;
    // pass 3: rolling resistance and pivoting friction, then bookkeeping
    for (let k = 0; k < nC; k++) {
      const nx = C_NX[k], ny = C_NY[k], nz = C_NZ[k], surf = C_S[k], col = C_C[k], body = C_B[k], jn = C_JN[k];
      if (jn > 0) {
        let vsx = 0, vsy = 0, vsz = 0;
        if (body) { body.velAt(this, C_PX[k], C_PY[k], C_PZ[k], VS); vsx = VS.x; vsy = VS.y; vsz = VS.z; }
        // rolling resistance: torque opposing the roll, applied consistently to v and ω
        const crr = def.rolling + surf.crr;
        const rvx = v.x - vsx, rvy = v.y - vsy, rvz = v.z - vsz;
        const vdn = rvx * nx + rvy * ny + rvz * nz;
        const sx = rvx - nx * vdn, sy = rvy - ny * vdn, sz = rvz - nz * vdn;
        const sp = Math.sqrt(sx * sx + sy * sy + sz * sz);
        if (sp > 1e-9) {
          const dv = Math.min(sp, crr * jn / m);
          const fx = sx / sp * dv, fy = sy / sp * dv, fz = sz / sp * dv;
          v.x -= fx; v.y -= fy; v.z -= fz;
          // ω_roll = (n × v) / r  → reduce by (n × Δv) / r
          w.x -= (ny * fz - nz * fy) / r; w.y -= (nz * fx - nx * fz) / r; w.z -= (nx * fy - ny * fx) / r;
        }
        // pivoting friction: a small torque against spinning about the contact normal
        const wn = w.x * nx + w.y * ny + w.z * nz;
        const dw = Math.min(Math.abs(wn), 0.004 * jn * r / I) * Math.sign(wn);
        w.x -= nx * dw; w.y -= ny * dw; w.z -= nz * dw;
      }
      b.lastTouch = this.time;
      b.normal.x += (nx - b.normal.x) * 0.02; b.normal.y += (ny - b.normal.y) * 0.02; b.normal.z += (nz - b.normal.z) * 0.02;
      if (col.global || col.room) room = true; else b.lastTrackT = this.time;
    }
    b.onRoomFloor = room;
    // kid mode: a gentle hand keeps slow balls moving down the track (+T is always "downstream")
    if (this.assist && b.tkT === this.time) {
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp < 0.4) { const a = 1.6 * dt; v.x += b.tkx * a; v.y += b.tky * a; v.z += b.tkz * a; }
    }
  }
  ballBall() {
    const balls = this.balls, n = balls.length;
    for (let i = 0; i < n; i++) {
      const a = balls[i];
      if (a.captured || a.dead) continue;
      const pa = a.pos;
      for (let j = i + 1; j < n; j++) {
        const b = balls[j];
        if (b.captured || b.dead) continue;
        const pb = b.pos, rr = a.r + b.r;
        const dx = pa.x - pb.x; if (dx > rr || dx < -rr) continue;
        const dy = pa.y - pb.y; if (dy > rr || dy < -rr) continue;
        const dz = pa.z - pb.z; if (dz > rr || dz < -rr) continue;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-14) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d, pen = rr - d;
        const ia = 1 / a.m, ib = 1 / b.m, is = ia + ib;
        pa.x += nx * pen * ia / is; pa.y += ny * pen * ia / is; pa.z += nz * pen * ia / is;
        pb.x -= nx * pen * ib / is; pb.y -= ny * pen * ib / is; pb.z -= nz * pen * ib / is;
        const va = a.vel, vb = b.vel, wa = a.w, wb = b.w;
        // contact arms: ra = -n*ra, rb = +n*rb
        const rax = -nx * a.r, ray = -ny * a.r, raz = -nz * a.r, rbx = nx * b.r, rby = ny * b.r, rbz = nz * b.r;
        let rvx = (va.x + wa.y * raz - wa.z * ray) - (vb.x + wb.y * rbz - wb.z * rby);
        let rvy = (va.y + wa.z * rax - wa.x * raz) - (vb.y + wb.z * rbx - wb.x * rbz);
        let rvz = (va.z + wa.x * ray - wa.y * rax) - (vb.z + wb.x * rby - wb.y * rbx);
        const vn = rvx * nx + rvy * ny + rvz * nz;
        if (vn >= 0) continue;
        let e = Math.min(a.def.restitution, b.def.restitution) * 0.95 + 0.05 * Math.max(a.def.restitution, b.def.restitution);
        if (-vn < 0.05) e = 0;
        const jn = -(1 + e) * vn / is;
        va.x += nx * jn * ia; va.y += ny * jn * ia; va.z += nz * jn * ia;
        vb.x -= nx * jn * ib; vb.y -= ny * jn * ib; vb.z -= nz * jn * ib;
        rvx = (va.x + wa.y * raz - wa.z * ray) - (vb.x + wb.y * rbz - wb.z * rby);
        rvy = (va.y + wa.z * rax - wa.x * raz) - (vb.y + wb.z * rbx - wb.x * rbz);
        rvz = (va.z + wa.x * ray - wa.y * rax) - (vb.z + wb.x * rby - wb.y * rbx);
        const vn2 = rvx * nx + rvy * ny + rvz * nz;
        const tx = rvx - nx * vn2, ty = rvy - ny * vn2, tz = rvz - nz * vn2, vt = Math.hypot(tx, ty, tz);
        if (vt > 1e-9) {
          const mu = Math.sqrt(a.def.friction * b.def.friction) * 0.5;
          const K = is + a.r * a.r / a.I + b.r * b.r / b.I;
          const jt = Math.min(vt / K, mu * jn);
          const fx = -tx / vt * jt, fy = -ty / vt * jt, fz = -tz / vt * jt;
          va.x += fx * ia; va.y += fy * ia; va.z += fz * ia;
          vb.x -= fx * ib; vb.y -= fy * ib; vb.z -= fz * ib;
          wa.x += (ray * fz - raz * fy) / a.I; wa.y += (raz * fx - rax * fz) / a.I; wa.z += (rax * fy - ray * fx) / a.I;
          wb.x -= (rby * fz - rbz * fy) / b.I; wb.y -= (rbz * fx - rbx * fz) / b.I; wb.z -= (rbx * fy - rby * fx) / b.I;
        }
        if (-vn > 0.1) this.emit('clack', a, b, -vn);
      }
    }
  }
}

// helpers for analysis (ghost checks): signed distance from a point to the room colliders
export function roomClearance(colliders, x, y, z) {
  let m = Infinity;
  for (const c of colliders) if (c.sdf) { const d = c.sdf(x, y, z); if (d < m) m = d; }
  return m;
}
