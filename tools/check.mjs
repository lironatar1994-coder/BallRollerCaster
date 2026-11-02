// Pre-deploy check, run by deploy.ps1:  node tools/check.mjs
// 1. every relative import in the game points at a file that exists
// 2. the real physics engine (headless) still carries every kind of ball to a goal on the
//    demo coaster (both flip-flop branches) and on a test track that uses the moving pieces
import { register } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

register('./three-loader.mjs', import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (msg) => { console.error(`[FAIL] ${msg}`); process.exitCode = 1; };

// ---- 1. imports
const files = ['src', 'tools'].flatMap(d => readdirSync(path.join(root, d)).filter(f => /\.m?js$/.test(f)).map(f => path.join(root, d, f)));
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:import|from)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    if (!existsSync(path.resolve(path.dirname(file), m[1]))) fail(`${path.relative(root, file)} imports missing ${m[1]}`);
  }
}
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="(?!https?:|data:|#)([^"]+)"/g)) if (!existsSync(path.join(root, m[1]))) fail(`index.html links missing ${m[1]}`);
for (const m of html.matchAll(/"three(?:\/addons\/)?":\s*"([^"]+)"/g)) if (!m[1].endsWith('/') && !existsSync(path.join(root, m[1]))) fail(`import map points at missing ${m[1]}`);

// ---- 2. physics, headless. Textures are drawn on canvases; here a canvas simply swallows the drawing.
const ctx2d = () => new Proxy({}, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(16) });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; },
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: ctx2d }) };

const THREE = await import('three');
const { buildRoom } = await import('../src/room.js');
const { buildDemo } = await import('../src/demo.js');
const T = await import('../src/track.js');
const { simulate } = await import('./sim.js');
const roomColliders = buildRoom(new THREE.Scene()).colliders;
const BALLS = ['glass', 'wood', 'rubber', 'plastic', 'clay'];
const DEG = Math.PI / 180;

function chain(steps) {
  const list = [];
  let id = 1, port = null;
  for (const [type, o = {}] of steps) {
    const d = { id: id++, type, slope: (o.slope ?? 3) * DEG, style: o.style || 'channel', color: 'red', opts: Object.assign({}, T.PIECES[type].defaults, o.opts || {}) };
    d.port = o.port || T.portToData(port);
    list.push(d);
    const inst = T.buildPiece(d);
    T.disposeGroup(inst.group);
    port = inst.outs[0];
  }
  return list;
}
const tracks = {
  'demo, left branch (lift, loop, funnel)': [buildDemo(), 0],
  'demo, right branch (dive, jump, basket)': [buildDemo(), 1],
  'moving pieces (laser wood, tunnel, water wheel, rails, seesaw)': [chain([
    ['start', { port: { x: -0.55, y: 0.0084, z: 0.55, psi: 0, phi: 0 }, opts: { height: 0.55 } }],
    ['straight', { style: 'ply', opts: { len: 0.3 } }], ['tunnel'], ['wheel'],
    ['straight', { style: 'rails', opts: { len: 0.3 } }], ['seesaw'], ['straight', { style: 'rails', opts: { len: 0.2 } }], ['cup'],
  ]), 0],
  'gadgets (sensor, booster, brake, gate, photo booth, screw lift)': [chain([
    ['start', { port: { x: -0.55, y: 0.0084, z: 0.55, psi: 0, phi: 0 }, opts: { height: 0.6 } }], ['straight', { opts: { len: 0.15 } }],
    ['sensor', { opts: { effect: 'confetti' } }], ['booster', { opts: { power: 1.2 } }], ['curve', { opts: { angle: 90, radius: 0.15, dir: -1 } }],
    ['brake', { opts: { len: 0.1, speed: 0.6 } }], ['gate', { opts: { mode: 'timer', interval: 1 } }], ['photo'], ['curve', { opts: { angle: 90, radius: 0.15, dir: -1 } }],
    ['straight', { opts: { len: 0.1 } }], ['screw', { opts: { height: 0.2, exit: 'back' } }], ['straight', { opts: { len: 0.25 }, slope: 7 }], ['xylo', { slope: 4 }], ['cup'],
  ]), 0],
  'elevator and a sensor-opened gate': [chain([
    ['start', { port: { x: -0.6, y: 0.0084, z: 0.5, psi: 0, phi: 0 }, opts: { height: 0.3 } }], ['straight'], ['elevator', { opts: { height: 0.3 } }],
    ['sensor', { opts: { effect: 'gate' } }], ['gate', { opts: { mode: 'sensor' } }], ['straight', { opts: { len: 0.3 } }], ['cup'],
  ]), 0],
  // unbanked, the bouncy rubber ball flies out of this turn
  'a fast, banked hairpin on rails': [chain([
    ['start', { port: { x: -0.5, y: 0.0084, z: 0.5, psi: 0, phi: 0 }, opts: { height: 0.75 } }], ['straight', { slope: 30, opts: { len: 0.5 } }],
    ['curve', { style: 'rails', opts: { angle: 180, radius: 0.08, dir: -1, bank: 25 } }], ['straight', { style: 'rails', opts: { len: 0.2 } }], ['cup'],
  ]), 0],
};
const started = Date.now();
for (const [name, [list, branch]] of Object.entries(tracks)) {
  const results = BALLS.map(ball => ({ ball, ...simulate(list, { ball, branch, roomColliders }) }));
  const problems = results[0].problems;
  if (problems.length) fail(`${name}: invalid pieces ${JSON.stringify(problems)}`);
  const bad = results.filter(r => r.outcome !== 'goal');
  if (bad.length) fail(`${name}: ${bad.map(r => `${r.ball} → ${r.outcome} at ${r.end.join(', ')}`).join('; ')}`);
  else console.log(`[OK] ${name}: all ${BALLS.length} balls score (${results.map(r => r.time + 's').join(' ')})`);
}
console.log(`[INFO] Physics check took ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (process.exitCode) console.error('[FAIL] Pre-deploy check failed.');
