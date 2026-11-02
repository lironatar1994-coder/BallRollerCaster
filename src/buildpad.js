// The build pad next to the glowing ring. Like a coaster park's construction window: one row for
// the turn, one for the slope, one for the tilt of the next piece. Before you tap, every turn is
// tried with a silent ball, so each arrow already shows what will happen: green gets through,
// yellow only just, red flies out or stops, grey is blocked.
import * as THREE from 'three';
import { World, Ball, BALL_TYPES, DT } from './physics.js';
import { buildPiece, validatePiece, disposeGroup, portToData, dirOf, RC } from './track.js';
import { L, getLang } from './i18n.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;

export const PAD_MOVES = [
  ['Lt', 'curveL', { angle: 90, radius: 0.08 }, 'Sharp left'], ['Lm', 'curveL', { angle: 90, radius: 0.12 }, 'Left'], ['Lw', 'curveL', { angle: 90, radius: 0.2 }, 'Wide left'],
  ['S', 'straight', null, 'Straight'],
  ['Rw', 'curveR', { angle: 90, radius: 0.2 }, 'Wide right'], ['Rm', 'curveR', { angle: 90, radius: 0.12 }, 'Right'], ['Rt', 'curveR', { angle: 90, radius: 0.08 }, 'Sharp right'],
];
const padSvg = (inner) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
function turnIcon(dir, r) {
  if (!dir) return padSvg('<path d="M12 21V4M7.5 8.5L12 4l4.5 4.5"/>');
  const x0 = 12 - dir * r / 2, ex = x0 + dir * r;
  return padSvg(`<path d="M${x0} 21V${5 + r}A${r} ${r} 0 0 ${dir > 0 ? 1 : 0} ${ex} 5"/><path d="M${ex - dir * 4} 1.5L${ex} 5L${ex - dir * 4} 8.5"/>`);
}
// slopes drawn steeper than they are, so they read at a glance
function slopeIcon(deg) {
  const a = { '-6': -14, 0: 0, 3: 8, 7: 18, 14: 32, 30: 55 }[deg] * DEG, c = Math.cos(a) * 8, s = Math.sin(a) * 8;
  return padSvg(`<path d="M${12 - c} ${14 - s}L${12 + c} ${14 + s}"/><circle cx="${12 - c * 0.6 + 3.3 * Math.sin(a)}" cy="${14 - s * 0.6 - 3.3 * Math.cos(a)}" r="2.6" fill="currentColor" stroke="none"/>`);
}
function bankIcon(v) {
  const a = { 0: 0, 15: 18, 30: 34, auto: 24 }[v];
  return padSvg(`<g transform="rotate(${-a} 12 13)"><path d="M6 6v6a6 6 0 0 0 12 0V6"/><circle cx="12" cy="15" r="2.4" fill="currentColor" stroke="none"/></g>${v === 'auto' ? '<text x="16" y="23.5" font-size="9" font-weight="800" fill="currentColor" stroke="none">A</text>' : ''}`);
}

