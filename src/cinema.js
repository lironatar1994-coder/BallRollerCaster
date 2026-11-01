// Movie camera (automatic shots and cuts around a ball) and the replay recorder.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const SHOTS = ['side', 'ahead', 'top', 'low', 'orbit', 'side', 'ahead', 'pov'];

export class MovieCam {
  constructor(camera, bounds) {
    this.cam = camera; this.bounds = bounds;
    this.shot = ''; this.t = 0; this.dur = 3;
    this.dir = new THREE.Vector3(1, 0, 0); this.side = new THREE.Vector3(0, 0, 1);
    this.fixed = new THREE.Vector3(); this.look = new THREE.Vector3(); this.ang = 0; this.snap = true;
  }
  reset() { this.shot = ''; }
  // where a shot would put the camera right now
  shotPos(s, p, out) {
    switch (s) {
      case 'side': return this.clamp(out.copy(p).addScaledVector(this.side, 0.3).add(UP.clone().multiplyScalar(0.07)));
      case 'top': return this.clamp(out.copy(p).addScaledVector(this.dir, -0.15).add(UP.clone().multiplyScalar(0.5)));
      case 'orbit': return this.clamp(out.set(p.x + Math.cos(this.ang) * 0.3, p.y + 0.12, p.z + Math.sin(this.ang) * 0.3));
      case 'ahead': case 'low': return out.copy(this.fixed);
      default: return out.copy(p).addScaledVector(UP, 0.012);
    }
  }
  cut(ball, blocked) {
    const p = ball.pos, tryPos = new THREE.Vector3();
    // try a few shots and keep the first one that can actually see the ball
    for (let tries = 0; tries < 6; tries++) {
      let s;
      do { s = SHOTS[Math.floor(Math.random() * SHOTS.length)]; } while (s === this.shot);
      if (s === 'ahead') this.fixed.copy(p).addScaledVector(this.dir, 0.32).addScaledVector(this.side, 0.13).add(UP.clone().multiplyScalar(0.05));
      if (s === 'low') { this.fixed.copy(p).addScaledVector(this.side, -0.38).addScaledVector(this.dir, 0.1); this.fixed.y = Math.max(0.03, p.y - 0.12); }
      if (s === 'orbit') this.ang = Math.atan2(this.side.z, this.side.x);
      this.clamp(this.fixed);
      this.shot = s;
      if (s === 'pov' || !blocked || !blocked(this.shotPos(s, p, tryPos), p)) break;
    }
    this.t = 0; this.dur = this.shot === 'pov' ? 2.6 : 3 + Math.random() * 1.8; this.snap = true; this.occT = 0; this.checkT = 0;
    this.look.copy(p);
  }
  clamp(v) {
    const b = this.bounds;
    v.x = Math.min(b.x1 - 0.05, Math.max(b.x0 + 0.05, v.x));
    v.z = Math.min(b.z1 - 0.05, Math.max(b.z0 + 0.05, v.z));
    v.y = Math.min(b.h - 0.05, Math.max(0.02, v.y));
    return v;
  }
  update(dt, ball, blocked) {
    if (!ball) return;
    const cam = this.cam, p = ball.pos, v = ball.vel;
    const hv = v.clone().setY(0);
    if (hv.lengthSq() > 4e-4) this.dir.lerp(hv.normalize(), 1 - Math.exp(-dt * 2)).normalize();
    this.side.crossVectors(UP, this.dir).normalize();
    this.t += dt;
    // something in the way for a moment? cut to a shot that can see the ball
    if (blocked && this.shot && this.shot !== 'pov') {
      this.checkT = (this.checkT || 0) + dt;
      if (this.checkT > 0.12) { this.checkT = 0; this.occT = blocked(cam.position, p) ? (this.occT || 0) + 0.12 : 0; }
    }
    if (!this.shot || this.t > this.dur || this.occT > 0.3 || ((this.shot === 'ahead' || this.shot === 'low') && cam.position.distanceTo(p) > 0.85)) this.cut(ball, blocked);
    let rate = 4, fov = 50;
    if (this.shot === 'orbit') this.ang += dt * 0.45;
    if (this.shot === 'top') { rate = 2; fov = 45; }
    if (this.shot === 'ahead' || this.shot === 'low') { rate = 20; fov = this.shot === 'low' ? 42 : 50; }
    if (this.shot === 'pov') { fov = 82; rate = 60; }
    const want = this.shotPos(this.shot, p, new THREE.Vector3());
    if (this.shot === 'pov') want.copy(p).addScaledVector(UP, ball.r * 1.2);
    this.clamp(want);
    if (this.snap) { cam.position.copy(want); this.snap = false; } else cam.position.lerp(want, 1 - Math.exp(-dt * rate));
    if (this.shot === 'pov') {
      const d = v.lengthSq() > 1e-3 ? v.clone().normalize() : this.dir;
      this.look.copy(cam.position).addScaledVector(d, 1);
      cam.up.set(0, 1, 0); cam.lookAt(this.look);
    } else {
      this.look.lerp(p, 1 - Math.exp(-dt * 10));
      cam.up.set(0, 1, 0); cam.lookAt(this.look);
    }
    if (Math.abs(cam.fov - fov) > 0.1) { cam.fov = fov; cam.near = this.shot === 'pov' ? 0.002 : 0.004; cam.updateProjectionMatrix(); }
  }
}

// keeps the last few seconds of every ball (and every moving part) for instant replays
export class Recorder {
  constructor(seconds = 15) { this.max = seconds; this.frames = []; this.meta = new Map(); }
  clear() { this.frames = []; this.meta.clear(); }
  record(world, rotors, followId) {
    const t = world.time;
    const lastF = this.frames[this.frames.length - 1];
    if (lastF && t - lastF.t < 1 / 60 - 1e-6) return;
    const bs = world.balls.filter(b => !b.dead);
    const data = new Float32Array(bs.length * 8);
    bs.forEach((b, i) => {
      data[i * 8] = b.id; data[i * 8 + 1] = b.pos.x; data[i * 8 + 2] = b.pos.y; data[i * 8 + 3] = b.pos.z;
      data[i * 8 + 4] = b.quat.x; data[i * 8 + 5] = b.quat.y; data[i * 8 + 6] = b.quat.z; data[i * 8 + 7] = b.quat.w;
      if (!this.meta.has(b.id)) this.meta.set(b.id, { type: b.type, color: b.color, r: b.r });
    });
    const rot = new Float32Array(rotors.length);
    rotors.forEach((r, i) => { rot[i] = world.devState(r).th; });
    this.frames.push({ t, data, rot, follow: followId });
    while (this.frames.length && t - this.frames[0].t > this.max) this.frames.shift();
  }
  get duration() { return this.frames.length > 1 ? this.frames[this.frames.length - 1].t - this.frames[0].t : 0; }
  // index of the last frame at or before time t
  find(t) {
    const f = this.frames;
    let lo = 0, hi = f.length - 1;
    if (t <= f[0].t) return 0;
    if (t >= f[hi].t) return hi;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f[m].t <= t) lo = m; else hi = m; }
    return lo;
  }
  ids(frame) {
    if (!frame.map) { frame.map = new Map(); for (let i = 0; i < frame.data.length; i += 8) frame.map.set(frame.data[i], i); }
    return frame.map;
  }
}
