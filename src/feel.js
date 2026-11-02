// How the game feels: little sounds that climb as you build, a buzz on phones, the big finish
// when the first ball of a new design drops into a goal, the live energy bar while watching a
// ball, and a coaster that builds itself in front of you when it opens.
import { GoalDevice } from './track.js';
import { L } from './i18n.js';

// the device asks for less motion: no wobbles, no camera swoops, fewer confetti
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createFeel(app) {
  const { S, $, sound, store, world, canvas } = app;

  // ------------------------------------------------ a buzz, and notes that climb
  // a tiny buzz on phones that allow it (Android; iPhones don't let a web page vibrate)
  S.haptics = store.get('bc.haptics', true);
  const buzz = (p) => { if (S.haptics && navigator.vibrate && app.touchScreen()) try { navigator.vibrate(p); } catch { /* not allowed yet */ } };
  // pieces placed one after another climb a little scale (and buzz a phone); a pause starts it again
  const placeRun = { n: 0, t: 0 };
  function placeSound() {
    const now = performance.now();
    placeRun.n = now - placeRun.t < 2500 ? placeRun.n + 1 : 0; placeRun.t = now;
    sound.place(placeRun.n); buzz(12);
  }

  // ------------------------------------------------ the big finish
  // The first ball down a new design slows right down as it drops into a goal, then a beat of
  // stillness as it lands. Only for a lone ball and once per design: with more it would just drag.
  const finale = { k: 1, on: false, ball: null, goal: null, t0: 0, hold: 0, done: '' };
  const designKey = () => app.room.kind + ':' + app.hIdx;
  const inGoal = (g, b, rk, up) => { const dx = b.pos.x - g.c.x, dz = b.pos.z - g.c.z; return dx * dx + dz * dz < (g.R * rk) ** 2 && b.pos.y < g.yTop + up && b.pos.y > g.yB - 0.01; };
  function finaleTick(now, dt) {
    if (!finale.on) {
      if (finale.done === designKey() || S.auto || S.race || S.replay || S.paused || S.photo) return;
      const live = app.liveBalls();
      if (live.length !== 1) return;
      const b = live[0];
      const g = world.devices.find(dv => dv instanceof GoalDevice && inGoal(dv, b, 2.4, 0.14) && (b.vel.y < -0.05 || (b.pos.x - dv.c.x) * b.vel.x + (b.pos.z - dv.c.z) * b.vel.z < 0));
      if (g) Object.assign(finale, { on: true, ball: b, goal: g, t0: now, hold: 0 });
      document.body.classList.toggle('finale', finale.on);
      return;
    }
    const b = finale.ball;
    if (b.collected || b.dead || !world.balls.includes(b) || now - finale.t0 > 2600) return endFinale();
    if (!finale.hold && inGoal(finale.goal, b, 1, 0.004)) { finale.hold = now; buzz(40); }
    const target = !finale.hold ? 0.3 : now - finale.hold < 90 ? 0 : 1;
    finale.k += (target - finale.k) * Math.min(1, dt * (finale.hold ? 30 : 6));
    if (finale.hold && now - finale.hold > 600) endFinale();
  }
  function endFinale() {
    if (finale.on) finale.done = designKey();
    Object.assign(finale, { on: false, k: 1, ball: null, goal: null });
    document.body.classList.remove('finale');
  }
  canvas.addEventListener('pointerdown', () => { if (finale.on) endFinale(); }); // a tap skips it

  // ------------------------------------------------ energy on screen while watching a ball
  // where the ball's energy is right now: moving, height, or already lost to rubbing and bumps
  let energyAt = 0;
  function energyTick() {
    const el = $('energyHud'), b = S.follow;
    const show = S.cam !== 'orbit' && b && world.balls.includes(b) && !b.captured && !S.replay && !S.photo;
    el.classList.toggle('on', !!show);
    if (!show || performance.now() - energyAt < 100) return;
    energyAt = performance.now();
    const E = b.energy(world.g), E0 = Math.max(b.stats.E0 || 0, E.total, 1e-9);
    const mo = (E.kt + E.kr) / E0, h = Math.max(0, E.pe) / E0, lost = Math.max(0, 1 - mo - h);
    const [m, hh, l] = el.querySelectorAll('.ebar i');
    m.style.width = (mo * 100).toFixed(1) + '%'; hh.style.width = (h * 100).toFixed(1) + '%'; l.style.width = (lost * 100).toFixed(1) + '%';
    el.querySelector('.elegend').innerHTML = `<span class="m">${L('motion')}</span><span class="h">${L('height')}</span><span class="l">${L('lost {0}%', (lost * 100).toFixed(0))}</span>`;
  }

  // ------------------------------------------------ a coaster that opens builds itself
  // piece by piece along the track, with a few rising notes
  function assembleIn() {
    if (reduceMotion()) return;
    const list = app.pieces.filter(d => app.insts.has(d.id)), gap = Math.min(45, 1300 / Math.max(1, list.length));
    list.forEach((d, i) => {
      const g = app.insts.get(d.id).group;
      g.visible = false;
      setTimeout(() => {
        if (!app.insts.has(d.id) || app.insts.get(d.id).group !== g) return;
        g.visible = true; app.popIn(g);
        if (i % 3 === 0) sound.place(Math.floor(i / 3) % 8);
      }, 150 + i * gap);
    });
  }

  return { buzz, placeSound, finale, finaleTick, endFinale, energyTick, assembleIn };
}
