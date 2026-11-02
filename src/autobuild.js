// Helpers that build for you: "Finish it" searches for a route from the active ring into a goal,
// and "Fix this" tries small changes around the spot where the ball falls off. Every idea is
// checked with the real physics in a silent world before it is offered.
import * as THREE from 'three';
import { World, Ball, DT } from './physics.js';
import { buildPiece, validatePiece, disposeGroup, portToData, SwitchDevice, PIECES } from './track.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const pause = () => new Promise(r => setTimeout(r, 0));

// run one ball from the first start tower (or from `from`) through `list`
export function simulate(list, env, { ball = 'glass', secs = 40, from = null, branch = null } = {}) {
  const insts = list.map(d => { const i = buildPiece(d); disposeGroup(i.group); return i; });
  const w = new World({ silent: false });
  w.g = env.g; w.rho = env.rho; w.assist = env.assist;
  let goal = null;
  w.on = (type) => { if (type === 'goal' && goal === null) goal = w.time; };
  const cols = [...env.roomColliders], devs = [];
  for (const i of insts) { cols.push(...i.colliders); devs.push(...i.devices); }
  w.setColliders(cols, devs);
  w.water = [...env.roomWater, ...insts.flatMap(i => i.B.water || [])];
  if (branch !== null) for (const d of devs) if (d instanceof SwitchDevice) w.devState(d).next = branch;
  const st = insts.find(i => i.spawn);
  const start = from || (st && st.spawn);
  if (!start) return { outcome: 'none', time: 0 };
  const b = w.addBall(new Ball(ball, start));
  let still = 0, last = start.clone(), lastT = 0;
  for (let k = 0; k < secs / DT; k++) {
    if ((k & 15) === 0) w.refreshCandidates(b, 0.02);
    w.step(DT);
    if (w.time - b.lastTrackT < 0.012) { last.copy(b.pos); lastT = w.time; }
    still = b.vel.length() < 0.006 && !b.captured ? still + DT : 0;
    if (goal !== null) return { outcome: 'goal', time: w.time, last, lastT };
    if (b.pos.y < -0.2 || b.dead) return { outcome: 'lost', time: w.time, last, lastT };
    if (still > 1.2) return { outcome: b.onRoomFloor ? 'floor' : 'stuck', time: w.time, last, lastT, end: b.pos.clone() };
  }
  return { outcome: 'long', time: w.time, last, lastT };
}

// ---------------------------------------------------------------- Finish it
// Beam search over simple pieces. Targets are free-standing catchers (basket, catcher, water tub)
// or, with none around, a goal cup at the end of a short run.
export async function finishIt(ctx) {
  const { port, make, others, env, ball, onProgress } = ctx;
  const targets = ctx.targets;
  const moves = [
    ['straight', { len: 0.1 }, 3], ['straight', { len: 0.2 }, 3], ['straight', { len: 0.3 }, 7], ['straight', { len: 0.2 }, 0],
    ['curveL', { angle: 45, radius: 0.12 }, 3], ['curveR', { angle: 45, radius: 0.12 }, 3],
    ['curveL', { angle: 90, radius: 0.12 }, 3], ['curveR', { angle: 90, radius: 0.12 }, 3],
    ['curveL', { angle: 90, radius: 0.2 }, 7], ['curveR', { angle: 90, radius: 0.2 }, 7],
    ['helixL', { turns: 1 }, 7], ['helixR', { turns: 1 }, 7],
    ['straight', { len: 0.2 }, 14], ['straight', { len: 0.3 }, 30], ['straight', { len: 0.1 }, 0],
  ];
  const DEG = Math.PI / 180;
  let nextId = ctx.nextId;
  const build = (key, opts, slopeDeg, p) => {
    const d = make(key, { port: portToData(p), slope: +(slopeDeg * DEG).toFixed(5) });
    d.id = nextId++;
    Object.assign(d.opts, opts);
    return d;
  };
  const tryAdd = (d, chain) => {
    const inst = buildPiece(d); disposeGroup(inst.group);
    const reason = validatePiece(inst, others.concat(chain.map(c => c.inst)), env.roomColliders);
    return reason ? null : inst;
  };
  const finishes = [];
  // the cheapest finish: just a cup, or a straight then a cup
  const cupEnd = (chain, p) => {
    const d = build('cup', {}, 3, p);
    const inst = tryAdd(d, chain);
    return inst ? chain.concat([{ d, inst }]) : null;
  };
  const scoreOf = (p) => {
    if (!targets.length) return 0;
    let best = Infinity;
    for (const t of targets) {
      const dh = Math.hypot(p.p.x - t.p.x, p.p.z - t.p.z), above = p.p.y - t.p.y;
      best = Math.min(best, dh + (above < 0.03 ? 2 + (0.03 - above) * 5 : Math.max(0, above - 0.5) * 0.8));
    }
    return best;
  };
  // the ball flies on a little after the track ends: a run that stops just short of the target,
  // pointing at it and above it, can land in it
  const near = (p) => targets.find(t => {
    const hx = Math.cos(p.psi), hz = -Math.sin(p.psi), dx = t.p.x - p.p.x, dz = t.p.z - p.p.z;
    const along = dx * hx + dz * hz, side = Math.abs(dx * hz - dz * hx), above = p.p.y - t.p.y;
    return side < t.r * 0.6 && along > -t.r * 0.5 && along < 0.08 + above * 0.9 && above > 0.02 && above < 0.6;
  });
  let beam = [{ chain: [], port, score: scoreOf(port) }];
  if (!targets.length) { const c = cupEnd([], port); if (c) finishes.push(c); }
  for (let depth = 0; depth < 6 && finishes.length < 4; depth++) {
    const next = [];
    for (const st of beam) {
      for (const [key, opts, slope] of moves) {
        const d = build(key, opts, slope, st.port);
        const inst = tryAdd(d, st.chain);
        if (!inst || !inst.outs[0]) continue;
        const chain = st.chain.concat([{ d, inst }]);
        const out = inst.outs[0];
        if (targets.length ? near(out) : false) finishes.push(chain);
        else if (!targets.length && depth < 3) { const c = cupEnd(chain, out); if (c) finishes.push(c); }
        next.push({ chain, port: out, score: scoreOf(out) + chain.length * 0.02 + Math.random() * 0.01 });
      }
      await pause();
    }
    onProgress?.((depth + 1) / 6);
    next.sort((a, b) => a.score - b.score);
    beam = next.slice(0, 10);
    if (!beam.length) break;
  }
  // shortest first; the physics decides
  finishes.sort((a, b) => a.length - b.length);
  for (const chain of finishes.slice(0, 8)) {
    const list = ctx.pieces.concat(chain.map(c => c.d));
    const r = simulate(list, env, { ball, secs: ctx.secs, from: ctx.from });
    await pause();
    if (r.outcome === 'goal') return { added: chain.map(c => c.d), nextId };
  }
  return null;
}

