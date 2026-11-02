// Drawing a track: with the Draw tool, hold the mouse (or a finger) on the glowing ring and drag
// across the room. Behind the pointer the track is laid piece by piece — whichever straight or turn
// best follows the line, each one checked so it bends round furniture instead of through it. Shift
// makes it steeper. One stroke is one undo step.
// And focus mode: the camera stays close to the part you are working on.
import * as THREE from 'three';
import { buildPiece, validatePiece, disposeGroup, portToData } from './track.js';
import { L } from './i18n.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;
// the pieces a stroke may lay, gentlest first (a tie goes to the gentler one)
const MOVES = [
  ['straight', { len: 0.1 }], ['straight', { len: 0.2 }],
  ['curveL', { angle: 45, radius: 0.2 }], ['curveR', { angle: 45, radius: 0.2 }],
  ['curveL', { angle: 45, radius: 0.12 }], ['curveR', { angle: 45, radius: 0.12 }],
  ['curveL', { angle: 90, radius: 0.12 }], ['curveR', { angle: 90, radius: 0.12 }],
  ['curveL', { angle: 90, radius: 0.08 }], ['curveR', { angle: 90, radius: 0.08 }],
];
const across = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function createDraw(app) {
  const { S, canvas, camera, controls, sound } = app;

  // ------------------------------------------------ the dotted guide from the track's end to the pointer
  const guide = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V()]), new THREE.LineDashedMaterial({ color: '#2b2d42', dashSize: 0.012, gapSize: 0.01, transparent: true, opacity: 0.8, depthTest: false }));
  guide.renderOrder = 9; guide.visible = false; guide.frustumCulled = false;
  const tip = new THREE.Mesh(new THREE.RingGeometry(0.008, 0.013, 24), new THREE.MeshBasicMaterial({ color: '#ffb300', depthTest: false, side: THREE.DoubleSide }));
  tip.rotation.x = -Math.PI / 2; tip.renderOrder = 9; tip.visible = false;
  app.scene.add(guide, tip);

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(), hit = V();
  let stroke = null;

  // the best piece to lay from the track's end towards p: it must get closer, the closest wins
  function choose(end, p, slope) {
    const far = across(end.port.p, p);
    let best = null;
    for (const [tool, o] of MOVES) {
      const d = app.makeData(tool, { port: portToData(end.port), slope }, o);
      const inst = buildPiece(d), out = inst.outs[0];
      const ok = out && !validatePiece(inst, [...app.insts.values()], app.room.colliders);
      disposeGroup(inst.group);
      if (!ok) continue;
      const left = across(out.p, p);
      if (left > far - 0.02) continue;
      if (!best || left < best.left - 0.004) best = { d, left };
    }
    return best;
  }
  function pointAt(e, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    plane.set(V(0, 1, 0), -y);
    return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null;
  }
  function move(e) {
    const end = app.activePort();
    if (!end) return finish();
    const p = pointAt(e, end.port.p.y);
    if (!p) return;
    stroke.last = p;
    guide.geometry.setFromPoints([end.port.p, p]); guide.computeLineDistances(); guide.visible = true;
    tip.position.copy(p); tip.visible = true;
    if (performance.now() - stroke.at < 70) return; // building is heavier than moving: a few times a second is plenty
    stroke.at = performance.now();
    const slope = e.shiftKey ? 14 * DEG : S.slope;
    for (let k = 0; k < 3; k++) {
      const cur = app.activePort();
      if (!cur || across(cur.port.p, p) < 0.11) break;
      const best = choose(cur, p, slope);
      if (!best) { if (!stroke.warned) { app.setHint('⚠ ' + L('Nothing fits that way — try another way round')); stroke.warned = true; sound.error(); } break; }
      app.commit(best.d); stroke.n++; stroke.warned = false;
    }
    const now = app.activePort();
    if (now) { guide.geometry.setFromPoints([now.port.p, p]); guide.computeLineDistances(); }
  }
  function finish() {
    if (!stroke) return;
    const n = stroke.n;
    stroke = null; S.stroke = null;
    guide.visible = tip.visible = false;
    controls.enabled = S.cam === 'orbit';
    if (n) { app.pushHistory(); app.toast(L('✏️ Drew {0} pieces', n)); if (S.focus) focusNow(); }
    app.setHint(L('Hold and drag from the glowing ring to draw your track · Shift = steeper'));
  }
  // capture phase: the stroke takes the pointer before the camera controls can
  window.addEventListener('pointerdown', (e) => {
    if (S.tool !== 'draw' || e.target !== canvas || e.button !== 0 || S.cam !== 'orbit' || S.replay || S.photo) return;
    if (!app.activePort()) { app.toast(L('First place a 📍 Start Tower'), true); sound.error(); return; }
    e.stopImmediatePropagation(); e.preventDefault();
    stroke = { n: 0, at: 0, pid: e.pointerId, warned: false }; S.stroke = stroke;
    controls.enabled = false;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* fine */ }
    app.clearGhost(); sound.click();
    move(e);
  }, true);
  window.addEventListener('pointermove', (e) => { if (stroke && e.pointerId === stroke.pid) move(e); }, true);
  window.addEventListener('pointerup', (e) => { if (stroke && e.pointerId === stroke.pid) finish(); }, true);
  window.addEventListener('pointercancel', (e) => { if (stroke && e.pointerId === stroke.pid) finish(); }, true);

  // ------------------------------------------------ focus mode
  // the camera sits close to the part being worked on: the selected piece (sized to fit), or else the
  // glowing ring with a piece's length around it
  const _box = new THREE.Box3(), _s = new THREE.Sphere();
  function focusNow() {
    const inst = S.selected && app.insts.get(S.selected);
    if (inst) { _box.setFromObject(inst.group).getBoundingSphere(_s); app.frame(_s.center.clone(), THREE.MathUtils.clamp(_s.radius, 0.06, 0.4)); }
    else if (S.ringInfo) app.frame(S.ringInfo.p, 0.12);
  }
  function setFocus(on) {
    S.focus = on;
    app.$('camFocus').classList.toggle('on', on);
    if (on) { focusNow(); app.toast('🎯 ' + L('Focus: the camera stays close to what you are building')); }
    else app.fitView();
    sound.click();
  }

  return { setFocus, focusNow, drawing: () => !!stroke };
}
