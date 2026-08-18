// server.js — tiny zero-dependency static server for the Anipet price scanner.
// Serves /public (the app) and /data (the catalog JSON) over both HTTP (localhost)
// and HTTPS (for phones on the LAN — camera requires a secure context).
//
// Run:  node server.js
//
//   HTTP : http://localhost:3000        (use on this PC)
//   HTTPS: https://<this-pc-LAN-ip>:3443 (use on the Android phone; accept the
//          self-signed certificate warning once)

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HTTP_PORT = 3000;
const HTTPS_PORT = 3443;
// Web root = docs/ (same folder GitHub Pages serves, so paths match everywhere).
const PUBLIC_DIR = path.join(__dirname, 'docs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Never cache data JSON so scans always reflect the latest fetch; the
      // app itself handles offline caching via the service worker.
      'Cache-Control': ext === '.json' ? 'no-store' : 'no-cache',
    });
    res.end(data);
  });
}

function handler(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const baseDir = PUBLIC_DIR;
  const rel = urlPath;

  // Prevent path traversal.
  const safeRel = path
    .normalize(rel)
    .replace(/^(\.\.[/\\])+/, '')
    .replace(/^[/\\]+/, '');
  const filePath = path.join(baseDir, safeRel);
  if (!filePath.startsWith(baseDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  sendFile(res, filePath);
}

function lanIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

// HTTP (localhost use on the PC).
http.createServer(handler).listen(HTTP_PORT, () => {
  console.log(`HTTP  ready:  http://localhost:${HTTP_PORT}`);
});

// HTTPS (phone use over LAN — camera needs a secure context).
try {
  const options = {
    key: fs.readFileSync(path.join(__dirname, 'certs', 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'certs', 'cert.pem')),
  };
  https.createServer(options, handler).listen(HTTPS_PORT, () => {
    const ips = lanIPs();
    console.log(`HTTPS ready:  https://localhost:${HTTPS_PORT}`);
    if (ips.length) {
      console.log('\nOn your Android phone (same Wi-Fi), open:');
      for (const ip of ips) console.log(`   https://${ip}:${HTTPS_PORT}`);
      console.log('\n(Accept the "not secure" certificate warning once — it is your own local certificate.)');
    }
  });
} catch (err) {
  console.log('HTTPS not started (cert missing?). Run the openssl step. Reason:', err.message);
}
