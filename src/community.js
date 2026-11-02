// Coasters made by other players: the main menu, Explore (search, filters, sorting), publishing your
// own, and trying someone else's coaster (with its play counter, likes and a report button).
// The library itself is server/api.cjs, reached at api/ next to the page.
import { L, getLang } from './i18n.js';

const TAGS = [['loop', '🔄', 'Loop'], ['lift', '⬆️', 'Lift'], ['spiral', '🌀', 'Spiral'], ['jump', '🚀', 'Jump'], ['music', '🎵', 'Music'], ['water', '💦', 'Water'], ['switch', '🔀', 'Switches'], ['gadgets', '⚙️', 'Gadgets']];
const SIZES = [['s', 'Small'], ['m', 'Medium'], ['l', 'Big']];
const ERRORS = {
  offline: "Can't reach the coaster library right now. Check your connection and try again.",
  name: 'Give your coaster a name first.',
  'name-unfriendly': 'Please pick a friendlier name 🙂',
  'author-unfriendly': 'Please pick a friendlier builder name 🙂',
  'no-start': 'Your coaster needs a 📍 Start Tower first.',
  pieces: "Something in this coaster can't be shared.",
  'too-big': 'This coaster is too big to publish.',
  'slow-down': "That's a lot at once! Please try again in a little while.",
  duplicate: 'This exact coaster is already published.',
  'not-found': "That coaster isn't available any more.",
  forbidden: "This coaster wasn't published from this device.",
};
const errText = (e) => L(ERRORS[e && e.code] || 'Something went wrong. Please try again.');

// ---------------------------------------------------------------- talking to the library
async function api(method, path, body, headers = {}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch('api/' + path, { method, signal: ctl.signal, headers: body ? { 'Content-Type': 'application/json', ...headers } : headers, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'server'), { code: data.error || 'server', data });
    return data;
  } catch (e) {
    if (!e.code) e.code = 'offline';
    throw e;
  } finally { clearTimeout(timer); }
}
const fmt = (n) => n < 1000 ? String(n) : n < 1e5 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : Math.round(n / 1000) + 'k';
function ago(t) {
  const days = Math.floor((Date.now() - t) / 864e5);
  if (days < 1) return L('today');
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto' });
  return days < 30 ? rtf.format(-days, 'day') : days < 365 ? rtf.format(-Math.floor(days / 30), 'month') : rtf.format(-Math.floor(days / 365), 'year');
}

