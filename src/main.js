// Ball Coaster — build marble runs in a kid's room, ride them, and watch real physics.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World, Ball, BALL_TYPES, DT, RotorBody } from './physics.js';
import { buildRoomKind, ROOM_KINDS } from './rooms.js';
import { createInsight, starText } from './insight.js';
import { shareLink, linkCode, decodeCoaster, gallery, thumbnail, VideoRecorder } from './share.js';
import { finishIt, fixIt, simulate as simRun } from './autobuild.js';
import { createVisitors } from './visitors.js';
import { createBuildPad } from './buildpad.js';
import { createFeel, reduceMotion } from './feel.js';
import { createPlay } from './play.js';
import { PIECES, buildPiece, validatePiece, buildPillars, disposeGroup, portToData, dirOf, RC, COLORS, RAINBOW, SwitchDevice, TrampolineDevice, BellDevice, BumperDevice, DominoRow, GateDevice, SensorDevice, SENSOR_COLORS } from './track.js';
import { Sound, ROLL_FAMILY } from './audio.js';
import { ICONS } from './icons.js';
import * as TX from './textures.js';
import { buildDemo } from './demo.js';
import { MovieCam, Recorder } from './cinema.js';
import { CHALLENGES, ROOM_UNLOCK, dailyChallenge } from './challenges.js';
import { L, setLang, getLang, applyStatic } from './i18n.js';
import { startVisitorSignal } from './visitorSignal.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const UP = V(0, 1, 0);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};

// ================================================================ renderer / scene
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f3eee6');
const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 30);
camera.position.set(0.9, 0.75, 1.3);
const controls = new OrbitControls(camera, canvas);
controls.target.set(-0.05, 0.3, 0.2);
controls.enableDamping = true; controls.dampingFactor = 0.1;
controls.minDistance = 0.1; controls.maxDistance = 7;
controls.maxPolarAngle = Math.PI * 0.49;
controls.zoomToCursor = true;
controls.screenSpacePanning = true;

// night-time glow
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.55, 0.78);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// soft studio reflections: glossy plastic, glass marbles and metal rails come alive
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const roomKindOk = (k) => ROOM_KINDS.some(r => r.kind === k) ? k : 'kids';
let room = buildRoomKind(scene, roomKindOk(store.get('bc.room', 'kids')));
const trackGroup = new THREE.Group(); scene.add(trackGroup);
const markerGroup = new THREE.Group(); scene.add(markerGroup);
const ghostGroup = new THREE.Group(); scene.add(ghostGroup);
const ballGroup = new THREE.Group(); scene.add(ballGroup);
const replayGroup = new THREE.Group(); scene.add(replayGroup);
const fxGroup = new THREE.Group(); scene.add(fxGroup);
const predGroup = new THREE.Group(); scene.add(predGroup);

const sound = new Sound();
const raycaster = new THREE.Raycaster();
const probeRay = new THREE.Raycaster(); // for supports and plumb lines, so the mouse ray stays untouched
raycaster.camera = camera;
const movie = new MovieCam(camera, room.bounds);
const rec = new Recorder(15);

// ================================================================ catalog
const SLOPES = [[-6, 'Up'], [0, 'Flat'], [3, 'Gentle'], [7, 'Medium'], [14, 'Steep'], [30, 'Dive']];
const TOOLS = {
  select: { label: 'Select', type: 'tool', icon: 'select', key: 'V', desc: 'Click a piece to edit it, or a ring to build from there' },
  hand: { label: 'Drop Ball', type: 'tool', icon: 'hand', key: 'B', desc: 'Click anywhere to drop a ball from your hand' },
  bridge: { label: 'Connect', type: 'connect', piece: 'bridge', icon: 'bridge', key: 'J', desc: 'Join a yellow ring to a blue ring with a smooth track' },
  erase: { label: 'Eraser', type: 'tool', icon: 'erase', key: 'X', desc: 'Click pieces to remove them' },
  paint: { label: 'Paint', type: 'tool', icon: 'paint', key: 'G', desc: 'Click or drag along the track to paint it · Shift = the whole run' },
  boxsel: { label: 'Select many', type: 'tool', icon: 'boxsel', key: 'U', desc: 'Drag a box (or Shift-click) to pick many pieces' },
  start: { label: 'Start Tower', type: 'place', piece: 'start', icon: 'start', key: 'T', desc: 'Where balls come from. Place it on any surface' },
  straight: { label: 'Straight', type: 'append', piece: 'straight', icon: 'straight', key: '↑', desc: 'A straight run' },
  curveL: { label: 'Curve Left', type: 'append', piece: 'curve', opts: { dir: 1 }, icon: 'curveL', key: '←', desc: 'Turn left' },
  curveR: { label: 'Curve Right', type: 'append', piece: 'curve', opts: { dir: -1 }, icon: 'curveR', key: '→', desc: 'Turn right' },
  helixL: { label: 'Spiral Left', type: 'append', piece: 'helix', opts: { dir: 1 }, icon: 'helixL', desc: 'Spin down in circles' },
  helixR: { label: 'Spiral Right', type: 'append', piece: 'helix', opts: { dir: -1 }, icon: 'helixR', desc: 'Spin down in circles' },
  drop: { label: 'Drop Tube', type: 'append', piece: 'drop', icon: 'drop', desc: 'A glass tube that falls straight down' },
  tunnel: { label: 'Tunnel', type: 'append', piece: 'tunnel', icon: 'tunnel', desc: 'Ride through a dark tunnel' },
  loop: { label: 'Loop', type: 'append', piece: 'loop', icon: 'loop', desc: 'Needs speed! Build it low after a steep dive' },
  jump: { label: 'Jump Ramp', type: 'append', piece: 'jump', icon: 'jump', desc: 'Launches the ball into the air — aim with 🔮 Predict' },
  switch: { label: 'Flip-Flop', type: 'append', piece: 'switch', icon: 'switch', desc: 'Sends balls left, right, left, right…' },
  turnstile: { label: 'Turnstile', type: 'append', piece: 'turnstile', icon: 'turnstile', desc: 'Three ways out: each ball takes the next one' },
  splitter: { label: 'Speed Splitter', type: 'append', piece: 'splitter', icon: 'splitter', desc: 'Fast balls jump the gap, slow ones drop to the chute below' },
  plinko: { label: 'Plinko', type: 'append', piece: 'plinko', icon: 'plinko', desc: 'Bounce down through the pegs — the middle bin scores 5!' },
  xylo: { label: 'Xylophone', type: 'append', piece: 'xylo', icon: 'xylo', desc: 'Plays a tune as the ball rolls over it' },
  lift: { label: 'Lift', type: 'append', piece: 'lift', icon: 'lift', desc: 'Carries balls back up — build forever-loops' },
  funnel: { label: 'Funnel', type: 'append', piece: 'funnel', icon: 'funnel', desc: 'Balls swirl round and round, then drop out below' },
  wheel: { label: 'Water Wheel', type: 'append', piece: 'wheel', icon: 'wheel', desc: "The ball's weight turns the wheel" },
  seesaw: { label: 'Seesaw', type: 'append', piece: 'seesaw', icon: 'seesaw', desc: 'Tips over when a ball rolls past the middle' },
  cup: { label: 'Goal Cup', type: 'append', piece: 'cup', icon: 'cup', desc: 'Score a point when a ball lands in it' },
  catcher: { label: 'Catcher', type: 'place', piece: 'catcher', icon: 'catcher', desc: 'A big funnel that catches flying balls' },
  basket: { label: 'Basket', type: 'place', piece: 'basket', icon: 'basket', desc: 'A soft basket — catches jumps' },
  tramp: { label: 'Trampoline', type: 'place', piece: 'tramp', icon: 'tramp', desc: 'Boing! Bounces balls up and away' },
  dominoes: { label: 'Dominoes', type: 'place', piece: 'dominoes', icon: 'dominoes', desc: 'Knock the first one and watch them all fall' },
  bell: { label: 'Bell', type: 'place', piece: 'bell', icon: 'bell', desc: 'Ding! Rings when a ball hits it' },
  bumper: { label: 'Bumper', type: 'place', piece: 'bumper', icon: 'bumper', desc: 'Kicks balls away like a pinball' },
  brake: { label: 'Brake', type: 'append', piece: 'brake', icon: 'brake', desc: 'Soft brushes slow fast balls down' },
  booster: { label: 'Booster', type: 'append', piece: 'booster', icon: 'booster', desc: 'A spring kicker that gives the ball a push' },
  gate: { label: 'Gate', type: 'append', piece: 'gate', icon: 'gate', desc: 'Holds balls and lets one through at a time' },
  sensor: { label: 'Sensor', type: 'append', piece: 'sensor', icon: 'sensor', desc: 'When a ball passes: confetti, lights, music, cheers — or open the gates' },
  photo: { label: 'Photo Booth', type: 'append', piece: 'photo', icon: 'photo', desc: 'Snaps a photo of every ball that rolls by' },
  screw: { label: 'Screw Lift', type: 'append', piece: 'screw', icon: 'screw', desc: 'A turning screw winds balls slowly upwards' },
  elevator: { label: 'Elevator', type: 'append', piece: 'elevator', icon: 'elevator', desc: 'A little cup that carries one ball up at a time' },
  pool: { label: 'Water Tub', type: 'place', piece: 'pool', icon: 'pool', desc: 'Splash! Wood and plastic float, glass sinks' },
  blocks: { label: 'Blocks', type: 'place', piece: 'blocks', icon: 'blocks', desc: 'Toy blocks: a platform to build on' },
  decor: { label: 'Decoration', type: 'place', piece: 'decor', icon: 'decor', desc: 'Flags, arches, lamps… nice things near the track make it more fun' },
};
const TYPE_TOOL = { brake: 'brake', booster: 'booster', gate: 'gate', sensor: 'sensor', photo: 'photo', screw: 'screw', elevator: 'elevator', pool: 'pool', blocks: 'blocks', decor: 'decor', start: 'start', straight: 'straight', curve: 'curveL', helix: 'helixL', drop: 'drop', tunnel: 'tunnel', loop: 'loop', jump: 'jump', switch: 'switch', xylo: 'xylo', lift: 'lift', funnel: 'funnel', wheel: 'wheel', seesaw: 'seesaw', cup: 'cup', catcher: 'catcher', basket: 'basket', tramp: 'tramp', dominoes: 'dominoes', bell: 'bell', bumper: 'bumper', bridge: 'bridge', turnstile: 'turnstile', splitter: 'splitter', plinko: 'plinko' };
const pieceLabel = (d) => d.type === 'curve' ? L(d.opts.dir > 0 ? 'Curve Left' : 'Curve Right') : d.type === 'helix' ? L(d.opts.dir > 0 ? 'Spiral Left' : 'Spiral Right') : d.type === 'bridge' ? L('Connector') : L(TOOLS[TYPE_TOOL[d.type]].label);
const DOCK_TOOLS = ['select', 'hand', 'bridge', 'erase', 'paint', 'boxsel'];
// sorted by what you want the ball to do next
const DOCK_TABS = [
  ['tracks', 'Paths', ['start', 'straight', 'curveL', 'curveR', 'helixL', 'helixR', 'drop', 'tunnel']],
  ['tricks', 'Tricks', ['loop', 'jump', 'funnel', 'tramp', 'bumper', 'seesaw', 'wheel', 'booster', 'brake']],
  ['switches', 'Switches', ['switch', 'turnstile', 'splitter', 'gate', 'sensor']],
  ['lifts', 'Lifts', ['lift', 'screw', 'elevator']],
  ['goals', 'Goals', ['cup', 'plinko', 'basket', 'catcher', 'dominoes', 'pool']],
  ['room', 'Music & room', ['xylo', 'bell', 'photo', 'blocks', 'decor']],
  ['parts', '⭐ My parts', []],
];
// option values: numbers in cm are shown with the local unit; text values are translated
const cm = (v) => `${Math.round(v * 100)} ${L('cm')}`;
const OPTIONS = {
  straight: [['len', 'Length', [[0.1, cm], [0.2, cm], [0.3, cm], [0.5, cm]]]],
  tunnel: [['len', 'Length', [[0.15, cm], [0.25, cm], [0.4, cm]]]],
  curve: [['dir', 'Turn', [[1, '↰ Left'], [-1, '↱ Right']]], ['angle', 'Angle', [[45, '45°'], [90, '90°'], [180, '180°']]], ['radius', 'Radius', [[0.08, 'Tight'], [0.12, 'Medium'], [0.2, 'Wide']]], ['bank', 'Bank', [[0, 'Flat'], [15, '15°'], [30, '30°']]]],
  helix: [['dir', 'Turn', [[1, '↰ Left'], [-1, '↱ Right']]], ['turns', 'Turns', [[1, '1'], [2, '2'], [3, '3']]], ['radius', 'Size', [[0.09, 'S'], [0.11, 'M'], [0.15, 'L']]]],
  loop: [['radius', 'Size', [[0.07, 'S'], [0.08, 'M'], [0.11, 'L']]]],
  splitter: [['speed', 'Splits at', [[0.6, '0.6 m/s'], [0.75, '0.75 m/s'], [0.9, '0.9 m/s']]]],
  plinko: [['size', 'Height', [[0.2, cm], [0.26, cm], [0.34, cm]]]],
  drop: [['height', 'Drop', [[0.1, cm], [0.2, cm], [0.3, cm], [0.5, cm]]]],
  jump: [['angle', 'Kick', [[15, '15°'], [30, '30°'], [45, '45°']]]],
  funnel: [['size', 'Size', [[0.1, 'S'], [0.15, 'L']]], ['dir', 'Spin', [[1, '⟲ Left'], [-1, '⟳ Right']]]],
  wheel: [['size', 'Size', [[0.06, 'S'], [0.075, 'M'], [0.09, 'L']]]],
  lift: [['height', 'Height', [[0.2, cm], [0.3, cm], [0.45, cm], [0.6, cm]]], ['exit', 'Exit', [['back', 'Back'], ['left', 'Left'], ['right', 'Right']]]],
  start: [['height', 'Height', [[0.25, cm], [0.45, cm], [0.7, cm], [1.0, cm]]]],
  catcher: [['height', 'Rim', [[0.2, cm], [0.3, cm], [0.45, cm]]], ['size', 'Size', [[0.13, 'M'], [0.18, 'L'], [0.24, 'XL']]]],
  basket: [['height', 'Height', [[0, 'Floor'], [0.1, cm], [0.25, cm]]]],
  tramp: [['tilt', 'Tilt', [[0, '0°'], [15, '15°'], [30, '30°'], [45, '45°']]], ['height', 'Height', [[0.05, cm], [0.15, cm], [0.3, cm]]]],
  dominoes: [['count', 'Count', [[6, '6'], [10, '10'], [16, '16']]]],
  bell: [['size', 'Size', [[0.7, 'S'], [1, 'M'], [1.4, 'L']]], ['height', 'Height', [[0.05, cm], [0.15, cm], [0.3, cm]]]],
  brake: [['len', 'Length', [[0.1, cm], [0.15, cm], [0.25, cm]]], ['speed', 'Slow to', [[0.3, 'Crawl'], [0.6, 'Calm'], [1, 'Easy']]]],
  booster: [['power', 'Kick', [[1, 'Small'], [1.4, 'Medium'], [2, 'Big']]]],
  gate: [['mode', 'Opens', [['timer', '⏱ Timer'], ['sensor', '📡 Sensor'], ['red', '🔴 Button'], ['green', '🟢 Button'], ['blue', '🔵 Button']]], ['interval', 'Every', [[1, '1 s'], [2, '2 s'], [4, '4 s']]]],
  switch: [['remote', 'Steer', [['', '🔁 By itself'], ['red', '🔴 Button'], ['green', '🟢 Button'], ['blue', '🔵 Button']]]],
  turnstile: [['remote', 'Steer', [['', '🔁 By itself'], ['red', '🔴 Button'], ['green', '🟢 Button'], ['blue', '🔵 Button']]]],
  sensor: [['effect', 'Does', [['confetti', '🎉 Confetti'], ['lights', '💡 Lights'], ['music', '🎵 Music'], ['cheer', '📣 Cheer'], ['gate', '🚦 Open gates']]]],
  screw: [['height', 'Height', [[0.2, cm], [0.3, cm], [0.45, cm]]], ['exit', 'Exit', [['back', 'Back'], ['left', 'Left'], ['right', 'Right']]]],
  elevator: [['height', 'Height', [[0.2, cm], [0.3, cm], [0.45, cm], [0.6, cm]]], ['exit', 'Exit', [['back', 'Back'], ['left', 'Left'], ['right', 'Right']]]],
  pool: [['size', 'Size', [[0.18, 'S'], [0.24, 'M'], [0.34, 'L']]], ['height', 'Height', [[0, 'Floor'], [0.1, cm], [0.2, cm]]]],
  blocks: [['layers', 'Layers', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [6, '6']]], ['size', 'Size', [[1, '1×1'], [2, '2×2'], [3, '3×3']]]],
  decor: [['kind', 'Kind', [['flags', '🚩 Flags'], ['arch', '🌈 Arch'], ['lamp', '💡 Lamp'], ['pinwheel', '🌀 Pinwheel'], ['tree', '🌲 Tree']]]],
};
const optLabel = (v, l) => typeof l === 'function' ? l(v) : L(l);
const STYLE_ITEMS = [['channel', '◡ Open'], ['tube', '◯ Glass'], ['ply', '🪵 Laser wood'], ['rails', '🎢 Rails']];
const TRACK_TYPES = ['straight', 'curve', 'helix', 'loop', 'bridge', 'tunnel', 'sensor', 'photo'];
const GRAVITY = [[9.81, 'Earth'], [1.62, 'Moon'], [3.71, 'Mars'], [24.8, 'Jupiter']];
const AIR = [[0, 'None'], [1.2, 'Normal'], [40, 'Syrup']];
const SPEEDS = [[0.1, '⅒×', 'Super slow-mo'], [0.25, '¼×', 'Slow-mo'], [0.5, '½×', 'Half speed'], [1, '1×', 'Real time'], [2, '2×', 'Fast']];
const BALL_COLORS = ['#ff5d5d', '#4c8dff', '#ffd23f', '#3ccf7a', '#9b6bff', '#ff9f43', '#ff77b7', '#2ec4b6'];
const BALL_LOOK = { glass: 'radial-gradient(circle at 35% 30%,#fff,#7fc8ff 40%,#2a7de1)', wood: 'radial-gradient(circle at 35% 30%,#f3d3a2,#c98f4e)', rubber: 'radial-gradient(circle at 35% 30%,#ffb3b3,#ff4d4d 55%,#d6303a)', plastic: 'radial-gradient(circle at 35% 30%,#fff,#ffe58a)', clay: 'radial-gradient(circle at 35% 30%,#d8b597,#9c7556)' };
const pieceIcon = (d) => {
  if (d.type === 'curve') return d.opts.dir > 0 ? 'curveL' : 'curveR';
  if (d.type === 'helix') return d.opts.dir > 0 ? 'helixL' : 'helixR';
  return d.type;
};

// ================================================================ state
const S = {
  tool: 'select', hover: null, lastAppend: 'straight', insert: null, tab: store.get('bc.tab', 'tracks'),
  opts: {}, slope: 3 * DEG, color: 'rainbow', style: 'channel', rainbow: 0,
  ballType: 'glass',
  active: null, connectFrom: null, selected: null, selAnchor: V(),
  cam: 'orbit', follow: null,
  paused: false, timeScale: 1, auto: false, autoT: 0, predict: true,
  placeYaw: 0, ghostValid: false, ghostReason: '', ghostData: null,
  nextId: 1, forces: false, trails: true, calcOpen: false, score: 0,
  kid: store.get('bc.kid', false), night: false, photo: false, replay: null, move: null, challenge: null,
};
for (const k of Object.keys(PIECES)) S.opts[k] = Object.assign({}, PIECES[k].defaults);

let pieces = [];
const insts = new Map();
let openOuts = [], openIns = [];
let history = [], hIdx = -1;

const world = new World({ on: onWorldEvent });
world.assist = S.kid;

// ================================================================ pieces: sync, pillars, ports
function addInst(d) {
  const inst = buildPiece(d);
  inst.json = JSON.stringify(d);
  for (const c of inst.colliders) { c.pieceType = d.type; c.pieceId = d.id; }
  for (const dv of inst.devices) dv.pieceId = d.id;
  if (d.locked) inst.group.traverse(o => { o.userData.locked = true; });
  trackGroup.add(inst.group);
  insts.set(d.id, inst);
  return inst;
}
function removeInst(id) {
  const inst = insts.get(id);
  if (!inst) return;
  trackGroup.remove(inst.group);
  disposeGroup(inst.group);
  insts.delete(id);
}
function sync(list, opts = {}) {
  const want = new Map(list.map(d => [d.id, d]));
  for (const [id, inst] of [...insts]) {
    const d = want.get(id);
    if (!d || JSON.stringify(d) !== inst.json) removeInst(id);
  }
  for (const d of list) if (!insts.has(d.id)) addInst(d);
  pieces = list;
  S.nextId = Math.max(S.nextId, ...list.map(d => d.id + 1), 1);
  rebuildPillars();
  fitShadow();
  refreshWorld();
  refreshPorts(opts.activeFrom);
  if (S.selected && !insts.has(S.selected)) S.selected = null;
  select(S.selected);
  schedulePrediction();
  rec.clear();
  save();
  renderMission();
  afterSync();
}
// the coaster's bounds (without its supports)
function coasterBox() {
  const box = new THREE.Box3();
  for (const inst of insts.values()) for (const ch of inst.group.children) if (ch !== inst.pillars && !ch.isSprite) box.expandByObject(ch);
  return box;
}
// keep the sun's shadow map tight around the coaster: crisp contact shadows under every piece
let sunDir = room.sun.position.clone().sub(room.sun.target.position).normalize();
function fitShadow() {
  const box = coasterBox(), sun = room.sun;
  const c = box.isEmpty() ? V(0, 0, 0) : box.getCenter(V());
  const r = box.isEmpty() ? 1.6 : Math.max(0.8, box.getSize(V()).length() / 2 + 0.35);
  sun.target.position.copy(c); sun.target.updateMatrixWorld();
  sun.position.copy(c).addScaledVector(sunDir, 3);
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.2, far: 3 + r * 2 });
  sun.shadow.camera.updateProjectionMatrix();
}
function rebuildPillars() {
  for (const inst of insts.values()) if (inst.pillars) { inst.group.remove(inst.pillars); disposeGroup(inst.pillars); inst.pillars = null; }
  const targets = [...room.solids, ...[...insts.values()].map(i => i.group)];
  const taken = [];
  for (const inst of insts.values()) {
    const m = buildPillars(inst, probeRay, targets, taken);
    if (m) { m.traverse(o => { o.userData.pieceId = inst.d.id; }); inst.group.add(m); inst.pillars = m; }
  }
}
function refreshWorld() {
  const cols = [...room.colliders], devs = [];
  for (const inst of insts.values()) { cols.push(...inst.colliders); devs.push(...inst.devices); }
  world.setColliders(cols, devs);
  world.water = [...(room.water || []), ...[...insts.values()].flatMap(i => i.B.water || [])];
}
const rotors = () => world.devices.filter(d => d instanceof RotorBody);
const portKey = (id, kind, i) => `${id}:${kind}${i}`;
const closePorts = (a, b) => a.p.distanceToSquared(b.p) < 9e-6;
function refreshPorts(activeFrom) {
  const outs = [], ins = [];
  for (const inst of insts.values()) {
    inst.outs.forEach((p, i) => outs.push({ id: inst.d.id, port: p, key: portKey(inst.d.id, 'o', i) }));
    inst.ins.forEach((p, i) => ins.push({ id: inst.d.id, port: p, key: portKey(inst.d.id, 'i', i) }));
  }
  openOuts = outs.filter(o => !ins.some(n => n.id !== o.id && closePorts(o.port, n.port)));
  openIns = ins.filter(n => !outs.some(o => o.id !== n.id && closePorts(o.port, n.port)));
  if (S.insert && !(chainLinks().kids.get(S.insert.parent) || []).some(c => c.out === S.insert.out)) S.insert = null;
  if (activeFrom !== undefined) {
    const o = openOuts.find(o => o.id === activeFrom);
    if (o) S.active = o.key;
  }
  if (!openOuts.some(o => o.key === S.active)) {
    const byNew = [...openOuts].sort((a, b) => b.id - a.id);
    S.active = byNew.length ? byNew[0].key : null;
  }
  drawMarkers();
  renderDock();
  updateGhost();
}
const activePort = () => openOuts.find(o => o.key === S.active) || null;
// every piece joined to this one through its rings (the whole coaster moves together)
function component(id) {
  const set = new Set([id]), queue = [id];
  while (queue.length) {
    const a = insts.get(queue.pop());
    for (const b of insts.values()) {
      if (set.has(b.d.id)) continue;
      if (a.outs.some(o => b.ins.some(n => closePorts(o, n))) || b.outs.some(o => a.ins.some(n => closePorts(o, n)))) { set.add(b.d.id); queue.push(b.d.id); }
    }
  }
  return set;
}

const markerMats = {
  out: new THREE.MeshBasicMaterial({ color: '#ffc83d', transparent: true, opacity: 0.85 }),
  active: new THREE.MeshBasicMaterial({ color: '#ff7a00' }),
  in: new THREE.MeshBasicMaterial({ color: '#4c8dff' }),
  from: new THREE.MeshBasicMaterial({ color: '#2fbf71' }),
  insert: new THREE.MeshBasicMaterial({ color: '#9b6bff' }),
  hit: new THREE.MeshBasicMaterial({ visible: false }),
};
const ringGeo = new THREE.TorusGeometry(0.026, 0.0045, 8, 32);
const dropMat = new THREE.LineDashedMaterial({ color: '#ff7a00', dashSize: 0.012, gapSize: 0.008, transparent: true, opacity: 0.8 });
const dropDotMat = new THREE.MeshBasicMaterial({ color: '#ff7a00', transparent: true, opacity: 0.45, depthWrite: false });
const dotGeo = new THREE.RingGeometry(0.008, 0.016, 24);
const coneGeo = new THREE.ConeGeometry(0.01, 0.024, 16);
const hitGeo = new THREE.SphereGeometry(0.034, 12, 8);
function drawMarkers() {
  markerGroup.clear();
  const mk = (o, kind) => {
    const g = new THREE.Group();
    const dir = new THREE.Vector3(Math.cos(o.port.psi) * Math.cos(o.port.phi), -Math.sin(o.port.phi), -Math.sin(o.port.psi) * Math.cos(o.port.phi));
    const active = kind === 'out' && o.key === S.active;
    const mat = kind === 'in' ? markerMats.in : (S.connectFrom === o.key ? markerMats.from : active ? markerMats.active : markerMats.out);
    const ring = new THREE.Mesh(ringGeo, mat);
    ring.quaternion.setFromUnitVectors(V(0, 0, 1), dir);
    g.add(ring);
    if (kind === 'out') {
      const cone = new THREE.Mesh(coneGeo, mat);
      cone.quaternion.setFromUnitVectors(UP, dir);
      cone.position.copy(dir).multiplyScalar(0.034);
      g.add(cone);
    }
    const hit = new THREE.Mesh(hitGeo, markerMats.hit);
    hit.userData.marker = { kind, ...o };
    g.add(hit);
    g.position.copy(o.port.p);
    g.userData.key = o.key;
    g.userData.active = active;
    if (!active && kind === 'out') g.scale.setScalar(0.8);
    markerGroup.add(g);
  };
  for (const o of openOuts) mk(o, 'out');
  if (S.tool === 'bridge') for (const n of openIns) mk(n, 'in');
  const ap = activePort();
  S.ringInfo = null;
  if (ap) {
    // a dashed plumb line from the ring down to whatever is below it: you can see how high you are
    const p = ap.port.p;
    probeRay.set(V(p.x, p.y - 0.02, p.z), V(0, -1, 0));
    const hit = probeRay.intersectObjects(room.solids, false)[0];
    const floorY = hit ? hit.point.y : 0;
    if (p.y - floorY > 0.04) {
      const g = new THREE.BufferGeometry().setFromPoints([V(p.x, p.y - 0.03, p.z), V(p.x, floorY + 0.002, p.z)]);
      const ln = new THREE.Line(g, dropMat); ln.computeLineDistances(); ln.raycast = () => {};
      const dot = new THREE.Mesh(dotGeo, dropDotMat); dot.rotation.x = -Math.PI / 2; dot.position.set(p.x, floorY + 0.002, p.z); dot.raycast = () => {};
      markerGroup.add(ln, dot);
    }
    S.ringInfo = { p: p.clone(), h: p.y - floorY, at: 0, html: '' };
  }
  const ip = insertPort();
  if (ip) {
    const ring = new THREE.Mesh(ringGeo, markerMats.insert);
    const dir = new THREE.Vector3(Math.cos(ip.psi) * Math.cos(ip.phi), -Math.sin(ip.phi), -Math.sin(ip.psi) * Math.cos(ip.phi));
    ring.quaternion.setFromUnitVectors(V(0, 0, 1), dir);
    ring.position.copy(ip.p);
    ring.scale.setScalar(1.25);
    ring.userData.active = true;
    markerGroup.add(ring);
  }
}

