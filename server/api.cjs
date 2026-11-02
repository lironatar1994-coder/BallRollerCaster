// The coaster library: players publish their coasters, and everyone can search, filter and try them.
// Plain Node, no packages. Every coaster is two small JSON files (its details and counters, and its
// pieces) plus a thumbnail. The list lives in memory; changed counters are written back a moment later.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOMS = ['kids', 'kitchen', 'bath', 'garden', 'attic'];
// every piece the game knows (src/track.js PIECES): anything else could not be built
const TYPES = new Set(('start musicbox straight curve helix loop drop jump switch turnstile splitter hammer bucket hat airhill plinko xylo funnel lift ' +
  'cup catcher basket tramp tunnel wheel seesaw dominoes bell bumper brake booster gate sensor photo screw elevator pool blocks decor bridge').split(' '));
// the feature filters, and the pieces that earn each one
const TAGS = {
  loop: ['loop'], lift: ['lift', 'screw', 'elevator'], spiral: ['helix'], jump: ['jump', 'tramp', 'airhill'],
  music: ['xylo', 'bell', 'musicbox'], water: ['pool', 'wheel'], switch: ['switch', 'splitter', 'gate', 'turnstile'],
  gadgets: ['booster', 'brake', 'sensor', 'photo', 'hammer', 'bucket', 'hat', 'plinko', 'dominoes', 'seesaw', 'bumper'],
};
const SIZES = { s: [1, 14], m: [15, 40], l: [41, Infinity] };
const LIMIT = { body: 420 * 1024, pieces: 800, piecesBytes: 260 * 1024, thumb: 140 * 1024, name: 40, author: 24 };
const ID = /^[a-z0-9]{7}$/, CLIENT = /^[a-f0-9]{16,64}$/;
// a few reports hide a coaster (unless many more players like it)
const hiddenBy = (m) => m.reports.size >= 3 && m.reports.size * 4 > m.likes.size;

// ---------------------------------------------------------------- friendly names
// This is a game for children: names with swear words are turned away. Short words only count as
// whole words, so "Classic" or "Sussex" stay fine. Anything else can be reported by players.
const WHOLE = ['ass', 'sex', 'fag', 'cum', 'tits', 'dick', 'cock', 'porn', 'nazi', 'rape', 'kkk', 'xxx', 'זין', 'זונה', 'חרא', 'נאצי'];
const ANYWHERE = ['fuck', 'shit', 'bitch', 'cunt', 'pussy', 'asshole', 'bastard', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'retard', 'hitler',
  'penis', 'vagina', 'boobs', 'dildo', 'wanker', 'twat', 'שרמוטה', 'מזדיין', 'לזיין', 'כוסית', 'כוסאמק', 'מניאק', 'היטלר', 'אונס', 'סקס', 'פורנו'];
function unfriendly(text) {
  const t = (' ' + text.toLowerCase().normalize('NFKD').replace(/[̀-֑ͯ-ׇ]/g, '')
    .replace(/[@4]/g, 'a').replace(/[3]/g, 'e').replace(/[1!|]/g, 'i').replace(/[0]/g, 'o').replace(/[$5]/g, 's')
    .replace(/[^a-zא-ת]+/g, ' ') + ' ')
    // letters spelled out one by one ("f u c k") are read as one word
    .replace(/(?<= [a-zא-ת]) (?=[a-zא-ת] )/g, '');
  return WHOLE.some(w => t.includes(' ' + w + ' ')) || ANYWHERE.some(w => t.includes(w));
}
const cleanText = (v, max) => String(v ?? '').normalize('NFC')
  .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩<>]/g, '')
  .replace(/\s+/g, ' ').trim().slice(0, max);
// a forgiving search: no case, no accents or Hebrew vowel marks
const fold = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-֑ͯ-ׇ]/g, '');

