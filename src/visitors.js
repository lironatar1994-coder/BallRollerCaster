// The audience: toy spectators sitting around the room, each with their own taste, and a friend
// who drops by now and then — walks in, looks your coaster over, tries it and tells you what they
// think. Everything here is for show: they never touch the physics.
import * as THREE from 'three';
import { createKid, createToy, KID_LOOKS, TOY_KINDS, TOY_NAMES } from './characters.js';
import { roomClearance } from './physics.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
// what each toy enjoys (and can't stand)
const TASTE = {
  robot: { likes: 'speed', hates: 'slow', loves: (r) => r.maxV > 1.6, cheer: 'Beep boop! Maximum speed!', boo: 'Too slow… zzz' },
  dino: { likes: 'drops', hates: 'flat', loves: (r) => r.biggestDrop > 0.3 || r.airLongest > 0.3, cheer: 'ROAR! What a drop!', boo: 'Needs a bigger drop!' },
  bunny: { likes: 'music', hates: 'dizzy', loves: (r) => r.notes + r.bells >= 4, cheer: 'La la la — I love the music!', boo: 'So dizzy… my ears are spinning' },
  duck: { likes: 'water', hates: 'dry', loves: (r) => r.time > 6, cheer: 'Quack! Again, again!', boo: 'Quack… where is the water?' },
  bear: { likes: 'gentle', hates: 'scary', loves: (r) => r.rating.fun >= 6 && r.rating.thrill < 7, cheer: 'Nice and cozy. I like it!', boo: 'Eek, too scary for me!' },
};