export function createBuildPad(app) {
  const { S, $, esc, SLOPES, BANKS, world, sound, store } = app;
  const el = $('buildPad');
  let shown = '';
  function render() {
    const b = (attrs, title, html, cls = '') => `<button ${attrs} class="${cls}" title="${esc(title)}">${html}</button>`;
    el.innerHTML =
      `<div class="padRow">${PAD_MOVES.map(([k, , , t]) => b(`data-b="${k}"`, L(t), turnIcon(k === 'S' ? 0 : k[0] === 'L' ? -1 : 1, { t: 4, m: 7, w: 10 }[k[1]]))).join('')}</div>` +
      `<div class="padRow">${SLOPES.map(([v, l]) => b(`data-slope="${v}"`, `${L('Slope')}: ${L(l)}`, slopeIcon(v))).join('')}${b('data-b="back"', L('Remove the last piece'), '⌫')}</div>` +
      `<div class="padRow">${BANKS.map(([v, l]) => b(`data-bank="${v}"`, `${L('Bank the turns')}: ${L(l)}`, bankIcon(v))).join('')}${b('data-b="finish"', L('Finish it: build a way into a goal'), '✨', 'magic')}</div>`;
    shown = '';
  }
  function update() {
    const st = `${S.slope}|${S.bank}|${check.ver}|${getLang()}`;
    if (st === shown) return;
    shown = st;
    for (const x of el.querySelectorAll('[data-slope]')) x.classList.toggle('on', Math.abs(+x.dataset.slope * DEG - S.slope) < 1e-6);
    for (const x of el.querySelectorAll('[data-bank]')) x.classList.toggle('on', String(S.bank) === x.dataset.bank);
    for (const [k, , , t] of PAD_MOVES) {
      const x = el.querySelector(`[data-b="${k}"]`), r = check.res[k];
      x.className = r ? r.cls : 'wait';
      x.title = L(t) + (r && r.text ? ' — ' + r.text : '');
    }
  }

  // ------------------------------------------------ trying each move before you tap it
  const check = { key: '', queue: [], res: {}, ver: 0 };
  function dataFor(k, ap) {
    const [, tool, o] = PAD_MOVES.find(m => m[0] === k);
    return app.makeData(tool, { port: portToData(ap.port) }, o);
  }
  function checkTick() {
    const ap = app.activePort();
    if (!ap) return;
    const v = app.predSpeedAt(ap.port.p), q = ap.port.p;
    const key = [ap.key, q.x.toFixed(4), q.y.toFixed(4), q.z.toFixed(4), S.slope.toFixed(4), S.bank, app.hIdx, app.pieces.length, S.ballType, world.g, getLang(), v == null ? '-' : Math.round(v * 20)].join('|');
    if (key !== check.key) { check.key = key; check.queue = PAD_MOVES.map(m => m[0]); check.res = {}; check.ver++; }
    const k = check.queue.shift(); // one move per frame keeps the frame rate smooth
    if (!k) return;
    const d = dataFor(k, ap), inst = buildPiece(d);
    const reason = validatePiece(inst, [...app.insts.values()], app.room.colliders);
    check.res[k] = reason ? { cls: 'bad', text: L(reason) } : v == null ? { cls: '', text: '' } : rollTest(inst, ap.port, v);
    disposeGroup(inst.group);
    check.ver++;
  }
  // a silent ball enters the new piece at the predicted speed, already rolling
  function rollTest(inst, port, v) {
    const w = new World({ silent: true });
    w.g = world.g; w.rho = world.rho; w.assist = world.assist;
    w.setColliders(world.colliders.concat(inst.colliders), world.devices.concat(inst.devices));
    w.water = world.water.concat(inst.B.water || []);
    const T = dirOf(port.psi, port.phi), U = V(Math.cos(port.psi) * Math.sin(port.phi), Math.cos(port.phi), -Math.sin(port.psi) * Math.sin(port.phi));
    const b = w.addBall(new Ball(S.ballType, port.p.clone().addScaledVector(U, -(RC - BALL_TYPES[S.ballType].radius)), T.clone().multiplyScalar(Math.max(v, 0.02))));
    b.w.crossVectors(U, b.vel).divideScalar(b.r);
    const end = inst.outs[0] && inst.outs[0].p, start = b.pos.clone();
    if (!end) return { cls: '', text: '' };
    let still = 0;
    for (let k = 0; k < 2500; k++) {
      if ((k & 15) === 0) w.refreshCandidates(b, 0.02);
      w.step(DT);
      if (b.pos.distanceToSquared(end) < 0.025 * 0.025) {
        const ve = b.vel.length();
        return ve < 0.12 ? { cls: 'slow', text: L('the ball only just makes it ({0} m/s)', ve.toFixed(2)) } : { cls: 'ok', text: L('the ball gets through at {0} m/s', ve.toFixed(2)) };
      }
      if (b.dead || (k > 40 && w.time - b.lastTrackT > 0.15)) return { cls: 'off', text: L('too fast: the ball flies out. Bank the turn or take a wider one') };
      still = b.vel.length() < 0.01 ? still + DT : 0;
      if (still > 0.3 || b.pos.clone().sub(start).dot(T) < -0.015) return { cls: 'off', text: L('the ball stops here') };
    }
    return { cls: 'off', text: L('the ball stops here') };
  }

  // ------------------------------------------------ taps and hovers
  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    sound.ensure();
    if (b.dataset.slope !== undefined) { S.slope = +b.dataset.slope * DEG; app.renderSettings(); sound.click(); return; }
    if (b.dataset.bank !== undefined) { S.bank = b.dataset.bank === 'auto' ? 'auto' : +b.dataset.bank; store.set('bc.bank', S.bank); sound.click(); return; }
    const k = b.dataset.b;
    if (k === 'back') { const ap = app.activePort(), d = ap && app.pieces.find(p => p.id === ap.id); if (d && !d.locked) app.deletePiece(d.id); }
    else if (k === 'finish') app.runFinishIt();
    else build(k);
  };
  function build(k) {
    const ap = app.activePort();
    if (!ap) { app.toast(L('First place a 📍 Start Tower'), true); sound.error(); return; }
    const [, tool] = PAD_MOVES.find(m => m[0] === k);
    if (!app.canUse(tool)) { app.toast(L('None of those left in the parts box'), true); sound.error(); return; }
    const d = dataFor(k, ap), inst = buildPiece(d);
    const reason = validatePiece(inst, [...app.insts.values()], app.room.colliders);
    disposeGroup(inst.group);
    if (reason) { app.toast(L(reason), true); sound.error(); app.showBump(false); return; }
    S.lastAppend = tool;
    app.clearGhost();
    app.commit(d);
  }
  // hovering an arrow shows the piece where it would go, and what the ball would do
  let hov = null;
  el.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const b = e.target.closest('[data-b]'), k = b && PAD_MOVES.some(m => m[0] === b.dataset.b) ? b.dataset.b : null;
    if (k === hov) return;
    hov = k;
    const ap = app.activePort();
    if (!k || !ap) { app.clearGhost(); app.setHint(''); return; }
    app.showGhost(dataFor(k, ap));
    const r = check.res[k], t = PAD_MOVES.find(m => m[0] === k)[3];
    app.setHint(!S.ghostValid ? '⚠ ' + S.ghostReason : `${L(t)}${r && r.text ? ' — ' + r.text : ''}`);
  });
  el.addEventListener('pointerleave', () => { hov = null; app.clearGhost(); app.setHint(''); });

  return { render, tick() { checkTick(); update(); } };
}
