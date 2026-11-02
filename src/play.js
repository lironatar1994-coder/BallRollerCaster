// Playing with the coaster, not just watching it: a remote with coloured buttons that steers
// flip-flops and turnstiles and opens button gates while the balls roll, and puzzles you make
// for a friend (your track locked in place, a box of pieces, a goal) and send as a link.
import { SwitchDevice, GateDevice } from './track.js';
import { L } from './i18n.js';

const COLORS = { red: '#ff4d5e', green: '#3ccf7a', blue: '#4c8dff' };
// the pieces a puzzle box can hold, and how many of each to start with
const BOX = [['straight', 2], ['curveL', 1], ['curveR', 1], ['helixL', 0], ['helixR', 0], ['drop', 0], ['jump', 0], ['loop', 0], ['tramp', 0], ['booster', 0], ['brake', 0], ['switch', 0], ['cup', 1], ['basket', 0]];

export function createPlay(app) {
  const { S, $, world, sound, TOOLS, ICONS, esc } = app; // app.C: what the missions keep track of

  // ------------------------------------------------ the remote
  const remoteEl = $('remote');
  let colours = '';
  // the buttons show only for colours some piece listens to
  function refreshRemote() {
    const used = ['red', 'green', 'blue'].filter(c => world.devices.some(d => d.remote === c));
    const key = used.join(',');
    remoteEl.classList.toggle('hidden', !used.length);
    if (key === colours) return;
    colours = key;
    remoteEl.innerHTML = used.map(c => `<button data-remote="${c}" style="--rc:${COLORS[c]}" title="${esc(L('Press while the balls roll'))}"></button>`).join('');
  }
  function press(c) {
    let n = 0;
    for (const d of world.devices) {
      if (d.remote !== c) continue;
      n++;
      if (d instanceof SwitchDevice) { const st = world.devState(d); st.next = (st.next + 1) % d.n; world.emit('switch', d, st.next); }
      else if (d instanceof GateDevice) world.devState(d).pressed = world.time;
    }
    if (n) { app.buzz(15); app.schedulePrediction(); app.C.pressed = true; }
  }
  remoteEl.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-remote]');
    if (!b) return;
    e.preventDefault();
    b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 140);
    press(b.dataset.remote);
  });

  // ------------------------------------------------ making a puzzle
  const box = new Map(BOX);
  function openMaker() {
    app.closeMenus();
    if (S.challenge) { app.toast(L('Finish or leave the mission first'), true); return; }
    const m = $('puzzleModal');
    const hasStart = app.pieces.some(p => p.type === 'start');
    m.querySelector('.pz-body').innerHTML = `
      <p class="sub">${L('Everything you built now is locked in place. Your friend gets the pieces in the box and must finish the run into a goal.')}</p>
      ${hasStart ? '' : `<p class="warn">⚠ ${L('Your puzzle needs a 📍 Start Tower first.')}</p>`}
      <p class="sub small">💡 ${L('Tip: remove the last few pieces before a goal, so there is a gap to fill.')}</p>
      <div class="pz-box">${BOX.map(([k]) => `<div class="pz-item" data-k="${k}"><span class="pz-ico">${ICONS[TOOLS[k].icon] || ''}</span><span class="pz-name">${L(TOOLS[k].label)}</span><button data-d="-1">−</button><b>${box.get(k)}</b><button data-d="1">＋</button></div>`).join('')}</div>
      <input id="pzName" maxlength="40" placeholder="${esc(L('Name your puzzle'))}" value="${esc(S.name || '')}">`;
    m.querySelector('#pzMake').disabled = !hasStart;
    m.classList.remove('hidden');
  }
  $('puzzleModal').addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    const it = b.closest('[data-k]'), k = it.dataset.k;
    box.set(k, Math.max(0, Math.min(9, box.get(k) + +b.dataset.d)));
    it.querySelector('b').textContent = box.get(k);
    sound.click();
  });
  $('pzMake').onclick = async () => {
    const parts = Object.fromEntries([...box].filter(([, n]) => n > 0));
    if (!Object.keys(parts).length) { app.toast(L('Put at least one piece in the box'), true); return; }
    const name = $('pzName').value.trim();
    const url = await app.shareLink({ app: 'ball-coaster', v: app.SAVE_V, room: app.room.kind, name, pieces: app.pieces.map(p => ({ ...p, locked: true })), puzzle: { parts } });
    app.closeModals();
    try { await navigator.clipboard.writeText(url); app.toast(L('🧩 Puzzle link copied — send it to a friend!')); }
    catch (e) { window.prompt(L('Copy this link:'), url); }
  };

  // ------------------------------------------------ solving one
  function startPuzzle(data) {
    const parts = data.puzzle.parts, total = Object.values(parts).reduce((a, n) => a + n, 0);
    const def = {
      id: 'puzzle', custom: true, icon: '🧩', room: data.room || 'kids', puzzle: data.puzzle, name: data.name,
      title: data.name ? `“${data.name}”` : 'A puzzle from a friend',
      goal: 'Finish the run with the pieces in the box and score a goal.',
      parts, setup: () => data.pieces.map(p => ({ ...p, locked: true })),
      stars: ['Score a goal', ['Use {0} pieces or fewer', Math.max(1, total - 1)], ['Use {0} pieces or fewer', Math.max(1, total - 2)]],
      score: (C, n) => C.goals.length ? 1 + (n <= total - 1) + (n <= total - 2) : 0,
    };
    app.startChallenge(-2, def);
  }
  // solved: send the whole thing back so the maker can watch it
  async function shareSolution() {
    const def = S.challenge && S.challenge.def;
    if (!def || !def.custom) return;
    const url = await app.shareLink({ app: 'ball-coaster', v: app.SAVE_V, room: app.room.kind, name: def.name || '', pieces: app.pieces.map(p => ({ ...p, locked: false })), puzzle: { ...def.puzzle, solved: true } });
    try { await navigator.clipboard.writeText(url); app.toast(L('🔗 Solution link copied — send it back!')); }
    catch (e) { window.prompt(L('Copy this link:'), url); }
  }

  // ------------------------------------------------ notes in the room
  // Pin a sticky note where you are building, signed with your name. Notes go along in share links,
  // so a family can pass one coaster round, each adding a piece and a note.
  let notes = [];
  const noteKey = () => 'bc.notes.' + app.room.kind;
  const layer = $('notes3d');
  function roomChanged() { notes = app.store.get(noteKey(), []); drawNotes(); }
  function setNotes(list) { notes = Array.isArray(list) ? list.slice(0, 30) : []; app.store.set(noteKey(), notes); drawNotes(); if (notes.length) app.toast('📝 ' + L('{0} notes in this room', notes.length)); }
  function drawNotes() {
    layer.innerHTML = notes.map((n, i) => `<div class="note3d" data-i="${i}"><b>📝 ${esc(n.by || '?')}</b><span>${esc(n.text)}</span><button data-del="${i}" title="${esc(L('Remove'))}">✕</button></div>`).join('');
  }
  layer.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { notes.splice(+del.dataset.del, 1); app.store.set(noteKey(), notes); drawNotes(); sound.click(); return; }
    const n = e.target.closest('.note3d');
    if (n) { n.classList.toggle('open'); sound.click(); }
  });
  const _p = new (app.camera.position.constructor)();
  function notesTick() {
    layer.classList.toggle('hidden', S.cam !== 'orbit' || !!S.photo || !!S.replay);
    if (layer.classList.contains('hidden')) return;
    const r = app.canvas.getBoundingClientRect();
    notes.forEach((n, i) => {
      const el = layer.children[i];
      if (!el) return;
      _p.set(n.at[0], n.at[1], n.at[2]).project(app.camera);
      el.style.display = _p.z > 1 ? 'none' : '';
      el.style.left = (r.left + (_p.x + 1) / 2 * r.width) + 'px';
      el.style.top = (r.top + (1 - _p.y) / 2 * r.height) + 'px';
    });
  }
  function openNote() {
    app.closeMenus();
    $('noteBy').value = app.store.get('bc.author', '');
    $('noteText').value = '';
    $('noteModal').classList.remove('hidden');
    setTimeout(() => $('noteText').focus(), 50);
  }
  $('notePin').onclick = () => {
    const text = $('noteText').value.trim(), by = $('noteBy').value.trim();
    if (!text) { app.toast(L('Write something first'), true); return; }
    app.store.set('bc.author', by);
    const p = (app.ringPoint() || app.controls.target).clone().add(new _p.constructor(0, 0.06, 0));
    notes.push({ by, text: text.slice(0, 120), at: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)], t: Date.now() });
    app.store.set(noteKey(), notes); drawNotes();
    app.closeModals(); app.sparkle(p, '#ffd23f', 8); sound.click();
    app.toast(L('📝 Note pinned — share the link and pass the coaster on!'));
  };

  return { refreshRemote, press, openMaker, startPuzzle, shareSolution, notes: () => notes, setNotes, roomChanged, notesTick, openNote };
}