// ================================================================ ghost preview (while hovering/dragging a piece, placing or moving)
const ghostMats = {
  ok: new THREE.MeshBasicMaterial({ color: '#39d98a', transparent: true, opacity: 0.38, depthWrite: false }),
  bad: new THREE.MeshBasicMaterial({ color: '#ff4d4d', transparent: true, opacity: 0.38, depthWrite: false }),
};
const fakeWorld = { time: 0, devState: (dv) => (dv.initState ? dv.initState() : { count: 0, next: 0 }) };
let ghostInsts = [], ghostHidden = [];
function clearGhost() {
  for (const gi of ghostInsts) { ghostGroup.remove(gi.group); disposeGroup(gi.group); }
  for (const id of ghostHidden) if (insts.has(id)) insts.get(id).group.visible = true;
  ghostInsts = []; ghostHidden = [];
  S.ghostData = null; S.ghostValid = false;
  if (bumpT === Infinity) clearBump();
}
function ghostify(inst, bad) {
  inst.devices.forEach(dv => dv.update && dv.update(fakeWorld, 0));
  inst.group.traverse(o => { if (o.isMesh) { o.material = bad ? ghostMats.bad : ghostMats.ok; o.castShadow = false; o.receiveShadow = false; o.raycast = () => {}; } if (o.isSprite) o.visible = false; });
  ghostGroup.add(inst.group);
  ghostInsts.push(inst);
}
function resolveColor() { return S.color === 'rainbow' ? RAINBOW[S.rainbow % RAINBOW.length] : S.color; }
function makeData(toolKey, extra = {}, over = null) {
  const tool = TOOLS[toolKey], type = tool.piece;
  const opts = Object.assign({}, PIECES[type].defaults, S.opts[type], tool.opts || {}, over || {});
  const d = Object.assign({ id: S.nextId, type, slope: +S.slope.toFixed(5), style: S.style, color: resolveColor(), opts }, extra);
  if (type === 'curve' && !(over && 'bank' in over) && d.port) opts.bank = S.bank === 'auto' ? idealBank(d) ?? 15 : S.bank;
  return d;
}
// ---------------------------------------------------------------- banked curves
// A turn tilted towards its middle lets a fast ball go round without climbing the outer wall.
// The perfect tilt for speed v round radius r: tan θ = v² / (g·r)
S.bank = store.get('bc.bank', 'auto');
const BANKS = [[0, 'Flat'], [15, 'A little'], [30, 'A lot'], ['auto', 'Auto']];
function idealBank(d) {
  const P = d.port, v0 = predSpeedAt(V(P.x, P.y, P.z));
  if (v0 == null) return null;
  // the ball speeds up (or slows) on the way to the middle of the turn
  const L = d.opts.angle * DEG * d.opts.radius, drop = L / 2 * Math.sin(((P.phi || 0) + d.slope) / 2);
  const v2 = Math.max(0, v0 * v0 + 2 / (1 + BALL_TYPES[S.ballType].k) * world.g * drop);
  return Math.round(THREE.MathUtils.clamp(Math.atan(v2 / (world.g * d.opts.radius)) / DEG, 0, 40));
}
function showGhost(d) {
  clearGhost();
  if (!d) return;
  let inst;
  try { inst = buildPiece(d); } catch (e) { console.warn(e); return; }
  const reason = validatePiece(inst, [...insts.values()].filter(i => i.d.id !== d.id), room.colliders);
  ghostify(inst, !!reason);
  if (reason) showBump(true);
  S.ghostData = d; S.ghostValid = !reason; S.ghostReason = reason ? L(reason) : '';
}
function updateGhost() {
  if (S.move) return;
  const hv = S.hover && TOOLS[S.hover].type === 'append' ? S.hover : null;
  if (hv && S.insert) {
    clearGhost();
    const plan = planInsert(hv);
    if (!plan) { S.insert = null; drawMarkers(); return updateGhost(); }
    const byId = new Map((plan.list || []).map(d => [d.id, d]));
    for (const id of plan.order || [plan.d.id]) {
      ghostify(buildPiece(byId.get(id) || plan.d), !!plan.reason);
      // the pieces that move along are shown only where they would go
      if (insts.has(id)) { insts.get(id).group.visible = false; ghostHidden.push(id); }
    }
    S.ghostData = plan.d; S.ghostValid = !plan.reason; S.ghostReason = plan.reason ? L(plan.reason) : '';
    setHint(S.ghostValid ? `⤵ ${L(TOOLS[hv].label)} — ${L('the rest of the track moves along')}` : '⚠ ' + S.ghostReason);
    renderSelPop();
    return;
  }
  if (hv) {
    const ap = activePort();
    if (!ap) { clearGhost(); setHint(L('First place a 📍 Start Tower, or click a yellow ring')); return; }
    const gd = makeData(hv, { port: portToData(ap.port) });
    showGhost(gd);
    let extra = '';
    if (gd.type === 'loop' && S.ghostValid) {
      // rolling ball, no losses: v² = g·R·(1 + 4/(1+k)) at the bottom to stay on at the top
      const bt = BALL_TYPES[S.ballType], need = Math.sqrt(world.g * gd.opts.radius * (1 + 4 / (1 + bt.k)));
      const v = predSpeedAt(ap.port.p);
      extra = ` · ${L('needs ≥ {0} m/s', need.toFixed(2))}` + (v != null ? `, ${L('ball ≈ {0} m/s', v.toFixed(2))} ${v > need * 1.15 ? '✅' : '⚠️'}` : '');
    }
    setHint(S.ghostValid ? `${L(TOOLS[hv].label)} — ${L(TOOLS[hv].desc)}${extra}` : '⚠ ' + S.ghostReason);
    renderSelPop();
    return;
  }
  const t = TOOLS[S.tool];
  if (t.type === 'place') { setHint(L('Click a surface to place the {0} · wheel = height · Q / E = turn', L(t.label))); return; }
  updateHeightBar(null);
  clearGhost();
  if (S.insert && t.type === 'tool') setHint(L('⤵ Insert mode: pick a piece in the dock to slip it in · Esc to stop'));
  else if (S.tool === 'bridge') setHint(L(S.connectFrom ? 'Now click a blue ring to connect to' : 'Click a yellow ring to start the connector'));
  else if (S.tool === 'paint') setHint(L('Click or drag over pieces to paint them · Shift-click paints the whole run'));
  else if (S.tool === 'boxsel') setHint(L('Drag a box around pieces · Shift adds more'));
  else if (S.tool === 'hand') setHint(L('Click anywhere to drop a ball'));
  else if (S.tool === 'erase') setHint(L('Click pieces to remove them · Esc when done'));
  else setHint('');
  renderSelPop();
}

// ================================================================ committing pieces
// ---------------------------------------------------------------- one voice at a time
// Tips and the toys' chatter wait for a quiet moment: nothing talks over building, a notice or a modal
let lastEditAt = 0;
const quiet = (gap = 4000) => performance.now() - lastEditAt > gap && !$('toast').classList.contains('show') && !tutor.on && !MODALS.some(id => !$(id).classList.contains('hidden'));
function pushHistory() {
  lastEditAt = performance.now();
  const prev = hIdx >= 0 && history[hIdx] ? JSON.parse(history[hIdx]) : [];
  history = history.slice(0, hIdx + 1); histLabels = histLabels.slice(0, hIdx + 1);
  history.push(JSON.stringify(pieces)); histLabels.push(diffLabel(prev, pieces));
  if (history.length > 200) { history.shift(); histLabels.shift(); }
  hIdx = history.length - 1;
}
function commit(d, msg) {
  if (!canUse(toolKeyOf(d))) { toast(L('None of those left in the parts box'), true); sound.error(); return; }
  if (S.color === 'rainbow' && d.color === RAINBOW[S.rainbow % RAINBOW.length]) S.rainbow++;
  S.nextId = d.id + 1;
  S.selected = null; // no editor popping up: keep building, click a piece to change it
  sync(pieces.concat([d]), { activeFrom: d.id });
  pushHistory();
  const inst = insts.get(d.id);
  if (inst) { popIn(inst.group); glowBrief(inst.group); if (d.port && PIECES[d.type].kind !== 'place') snapFx(V(d.port.x, d.port.y, d.port.z)); }
  placeSound();
  if (msg) toast(msg);
  afterBuild();
}
// how the game feels (climbing notes, a buzz, the big finish, the energy bar, self-building) lives in feel.js
const feel = createFeel({
  S, $, sound, store, world, canvas, insts, popIn: (g) => popIn(g), touchScreen: () => touchScreen(), liveBalls: () => liveBalls(),
  get room() { return room; }, get pieces() { return pieces; }, get hIdx() { return hIdx; },
});
const { buzz, placeSound, assembleIn } = feel;
// the parts box of a challenge: how many of each piece may still be used
const toolKeyOf = (d) => d.type === 'curve' ? (d.opts.dir > 0 ? 'curveL' : 'curveR') : d.type === 'helix' ? (d.opts.dir > 0 ? 'helixL' : 'helixR') : TYPE_TOOL[d.type];
function partsLeft(key) {
  const lim = S.challenge && S.challenge.def.parts;
  if (!lim) return null;
  const used = pieces.filter(p => !p.locked && toolKeyOf(p) === key).length;
  return Math.max(0, (lim[key] || 0) - used);
}
const canUse = (key) => { const n = partsLeft(key); return n === null || n > 0; };
function tryAppend(toolKey) {
  if (S.insert) return insertPiece(toolKey);
  const ap = activePort();
  if (!ap) { toast(L('First place a 📍 Start Tower'), true); sound.error(); return false; }
  const d = makeData(toolKey, { port: portToData(ap.port) });
  const inst = buildPiece(d);
  const reason = validatePiece(inst, [...insts.values()], room.colliders);
  disposeGroup(inst.group);
  if (reason) { toast(L(reason), true); sound.error(); showBump(false); return false; }
  S.lastAppend = toolKey;
  commit(d);
  return true;
}
function undo() { if (hIdx <= 0) { if (hIdx === 0) { hIdx = -1; sync(pieces.filter(p => p.locked)); } return; } hIdx--; sync(JSON.parse(history[hIdx])); sound.click(); }
function redo() { if (hIdx >= history.length - 1) return; hIdx++; sync(JSON.parse(history[hIdx])); sound.click(); }

// ---------------------------------------------------------------- the track as a chain
// Every appended piece hangs off a ring of the piece before it. Editing, inserting or removing a
// piece re-flows everything after it, so the rest of the track follows like a real chain.
function chainLinks() {
  const kids = new Map(), parentOf = new Map();
  for (const d of pieces) {
    if (!d.port || PIECES[d.type].kind === 'place') continue;
    const P = V(d.port.x, d.port.y, d.port.z);
    for (const inst of insts.values()) {
      if (inst.d.id === d.id) continue;
      const k = inst.outs.findIndex(o => o.p.distanceToSquared(P) < 9e-6);
      if (k < 0) continue;
      parentOf.set(d.id, { id: inst.d.id, out: k });
      if (!kids.has(inst.d.id)) kids.set(inst.d.id, []);
      kids.get(inst.d.id).push({ id: d.id, out: k });
      break;
    }
  }
  return { kids, parentOf };
}
// rebuild from `startId` down the chain: every child moves onto its parent's new ring
function reflow(list, startId, kids) {
  const byId = new Map(list.map(d => [d.id, d]));
  const order = [], queue = [startId], seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id); order.push(id);
    const inst = buildPiece(byId.get(id));
    disposeGroup(inst.group);
    for (const ch of kids.get(id) || []) {
      const o = inst.outs[ch.out];
      if (!o || byId.get(ch.id).locked) continue; // the new shape has fewer rings: that branch stays where it was
      byId.set(ch.id, { ...byId.get(ch.id), port: portToData(o) });
      queue.push(ch.id);
    }
  }
  return { list: list.map(d => byId.get(d.id)), order };
}
// the re-flowed pieces must not run into the room or the rest of the track
function chainProblem(list, order) {
  const changed = new Set(order), alive = new Set(list.map(d => d.id)), byId = new Map(list.map(d => [d.id, d]));
  const checked = [...insts.values()].filter(i => alive.has(i.d.id) && !changed.has(i.d.id));
  const built = [];
  let reason = null;
  for (const id of order) {
    const inst = buildPiece(byId.get(id));
    built.push(inst);
    reason = validatePiece(inst, checked, room.colliders);
    if (reason) break;
    checked.push(inst);
  }
  built.forEach(b => disposeGroup(b.group));
  return reason;
}
function deletePiece(id) {
  const d = pieces.find(p => p.id === id);
  if (!d) return;
  if (d.locked) { toast(L('Locked in this challenge'), true); sound.error(); return; }
  const { kids, parentOf } = chainLinks();
  const par = parentOf.get(id), mine = kids.get(id) || [];
  let list = pieces.filter(p => p.id !== id), healed = false;
  // close the gap: the piece after it moves back onto the ring this one hung from
  if (par && mine.length === 1) {
    kids.delete(id);
    const r = reflow(list.map(p => p.id === mine[0].id ? { ...p, port: d.port } : p), mine[0].id, kids);
    if (!chainProblem(r.list, r.order)) { list = r.list; healed = true; }
  }
  if (S.selected === id) S.selected = null;
  if (S.insert && (S.insert.parent === id)) S.insert = null;
  sync(list, { activeFrom: healed ? undefined : par?.id });
  pushHistory();
  sound.remove();
  const name = pieceLabel(d);
  toast(mine.length && !healed ? L('Removed — the pieces after it stay where they are') : healed ? L('Removed {0} — the track closed the gap', name) : L('Removed {0}', name), false, undo);
}
function tweakSelected(change) {
  const id = S.selected;
  const d = pieces.find(p => p.id === id);
  if (!d) return;
  if (d.locked) { toast(L('Locked in this challenge'), true); return; }
  const nd = JSON.parse(JSON.stringify(d));
  change.apply(nd);
  if (JSON.stringify(nd) === JSON.stringify(d)) return;
  let list = pieces.map(p => p.id === id ? nd : p);
  if (change.geom) {
    const r = reflow(list, id, chainLinks().kids);
    const reason = chainProblem(r.list, r.order);
    if (reason) { toast(L(reason), true); sound.error(); showBump(false); return; }
    list = r.list;
  }
  sync(list, { activeFrom: id });
  pushHistory();
  sound.click();
}
// insert a piece in the middle of the track: it takes the ring, and the rest moves along
function startInsert(id) {
  const { kids } = chainLinks();
  const k = (kids.get(id) || [])[0];
  if (!k) return;
  S.insert = { parent: id, out: k.out };
  select(null); drawMarkers(); updateGhost();
  sound.click();
}
const insertPort = () => { const I = S.insert, inst = I && insts.get(I.parent); return inst ? inst.outs[I.out] : null; };
function planInsert(toolKey) { return S.insert ? planInsertAt(S.insert, toolKey) : null; }
function planInsertAt(I, toolKey, opts) {
  const inst0 = insts.get(I.parent), at = inst0 && inst0.outs[I.out];
  if (!at) return null;
  const d = makeData(toolKey, { port: portToData(at) });
  if (opts) Object.assign(d.opts, opts);
  const probe = buildPiece(d), hasOut = probe.outs.length > 0;
  disposeGroup(probe.group);
  if (!hasOut) return { d, reason: 'Only pieces with an exit can go in the middle' };
  const { kids } = chainLinks();
  const all = kids.get(I.parent) || [];
  kids.set(I.parent, all.filter(c => c.out !== I.out));
  kids.set(d.id, all.filter(c => c.out === I.out).map(c => ({ id: c.id, out: 0 })));
  const r = reflow(pieces.concat([d]), d.id, kids);
  return { d, ...r, reason: chainProblem(r.list, r.order) };
}
function insertPiece(toolKey) {
  if (!canUse(toolKey)) { toast(L('None of those left in the parts box'), true); sound.error(); return false; }
  const plan = planInsert(toolKey);
  if (!plan) { S.insert = null; drawMarkers(); return false; }
  const { d, reason } = plan, r = plan;
  if (reason) { toast(L(reason), true); sound.error(); showBump(false); return false; }
  if (S.color === 'rainbow' && d.color === RAINBOW[S.rainbow % RAINBOW.length]) S.rainbow++;
  S.nextId = d.id + 1;
  S.insert = { parent: d.id, out: 0 }; // keep inserting after the new piece
  sync(r.list);
  pushHistory();
  const inst = insts.get(d.id);
  if (inst) popIn(inst.group);
  S.lastAppend = toolKey;
  placeSound();
  drawMarkers(); updateGhost();
  afterBuild();
  return true;
}

// ---------------------------------------------------------------- moving a whole coaster
// rotate around `base` by dyaw, then shift by delta
function movePort(q, base, delta, dyaw) {
  const dx = q.x - base.x, dz = q.z - base.z, c = Math.cos(dyaw), s = Math.sin(dyaw);
  return { ...q, x: +(base.x + dx * c + dz * s + delta.x).toFixed(5), y: +(q.y + delta.y).toFixed(5), z: +(base.z - dx * s + dz * c + delta.z).toFixed(5), psi: +(q.psi + dyaw).toFixed(5) };
}
function movedList(ids, base, delta, dyaw, rootId, rootHeight) {
  return pieces.map(p => {
    if (!ids.has(p.id)) return p;
    const n = JSON.parse(JSON.stringify(p));
    if (n.port) n.port = movePort(n.port, base, delta, dyaw);
    if (n.to) n.to = movePort(n.to, base, delta, dyaw);
    if (p.id === rootId && rootHeight !== undefined) { n.opts.height = rootHeight; n.port = movePort(p.port, base, { x: delta.x, y: delta.y - (rootHeight - p.opts.height), z: delta.z }, dyaw); }
    return n;
  });
}
function checkMoved(list, ids) {
  const others = [...insts.values()].filter(i => !ids.has(i.d.id));
  const built = list.filter(p => ids.has(p.id)).map(p => buildPiece(p));
  let reason = null;
  for (const b of built) { reason = validatePiece(b, others.concat(built.filter(x => x !== b && false)), room.colliders); if (reason) break; }
  return { built, reason };
}
function applyMove(list, ids, okMsg) {
  const { built, reason } = checkMoved(list, ids);
  built.forEach(b => disposeGroup(b.group));
  if (reason) { toast(L(reason), true); sound.error(); return false; }
  sync(list);
  pushHistory();
  sound.place();
  if (okMsg) toast(okMsg);
  return true;
}
function startMove(id) {
  const ids = component(id);
  if ([...ids].some(i => pieces.find(p => p.id === i)?.locked)) { toast(L('Locked in this challenge'), true); return; }
  const d = pieces.find(p => p.id === id);
  S.move = { ids, root: id, base: V(d.port.x, d.port.y, d.port.z), yaw: 0, list: null, at: 0 };
  for (const i of ids) insts.get(i).group.visible = false;
  select(null);
  markerGroup.visible = false;
  setHint(L('Move: click a surface to drop it · Q / E turn · Esc cancel'));
}
function moveTo(point) {
  const M = S.move;
  if (!M || performance.now() - M.at < 45) return;
  M.at = performance.now();
  const delta = point.clone().sub(M.base);
  M.list = movedList(M.ids, M.base, delta, M.yaw, M.root);
  clearGhost();
  const { built, reason } = checkMoved(M.list, M.ids);
  for (const b of built) ghostify(b, !!reason);
  M.reason = reason;
  setHint(reason ? '⚠ ' + L(reason) : L('Move: click a surface to drop it · Q / E turn · Esc cancel'));
}
function endMove(commitIt) {
  const M = S.move;
  if (!M) return;
  S.move = null;
  clearGhost();
  markerGroup.visible = S.cam === 'orbit' && !S.photo;
  for (const i of M.ids) if (insts.has(i)) insts.get(i).group.visible = true;
  if (commitIt && M.list) {
    if (M.reason) { toast(L(M.reason), true); sound.error(); }
    else { sync(M.list); pushHistory(); sound.place(); select(M.root); }
  }
  setHint('');
}
function turnPiece(id, dyaw) {
  const d = pieces.find(p => p.id === id);
  const ids = component(id);
  if ([...ids].some(i => pieces.find(p => p.id === i)?.locked)) { toast(L('Locked in this challenge'), true); return; }
  applyMove(movedList(ids, V(d.port.x, d.port.y, d.port.z), V(), dyaw, id), ids);
  select(id);
}
function setPlaceHeight(id, h) {
  const d = pieces.find(p => p.id === id);
  const ids = component(id);
  if (d.locked) { toast(L('Locked in this challenge'), true); return; }
  S.opts[d.type].height = h;
  const dy = h - (d.opts.height ?? 0);
  if (applyMove(movedList(ids, V(d.port.x, d.port.y, d.port.z), V(0, dy, 0), 0, id, h), ids)) select(id);
}

// ================================================================ selection highlight + floating editor
const hiCache = new WeakMap();
let hiGroup = null;
function select(id) {
  if (hiGroup) setHighlight(hiGroup, false);
  hiGroup = null;
  S.selected = id && insts.has(id) ? id : null;
  if (S.selected) {
    hiGroup = insts.get(S.selected).group;
    setHighlight(hiGroup, true);
    const box = new THREE.Box3();
    for (const c of hiGroup.children) if (c !== insts.get(S.selected).pillars && !c.isSprite) box.expandByObject(c);
    S.selAnchor.set((box.min.x + box.max.x) / 2, box.max.y + 0.01, (box.min.z + box.max.z) / 2);
  }
  if (S.selected) store.set('bc.handleTip', store.get('bc.handleTip', 0) + 1);
  renderSelPop();
  refreshHandles();
  if (S.selected && selMode()) requestAnimationFrame(keepInView);
}
function setHighlight(group, on, color = '#ff9a3c', k = 0.35) {
  const glowMat = (m) => { const c = m.clone(); if (c.emissive) { c.emissive = new THREE.Color(color); c.emissiveIntensity = k; } return c; };
  group.traverse(o => {
    if (!o.isMesh || !o.material || o.material.transparent) return;
    if (on) {
      if (!hiCache.has(o)) hiCache.set(o, o.material);
      else (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      const base = hiCache.get(o);
      o.material = Array.isArray(base) ? base.map(glowMat) : glowMat(base);
    } else if (hiCache.has(o)) {
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      o.material = hiCache.get(o); hiCache.delete(o);
    }
  });
}
function renderSelPop() {
  const el = $('selPop');
  const d = S.selected && pieces.find(p => p.id === S.selected);
  if (!d || S.cam !== 'orbit' || S.hover || S.photo || S.move || S.replay) { el.classList.add('hidden'); document.body.classList.remove('sel-sheet', 'sel-aside'); return; }
  el.classList.remove('hidden');
  placeSelPop(el);
  el.innerHTML = '';
  const place = PIECES[d.type].kind === 'place';
  const locked = !!d.locked;
  const hd = document.createElement('div'); hd.className = 'hd';
  hd.innerHTML = `${ICONS[pieceIcon(d)] || ''}<span>${pieceLabel(d)}</span>`;
  const walk = (txt, dir, title) => { const b = document.createElement('button'); b.className = 'walk'; b.textContent = txt; b.title = title; b.onclick = () => stepSelection(dir); return b; };
  if (!place) hd.append(walk('◀', -1, L('Previous piece') + ' · ,'), walk('▶', 1, L('Next piece') + ' · .'));
  const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.title = 'Esc';
  x.onclick = () => select(null);
  hd.appendChild(x); el.appendChild(hd);
  const info = insight.pieceInfo(d.id);
  if (info) { const n = document.createElement('div'); n.className = 'note'; n.textContent = info; el.appendChild(n); }
  const row = (label, build) => { const r = document.createElement('div'); r.className = 'row'; r.innerHTML = `<span class="lbl">${L(label)}</span>`; const c = document.createElement('div'); c.className = 'chips'; build(c); r.appendChild(c); el.appendChild(r); };
  for (const [key, label, vals] of OPTIONS[d.type] || []) {
    // the height of a free-standing piece can always change: everything attached moves with it
    const free = place && key === 'height' && !d.locked;
    let list = vals.map(([v, l]) => [v, optLabel(v, l)]);
    if (key === 'bank') {
      // the perfect tilt for how fast the ball comes in
      const ib = idealBank(d), same = list.find(x => x[0] === ib);
      if (same) same[1] = '✨ ' + same[1];
      else if (ib != null) list.push([ib, `✨ ${L('Auto')} ${ib}°`]);
    }
    row(label, c => chips(c, list, v => v === d.opts[key], v => {
      S.opts[d.type][key] = v; // remember it for the next one too
      if (free) setPlaceHeight(d.id, v);
      else tweakSelected({ geom: true, apply: nd => { nd.opts[key] = v; } });
    }, 'chip', locked && !free));
  }
  if (S.pro && !locked) {
    // fine steps for every number
    const FINE = { len: 0.01, angle: 5, radius: 0.005, height: 0.01, turns: 0.25, size: 0.005, power: 0.1, interval: 0.5, speed: 0.1 };
    for (const key of Object.keys(d.opts).filter(k => FINE[k] && typeof d.opts[k] === 'number')) {
      row(key[0].toUpperCase() + key.slice(1), c => {
        const mk = (txt, dv) => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = txt; b.onclick = () => { const v = +(d.opts[key] + dv).toFixed(3); if (v <= 0) return; if (place && key === 'height') setPlaceHeight(d.id, v); else tweakSelected({ geom: true, apply: nd => { nd.opts[key] = v; } }); }; return b; };
        const val = document.createElement('b'); val.className = 'fineVal'; val.textContent = ['len', 'height', 'radius'].includes(key) ? cm(d.opts[key]) : String(d.opts[key]);
        c.append(mk('−', -FINE[key]), val, mk('+', FINE[key]));
      });
    }
    if (!place) row('Slope °', c => {
      const mk = (txt, dv) => { const b = document.createElement('button'); b.className = 'chip'; b.textContent = txt; b.onclick = () => tweakSelected({ geom: true, apply: nd => { nd.slope = +THREE.MathUtils.clamp(nd.slope + dv * DEG, -6 * DEG, 35 * DEG).toFixed(5); } }); return b; };
      const val = document.createElement('b'); val.className = 'fineVal'; val.textContent = (d.slope / DEG).toFixed(0) + '°';
      c.append(mk('−', -1), val, mk('+', 1));
    });
  }
  if (!['cup', 'basket', 'tramp', 'dominoes', 'bell', 'bumper'].includes(d.type)) {
    row('Slope', c => chips(c, SLOPES.map(([v, l]) => [v, L(l)]), v => Math.abs(v * DEG - d.slope) < 1e-4, v => tweakSelected({ geom: true, apply: nd => { nd.slope = +(v * DEG).toFixed(5); } }), 'chip', locked));
  }
  if (!d.locked) row('Look', c => {
    const sw = document.createElement('button');
    sw.className = 'swatch pick'; sw.style.background = COLORS[d.color] || '#e0c39a'; sw.dataset.menu = ''; sw.title = L('Color');
    sw.onclick = () => openMenu($('popMenu'), sw, menu => {
      menu.innerHTML = '';
      const cc = document.createElement('div'); cc.className = 'chips pal';
      chips(cc, Object.keys(COLORS).map(k => [k, '', `background:${COLORS[k]}`]), v => v === d.color, v => { closeMenus(); tweakSelected({ geom: false, apply: nd => { nd.color = v; } }); }, 'swatch');
      menu.appendChild(cc);
    }, !!selMode());
    c.appendChild(sw);
    if (!TRACK_TYPES.includes(d.type)) return;
    const st = document.createElement('button');
    st.className = 'chip pick'; st.dataset.menu = ''; st.title = L('Track style');
    st.innerHTML = `${L(STYLE_ITEMS.find(x => x[0] === d.style)?.[1] || d.style)} <i class="caret">▾</i>`;
    st.onclick = () => openMenu($('popMenu'), st, menu => {
      menu.innerHTML = STYLE_ITEMS.map(([v, l]) => `<button data-style="${v}" class="${v === d.style ? 'on' : ''}">${L(l)}</button>`).join('');
      menu.onclick = (e) => { const b = e.target.closest('[data-style]'); if (!b) return; closeMenus(); tweakSelected({ geom: false, apply: nd => { nd.style = b.dataset.style; } }); };
    }, !!selMode());
    c.appendChild(st);
  });
  if (d.locked) { const n = document.createElement('div'); n.className = 'note'; n.textContent = '🔒 ' + L('Locked in this challenge'); el.appendChild(n); }
  const ft = document.createElement('div'); ft.className = 'ft';
  const btn = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = L(label); if (cls) b.className = cls; b.onclick = fn; ft.appendChild(b); };
  if (place && !d.locked) {
    btn('✥ Move', '', () => startMove(d.id));
    btn('⟲', '', () => turnPiece(d.id, 45 * DEG));
    btn('⟳', '', () => turnPiece(d.id, -45 * DEG));
  }
  if (d.type === 'dominoes') btn('↺ Stand up', '', () => { for (const dv of insts.get(d.id).devices) if (dv.reset) dv.reset(world); sound.click(); });
  const own = openOuts.find(o => o.id === d.id);
  if (own && own.key !== S.active) btn('➕ Build from here', '', () => { S.active = own.key; S.insert = null; select(null); drawMarkers(); renderDock(); sound.click(); });
  if (chainLinks().kids.has(d.id)) btn('⤵ Insert after', '', () => startInsert(d.id));
  if (!d.locked) btn('🗑 Delete', 'del', () => deletePiece(d.id));
  el.appendChild(ft);
  if (HANDLE[d.type] && !d.locked && store.get('bc.handleTip', 0) < 4) { const n = document.createElement('div'); n.className = 'note'; n.textContent = L(touchScreen() ? 'Tip: drag the orange handle · hold a piece for more' : 'Tip: drag the orange handle · Shift = slope · right-click for more'); el.appendChild(n); }
}
// on a phone the editor takes the dock's place as a sheet (or sits on the right when the phone lies on its side)
const touchScreen = () => matchMedia('(pointer: coarse)').matches;
const selMode = () => !phone() ? '' : window.innerHeight <= 520 ? 'aside' : 'sheet';
function placeSelPop(el) {
  const mode = selMode();
  if (mode === 'sheet' && el.parentElement !== $('dock')) $('dock').prepend(el);
  if (mode !== 'sheet' && el.parentElement !== document.body) document.body.appendChild(el);
  el.classList.toggle('sheet', mode === 'sheet'); el.classList.toggle('aside', mode === 'aside');
  document.body.classList.toggle('sel-sheet', mode === 'sheet'); document.body.classList.toggle('sel-aside', mode === 'aside');
  if (mode) el.style.left = el.style.top = el.style.visibility = '';
}
// ...and the chosen piece slides into the part of the screen the editor leaves free
function keepInView() {
  const el = $('selPop');
  if (!S.selected || S.cam !== 'orbit' || el.classList.contains('hidden')) return;
  const r = el.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
  const box = { l: 0, r: el.classList.contains('aside') ? r.left : W, t: $('top').getBoundingClientRect().bottom, b: el.classList.contains('sheet') ? r.top : H - $('dock').offsetHeight };
  _v.copy(S.selAnchor).project(camera);
  const ax = (_v.x + 1) / 2 * W, ay = (1 - _v.y) / 2 * H, m = 50;
  if (_v.z < 1 && ax > box.l + m && ax < box.r - m && ay > box.t + m && ay < box.b - m) return;
  const fwd = camera.getWorldDirection(V());
  const wpp = 2 * Math.max(0.05, S.selAnchor.clone().sub(camera.position).dot(fwd)) * Math.tan(camera.fov * DEG / 2) / H;
  const shift = V().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(-((box.l + box.r) / 2 - ax) * wpp)
    .addScaledVector(V().setFromMatrixColumn(camera.matrixWorld, 1), ((box.t + box.b) / 2 - ay) * wpp);
  flyTo(camera.position.clone().add(shift), controls.target.clone().add(shift));
}
// the little tag under the active ring: how high it is and how fast the ball gets there
function positionRingTag(now) {
  const el = $('ringTag'), I = S.ringInfo;
  const show = I && S.cam === 'orbit' && !S.photo && !S.replay && !S.move && markerGroup.visible;
  el.classList.toggle('hidden', !show);
  if (!show) return;
  if (now - I.at > 250) {
    I.at = now;
    const v = S.predict ? predSpeedAt(I.p) : null;
    const html = `${S.arrows ? `<button class="plus${padOpen() ? ' on' : ''}" title="${L('Build arrows')}">＋</button>` : ''}<b>↧ ${(I.h * 100).toFixed(0)} ${L('cm')}</b>${v != null ? ` · ⚡ ${v.toFixed(2)} ${L('m/s')}` : ''}${S.insert ? ` · <span class="ins">⤵ ${L('inserting')}</span>` : ''}`;
    if (html !== I.html) { el.innerHTML = html; I.html = html; }
  }
  _v.copy(I.p).project(camera);
  const r = canvas.getBoundingClientRect();
  el.style.left = (r.left + (_v.x + 1) / 2 * r.width) + 'px';
  el.style.top = (r.top + (1 - _v.y) / 2 * r.height + 26) + 'px';
  el.style.visibility = _v.z > 1 ? 'hidden' : 'visible';
}
const _v = V();
function positionSelPop() {
  const el = $('selPop');
  if (el.classList.contains('hidden') || el.classList.contains('sheet') || el.classList.contains('aside')) return;
  _v.copy(S.selAnchor).project(camera);
  const r = canvas.getBoundingClientRect();
  let x = r.left + (_v.x + 1) / 2 * r.width, y = r.top + (1 - _v.y) / 2 * r.height;
  const w = el.offsetWidth, h = el.offsetHeight;
  x = THREE.MathUtils.clamp(x, w / 2 + 10, window.innerWidth - w / 2 - 10);
  y = THREE.MathUtils.clamp(y, h + 80, window.innerHeight - 20);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.visibility = _v.z > 1 ? 'hidden' : 'visible';
}

