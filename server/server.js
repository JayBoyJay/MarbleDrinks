// Marble Mayhem — optional local server.
// The game normally runs from GitHub Pages with phones connecting peer-to-peer. This server is for
// playing on your own Wi-Fi without internet: it serves the site, relays phone messages over
// WebSockets, and adds the local voice server / local AI options for the commentary booth.
// No npm install needed: run `node server/server.js` (or start.bat).

const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('./lib/ws');
const QRCode = require('./lib/qrcode');
const QRErrorCorrectLevel = require('./lib/qrcode/QRErrorCorrectLevel');

const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || PORT + 443;
const CERT_DIR = path.join(__dirname, 'certs');
const PUBLIC = path.join(__dirname, '..');
const HIDDEN = /^[\\/](server|\.github|\.git)([\\/]|$)/;

// ---------- network helpers ----------
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      let score = 0;
      if (a.address.startsWith('192.168.')) score = 3;
      else if (a.address.startsWith('10.')) score = 2;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score = 1;
      // virtual adapters (docker, vpn, wsl) are rarely what phones can reach
      if (/docker|veth|vbox|vmnet|utun|tun|wsl|br-/i.test(name)) score -= 5;
      out.push({ name, address: a.address, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

function hostIp() { return process.env.HOST_IP || (lanAddresses()[0] || {}).address || 'localhost'; }
function joinUrl() { return `http://${hostIp()}:${PORT}/play.html`; }
function secureJoinUrl() { return httpsServer ? `https://${hostIp()}:${HTTPS_PORT}/play.html` : null; }

// HTTPS is only needed for tilt steering: phone browsers only give motion
// sensor data to secure pages. A self-signed certificate is bundled in ./certs
// (phones will show a one-time "not private" warning to tap through).
function loadCert() {
  const key = path.join(CERT_DIR, 'key.pem'), cert = path.join(CERT_DIR, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    try {
      fs.mkdirSync(CERT_DIR, { recursive: true });
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '3650', '-subj', '/CN=marble-mayhem.local'], { stdio: 'ignore' });
    } catch { return null; }
  }
  try { return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) }; } catch { return null; }
}

function qrMatrix(text) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(text);
  qr.make();
  return qr.modules; // 2D array of booleans
}

function qrSvg(text) {
  const m = qrMatrix(text);
  const n = m.length, pad = 3, size = n + pad * 2;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${x + pad} ${y + pad}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#111"/></svg>`;
}

function qrTerminal(text) {
  const m = qrMatrix(text);
  const n = m.length;
  const get = (x, y) => (y >= 0 && y < n && x >= 0 && x < n ? m[y][x] : false);
  let out = '';
  for (let y = -2; y < n + 2; y += 2) {
    let line = '  ';
    for (let x = -2; x < n + 2; x++) {
      const top = get(x, y), bottom = get(x, y + 1);
      line += top && bottom ? ' ' : top ? '▄' : bottom ? '▀' : '█';
    }
    out += line + '\n';
  }
  return out;
}

// ---------- static files ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------- optional local AI helpers ----------
// A natural commentator voice from any OpenAI-compatible text-to-speech server
// (e.g. Kokoro-FastAPI on port 8880), and colour commentary from any
// OpenAI-compatible local language model (e.g. Ollama on port 11434 or LM Studio
// on 1234). The game works without either; these just make the booth better.
const TTS_URL = process.env.TTS_URL || 'http://127.0.0.1:8880/v1/audio/speech';
const TTS_MODEL = process.env.TTS_MODEL || 'kokoro';
const LLM_URL = process.env.LLM_URL || 'http://127.0.0.1:11434/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || '';
const apiBase = (u) => u.replace(/\/(audio\/speech|chat\/completions)\/?$/, '');

function readJson(req, limit = 200_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > limit) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } });
  });
}
async function timedFetch(url, opts = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}
async function proxyTts(req, res) {
  try {
    const b = await readJson(req);
    const r = await timedFetch(TTS_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: TTS_MODEL, input: String(b.input || '').slice(0, 400), voice: b.voice || 'bm_george', speed: Number(b.speed) || 1, response_format: 'mp3' }),
    }, 15000);
    if (!r.ok) { res.writeHead(502); res.end(`voice server: ${r.status}`); return; }
    res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'audio/mpeg' });
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.writeHead(502); res.end(`voice server unreachable: ${e.message}`); }
}
let llmModels = [];
async function proxyLlm(req, res) {
  try {
    const b = await readJson(req);
    const model = b.model || LLM_MODEL || llmModels[0] || 'llama3.2';
    const r = await timedFetch(LLM_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: b.messages, max_tokens: 80, temperature: 0.95, stream: false }),
    }, 9000);
    if (!r.ok) { res.writeHead(502); res.end(`AI server: ${r.status}`); return; }
    const data = await r.json();
    let text = data.choices?.[0]?.message?.content || '';
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text }));
  } catch (e) { res.writeHead(502); res.end(`AI server unreachable: ${e.message}`); }
}
async function aiStatus(res) {
  const out = { tts: false, ttsUrl: TTS_URL, llm: false, llmUrl: LLM_URL, models: [] };
  await Promise.all([
    (async () => {
      for (const path of ['/audio/voices', '/models']) {
        try { const r = await timedFetch(apiBase(TTS_URL) + path, {}, 1200); if (r.ok) { out.tts = true; return; } } catch {}
      }
    })(),
    (async () => {
      try {
        const r = await timedFetch(apiBase(LLM_URL) + '/models', {}, 1200);
        if (r.ok) { const d = await r.json(); out.llm = true; out.models = llmModels = (d.data || []).map((m) => m.id).filter(Boolean); }
      } catch {}
    })(),
  ]);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(out));
}

