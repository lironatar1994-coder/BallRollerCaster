// Sharing a coaster: a link that carries the whole build (compressed into the URL), a local
// gallery of saved coasters with thumbnails, and saving the replay as a video.

const b64url = {
  enc(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(str) { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); },
};
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

// numbers are rounded so the link stays short
const slim = (pieces) => JSON.stringify(pieces, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v);

export async function encodeCoaster(data) {
  const raw = new TextEncoder().encode(JSON.stringify({ ...data, pieces: JSON.parse(slim(data.pieces)) }));
  if (typeof CompressionStream === 'undefined') return 'j' + b64url.enc(raw);
  return 'z' + b64url.enc(await pipe(raw, new CompressionStream('deflate-raw')));
}
export async function decodeCoaster(code) {
  const kind = code[0], bytes = b64url.dec(code.slice(1));
  const raw = kind === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  const data = JSON.parse(new TextDecoder().decode(raw));
  if (!data || !Array.isArray(data.pieces)) throw new Error('not a coaster');
  return data;
}
export async function shareLink(data) {
  const url = new URL(location.href);
  url.hash = 'c=' + await encodeCoaster(data);
  return url.toString();
}
export function linkCode() {
  const m = /[#&]c=([A-Za-z0-9_-]+)/.exec(location.hash);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- local gallery
const KEY = 'bc.gallery';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
const write = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; } };
export const gallery = {
  list: read,
  save(entry) {
    const list = read().filter(e => e.id !== entry.id);
    list.unshift(entry);
    while (list.length > 24) list.pop();
    // thumbnails are the big part: drop old ones if storage is full
    while (!write(list) && list.length > 1) list.pop();
  },
  remove(id) { write(read().filter(e => e.id !== id)); },
};

// a small JPEG of the current view, for gallery cards
export function thumbnail(canvas, w = 240) {
  const h = Math.round(w * canvas.height / canvas.width);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(canvas, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.72);
}

// ---------------------------------------------------------------- video of the replay
export class VideoRecorder {
  constructor(canvas) { this.canvas = canvas; this.rec = null; this.chunks = []; }
  get supported() { return typeof MediaRecorder !== 'undefined' && !!this.canvas.captureStream; }
  get active() { return !!this.rec; }
  start() {
    const stream = this.canvas.captureStream(30);
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    this.type = type || 'video/webm';
    this.rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6e6 } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(250);
  }
  stop(name = 'ball-coaster') {
    return new Promise((resolve) => {
      if (!this.rec) return resolve(false);
      this.rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.type });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${name}.${this.type.includes('mp4') ? 'mp4' : 'webm'}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        resolve(true);
      };
      this.rec.stop();
      this.rec = null;
    });
  }
}
