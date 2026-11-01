// Anonymous visit and engagement counts for the private ServerMonitor dashboard — the same
// bridge PDF Studio uses. Only on the live site; nginx adds the server key, the browser never sees it.
const VISITOR_KEY = 'ball-coaster.monitor.visitor';
const SESSION_KEY = 'ball-coaster.monitor.session';
const VISITOR_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GRID_SIZE = 12;

const randomId = () => crypto.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;

function visitorId() {
  try {
    const now = Date.now();
    const stored = JSON.parse(localStorage.getItem(VISITOR_KEY) || 'null');
    if (stored?.id && Number(stored.expiresAt) > now) return stored.id;
    const id = randomId();
    localStorage.setItem(VISITOR_KEY, JSON.stringify({ id, expiresAt: now + VISITOR_TTL_MS }));
    return id;
  } catch (e) { return randomId(); }
}
function sessionId() {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) return stored;
    const id = randomId();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch (e) { return randomId(); }
}

// next to index.html: /ball-coaster/.well-known/vee-visitor-signal
const signalUrl = () => new URL('.well-known/vee-visitor-signal', location.origin + location.pathname).pathname;
function post(payload, preferBeacon = false) {
  const body = JSON.stringify(payload);
  if (preferBeacon && navigator.sendBeacon && navigator.sendBeacon(signalUrl(), new Blob([body], { type: 'application/json' }))) return;
  fetch(signalUrl(), { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
}
const common = () => ({ event_id: randomId(), visitor_id: visitorId(), session_id: sessionId(), path: location.pathname, webdriver: navigator.webdriver === true });
const viewportClass = () => window.innerWidth <= 640 ? 'mobile' : window.innerWidth <= 1024 ? 'tablet' : 'desktop';

let tracker = null;
function start() { tracker = { startedAt: performance.now(), heatmap: new Map() }; }
function flush(preferBeacon = true) {
  const t = tracker;
  if (!t) return;
  tracker = null;
  const heatmap = [...t.heatmap.entries()].map(([cell, taps]) => { const [x, y] = cell.split(':').map(Number); return { x, y, taps }; }).sort((a, b) => b.taps - a.taps).slice(0, 60);
  post({ kind: 'engagement', ...common(), scroll_depth: 100, dwell_ms: Math.round(performance.now() - t.startedAt), viewport_width: window.innerWidth, viewport_class: viewportClass(), zones: [], views: [], heatmap }, preferBeacon);
}

export function startVisitorSignal() {
  const host = location.hostname;
  if (host !== 'lawebs.co.il' && !host.endsWith('.lawebs.co.il')) return;
  post(common());
  start();
  document.addEventListener('click', (e) => {
    if (!tracker || !e.isTrusted) return;
    const x = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(e.clientX / Math.max(1, window.innerWidth) * GRID_SIZE)));
    const y = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(e.clientY / Math.max(1, window.innerHeight) * GRID_SIZE)));
    tracker.heatmap.set(`${x}:${y}`, (tracker.heatmap.get(`${x}:${y}`) || 0) + 1);
  }, true);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); else if (!tracker) start(); });
  window.addEventListener('pagehide', () => flush(true));
}