function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '/host') return serveFile(res, path.join(PUBLIC, 'index.html'));
  if (p === '/play' || p === '/play/') return serveFile(res, path.join(PUBLIC, 'play.html'));
  if (HIDDEN.test(p)) { res.writeHead(404); res.end(); return; }
  if (p === '/api/tts' && req.method === 'POST') return proxyTts(req, res);
  if (p === '/api/llm' && req.method === 'POST') return proxyLlm(req, res);
  if (p === '/api/ai-status') return aiStatus(res);
  if (p === '/api/info') {
    const u = joinUrl();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    const su = secureJoinUrl();
    res.end(JSON.stringify({ server: 'marble-mayhem', url: u, qr: qrSvg(u), secureUrl: su, qrSecure: su ? qrSvg(su) : null, addresses: lanAddresses().map((a) => a.address) }));
    return;
  }
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  serveFile(res, file);
}
const server = http.createServer(handle);
const tls = loadCert();
const httpsServer = tls ? https.createServer(tls, handle) : null;

// ---------- relay ----------
// The race screen is the "host" and owns all game state. The server only
// remembers which phone is which (by a stable id kept in the phone's storage)
// so a phone that locks its screen can reconnect to the same player.
const wss = new WebSocketServer({ noServer: true });
for (const srv of [server, httpsServer]) {
  if (!srv) continue;
  srv.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
}
let host = null;
const phones = new Map(); // pid -> ws

function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

wss.on('connection', (ws) => {
  ws.role = null;
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (!ws.role) {
      if (msg.t === 'host') {
        if (host && host !== ws) { send(host, { t: 'replaced' }); host.close(); }
        host = ws; ws.role = 'host';
        send(ws, { t: 'phones', pids: [...phones.keys()] });
        for (const p of phones.values()) send(p, { t: 'hostup' });
        console.log('  Race screen connected');
      } else if (msg.t === 'phone') {
        let pid = typeof msg.pid === 'string' && /^[a-z0-9]{6,20}$/.test(msg.pid) ? msg.pid : crypto.randomBytes(5).toString('hex');
        const old = phones.get(pid);
        if (old && old !== ws) { old.replaced = true; send(old, { t: 'moved' }); old.close(); }
        ws.role = 'phone'; ws.pid = pid; phones.set(pid, ws);
        send(ws, { t: 'welcome', pid, host: !!host });
        send(host, { t: 'phone-connect', pid });
      }
      return;
    }

    if (ws.role === 'phone') {
      send(host, { t: 'phone-msg', pid: ws.pid, msg });
    } else if (ws.role === 'host') {
      if (msg.t === 'send') send(phones.get(msg.pid), msg.msg);
      else if (msg.t === 'broadcast') for (const p of phones.values()) send(p, msg.msg);
      else if (msg.t === 'kick') { const p = phones.get(msg.pid); if (p) { send(p, { t: 'kicked' }); } }
    }
  });

  ws.on('close', () => {
    if (ws.role === 'host' && host === ws) {
      host = null;
      for (const p of phones.values()) send(p, { t: 'nohost' });
      console.log('  Race screen disconnected');
    } else if (ws.role === 'phone' && phones.get(ws.pid) === ws) {
      phones.delete(ws.pid);
      if (!ws.replaced) send(host, { t: 'phone-disconnect', pid: ws.pid });
    }
  });
});

// keep connections alive through phone sleep / wifi power saving
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 15000);
wss.on('connection', (ws) => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });

server.listen(PORT, '0.0.0.0', () => {
  const u = joinUrl();
  console.log('\n  MARBLE MAYHEM is running\n');
  console.log(`  Race screen (open on the TV / laptop):  http://localhost:${PORT}`);
  console.log(`  Phones join at:                        ${u}\n`);
  console.log(qrTerminal(u));
  const others = lanAddresses().slice(1);
  if (others.length) console.log(`  If phones can't connect, try another address: ${others.map((a) => a.address).join(', ')}\n  (set it with HOST_IP=x.x.x.x npm start)\n`);
});
if (httpsServer) {
  httpsServer.on('error', (e) => console.log(`  (Secure link for tilt steering unavailable: ${e.message})`));
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => console.log(`  Secure link for tilt steering:         ${secureJoinUrl()}\n`));
}