// ================================================================ balls
const ballGeo = new Map();
const ballMats = new Map();
function ballMaterial(type, color) {
  const k = type + color;
  if (!ballMats.has(k)) {
    const o = { map: TX.marbleTexture(color, type), emissive: color, emissiveIntensity: S.night ? 0.55 : 0 };
    let m;
    if (type === 'glass') m = new THREE.MeshPhysicalMaterial({ ...o, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03 });
    else if (type === 'wood') m = new THREE.MeshStandardMaterial({ ...o, roughness: 0.55 });
    else if (type === 'rubber') m = new THREE.MeshPhysicalMaterial({ ...o, roughness: 0.45, clearcoat: 0.3 });
    else if (type === 'plastic') m = new THREE.MeshPhysicalMaterial({ ...o, roughness: 0.22, clearcoat: 0.8 });
    else m = new THREE.MeshStandardMaterial({ ...o, roughness: 0.95 });
    ballMats.set(k, m);
  }
  return ballMats.get(k);
}
function ballMesh(type, color, r) {
  if (!ballGeo.has(r)) ballGeo.set(r, new THREE.SphereGeometry(r, 28, 18));
  const m = new THREE.Mesh(ballGeo.get(r), ballMaterial(type, color));
  m.castShadow = true;
  return m;
}
let colorIdx = 0;
function spawnBall(pos, vel) {
  const b = new Ball(S.ballType, pos, vel);
  b.color = BALL_COLORS[colorIdx++ % BALL_COLORS.length];
  b.mesh = ballMesh(b.type, b.color, b.r);
  b.mesh.userData.ball = b;
  b.mesh.position.copy(b.pos);
  ballGroup.add(b.mesh);
  world.addBall(b);
  world.refreshCandidates(b, 0.05);
  b.stats.E0 = b.energy(world.g).total;
  b.trail = makeTrail(b);
  b.lastPos = b.pos.clone();
  b.ch = { loop: false, teddy: false, tramp: false, notes: 0, lifts: 0, air: 0, maxAir: 0, splash: false, photos: 0, gadgets: new Set() };
  return b;
}
function removeBall(b) {
  insight.ballGone(b);
  ballGroup.remove(b.mesh);
  if (b.trail) { fxGroup.remove(b.trail.line); b.trail.line.geometry.dispose(); }
  const i = world.balls.indexOf(b);
  if (i >= 0) world.balls.splice(i, 1);
  if (S.follow === b) followNext(b);
}
function starts() { return [...insts.values()].filter(i => i.spawn); }
function releaseAll(quiet) {
  const st = starts();
  if (!st.length) { if (!quiet) { toast(L('First place a 📍 Start Tower'), true); sound.error(); } return []; }
  sound.ensure();
  S.releases = (S.releases || 0) + 1;
  const made = st.map(i => spawnBall(i.spawn.clone().add(V((Math.random() - 0.5) * 0.002, 0, (Math.random() - 0.5) * 0.002))));
  if (!quiet) sound.release();
  if (!S.follow || !world.balls.includes(S.follow)) S.follow = made[0];
  return made;
}
function clearBalls() {
  for (const b of [...world.balls]) removeBall(b);
  S.follow = null;
  // dominoes stand up again too
  for (const dv of world.devices) if (dv instanceof DominoRow) dv.reset(world);
}
const liveBalls = () => world.balls.filter(b => !b.dead && !b.collected);
function followNext(old) {
  const live = liveBalls().filter(b => b !== old);
  S.follow = live.length ? live[live.length - 1] : null;
  if (!S.follow && S.cam !== 'orbit') setTimeout(() => { if (!S.follow && !S.replay) setCam('orbit'); }, 800);
}
function cycleBall(dir) {
  const live = liveBalls();
  if (!live.length) return;
  const i = live.indexOf(S.follow);
  S.follow = live[(i + dir + live.length) % live.length];
}

// trails
function makeTrail(b) {
  const N = 40;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = b.pos.x; pos[i * 3 + 1] = b.pos.y; pos[i * 3 + 2] = b.pos.z; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const c = new THREE.Color(b.color);
  for (let i = 0; i < N; i++) { const f = 1 - i / N; col[i * 3] = c.r * f + (1 - f); col[i * 3 + 1] = c.g * f + (1 - f); col[i * 3 + 2] = c.b * f + (1 - f); }
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7 }));
  line.frustumCulled = false;
  line.visible = S.trails;
  fxGroup.add(line);
  return { line, N };
}
function updateTrail(b) {
  const t = b.trail; if (!t) return;
  t.line.visible = S.trails && S.cam !== 'pov' && !S.photo && !S.replay;
  const a = t.line.geometry.attributes.position.array;
  if ((b.pos.x - a[0]) ** 2 + (b.pos.y - a[1]) ** 2 + (b.pos.z - a[2]) ** 2 < 4e-6) return;
  a.copyWithin(3, 0, (t.N - 1) * 3);
  a[0] = b.pos.x; a[1] = b.pos.y; a[2] = b.pos.z;
  t.line.geometry.attributes.position.needsUpdate = true;
}

// ================================================================ world events → sound, fx, challenge tracking
const camPos = V();
const NOTE_COLORS = ['#ff5d5d', '#ff9f43', '#ffd23f', '#3ccf7a', '#2ec4b6', '#4c8dff', '#9b6bff', '#ff77b7'];
const C = { goals: [], dominoes: false, maxNotes: 0, maxLifts: 0, teddy: false, splash: false, maxPhotos: 0, best: null, maxGadgets: 0 };
const GADGET_EVENTS = { note: 'xylophone', brush: 'brake', boost: 'booster', gate: 'gate', sensor: 'sensor', photo: 'photo', lift: 'lift', kick: 'bumper', splash: 'splash', domino: 'dominoes' };
let lastGoalToast = -1e9;
function onWorldEvent(type, a, b, c, d) {
  // which ball this event is about (for ride reports and the watching toys)
  const ball = type === 'impact' || type === 'kick' || type === 'splash' || type === 'clack' ? a : b instanceof Ball ? b : null;
  if (ball) insight.event(type === 'impact' && d && d.device instanceof BellDevice ? 'bell' : type, ball);
  if (ball && ball.ch && GADGET_EVENTS[type]) ball.ch.gadgets.add(GADGET_EVENTS[type]);
  if (ball && ball.ch && type === 'impact' && d && d.device instanceof BellDevice) ball.ch.gadgets.add('bell');
  visitors.react(type, ball, a);
  if (type === 'impact') {
    sound.impact(b, c.sound, a.type, a.pos.distanceTo(camPos));
    if (d && d.device instanceof TrampolineDevice) { d.device.bounce(); if (a.ch) a.ch.tramp = true; }
    if (d && d.device instanceof BellDevice) { d.device.ring(b); sound.bell(d.device.size, b); }
  } else if (type === 'kick') { if (b.device instanceof BumperDevice) b.device.flash(); sound.bumper(); }
  else if (type === 'brush') sound.brush(c);
  else if (type === 'boost') { sound.boost(); sparkle(b.pos, '#ffd23f', 5); if (b.ch) b.ch.gadgets.add('boost'); }
  else if (type === 'gate') sound.gate();
  else if (type === 'splash') { sound.splash(b); splashFx(a.pos, b); sticker('splash'); if (a.ch) { C.splashes.push({ ride: world.time - a.stats.born, air: Math.max(a.ch.maxAir, a.ch.air) }); a.ch.splash = true; C.splash = true; if (!a.ch.gadgets.has('splash')) a.ch.gadgets.add('splash'); } }
  else if (type === 'sensor') { sensorEffect(a, b); if (b.ch) b.ch.gadgets.add('sensor'); }
  else if (type === 'photo') { takeBallPhoto(a, b); if (b.ch) { b.ch.photos++; C.maxPhotos = Math.max(C.maxPhotos, b.ch.photos); } }
  else if (type === 'clack') sound.clack(c);
  else if (type === 'note') { sound.note(a); sparkle(b.pos, NOTE_COLORS[a], 4); if (b.ch) { b.ch.notes++; C.maxNotes = Math.max(C.maxNotes, b.ch.notes); } }
  else if (type === 'goal') {
    // a plinko bin scores its own points; the 5 gets the big fanfare
    S.score += b.plinko || 1; buzz([30, 40, 60]); confetti(b.pos, b.plinko === 5 ? 120 : 60);
    if (b.plinko === 5) sound.fanfare(); else sound.goal();
    // with many balls scoring, the cup's own counter does the talking: a notice at most every 6 s
    if (b.plinko === 5 || performance.now() - lastGoalToast > 6000) { lastGoalToast = performance.now(); toast(b.plinko ? L('Plinko! +{0} · {1}', b.plinko, S.score) : L('🎯 Goal! · {0}', S.score)); }
    sticker('first-goal'); raceGoal(b);
    if (b.ch) C.goals.push({ ride: world.time - b.stats.born, pieceId: a.pieceId, loop: b.ch.loop, teddy: b.ch.teddy, tramp: b.ch.tramp, air: Math.max(b.ch.maxAir, b.ch.air), splash: b.ch.splash, gadgets: b.ch.gadgets.size });
  }
  else if (type === 'switch') sound.switchFlip();
  else if (type === 'lift') { sound.lift(); if (b.ch) { b.ch.lifts++; C.maxLifts = Math.max(C.maxLifts, b.ch.lifts); } }
  else if (type === 'liftdrop') b.stats.E0 = b.energy(world.g).total;
  else if (type === 'domino') sound.domino(b);
  else if (type === 'dominoes') { C.dominoes = true; sound.goal(); }
  else if (type === 'thunk') sound.thunk(b);
}

// confetti / sparkles
const PART_N = 500;
const partMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.008, 0.012), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), PART_N);
partMesh.frustumCulled = false; partMesh.count = 0;
fxGroup.add(partMesh);
const parts = [];
function confetti(p, n = 60) { if (reduceMotion()) n = Math.ceil(n / 3); for (let i = 0; i < n; i++) addPart(p, V((Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 1.2, (Math.random() - 0.5) * 1.2), BALL_COLORS[i % BALL_COLORS.length], 1.6); }
function sparkle(p, col, n) { for (let i = 0; i < n; i++) addPart(p, V((Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4), col, 0.6); }
function addPart(p, v, col, life) {
  if (parts.length >= PART_N) parts.shift();
  parts.push({ p: p.clone(), v, c: new THREE.Color(col), life, t: 0, rot: V(Math.random() * 6, Math.random() * 6, Math.random() * 6), w: V(Math.random() * 20, Math.random() * 20, 0) });
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = V(1, 1, 1);
function updateParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i];
    q.t += dt;
    if (q.t > q.life) { parts.splice(i, 1); continue; }
    q.v.y -= 3 * dt; q.v.multiplyScalar(1 - 2.5 * dt);
    q.p.addScaledVector(q.v, dt);
    q.rot.addScaledVector(q.w, dt);
  }
  partMesh.count = parts.length;
  parts.forEach((q, i) => {
    const sc = 1 - q.t / q.life;
    _s.set(sc, sc, sc);
    _m4.compose(q.p, _q.setFromEuler(_e.set(q.rot.x, q.rot.y, q.rot.z)), _s);
    partMesh.setMatrixAt(i, _m4);
    partMesh.setColorAt(i, q.c);
  });
  partMesh.instanceMatrix.needsUpdate = true;
  if (partMesh.instanceColor) partMesh.instanceColor.needsUpdate = true;
}

// piece pop-in animation
const pops = [];
function popIn(group) { if (!reduceMotion()) pops.push({ g: group, t: 0 }); }
function updatePops(dt) {
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i]; p.t += dt;
    const k = p.t / 0.35;
    p.g.position.y = k >= 1 ? 0 : 0.03 * (1 - k) * Math.cos(k * Math.PI * 3);
    if (k >= 1) pops.splice(i, 1);
  }
}

// ================================================================ prediction (same physics, silent world)
const pred = { runs: [], dirty: true, at: 0, running: false };
function schedulePrediction() { pred.dirty = true; pred.at = performance.now(); }
function speedColor(v, out) { const t = Math.min(1, v / 2.5); return out.setHSL(0.62 - t * 0.62, 0.9, 0.5); }
function startPrediction() {
  predGroup.clear();
  pred.runs = []; pred.running = false;
  if (!S.predict) { renderPred(); return; }
  const st = starts().slice(0, 4);
  if (!st.length) { renderPred(); return; }
  for (const inst of st) {
    const w = new World({ silent: true });
    w.g = world.g; w.rho = world.rho; w.time = world.time; w.assist = world.assist;
    w.setColliders(world.colliders, world.devices);
    w.water = world.water;
    for (const dv of world.devices) {
      if (dv instanceof SwitchDevice) w.devState(dv).next = world.devState(dv).next;
      if (dv instanceof RotorBody) Object.assign(w.devState(dv), world.devState(dv));
    }
    const b = w.addBall(new Ball(S.ballType, inst.spawn));
    const N = 6000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setDrawRange(0, 0);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
    line.frustumCulled = false;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(400 * 3), 3));
    tg.setDrawRange(0, 0);
    const ticks = new THREE.Points(tg, new THREE.PointsMaterial({ color: '#ffffff', size: 4, sizeAttenuation: false }));
    ticks.frustumCulled = false;
    predGroup.add(line, ticks);
    pred.runs.push({ w, b, line, ticks, v: new Float32Array(N), gs: new Float32Array(N), n: 0, nt: 0, N, t0: w.time, done: false, outcome: '', maxV: 0, maxG: 0, still: 0, acc: 0, inst, liftT: 0, lastTrack: inst.spawn.clone() });
  }
  pred.running = true;
}
const _c = new THREE.Color();
function tickPrediction() {
  if (pred.dirty && performance.now() - pred.at > 120) { pred.dirty = false; startPrediction(); }
  if (!pred.running) return;
  const budget = S.lite ? 3000 : 9000;
  let alive = 0;
  for (const R of pred.runs) {
    if (R.done) continue;
    alive++;
    const { w, b } = R;
    const pos = R.line.geometry.attributes.position, col = R.line.geometry.attributes.color;
    const steps = Math.floor(budget / Math.max(1, pred.runs.length));
    for (let k = 0; k < steps && !R.done; k++) {
      if ((k & 15) === 0) w.refreshCandidates(b, 0.02);
      w.step(DT);
      R.acc++;
      if (R.acc % 10 === 0) {
        const v = b.vel.length();
        const gg = b.captured ? 1 : b.jnAcc / (b.m * w.g * 0.01);
        b.jnAcc = 0;
        R.maxV = Math.max(R.maxV, v);
        R.g = (R.g ?? 1) + (gg - (R.g ?? 1)) * 0.3;
        if (!b.captured) R.maxG = Math.max(R.maxG, R.g);
        // remember where the ball last touched the track — that's where it falls off
        if (w.time - b.lastTrackT < 0.012) R.lastTrack.copy(b.pos);
        if (R.n < R.N) {
          // drawn a little above the ball so it floats over the channel walls
          pos.setXYZ(R.n, b.pos.x, b.pos.y + 0.014, b.pos.z);
          speedColor(v, _c); col.setXYZ(R.n, _c.r, _c.g, _c.b);
          R.v[R.n] = v; R.gs[R.n] = R.g;
          R.n++;
        }
        if (R.acc % 250 === 0 && R.nt < 400) R.ticks.geometry.attributes.position.setXYZ(R.nt++, b.pos.x, b.pos.y + 0.014, b.pos.z);
        const t = w.time - R.t0;
        if (b.captured) R.liftT = t;
        if (v < 0.006 && !b.captured) R.still += 0.01; else R.still = 0;
        if (b.collected) { R.done = true; R.outcome = 'goal'; R.t = t; }
        else if (b.pos.y < -0.2 || b.dead) { R.done = true; R.outcome = 'lost'; R.t = t; }
        else if (R.still > 1.2) { R.done = true; R.outcome = b.onRoomFloor ? 'floor' : 'stuck'; R.t = t; }
        else if (t > 40) { R.done = true; R.outcome = R.liftT > 0 ? 'loop' : 'long'; R.t = t; }
        else if (b.onRoomFloor && !b.captured && b.pos.y < 0.05 && t > 0.5 && R.floorT === undefined) R.floorT = t;
      }
    }
    R.line.geometry.setDrawRange(0, R.n);
    pos.needsUpdate = true; col.needsUpdate = true;
    R.ticks.geometry.setDrawRange(0, R.nt);
    R.ticks.geometry.attributes.position.needsUpdate = true;
    if (R.done) addEndMarker(R);
  }
  if (!alive) { pred.running = false; if (S.heat !== 'off') insight.heat(S.heat); }
  renderPred();
}
// predicted speed of the ball as it passes point p (null if no predicted ball goes near it)
function predSpeedAt(p, near = 0.03) {
  let best = near * near, v = null;
  for (const R of pred.runs) {
    const a = R.line.geometry.attributes.position.array;
    for (let i = 0; i < R.n; i++) {
      const dx = a[i * 3] - p.x, dy = a[i * 3 + 1] - 0.014 - p.y, dz = a[i * 3 + 2] - p.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) { best = d2; v = R.v[i]; }
    }
  }
  return v;
}
const OUTCOME = {
  goal: { icon: '🎯', badge: '✓', bg: '#2fbf71', title: (R) => L('Goal in {0} s', R.t.toFixed(1)) },
  floor: { icon: '💥', badge: '!', bg: '#ff5d5d', title: (R) => R.floorT ? L('Falls off at {0} s', R.floorT.toFixed(1)) : L('Falls off') },
  stuck: { icon: '✋', badge: '■', bg: '#ff9f43', title: (R) => L('Stops on the track ({0} s)', R.t.toFixed(1)) },
  lost: { icon: '💥', badge: '!', bg: '#ff5d5d', title: () => L('Leaves the room!') },
  loop: { icon: '♾️', badge: '∞', bg: '#9b6bff', title: () => L('Runs forever (lift loop)') },
  long: { icon: '⏳', badge: '…', bg: '#4c8dff', title: (R) => L('Still rolling after {0} s', R.t.toFixed(0)) },
};
const warnRingGeo = new THREE.TorusGeometry(0.035, 0.004, 8, 32);
function addEndMarker(R) {
  const o = OUTCOME[R.outcome];
  const badge = (p, txt, bg) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.badgeTexture(txt, bg), transparent: true }));
    sp.scale.set(0.028, 0.028, 1); sp.position.copy(p).add(V(0, 0.035, 0)); sp.renderOrder = 6; sp.raycast = () => {};
    predGroup.add(sp);
  };
  badge(R.b.pos, o.badge, o.bg);
  // trouble spot: a pulsing red ring where the ball leaves the track (or gets stuck)
  if (R.outcome === 'floor' || R.outcome === 'lost' || R.outcome === 'stuck') {
    const at = R.outcome === 'stuck' ? R.b.pos : R.lastTrack;
    const ring = new THREE.Mesh(warnRingGeo, new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.9, depthTest: false }));
    ring.rotation.x = Math.PI / 2; ring.position.copy(at); ring.renderOrder = 7; ring.userData.pulse = true;
    predGroup.add(ring);
    if (R.outcome !== 'stuck') badge(at, '!', '#ff3b3b');
    R.trouble = at.clone();
  }
}
let predHTML = '';
function renderPred() {
  const el = $('predBody');
  let html;
  if (!S.predict) html = `<span class="muted">${L('Prediction is off — turn on 🔮 Predict.')}</span>`;
  else if (!pred.runs.length) html = `<span class="muted">${L('Place a 📍 Start Tower and the 🔮 line will show where a ball goes.')}</span>`;
  else html = pred.runs.map((R, i) => {
    const t = (R.t ?? (R.w.time - R.t0));
    const o = R.done ? OUTCOME[R.outcome] : null;
    const title = o ? o.title(R) : L('Simulating… {0} s', t.toFixed(1));
    const tip = R.trouble ? `<div class="warn">${L('🔴 The red ring shows where — click to look')}</div>` : '';
    return `<div class="pred" data-i="${i}" title="${L('Click to look there')}"><div class="ico">${o ? o.icon : '⏳'}</div><div><div class="t">${pred.runs.length > 1 ? L('Start {0}: ', i + 1) : ''}${title}</div><div class="muted">${L('top {0} m/s · peak {1} g', R.maxV.toFixed(2), R.maxG.toFixed(1))} · ${L(BALL_TYPES[S.ballType].name)}</div>${tip}</div></div>`;
  }).join('');
  if (html !== predHTML) { el.innerHTML = html; predHTML = html; }
  let pill = `📊 ${L('Info')}`;
  if (S.predict && pred.runs.length) {
    const R = pred.runs.find(r => r.done && r.outcome !== 'goal' && r.outcome !== 'loop') || pred.runs[0], o = R.done ? OUTCOME[R.outcome] : null;
    pill = `${o ? o.icon : '⏳'} ${o ? o.title(R) : L('Simulating…')}`;
    pill = `<span class="pdot" style="background:${o ? o.bg : '#9aa0b5'}"></span>${pill}`;
  }
  if (pill !== predPillHTML) { $('predPill').innerHTML = pill; predPillHTML = pill; }
}
let predPillHTML = '';
$('predBody').addEventListener('click', (e) => {
  const row = e.target.closest('.pred');
  if (!row || S.cam !== 'orbit') return;
  const R = pred.runs[+row.dataset.i];
  if (!R) return;
  const at = R.trouble || R.b.pos;
  const off = camera.position.clone().sub(controls.target).setLength(0.6);
  controls.target.copy(at); camera.position.copy(at).add(off);
});

// ================================================================ camera modes
const camState = { orbitPos: V(), orbitTarget: V(), look: V(1, 0, 0), up: V(0, 1, 0), yawOff: 0, pitchOff: 0, chaseDir: V(1, 0, 0), sgn: 1 };
function setCam(mode) {
  if (mode !== 'orbit' && (!S.follow || !world.balls.includes(S.follow))) {
    const live = liveBalls();
    S.follow = live[live.length - 1] || releaseAll(true)[0] || null;
    if (!S.follow) { toast(L('First place a 📍 Start Tower'), true); return; }
    sound.release();
  }
  if (S.move) endMove(false);
  if (S.cam === 'orbit' && mode !== 'orbit') { camState.orbitPos.copy(camera.position); camState.orbitTarget.copy(controls.target); }
  if (mode === 'orbit' && S.cam !== 'orbit') {
    if (S.follow && S.follow.pos) {
      const off = camState.orbitPos.clone().sub(camState.orbitTarget).setLength(0.6);
      controls.target.copy(S.follow.pos); camera.position.copy(S.follow.pos).add(off);
    } else { camera.position.copy(camState.orbitPos); controls.target.copy(camState.orbitTarget); }
    camera.up.set(0, 1, 0);
  }
  S.cam = mode;
  controls.enabled = mode === 'orbit';
  camera.near = mode === 'pov' ? 0.002 : mode === 'orbit' ? 0.01 : 0.004;
  camera.fov = mode === 'pov' ? 82 : 55;
  camera.updateProjectionMatrix();
  camState.yawOff = 0; camState.pitchOff = 0;
  if (mode === 'movie') movie.reset();
  if (S.follow) { camState.look.copy(S.follow.vel.lengthSq() > 1e-4 ? S.follow.vel : V(1, 0, 0)).normalize(); camState.chaseDir.copy(camState.look).setY(0).normalize(); camState.up.set(0, 1, 0); }
  document.body.classList.toggle('pov', mode === 'pov');
  document.body.classList.toggle('riding', mode !== 'orbit');
  refreshVisibility();
  document.querySelectorAll('#camModes button').forEach(b => b.classList.toggle('on', b.dataset.cam === mode));
  if (mode !== 'orbit') { S.hover = null; clearGhost(); }
  renderSelPop();
}
function refreshVisibility() {
  const building = S.cam === 'orbit' && !S.photo && !S.replay;
  markerGroup.visible = ghostGroup.visible = building && !S.move;
  if (S.move) ghostGroup.visible = true;
  predGroup.visible = S.cam !== 'pov' && !S.photo && !S.replay;
}
const keys = new Set();
const _ahead = V(), _T = V(), _U = V();
// is there something solid between the camera and the ball? (movie camera avoids those shots)
const occRay = new THREE.Raycaster();
function blocked(from, to) {
  // aim just above the ball so its own channel walls don't count
  const d = to.clone().add(V(0, 0.02, 0)).sub(from), len = d.length();
  if (len < 0.05) return false;
  occRay.set(from, d.divideScalar(len)); occRay.far = len - 0.035;
  return occRay.intersectObjects([trackGroup, ...room.solids], true).some(h => h.object.visible && !(h.object.material && h.object.material.transparent));
}
// smooth camera moves in the build view (frame the coaster, zoom buttons)
const camFly = { t: 1, p0: V(), p1: V(), q0: V(), q1: V() };
function flyTo(pos, target, instant) {
  if (instant || reduceMotion()) { camera.position.copy(pos); controls.target.copy(target); camFly.t = 1; controls.update(); return; }
  camFly.p0.copy(camera.position); camFly.q0.copy(controls.target); camFly.p1.copy(pos); camFly.q1.copy(target); camFly.t = 0;
}
// frame the whole coaster from the current direction (never from below or too flat)
function fitView(instant) {
  if (S.cam !== 'orbit') setCam('orbit');
  const box = coasterBox();
  // nothing built yet: a view over the whole room from the front corner
  if (box.isEmpty()) { const b = room.bounds; flyTo(V(b.x1 * 0.55, Math.min(b.h * 0.72, 1.25), b.z1 * 0.92), V(-0.1, 0.22, -0.2), instant); return; }
  const c = box.isEmpty() ? V(0.07, 0.12, 0.25) : box.getCenter(V());
  const r = box.isEmpty() ? 0.55 : Math.max(0.25, box.getSize(V()).length() / 2);
  const dir = camera.position.clone().sub(controls.target).normalize();
  dir.y = THREE.MathUtils.clamp(dir.y, 0.4, 0.8); dir.normalize();
  const dist = THREE.MathUtils.clamp(r / Math.sin(camera.fov * DEG / 2) * 0.9, 0.35, 4);
  const pos = c.clone().addScaledVector(dir, dist);
  pos.y = Math.min(pos.y, room.bounds.h - 0.05);
  flyTo(pos, c, instant);
}
function zoomBy(f) {
  if (S.cam !== 'orbit') return;
  const off = camera.position.clone().sub(controls.target).multiplyScalar(f);
  if (off.length() < controls.minDistance || off.length() > controls.maxDistance) return;
  flyTo(controls.target.clone().add(off), controls.target.clone());
}
function updateCamera(dt) {
  if (S.replay) { movie.update(dt, S.replay.focus, blocked); return; }
  if (S.cam === 'orbit') {
    if (camFly.t < 1) {
      camFly.t = Math.min(1, camFly.t + dt / 0.7);
      const e = camFly.t * camFly.t * (3 - 2 * camFly.t);
      camera.position.lerpVectors(camFly.p0, camFly.p1, e);
      controls.target.lerpVectors(camFly.q0, camFly.q1, e);
    }
    const mv = V();
    const f = camera.getWorldDirection(V()).setY(0).normalize(), r = V().crossVectors(f, UP);
    if (keys.has('w')) mv.add(f); if (keys.has('s')) mv.sub(f);
    if (keys.has('d')) mv.add(r); if (keys.has('a')) mv.sub(r);
    if (keys.has('r')) mv.y += 1; if (keys.has('f')) mv.y -= 1;
    if (mv.lengthSq()) { mv.normalize().multiplyScalar(dt * Math.max(0.4, camera.position.distanceTo(controls.target) * 1.2)); camera.position.add(mv); controls.target.add(mv); }
    controls.update();
    // under the attic's sloping roof the camera has to stay inside
    if (room.kind === 'attic') camera.position.y = Math.min(camera.position.y, 0.63 + (1.68 - Math.abs(camera.position.x)) * 0.708 - 0.06);
    return;
  }
  const b = S.follow;
  if (!b) return;
  if (S.cam === 'movie') { movie.update(dt, b, blocked); return; }
  const v = b.vel, sp = v.length();
  // smooth ride: look ahead along the track itself instead of following every bump of the velocity
  const onTrack = b.tkCol && world.time - b.tkT < 0.08 && !b.captured;
  let wantUp = UP;
  if (onTrack) {
    _T.set(b.tkx, b.tky, b.tkz); _U.set(b.tux, b.tuy, b.tuz);
    if (sp > 0.05) camState.sgn = v.dot(_T) >= 0 ? 1 : -1;
    b.tkCol.pointAt(b.tkS + camState.sgn * 0.09, _ahead);
    _ahead.addScaledVector(_U, -0.004).sub(b.pos);
    if (_ahead.lengthSq() > 1e-8) camState.look.lerp(_ahead.normalize(), 1 - Math.exp(-dt * 9)).normalize();
    wantUp = _U.clone().multiplyScalar(0.7).addScaledVector(UP, 0.3).normalize();
  } else if (sp > 0.05) camState.look.lerp(v.clone().normalize(), 1 - Math.exp(-dt * 5)).normalize();
  if (S.cam === 'chase') {
    const hd = camState.look.clone().setY(0);
    if (hd.lengthSq() > 1e-4) camState.chaseDir.lerp(hd.normalize(), 1 - Math.exp(-dt * 2.5)).normalize();
    const dir = camState.chaseDir.clone().applyAxisAngle(UP, camState.yawOff);
    const want = b.pos.clone().addScaledVector(dir, -0.2).add(V(0, 0.08 + camState.pitchOff * 0.1, 0));
    want.x = THREE.MathUtils.clamp(want.x, room.bounds.x0 + 0.05, room.bounds.x1 - 0.05);
    want.z = THREE.MathUtils.clamp(want.z, room.bounds.z0 + 0.05, room.bounds.z1 - 0.05);
    want.y = Math.max(0.03, want.y);
    camera.position.lerp(want, 1 - Math.exp(-dt * 6));
    camera.up.set(0, 1, 0);
    camera.lookAt(b.pos.clone().addScaledVector(dir, 0.06));
  } else {
    camState.up.lerp(wantUp, 1 - Math.exp(-dt * 5)).normalize();
    camera.position.copy(b.pos).addScaledVector(camState.up, b.r * 1.15);
    const look = camState.look.clone();
    if (camState.yawOff || camState.pitchOff) {
      look.applyAxisAngle(camState.up, camState.yawOff);
      const side = V().crossVectors(look, camState.up).normalize();
      look.applyAxisAngle(side, camState.pitchOff);
    }
    camera.up.copy(camState.up);
    camera.lookAt(camera.position.clone().add(look));
    camState.yawOff *= Math.exp(-dt * 1.5); camState.pitchOff *= Math.exp(-dt * 1.5);
  }
}

