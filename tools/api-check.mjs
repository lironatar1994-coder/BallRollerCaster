// Pre-deploy check of the coaster library (server/api.cjs), run by deploy.ps1:  node tools/api-check.mjs
// Publishes, lists, searches, filters, counts plays and likes and deletes, against a throwaway folder.
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

const require = createRequire(import.meta.url);
const { createApi, unfriendly } = require('../server/api.cjs');
const dir = mkdtempSync(path.join(tmpdir(), 'bc-api-'));
const api = createApi({ dataDir: dir });
const server = http.createServer((req, res) => api(req, res, req.url).then(h => { if (!h) { res.writeHead(404); res.end(); } }));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let failed = 0;
const fail = (msg) => { console.error(`[FAIL] api: ${msg}`); failed++; };
const call = async (method, url, body, headers = {}) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.arrayBuffer() };
};
const piece = (id, type, extra = {}) => ({ id, type, slope: 0.05, style: 'channel', color: 'red', opts: { len: 0.2 }, port: { x: 0, y: 0.0084, z: 0, psi: 0, phi: 0 }, ...extra });
const client = 'ab'.repeat(16), client2 = 'cd'.repeat(16);
const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');

try {
  const a = await call('POST', '/coasters', { client, name: 'Loopy  Land', author: 'Noa', room: 'kids', v: 2, time: 12.3, goal: true, thumb: jpeg, pieces: [piece(1, 'start'), piece(2, 'loop'), piece(3, 'helix'), piece(4, 'cup')] });
  if (a.status !== 201 || !a.body.id || !a.body.editKey) fail(`publish → ${a.status} ${JSON.stringify(a.body)}`);
  if (a.body.coaster?.name !== 'Loopy Land') fail('names are tidied (double spaces)');
  const b = await call('POST', '/coasters', { client, name: 'Kitchen Run', room: 'kitchen', pieces: [piece(1, 'start'), piece(2, 'lift', { opts: { height: 0.3 } })] });
  if (b.status !== 201) fail(`second publish → ${b.status}`);
  const dup = await call('POST', '/coasters', { client, name: 'Copy', room: 'kids', pieces: [piece(1, 'start'), piece(2, 'loop'), piece(3, 'helix'), piece(4, 'cup')] });
  if (dup.status !== 409 || dup.body.id !== a.body.id) fail('the same coaster twice is refused, pointing at the first');
  for (const [why, body, code] of [
    ['a rude name', { name: 'f u c k this', room: 'kids', pieces: [piece(1, 'start')] }, 'name-unfriendly'],
    ['no name', { name: '  ', room: 'kids', pieces: [piece(1, 'start')] }, 'name'],
    ['an unknown room', { name: 'X', room: 'moon', pieces: [piece(1, 'start')] }, 'room'],
    ['an unknown piece', { name: 'X', room: 'kids', pieces: [piece(1, 'start'), piece(2, 'rocket')] }, 'pieces'],
    ['no start tower', { name: 'X', room: 'kids', pieces: [piece(1, 'straight')] }, 'no-start'],
    ['a bad number', { name: 'X', room: 'kids', pieces: [piece(1, 'start', { slope: 'x'.repeat(50) })] }, 'pieces'],
  ]) {
    const r = await call('POST', '/coasters', { client, ...body });
    if (r.status !== 400 || r.body.error !== code) fail(`${why} → ${r.status} ${JSON.stringify(r.body)}`);
  }
  if (unfriendly('Classic Sussex Coaster') || unfriendly('Happen is fun') || !unfriendly('sh1t')) fail('name filter');

  const all = await call('GET', '/coasters');
  if (all.body.total !== 2) fail(`list total ${all.body.total}`);
  const s = await call('GET', '/coasters?q=loopy');
  if (s.body.items?.[0]?.id !== a.body.id || s.body.total !== 1) fail('search by name');
  const byAuthor = await call('GET', '/coasters?q=NOA');
  if (byAuthor.body.total !== 1) fail('search by builder, any case');
  if ((await call('GET', '/coasters?room=kitchen')).body.items?.[0]?.id !== b.body.id) fail('room filter');
  if ((await call('GET', '/coasters?tags=loop,spiral')).body.total !== 1) fail('feature filter');
  if ((await call('GET', '/coasters?tags=lift')).body.items?.[0]?.id !== b.body.id) fail('lift tag');
  if ((await call('GET', '/coasters?goal=1')).body.total !== 1) fail('goal filter');

  await call('POST', `/coasters/${a.body.id}/play`, { client });
  await call('POST', `/coasters/${a.body.id}/play`, { client });
  const p = await call('POST', `/coasters/${a.body.id}/play`, { client: client2 });
  if (p.body.plays !== 2) fail(`plays count each player once (${p.body.plays})`);
  const l = await call('POST', `/coasters/${b.body.id}/like`, { client });
  if (l.body.likes !== 1) fail('like');
  if ((await call('GET', '/coasters?sort=loved')).body.items?.[0]?.id !== b.body.id) fail('sort by loved');
  const un = await call('POST', `/coasters/${b.body.id}/like`, { client, on: false });
  if (un.body.likes !== 0) fail('unlike');
  if ((await call('GET', '/coasters?sort=popular')).body.items?.[0]?.id !== a.body.id) fail('sort by popular');

  const one = await call('GET', `/coasters/${a.body.id}`);
  if (one.body.pieces?.length !== 4 || one.body.plays !== 2) fail('open one coaster');
  const t = await call('GET', `/thumbs/${a.body.id}.jpg`);
  if (t.status !== 200 || t.body.byteLength !== 7) fail('thumbnail');
  const st = await call('GET', `/stats?ids=${a.body.id},${b.body.id}`);
  if (st.body.items?.[0]?.plays !== 2) fail('stats');

  for (const c of ['11'.repeat(16), '22'.repeat(16), '33'.repeat(16)]) await call('POST', `/coasters/${b.body.id}/report`, { client: c });
  if ((await call('GET', '/coasters')).body.total !== 1) fail('reported coasters are hidden');

  if ((await call('DELETE', `/coasters/${a.body.id}`, null, { 'X-Edit-Key': 'wrong' })).status !== 403) fail('delete needs the edit key');
  if ((await call('DELETE', `/coasters/${a.body.id}`, null, { 'X-Edit-Key': a.body.editKey })).status !== 200) fail('delete with the key');
  if ((await call('GET', `/coasters/${a.body.id}`)).status !== 404) fail('deleted is gone');
  if ((await call('GET', '/coasters/../../etc')).status !== 404) fail('odd paths');

  // everything survives a restart
  api.flush();
  const again = createApi({ dataDir: dir });
  const srv2 = http.createServer((req, res) => again(req, res, req.url));
  await new Promise(r => srv2.listen(0, '127.0.0.1', r));
  const r2 = await (await fetch(`http://127.0.0.1:${srv2.address().port}/stats?ids=${b.body.id}`)).json();
  if (r2.items?.[0]?.hidden !== true) fail('counters are saved');
  srv2.close();
} catch (e) {
  fail(e.stack || e.message);
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
if (failed) { process.exitCode = 1; console.error('[FAIL] Coaster library check failed.'); }
else console.log('[OK] coaster library: publish, search, filters, plays, likes, reports, delete');
