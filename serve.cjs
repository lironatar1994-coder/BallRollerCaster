// Tiny static file server for Ball Coaster:  node serve.cjs  →  http://localhost:5173
// It also runs the coaster library (server/api.cjs) at /api/, keeping its data in .data/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createApi } = require('./server/api.cjs');

const root = __dirname;
const port = Number(process.env.PORT) || 5173;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const api = createApi({ dataDir: path.join(root, '.data') });

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    api(req, res, req.url.slice(4)).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } });
    return;
  }
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.normalize(path.join(root, url === '/' ? 'index.html' : url));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(port, () => console.log(`Ball Coaster running at http://localhost:${port}`));