// ================================================================ replay
function startReplay() {
  if (rec.duration < 0.5) { toast(L('Nothing to replay yet — release a ball first'), true); return; }
  if (S.move) endMove(false);
  const f = rec.frames;
  const last = f[f.length - 1];
  const focusId = (S.follow && S.follow.id) || last.follow || (last.data.length ? last.data[0] : 0);
  camState.before = { pos: camera.position.clone(), target: controls.target.clone() };
  S.replay = { t: f[0].t, t0: f[0].t, t1: last.t, speed: 0.5, playing: true, focusId, meshes: new Map(), focus: { pos: V(), vel: V(), r: 0.0115 } };
  ballGroup.visible = false;
  document.body.classList.add('replaying');
  movie.reset();
  controls.enabled = false;
  refreshVisibility();
  renderReplayBar();
  sound.click();
}
function stopReplay() {
  if (!S.replay) return;
  if (video.active) replayLooped();
  for (const m of S.replay.meshes.values()) replayGroup.remove(m);
  S.replay = null;
  ballGroup.visible = true;
  document.body.classList.remove('replaying');
  controls.enabled = S.cam === 'orbit';
  camera.up.set(0, 1, 0);
  setCam(S.cam);
  camera.fov = S.cam === 'pov' ? 82 : 55; camera.near = S.cam === 'orbit' ? 0.01 : 0.004; camera.updateProjectionMatrix();
  if (S.cam === 'orbit' && camState.before) { camera.position.copy(camState.before.pos); controls.target.copy(camState.before.target); }
}
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const replayWorld = { time: 0, devState: null };
function updateReplay(dt) {
  const R = S.replay;
  if (R.playing) { R.t += dt * R.speed; if (R.t > R.t1) { R.t = R.t0; replayLooped(); } }
  const i = rec.find(R.t), A = rec.frames[i], B = rec.frames[Math.min(i + 1, rec.frames.length - 1)];
  const f = B.t > A.t ? (R.t - A.t) / (B.t - A.t) : 0;
  const ma = rec.ids(A), mb = rec.ids(B);
  const seen = new Set();
  for (const [id, oa] of ma) {
    let m = R.meshes.get(id);
    if (!m) { const meta = rec.meta.get(id); m = ballMesh(meta.type, meta.color, meta.r); R.meshes.set(id, m); replayGroup.add(m); }
    const ob = mb.get(id) ?? oa, da = A.data, db = mb.has(id) ? B.data : A.data;
    m.position.set(da[oa + 1] + (db[ob + 1] - da[oa + 1]) * f, da[oa + 2] + (db[ob + 2] - da[oa + 2]) * f, da[oa + 3] + (db[ob + 3] - da[oa + 3]) * f);
    _qa.set(da[oa + 4], da[oa + 5], da[oa + 6], da[oa + 7]); _qb.set(db[ob + 4], db[ob + 5], db[ob + 6], db[ob + 7]);
    m.quaternion.slerpQuaternions(_qa, _qb, f);
    m.visible = true;
    seen.add(id);
    if (id === R.focusId) {
      R.focus.vel.set(db[ob + 1] - da[oa + 1], db[ob + 2] - da[oa + 2], db[ob + 3] - da[oa + 3]).divideScalar(Math.max(1e-4, B.t - A.t));
      R.focus.pos.copy(m.position);
    }
  }
  if (!seen.has(R.focusId) && ma.size) { R.focusId = A.data[0]; movie.reset(); }
  for (const [id, m] of R.meshes) if (!seen.has(id)) m.visible = false;
  // moving parts follow the recording too
  const rs = rotors();
  replayWorld.time = A.t + (B.t - A.t) * f;
  replayWorld.devState = (dv) => { const k = rs.indexOf(dv); return k >= 0 && k < A.rot.length ? { th: A.rot[k] } : world.devState(dv); };
  for (const inst of insts.values()) for (const dv of inst.devices) if (dv.update) dv.update(replayWorld, dt);
  $('replayPos').value = String(Math.round((R.t - R.t0) / Math.max(1e-6, R.t1 - R.t0) * 1000));
}
function renderReplayBar() {
  const R = S.replay;
  if (!R) return;
  $('replayPlay').textContent = R.playing ? '⏸' : '▶';
  document.querySelectorAll('#replayBar [data-rs]').forEach(b => b.classList.toggle('on', +b.dataset.rs === R.speed));
}

// ================================================================ photo mode
function setPhoto(on) {
  S.photo = on;
  document.body.classList.toggle('photo', on);
  if (on) { select(null); clearGhost(); S.hover = null; }
  refreshVisibility();
  setHint('');
}
function snapPhoto() {
  renderFrame();
  const url = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = `ball-coaster-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`; a.click();
  const fl = $('flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
  sound.shutter();
  toast(L('Photo saved! 📸'));
}

// ================================================================ night mode
function setNight(on) {
  S.night = on;
  room.setNight(on);
  for (const m of ballMats.values()) m.emissiveIntensity = on ? 0.55 : 0;
  renderer.toneMappingExposure = on ? 1.1 : 0.92;
  scene.environmentIntensity = on ? 0.12 : 0.55;
  $('btnNight').classList.toggle('on', on);
  $('btnNight').querySelector('i').textContent = on ? '🌙' : '☀️';
  sound.setNight(on);
}

// ================================================================ HUD
const hud = { t: 0, hist: [] };
function hudTick(dt) {
  const b = S.follow;
  hud.t += dt;
  if (b && world.balls.includes(b)) {
    hud.hist.push([b.vel.length(), b.pos.y]);
    if (hud.hist.length > 360) hud.hist.shift();
  }
  if (hud.t < 0.1) return;
  hud.t = 0;
  renderMissionProgress();
  const body = $('hudBody');
  $('rideName').textContent = b ? `#${b.id} ${L(BALL_TYPES[b.type].name)}` : L('No ball');
  if (!b || !world.balls.includes(b)) {
    body.className = 'small muted';
    body.innerHTML = L('Release a ball, then click it to see its speed, forces and energy.');
    $('hudBall').textContent = ''; hud.hist.length = 0; drawSpark(); return;
  }
  body.className = 'small';
  const g = world.g, sp = b.vel.length();
  const E = b.energy(g);
  if (b.stats.E0 === null || E.total > b.stats.E0) b.stats.E0 = E.total;
  const E0 = b.stats.E0, lost = Math.max(0, E0 - E.total);
  const st = b.captured ? 'lift' : world.time - b.lastTouch > 0.04 ? 'flying' : sp < 0.01 ? 'resting' : b.slip > 0.03 ? 'sliding' : 'rolling';
  const stLabel = L({ lift: 'Riding the lift', flying: 'Flying!', resting: 'Resting', sliding: 'Sliding', rolling: 'Rolling' }[st]);
  // slope along the direction of travel (sign: + downhill)
  const touching = world.time - b.lastTouch < 0.05 && !b.captured;
  const theta = touching && sp > 0.02 ? Math.asin(THREE.MathUtils.clamp(-b.vel.y / sp, -1, 1)) : 0;
  const k = b.def.k;
  const crr = b.def.rolling + 0.0025;
  const aPred = g * Math.sin(theta) / (1 + k) - crr * g * Math.cos(theta);
  const pct = (x) => (100 * x / Math.max(E0, 1e-9)).toFixed(1);
  $('hudBall').textContent = `#${b.id} ${L(BALL_TYPES[b.type].name)}`;
  body.innerHTML = `
    <span class="state st-${st}">${stLabel}</span>
    <div class="big-stats">
      <div><b>${sp.toFixed(2)}</b><span>${L('m/s')}</span></div>
      <div><b>${b.feltG.toFixed(1)}</b><span>${L('g force')}</span></div>
      <div><b>${(b.pos.y * 100).toFixed(0)}</b><span>${L('cm high')}</span></div>
    </div>
    <div class="kv">
      <span>${L('Spin')}</span><b>${(b.w.length() * 60 / (2 * Math.PI)).toFixed(0)} rpm</b>
      <span>${L('Track slope')}</span><b>${theta >= 0 ? '↘' : '↗'} ${Math.abs(theta / DEG).toFixed(1)}°</b>
      <span>${L('Distance')}</span><b>${b.stats.dist.toFixed(2)} ${L('m')}</b>
      <span>${L('Air time')}</span><b>${b.stats.air.toFixed(2)} ${L('s')}</b>
      <span>${L('Top speed')}</span><b>${b.stats.maxSpeed.toFixed(2)} ${L('m/s')}</b>
      <span>${L('Max force')}</span><b>${b.stats.maxG.toFixed(1)} g</b>
    </div>
    <div class="bar"><i style="width:${pct(E.kt)}%;background:#3ccf7a"></i><i style="width:${pct(E.kr)}%;background:#2ec4b6"></i><i style="width:${pct(Math.max(0, E.pe))}%;background:#4c8dff"></i><i style="width:${pct(lost)}%;background:#c9cbd6"></i></div>
    <div class="legend"><span><i style="background:#3ccf7a"></i>${L('motion')}</span><span><i style="background:#2ec4b6"></i>${L('spin')}</span><span><i style="background:#4c8dff"></i>${L('height')}</span><span><i style="background:#c9cbd6"></i>${L('lost {0}%', pct(lost))}</span></div>
    <details class="calc"${S.calcOpen ? ' open' : ''}><summary>${L('How is this calculated?')}</summary>
      <div class="formula" dir="ltr">${L('Rolling down a slope θ, part of the energy goes into spin, so:')}<br>a = g·sinθ ÷ (1 + I/mr²) − c<sub>rr</sub>·g·cosθ<br>= ${g.toFixed(2)}·sin(${(theta / DEG).toFixed(1)}°) ÷ ${(1 + k).toFixed(2)} − ${crr.toFixed(4)}·${g.toFixed(2)}·cos θ = <b>${aPred.toFixed(2)} m/s²</b></div>
      <div class="formula">${L('Energy now:')} ${L('motion')} ${(E.kt * 1000).toFixed(1)} mJ + ${L('spin')} ${(E.kr * 1000).toFixed(1)} mJ + ${L('height')} ${(E.pe * 1000).toFixed(1)} mJ</div>
    </details>`;
  drawSpark();
}
$('hudBody').addEventListener('click', (e) => { if (e.target.tagName === 'SUMMARY') S.calcOpen = !S.calcOpen; });
function drawSpark() {
  const cv = $('spark'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const h = hud.hist;
  if (h.length < 2) return;
  const maxV = Math.max(0.5, ...h.map(x => x[0])), maxY = Math.max(0.2, ...h.map(x => x[1]));
  const line = (idx, max, col) => {
    g.strokeStyle = col; g.lineWidth = 3; g.beginPath();
    h.forEach((x, i) => { const px = i / (h.length - 1) * W, py = H - 6 - (x[idx] / max) * (H - 24); i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.stroke();
  };
  line(1, maxY, '#4c8dff'); line(0, maxV, '#ff7a59');
  g.font = '600 20px Fredoka, sans-serif';
  g.fillStyle = '#ff7a59'; g.fillText(L('speed'), 6, 18);
  g.fillStyle = '#4c8dff'; g.fillText(L('height'), 90, 18);
}

// ================================================================ challenges
const starStore = () => store.get('bc.stars', {});
const Lx = (v) => Array.isArray(v) ? L(...v) : L(v);
let tourRoom = null;
function openChallenges() {
  closeMenus();
  const stars = starStore();
  const total = CHALLENGES.reduce((a, c) => a + (stars[c.id] || 0), 0);
  tourRoom = tourRoom || room.kind;
  $('roomTabs').innerHTML = ROOM_KINDS.map(r => {
    const n = CHALLENGES.filter(c => (c.room || 'kids') === r.kind).reduce((a, c) => a + (stars[c.id] || 0), 0);
    const locked = total < (ROOM_UNLOCK[r.kind] || 0);
    return `<button data-rt="${r.kind}" class="${r.kind === tourRoom ? 'on' : ''}${locked ? ' locked' : ''}">${r.icon} ${L(r.name)} <small>${locked ? '🔒 ★' + ROOM_UNLOCK[r.kind] : '★' + n}</small></button>`;
  }).join('');
  const day = dailyChallenge(), dn = stars[day.id] || 0;
  $('dailyCard').innerHTML = `<button class="ch daily" data-daily="1"><span class="ico">📅</span><span class="tt">${L('Daily Puzzle')} <small>${new Date().toLocaleDateString()}</small></span><span class="gl">${Lx(day.goal)}</span><span class="st">${'★'.repeat(dn)}<i>${'★'.repeat(3 - dn)}</i></span></button>`;
  const locked = total < (ROOM_UNLOCK[tourRoom] || 0);
  $('chList').innerHTML = CHALLENGES.map((c, i) => [c, i]).filter(([c]) => (c.room || 'kids') === tourRoom).map(([c, i]) => {
    const n = stars[c.id] || 0;
    return `<button class="ch${locked ? ' locked' : ''}" data-ch="${i}" ${locked ? 'disabled' : ''}><span class="ico">${locked ? '🔒' : c.icon}</span><span class="tt">${L(c.title)}</span><span class="gl">${Lx(c.goal)}${c.parts ? ' 📦' : ''}</span><span class="st">${'★'.repeat(n)}<i>${'★'.repeat(3 - n)}</i></span></button>`;
  }).join('') + (locked ? `<p class="muted small">${L('Earn {0} stars to open these missions — you can still build here any time.', ROOM_UNLOCK[tourRoom])}</p>` : '');
  $('chTotal').textContent = `★ ${total} / ${CHALLENGES.length * 3}`;
  $('chModal').classList.remove('hidden');
}
$('roomTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-rt]'); if (b) { tourRoom = b.dataset.rt; openChallenges(); sound.click(); } });
$('dailyCard').addEventListener('click', (e) => { if (e.target.closest('[data-daily]')) { $('chModal').classList.add('hidden'); startChallenge(-1); } });
$('chList').addEventListener('click', (e) => { const b = e.target.closest('[data-ch]'); if (b && !b.disabled) { $('chModal').classList.add('hidden'); startChallenge(+b.dataset.ch); } });
function resetChallengeState() { C.goals = []; C.dominoes = false; C.maxNotes = 0; C.maxLifts = 0; C.teddy = false; C.splash = false; C.splashes = []; C.maxPhotos = 0; C.best = null; C.maxGadgets = 0; C.race = null; C.lights = false; }
resetChallengeState();
function startChallenge(i, custom) {
  // custom: a puzzle a friend sent (play.js)
  const def = custom || (i < 0 ? dailyChallenge() : CHALLENGES[i]);
  const want = def.daily ? 'kids' : (def.room || 'kids');
  if (want !== room.kind) switchRoom(want, { keepChallenge: true });
  if (!S.challenge) S.sandbox = { pieces: JSON.parse(JSON.stringify(pieces.filter(p => !p.locked))), g: world.g };
  S.challenge = { def, i, best: def.custom ? 0 : starStore()[def.id] || 0, shown: 0 };
  stopReplay(); setCam('orbit'); clearBalls(); resetChallengeState();
  S.selected = null; S.nextId = 1;
  world.g = def.gravity || 9.81; renderLab();
  sync(def.setup ? def.setup() : []);
  history = []; histLabels = []; hIdx = -1; pushHistory();
  S.tool = 'start'; S.tab = 'tracks'; renderDock(); renderSettings(); updateGhost();
  renderMission();
  toast(`${def.icon} ${L(def.title)}`);
  fitView();
  visitors.roomChanged();
}
function exitChallenge() {
  if (!S.challenge) return;
  S.challenge = null;
  clearBalls(); resetChallengeState();
  world.g = S.sandbox ? S.sandbox.g : 9.81; renderLab();
  S.selected = null;
  sync(S.sandbox ? S.sandbox.pieces : []);
  history = []; histLabels = []; hIdx = -1; pushHistory();
  fitView();
  renderMission();
}
function renderMission() {
  const el = $('mission');
  const ch = S.challenge;
  el.classList.toggle('hidden', !ch);
  if (!ch) return;
  const def = ch.def, n = pieces.filter(p => !p.locked).length, got = def.score(C, n);
  el.innerHTML = `<div class="mh"><span class="ico">${def.icon}</span><b>${L(def.title)}</b></div>
    <div class="mg">${Lx(def.goal)}</div>
    ${def.parts ? `<div class="mparts">📦 ${Object.entries(def.parts).map(([k, v]) => `${L(TOOLS[k].label)} ×${v}`).join(' · ')}</div>` : ''}
    <ul>${def.stars.map((s, k) => `<li class="${k < got ? 'ok' : ''}">${k < got ? '★' : '☆'} ${Lx(s)}</li>`).join('')}</ul>
    <div class="mp" id="missionProg"></div>
    <div class="mb"><button data-m="restart">↺ ${L('Restart')}</button><button data-m="exit">✕ ${L('Exit')}</button></div>`;
  renderMissionProgress();
}
$('mission').addEventListener('click', (e) => {
  const b = e.target.closest('[data-m]');
  if (!b) return;
  if (b.dataset.m === 'restart') startChallenge(S.challenge.def.daily ? -1 : S.challenge.i, S.challenge.def.custom ? S.challenge.def : undefined);
  else exitChallenge();
});
let lastStars = -1;
function renderMissionProgress() {
  const ch = S.challenge;
  if (!ch) return;
  const def = ch.def, n = pieces.filter(p => !p.locked).length;
  const got = def.score(C, n);
  const pr = def.progress ? L(...def.progress(C)) + ' · ' : '';
  const el = $('missionProg'); if (el) el.textContent = pr + L('Pieces used: {0}', n);
  if (got !== lastStars) { lastStars = got; renderMission(); }
  if (got > ch.best) {
    if (!def.custom) { const stars = starStore(); stars[def.id] = got; store.set('bc.stars', stars); }
    if (def.daily) sticker('daily');
    const was = ch.best; ch.best = got;
    celebrate(got, was);
  }
}
function celebrate(n, was) {
  sound.fanfare();
  confetti(controls.target.clone().add(V(0, 0.2, 0)), 120);
  $('winStars').innerHTML = [0, 1, 2].map(k => `<span class="${k < n ? 'on' : ''}${k >= was && k < n ? ' new' : ''}" style="animation-delay:${0.2 + k * 0.25}s">★</span>`).join('');
  [0, 1, 2].forEach(k => { if (k >= was && k < n) setTimeout(() => sound.star(k), 300 + k * 250); });
  $('winTitle').textContent = n === 3 ? L('Perfect! ⭐⭐⭐') : L('Challenge complete!');
  $('winMsg').textContent = n < 3 ? L('Can you get all 3 stars?') : '';
  $('winNext').classList.toggle('hidden', S.challenge.def.daily || S.challenge.def.custom || S.challenge.i >= CHALLENGES.length - 1);
  $('winShare').classList.toggle('hidden', !S.challenge.def.custom);
  $('winModal').classList.remove('hidden');
}
$('winNext').onclick = () => {
  $('winModal').classList.add('hidden');
  const stars = starStore(), total = CHALLENGES.reduce((a, c) => a + (stars[c.id] || 0), 0);
  let j = S.challenge.i + 1;
  while (j < CHALLENGES.length && total < (ROOM_UNLOCK[CHALLENGES[j].room || 'kids'] || 0)) j++;
  if (j < CHALLENGES.length) startChallenge(j); else openChallenges();
};
$('winStay').onclick = () => $('winModal').classList.add('hidden');
$('winShare').onclick = () => play.shareSolution();

// ================================================================ UI: dock, settings, top bar, side
function chips(el, items, isOn, onPick, cls = 'chip', disabled = false) {
  el.innerHTML = '';
  for (const [v, label, extra] of items) {
    const b = document.createElement('button');
    b.className = cls + (isOn(v) ? ' on' : '');
    if (extra) b.style.cssText = extra;
    b.innerHTML = label;
    b.disabled = disabled;
    if (cls === 'swatch') b.title = v === 'rainbow' ? L('Rainbow — a new color for every piece') : v;
    b.addEventListener('click', () => { sound.ensure(); sound.click(); onPick(v); });
    el.appendChild(b);
  }
}
// on a phone the tools move into a tab of their own, so the dock is just one row of tabs and one of pieces
const phone = () => window.innerWidth <= 760 || window.innerHeight <= 520;
function dockTabs() {
  if (!phone()) return DOCK_TABS;
  const t = TOOLS[S.tool], label = S.tool === 'select' || t.type === 'append' ? '🛠 ' + L('Tools') : `🛠 ${L(t.label)}`;
  return [['tools', label, DOCK_TOOLS], ...DOCK_TABS];
}
function renderDock() {
  $('dockTools').innerHTML = DOCK_TOOLS.map(k => `<button class="tool${S.tool === k ? ' on' : ''}" data-tool="${k}" title="${L(TOOLS[k].desc)} · ${TOOLS[k].key}">${ICONS[TOOLS[k].icon]}<span>${L(TOOLS[k].label)}</span></button>`).join('');
  const tabs = dockTabs();
  if (!tabs.some(t => t[0] === S.tab)) S.tab = 'tracks';
  $('dockTabs').innerHTML = tabs.map(([k, label]) => `<button class="tab${S.tab === k ? ' on' : ''}" data-tab="${k}">${k === 'tools' ? label : L(label)}</button>`).join('') +
    `<span class="tabEnd"><button class="tab mini" data-settings title="${L('Slope, color and style')}">⚙</button><button class="tab mini" data-fold title="${L('Hide / show the pieces')}">${document.body.classList.contains('dock-folded') ? '▴' : '▾'}</button></span>`;
  const tab = tabs.find(t => t[0] === S.tab) || tabs[0];
  const hasPort = !!activePort();
  if (tab[0] === 'parts') { $('dockPieces').innerHTML = partsHTML(); return; }
  if (tab[0] === 'tools') { $('dockPieces').innerHTML = DOCK_TOOLS.map(k => `<button class="piece toolPiece${S.tool === k ? ' on' : ''}" data-tool="${k}">${ICONS[TOOLS[k].icon]}<span>${L(TOOLS[k].label)}</span></button>`).join(''); return; }
  $('dockPieces').innerHTML = tab[2].map(k => {
    const t = TOOLS[k], left = partsLeft(k);
    const off = (t.type === 'append' && !hasPort) || left === 0;
    return `<button class="piece${S.tool === k ? ' on' : ''}${off ? ' off' : ''}" data-tool="${k}">${ICONS[t.icon]}<span>${L(t.label)}</span>${t.key && t.key.length === 1 && t.type === 'append' ? `<span class="kb">${t.key}</span>` : ''}${t.type === 'place' ? '<span class="pl">📍</span>' : ''}${left !== null ? `<span class="lim">×${left}</span>` : ''}</button>`;
  }).join('');
}
let suppressClick = false;
$('dock').addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; return; }
  const tb = e.target.closest('[data-tab]');
  if (tb) { S.tab = tb.dataset.tab; store.set('bc.tab', S.tab); sound.click(); if (document.body.classList.contains('dock-folded')) foldDock(false); renderDock(); return; }
  if (e.target.closest('[data-fold]')) { foldDock(!document.body.classList.contains('dock-folded')); sound.click(); return; }
  if (e.target.closest('[data-settings]')) { document.body.classList.toggle('show-settings'); sound.click(); return; }
  const del = e.target.closest('[data-delpart]');
  if (del) { const list = userParts(); list.splice(+del.dataset.delpart, 1); store.set('bc.parts', list); renderDock(); return; }
  const pb = e.target.closest('[data-part]');
  if (pb) { const k = pb.dataset.part, part = k[0] === 'u' ? userParts()[+k.slice(1)] : BUILTIN_PARTS[+k.slice(1)]; if (part) pastePart(part.items); return; }
  const b = e.target.closest('[data-tool]');
  if (b) pickTool(b.dataset.tool);
});
$('dock').addEventListener('mouseover', (e) => {
  if (drag) return;
  const b = e.target.closest('.piece[data-tool]');
  const k = b && TOOLS[b.dataset.tool].type === 'append' ? b.dataset.tool : null;
  if (k !== S.hover) { S.hover = k; updateGhost(); }
  if (b && !k) setHint(`${L(TOOLS[b.dataset.tool].label)} — ${L(TOOLS[b.dataset.tool].desc)}`);
});
$('dock').addEventListener('mouseleave', () => { if (drag) return; S.hover = null; updateGhost(); });
function pickTool(k) {
  const t = TOOLS[k];
  sound.ensure();
  S.connectFrom = null;
  if (S.move) endMove(false);
  if (t.type === 'append') {
    if (TOOLS[S.tool].type !== 'tool') S.tool = 'select';
    tryAppend(k);
  } else {
    S.tool = S.tool === k && k !== 'select' ? 'select' : k;
    if (TOOLS[S.tool].type === 'place') select(null);
    sound.click();
  }
  renderDock(); renderSettings(); drawMarkers(); updateGhost();
}

// ---------------------------------------------------------------- drag a piece from the dock into the room
let drag = null;
$('dockPieces').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.piece[data-tool]');
  if (!b || e.button !== 0) return;
  drag = { k: b.dataset.tool, x: e.clientX, y: e.clientY, on: false, icon: b.querySelector('svg')?.outerHTML || '' };
});
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  S.freePlace = e.altKey;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    drag.on = true;
    const g = $('dragGhost'); g.innerHTML = drag.icon; g.classList.remove('hidden');
    S.hover = null;
    if (TOOLS[drag.k].type === 'place') { S.tool = drag.k; renderDock(); renderSettings(); }
  }
  const g = $('dragGhost'); g.style.left = e.clientX + 'px'; g.style.top = e.clientY + 'px';
  const overCanvas = document.elementFromPoint(e.clientX, e.clientY) === canvas;
  setMouse(e);
  const t = TOOLS[drag.k];
  if (!overCanvas) { clearGhost(); drag.ring = null; return; }
  if (t.type === 'append') {
    // snap to the nearest open ring under the cursor
    const r = canvas.getBoundingClientRect();
    let best = null, bd = 90;
    for (const o of openOuts) {
      _v.copy(o.port.p).project(camera);
      if (_v.z > 1) continue;
      const d = Math.hypot(r.left + (_v.x + 1) / 2 * r.width - e.clientX, r.top + (1 - _v.y) / 2 * r.height - e.clientY);
      if (d < bd) { bd = d; best = o; }
    }
    drag.ring = best;
    if (best) {
      if (S.active !== best.key || S.insert) { S.active = best.key; S.insert = null; drawMarkers(); }
      showGhost(makeData(drag.k, { port: portToData(best.port) }));
      setHint(S.ghostValid ? L('Let go to add it here') : '⚠ ' + S.ghostReason);
    } else { clearGhost(); setHint(L('Drop it on a ring')); }
  } else if (t.type === 'place') {
    lastSurf = pickSurface();
    if (lastSurf) refreshPlaceGhost(); else clearGhost();
  }
});
window.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag; drag = null;
  $('dragGhost').classList.add('hidden');
  if (!d.on) return;
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 50);
  const overCanvas = document.elementFromPoint(e.clientX, e.clientY) === canvas;
  const t = TOOLS[d.k];
  if (overCanvas && t.type === 'append' && d.ring) tryAppend(d.k);
  else if (overCanvas && t.type === 'place' && S.ghostData) {
    if (!S.ghostValid) { toast(S.ghostReason, true); sound.error(); }
    else { const nd = JSON.parse(JSON.stringify(S.ghostData)); nd.id = S.nextId; commit(nd); }
    S.tool = 'select'; renderDock(); renderSettings();
  }
  clearGhost(); updateGhost();
});

