// The demo coaster that greets you on first launch.
import { buildPiece, portToData, PIECES, disposeGroup } from './track.js';

const DEG = Math.PI / 180;

export function buildDemo() {
  const list = [];
  let id = 1;
  const add = (type, port, o = {}) => {
    const d = {
      id: id++, type, slope: +((o.slope ?? 3) * DEG).toFixed(5), style: o.style || 'channel', color: o.color || 'wood',
      opts: Object.assign({}, PIECES[type].defaults, o.opts || {}),
    };
    if (port) d.port = port.p ? portToData(port) : port;
    list.push(d);
    const inst = buildPiece(d);
    disposeGroup(inst.group);
    return inst;
  };
  const out = (inst, i = 0) => inst.outs[i];

  let p = add('start', { x: -0.62, y: 0.012, z: -0.05, psi: 0, phi: 0 }, { color: 'red', opts: { height: 0.75 } });
  p = add('straight', out(p), { color: 'orange', opts: { len: 0.3 } });
  p = add('curve', out(p), { color: 'yellow', opts: { angle: 90, radius: 0.12, dir: -1 } });
  p = add('xylo', out(p), { slope: 4 });
  p = add('curve', out(p), { color: 'green', opts: { angle: 90, radius: 0.12, dir: -1 } });
  p = add('helix', out(p), { color: 'teal', slope: 7, opts: { turns: 1, radius: 0.11, dir: 1 } });
  p = add('straight', out(p), { color: 'blue', opts: { len: 0.1 } });
  p = add('funnel', out(p), { color: 'purple', opts: { size: 0.1, dir: -1 } });
  p = add('straight', out(p), { color: 'pink', opts: { len: 0.2 } });
  const sw = add('switch', out(p), { color: 'red' });
  // left: up the lift, down a dive, through the loop and into a big funnel
  p = add('curve', out(sw, 0), { color: 'orange', opts: { angle: 90, radius: 0.12, dir: 1 } });
  p = add('straight', out(p), { color: 'yellow', opts: { len: 0.1 } });
  p = add('lift', out(p), { color: 'purple', opts: { height: 0.45, exit: 'back' } });
  p = add('straight', out(p), { color: 'green', slope: 30, opts: { len: 0.3 } });
  p = add('straight', out(p), { color: 'teal', slope: 30, opts: { len: 0.3 } });
  p = add('straight', out(p), { color: 'blue', slope: 0, opts: { len: 0.15 } });
  p = add('loop', out(p), { color: 'purple', style: 'tube', opts: { radius: 0.08 } });
  p = add('straight', out(p), { color: 'pink', opts: { len: 0.1 } });
  p = add('funnel', out(p), { color: 'orange', opts: { size: 0.15, dir: 1 } });
  p = add('straight', out(p), { color: 'yellow', opts: { len: 0.1 } });
  add('cup', out(p), { color: 'yellow' });
  // right: a dive and a jump that lands in the big funnel too
  p = add('curve', out(sw, 1), { color: 'green', opts: { angle: 90, radius: 0.12, dir: -1 } });
  p = add('straight', out(p), { color: 'blue', slope: 30, opts: { len: 0.3 } });
  p = add('straight', out(p), { color: 'purple', slope: 0, opts: { len: 0.1 } });
  add('jump', out(p), { color: 'red', opts: { angle: 30 } });
  add('basket', { x: -0.897, y: 0, z: -0.43, psi: Math.PI / 2, phi: 0 }, { color: 'pink', opts: { height: 0 } });
  return list;
}
