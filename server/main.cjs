// The coaster library as a small service (systemd runs it on the server; nginx forwards
// lawebs.co.il/ball-coaster/api/ to it):  PORT=4021 DATA_DIR=/var/lib/ball-coaster node server/main.cjs
'use strict';
const http = require('http');
const path = require('path');
const { createApi } = require('./api.cjs');

const port = Number(process.env.PORT) || 4021;
const api = createApi({ dataDir: process.env.DATA_DIR || path.join(__dirname, '..', '.data') });

const server = http.createServer((req, res) => {
  api(req, res, req.url).then((handled) => {
    if (handled) return;
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not-found"}');
  }).catch((e) => { console.error(e); if (!res.headersSent) res.writeHead(500); res.end(); });
});
server.requestTimeout = 15000;
server.listen(port, '127.0.0.1', () => console.log(`Ball Coaster library on 127.0.0.1:${port}`));
// counters still waiting to be written are saved before the service stops
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { api.flush(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