function foldDock(on) { document.body.classList.toggle('dock-folded', on); store.set('bc.fold', on); renderDock(); }
function renderSettings() {
  const el = $('settings');
  el.innerHTML = '';
  document.body.classList.toggle('placing', TOOLS[S.tool].type === 'place');
  const add = (html) => { const s = document.createElement('span'); s.innerHTML = html; el.appendChild(s); return s; };
  const box = () => { const c = document.createElement('div'); c.className = 'chips'; el.appendChild(c); return c; };
  const t = TOOLS[S.tool];
  if (t.type === 'place') {
    add(`<span class="ttl">📍 ${L(t.label)}</span>`);
    for (const [key, label, vals] of OPTIONS[t.piece] || []) {
      add(`<span class="lbl">${L(label)}</span>`);
      chips(box(), vals.map(([v, l]) => [v, optLabel(v, l)]), v => v === S.opts[t.piece][key], v => { S.opts[t.piece][key] = v; renderSettings(); refreshPlaceGhost(); });
    }
    add('<span class="sep"></span>');
  }
  add(`<span class="lbl">${L('Next slope')}</span>`);
  chips(box(), SLOPES.map(([v, l]) => [v, L(l)]), v => Math.abs(v * DEG - S.slope) < 1e-6, v => { S.slope = v * DEG; renderSettings(); updateGhost(); refreshPlaceGhost(); });
  add('<span class="sep"></span>');
  const sw = document.createElement('button');
  sw.className = 'swatch pick' + (S.color === 'rainbow' ? ' rainbow' : '');
  if (S.color !== 'rainbow') sw.style.background = COLORS[S.color];
  sw.dataset.menu = ''; sw.title = L('Color');
  sw.onclick = () => openMenu($('popMenu'), sw, menu => {
    menu.innerHTML = '';
    const c = document.createElement('div'); c.className = 'chips pal';
    chips(c, [['rainbow', '', ''], ...Object.keys(COLORS).map(k => [k, '', `background:${COLORS[k]}`])], v => v === S.color, v => { S.color = v; closeMenus(); renderSettings(); updateGhost(); }, 'swatch');
    c.firstChild.classList.add('rainbow');
    menu.appendChild(c);
  }, true);
  el.appendChild(sw);
  const st = document.createElement('button');
  st.className = 'chip pick'; st.dataset.menu = ''; st.title = L('Track style');
  st.innerHTML = `${L(STYLE_ITEMS.find(s => s[0] === S.style)?.[1] || S.style)} <i class="caret">▾</i>`;
  st.onclick = () => openMenu($('popMenu'), st, menu => {
    menu.innerHTML = STYLE_ITEMS.map(([v, l]) => `<button data-style="${v}" class="${v === S.style ? 'on' : ''}">${L(l)}</button>`).join('');
    menu.onclick = (e) => { const b = e.target.closest('[data-style]'); if (!b) return; S.style = b.dataset.style; closeMenus(); renderSettings(); updateGhost(); };
  }, true);
  el.appendChild(st);
}
function renderTop() {
  const cur = BALL_TYPES[S.ballType];
  $('ballDot').style.background = BALL_LOOK[S.ballType];
  $('ballName').textContent = L(cur.name);
  $('speedLabel').textContent = SPEEDS.find(s => s[0] === S.timeScale)[1];
  $('btnSpeed').classList.toggle('on', S.timeScale !== 1);
  document.querySelector('[data-proxy="btnSpeed"]').classList.toggle('on', S.timeScale !== 1);
  $('langLabel').textContent = getLang() === 'he' ? 'English' : 'עברית';
}
function fillBallMenu(menu) {
  menu.innerHTML = Object.keys(BALL_TYPES).map(k => {
    const d = BALL_TYPES[k], m = d.mass ?? d.density * 4 / 3 * Math.PI * d.radius ** 3;
    const facts = `${(m * 1000).toFixed(1)} ${L('g')} · ${(d.radius * 2000).toFixed(0)} mm · ${L('bounce')} ${d.restitution}${d.k > 0.5 ? ' · ' + L('hollow') : ''}`;
    return `<button data-ball="${k}" class="${k === S.ballType ? 'on' : ''}"><span class="balldot" style="background:${BALL_LOOK[k]}"></span><span><b>${L(d.name)}</b><span class="sub">${L(d.desc)}<br>${facts}</span></span></button>`;
  }).join('');
}
$('btnBall').onclick = () => openMenu($('ballMenu'), $('btnBall'), fillBallMenu);
$('ballMenu').onclick = (e) => {
  const b = e.target.closest('[data-ball]');
  if (!b) return;
  const d = BALL_TYPES[b.dataset.ball];
  S.ballType = b.dataset.ball; sound.ensure(); sound.click(); closeMenus(); renderTop(); schedulePrediction(); toast(`${L(d.name)}: ${L(d.desc)}`);
};
// ---------------------------------------------------------------- small drop-down menus
function openMenu(menu, anchor, fill, up) {
  const wasOpen = !menu.classList.contains('hidden') && menu.anchor === anchor;
  closeMenus();
  if (wasOpen) return;
  menu.anchor = anchor;
  if (fill) fill(menu);
  menu.classList.remove('hidden');
  const r = anchor.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8) + 'px';
  menu.style.top = Math.max(8, Math.min(up ? r.top - h - 8 : r.bottom + 8, window.innerHeight - h - 8)) + 'px';
}
function closeMenus() { document.querySelectorAll('.menu').forEach(m => m.classList.add('hidden')); }
document.addEventListener('click', (e) => { if (!e.target.closest('.menu, [data-menu]')) closeMenus(); });
$('btnMore').onclick = () => openMenu($('moreMenu'), $('btnMore'));
// on a phone the less-used play buttons live at the top of the ⋯ menu
$('moreMenu').addEventListener('click', (e) => { const b = e.target.closest('[data-proxy]'); if (b) { closeMenus(); $(b.dataset.proxy).click(); } });
const shown = el => el.offsetParent ? el : $('btnMore');
function renderLab() {
  chips($('gravChips'), GRAVITY.map(([v, l]) => [v, L(l)]), v => v === world.g, v => {
    if (S.challenge && S.challenge.def.gravity) { toast(L('Locked in this challenge'), true); return; }
    world.g = v; renderLab(); schedulePrediction(); toast(L('Gravity: {0}', `${L(GRAVITY.find(x => x[0] === v)[1])} (${v} m/s²)`));
  });
  chips($('airChips'), AIR.map(([v, l]) => [v, L(l)]), v => v === world.rho, v => { world.rho = v; renderLab(); schedulePrediction(); });
  $('chkKid').checked = S.kid;
}
// speed menu
$('btnSpeed').onclick = () => openMenu($('speedMenu'), shown($('btnSpeed')), m => {
  m.innerHTML = SPEEDS.map(([v, l, d]) => `<button data-ts="${v}" class="${v === S.timeScale ? 'on' : ''}">${l} <span class="sub">${L(d)}</span></button>`).join('');
});
$('speedMenu').onclick = (e) => {
  const b = e.target.closest('[data-ts]');
  if (!b) return;
  S.timeScale = +b.dataset.ts; $('speedMenu').classList.add('hidden'); renderTop(); sound.click();
};
// side panel
const folds = store.get('bc.folds', { lab: true });
document.querySelectorAll('#side .card[data-card]').forEach(c => {
  c.classList.toggle('folded', !!folds[c.dataset.card]);
  c.querySelector('h3').addEventListener('click', () => { c.classList.toggle('folded'); folds[c.dataset.card] = c.classList.contains('folded'); store.set('bc.folds', folds); });
});
function setSide(open) { document.body.classList.toggle('side-open', open); store.set('bc.side', open); }
$('sideToggle').onclick = () => setSide(!document.body.classList.contains('side-open'));

let hintT = 0;
function setHint(t) { const h = $('hint'); h.textContent = t; h.classList.toggle('show', !!t); }
function toast(t, bad, undoIt) {
  const el = $('toast');
  el.textContent = t;
  if (undoIt) {
    const b = document.createElement('button');
    b.textContent = '↶ ' + L('Undo');
    b.onclick = () => { undoIt(); el.classList.remove('show'); };
    el.appendChild(b);
  }
  el.classList.toggle('bad', !!bad); el.classList.toggle('act', !!undoIt); el.classList.add('show');
  clearTimeout(hintT); hintT = setTimeout(() => el.classList.remove('show'), undoIt ? 4500 : 1900);
}
function renderAll() {
  applyStatic();
  document.documentElement.lang = getLang();
  document.body.dir = getLang() === 'he' ? 'rtl' : 'ltr';
  renderTop(); renderLab(); renderDock(); renderSettings(); renderSelPop(); renderMission(); buildPad.render();
  predHTML = ''; renderPred();
}

// ================================================================ pointer interaction
const mouse = new THREE.Vector2();
let down = null;
function setMouse(e) { const r = canvas.getBoundingClientRect(); mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); raycaster.setFromCamera(mouse, camera); }
function pickMarker() { const h = raycaster.intersectObjects(markerGroup.children, true).find(x => x.object.userData.marker); return h ? h.object.userData.marker : null; }
function pickBall() { const h = raycaster.intersectObjects(ballGroup.children, false)[0]; return h ? h.object.userData.ball : null; }
function pickPiece() {
  const h = raycaster.intersectObjects(trackGroup.children, true).find(x => x.object.visible);
  if (!h) return null;
  let o = h.object; while (o && o.userData.pieceId === undefined) o = o.parent;
  return o ? { id: o.userData.pieceId, obj: h.object, point: h.point } : null;
}
function pickSurface() {
  // the room's surfaces, plus the tops of toy blocks you have placed
  const tops = [];
  for (const inst of insts.values()) if (inst.B.blockBox && inst.group.visible) inst.group.traverse(o => { if (o.userData.place) tops.push(o); });
  const hits = raycaster.intersectObjects(tops.length ? [...room.placeables, ...tops] : room.placeables, false);
  for (const h of hits) {
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    if (n.y > 0.7) return { point: h.point, obj: h.object };
  }
  return null;
}
function pickAny() { return raycaster.intersectObjects([trackGroup, ...room.solids], true)[0] || null; }
let lastSurf = null;
const GRID = 0.025;
const placeAid = new THREE.Group();
{
  const disc = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.045, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2;
  const cross = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([V(-0.07, 0, 0), V(0.07, 0, 0), V(0, 0, -0.07), V(0, 0, 0.07)]), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }));
  const post = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(0, 0, 0), V(0, 1, 0)]), dropMat);
  post.computeLineDistances();
  post.name = 'post';
  placeAid.add(disc, cross, post);
  placeAid.traverse(o => { o.raycast = () => {}; o.renderOrder = 5; });
  placeAid.visible = false;
  fxGroup.add(placeAid);
}
function refreshPlaceGhost() {
  const t = TOOLS[S.tool];
  if (t.type !== 'place' || !lastSurf || S.hover) return;
  const p = lastSurf.point.clone();
  if (!S.freePlace) { p.x = Math.round(p.x / GRID) * GRID; p.z = Math.round(p.z / GRID) * GRID; }
  const d = makeData(S.tool, { port: { x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4), psi: S.placeYaw, phi: 0 } });
  showGhost(d);
  const h = d.opts.height ?? 0;
  placeAid.position.set(p.x, p.y + 0.002, p.z);
  const post = placeAid.getObjectByName('post');
  post.visible = h > 0.02; post.scale.y = Math.max(0.001, h);
  updateHeightBar(p.y + h, p.y);
  setHint(S.ghostValid ? L('Click to place · height {0} cm (wheel) · Q / E turn · Alt = off grid', (h * 100).toFixed(0)) : '⚠ ' + S.ghostReason);
}
canvas.addEventListener('pointerdown', (e) => {
  sound.ensure();
  down = { x: e.clientX, y: e.clientY, t: performance.now(), btn: e.button };
  canvas.focus();
});
canvas.addEventListener('pointermove', (e) => {
  S.freePlace = e.altKey;
  if (drag) return;
  setMouse(e);
  if (down && S.cam !== 'orbit' && (e.buttons & 1)) {
    camState.yawOff -= e.movementX * 0.006; camState.pitchOff -= e.movementY * 0.004;
    camState.pitchOff = THREE.MathUtils.clamp(camState.pitchOff, -1.2, 1.2);
  }
  if (S.cam !== 'orbit' || S.replay) return;
  if (S.move) { const s = pickSurface(); if (s) moveTo(s.point); return; }
  const t = TOOLS[S.tool];
  if (t.type === 'place') { lastSurf = pickSurface(); if (lastSurf) refreshPlaceGhost(); else clearGhost(); }
  else if (S.tool === 'bridge' && S.connectFrom) {
    const m = pickMarker();
    const from = openOuts.find(o => o.key === S.connectFrom);
    if (m && m.kind === 'in' && from) {
      if (S.ghostData?.toKey !== m.key) { showGhost(makeData('bridge', { port: portToData(from.port), to: portToData(m.port) })); if (S.ghostData) S.ghostData.toKey = m.key; }
    } else if (S.ghostData) clearGhost();
  }
  if (S.photo) return;
  if (['select', 'erase', 'paint'].includes(S.tool) && !hdrag && !boxDrag) { const pp = pickMarker() ? null : pickPiece(); hoverPiece(pp && !pieces.find(p => p.id === pp.id)?.locked ? pp.id : null); }
  const over = pickMarker() || (S.tool === 'select' && (pickBall() || pickPiece())) || (S.tool === 'erase' && pickPiece());
  canvas.style.cursor = over ? 'pointer' : t.type === 'place' || S.tool === 'hand' ? 'crosshair' : '';
});
canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const quick = performance.now() - down.t < 450;
  const btn = down.btn; down = null;
  if (moved > 6 || !quick || btn !== 0) return;
  setMouse(e);
  handleClick(e);
});
function handleClick(ev) {
  if (S.replay || S.photo) return;
  if (S.cam !== 'orbit') { const b = pickBall(); if (b) S.follow = b; return; }
  if (S.move) { endMove(true); return; }
  const t = TOOLS[S.tool];
  const marker = pickMarker();
  const first = raycaster.intersectObjects(trackGroup.children, true)[0];
  if (first && first.object.userData.release && t.type !== 'place') {
    const inst = insts.get(first.object.userData.pieceId);
    if (inst && inst.spawn) { S.follow = spawnBall(inst.spawn.clone()); sound.release(); }
    return;
  }
  if (S.tool === 'bridge') {
    if (marker && marker.kind === 'out') { S.connectFrom = marker.key; S.active = marker.key; drawMarkers(); updateGhost(); sound.click(); return; }
    if (marker && marker.kind === 'in' && S.connectFrom) {
      const from = openOuts.find(o => o.key === S.connectFrom);
      const d = makeData('bridge', { port: portToData(from.port), to: portToData(marker.port) });
      const inst = buildPiece(d);
      const reason = validatePiece(inst, [...insts.values()], room.colliders);
      disposeGroup(inst.group);
      if (reason) { toast(L(reason), true); sound.error(); return; }
      S.connectFrom = null;
      commit(d, L('Connected! 🔗'));
    }
    return;
  }
  if (marker && marker.kind === 'out') { S.active = marker.key; S.insert = null; select(null); drawMarkers(); renderDock(); sound.click(); toast(L('Next piece goes here')); return; }
  if (t.type === 'place') {
    if (!S.ghostData) return;
    if (!S.ghostValid) { toast(S.ghostReason, true); sound.error(); return; }
    const d = JSON.parse(JSON.stringify(S.ghostData)); d.id = S.nextId;
    commit(d);
    if (d.type === 'start') { S.tool = 'select'; renderDock(); renderSettings(); clearGhost(); updateGhost(); toast(L('Now add pieces from the dock below ⬇')); }
    else { lastSurf = pickSurface(); refreshPlaceGhost(); }
    return;
  }
  if (S.tool === 'hand') {
    const h = pickAny();
    if (h) { S.follow = spawnBall(h.point.clone().add(V(0, 0.12, 0))); sound.release(); }
    return;
  }
  const b = pickBall();
  if (b) { S.follow = b; openWindow('phys'); toast(L('Following ball #{0}', b.id)); return; }
  const pp = pickPiece();
  if (S.tool === 'erase') { if (pp) deletePiece(pp.id); return; }
  if (pp && ev && ev.shiftKey && !pieces.find(p => p.id === pp.id)?.locked) { S.multi.has(pp.id) ? S.multi.delete(pp.id) : S.multi.add(pp.id); if (S.selected) { S.multi.add(S.selected); select(null); } renderMulti(); sound.click(); return; }
  if (pp) { if (S.multi.size) { S.multi.clear(); renderMulti(); } select(pp.id === S.selected ? null : pp.id); sound.click(); return; }
  if (S.multi.size) { S.multi.clear(); renderMulti(); }
  select(null);
}
canvas.addEventListener('wheel', (e) => {
  if (S.cam !== 'orbit' && !S.replay) { e.preventDefault(); e.stopImmediatePropagation(); camera.fov = THREE.MathUtils.clamp(camera.fov + e.deltaY * 0.03, 40, 110); camera.updateProjectionMatrix(); return; }
  if (TOOLS[S.tool].type !== 'place' || S.move) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const o = S.opts[TOOLS[S.tool].piece];
  o.height = Math.round(THREE.MathUtils.clamp((o.height ?? 0) - Math.sign(e.deltaY) * 0.025, 0, 1.6) * 1000) / 1000;
  renderSettings(); refreshPlaceGhost();
}, { capture: true, passive: false });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ================================================================ keyboard
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  sound.ensure();
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
  if (['w', 'a', 's', 'd', 'r', 'f'].includes(k) && !e.ctrlKey) { keys.add(k); return; }
  if (/^Digit[5-8]$/.test(e.code)) { const i = +e.code[5] - 5; e.shiftKey ? saveView(i) : goView(i); return; }
  switch (e.key) {
    case ',': stepSelection(-1); return;
    case '.': stepSelection(1); return;
    case ' ': e.preventDefault(); if (S.replay) { S.replay.playing = !S.replay.playing; renderReplayBar(); } else releaseAll(); break;
    case '1': setCam('orbit'); break;
    case '2': setCam('chase'); break;
    case '3': setCam('pov'); break;
    case '4': setCam('movie'); break;
    case 'Tab': e.preventDefault(); cycleBall(1); break;
    case 'Escape':
      if ([...document.querySelectorAll('.menu')].some(x => !x.classList.contains('hidden'))) { closeMenus(); break; }
      if (MODALS.some(id => !$(id).classList.contains('hidden'))) { closeModals(); break; }
      if (S.replay) { stopReplay(); break; }
      if (S.photo) { setPhoto(false); break; }
      if (S.move) { endMove(false); break; }
      if (tutor.on) { endTour(); break; }
      if (S.multi.size) { S.multi.clear(); renderMulti(); }
      S.connectFrom = null; S.insert = null; S.tool = 'select'; select(null); renderDock(); renderSettings(); drawMarkers(); updateGhost();
      if (S.cam !== 'orbit') setCam('orbit');
      break;
    case 'Enter': tryAppend(S.lastAppend); break;
    case 'z': case 'Z': case 'Home': if (S.cam === 'orbit') fitView(); break;
    case '+': case '=': if (S.cam === 'orbit') zoomBy(0.8); break;
    case '-': case '_': if (S.cam === 'orbit') zoomBy(1.25); break;
    case 'ArrowUp': e.preventDefault(); tryAppend('straight'); break;
    case 'ArrowLeft': e.preventDefault(); tryAppend('curveL'); break;
    case 'ArrowRight': e.preventDefault(); tryAppend('curveR'); break;
    case 'Delete': if (S.selected) deletePiece(S.selected); break;
    case 'Backspace': {
      e.preventDefault();
      const lastP = pieces.filter(p => !p.locked).reduce((a, p) => !a || p.id > a.id ? p : a, null);
      if (lastP) deletePiece(lastP.id);
      break;
    }
    case 'q': case 'Q': if (S.move) { S.move.yaw += (e.shiftKey ? 15 : 45) * DEG; S.move.at = 0; } else { S.placeYaw += (e.shiftKey ? 15 : 45) * DEG; refreshPlaceGhost(); } break;
    case 'e': case 'E': if (S.move) { S.move.yaw -= (e.shiftKey ? 15 : 45) * DEG; S.move.at = 0; } else { S.placeYaw -= (e.shiftKey ? 15 : 45) * DEG; refreshPlaceGhost(); } break;
    case 'p': case 'P': togglePause(); break;
    case 'c': case 'C': clearBalls(); break;
    case 'h': case 'H': case '?': $('help').classList.toggle('hidden'); break;
    case 'i': case 'I': setSide(!document.body.classList.contains('side-open')); break;
    case 'n': case 'N': setNight(!S.night); break;
    case 'm': case 'M': startReplay(); break;
    case 'k': case 'K': setPhoto(!S.photo); break;
    case '[': stepSlope(-1); break;
    case ']': stepSlope(1); break;
    default: {
      const tk = Object.keys(TOOLS).find(t => TOOLS[t].key && TOOLS[t].key.toLowerCase() === k && TOOLS[t].key.length === 1);
      if (tk) pickTool(tk);
    }
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
function stepSlope(dir) {
  const i = SLOPES.findIndex(([d]) => Math.abs(d * DEG - S.slope) < 1e-6);
  const j = THREE.MathUtils.clamp(i + dir, 0, SLOPES.length - 1);
  S.slope = SLOPES[j][0] * DEG;
  renderSettings(); updateGhost();
  toast(L('Next slope: {0}', L(SLOPES[j][1])));
}
function togglePause() { S.paused = !S.paused; $('btnPause').classList.toggle('on', S.paused); $('btnPause').innerHTML = S.paused ? '<i>▶</i>' : '<i>⏸</i>'; }

// ================================================================ top bar, bars & menus
document.querySelectorAll('#camModes button').forEach(b => b.addEventListener('click', () => {
  sound.ensure();
  // on a phone only the current view shows; tapping it lists the others
  if (phone()) {
    openMenu($('popMenu'), $('camModes'), m => {
      m.innerHTML = [...document.querySelectorAll('#camModes button')].map(c => `<button data-pick="${c.dataset.cam}" class="${c.classList.contains('on') ? 'on' : ''}">${c.innerHTML}</button>`).join('');
      m.onclick = (e) => { const p = e.target.closest('[data-pick]'); if (p) { closeMenus(); setCam(p.dataset.pick); } };
    });
    return;
  }
  setCam(b.dataset.cam);
}));
$('btnRelease').onclick = () => releaseAll();
$('btnAuto').onclick = () => { S.auto = !S.auto; S.autoT = 0; $('btnAuto').classList.toggle('on', S.auto); };
$('btnPause').onclick = togglePause;
$('btnClear').onclick = clearBalls;
$('btnReplay').onclick = startReplay;
$('btnPredict').onclick = () => { S.predict = !S.predict; $('btnPredict').classList.toggle('on', S.predict); schedulePrediction(); };
$('predPill').onclick = () => setSide(true);
$('camFit').onclick = () => { fitView(); sound.click(); };
$('camIn').onclick = () => zoomBy(0.8);
$('camOut').onclick = () => zoomBy(1.25);
$('btnUndo').onclick = undo; $('btnRedo').onclick = redo;
$('btnSound').onclick = () => { sound.ensure(); sound.setOn(!sound.on); $('btnSound').classList.toggle('on', sound.on); $('btnSound').querySelector('i').textContent = sound.on ? '🔊' : '🔇'; };
$('btnMusic').onclick = () => { sound.ensure(); sound.setMusic(!sound.musicOn); $('btnMusic').classList.toggle('on', sound.musicOn); store.set('bc.music', sound.musicOn); };
$('btnNight').onclick = () => setNight(!S.night);
$('btnPhoto').onclick = () => { closeMenus(); setPhoto(true); };
// full screen; on an Android phone it also turns the game sideways (iPhones can't, so there's no button there)
$('btnFull').classList.toggle('hidden', !document.documentElement.requestFullscreen);
$('btnFull').onclick = async () => {
  closeMenus();
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
  try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { return; }
  if (touchScreen() && screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
};
document.addEventListener('fullscreenchange', () => $('btnFull').classList.toggle('on', !!document.fullscreenElement));
$('btnLang').onclick = () => { setLang(getLang() === 'he' ? 'en' : 'he'); store.set('bc.lang', getLang()); renderAll(); };
$('btnChallenges').onclick = openChallenges;
$('btnHelp').onclick = () => { closeMenus(); $('help').classList.remove('hidden'); };
$('ridePrev').onclick = () => cycleBall(-1);
$('rideNext').onclick = () => cycleBall(1);
$('rideExit').onclick = () => setCam('orbit');
$('replayPlay').onclick = () => { S.replay.playing = !S.replay.playing; renderReplayBar(); };
$('replayExit').onclick = stopReplay;
document.querySelectorAll('#replayBar [data-rs]').forEach(b => b.addEventListener('click', () => { S.replay.speed = +b.dataset.rs; renderReplayBar(); }));
$('replayPos').oninput = (e) => { const R = S.replay; R.t = R.t0 + (+e.target.value / 1000) * (R.t1 - R.t0); R.playing = false; renderReplayBar(); };
$('photoSnap').onclick = snapPhoto;
$('photoExit').onclick = () => setPhoto(false);
$('chkForces').onchange = (e) => { S.forces = e.target.checked; };
$('chkTrail').onchange = (e) => { S.trails = e.target.checked; };
$('chkKid').onchange = (e) => { S.kid = e.target.checked; world.assist = S.kid; store.set('bc.kid', S.kid); schedulePrediction(); toast(L(S.kid ? 'Kid mode on: slow balls get a gentle push' : 'Kid mode off: pure physics')); };
function closeModals() { closeMenus(); for (const id of MODALS) $(id).classList.add('hidden'); }
const MODALS = ['help', 'chModal', 'winModal', 'galleryModal', 'albumModal', 'roomsModal', 'sharedModal', 'settingsModal', 'puzzleModal'];
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', (e) => { if (e.target === m) closeModals(); }));
document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
  const a = b.dataset.act;
  if (a === 'close') closeModals();
  if (a === 'new') { if (S.challenge) exitChallenge(); clearBalls(); S.selected = null; sync([]); pushHistory(); closeModals(); toast(L('Fresh room! Place a 📍 Start Tower')); S.tab = 'tracks'; pickTool('start'); }
  if (a === 'demo') { if (S.challenge) exitChallenge(); loadDemo(); assembleIn(); closeModals(); }
  if (a === 'challenges') { closeModals(); openChallenges(); }
  if (a === 'export') {
    const blob = new Blob([JSON.stringify({ app: 'ball-coaster', v: SAVE_V, pieces }, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'my-ball-coaster.json'; link.click(); URL.revokeObjectURL(url);
    closeModals();
  }
  if (a === 'import') $('fileIn').click();
}));
$('fileIn').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (S.challenge) exitChallenge();
    clearBalls(); S.selected = null; sync(migratePieces(j.pieces || [], j.v ?? 1)); pushHistory(); closeModals(); toast(L('Loaded! ✨')); fitView();
  } catch (err) { toast(L('Could not read that file'), true); }
  e.target.value = '';
};

// force arrows
const arrows = {
  v: new THREE.ArrowHelper(V(1, 0, 0), V(), 0.1, '#2fbf71', 0.015, 0.01),
  g: new THREE.ArrowHelper(V(0, -1, 0), V(), 0.1, '#9b6bff', 0.015, 0.01),
  n: new THREE.ArrowHelper(V(0, 1, 0), V(), 0.1, '#4c8dff', 0.015, 0.01),
};
Object.values(arrows).forEach(a => { a.visible = false; fxGroup.add(a); });
function updateArrows() {
  const b = S.follow;
  const show = S.forces && b && world.balls.includes(b) && S.cam !== 'pov' && !S.replay && !S.photo;
  Object.values(arrows).forEach(a => a.visible = !!show);
  if (!show) return;
  const sp = b.vel.length();
  if (sp > 0.01) { arrows.v.position.copy(b.pos); arrows.v.setDirection(b.vel.clone().normalize()); arrows.v.setLength(Math.min(0.4, sp * 0.1) + 0.02, 0.015, 0.01); } else arrows.v.visible = false;
  arrows.g.position.copy(b.pos); arrows.g.setLength(0.07, 0.015, 0.01);
  if (world.time - b.lastTouch < 0.05) { arrows.n.position.copy(b.pos); arrows.n.setDirection(b.normal.clone().normalize()); arrows.n.setLength(0.02 + Math.min(0.3, b.feltG * 0.04), 0.015, 0.01); } else arrows.n.visible = false;
}

