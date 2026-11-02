// Headless physics check, run from the browser console on the game page:
//   const { simulate } = await import('/tools/sim.js');
//   simulate(window.__bc.pieces(), { branch: 1 })
// Builds the pieces in a silent world, drops one ball from the first start tower,
// and reports how the run ends.
import { buildPiece, validatePiece, SwitchDevice, disposeGroup } from '../src/track.js';
import { World, Ball, DT } from '../src/physics.js';

export function simulate(list, { ball = 'glass', branch = 0, secs = 30, roomColliders, roomWater = [] } = {}) {
  const room = roomColliders || window.__bc.world.colliders.filter(c => c.room);
  const insts = list.map(d => buildPiece(d));
  insts.forEach(i => disposeGroup(i.group));
  const problems = insts.map((i, k) => [i.d.id, i.d.type, validatePiece(i, insts.slice(0, k), room)]).filter(x => x[2]);
  const w = new World({ silent: false });
  let goal = null;
  const events = {};
  w.on = (type) => { events[type] = (events[type] || 0) + 1; if (type === 'goal') goal = w.time; };
  const cols = [...room], devs = [];
  for (const i of insts) { cols.push(...i.colliders); devs.push(...i.devices); }
  w.setColliders(cols, devs);
  w.water = [...roomWater, ...insts.flatMap(i => i.B.water || [])];
  for (const d of devs) if (d instanceof SwitchDevice) w.devState(d).next = branch;
  const start = insts.find(i => i.spawn);
  const b = w.addBall(new Ball(ball, start.spawn));
  let maxV = 0, still = 0;
  for (let k = 0; k < secs / DT; k++) {
    if (k % 16 === 0) w.refreshCandidates(b, 0.02);
    w.step(DT);
    const v = b.vel.length();
    maxV = Math.max(maxV, v);
    still = v < 0.005 && !b.captured ? still + DT : 0;
    if (goal || still > 1.5 || b.pos.y < -0.2) break;
  }
  const outcome = goal ? 'goal' : still > 1.5 ? (b.onRoomFloor ? 'floor' : 'stuck') : 'running';
  return { outcome, time: +w.time.toFixed(2), maxSpeed: +maxV.toFixed(2), end: b.pos.toArray().map(x => +x.toFixed(3)), problems, events };
}