// ---------------------------------------------------------------- pieces
class Bad extends Error { constructor(code, status = 400, extra) { super(code); this.code = code; this.status = status; this.extra = extra; } }
// only plain numbers, short strings, flags and small lists, never deeper than a piece's options
function cleanValue(v, depth) {
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Bad('pieces'); return Math.round(v * 1e5) / 1e5; }
  if (typeof v === 'string') { if (v.length > 40) throw new Bad('pieces'); return v; }
  if (typeof v === 'boolean' || v === null) return v;
  if (depth > 3) throw new Bad('pieces');
  if (Array.isArray(v)) { if (v.length > 64) throw new Bad('pieces'); return v.map(x => cleanValue(x, depth + 1)); }
  if (typeof v === 'object') {
    const out = {}, keys = Object.keys(v);
    if (keys.length > 40) throw new Bad('pieces');
    for (const k of keys) { if (!/^[a-zA-Z0-9_]{1,24}$/.test(k)) throw new Bad('pieces'); out[k] = cleanValue(v[k], depth + 1); }
    return out;
  }
  throw new Bad('pieces');
}
function cleanPieces(list) {
  if (!Array.isArray(list) || !list.length || list.length > LIMIT.pieces) throw new Bad('pieces');
  const out = list.map(p => {
    if (!p || typeof p !== 'object' || Array.isArray(p) || !TYPES.has(p.type)) throw new Bad('pieces');
    const d = cleanValue(p, 0);
    delete d.locked; // a mission's fixed pieces are the player's own once published
    return d;
  });
  if (!out.some(p => p.type === 'start' || p.type === 'musicbox')) throw new Bad('no-start');
  if (JSON.stringify(out).length > LIMIT.piecesBytes) throw new Bad('too-big', 413);
  return out;
}
const tagsOf = (pieces) => Object.keys(TAGS).filter(t => pieces.some(p => TAGS[t].includes(p.type)));

// ---------------------------------------------------------------- storage
function createStore(dir) {
  const dirs = { meta: path.join(dir, 'meta'), pieces: path.join(dir, 'pieces'), thumbs: path.join(dir, 'thumbs') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const file = (kind, id) => path.join(dirs[kind], id + (kind === 'thumbs' ? '.jpg' : '.json'));
  // written to a side file first, so a crash never leaves half a file
  const writeAtomic = (f, data) => { const tmp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); };
  const all = new Map();
  for (const f of fs.readdirSync(dirs.meta)) {
    if (!f.endsWith('.json')) continue;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dirs.meta, f), 'utf8'));
      if (!m || !ID.test(m.id)) continue;
      for (const k of ['plays', 'likes', 'reports']) m[k] = new Set(m[k] || []);
      m.search = fold(m.name + ' ' + m.author);
      all.set(m.id, m);
    } catch { /* a damaged file is skipped, not fatal */ }
  }
  const dirty = new Set();
  const toJSON = (m) => JSON.stringify({ ...m, search: undefined, plays: [...m.plays], likes: [...m.likes], reports: [...m.reports] });
  function flush() { for (const id of dirty) { const m = all.get(id); if (m) writeAtomic(file('meta', id), toJSON(m)); } dirty.clear(); }
  const timer = setInterval(flush, 2000); timer.unref();
  return {
    all, file, flush,
    touch(id) { dirty.add(id); },
    add(m, pieces, thumb) {
      writeAtomic(file('pieces', m.id), JSON.stringify({ v: m.v, pieces }));
      if (thumb) writeAtomic(file('thumbs', m.id), thumb);
      writeAtomic(file('meta', m.id), toJSON(m));
      all.set(m.id, m);
    },
    remove(id) {
      all.delete(id); dirty.delete(id);
      for (const k of ['meta', 'pieces', 'thumbs']) fs.rmSync(file(k, id), { force: true });
    },
    pieces(id) { return JSON.parse(fs.readFileSync(file('pieces', id), 'utf8')); },
  };
}

// ---------------------------------------------------------------- limits per visitor (memory only)
function limiter() {
  const hits = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, h] of hits) if (h.reset < t) hits.delete(k); }, 60000).unref();
  const get = (key, ms) => { const t = Date.now(); let h = hits.get(key); if (!h || h.reset < t) { h = { n: 0, reset: t + ms }; hits.set(key, h); } return h; };
  // allow(...) counts this attempt; room(...) only looks, so a refused try costs nothing
  const allow = (key, max, ms) => ++get(key, ms).n <= max;
  allow.room = (key, max, ms) => get(key, ms).n < max;
  return allow;
}