// ================================================================ save / load / demo
// v1 coasters were built when the room was full size. An untouched old demo becomes today's demo.
// Anything else moves as one block (so a jump still lands in its basket), and each joined-up part
// keeps standing on the same surface (floor, desk, bed…) of today's smaller room.
const SAVE_V = 2;
function migratePieces(list, v) {
  if (v >= SAVE_V || !list.length) return list;
  const demo = buildDemo();
  if (list.length === demo.length && list.every((d, i) => d.type === demo[i].type && JSON.stringify(d.opts) === JSON.stringify(demo[i].opts))) return demo;
  const s = room.scale, built = new Map(list.map(d => { const b = buildPiece(d); disposeGroup(b.group); return [d.id, b]; }));
  const group = new Map(list.map(d => [d.id, d.id]));
  const find = (id) => group.get(id) === id ? id : find(group.get(id));
  for (const a of built.values()) for (const b of built.values()) {
    if (a !== b && a.outs.some(o => b.ins.some(n => o.p.distanceToSquared(n.p) < 9e-6))) group.set(find(b.d.id), find(a.d.id));
  }
  const xs = list.map(d => d.port.x), zs = list.map(d => d.port.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  return list.map(d => {
    const n = JSON.parse(JSON.stringify(d)), root = list.find(x => x.id === find(d.id));
    const dl = { x: cx * (s - 1), y: root.port.y * (s - 1), z: cz * (s - 1) };
    if (n.port) n.port = movePort(n.port, n.port, dl, 0);
    if (n.to) n.to = movePort(n.to, n.to, dl, 0);
    return n;
  });
}
function save() { if (!S.challenge) store.set(roomKey(room.kind), { v: SAVE_V, pieces }); }
function loadDemo() {
  clearBalls();
  S.selected = null;
  S.nextId = 1;
  sync(buildDemo());
  pushHistory();
  toast(L('Demo coaster loaded — press ▶ Release!'));
  fitView();
}

// ================================================================ the bigger picture
// Everything below builds on the pieces above: the Toy Critics and run reports (insight.js), the
// visiting friend and the toy audience (visitors.js), building helpers, rooms, sharing and more.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let _hashFor = null, _hash = '';
function designHash() {
  if (_hashFor === pieces) return _hash;
  const str = JSON.stringify(pieces.filter(p => !p.locked).map(p => [p.type, p.port, p.opts, p.slope, p.style]));
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  _hashFor = pieces; _hash = room.kind + ':' + (h >>> 0).toString(36);
  return _hash;
}
let _ptsFor = null, _pts = [];
function trackPoints() {
  if (_ptsFor === pieces) return _pts;
  _pts = [];
  for (const inst of insts.values()) for (const path of inst.paths) for (let i = 0; i < path.samples.length; i += 4) _pts.push({ id: inst.d.id, p: path.samples[i].p });
  _ptsFor = pieces;
  return _pts;
}
function decorNear(samples) {
  let n = 0;
  for (const inst of insts.values()) {
    if (!inst.B.decor) continue;
    const q = inst.d.port;
    if (samples.some((s, i) => i % 5 === 0 && Math.hypot(s.x - q.x, s.z - q.z) < 0.3)) n++;
  }
  return n;
}
const roomInfo = (k) => ROOM_KINDS.find(r => r.kind === k) || ROOM_KINDS[0];

const app = {
  scene, camera, controls, renderer, canvas, world, S, C, sound, L, store, $, pred, insts, probeRay,
  get room() { return room; }, get pieces() { return pieces; },
  roomKind: () => room.kind,
  toast, setHint, flyTo, fitView, select, releaseAll, spawnBall, confetti, sparkle, coasterBox, liveBalls,
  openWindow: (t) => openWindow(t), designHash, trackPoints, decorNear,
  sticker: (id) => sticker(id),
  news: (...a) => insight.news(...a),
  quiet: (gap) => quiet(gap),
  lastRun: () => insight.lastRun,
  trouble: () => pred.runs.find(r => r.done && r.trouble),
  onRun(run) {
    if (!C.best || run.rating.fun > C.best.fun) C.best = { ...run.rating, result: run.result };
    if (run.inversions) sticker('loop');
    if (run.rating.stars >= 4.5) sticker('five-star');
    if (run.gadgets >= 5) sticker('gadgets');
    visitors.onRun(run);
    if (S.win === 'coaster') renderCoasterTab();
  },
  onAward() { sticker('award'); visitors.react('award'); },
  onClassic() { refreshSigns(); sticker('classic'); },
};
const insight = createInsight(app);
const visitors = createVisitors(app);
const play = createPlay({
  S, $, world, sound, TOOLS, ICONS, esc, SAVE_V, buzz, schedulePrediction, closeMenus, closeModals, toast, shareLink, startChallenge,
  get room() { return room; }, get pieces() { return pieces; },
});

// ---------------------------------------------------------------- coaster window (side panel tabs)
S.win = 'run';
function openWindow(tab) {
  setSide(true);
  S.win = tab;
  document.querySelectorAll('#winTabs [data-win]').forEach(b => b.classList.toggle('on', b.dataset.win === tab));
  document.querySelectorAll('#side .win').forEach(c => c.classList.toggle('hidden', c.dataset.win !== tab));
  if (tab === 'run') insight.renderWindow();
  if (tab === 'awards') { insight.renderAwards(); renderStickers(); }
  if (tab === 'coaster') renderCoasterTab();
  if (tab !== 'run') insight.hideScrub();
}
$('winTabs').onclick = (e) => { const b = e.target.closest('[data-win]'); if (!b) return; sound.click(); if (b.dataset.win === 'close') setSide(false); else openWindow(b.dataset.win); };
function renderCoasterTab() {
  const el = $('coasterBody');
  const n = pieces.filter(p => !p.locked).length, info = roomInfo(room.kind);
  el.innerHTML = `
    <div class="labrow"><label>${L('Name')}</label><input id="coasterName" maxlength="40" value="${esc(S.name)}" placeholder="${esc(L('Name your coaster'))}"></div>
    <div class="small muted">${info.icon} ${L(info.name)} · ${L('{0} pieces', n)}${insight.isClassic() ? ' · 🏅 ' + L('Classic') : ''}</div>
    <div class="labrow"><label>${L('Paint by')}</label><div class="chips" id="heatChips"></div></div>
    <div class="cwBtns">
      <button id="cwFinish">✨ ${L('Finish it')}</button><button id="cwFix">🔧 ${L('Fix the trouble spot')}</button>
      <button id="cwShare">🔗 ${L('Copy share link')}</button><button id="cwSave">💾 ${L('Save to My coasters')}</button>
      <button id="cwVisit">🚪 ${L('Invite a friend now')}</button><button id="cwRooms">🏠 ${L('Rooms')}</button>
    </div>`;
  chips($('heatChips'), [['off', L('Nothing')], ['speed', L('Speed')], ['g', L('g-force')]], v => v === S.heat, v => { S.heat = v; store.set('bc.heat', v); insight.heat(v); renderCoasterTab(); });
  $('coasterName').onchange = (e) => setName(e.target.value);
  $('cwFinish').onclick = runFinishIt; $('cwFix').onclick = runFixIt; $('cwShare').onclick = copyShareLink;
  $('cwSave').onclick = () => openGallery(); $('cwVisit').onclick = () => visitors.callNow(); $('cwRooms').onclick = openRooms;
}
function setName(v) { S.name = String(v || '').trim().slice(0, 40); store.set('bc.name.' + room.kind, S.name); refreshSigns(); }

// ---------------------------------------------------------------- a name sign and the Classic plaque on the first start tower
const signGroup = new THREE.Group(); scene.add(signGroup);
function signTexture(text, classic) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 112;
  const g = c.getContext('2d');
  g.font = '600 52px Fredoka, sans-serif';
  const w = Math.min(500, g.measureText(text).width + 60);
  g.fillStyle = classic ? '#ffc94a' : '#ffffff'; g.strokeStyle = classic ? '#c48a00' : '#ff7a59'; g.lineWidth = 8;
  g.beginPath(); g.roundRect((512 - w) / 2, 10, w, 92, 40); g.fill(); g.stroke();
  g.fillStyle = '#2b2d42'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 58, 470);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function refreshSigns() {
  for (const s of signGroup.children) { s.material.map.dispose(); s.material.dispose(); }
  signGroup.clear();
  const tower = [...insts.values()].find(i => i.spawn);
  const classic = insight.isClassic();
  if (!tower || (!S.name && !classic)) return;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(`${classic ? '🏅 ' : ''}${S.name || L('Classic')}`, classic), transparent: true }));
  sp.scale.set(0.22, 0.048, 1); sp.position.copy(tower.spawn).add(V(0, 0.09, 0)); sp.raycast = () => {};
  signGroup.add(sp);
}

// ---------------------------------------------------------------- sensors, splashes and the photo booth
const showLight = new THREE.PointLight('#ffffff', 0, 1.4, 1.2); scene.add(showLight);
let showT = 9;
function sensorEffect(dev, b) {
  const p = b.pos.clone();
  if (dev.effect === 'confetti') { confetti(p, 50); sound.pop(2); }
  else if (dev.effect === 'lights') { showLight.position.copy(p).add(V(0, 0.12, 0)); showT = 0; sound.beep(2); C.lights = C.lights || S.night; }
  else if (dev.effect === 'music') sound.jingle();
  else if (dev.effect === 'cheer') { sound.cheer(); visitors.react('cheer', b); }
  else sound.beep(1);
}
function splashFx(p, v) {
  const n = Math.min(26, 6 + Math.round(v * 14));
  for (let i = 0; i < n; i++) addPart(p.clone().add(V(0, 0.01, 0)), V((Math.random() - 0.5) * 0.5, 0.35 + Math.random() * 0.6 * (0.4 + v), (Math.random() - 0.5) * 0.5), i % 3 ? '#7cc6ff' : '#ffffff', 0.7);
}
const album = store.get('bc.album', []);
const photoQueue = [];
const photoCam = new THREE.PerspectiveCamera(48, 4 / 3, 0.005, 12);
const snapCanvas = document.createElement('canvas'); snapCanvas.width = 320; snapCanvas.height = 240;
function takeBallPhoto(dev, b) {
  if (S.replay || photoQueue.length > 2) return;
  photoQueue.push({ from: dev.camPos.clone(), at: b.pos.clone().addScaledVector(b.vel, 0.02) });
}
function processPhotos() {
  const job = photoQueue.shift();
  if (!job) return;
  photoCam.position.copy(job.from); photoCam.lookAt(job.at); photoCam.updateMatrixWorld();
  const W = 320, H = 240, dpr = renderer.getPixelRatio(), el = renderer.domElement;
  const vis = [markerGroup.visible, predGroup.visible, ghostGroup.visible];
  markerGroup.visible = predGroup.visible = ghostGroup.visible = false;
  renderer.setScissorTest(true); renderer.setScissor(0, 0, W, H); renderer.setViewport(0, 0, W, H);
  renderer.render(scene, photoCam);
  const g = snapCanvas.getContext('2d');
  g.drawImage(el, 0, el.height - H * dpr, W * dpr, H * dpr, 0, 0, W, H);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  [markerGroup.visible, predGroup.visible, ghostGroup.visible] = vis;
  g.fillStyle = 'rgba(255,255,255,0.86)'; g.fillRect(0, H - 22, W, 22);
  g.fillStyle = '#2b2d42'; g.font = '600 13px Fredoka, sans-serif';
  g.fillText(`📸 ${S.name || 'Ball Coaster'} · ${new Date().toLocaleTimeString()}`, 8, H - 7);
  const url = snapCanvas.toDataURL('image/jpeg', 0.78);
  album.unshift({ url, t: Date.now() });
  while (album.length > 24) album.pop();
  store.set('bc.album', album);
  sound.shutter();
  const el2 = insight.news('📸', L('Snap! A new photo in the album'), null, () => openAlbum());
  const img = new Image(); img.src = url; img.className = 'newsThumb'; el2.appendChild(img);
  sticker('photo');
  renderFrame();
}
function openAlbum() {
  closeMenus();
  $('albumList').innerHTML = album.length ? album.map((a, i) => `<a class="photo" href="${a.url}" download="ball-coaster-photo-${i + 1}.jpg"><img src="${a.url}" alt=""></a>`).join('') : `<p class="muted small">${L('No photos yet — add a 📸 Photo Booth piece (Gadgets tab).')}</p>`;
  $('albumModal').classList.remove('hidden');
}

// ---------------------------------------------------------------- the ball camera in the corner
const pipCam = new THREE.PerspectiveCamera(80, 4 / 3, 0.002, 20);
const pipLook = V(1, 0, 0);
S.pip = store.get('bc.pip', false);
function renderCornerCam() {
  const fr = $('pipFrame');
  const on = S.pip && S.cam === 'orbit' && !S.photo && !S.replay;
  fr.classList.toggle('hidden', !on);
  $('camPip').classList.toggle('on', S.pip);
  if (!on) return;
  if (window.innerWidth > 760) fr.style.right = (62 + (document.body.classList.contains('side-open') ? 310 : 0)) + 'px';
  const fb = fr.getBoundingClientRect(), W = fb.width || 240, H = fb.height || 180, y = window.innerHeight - fb.bottom;
  const live = liveBalls(), b = S.follow && live.includes(S.follow) ? S.follow : live[live.length - 1];
  if (!b) { $('pipLabel').textContent = L('Release a ball to ride along'); fr.classList.add('empty'); return; }
  fr.classList.remove('empty');
  $('pipLabel').textContent = `#${b.id} · ${b.vel.length().toFixed(2)} ${L('m/s')}`;
  if (b.vel.lengthSq() > 0.0025) pipLook.lerp(b.vel.clone().normalize(), 0.12).normalize();
  pipCam.position.copy(b.pos).add(V(0, b.r * 1.4, 0)).addScaledVector(pipLook, -0.025);
  pipCam.up.set(0, 1, 0);
  pipCam.lookAt(pipCam.position.clone().add(pipLook));
  const vis = b.mesh.visible; b.mesh.visible = false;
  const x = fb.left;
  renderer.setScissorTest(true); renderer.setScissor(x, y, W, H); renderer.setViewport(x, y, W, H);
  renderer.render(scene, pipCam);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  b.mesh.visible = vis;
}
$('camPip').onclick = () => { S.pip = !S.pip; store.set('bc.pip', S.pip); sound.click(); };
$('pipClose').onclick = () => { S.pip = false; store.set('bc.pip', false); };

// ---------------------------------------------------------------- saved camera views
const viewsKey = () => 'bc.views.' + room.kind;
function saveView(i) {
  const v = store.get(viewsKey(), []);
  v[i] = { p: camera.position.toArray(), t: controls.target.toArray() };
  store.set(viewsKey(), v); toast(L('View {0} saved 📌', i + 1)); sound.click();
}
function goView(i) {
  const v = store.get(viewsKey(), [])[i];
  if (!v) { toast(L('No view saved in slot {0} yet', i + 1), true); return; }
  if (S.cam !== 'orbit') setCam('orbit');
  flyTo(V(...v.p), V(...v.t));
}
$('camViews').onclick = () => openMenu($('viewsMenu'), $('camViews'), m => {
  const v = store.get(viewsKey(), []);
  m.innerHTML = [0, 1, 2, 3].map(i => `<div class="vrow"><button data-go="${i}" ${v[i] ? '' : 'disabled'}>📌 ${L('View {0}', i + 1)} <kbd>${i + 5}</kbd></button><button data-save="${i}" title="${esc(L('Save the current view here'))}">💾</button></div>`).join('');
}, true);
$('viewsMenu').onclick = (e) => {
  const g = e.target.closest('[data-go]'), s = e.target.closest('[data-save]');
  if (g) { goView(+g.dataset.go); closeMenus(); }
  if (s) { saveView(+s.dataset.save); closeMenus(); }
};

// ---------------------------------------------------------------- video of the replay
const video = new VideoRecorder(renderer.domElement);
const fileName = () => (S.name || 'ball-coaster').replace(/[^\w֐-׿-]+/g, '-');
$('replayVideo').onclick = async () => {
  if (!video.supported) { toast(L('Video recording is not supported in this browser'), true); return; }
  if (video.active) { await video.stop(fileName()); $('replayVideo').classList.remove('rec'); toast(L('🎬 Video saved!')); return; }
  const R = S.replay; if (!R) return;
  R.t = R.t0; R.playing = true; renderReplayBar();
  video.start(); $('replayVideo').classList.add('rec');
  toast(L('⏺ Recording the replay…'));
};
async function replayLooped() {
  if (!video.active) return;
  await video.stop(fileName());
  $('replayVideo').classList.remove('rec');
  toast(L('🎬 Video saved!'));
}

// ---------------------------------------------------------------- release modes and races
const AUTO_MODES = [['off', '⏹ Off'], ['steady', '🔁 One every 2 s'], ['queue', '🌈 Rainbow queue (8 balls)'], ['mixed', '🎲 Mixed balls'], ['race', '🏁 Race the towers']];
S.autoMode = 'off';
$('btnAuto').onclick = () => openMenu($('autoMenu'), shown($('btnAuto')), m => {
  m.innerHTML = AUTO_MODES.map(([k, l]) => `<button data-auto="${k}" class="${S.autoMode === k ? 'on' : ''}">${L(l)}</button>`).join('');
});
$('autoMenu').onclick = (e) => { const b = e.target.closest('[data-auto]'); if (b) { closeMenus(); setAuto(b.dataset.auto); } };
function setAuto(mode) {
  sound.ensure();
  S.race = null;
  if (mode === 'race') { if (starts().length < 2) { toast(L('A race needs two Start Towers'), true); mode = 'off'; } else return startRace(); }
  S.autoMode = mode; S.auto = mode !== 'off'; S.autoT = 0; S.autoLeft = 8;
  $('btnAuto').classList.toggle('on', S.auto);
  document.querySelector('[data-proxy="btnAuto"]').classList.toggle('on', S.auto);
  sound.click();
}
function autoTick(simDt) {
  if (!S.auto || simDt <= 0) return;
  S.autoT -= simDt;
  if (S.autoT > 0) return;
  if (S.autoMode === 'queue') { if (S.autoLeft-- <= 0) { setAuto('off'); return; } releaseAll(true); S.autoT = 0.8; }
  else if (S.autoMode === 'mixed') { const ks = Object.keys(BALL_TYPES), keep = S.ballType; S.mixI = ((S.mixI || 0) + 1) % ks.length; S.ballType = ks[S.mixI]; releaseAll(true); S.ballType = keep; S.autoT = 1.6; }
  else { releaseAll(true); S.autoT = 2; }
}
function startRace() {
  S.autoMode = 'off'; S.auto = false; $('btnAuto').classList.remove('on');
  clearBalls();
  let n = 3;
  const tick = () => {
    if (n > 0) { toast(`🏁 ${n}…`); sound.beep(0); n--; setTimeout(tick, 650); return; }
    toast(L('🏁 Go!')); sound.beep(3);
    const towers = starts();
    S.race = { balls: towers.map((t, i) => { const b = spawnBall(t.spawn.clone()); b.race = { i, color: t.d.color }; return b; }), winner: null, goals: [] };
    S.follow = S.race.balls[0];
  };
  tick();
}
function raceGoal(b) {
  const R = S.race;
  if (!R || !b.race) return;
  R.goals.push(world.time);
  if (!R.winner) {
    R.winner = b;
    const col = COLORS[b.race.color] || '#ffd23f';
    insight.news('🏁', L('Tower {0} wins the race!', `<b style="color:${col}">●</b> ${b.race.i + 1}`));
    sound.fanfare(); confetti(b.pos, 90);
  }
  C.race = { goals: R.goals.length, gap: R.goals.length > 1 ? R.goals[1] - R.goals[0] : null };
}

// ---------------------------------------------------------------- traffic jams
let jamT = 0, jamLast = -99;
function jamCheck(now) {
  if (now - jamT < 1000) return;
  jamT = now;
  const slow = liveBalls().filter(b => !b.captured && !b.onRoomFloor && b.vel.length() < 0.02);
  for (const b of slow) {
    if (slow.filter(o => o.pos.distanceTo(b.pos) < 0.07).length >= 3 && world.time - jamLast > 20) {
      jamLast = world.time;
      insight.news('🚧', L('Traffic jam! A Gate lets balls through one at a time.'), b.pos.clone());
      sound.clack(0.6);
      break;
    }
  }
}

// ---------------------------------------------------------------- stickers
const STICKERS = [
  ['first-goal', '🎯', 'First goal'], ['loop', '🌀', 'Upside down'], ['splash', '💦', 'Splash!'], ['photo', '📸', 'Say cheese'],
  ['award', '🏆', 'Record breaker'], ['classic', '🏅', 'A Classic'], ['visitor', '👧', 'A friend came by'], ['five-star', '⭐', 'Four and a half stars'],
  ['rooms', '🏠', 'Room explorer'], ['daily', '📅', 'Daily puzzler'], ['builder', '🧱', '50 pieces placed'], ['gadgets', '⚙️', 'Gadget fan'],
];
function sticker(id) {
  const got = store.get('bc.stickers', {});
  if (got[id]) return;
  got[id] = Date.now(); store.set('bc.stickers', got);
  const s = STICKERS.find(x => x[0] === id);
  if (s) { insight.news(s[1], L('New sticker: {0}', L(s[2]))); sound.star(2); }
  if (S.win === 'awards') renderStickers();
}
function renderStickers() {
  const got = store.get('bc.stickers', {});
  $('stickerBody').innerHTML = `<h4>${L('Sticker book')} <small>${Object.keys(got).length} / ${STICKERS.length}</small></h4><div class="stickers">${STICKERS.map(([id, icon, name]) => `<div class="sticker ${got[id] ? 'got' : ''}" title="${esc(L(name))}"><i>${icon}</i><span>${L(name)}</span></div>`).join('')}</div>`;
}

// ---------------------------------------------------------------- build arrows next to the ring
S.arrows = store.get('bc.arrows', true);
// the arrows stay folded into the ring tag's ＋ until you open them, hover them, or just built something
let padPinned = store.get('bc.padPinned', false), padUntil = 0, padHover = false;
const padOpen = () => padPinned || padHover || performance.now() < padUntil;
$('ringTag').addEventListener('click', (e) => {
  if (!e.target.closest('.plus')) return;
  padPinned = !padPinned; store.set('bc.padPinned', padPinned); padUntil = 0;
  if (S.ringInfo) S.ringInfo.at = 0;
  sound.click();
});
$('buildPad').addEventListener('pointerenter', () => { padHover = true; });
$('buildPad').addEventListener('pointerleave', () => { padHover = false; padUntil = performance.now() + 1500; });
function positionBuildPad() {
  const el = $('buildPad'), I = S.ringInfo;
  const show = S.arrows && padOpen() && I && S.cam === 'orbit' && !S.photo && !S.replay && !S.move && markerGroup.visible && TOOLS[S.tool].type !== 'place' && !S.multi.size && !hdrag && !S.selected;
  el.classList.toggle('hidden', !show);
  if (!show) return;
  buildPad.tick();
  if (phone()) { el.style.left = el.style.top = el.style.visibility = ''; return; } // a phone keeps it just above the dock
  _v.copy(I.p).project(camera);
  const r = canvas.getBoundingClientRect();
  // to the right of the ring, or to its left when there is no room
  const sx = r.left + (_v.x + 1) / 2 * r.width, w = el.offsetWidth || 230, h = el.offsetHeight || 100;
  el.style.left = (sx + 36 + w < window.innerWidth - 6 ? sx + 36 : Math.max(6, sx - 36 - w)) + 'px';
  el.style.top = THREE.MathUtils.clamp(r.top + (1 - _v.y) / 2 * r.height - h / 2, 70, window.innerHeight - h - 160) + 'px';
  el.style.visibility = _v.z > 1 ? 'hidden' : 'visible';
}
// the turn / slope / tilt rows and their test ball live in buildpad.js
const buildPad = createBuildPad({
  S, $, esc, SLOPES, BANKS, world, sound, store, insts, makeData, activePort, predSpeedAt, renderSettings, deletePiece, runFinishIt, canUse, toast, showBump, clearGhost, showGhost, commit, setHint,
  get room() { return room; }, get pieces() { return pieces; }, get hIdx() { return hIdx; },
});

// ---------------------------------------------------------------- walking along the track
function stepSelection(dir) {
  const ap = activePort();
  const id = S.selected ?? (ap && ap.id);
  if (id == null) return;
  const { kids, parentOf } = chainLinks();
  const next = dir < 0 ? parentOf.get(id)?.id : (kids.get(id) || [])[0]?.id;
  if (next == null) { sound.error(); return; }
  select(next); sound.click();
  if (S.camFollow) { const c = S.selAnchor.clone(), off = camera.position.clone().sub(controls.target); flyTo(c.clone().add(off), c); }
}

// ---------------------------------------------------------------- drag handles on the selected piece
const HANDLE = { straight: 'len', tunnel: 'len', brake: 'len', curve: 'angle', helix: 'turns', drop: 'height', lift: 'height', screw: 'height', elevator: 'height', loop: 'radius' };
const handleMat = new THREE.MeshBasicMaterial({ color: '#ff7a00', transparent: true, opacity: 0.95, depthTest: false });
const handleRingMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
const handleGeo = new THREE.SphereGeometry(0.011, 16, 12), handleRingGeo = new THREE.RingGeometry(0.014, 0.018, 28);
const handleGroup = new THREE.Group(); scene.add(handleGroup);
function refreshHandles() {
  handleGroup.clear();
  const d = S.selected && pieces.find(p => p.id === S.selected);
  if (!d || d.locked || !HANDLE[d.type] || S.cam !== 'orbit' || S.multi.size) return;
  const inst = insts.get(d.id), o = inst && inst.outs[0];
  if (!o) return;
  const h = new THREE.Mesh(handleGeo, handleMat);
  h.position.copy(o.p).add(V(0, 0.028, 0)); h.renderOrder = 10;
  const ring = new THREE.Mesh(handleRingGeo, handleRingMat); ring.renderOrder = 10; h.add(ring);
  h.userData.handle = d.id;
  handleGroup.add(h);
}
let hdrag = null;
const _plane = new THREE.Plane(), _hit = V();
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || S.cam !== 'orbit' || S.replay) return;
  setMouse(e);
  // grab a handle
  if (handleGroup.children.length && raycaster.intersectObjects(handleGroup.children, true).length) {
    const d = pieces.find(p => p.id === S.selected);
    if (!d) return;
    e.stopImmediatePropagation(); e.preventDefault();
    hdrag = { id: d.id, d0: JSON.parse(JSON.stringify(d)), key: HANDLE[d.type], x: e.clientX, y: e.clientY, at: 0, changed: false };
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  // paint by dragging over pieces
  if (S.tool === 'paint') {
    const pp = pickPiece();
    if (!pp) return;
    e.stopImmediatePropagation();
    controls.enabled = false;
    painting = { done: new Set(), changed: false };
    paintAt(pp.id, e.shiftKey);
    return;
  }
  // box selection
  if (S.tool === 'boxsel') {
    e.stopImmediatePropagation();
    controls.enabled = false;
    boxDrag = { x: e.clientX, y: e.clientY, shift: e.shiftKey };
  }
}, { capture: true });
window.addEventListener('pointermove', (e) => {
  if (hdrag) dragHandle(e);
  else if (painting) { setMouse(e); const pp = pickPiece(); if (pp) paintAt(pp.id, false); }
  else if (boxDrag) {
    const el = $('boxSel'), x0 = Math.min(boxDrag.x, e.clientX), y0 = Math.min(boxDrag.y, e.clientY);
    el.classList.remove('hidden');
    Object.assign(el.style, { left: x0 + 'px', top: y0 + 'px', width: Math.abs(e.clientX - boxDrag.x) + 'px', height: Math.abs(e.clientY - boxDrag.y) + 'px' });
  }
});
window.addEventListener('pointerup', (e) => {
  if (hdrag) {
    const h = hdrag; hdrag = null;
    controls.enabled = S.cam === 'orbit';
    if (h.changed) { pushHistory(); sound.place(); }
    setHint(''); select(h.id);
  }
  if (painting) { if (painting.changed) pushHistory(); painting = null; controls.enabled = S.cam === 'orbit'; }
  if (boxDrag) { finishBox(e); boxDrag = null; controls.enabled = S.cam === 'orbit'; $('boxSel').classList.add('hidden'); }
});
function dragHandle(e) {
  const h = hdrag, d0 = h.d0, now = performance.now();
  if (now - h.at < 70) return;
  h.at = now;
  setMouse(e);
  const nd = JSON.parse(JSON.stringify(d0)), dy = e.clientY - h.y, fine = S.pro;
  const snap = (v, st) => Math.round(v / st) * st;
  let label = '';
  if (e.shiftKey) {
    nd.slope = +(THREE.MathUtils.clamp(d0.slope / DEG + dy / 6, -6, 35) * DEG).toFixed(5);
    nd.slope = +(snap(nd.slope / DEG, 1) * DEG).toFixed(5);
    label = `${L('Slope')} ${Math.round(nd.slope / DEG)}°`;
  } else if (h.key === 'len') {
    const P = d0.port;
    _plane.set(UP, -P.y);
    if (!raycaster.ray.intersectPlane(_plane, _hit)) return;
    const hd = V(Math.cos(P.psi), 0, -Math.sin(P.psi));
    nd.opts.len = +THREE.MathUtils.clamp(snap(_hit.sub(V(P.x, P.y, P.z)).dot(hd), fine ? 0.01 : 0.05), 0.05, 1).toFixed(3);
    label = `${L('Length')} ${cm(nd.opts.len)}`;
  } else if (h.key === 'angle') {
    const P = d0.port, dir = d0.opts.dir, R = d0.opts.radius;
    const left = V(-Math.sin(P.psi), 0, -Math.cos(P.psi)), c = V(P.x, P.y, P.z).addScaledVector(left, R * dir);
    _plane.set(UP, -P.y);
    if (!raycaster.ray.intersectPlane(_plane, _hit)) return;
    const a0 = Math.atan2(P.z - c.z, P.x - c.x), a1 = Math.atan2(_hit.z - c.z, _hit.x - c.x);
    let da = (a0 - a1) * dir;
    while (da < 0) da += Math.PI * 2;
    nd.opts.angle = THREE.MathUtils.clamp(snap(da / DEG, fine ? 5 : 15), 15, 270);
    label = `${L('Angle')} ${nd.opts.angle}°`;
  } else if (h.key === 'turns') {
    nd.opts.turns = THREE.MathUtils.clamp(snap(d0.opts.turns - dy / 70, fine ? 0.25 : 0.5), 0.5, 4);
    label = `${L('Turns')} ${nd.opts.turns}`;
  } else if (h.key === 'height') {
    nd.opts.height = +THREE.MathUtils.clamp(snap(d0.opts.height - dy / 300, fine ? 0.01 : 0.05), 0.1, 1).toFixed(3);
    label = `${L('Height')} ${cm(nd.opts.height)}`;
  } else if (h.key === 'radius') {
    nd.opts.radius = +THREE.MathUtils.clamp(snap(d0.opts.radius - dy / 900, 0.005), 0.06, 0.14).toFixed(3);
    label = `${L('Size')} ${cm(nd.opts.radius * 2)}`;
  }
  const cur = pieces.find(p => p.id === h.id);
  if (!cur || JSON.stringify(cur) === JSON.stringify(nd)) { setHint(label); return; }
  const r = reflow(pieces.map(p => p.id === h.id ? nd : p), h.id, chainLinks().kids);
  const reason = chainProblem(r.list, r.order);
  if (reason) { setHint('⚠ ' + L(reason)); showBump(false); return; }
  sync(r.list);
  h.changed = true;
  setHint(label);
}