// ---------------------------------------------------------------- Fix this
// The ball leaves the track near `spot`. Try the gentlest changes first.
export async function fixIt(ctx) {
  const { pieces, spot, env, ball, reflowFrom, insertBefore, base, onProgress } = ctx;
  // the piece the ball left from, and the one before it
  let culprit = null, bd = Infinity;
  for (const d of pieces) {
    if (PIECES[d.type].kind === 'place') continue;
    const inst = buildPiece(d); disposeGroup(inst.group);
    for (const path of inst.paths) for (const s of path.samples) { const dd = s.p.distanceToSquared(spot); if (dd < bd) { bd = dd; culprit = d; } }
  }
  if (!culprit) return null;
  const parent = ctx.parentOf(culprit.id);
  const DEG = Math.PI / 180;
  const ideas = [];
  const change = (id, fn, msg) => ideas.push({ msg, make: () => { const list = pieces.map(p => p.id === id ? fn(JSON.parse(JSON.stringify(p))) : p); return reflowFrom(list, id); } });
  const trackish = (d) => ['straight', 'curve', 'helix', 'loop', 'bridge', 'tunnel'].includes(d.type);
  const c = culprit;
  if (ctx.outcome === 'stuck') {
    change(c.id, d => { d.slope = Math.min(0.26, d.slope + 4 * DEG); return d; }, 'Made it a bit steeper');
    if (parent) change(parent.id, d => { d.slope = Math.min(0.26, d.slope + 4 * DEG); return d; }, 'Made the piece before it steeper');
    ideas.push({ msg: 'Added a booster before it', make: () => insertBefore(c.id, 'booster', { power: 1.4 }) });
  } else {
    if (c.type === 'loop') {
      ideas.push({ msg: 'Added a booster before the loop', make: () => insertBefore(c.id, 'booster', { power: 2 }) });
      change(c.id, d => { d.opts.radius = 0.07; return d; }, 'Made the loop smaller');
    }
    if (trackish(c) && c.style !== 'tube') change(c.id, d => { d.style = 'tube'; return d; }, 'Turned it into a glass tube');
    if ((c.type === 'curve' || c.type === 'helix') && c.opts.radius < 0.2) change(c.id, d => { d.opts.radius = c.type === 'curve' ? 0.2 : 0.15; return d; }, 'Made the turn wider');
    if (c.slope > 0.06) change(c.id, d => { d.slope = +(d.slope - 4 * DEG).toFixed(5); return d; }, 'Made it less steep');
    if (parent && parent.slope > 0.06) change(parent.id, d => { d.slope = +(d.slope - 5 * DEG).toFixed(5); return d; }, 'Made the piece before it less steep');
    ideas.push({ msg: 'Added a brake before it', make: () => insertBefore(c.id, 'brake', { len: 0.1, speed: 0.6 }) });
    if (parent && trackish(parent) && parent.style !== 'tube') change(parent.id, d => { d.style = 'tube'; return d; }, 'Turned the piece before it into a glass tube');
  }
  let fallback = null;
  for (let i = 0; i < ideas.length; i++) {
    onProgress?.((i + 1) / ideas.length);
    await pause();
    const plan = ideas[i].make();
    if (!plan || plan.reason) continue;
    const r = simulate(plan.list, env, { ball, secs: ctx.secs, branch: ctx.branch, from: ctx.from });
    if (r.outcome === 'goal' || r.outcome === 'loop' || (r.outcome === 'long' && base.outcome !== 'long')) return { list: plan.list, msg: ideas[i].msg, solved: true };
    // still falls, but further along: keep it in mind
    if (!fallback && r.lastT > base.lastT + 1) fallback = { list: plan.list, msg: ideas[i].msg, solved: false };
  }
  return fallback;
}