// ---------------------------------------------------------------- the API
function createApi({ dataDir }) {
  const store = createStore(dataDir);
  const allow = limiter();
  const hash = (id, client) => crypto.createHash('sha256').update(id + ':' + client).digest('hex').slice(0, 16);
  const newId = () => { let id; do id = Array.from(crypto.randomBytes(7), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b & 31]).join(''); while (store.all.has(id)); return id; };
  const pub = (m) => ({ id: m.id, name: m.name, author: m.author, room: m.room, count: m.count, tags: m.tags, time: m.time, goal: m.goal, plays: m.plays.size, likes: m.likes.size, created: m.created, thumb: m.thumb });

  function send(res, status, body, cache = 'no-store') {
    const data = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const parts = [];
      req.on('data', (c) => { size += c.length; if (size > LIMIT.body) { reject(new Bad('too-big', 413)); req.destroy(); } else parts.push(c); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { reject(new Bad('bad-json')); } });
      req.on('error', reject);
    });
  }
  // nginx tells us who is asking; only trust that when nginx (on this machine) is the one telling
  const ipOf = (req) => { const a = req.socket.remoteAddress || ''; const fwd = req.headers['x-real-ip']; return fwd && /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(a) ? String(fwd) : a; };
  const clientOf = (body) => { const c = String(body.client || ''); if (!CLIENT.test(c)) throw new Bad('client'); return c; };
  const find = (id) => { const m = ID.test(id) && store.all.get(id); if (!m || hiddenBy(m)) throw new Bad('not-found', 404); return m; };

  function list(q) {
    const words = fold(cleanText(q.get('q'), 60)).split(' ').filter(Boolean);
    const room = q.get('room'), size = SIZES[q.get('size')], goal = q.get('goal') === '1';
    const tags = (q.get('tags') || '').split(',').filter(t => TAGS[t]);
    let items = [...store.all.values()].filter(m => !hiddenBy(m)
      && (!ROOMS.includes(room) || m.room === room)
      && (!size || (m.count >= size[0] && m.count <= size[1]))
      && (!goal || m.goal)
      && tags.every(t => m.tags.includes(t))
      && words.every(w => m.search.includes(w)));
    const sort = q.get('sort');
    const score = sort === 'new' ? (m) => m.created : sort === 'loved' ? (m) => m.likes.size * 1e13 + m.created : (m) => (m.plays.size + m.likes.size * 3) * 1e13 + m.created;
    items.sort((a, b) => score(b) - score(a));
    const offset = Math.max(0, Math.min(10000, parseInt(q.get('offset'), 10) || 0)), limit = Math.max(1, Math.min(48, parseInt(q.get('limit'), 10) || 24));
    return { total: items.length, items: items.slice(offset, offset + limit).map(pub) };
  }

  async function publish(req, res) {
    const ip = ipOf(req);
    // six new coasters an hour and twenty a day from one address (tries that were turned away don't count)
    if (!allow('try:' + ip, 60, 3600e3) || !allow.room('pub:h:' + ip, 6, 3600e3) || !allow.room('pub:d:' + ip, 20, 86400e3)) throw new Bad('slow-down', 429);
    const b = await readBody(req);
    clientOf(b);
    const name = cleanText(b.name, LIMIT.name), author = cleanText(b.author, LIMIT.author);
    if (!name) throw new Bad('name');
    if (unfriendly(name)) throw new Bad('name-unfriendly');
    if (author && unfriendly(author)) throw new Bad('author-unfriendly');
    if (!ROOMS.includes(b.room)) throw new Bad('room');
    const pieces = cleanPieces(b.pieces);
    const piecesHash = crypto.createHash('sha256').update(JSON.stringify(pieces)).digest('hex').slice(0, 24);
    for (const m of store.all.values()) if (m.piecesHash === piecesHash) throw new Bad('duplicate', 409, { id: m.id });
    let thumb = null;
    const tm = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.thumb || ''));
    if (tm) {
      thumb = Buffer.from(tm[1], 'base64');
      if (thumb.length > LIMIT.thumb || thumb[0] !== 0xff || thumb[1] !== 0xd8 || thumb[2] !== 0xff) thumb = null;
    }
    const editKey = crypto.randomBytes(18).toString('base64url');
    const m = {
      id: newId(), name, author, room: b.room, v: Number.isInteger(b.v) ? b.v : 2, count: pieces.length, tags: tagsOf(pieces),
      time: Number.isFinite(+b.time) ? Math.max(0, Math.min(600, Math.round(+b.time * 10) / 10)) : 0, goal: b.goal === true,
      created: Date.now(), thumb: !!thumb, piecesHash, editKey: crypto.createHash('sha256').update(editKey).digest('hex'),
      plays: new Set(), likes: new Set(), reports: new Set(),
    };
    m.search = fold(name + ' ' + author);
    store.add(m, pieces, thumb);
    allow('pub:h:' + ip, 6, 3600e3); allow('pub:d:' + ip, 20, 86400e3);
    send(res, 201, { id: m.id, editKey, coaster: pub(m) });
  }

  async function counter(req, res, id, what) {
    const ip = ipOf(req);
    if (!allow('act:' + ip, 120, 60e3)) throw new Bad('slow-down', 429);
    const m = find(id), b = await readBody(req), h = hash(id, clientOf(b));
    if (what === 'play') {
      // one play per player; and one address cannot pile up plays by pretending to be many players
      if (!m.plays.has(h) && allow('play:' + ip + ':' + id, 3, 86400e3)) { m.plays.add(h); store.touch(id); }
    } else if (what === 'like') { if (b.on === false) m.likes.delete(h); else m.likes.add(h); store.touch(id); }
    else if (what === 'report') { m.reports.add(h); store.touch(id); }
    send(res, 200, { plays: m.plays.size, likes: m.likes.size });
  }

  // handles one request whose path starts after the API's prefix; false when it is not ours
  async function handle(req, res, rawPath) {
    const url = new URL(rawPath, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (req.method === 'GET' && parts[0] === 'health' && parts.length === 1) { send(res, 200, { ok: true, coasters: store.all.size }); return true; }
      if (parts[0] === 'coasters') {
        if (parts.length === 1 && req.method === 'GET') { send(res, 200, list(url.searchParams)); return true; }
        if (parts.length === 1 && req.method === 'POST') { await publish(req, res); return true; }
        if (parts.length === 2 && req.method === 'GET') {
          const m = find(parts[1]);
          send(res, 200, { ...pub(m), ...store.pieces(m.id) });
          return true;
        }
        if (parts.length === 2 && req.method === 'DELETE') {
          const m = ID.test(parts[1]) && store.all.get(parts[1]);
          if (!m) throw new Bad('not-found', 404);
          const key = String(req.headers['x-edit-key'] || '');
          if (crypto.createHash('sha256').update(key).digest('hex') !== m.editKey) throw new Bad('forbidden', 403);
          store.remove(m.id);
          send(res, 200, { ok: true });
          return true;
        }
        if (parts.length === 3 && req.method === 'POST' && ['play', 'like', 'report'].includes(parts[2])) { await counter(req, res, parts[1], parts[2]); return true; }
      }
      // how your own published coasters are doing
      if (parts[0] === 'stats' && parts.length === 1 && req.method === 'GET') {
        const ids = (url.searchParams.get('ids') || '').split(',').filter(i => ID.test(i)).slice(0, 60);
        send(res, 200, { items: ids.map(i => { const m = store.all.get(i); return m ? { id: i, plays: m.plays.size, likes: m.likes.size, hidden: hiddenBy(m) } : { id: i, gone: true }; }) });
        return true;
      }
      if (parts[0] === 'thumbs' && parts.length === 2 && req.method === 'GET') {
        const id = parts[1].replace(/\.jpg$/, '');
        const m = ID.test(id) && store.all.get(id);
        if (!m || !m.thumb || hiddenBy(m)) throw new Bad('not-found', 404);
        const data = fs.readFileSync(store.file('thumbs', id));
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800', 'X-Content-Type-Options': 'nosniff' });
        res.end(data);
        return true;
      }
      return false;
    } catch (e) {
      if (e instanceof Bad) send(res, e.status, { error: e.code, ...(e.extra || {}) });
      else { console.error(e); send(res, 500, { error: 'server' }); }
      return true;
    }
  }
  handle.flush = store.flush;
  return handle;
}

module.exports = { createApi, unfriendly, TYPES, TAGS };