// ---------------------------------------------------------------- many pieces at once
S.multi = new Set();
let boxDrag = null, painting = null, multiHi = [];
function finishBox(e) {
  const x0 = Math.min(boxDrag.x, e.clientX), x1 = Math.max(boxDrag.x, e.clientX), y0 = Math.min(boxDrag.y, e.clientY), y1 = Math.max(boxDrag.y, e.clientY);
  if (!boxDrag.shift) S.multi.clear();
  if (x1 - x0 < 6 && y1 - y0 < 6) {
    setMouse(e);
    const pp = pickPiece();
    if (pp) S.multi.has(pp.id) ? S.multi.delete(pp.id) : S.multi.add(pp.id);
  } else {
    const r = canvas.getBoundingClientRect();
    for (const inst of insts.values()) {
      if (inst.d.locked) continue;
      const box = new THREE.Box3();
      for (const c of inst.group.children) if (c !== inst.pillars && !c.isSprite) box.expandByObject(c);
      box.getCenter(_v).project(camera);
      const sx = r.left + (_v.x + 1) / 2 * r.width, sy = r.top + (1 - _v.y) / 2 * r.height;
      if (_v.z < 1 && sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) S.multi.add(inst.d.id);
    }
  }
  select(null);
  renderMulti();
  sound.click();
}
function renderMulti() {
  for (const g of multiHi) setHighlight(g, false);
  multiHi = [];
  for (const id of [...S.multi]) { const inst = insts.get(id); if (!inst) { S.multi.delete(id); continue; } setHighlight(inst.group, true); multiHi.push(inst.group); }
  const el = $('multiBar');
  el.classList.toggle('hidden', !S.multi.size);
  if (!S.multi.size) return;
  el.innerHTML = `<b>${L('{0} pieces', S.multi.size)}</b>
    <button data-mb="paint">🎨 ${L('Paint')}</button><button data-mb="mirror">🪞 ${L('Mirror')}</button>
    <button data-mb="part">⭐ ${L('Save as part')}</button><button data-mb="dup">📋 ${L('Copy to the ring')}</button>
    <button data-mb="del" class="del">🗑 ${L('Delete')}</button><button data-mb="x">✕</button>`;
}
$('multiBar').onclick = (e) => {
  const b = e.target.closest('[data-mb]');
  if (!b) return;
  const ids = new Set(S.multi), k = b.dataset.mb;
  if (k === 'x') { S.multi.clear(); renderMulti(); return; }
  if (k === 'paint') { const list = pieces.map(p => ids.has(p.id) && !p.locked ? { ...p, color: nextColor() } : p); sync(list); pushHistory(); sound.click(); }
  if (k === 'mirror') mirrorIds(ids);
  if (k === 'part') saveAsPart(ids);
  if (k === 'dup') { const part = partFromIds(ids); if (part) pastePart(part.items); }
  if (k === 'del') { sync(pieces.filter(p => !ids.has(p.id) || p.locked)); pushHistory(); sound.remove(); S.multi.clear(); toast(L('Removed {0} pieces', ids.size), false, undo); }
  renderMulti();
};
function nextColor() { const c = resolveColor(); if (S.color === 'rainbow') S.rainbow++; return c; }
function mirrorData(d) {
  const n = JSON.parse(JSON.stringify(d));
  if (n.opts.dir !== undefined) n.opts.dir = -n.opts.dir;
  if (n.opts.exit === 'left') n.opts.exit = 'right'; else if (n.opts.exit === 'right') n.opts.exit = 'left';
  return n;
}
function mirrorIds(ids) {
  let list = pieces.map(p => ids.has(p.id) && !p.locked ? mirrorData(p) : p);
  const { kids, parentOf } = chainLinks();
  const roots = [...ids].filter(id => !ids.has(parentOf.get(id)?.id));
  const order = [];
  for (const r of roots) { if (!list.some(p => p.id === r)) continue; const rr = reflow(list, r, kids); list = rr.list; order.push(...rr.order); }
  const reason = chainProblem(list, [...new Set(order)]);
  if (reason) { toast(L(reason), true); sound.error(); showBump(false); return; }
  sync(list); pushHistory(); sound.place();
  toast(L('Mirrored 🪞'));
}

// ---------------------------------------------------------------- parts: saved sections you can drop in again
const DEGR = Math.PI / 180;
const seq = (...items) => items.map((it, i) => ({ parent: i - 1, out: 0, slope: 3 * DEGR, ...it }));
const BUILTIN_PARTS = [
  { name: 'Double spiral', icon: 'helixL', items: seq({ type: 'helix', opts: { turns: 2, radius: 0.11, dir: 1 }, slope: 7 * DEGR }) },
  { name: 'Zigzag', icon: 'curveR', items: seq({ type: 'curve', opts: { angle: 90, radius: 0.12, dir: 1 } }, { type: 'straight', opts: { len: 0.1 } }, { type: 'curve', opts: { angle: 90, radius: 0.12, dir: -1 } }, { type: 'straight', opts: { len: 0.1 } }, { type: 'curve', opts: { angle: 90, radius: 0.12, dir: 1 } }, { type: 'curve', opts: { angle: 90, radius: 0.12, dir: -1 } }) },
  { name: 'Dive and loop', icon: 'loop', items: seq({ type: 'straight', opts: { len: 0.3 }, slope: 30 * DEGR }, { type: 'straight', opts: { len: 0.3 }, slope: 30 * DEGR }, { type: 'straight', opts: { len: 0.15 }, slope: 0 }, { type: 'loop', opts: { radius: 0.08 }, style: 'tube' }) },
  { name: 'Music stairs', icon: 'xylo', items: seq({ type: 'xylo', opts: {}, slope: 4 * DEGR }, { type: 'curve', opts: { angle: 90, radius: 0.12, dir: -1 } }, { type: 'xylo', opts: {}, slope: 4 * DEGR }, { type: 'curve', opts: { angle: 90, radius: 0.12, dir: 1 } }, { type: 'xylo', opts: {}, slope: 4 * DEGR }) },
  { name: 'Gadget line', icon: 'booster', items: seq({ type: 'sensor', opts: { effect: 'confetti' } }, { type: 'brake', opts: { len: 0.1, speed: 0.6 } }, { type: 'booster', opts: { power: 1.4 } }, { type: 'photo', opts: {} }) },
  { name: 'Lift and dive', icon: 'lift', items: seq({ type: 'lift', opts: { height: 0.3, exit: 'back' } }, { type: 'straight', opts: { len: 0.3 }, slope: 14 * DEGR }, { type: 'straight', opts: { len: 0.1 }, slope: 3 * DEGR }) },
];
const userParts = () => store.get('bc.parts', []);
function partsHTML() {
  const mine = userParts();
  const card = (p, i, own) => `<button class="piece part" data-part="${own ? 'u' : 'b'}${i}" title="${esc(L('Drop it at the glowing ring'))}">${ICONS[p.icon] || ICONS.straight}<span>${esc(own ? p.name : L(p.name))}</span><span class="pl">${p.items.length}</span>${own ? `<span class="kb x" data-delpart="${i}">✕</span>` : ''}</button>`;
  return mine.map((p, i) => card(p, i, true)).join('') + BUILTIN_PARTS.map((p, i) => card(p, i, false)).join('') + (mine.length ? '' : `<span class="partsHint">${L('Select pieces (or right-click one) and choose ⭐ Save as part')}</span>`);
}
function partFromIds(ids) {
  const { kids, parentOf } = chainLinks();
  const roots = [...ids].filter(id => !ids.has(parentOf.get(id)?.id)).sort((a, b) => a - b);
  const root = roots.find(id => PIECES[pieces.find(p => p.id === id)?.type]?.kind === 'append' || pieces.find(p => p.id === id)?.type === 'bridge');
  if (root === undefined) { toast(L('Pick pieces that come after a Start Tower'), true); return null; }
  const items = [], idx = new Map(), queue = [[root, -1, 0]];
  while (queue.length) {
    const [id, par, out] = queue.shift();
    if (idx.has(id)) continue;
    const d = pieces.find(p => p.id === id);
    if (!d || d.type === 'bridge') continue;
    idx.set(id, items.length);
    items.push({ type: d.type, opts: { ...d.opts }, slope: d.slope, style: d.style, color: d.color, parent: par, out });
    for (const k of kids.get(id) || []) if (ids.has(k.id)) queue.push([k.id, idx.get(id), k.out]);
  }
  const first = pieces.find(p => p.id === root);
  return { items, icon: TOOLS[TYPE_TOOL[first.type]]?.icon || first.type };
}
function saveAsPart(ids) {
  const part = partFromIds(ids);
  if (!part) return;
  const name = window.prompt(L('Name this part:'), L('My part {0}', userParts().length + 1));
  if (name === null) return;
  const list = userParts();
  list.unshift({ name: name.trim().slice(0, 24) || L('My part'), icon: part.icon, items: part.items });
  while (list.length > 20) list.pop();
  store.set('bc.parts', list);
  S.tab = 'parts'; store.set('bc.tab', 'parts'); renderDock();
  toast(L('⭐ Saved to My parts'));
}
function pastePart(items) {
  const ap = activePort();
  if (!ap) { toast(L('First place a 📍 Start Tower'), true); sound.error(); return false; }
  let id = S.nextId;
  const made = [], built = [], others = [...insts.values()];
  const cleanup = () => built.forEach(b => disposeGroup(b.group));
  for (const it of items) {
    const port = it.parent < 0 ? ap.port : built[it.parent]?.outs[it.out];
    if (!port) { cleanup(); return false; }
    const d = { id: id++, type: it.type, port: portToData(port), slope: it.slope, style: it.style || S.style, color: it.color && S.color !== 'rainbow' ? resolveColor() : nextColor(), opts: { ...PIECES[it.type].defaults, ...it.opts } };
    if (d.type === 'loop' || d.type === 'drop') d.style = it.style || d.style;
    const inst = buildPiece(d);
    const reason = validatePiece(inst, others.concat(built), room.colliders);
    if (reason) { showBump(false); disposeGroup(inst.group); cleanup(); toast(L(reason), true); sound.error(); return false; }
    built.push(inst); made.push(d);
  }
  cleanup();
  S.nextId = id;
  sync(pieces.concat(made), { activeFrom: made[made.length - 1].id });
  pushHistory();
  made.forEach(d => insts.get(d.id) && popIn(insts.get(d.id).group));
  sound.place();
  afterBuild();
  return true;
}

// ---------------------------------------------------------------- paint tool
function paintAt(id, whole) {
  const ids = whole ? component(id) : new Set([id]);
  let changed = false;
  const list = pieces.map(p => {
    if (!ids.has(p.id) || painting.done.has(p.id) || p.locked) return p;
    painting.done.add(p.id); changed = true;
    return { ...p, color: nextColor() };
  });
  if (changed) { sync(list); painting.changed = true; sound.click(); }
}

// ---------------------------------------------------------------- show what a piece bumps into
const bumpGroup = new THREE.Group(); scene.add(bumpGroup);
const bumpMat = new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.32, depthWrite: false, depthTest: false });
let bumpT = 0;
function clearBump() { bumpGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); }); bumpGroup.clear(); bumpT = 0; }
function showBump(persist) {
  clearBump();
  const h = validatePiece.hit;
  if (!h || !h[1]) return;
  const [oid, p] = h;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), bumpMat); dot.position.copy(p); dot.renderOrder = 11;
  bumpGroup.add(dot);
  const addBox = (box) => { const s = box.getSize(V()), c = box.getCenter(V()); const m = new THREE.Mesh(new THREE.BoxGeometry(s.x + 0.012, s.y + 0.012, s.z + 0.012), bumpMat); m.position.copy(c); m.renderOrder = 11; bumpGroup.add(m); };
  if (oid != null && insts.has(oid)) {
    const inst = insts.get(oid), box = new THREE.Box3();
    for (const c of inst.group.children) if (c !== inst.pillars && !c.isSprite) box.expandByObject(c);
    addBox(box);
  } else {
    let best = null, bv = Infinity;
    for (const m of room.solids) {
      const b = new THREE.Box3().setFromObject(m), size = b.getSize(V());
      if (size.x > 2.5 || size.z > 2.5 || !b.clone().expandByScalar(0.03).containsPoint(p)) continue;
      const vol = size.x * size.y * size.z;
      if (vol < bv) { bv = vol; best = b; }
    }
    if (best) addBox(best);
  }
  bumpT = persist ? Infinity : 1.8;
}

// ---------------------------------------------------------------- see through furniture in the way
S.seeThrough = store.get('bc.seeThrough', true);
const fade = new Map();
let stT = 0;
function seeThrough(now) {
  if (now - stT > 120) {
    stT = now;
    const want = new Set();
    if (S.seeThrough && S.cam === 'orbit' && !S.replay) {
      const targets = [controls.target.clone()];
      if (S.ringInfo) targets.push(S.ringInfo.p);
      if (S.selected && insts.has(S.selected)) targets.push(S.selAnchor);
      for (const t of targets) {
        const dir = t.clone().sub(camera.position), len = dir.length();
        if (len < 0.1) continue;
        occRay.set(camera.position, dir.divideScalar(len)); occRay.far = len - 0.04;
        for (const h of occRay.intersectObjects(room.solids, false)) {
          const m = h.object;
          if (m.userData.surface === 'floor' || m.userData.noFade || !m.material) continue;
          want.add(m);
        }
      }
    }
    for (const m of want) if (!fade.has(m)) {
      const orig = m.material, mats = [].concat(orig).map(x => { const c = x.clone(); c.transparent = true; c.depthWrite = false; return c; });
      m.material = Array.isArray(orig) ? mats : mats[0];
      fade.set(m, { orig, mats, k: 1 });
    }
    for (const [m, f] of fade) f.want = want.has(m);
  }
  for (const [m, f] of fade) {
    f.k += ((f.want ? 0.22 : 1) - f.k) * 0.15;
    for (const x of f.mats) x.opacity = f.k;
    if (!f.want && f.k > 0.97) { m.material = f.orig; f.mats.forEach(x => x.dispose()); fade.delete(m); }
  }
}
function unfadeAll() { for (const [m, f] of fade) { m.material = f.orig; f.mats.forEach(x => x.dispose()); } fade.clear(); }

// ---------------------------------------------------------------- height labels along the track
S.heights = store.get('bc.heights', false);
const heightGroup = new THREE.Group(); scene.add(heightGroup);
const labelTex = new Map();
function heightTexture(text) {
  if (!labelTex.has(text)) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 48;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(43,45,66,0.85)'; g.beginPath(); g.roundRect(4, 4, 120, 40, 18); g.fill();
    g.fillStyle = '#ffc83d'; g.font = '600 26px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 25);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    labelTex.set(text, t);
  }
  return labelTex.get(text);
}
function refreshHeights() {
  for (const s of heightGroup.children) s.material.dispose();
  heightGroup.clear();
  if (!S.heights) return;
  for (const inst of insts.values()) for (const path of inst.paths) {
    const sm = path.samples, total = sm[sm.length - 1].s;
    for (let s = Math.min(0.05, total / 2); s < total; s += 0.2) {
      const q = sm.reduce((a, c) => Math.abs(c.s - s) < Math.abs(a.s - s) ? c : a);
      probeRay.set(q.p.clone().add(V(0, -0.03, 0)), V(0, -1, 0)); probeRay.far = 3;
      const hit = probeRay.intersectObjects(room.solids, false)[0];
      const hgt = q.p.y - (hit ? hit.point.y : 0);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: heightTexture(`${Math.round(hgt * 100)} ${L('cm')}`), depthTest: false, transparent: true }));
      sp.scale.set(0.05, 0.019, 1); sp.position.copy(q.p).add(V(0, 0.034, 0)); sp.renderOrder = 6; sp.raycast = () => {};
      heightGroup.add(sp);
    }
  }
}

// ---------------------------------------------------------------- the height bar while placing
function surfaceMarks() {
  if (surfaceMarks.room === room) return surfaceMarks.list;
  const list = [];
  for (const m of room.placeables) {
    const y = new THREE.Box3().setFromObject(m).max.y;
    if (y < 0.03 || list.some(x => Math.abs(x.y - y) < 0.04)) continue;
    list.push({ y, name: m.userData.surface || '' });
  }
  surfaceMarks.room = room; surfaceMarks.list = list.sort((a, b) => a.y - b.y);
  return surfaceMarks.list;
}
function updateHeightBar(y, onSurf) {
  const el = $('heightBar');
  if (y === null) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const top = Math.max(1.0, y + 0.15), px = (v) => (1 - v / top) * 100;
  el.innerHTML = surfaceMarks().map(s => `<span class="mk" style="top:${px(s.y)}%">${s.name ? L(s.name) + ' ' : ''}${Math.round(s.y * 100)}</span>`).join('') +
    `<span class="mk floor" style="top:100%">0</span><span class="now" style="top:${px(y)}%">${Math.round(y * 100)} ${L('cm')}</span><span class="base" style="top:${px(onSurf)}%"></span>`;
}

// ---------------------------------------------------------------- camera follows the building
S.camFollow = store.get('bc.camFollow', false);
let tourAdded = false;
function afterBuild() {
  tourAdded = true;
  padUntil = performance.now() + 6000;
  const n = store.get('bc.placed', 0) + 1; store.set('bc.placed', n);
  if (n >= 50) sticker('builder');
  visitors.noteBuild();
  if (!S.camFollow || S.cam !== 'orbit') return;
  const ap = activePort();
  if (!ap) return;
  _v.copy(ap.port.p).project(camera);
  if (Math.abs(_v.x) < 0.55 && Math.abs(_v.y) < 0.5) return;
  const off = camera.position.clone().sub(controls.target), t = controls.target.clone().lerp(ap.port.p, 0.7);
  flyTo(t.clone().add(off), t);
}

// ---------------------------------------------------------------- Finish it / Fix it
let thinking = false;
const simEnv = () => ({ g: world.g, rho: world.rho, assist: world.assist, roomColliders: room.colliders, roomWater: room.water || [] });
async function runFinishIt() {
  if (thinking) return;
  const ap = activePort();
  if (!ap) { toast(L('First place a 📍 Start Tower'), true); sound.error(); return; }
  thinking = true;
  toast(L('✨ Thinking…'));
  try {
    const targets = [];
    for (const inst of insts.values()) {
      if (!['basket', 'catcher', 'pool'].includes(inst.d.type)) continue;
      const goal = inst.devices.find(dv => dv.c && dv.yTop !== undefined);
      if (goal) targets.push({ p: V(goal.c.x, goal.yTop, goal.c.z), r: inst.B.radius || 0.07 });
      else if (inst.B.water) { const w = inst.B.water[0]; targets.push({ p: V(w.cx, w.surf, w.cz), r: Math.min(w.max.x - w.min.x, w.max.z - w.min.z) / 2 }); }
    }
    const res = await finishIt({ port: ap.port, make: (k, extra) => makeData(k, extra), others: [...insts.values()], env: simEnv(), ball: S.ballType, targets, pieces, nextId: S.nextId, secs: 45 });
    if (!res) { toast(L("Couldn't find a way into a goal from here — try another ring"), true); sound.error(); return; }
    S.nextId = res.nextId;
    sync(pieces.concat(res.added), { activeFrom: res.added[res.added.length - 1].id });
    pushHistory();
    res.added.forEach(d => insts.get(d.id) && popIn(insts.get(d.id).group));
    sound.fanfare();
    toast(res.added.length === 1 ? L('✨ Finished with one piece! (Ctrl+Z to undo)') : L('✨ Finished with {0} pieces! (Ctrl+Z to undo)', res.added.length));
    afterBuild();
  } finally { thinking = false; }
}
async function runFixIt() {
  if (thinking) return;
  const R = pred.runs.find(r => r.done && ['floor', 'lost', 'stuck'].includes(r.outcome));
  if (!R) { toast(L('No trouble spot to fix right now 👍')); return; }
  thinking = true;
  toast(L('🔧 Looking for a fix…'));
  try {
    const res = await fixIt({
      pieces, spot: (R.trouble || R.lastTrack).clone(), env: simEnv(), ball: S.ballType, outcome: R.outcome,
      base: { outcome: R.outcome, lastT: R.floorT ?? R.t ?? 0 }, secs: Math.min(50, (R.t || 10) + 15), branch: null,
      parentOf: (id) => { const p = chainLinks().parentOf.get(id); return p ? pieces.find(x => x.id === p.id) : null; },
      reflowFrom: (list, id) => { const r = reflow(list, id, chainLinks().kids); return { list: r.list, reason: chainProblem(r.list, r.order) }; },
      insertBefore: (id, toolKey, opts) => {
        const par = chainLinks().parentOf.get(id);
        if (!par) return null;
        const plan = planInsertAt({ parent: par.id, out: par.out }, toolKey, opts);
        return plan && !plan.reason ? { list: plan.list } : null;
      },
    });
    if (!res) { toast(L("Couldn't find a fix — try a different piece there"), true); sound.error(); return; }
    sync(res.list); pushHistory(); sound.place();
    toast('🔧 ' + L(res.msg) + ' — ' + L(res.solved ? 'it works now!' : 'it gets further now'));
  } finally { thinking = false; }
}

// ---------------------------------------------------------------- right-click menu on a piece
let rDown = null, pressT = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 2) rDown = { x: e.clientX, y: e.clientY };
  if (e.pointerType === 'touch') {
    clearTimeout(pressT);
    const x = e.clientX, y = e.clientY;
    pressT = setTimeout(() => { setMouse({ clientX: x, clientY: y }); const pp = pickPiece(); if (pp) { down = null; openCtx(pp.id, x, y); } }, 600);
  }
});
canvas.addEventListener('pointermove', (e) => { if (pressT && e.pointerType === 'touch') { clearTimeout(pressT); pressT = null; } });
canvas.addEventListener('pointerup', () => { clearTimeout(pressT); pressT = null; });
canvas.addEventListener('contextmenu', (e) => {
  if (S.cam !== 'orbit' || S.replay || S.photo) return;
  if (rDown && Math.hypot(e.clientX - rDown.x, e.clientY - rDown.y) > 6) return;
  setMouse(e);
  const pp = pickPiece();
  if (pp) openCtx(pp.id, e.clientX, e.clientY);
});
function openCtx(id, x, y) {
  const d = pieces.find(p => p.id === id);
  if (!d) return;
  select(id);
  $('selPop').classList.add('hidden'); // the menu takes its place for now
  const m = $('ctxMenu'), own = openOuts.find(o => o.id === id), hasKids = chainLinks().kids.has(id), info = insight.pieceInfo(id);
  const item = (k, label, ok = true) => ok ? `<button data-ctx="${k}">${label}</button>` : '';
  m.innerHTML = `<div class="ctxHd">${ICONS[pieceIcon(d)] || ''}<b>${esc(pieceLabel(d))}</b></div>` + (info ? `<div class="ctxInfo">${info}</div>` : '') +
    item('insert', '⤵ ' + L('Insert after'), hasKids && !d.locked) + item('build', '➕ ' + L('Build from here'), !!own) +
    item('paint', '🎨 ' + L('Paint with the current color'), !d.locked) + item('mirror', '🪞 ' + L('Mirror (from here on)'), !d.locked && PIECES[d.type].kind !== 'place') +
    item('part', '⭐ ' + L('Save as part (from here on)'), PIECES[d.type].kind === 'append') + item('dup', '📋 ' + L('Copy to the ring (from here on)'), PIECES[d.type].kind === 'append') +
    item('move', '✥ ' + L('Move'), PIECES[d.type].kind === 'place' && !d.locked) + item('del', '🗑 ' + L('Delete'), !d.locked);
  m.classList.remove('hidden');
  m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 8) + 'px';
  m.onclick = (e) => {
    const b = e.target.closest('[data-ctx]');
    if (!b) return;
    closeMenus();
    const k = b.dataset.ctx, after = () => { const ids = new Set([id]), { kids } = chainLinks(), q = [id]; while (q.length) for (const c of kids.get(q.shift()) || []) if (!ids.has(c.id)) { ids.add(c.id); q.push(c.id); } return ids; };
    if (k === 'insert') startInsert(id);
    if (k === 'build') { S.active = own.key; S.insert = null; select(null); drawMarkers(); renderDock(); }
    if (k === 'paint') { sync(pieces.map(p => p.id === id ? { ...p, color: nextColor() } : p)); pushHistory(); }
    if (k === 'mirror') mirrorIds(after());
    if (k === 'part') saveAsPart(after());
    if (k === 'dup') { const part = partFromIds(after()); if (part) pastePart(part.items); }
    if (k === 'move') startMove(id);
    if (k === 'del') deletePiece(id);
    sound.click();
  };
}

// ---------------------------------------------------------------- piece previews in the dock
const MOTION = {
  straight: 'M15 60 H117', curveL: 'M24 84 V66 A42 42 0 0 1 66 24 H108', curveR: 'M108 84 V66 A42 42 0 0 0 66 24 H24',
  helixL: 'M30 14 H102 L30 44 H102 L30 74 H102', helixR: 'M102 14 H30 L102 44 H30 L102 74 H30', drop: 'M66 6 V92',
  loop: 'M8 86 H50 A28 28 0 1 1 52 86 H124', jump: 'M10 80 L58 62 Q92 0 126 48', lift: 'M66 92 V8', screw: 'M66 92 V8', elevator: 'M60 92 V8',
  funnel: 'M18 28 A48 18 0 1 1 114 30 A36 13 0 1 1 30 34 A24 9 0 1 1 90 38 V92', default: 'M18 88 Q42 14 66 88 Q90 30 114 88',
};
let tipTimer = null;
$('dockPieces').addEventListener('mouseover', (e) => {
  const b = e.target.closest('.piece[data-tool]');
  clearTimeout(tipTimer);
  if (!b) { $('pieceTip').classList.add('hidden'); return; }
  tipTimer = setTimeout(() => showTip(b), 350);
});
$('dockPieces').addEventListener('mouseleave', () => { clearTimeout(tipTimer); $('pieceTip').classList.add('hidden'); });
function showTip(btn) {
  const t = TOOLS[btn.dataset.tool];
  if (!t || drag) return;
  const el = $('pieceTip');
  el.innerHTML = `<div class="tipArt">${ICONS[t.icon]}<span class="tipBall" style="offset-path:path('${MOTION[t.icon] || MOTION.default}')"></span></div><b>${L(t.label)}</b><p>${L(t.desc)}</p>`;
  el.classList.remove('hidden');
  const r = btn.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, r.left + r.width / 2 - el.offsetWidth / 2)) + 'px';
  el.style.top = (r.top - el.offsetHeight - 12) + 'px';
}

// ---------------------------------------------------------------- the undo list
let histLabels = [];
function diffLabel(a, b) {
  const A = new Map(a.map(p => [p.id, p])), B = new Map(b.map(p => [p.id, p]));
  const added = b.filter(p => !A.has(p.id)), removed = a.filter(p => !B.has(p.id));
  const name = (d) => { try { return pieceLabel(d); } catch (e) { return d.type; } };
  if (added.length === 1 && !removed.length) return '➕ ' + name(added[0]);
  if (added.length > 1) return '➕ ' + L('{0} pieces', added.length);
  if (removed.length === 1 && !added.length) return '🗑 ' + name(removed[0]);
  if (removed.length > 1) return '🗑 ' + L('{0} pieces', removed.length);
  const changed = b.filter(p => A.has(p.id) && JSON.stringify(A.get(p.id)) !== JSON.stringify(p));
  if (changed.length) return '✏️ ' + name(changed[0]) + (changed.length > 1 ? ` +${changed.length - 1}` : '');
  return '•';
}
$('btnHist').onclick = () => openMenu($('histMenu'), $('btnHist'), m => {
  const rows = [];
  for (let i = history.length - 1; i >= Math.max(0, history.length - 15); i--) rows.push(`<button data-h="${i}" class="${i === hIdx ? 'on' : ''}${i > hIdx ? ' undone' : ''}">${esc(histLabels[i] || '•')}</button>`);
  m.innerHTML = rows.join('') || `<span class="muted small">${L('Nothing yet')}</span>`;
});
$('histMenu').onclick = (e) => { const b = e.target.closest('[data-h]'); if (!b) return; hIdx = +b.dataset.h; sync(JSON.parse(history[hIdx])); closeMenus(); sound.click(); };