export function createVisitors(app) {
  const { L, $, sound, store } = app;
  const group = new THREE.Group(); app.scene.add(group);
  let enabled = store.get('bc.visitors', true);

  // ------------------------------------------------ speech bubbles
  const bubbles = [];
  const _p = V();
  function say(who, text, life = 3.4, cls = '') {
    for (const b of bubbles.filter(b => b.who === who)) { b.el.remove(); bubbles.splice(bubbles.indexOf(b), 1); }
    const el = document.createElement('div');
    el.className = 'bubble ' + cls;
    el.innerHTML = text;
    $('bubbles').appendChild(el);
    bubbles.push({ el, who, t: 0, life });
    if (who.voice) sound.babble(3 + Math.floor(Math.random() * 3), who.voice, 0.08);
  }
  function placeBubbles(dt) {
    const r = app.canvas.getBoundingClientRect();
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.t += dt;
      if (b.t > b.life || !b.who.obj) { b.el.remove(); bubbles.splice(i, 1); continue; }
      b.who.obj.headWorldPosition(_p);
      _p.y += b.who.lift || 0.02;
      _p.project(app.camera);
      const off = _p.z > 1 || Math.abs(_p.x) > 1.1 || Math.abs(_p.y) > 1.1 || app.S.cam === 'pov';
      b.el.style.visibility = off ? 'hidden' : 'visible';
      const half = b.el.offsetWidth / 2 + 8;
      b.el.style.left = Math.min(window.innerWidth - half, Math.max(half, r.left + (_p.x + 1) / 2 * r.width)) + 'px';
      b.el.style.top = (r.top + (1 - _p.y) / 2 * r.height) + 'px';
      b.el.style.opacity = String(Math.min(1, (b.life - b.t) / 0.4, b.t / 0.15));
    }
  }

  // ------------------------------------------------ the toy audience
  let toys = [];
  function placeToys() {
    for (const t of toys) { group.remove(t.obj.group); t.obj.dispose(); }
    toys = [];
    const seats = (app.room.seats || []).slice(0, 4);
    const ROOMS = ['kids', 'kitchen', 'bath', 'garden', 'attic'];
    const shift = Math.max(0, ROOMS.indexOf(app.room.kind));
    seats.forEach((seat, i) => {
      const kind = TOY_KINDS[(i + shift) % TOY_KINDS.length];
      const obj = createToy(kind);
      obj.group.position.copy(seat);
      group.add(obj.group);
      toys.push({ obj, kind, name: TOY_NAMES[kind], voice: 1.5 + i * 0.15, lift: 0.015, t: Math.random() * 3, cool: 0, sleeping: false });
    });
    faceCoaster(true);
  }
  function coasterCenter() {
    const box = app.coasterBox();
    return box.isEmpty() ? V(0, 0.2, 0) : box.getCenter(V());
  }
  function faceCoaster() { const c = coasterCenter(); for (const t of toys) { t.obj.faceTo(c); t.obj.lookAt(c); } }
  const ready = (t, gap = 1.5) => { if (t.cool > 0) return false; t.cool = gap; return true; };
  function toyReact(type, ball) {
    if (!toys.length) return;
    if (type === 'goal') {
      for (const t of toys) if (Math.random() < 0.6 && ready(t, 1.2)) { t.obj.cheer(); }
      const t = pick(toys);
      if (ready(t, 0.1) && Math.random() < 0.5) say(t, pick([L('Goal!'), L('Yay!'), L('Again!'), L('Woo-hoo!')]), 1.8);
    } else if (type === 'splash') {
      const duck = toys.find(t => t.kind === 'duck');
      if (duck && ready(duck, 2)) { duck.obj.dance(); say(duck, L('Splash! Quack quack!'), 2.2); }
      for (const t of toys) if (t !== duck && ready(t, 1)) t.obj.gasp();
    } else if ((type === 'note' || type === 'bell') && Math.random() < 0.15) {
      const bunny = toys.find(t => t.kind === 'bunny');
      if (bunny && ready(bunny, 3)) bunny.obj.dance();
    } else if (type === 'award' || type === 'cheer') {
      for (const t of toys) { t.obj.cheer(); t.cool = 1; }
      if (type === 'cheer') sound.cheer(0.06);
    } else if (type === 'boost') {
      const robot = toys.find(t => t.kind === 'robot');
      if (robot && ready(robot, 3)) { robot.obj.bounce(); say(robot, L('Boost!'), 1.4); }
    }
  }
  function toysOnRun(run) {
    if (!toys.length) return;
    const r = run.rating;
    if (run.result === 'fall') {
      for (const t of toys) if (Math.random() < 0.6) t.obj.coverEyes();
      const t = pick(toys); say(t, pick([L('Oh no!'), L('It fell off!'), L('Oops!')]), 2.2);
      return;
    }
    // one toy says what it thinks, from its own taste
    const t = pick(toys), taste = TASTE[t.kind];
    if (taste.hates === 'dizzy' && r.dizzy > 6.5) { t.obj.shakeHead(); say(t, L(taste.boo)); }
    else if (taste.hates === 'scary' && r.thrill > 7.5) { t.obj.coverEyes(); say(t, L(taste.boo)); }
    else if (taste.loves(run)) { t.obj.cheer(); say(t, L(taste.cheer)); }
    else if (Math.random() < 0.5) { t.obj.nod(); say(t, L(taste.boo)); }
  }

  // ------------------------------------------------ walking around: a grid over the floor
  let grid = null;
  function buildGrid() {
    const b = app.room.bounds, cell = 0.06;
    const nx = Math.floor((b.x1 - b.x0) / cell), nz = Math.floor((b.z1 - b.z0) / cell);
    const free = new Uint8Array(nx * nz);
    const pts = app.trackPoints().filter(q => q.p.y < 0.95).map(q => q.p);
    for (const inst of app.insts.values()) if (inst.spawn) pts.push(inst.spawn.clone().setY(0.1));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = b.x0 + (i + 0.5) * cell, z = b.z0 + (j + 0.5) * cell;
      let ok = roomClearance(app.room.colliders, x, 0.12, z) > 0.11 && roomClearance(app.room.colliders, x, 0.45, z) > 0.1;
      if (ok) for (const p of pts) if ((p.x - x) ** 2 + (p.z - z) ** 2 < 0.13 * 0.13) { ok = false; break; }
      free[i + j * nx] = ok ? 1 : 0;
    }
    grid = { cell, nx, nz, free, b, at: (x, z) => [Math.floor((x - b.x0) / cell), Math.floor((z - b.z0) / cell)], pos: (i, j) => V(b.x0 + (i + 0.5) * cell, 0, b.z0 + (j + 0.5) * cell) };
    return grid;
  }
  const isFree = (g, i, j) => i >= 0 && j >= 0 && i < g.nx && j < g.nz && g.free[i + j * g.nx] === 1;
  function nearestFree(g, i0, j0) {
    for (let r = 0; r < 30; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (isFree(g, i0 + di, j0 + dj)) return [i0 + di, j0 + dj];
    }
    return null;
  }
  function findPath(from, to) {
    const g = grid;
    const s = nearestFree(g, ...g.at(from.x, from.z)), e = nearestFree(g, ...g.at(to.x, to.z));
    if (!s || !e) return null;
    const N = g.nx * g.nz, cost = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), open = [];
    const key = (i, j) => i + j * g.nx, h = (i, j) => Math.hypot(i - e[0], j - e[1]);
    cost[key(...s)] = 0; open.push([h(...s), s[0], s[1]]);
    let found = false;
    for (let it = 0; it < 20000 && open.length; it++) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
      const [, i, j] = open.splice(bi, 1)[0];
      if (i === e[0] && j === e[1]) { found = true; break; }
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (!isFree(g, ni, nj) || (di && dj && (!isFree(g, i + di, j) || !isFree(g, i, j + dj)))) continue;
        const c = cost[key(i, j)] + (di && dj ? 1.414 : 1);
        if (c < cost[key(ni, nj)]) { cost[key(ni, nj)] = c; prev[key(ni, nj)] = key(i, j); open.push([c + h(ni, nj), ni, nj]); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = key(...e); k !== -1; k = prev[k]) cells.unshift([k % g.nx, Math.floor(k / g.nx)]);
    // straighten: keep only the corners the kid needs
    const pts = [g.pos(...cells[0])];
    let a = 0;
    for (let k = 2; k < cells.length; k++) if (!lineFree(g, cells[a], cells[k])) { pts.push(g.pos(...cells[k - 1])); a = k - 1; }
    pts.push(g.pos(...cells[cells.length - 1]));
    return pts;
  }
  function lineFree(g, [i0, j0], [i1, j1]) {
    const n = Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0)) * 2;
    for (let k = 0; k <= n; k++) { const t = k / Math.max(1, n); if (!isFree(g, Math.round(i0 + (i1 - i0) * t), Math.round(j0 + (j1 - j0) * t))) return false; }
    return true;
  }
  // a good place to stand: beside the coaster as seen from the camera (never in front of it),
  // leaning a little towards the camera so we see the friend's face
  function viewpoint() {
    const box = app.coasterBox(), c = box.isEmpty() ? V(0, 0, 0.3) : box.getCenter(V());
    const size = box.isEmpty() ? V(0.4, 0, 0.4) : box.getSize(V());
    const camDir = app.camera.position.clone().sub(c).setY(0).normalize();
    let best = null, bs = -Infinity;
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2, d = V(Math.cos(a), 0, Math.sin(a));
      for (const extra of [0.25, 0.4, 0.6]) {
        const R = Math.max(size.x, size.z) / 2 + extra, p = c.clone().addScaledVector(d, R).setY(0);
        const [i, j] = grid.at(p.x, p.z);
        if (!isFree(grid, i, j)) continue;
        const dot = d.dot(camDir), score = (1 - Math.abs(dot)) * 1.2 + dot * 0.35 - extra * 0.8 + Math.random() * 0.15;
        if (score > bs) { bs = score; best = p; }
        break;
      }
    }
    return best;
  }

  // ------------------------------------------------ the visiting friend
  const kid = { obj: null, name: '', voice: 1, lift: 0.04, state: 'away', t: 0, plan: [], ball: null, run: null, looks: null };
  let away = 75, lastBuild = -1e9, clock = 0;
  function startVisit() {
    if (kid.state !== 'away' || !app.room.door) return false;
    buildGrid();
    const door = app.room.door;
    const look = Math.floor(Math.random() * KID_LOOKS.length);
    kid.obj = createKid({ look });
    kid.obj.group.position.copy(door.out);
    kid.obj.faceTo(door.p);
    group.add(kid.obj.group);
    kid.name = KID_LOOKS[look].name; kid.voice = 1.05 + Math.random() * 0.25;
    kid.state = 'enter'; kid.t = 0; kid.run = null; kid.ball = null;
    kid.obj.walkTo(door.p.clone(), () => greet());
    app.news('🚪', L('{0} came to see your coaster!', kid.name));
    sound.babble(4, kid.voice, 0.1);
    return true;
  }
  function greet() {
    kid.obj.wave();
    const hasStart = [...app.insts.values()].some(i => i.spawn);
    if (!hasStart) { say(kid, L("Hi! Oh — it's empty… Build something and I'll come back!")); after(3.2, leave); return; }
    say(kid, pick([L('Hi! Can I see your marble run?'), L('Hello! Ooh, what did you build?'), L('Hey! Can I try your coaster?')]));
    const spot = viewpoint();
    const path = spot && findPath(kid.obj.group.position, spot);
    after(1.8, () => {
      if (path) { kid.state = 'walk'; kid.obj.walkPath(path, () => inspect()); }
      else inspect();
    });
  }
  // things worth pointing at, with what to say about them
  function observations() {
    const out = [], pieces = app.pieces, c = coasterCenter(), box = app.coasterBox();
    const find = (type) => [...app.insts.values()].find(i => i.d.type === type);
    const at = (inst) => inst.group.children.length ? new THREE.Box3().setFromObject(inst.group.children[0]).getCenter(V()) : c;
    if (!box.isEmpty() && box.max.y > 0.6) out.push({ at: V(c.x, box.max.y, c.z), say: L('Whoa, it is so tall!'), g: 'wow' });
    const loop = find('loop'); if (loop) out.push({ at: at(loop), say: L('A loop! Does the ball make it round?'), g: 'point' });
    const pool = find('pool'); if (pool) out.push({ at: at(pool), say: L('Water! Will it splash?'), g: 'crouch' });
    const xylo = find('xylo'); if (xylo) out.push({ at: at(xylo), say: L('A xylophone! It plays music!'), g: 'point' });
    const lift = find('lift') || find('screw') || find('elevator'); if (lift) out.push({ at: at(lift), say: L('It goes back up? Cool!'), g: 'point' });
    const tr = app.trouble();
    if (tr && tr.trouble) out.push({ at: tr.trouble.clone(), say: L('Hmm… I think the ball falls off here.'), g: 'scratch' });
    const helices = pieces.filter(p => p.type === 'helix').length;
    if (helices >= 3) out.push({ at: c, say: L('So many spirals… I feel dizzy already!'), g: 'scratch' });
    if (pieces.length >= 30) out.push({ at: c, say: L('You built so much!'), g: 'wow' });
    if (!out.length) out.push({ at: c, say: pick([L('Nice!'), L('Ooh, I like the colors.'), L('Let me look…')]), g: 'point' });
    return out.sort(() => Math.random() - 0.5).slice(0, 2);
  }
  function inspect() {
    kid.state = 'inspect';
    const c = coasterCenter();
    kid.obj.faceTo(c);
    const obs = observations();
    let k = 0;
    const next = () => {
      if (kid.state !== 'inspect') return;
      if (k >= obs.length) { tryIt(); return; }
      const o = obs[k++];
      kid.obj.lookAt(o.at);
      if (o.g === 'crouch' || o.at.y < 0.25) { kid.obj.crouch(); after(2.4, () => kid.obj.stand()); }
      else if (o.g === 'wow') kid.obj.wow();
      else if (o.g === 'scratch') kid.obj.scratchHead();
      else kid.obj.point(o.at);
      say(kid, o.say, 2.8);
      after(3.1, next);
    };
    after(0.6, next);
  }
  function tryIt() {
    kid.state = 'try';
    say(kid, pick([L('Can I drop a ball? Here goes!'), L('My turn! 3… 2… 1…'), L("Let's see if it works!")]), 2.4);
    after(1.6, () => {
      const made = app.releaseAll(true);
      if (!made.length) { leave(); return; }
      kid.ball = made[0]; kid.ball.byKid = true;
      kid.obj.point(kid.ball.pos);
      kid.state = 'watch'; kid.t = 0;
      sound.release();
    });
  }
  function verdict(run) {
    kid.state = 'verdict';
    kid.obj.lookAt(null);
    const r = run.rating, stars = r.stars;
    const st = '★'.repeat(Math.floor(stars)) + (stars % 1 ? '½' : '');
    let line, gesture;
    if (run.result === 'fall') { line = pick([L('Oh no, it fell off!'), L('Aww, the ball fell…')]); gesture = 'scratch'; }
    else if (stars >= 4) { line = pick([L('That was AMAZING!'), L('Best coaster ever!'), L('Again! Again!')]); gesture = 'jump'; }
    else if (stars >= 2.5) { line = pick([L('Cool ride!'), L('I like it!'), L('Fun!')]); gesture = 'thumbs'; }
    else { line = pick([L('Hmm, it was a bit short.'), L('Okay… make it longer?')]); gesture = 'hips'; }
    // one idea for next time, from what the critics noticed
    const tips = [];
    if (run.result === 'fall') tips.push(L('Maybe a glass tube or a brake there? Try 🔧 Fix it.'));
    if (r.dizzy > 6.5) tips.push(L('Too many spirals — add some straight bits.'));
    if (r.thrill < 3) tips.push(L('Make a big drop or a jump!'));
    if (run.notes + run.bells === 0) tips.push(L('Add a bell or a xylophone — I love music!'));
    if (run.scenery === 0) tips.push(L('Some flags or a rainbow arch would look so nice.'));
    if (run.time < 5) tips.push(L('Make it longer! A lift can carry the ball back up.'));
    if (gesture === 'jump') { kid.obj.jump(); after(0.6, () => kid.obj.clap()); sound.cheer(0.08); }
    else if (gesture === 'thumbs') kid.obj.thumbsUp();
    else if (gesture === 'scratch') kid.obj.scratchHead();
    else kid.obj.handsOnHips();
    kid.obj.setMouth(stars >= 2.5 && run.result !== 'fall' ? 'smile' : 'flat');
    say(kid, `${line}<br><b class="stars">${st || '☆'}</b>`, 3.6, 'big');
    const tip = tips.length ? pick(tips) : null;
    app.news('👧', L('{0} gave your coaster {1}', kid.name, `<b class="stars">${st || '☆'}</b>`) + (tip ? ` — “${tip}”` : ''));
    app.sticker('visitor');
    after(3.8, () => { if (tip) { kid.obj.point(coasterCenter()); say(kid, tip, 3.6); after(3.9, leave); } else leave(); });
  }
  function leave() {
    if (!kid.obj || kid.state === 'leave') return;
    kid.state = 'leave';
    kid.obj.stand?.();
    kid.obj.wave();
    say(kid, pick([L('Bye! See you later!'), L('Thanks! Bye-bye!'), L("I'll come back soon!")]), 2.2);
    const door = app.room.door;
    after(1.2, () => {
      const path = grid && findPath(kid.obj.group.position, door.p);
      const out = () => kid.obj.walkTo(door.out.clone(), gone);
      if (path) kid.obj.walkPath(path, out); else kid.obj.walkTo(door.p.clone(), out);
    });
  }
  function gone() {
    if (kid.obj) { group.remove(kid.obj.group); kid.obj.dispose(); }
    kid.obj = null; kid.state = 'away';
    away = 240 + Math.random() * 120;
    timers.length = 0;
  }
  function sendHome() { timers.length = 0; for (const b of bubbles.filter(b => b.who === kid)) b.t = b.life; if (kid.obj) gone(); }

  // tiny scheduler (in game seconds, paused with the game's clock)
  const timers = [];
  function after(sec, fn) { timers.push({ t: clock + sec, fn }); }

  // ------------------------------------------------ per frame
  const _c = V();
  function update(dt) {
    clock += dt;
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].t <= clock) { const f = timers[i].fn; timers.splice(i, 1); f(); }
    // toys: watch the ball, doze at night
    const live = app.liveBalls(), follow = app.S.follow && live.includes(app.S.follow) ? app.S.follow : live[live.length - 1];
    for (const t of toys) {
      t.cool = Math.max(0, t.cool - dt);
      t.t += dt;
      if (follow) { if (t.sleeping) { t.obj.wake(); t.sleeping = false; } if (t.t > 0.15) { t.obj.lookAt(follow.pos); t.t = 0; } }
      else if (kid.obj && t.t > 1) { kid.obj.headWorldPosition(_c); t.obj.lookAt(_c); t.t = 0; }
      if (app.S.night && !follow && !t.sleeping && Math.random() < dt / 25) { t.obj.sleep(); t.sleeping = true; }
      t.obj.update(dt);
    }
    if (kid.obj) {
      kid.obj.update(dt);
      if (kid.state === 'watch') {
        kid.t += dt;
        const b = kid.ball;
        if (b && app.world.balls.includes(b)) kid.obj.lookAt(b.pos);
        if (kid.t > 45) { kid.obj.lookAt(null); say(kid, L('It goes on forever! Cool!'), 2.6); after(2.8, leave); kid.state = 'verdict'; }
      }
    } else if (enabled && !app.S.challenge && !app.S.replay && !app.S.photo) {
      // visits come while you are building, not while the game sits idle
      if (clock - lastBuild < 90) away -= dt;
      if (away <= 0 && app.pieces.length >= 3) { if (!startVisit()) away = 60; }
    }
    placeBubbles(dt);
  }

  placeToys();
  return {
    update,
    react(type, ball) { toyReact(type, ball); },
    onRun(run) {
      toysOnRun(run);
      if (kid.obj && kid.state === 'watch' && kid.ball && run.id === kid.ball.id) verdict(run);
    },
    noteBuild() { lastBuild = clock; },
    roomChanged() { sendHome(); placeToys(); away = Math.min(away, 90); },
    callNow() { if (kid.obj) { say(kid, L("I'm already here!"), 2); return; } if (!startVisit()) app.toast(L('No door in this room for a visitor'), true); },
    setEnabled(v) { enabled = v; if (!v) sendHome(); },
    get enabled() { return enabled; },
  };
}