export function createCommunity(app) {
  const { S, $, esc, store, toast, sound } = app;
  // who you are to the library: a random id made on this device, nothing more
  let client = store.get('bc.client', '');
  if (!/^[a-f0-9]{32}$/.test(client)) { client = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''); store.set('bc.client', client); }
  const liked = new Set(store.get('bc.liked', []));
  const saveLiked = () => store.set('bc.liked', [...liked].slice(-500));
  const published = () => store.get('bc.published', []);
  const isMine = (id) => published().some(p => p.id === id);
  const shareUrl = (id) => { const u = new URL(location.href); u.search = '?play=' + id; u.hash = ''; return u.toString(); };
  const roomOf = (k) => app.roomInfo(k);
  const tagIcons = (tags) => TAGS.filter(t => tags.includes(t[0])).map(t => `<span title="${esc(L(t[2]))}">${t[1]}</span>`).join('');

  // ================================================================ the main menu
  let popularAt = 0, popular = null;
  function openMenu() {
    app.closeModals();
    $('mmContinueLabel').textContent = L(app.hasOwn() ? 'Continue building' : 'Start building');
    $('mmLang').textContent = getLang() === 'he' ? 'English' : 'עברית';
    $('menuModal').classList.remove('hidden');
    renderPopular();
    if (Date.now() - popularAt > 60000) {
      popularAt = Date.now();
      api('GET', 'coasters?sort=popular&limit=4').then(r => { popular = r.items; renderPopular(); }).catch(() => { popular = popular || 'error'; renderPopular(); });
    }
    setTimeout(() => $('mmContinue').focus(), 30);
  }
  function miniCard(c) {
    return `<button class="mmCard" data-try="${c.id}"><span class="mmThumb">${c.thumb ? `<img loading="lazy" src="api/thumbs/${c.id}.jpg" alt="">` : `<span class="noThumb">${roomOf(c.room).icon}</span>`}<span class="exPlays">▶ ${fmt(c.plays)}</span></span><b>${esc(c.name)}</b><small>${esc(c.author || L('Anonymous builder'))}</small></button>`;
  }
  function renderPopular() {
    const el = $('mmPopular');
    if (!popular) el.innerHTML = Array.from({ length: 4 }, () => '<span class="mmCard skel"><span class="mmThumb"></span><b></b><small></small></span>').join('');
    else if (popular === 'error') el.innerHTML = `<p class="mmEmpty">📡 ${esc(L("Can't reach the coaster library right now."))}</p>`;
    else if (!popular.length) el.innerHTML = `<p class="mmEmpty">✨ ${esc(L('No coasters yet. Yours could be the first!'))} <button data-mm="publish" class="mmLink">${esc(L('🌍 Publish yours'))}</button></p>`;
    else el.innerHTML = popular.map(miniCard).join('');
  }
  $('menuModal').addEventListener('click', (e) => {
    const t = e.target.closest('[data-try]');
    if (t) { tryCoaster(t.dataset.try, t); return; }
    const b = e.target.closest('[data-mm]');
    if (!b) return;
    sound.click();
    const a = b.dataset.mm;
    if (a === 'explore') openExplore();
    else if (a === 'publish') openPublish();
    else if (a === 'lang') { app.toggleLang(); $('mmLang').textContent = getLang() === 'he' ? 'English' : 'עברית'; $('mmContinueLabel').textContent = L(app.hasOwn() ? 'Continue building' : 'Start building'); renderPopular(); }
    else app.menuAction(a);
  });
  $('mmContinue').onclick = () => { sound.click(); app.closeModals(); };

  // ================================================================ explore
  const ex = { q: '', sort: 'popular', room: '', tags: new Set(), size: '', goal: false, items: [], total: 0, loading: false, error: null, req: 0, opened: false };
  const filterCount = () => ex.tags.size + (ex.size ? 1 : 0) + (ex.goal ? 1 : 0);
  function openExplore(opts = {}) {
    app.closeModals();
    $('exploreModal').classList.remove('hidden');
    if (opts.fresh) { ex.sort = 'new'; }
    if (!ex.opened) { ex.opened = true; $('exFilters').classList.toggle('open', window.innerWidth > 760); }
    renderControls();
    load(false);
    if (window.innerWidth > 760) setTimeout(() => $('exQ').focus(), 30);
  }
  function renderControls() {
    $('exQ').value = ex.q;
    $('exQClear').classList.toggle('hidden', !ex.q);
    for (const b of $('exSort').querySelectorAll('[data-sort]')) b.classList.toggle('on', b.dataset.sort === ex.sort);
    $('exRooms').innerHTML = [['', '🌐', 'All rooms'], ...app.rooms().map(r => [r.kind, r.icon, r.name])]
      .map(([k, icon, name]) => `<button class="exChip${ex.room === k ? ' on' : ''}" data-room="${k}"><i>${icon}</i>${esc(L(name))}</button>`).join('');
    $('exFilters').innerHTML =
      `<div class="exGroup"><span class="exLbl">${esc(L('Has'))}</span>${TAGS.map(([k, icon, name]) => `<button class="exChip${ex.tags.has(k) ? ' on' : ''}" data-tag="${k}"><i>${icon}</i>${esc(L(name))}</button>`).join('')}</div>` +
      `<div class="exGroup"><span class="exLbl">${esc(L('Size'))}</span>${SIZES.map(([k, name]) => `<button class="exChip${ex.size === k ? ' on' : ''}" data-size="${k}">${esc(L(name))}</button>`).join('')}` +
      `<button class="exChip${ex.goal ? ' on' : ''}" data-goal="1"><i>🎯</i>${esc(L('Reaches a goal'))}</button></div>`;
    const n = filterCount();
    $('exFilterCount').textContent = n; $('exFilterCount').classList.toggle('hidden', !n);
    $('exFiltersBtn').classList.toggle('on', $('exFilters').classList.contains('open'));
  }
  async function load(more) {
    const id = ++ex.req;
    ex.loading = true; ex.error = null;
    if (!more) { ex.items = []; ex.total = 0; $('exBody').scrollTop = 0; }
    renderGrid();
    const p = new URLSearchParams({ sort: ex.sort, offset: more ? ex.items.length : 0, limit: 24 });
    if (ex.q) p.set('q', ex.q);
    if (ex.room) p.set('room', ex.room);
    if (ex.tags.size) p.set('tags', [...ex.tags].join(','));
    if (ex.size) p.set('size', ex.size);
    if (ex.goal) p.set('goal', '1');
    try {
      const r = await api('GET', 'coasters?' + p);
      if (id !== ex.req) return;
      ex.items = more ? ex.items.concat(r.items) : r.items; ex.total = r.total;
    } catch (e) { if (id !== ex.req) return; ex.error = e; }
    ex.loading = false;
    renderGrid();
  }
  function card(c) {
    const room = roomOf(c.room), fresh = Date.now() - c.created < 2 * 864e5;
    return `<button class="exCard" data-try="${c.id}">
      <span class="exThumb">${c.thumb ? `<img loading="lazy" src="api/thumbs/${c.id}.jpg" alt="">` : `<span class="noThumb">${room.icon}</span>`}
        <span class="exRoom" title="${esc(L(room.name))}">${room.icon}</span>${fresh ? `<span class="exNew">${esc(L('New!'))}</span>` : ''}
        <span class="exPlays" title="${esc(L('{0} players tried it', c.plays))}">▶ ${fmt(c.plays)}</span>
        <span class="exTry"><i>▶</i>${esc(L('Try it'))}</span></span>
      <span class="exInfo"><b class="exName">${esc(c.name)}</b>
        <span class="exBy">${esc(c.author || L('Anonymous builder'))} · ${esc(ago(c.created))}</span>
        <span class="exFoot"><span class="exTags">${c.goal ? `<span title="${esc(L('Reaches a goal'))}">🎯</span>` : ''}${tagIcons(c.tags)}</span>
          <span class="exNums"><span title="${esc(L('Pieces'))}">🧩 ${c.count}</span>${c.time ? `<span title="${esc(L('Ride time'))}">⏱ ${Math.round(c.time)}${esc(L('s'))}</span>` : ''}<span class="exLikes${liked.has(c.id) ? ' on' : ''}" title="${esc(L('Likes'))}">${liked.has(c.id) ? '❤️' : '🤍'} ${fmt(c.likes)}</span></span></span></span>
    </button>`;
  }
  function renderGrid() {
    const filtered = ex.q || ex.room || filterCount();
    $('exMeta').innerHTML = ex.loading && !ex.items.length ? '' : ex.error ? ''
      : `<span>${esc(ex.total === 1 ? L('1 coaster') : L('{0} coasters', fmt(ex.total)))}</span>${filtered ? `<button class="exClear" data-clear="1">✕ ${esc(L('Clear filters'))}</button>` : ''}`;
    if (ex.error && !ex.items.length) {
      $('exGrid').innerHTML = `<div class="exEmpty"><i>📡</i><b>${esc(errText(ex.error))}</b><button class="exBtn" data-retry="1">↻ ${esc(L('Try again'))}</button></div>`;
    } else if (ex.loading && !ex.items.length) {
      $('exGrid').innerHTML = Array.from({ length: 8 }, () => '<span class="exCard skel"><span class="exThumb"></span><span class="exInfo"><b></b><span></span></span></span>').join('');
    } else if (!ex.items.length) {
      $('exGrid').innerHTML = filtered
        ? `<div class="exEmpty"><i>🔎</i><b>${esc(L('No coasters match.'))}</b><span>${esc(L('Try other words or fewer filters.'))}</span><button class="exBtn" data-clear="1">✕ ${esc(L('Clear filters'))}</button></div>`
        : `<div class="exEmpty"><i>🎢</i><b>${esc(L('No coasters yet. Yours could be the first!'))}</b><button class="exBtn primary" data-publish="1">🌍 ${esc(L('Publish yours'))}</button></div>`;
    } else $('exGrid').innerHTML = ex.items.map(card).join('');
    const more = ex.items.length < ex.total;
    $('exMore').innerHTML = ex.loading && ex.items.length ? '<span class="exSpin"></span>'
      : ex.error && ex.items.length ? `<button class="exBtn" data-retry="more">↻ ${esc(L('Try again'))}</button>`
      : more ? `<button class="exBtn" data-more="1">${esc(L('Show more'))}</button>` : ex.items.length > 8 ? `<span class="exEnd">${esc(L("That's all of them! 🎉"))}</span>` : '';
  }
  let qTimer = 0;
  $('exQ').addEventListener('input', () => {
    $('exQClear').classList.toggle('hidden', !$('exQ').value);
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { const q = $('exQ').value.trim(); if (q !== ex.q) { ex.q = q; load(false); } }, 280);
  });
  $('exQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(qTimer); ex.q = $('exQ').value.trim(); load(false); $('exQ').blur(); } });
  $('exQClear').onclick = (e) => { e.preventDefault(); $('exQ').value = ''; ex.q = ''; $('exQClear').classList.add('hidden'); load(false); $('exQ').focus(); };
  $('exFiltersBtn').onclick = () => { $('exFilters').classList.toggle('open'); renderControls(); sound.click(); };
  $('exploreModal').addEventListener('click', (e) => {
    const t = e.target.closest('[data-try]');
    if (t) { tryCoaster(t.dataset.try, t); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sort) { ex.sort = b.dataset.sort; renderControls(); load(false); }
    else if (b.dataset.room !== undefined) { ex.room = b.dataset.room; renderControls(); load(false); }
    else if (b.dataset.tag) { ex.tags.has(b.dataset.tag) ? ex.tags.delete(b.dataset.tag) : ex.tags.add(b.dataset.tag); renderControls(); load(false); }
    else if (b.dataset.size) { ex.size = ex.size === b.dataset.size ? '' : b.dataset.size; renderControls(); load(false); }
    else if (b.dataset.goal) { ex.goal = !ex.goal; renderControls(); load(false); }
    else if (b.dataset.clear) { ex.q = ''; ex.room = ''; ex.tags.clear(); ex.size = ''; ex.goal = false; renderControls(); load(false); }
    else if (b.dataset.retry) load(b.dataset.retry === 'more');
    else if (b.dataset.more) load(true);
    else if (b.dataset.publish) openPublish();
    else return;
    sound.click();
  });
  // more coasters as you scroll down
  $('exBody').addEventListener('scroll', () => {
    const el = $('exBody');
    if (!ex.loading && !ex.error && ex.items.length < ex.total && el.scrollTop + el.clientHeight > el.scrollHeight - 400) load(true);
  }, { passive: true });

  // ================================================================ trying a coaster
  async function tryCoaster(id, el) {
    if (el) el.classList.add('busy');
    try {
      const c = await api('GET', 'coasters/' + id);
      app.closeModals();
      if (!app.startVisit(c)) return;
      if (!isMine(id)) {
        // a player who tries it counts once, however often they come back
        api('POST', `coasters/${id}/play`, { client }).then(r => { if (S.visit && S.visit.id === id) { S.visit.plays = r.plays; renderVisit(); } }).catch(() => {});
      }
    } catch (e) { toast(errText(e), true); sound.error(); }
    finally { if (el) el.classList.remove('busy'); }
  }
  function renderVisit() {
    const v = S.visit;
    $('visitBar').classList.toggle('hidden', !v);
    document.body.classList.toggle('visiting', !!v);
    hideAsk();
    if (!v) return;
    const mine = isMine(v.id), on = liked.has(v.id);
    $('vbName').textContent = v.name;
    $('vbBy').textContent = mine ? L('by you') : L('by {0}', v.author || L('Anonymous builder'));
    $('vbPlays').textContent = `▶ ${fmt(v.plays)}`; $('vbPlays').title = L('{0} players tried it', v.plays);
    $('vbLikes').textContent = `❤️ ${fmt(v.likes)}`; $('vbLikes').title = L('Likes');
    $('vbLike').classList.toggle('on', on);
    $('vbLike').querySelector('i').textContent = on ? '❤️' : '🤍';
    $('vbLike').querySelector('span').textContent = L(on ? 'Liked' : 'Like');
    $('vbLike').classList.toggle('hidden', mine); $('vbReport').classList.toggle('hidden', mine);
  }
  $('vbLike').onclick = () => {
    const v = S.visit;
    if (!v) return;
    const on = !liked.has(v.id);
    on ? liked.add(v.id) : liked.delete(v.id); saveLiked();
    v.likes = Math.max(0, v.likes + (on ? 1 : -1));
    renderVisit();
    if (on) { sound.place && sound.place(); app.cheer(); } else sound.click();
    api('POST', `coasters/${v.id}/like`, { client, on }).then(r => { if (S.visit && S.visit.id === v.id) { v.likes = r.likes; renderVisit(); } }).catch(() => {});
  };
  $('vbCopy').onclick = () => { app.saveCopy(); sound.click(); };
  $('vbBack').onclick = () => { app.endVisit(); sound.click(); };
  const hideAsk = () => { $('vbAsk').classList.add('hidden'); $('visitBar').classList.remove('asking'); };
  $('vbReport').onclick = () => { $('vbAsk').classList.remove('hidden'); $('visitBar').classList.add('asking'); sound.click(); };
  $('vbAskNo').onclick = hideAsk;
  $('vbAskYes').onclick = () => {
    const v = S.visit;
    hideAsk();
    if (!v) return;
    api('POST', `coasters/${v.id}/report`, { client }).catch(() => {});
    toast(L('Thanks for telling us. We will take a look.'));
  };

  // ================================================================ publishing
  let pub = null;
  function openPublish() {
    app.closeModals();
    if (S.visit) { toast(L("This is someone else's coaster. Go back to yours to publish it."), true); sound.error(); return; }
    const cur = app.current();
    if (!cur.pieces.some(p => p.type === 'start' || p.type === 'musicbox')) { toast(L('Your coaster needs a 📍 Start Tower first.'), true); sound.error(); return; }
    pub = { cur, thumb: app.shot() };
    const room = roomOf(cur.room);
    $('pubThumb').src = pub.thumb || '';
    $('pubThumb').classList.toggle('hidden', !pub.thumb);
    $('pubFacts').innerHTML = `<span>${room.icon} ${esc(L(room.name))}</span><span>🧩 ${esc(L('{0} pieces', cur.pieces.length))}</span>` +
      (cur.goal ? `<span class="ok">🎯 ${esc(L('Reaches a goal'))}${cur.time ? ` · ⏱ ${Math.round(cur.time)}${esc(L('s'))}` : ''}</span>` : '');
    $('pubName').value = cur.name || '';
    $('pubAuthor').value = store.get('bc.author', '');
    $('pubWarn').textContent = cur.goal ? '' : L("Tip: the ball doesn't reach a goal yet. Players love a finish! ✨ on the build pad can make one.");
    $('pubWarn').classList.toggle('hidden', cur.goal);
    $('pubErr').classList.add('hidden');
    $('pubForm').classList.remove('hidden'); $('pubDone').classList.add('hidden');
    setBusy(false);
    $('publishModal').classList.remove('hidden');
    setTimeout(() => { const n = $('pubName'); n.focus(); n.select(); }, 30);
  }
  function setBusy(on) {
    $('pubGo').disabled = on;
    $('pubGo').querySelector('span').textContent = L(on ? 'Publishing…' : 'Publish');
  }
  function showErr(text, html) { const el = $('pubErr'); el.innerHTML = html || esc(text); el.classList.remove('hidden'); sound.error(); }
  async function doPublish() {
    if (!pub) return;
    const name = $('pubName').value.trim(), author = $('pubAuthor').value.trim();
    if (!name) { showErr(L(ERRORS.name)); $('pubName').focus(); return; }
    store.set('bc.author', author);
    setBusy(true);
    $('pubErr').classList.add('hidden');
    try {
      const { cur } = pub;
      const r = await api('POST', 'coasters', { client, name, author, room: cur.room, v: cur.v, pieces: cur.pieces, time: cur.time, goal: cur.goal, thumb: pub.thumb });
      store.set('bc.published', [{ id: r.id, key: r.editKey, name: r.coaster.name, room: cur.room, t: Date.now() }, ...published()].slice(0, 100));
      app.setName(r.coaster.name);
      $('pubLink').value = shareUrl(r.id);
      $('pubDoneMsg').textContent = L('“{0}” is in Explore now. Send the link to your friends!', r.coaster.name);
      $('pubForm').classList.add('hidden'); $('pubDone').classList.remove('hidden');
      pub.id = r.id;
      popularAt = 0;
      app.cheer();
    } catch (e) {
      if (e.code === 'duplicate' && e.data && e.data.id) showErr('', `${esc(L(ERRORS.duplicate))} <button class="mmLink" data-open="${esc(e.data.id)}">${esc(L('Open it'))}</button>`);
      else showErr(errText(e));
      if (e.code === 'name-unfriendly') $('pubName').focus();
      if (e.code === 'author-unfriendly') $('pubAuthor').focus();
    } finally { setBusy(false); }
  }
  $('pubGo').onclick = doPublish;
  for (const id of ['pubName', 'pubAuthor']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') doPublish(); });
  $('pubErr').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) tryCoaster(b.dataset.open); });
  $('pubCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('pubLink').value); toast(L('🔗 Link copied — send it to a friend!')); }
    catch { $('pubLink').select(); }
  };
  $('pubSee').onclick = () => { ex.sort = 'new'; ex.q = ''; ex.room = ''; ex.tags.clear(); ex.size = ''; ex.goal = false; openExplore(); };

  // ================================================================ your published coasters (in My coasters)
  let stats = {};
  function renderPublished() {
    const list = published();
    $('galPubWrap').classList.toggle('hidden', !list.length);
    if (!list.length) return;
    $('galPub').innerHTML = list.map(p => {
      const s = stats[p.id];
      if (s && s.gone) return '';
      return `<div class="pubRow" data-id="${esc(p.id)}"><span class="pubRoom">${roomOf(p.room).icon}</span><b>${esc(p.name)}</b>
        <span class="pubNums">${s ? `▶ ${fmt(s.plays)} <span>❤️ ${fmt(s.likes)}</span>${s.hidden ? ` <em>${esc(L('hidden after reports'))}</em>` : ''}` : '…'}</span>
        <span class="pubActs"><button data-pv="open" title="${esc(L('Try it'))}">▶</button><button data-pv="link" title="${esc(L('Copy link'))}">🔗</button><button data-pv="del" class="del" title="${esc(L('Unpublish'))}">🗑</button></span></div>`;
    }).join('');
    const ids = list.map(p => p.id).join(',');
    api('GET', 'stats?ids=' + ids).then(r => {
      let changed = false;
      for (const s of r.items) { if (JSON.stringify(stats[s.id]) !== JSON.stringify(s)) changed = true; stats[s.id] = s; }
      // coasters the library no longer has drop off the list
      if (r.items.some(s => s.gone)) store.set('bc.published', published().filter(p => !stats[p.id] || !stats[p.id].gone));
      if (changed && !$('galleryModal').classList.contains('hidden')) renderPublished();
    }).catch(() => {});
  }
  $('galPub').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pv]'), row = b && b.closest('[data-id]');
    if (!row) return;
    const p = published().find(x => x.id === row.dataset.id);
    if (!p) return;
    if (b.dataset.pv === 'open') tryCoaster(p.id);
    else if (b.dataset.pv === 'link') { try { await navigator.clipboard.writeText(shareUrl(p.id)); toast(L('🔗 Link copied — send it to a friend!')); } catch { window.prompt(L('Copy this link:'), shareUrl(p.id)); } }
    else if (b.dataset.pv === 'del') {
      // a second tap confirms
      if (!b.classList.contains('sure')) { b.classList.add('sure'); b.textContent = L('Unpublish?'); setTimeout(() => { b.classList.remove('sure'); b.textContent = '🗑'; }, 3000); return; }
      try {
        await api('DELETE', 'coasters/' + p.id, null, { 'X-Edit-Key': p.key });
        store.set('bc.published', published().filter(x => x.id !== p.id));
        toast(L('Unpublished. It is still in My coasters if you saved it.'));
        popularAt = 0;
        renderPublished();
      } catch (err) { toast(errText(err), true); }
    }
  });

  // ================================================================ a link straight to a coaster: ?play=abc1234
  function deepLink() {
    const id = new URLSearchParams(location.search).get('play');
    if (!id) return false;
    const u = new URL(location.href); u.searchParams.delete('play');
    window.history.replaceState(null, '', u.pathname + u.search + u.hash);
    if (/^[a-z0-9]{7}$/.test(id)) setTimeout(() => tryCoaster(id), 300);
    return true;
  }

  return { openMenu, openExplore, openPublish, renderVisit, renderPublished, deepLink, tryCoaster };
}