// ---------------------------------------------------------------- rooms
const roomKey = (k) => k === 'kids' ? 'ballcoaster.v2' : 'ballcoaster.v2.' + k;
function switchRoom(kind, opts = {}) {
  if (kind === room.kind) return;
  if (S.challenge && !opts.keepChallenge) exitChallenge();
  save();
  stopReplay(); setCam('orbit');
  clearBalls(); clearGhost(); select(null); S.multi.clear(); renderMulti(); unfadeAll(); clearBump();
  room.dispose();
  room = buildRoomKind(scene, kind);
  store.set('bc.room', kind);
  movie.bounds = room.bounds;
  sunDir = room.sun.position.clone().sub(room.sun.target.position).normalize();
  room.setNight(S.night);
  contactShadows();
  S.name = store.get('bc.name.' + kind, '');
  history = []; histLabels = []; hIdx = -1;
  const saved = store.get(roomKey(kind), null);
  sync(saved && Array.isArray(saved.pieces) ? saved.pieces : kind === 'kids' ? buildDemo() : []);
  pushHistory(); assembleIn();
  insight.roomChanged(); visitors.roomChanged();
  const seen = new Set(store.get('bc.visitedRooms', [])); seen.add(kind); store.set('bc.visitedRooms', [...seen]);
  if (seen.size >= ROOM_KINDS.length) sticker('rooms');
  fitView(true);
  const info = roomInfo(kind);
  toast(`${info.icon} ${L(info.name)}`);
  if (!pieces.length) { S.tool = 'start'; renderDock(); renderSettings(); }
}
function openRooms() {
  closeMenus();
  const stars = starStore();
  $('roomsList').innerHTML = ROOM_KINDS.map(r => {
    const n = CHALLENGES.filter(c => (c.room || 'kids') === r.kind).reduce((a, c) => a + (stars[c.id] || 0), 0);
    return `<button class="roomCard${r.kind === room.kind ? ' here' : ''}" data-room="${r.kind}"><span class="big">${r.icon}</span><b>${L(r.name)}</b><span class="small muted">★ ${n}</span>${r.kind === room.kind ? `<span class="tag">${L('You are here')}</span>` : ''}</button>`;
  }).join('');
  $('roomsModal').classList.remove('hidden');
}
$('roomsList').onclick = (e) => { const b = e.target.closest('[data-room]'); if (!b) return; closeModals(); switchRoom(b.dataset.room); };

// ---------------------------------------------------------------- share links and the gallery
async function copyShareLink() {
  closeMenus();
  const url = await shareLink({ app: 'ball-coaster', v: SAVE_V, room: room.kind, name: S.name, pieces: pieces.filter(p => !p.locked) });
  try { await navigator.clipboard.writeText(url); toast(L('🔗 Link copied — send it to a friend!')); }
  catch (e) { window.prompt(L('Copy this link:'), url); }
}
async function checkSharedLink() {
  const code = linkCode();
  if (!code) return;
  window.history.replaceState(null, '', location.pathname + location.search);
  try {
    const data = await decodeCoaster(code);
    const pz = data.puzzle;
    // a puzzle to solve, a friend's solution to watch, or just a coaster
    $('sharedMsg').textContent = pz && !pz.solved ? L('🧩 A puzzle from a friend: “{0}”. Finish the run with the pieces in the box!', data.name || L('A puzzle'))
      : pz ? L('🧩 Your friend solved “{0}”! Open it to watch their solution?', data.name || L('your puzzle'))
      : L('“{0}” — {1} pieces. Open it here? Your own coaster is kept in My coasters.', data.name || L('A coaster'), data.pieces.length);
    $('sharedModal').classList.remove('hidden');
    $('sharedOpen').onclick = () => {
      closeModals();
      if (pz && !pz.solved) { saveMine(); play.startPuzzle(data); return; }
      openCoaster(data, true);
      if (pz) setTimeout(() => releaseAll(), 1600);
    };
  } catch (e) { toast(L("That share link didn't work"), true); }
}
// before something else takes over the room, the player's own coaster goes into My coasters
function saveMine() {
  if (S.challenge || !pieces.some(p => !p.locked)) return;
  renderFrame();
  gallery.save({ id: 'g' + Date.now(), name: (S.name || L('My coaster')) + ' ⟲', room: room.kind, pieces: pieces.filter(p => !p.locked), thumb: thumbnail(renderer.domElement), t: Date.now() });
}
function openCoaster(data, keepMine) {
  if (S.challenge) exitChallenge();
  if (keepMine) saveMine();
  switchRoom(roomKindOk(data.room || 'kids'));
  clearBalls(); S.selected = null;
  sync(migratePieces(data.pieces, data.v ?? SAVE_V));
  pushHistory(); assembleIn();
  setName(data.name || '');
  fitView();
  toast(L('Loaded! ✨'));
}
const EXAMPLES = [
  { name: 'Demo coaster', icon: '🎢', desc: 'Lift, loop, xylophone and a jump', build: () => buildDemo() },
  { name: 'Gadget parade', icon: '⚙️', desc: 'Booster, sensor, brake, gate, photo booth and a screw lift', build: () => exampleGadgets() },
  { name: 'Splash zone', icon: '💦', desc: 'A dive into a water tub', build: () => exampleSplash() },
];
function chainBuild(steps, color0 = 0) {
  const list = [];
  let id = 1, port = null;
  for (const [type, o = {}] of steps) {
    const d = { id: id++, type, slope: +((o.slope ?? 3) * DEG).toFixed(5), style: o.style || 'channel', color: o.color || RAINBOW[(color0 + list.length) % RAINBOW.length], opts: Object.assign({}, PIECES[type].defaults, o.opts || {}) };
    d.port = o.port || portToData(port);
    list.push(d);
    const inst = buildPiece(d); disposeGroup(inst.group);
    port = inst.outs[0];
  }
  return list;
}
function exampleGadgets() {
  return chainBuild([
    ['start', { port: { x: -0.55, y: 0.0084, z: 0.55, psi: 0, phi: 0 }, opts: { height: 0.6 } }], ['straight', { opts: { len: 0.15 } }],
    ['sensor', { opts: { effect: 'confetti' } }], ['booster', { opts: { power: 1.2 } }], ['curve', { opts: { angle: 90, radius: 0.15, dir: -1 } }],
    ['brake', { opts: { len: 0.1, speed: 0.6 } }], ['gate', { opts: { mode: 'timer', interval: 1 } }], ['photo'], ['curve', { opts: { angle: 90, radius: 0.15, dir: -1 } }],
    ['straight', { opts: { len: 0.1 } }], ['screw', { opts: { height: 0.2, exit: 'back' } }], ['straight', { opts: { len: 0.25 }, slope: 7 }], ['xylo', { slope: 4 }], ['cup'],
  ]);
}
function exampleSplash() {
  const list = chainBuild([
    ['start', { port: { x: 0.25, y: 0.0084, z: 0.75, psi: Math.PI, phi: 0 }, opts: { height: 0.45 } }], ['straight', { opts: { len: 0.2 } }],
    ['curve', { opts: { angle: 90, radius: 0.15, dir: -1 } }], ['straight', { opts: { len: 0.3 }, slope: 14 }], ['straight', { opts: { len: 0.3 }, slope: 30 }], ['straight', { opts: { len: 0.1 }, slope: 0 }],
  ]);
  // the tub sits where the ball lands (worked out with the same physics)
  list.push({ id: list.length + 1, type: 'pool', port: { x: -0.168, y: 0.0084, z: -0.384, psi: 1.5708, phi: 0 }, slope: 0, style: 'channel', color: 'blue', opts: { size: 0.34, height: 0 } });
  return list;
}
function openGallery() {
  closeMenus();
  $('galName').value = S.name || '';
  renderGallery();
  $('galleryModal').classList.remove('hidden');
}
function renderGallery() {
  const list = gallery.list();
  $('galList').innerHTML = list.length ? list.map(e => `<div class="gcard"><img src="${e.thumb}" alt=""><b>${esc(e.name)}</b><span class="small muted">${roomInfo(e.room).icon} ${L('{0} pieces', e.pieces.length)}</span><div class="gbtns"><button data-gload="${e.id}">${L('Open')}</button><button data-gdel="${e.id}" class="del">🗑</button></div></div>`).join('') : `<p class="muted small">${L('Nothing saved yet — name your coaster and press Save.')}</p>`;
  $('galExamples').innerHTML = EXAMPLES.map((x, i) => `<button class="gcard ex" data-gex="${i}"><span class="big">${x.icon}</span><b>${L(x.name)}</b><span class="small muted">${L(x.desc)}</span></button>`).join('');
}
$('galSave').onclick = () => {
  const name = $('galName').value.trim() || L('My coaster');
  setName(name);
  renderFrame();
  gallery.save({ id: 'g' + Date.now(), name, room: room.kind, pieces: pieces.filter(p => !p.locked), thumb: thumbnail(renderer.domElement), t: Date.now() });
  renderGallery();
  toast(L('Saved to My coasters 💾'));
};
$('galList').onclick = (e) => {
  const l = e.target.closest('[data-gload]'), d = e.target.closest('[data-gdel]');
  if (l) { const g = gallery.list().find(x => x.id === l.dataset.gload); if (g) { closeModals(); openCoaster({ room: g.room, name: g.name, pieces: g.pieces, v: SAVE_V }, false); } }
  if (d) { gallery.remove(d.dataset.gdel); renderGallery(); }
};
$('galExamples').onclick = (e) => {
  const b = e.target.closest('[data-gex]');
  if (!b) return;
  const x = EXAMPLES[+b.dataset.gex];
  closeModals();
  openCoaster({ room: 'kids', name: L(x.name), pieces: x.build(), v: SAVE_V }, true);
};

// ---------------------------------------------------------------- the guided tour
// a first build you do yourself, step by step: watch a run, add a piece, watch it again
const TOUR = [
  { text: 'Welcome to Ball Coaster! Press ▶ Release to send a ball down the coaster.', at: '#btnRelease', wait: () => S.releases > tutor.mark },
  { text: 'The glowing ring is where your track goes next. Tap ＋ on its tag to open the build pad.', at: '#ringTag', wait: () => !$('buildPad').classList.contains('hidden') },
  { text: 'Pick a turn. A green ✓ means the ball will make it — try one!', at: '#buildPad', wait: () => tourAdded },
  { text: 'Now press ▶ Release again and watch your new piece.', at: '#btnRelease', wait: () => S.releases > tutor.mark },
  { text: 'Tap any piece to change it. More pieces are in the tabs below — and friends will drop by to try your coaster. Have fun!', at: '#dockTabs' },
];
const tutor = { on: false, i: 0, mark: 0 };
function startTour() { closeModals(); tutor.on = true; tutor.i = 0; tourAdded = false; showTourStep(); }
function endTour() { tutor.on = false; store.set('bc.tour', true); $('tutor').classList.add('hidden'); $('tutorArrow').classList.add('hidden'); }
function showTourStep() {
  const st = TOUR[tutor.i];
  if (!st) { endTour(); return; }
  tutor.mark = S.releases || 0; tourAdded = false;
  $('tutor').classList.remove('hidden');
  $('tutor').querySelector('.tb').innerHTML = `<small>${tutor.i + 1} / ${TOUR.length}</small> ${L(st.text)}`;
  $('tutorNext').textContent = tutor.i === TOUR.length - 1 ? L("Let's build! 🚀") : L('Next ▶');
  placeTutor();
}
function placeTutor() {
  const st = TOUR[tutor.i], el = $('tutor'), ar = $('tutorArrow');
  const target = st && st.at ? document.querySelector(st.at) : null;
  const r = target && !target.classList.contains('hidden') ? target.getBoundingClientRect() : null;
  $('tutorNext').disabled = !!(st && st.wait && !st.wait());
  if (!r || !r.width) { el.style.left = '50%'; el.style.top = '38%'; el.style.transform = 'translate(-50%, -50%)'; ar.classList.add('hidden'); return; }
  el.style.transform = 'none';
  const below = r.top < window.innerHeight / 2;
  const x = Math.max(10, Math.min(window.innerWidth - el.offsetWidth - 10, r.left + r.width / 2 - el.offsetWidth / 2));
  el.style.left = x + 'px';
  el.style.top = (below ? r.bottom + 44 : r.top - el.offsetHeight - 44) + 'px';
  ar.classList.remove('hidden');
  ar.textContent = below ? '👆' : '👇';
  ar.style.left = (r.left + r.width / 2 - 14) + 'px';
  ar.style.top = (below ? r.bottom + 4 : r.top - 38) + 'px';
}
$('tutorNext').onclick = () => { sound.click(); tutor.i++; showTourStep(); };
$('tutorSkip').onclick = endTour;
let tourT = 0;
function tutorTick(now) {
  if (!tutor.on || now - tourT < 250) return;
  tourT = now;
  const st = TOUR[tutor.i];
  if (st && st.wait && st.wait() && $('tutorNext').disabled) { tutor.i++; showTourStep(); return; }
  placeTutor();
}

// ---------------------------------------------------------------- little physics tips
const TIPS = [
  'A rolling ball turns part of its energy into spin — that is why it speeds up slower than a sliding block.',
  'Faster balls need smaller hills to fly. Try a Jump Ramp after a steep dive!',
  'Hollow plastic balls feel the air the most — try Syrup air in the 🧪 Lab.',
  'Glass tubes keep balls from flying out of tight turns.',
  'Wood and hollow plastic float, glass and clay sink — try a Water Tub!',
  'On the Moon (🧪 Lab ▸ Gravity) everything becomes floaty slow-motion.',
  'Brakes comb fast balls down to a calm speed — great before a tight turn.',
  'Gates let one ball through at a time: no more traffic jams.',
  'Put decorations near the track — the Toy Critics love a nice view.',
  'Near misses — a ball rushing just under another track — are extra fun.',
  'A spiral that is too long makes everyone dizzy. Mix in some straight runs!',
  'Right-click a piece for more: insert after it, mirror, copy, save as a part.',
  'Drag a piece’s orange handle to stretch it. Hold Shift to change its slope.',
];
let tipAt = performance.now() + 150000;
function tipsTick(now) {
  if (now < tipAt || S.replay || S.photo || tutor.on || !quiet(15000)) return;
  tipAt = now + 170000;
  insight.news('💡', L(TIPS[Math.floor(Math.random() * TIPS.length)]));
}

// ---------------------------------------------------------------- options in the ⋯ menu
S.pro = store.get('bc.pro', false);
const OPTS = {
  visitors: { get: () => visitors.enabled, set: (v) => visitors.setEnabled(v) },
  arrows: { get: () => S.arrows, set: (v) => { S.arrows = v; } },
  ghostBall: { get: () => S.ghostBall, set: (v) => { S.ghostBall = v; } },
  seeThrough: { get: () => S.seeThrough, set: (v) => { S.seeThrough = v; } },
  camFollow: { get: () => S.camFollow, set: (v) => { S.camFollow = v; } },
  heights: { get: () => S.heights, set: (v) => { S.heights = v; refreshHeights(); } },
  pro: { get: () => S.pro, set: (v) => { S.pro = v; renderSelPop(); } },
  haptics: { get: () => S.haptics, set: (v) => { S.haptics = v; buzz(20); } },
  lite: { get: () => S.lite, set: (v) => setLite(v) },
  fps: { get: () => S.fps, set: (v) => { S.fps = v; $('fpsMeter').classList.toggle('hidden', !v); } },
};
$('optHaptics').classList.toggle('hidden', !(navigator.vibrate && touchScreen()));

// ---------------------------------------------------------------- Lite mode and the frame-time meter
// Lite: fewer pixels, no shadows or night glow, and a third of the prediction work per frame
S.lite = store.get('bc.lite', false); S.fps = store.get('bc.fps', false);
function setLite(on) {
  S.lite = on;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, on ? 1.25 : 2));
  renderer.shadowMap.enabled = !on;
  scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
  resize();
}
const frameStat = { avg: 16, shown: 0, slowFor: 0, offered: store.get('bc.liteOffered', false) };
function frameStatTick(dt, now) {
  frameStat.avg += (dt * 1000 - frameStat.avg) * 0.05;
  if (S.fps && now - frameStat.shown > 400) { frameStat.shown = now; $('fpsMeter').textContent = `${frameStat.avg.toFixed(1)} ms · ${Math.round(1000 / frameStat.avg)} fps${S.lite ? ' · 🪶' : ''}`; }
  // a struggling device gets one gentle suggestion
  frameStat.slowFor = frameStat.avg > 45 && !document.hidden ? frameStat.slowFor + dt : 0;
  if (!S.lite && !frameStat.offered && frameStat.slowFor > 8) {
    frameStat.offered = true; store.set('bc.liteOffered', true);
    insight.news('🪶', L('Running slowly? Tap here for Lite mode'), null, () => { setLite(true); store.set('bc.lite', true); syncOptions(); });
  }
}
function syncOptions() { document.querySelectorAll('[data-opt]').forEach(b => b.classList.toggle('on', !!OPTS[b.dataset.opt].get())); }
document.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => {
  const o = OPTS[b.dataset.opt], v = !o.get();
  o.set(v); store.set('bc.' + b.dataset.opt, v);
  syncOptions(); sound.click();
}));
$('btnRooms').onclick = openRooms;
$('btnGallery').onclick = () => openGallery();
$('btnAlbum').onclick = openAlbum;
$('btnShare').onclick = copyShareLink;
$('btnVisit').onclick = () => { closeModals(); visitors.callNow(); };
$('btnPuzzle').onclick = () => play.openMaker();
$('btnSettings').onclick = () => { closeMenus(); syncOptions(); $('settingsModal').classList.remove('hidden'); };
$('btnTour').onclick = () => { closeMenus(); startTour(); };

// ---------------------------------------------------------------- soft contact shadows under everything that stands on the floor
const aoGroup = new THREE.Group(); scene.add(aoGroup);
let aoTex = null;
function contactShadows() {
  aoGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  aoGroup.clear();
  if (!aoTex) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    gr.addColorStop(0, 'rgba(46,34,52,0.38)'); gr.addColorStop(0.55, 'rgba(46,34,52,0.17)'); gr.addColorStop(1, 'rgba(46,34,52,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    aoTex = new THREE.CanvasTexture(c); aoTex.colorSpace = THREE.SRGBColorSpace;
  }
  const mat = new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  for (const m of room.solids) {
    if (m.userData.surface === 'floor') continue;
    const b = new THREE.Box3().setFromObject(m), s = b.getSize(V());
    if (b.min.y > 0.03 || s.y < 0.035 || s.x > 2.4 || s.z > 2.4 || s.x * s.z < 0.0003) continue;
    const pad = Math.min(0.09, 0.3 * Math.max(s.x, s.z)) + 0.015;
    const geo = new THREE.PlaneGeometry(s.x + pad * 2, s.z + pad * 2); geo.rotateX(-Math.PI / 2);
    const blob = new THREE.Mesh(geo, mat);
    blob.position.set((b.min.x + b.max.x) / 2, Math.max(0.0012, b.min.y + 0.0012), (b.min.z + b.max.z) / 2);
    blob.renderOrder = 1; blob.raycast = () => {};
    aoGroup.add(blob);
  }
}
// a ring that pops out where a piece snaps on
const snaps = [];
const snapGeo = new THREE.TorusGeometry(0.024, 0.0035, 8, 32);
function snapFx(p) {
  if (!reduceMotion()) {
    const m = new THREE.Mesh(snapGeo, new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, depthWrite: false }));
    m.position.copy(p); m.quaternion.copy(camera.quaternion); m.renderOrder = 9;
    fxGroup.add(m); snaps.push({ m, t: 0 });
  }
  sparkle(p, '#ffd23f', 6);
}
function glowBrief(group) {
  setHighlight(group, true, '#ffe08a', 0.45);
  setTimeout(() => { if (group !== hiGroup && !multiHi.includes(group)) setHighlight(group, false); }, 420);
}
let hoverId = null, hoverGroup = null;
function hoverPiece(id) {
  if (id === hoverId) return;
  if (hoverGroup && hoverGroup !== hiGroup && !multiHi.includes(hoverGroup)) setHighlight(hoverGroup, false);
  hoverId = id; hoverGroup = null;
  const inst = id != null && insts.get(id);
  if (!inst || inst.group === hiGroup || multiHi.includes(inst.group)) return;
  hoverGroup = inst.group;
  setHighlight(hoverGroup, true, S.tool === 'erase' ? '#ff4d4d' : S.tool === 'paint' ? (COLORS[resolveColor()] || '#ffd36b') : '#ffd36b', S.tool === 'erase' ? 0.5 : 0.2);
}
canvas.addEventListener('pointerleave', () => hoverPiece(null));

// ---------------------------------------------------------------- every frame
function everyFrame(dt, adv, now) {
  // a blocked piece pulses, so it reads as "no" without relying on red alone
  ghostMats.bad.opacity = reduceMotion() ? 0.3 : 0.28 + 0.16 * Math.sin(now * 0.012);
  frameStatTick(dt, now);
  feel.finaleTick(now, dt);
  feel.energyTick();
  for (let i = snaps.length - 1; i >= 0; i--) {
    const s = snaps[i]; s.t += dt;
    const k = s.t / 0.45;
    s.m.scale.setScalar(1 + k * 1.6); s.m.material.opacity = Math.max(0, 1 - k);
    if (k >= 1) { fxGroup.remove(s.m); s.m.material.dispose(); snaps.splice(i, 1); }
  }
  insight.updateGhost(dt);
  visitors.update(dt, adv);
  if (showT < 3) { showT += dt; showLight.color.setHSL((showT * 1.3) % 1, 1, 0.6); showLight.intensity = 3 * Math.exp(-showT * 1.1) * (0.65 + 0.35 * Math.sin(showT * 22)); if (showT >= 3) showLight.intensity = 0; }
  if (bumpT !== Infinity && bumpT > 0) { bumpT -= dt; if (bumpT <= 0) clearBump(); }
  bumpMat.opacity = 0.25 + 0.15 * Math.sin(now * 0.012);
  for (const h of handleGroup.children) { h.children[0].lookAt(camera.position); h.scale.setScalar(1 + 0.12 * Math.sin(now * 0.008)); }
  seeThrough(now);
  positionBuildPad();
  jamCheck(now);
  tutorTick(now);
  tipsTick(now);
}
function afterSync() {
  _ptsFor = null;
  hoverId = null; hoverGroup = null;
  refreshHandles();
  refreshHeights();
  refreshSigns();
  if (S.multi.size) renderMulti();
  play.refreshRemote();
  if (S.heat !== 'off' && !pred.running) insight.heat('off');
  if (S.win === 'coaster' && document.body.classList.contains('side-open')) renderCoasterTab();
}

// ================================================================ main loop
let lastT = performance.now(), simAcc = 0;
const _qd = new THREE.Quaternion(), _ax = V();
function loop(now) { requestAnimationFrame(loop); frame(now); }
function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - lastT) / 1000)); lastT = now;
  const simDt = S.paused || S.replay ? 0 : dt * S.timeScale * feel.finale.k;
  autoTick(simDt);
  simAcc += simDt;
  let steps = Math.floor(simAcc / DT);
  if (steps > 140) { steps = 140; simAcc = 0; } else simAcc -= steps * DT;
  const horizon = steps * DT + 0.004;
  for (const b of world.balls) { b.jnAcc = 0; if (!b.captured) world.refreshCandidates(b, horizon); }
  for (let i = 0; i < steps; i++) world.step(DT);
  const adv = steps * DT;
  if (adv > 0) rec.record(world, rotors(), S.follow && S.follow.id);

  camPos.copy(camera.position);
  const roll = {};
  for (let i = world.balls.length - 1; i >= 0; i--) {
    const b = world.balls[i];
    if (adv > 0) {
      const sp = b.vel.length();
      if (b.collected) b.popT = (b.popT || 0) + dt;
      if (!b.captured && sp < 0.012 && b.onRoomFloor) b.still += adv; else b.still = 0;
      if (b.pos.y < -0.3 || Math.abs(b.pos.x) > 3 || Math.abs(b.pos.z) > 3) b.dead = true;
      const st = b.stats;
      st.maxSpeed = Math.max(st.maxSpeed, sp);
      st.dist += b.pos.distanceTo(b.lastPos);
      b.lastPos.copy(b.pos);
      const touching = world.time - b.lastTouch < 0.04;
      if (!touching && !b.captured) st.air += adv;
      const fg = b.captured ? 1 : b.jnAcc / (b.m * world.g * adv);
      b.feltG += (fg - b.feltG) * Math.min(1, adv * 25);
      if (!b.captured && touching) st.maxG = Math.max(st.maxG, b.feltG);
      // challenge tracking: flights, loops, flying over Teddy
      const ch = b.ch;
      if (ch) {
        if (world.time - b.lastTouch > 0.02 && !b.captured) ch.air += adv; else { ch.maxAir = Math.max(ch.maxAir, ch.air); ch.air = 0; }
        if (b.tkCol && b.tkCol.pieceType === 'loop' && world.time - b.tkT < 0.05 && b.normal.y < -0.4) ch.loop = true;
        if (room.teddy && !touching && Math.hypot(b.pos.x - room.teddy.x, b.pos.z - room.teddy.z) < 0.17 && b.pos.y > room.teddy.y + 0.03) { ch.teddy = true; C.teddy = true; }
      }
      // rolling sound by surface
      if (touching && !b.captured && sp > 0.02) {
        const fam = ROLL_FAMILY[b.surf?.sound] || 'wood';
        const d = b.pos.distanceTo(camPos), wgt = sp / (1 + d * d * 4);
        const R = roll[fam] || (roll[fam] = { level: 0, speed: 0, w: 0 });
        R.level += wgt * 0.25 * (b.type === 'clay' ? 0.3 : 1) * (b.type === 'rubber' ? 0.6 : 1); R.speed += sp * wgt; R.w += wgt;
      }
      // spin the mesh by the angular velocity
      const wl = b.w.length();
      if (wl > 1e-6) { _qd.setFromAxisAngle(_ax.copy(b.w).divideScalar(wl), wl * adv); b.quat.premultiply(_qd); }
    }
    b.mesh.position.copy(b.pos);
    b.mesh.quaternion.copy(b.quat);
    b.mesh.visible = !(S.cam === 'pov' && b === S.follow);
    if (b.collected) b.mesh.scale.setScalar(Math.max(0.01, 1 - (b.popT || 0) * 3));
    updateTrail(b);
    if (b.dead || (b.collected && b.popT > 0.35) || b.still > 4) removeBall(b);
  }
  for (const R of Object.values(roll)) R.speed /= Math.max(1e-6, R.w);
  sound.rolling(S.replay || S.paused ? {} : roll);
  insight.tick(adv);
  everyFrame(dt, adv, now);

  if (S.replay) updateReplay(dt);
  else for (const inst of insts.values()) for (const dv of inst.devices) if (dv.update) dv.update(world, dt);
  updateParts(dt);
  updatePops(dt);
  tickPrediction();
  updateCamera(dt);
  updateArrows();
  hudTick(dt);
  positionSelPop();
  positionRingTag(now);
  placeAid.visible = TOOLS[S.tool].type === 'place' && !!S.ghostData && S.cam === 'orbit' && !S.move && !S.photo;
  for (const m of markerGroup.children) if (m.userData.active) m.scale.setScalar(1.15 + Math.sin(now * 0.008) * 0.15);
  for (const m of predGroup.children) if (m.userData.pulse) { const k = 1 + 0.25 * Math.sin(now * 0.01); m.scale.set(k, k, k); }
  if (S.cam === 'pov' && S.follow) {
    $('povSpeed').textContent = S.follow.vel.length().toFixed(2);
    $('povG').textContent = S.follow.feltG.toFixed(1) + ' g';
  }
  renderFrame();
  processPhotos();
}
function renderFrame() {
  if (S.night && !S.lite) composer.render(); else renderer.render(scene, camera);
  renderCornerCam();
}

let wasPhone = phone(), wasSel = selMode();
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  document.body.classList.toggle('phone', phone());
  if (phone() !== wasPhone) { wasPhone = phone(); renderDock(); }
  if (selMode() !== wasSel) { wasSel = selMode(); renderSelPop(); }
}
window.addEventListener('resize', resize);
// overlays sit just above the dock and just below the top bar, whatever their size
const dockObserver = new ResizeObserver(() => {
  document.documentElement.style.setProperty('--dockH', Math.round($('dock').getBoundingClientRect().height) + 'px');
  document.documentElement.style.setProperty('--topH', Math.round($('top').getBoundingClientRect().bottom) + 'px');
});
for (const id of ['dock', 'top']) dockObserver.observe($(id));
if (store.get('bc.fold', false)) document.body.classList.add('dock-folded');

// ================================================================ boot
setLang(store.get('bc.lang', 'en'));
resize();
setSide(store.get('bc.side', false) && window.innerWidth > 760);
renderAll();
if (store.get('bc.music', false)) { sound.musicOn = true; $('btnMusic').classList.add('on'); }
contactShadows();
S.heat = store.get('bc.heat', 'off');
S.ghostBall = store.get('bc.ghostBall', true);
S.name = store.get('bc.name.' + room.kind, '');
const saved = store.get(roomKey(room.kind), null) || (room.kind === 'kids' ? store.get('ballcoaster.v1', null) : null);
if (saved && Array.isArray(saved.pieces) && (saved.pieces.length || room.kind !== 'kids')) { sync(migratePieces(saved.pieces, saved.v ?? 1)); pushHistory(); }
else if (room.kind === 'kids') loadDemo();
else { sync([]); pushHistory(); }
fitView(true);
assembleIn();
store.set('bc.visitedRooms', [...new Set([...store.get('bc.visitedRooms', []), room.kind])]);
insight.renderWindow();
syncOptions();
if (S.lite) setLite(true);
$('fpsMeter').classList.toggle('hidden', !S.fps);
if (linkCode()) checkSharedLink();
else if (!store.get('bc.tour', false)) setTimeout(startTour, 900);
requestAnimationFrame(loop);
startVisitorSignal();
// debug hooks (used for automated testing; harmless in play)
window.__bc = {
  world, S, C, insts, pieces: () => pieces, releaseAll, spawnBall, setCam, pred, sync, camera, controls, pickTool, select,
  markers: markerGroup, insight, visitors, takeBallPhoto, copyShareLink, checkSharedLink, switchRoom, runFinishIt, runFixIt, pastePart, BUILTIN_PARTS, mirrorIds, openCtx, setAuto, openRooms, openGallery, startTour, get room() { return room; }, ports: () => ({ openOuts, openIns }), chainLinks, tweakSelected, deletePiece, startInsert, tryAppend, undo, fitView, startChallenge, exitChallenge, startReplay, stopReplay, setNight, setPhoto, rec,
  // advance the game by `sec` seconds of wall time in 1/60 s frames (works even when the tab is throttled)
  run(sec) { let t = lastT; for (let i = 0; i < sec * 60; i++) { t += 1000 / 60; frame(t); } lastT = performance.now(); },
};
