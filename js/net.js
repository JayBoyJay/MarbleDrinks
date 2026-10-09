// Phone ↔ race screen connections. Two interchangeable ways to carry the same messages:
//
//  'peer' — the normal way (GitHub Pages or any static host). Phones connect straight to the race
//           screen's browser over WebRTC. PeerJS's free cloud server only introduces them; after
//           that everything goes device-to-device.
//  'ws'   — the optional local Node server (server/server.js) relays over WebSockets on your Wi-Fi.
//           Works with no internet, and adds the local voice server / local AI options.
//
// The race screen sees the same events either way: 'phone-connect', 'phone-disconnect',
// 'phone-msg' and 'phones', exactly as the local server sends them.

export const PEER_PREFIX = 'marblemayhem-';
const PEERJS_URLS = [
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js',
  'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js',
];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export function makeRoomCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
export async function loadPeerJS() {
  const get = () => window.Peer || (window.peerjs && window.peerjs.Peer);
  if (get()) return get();
  for (const url of PEERJS_URLS) {
    try { await loadScript(url); if (get()) return get(); } catch { /* try the next CDN */ }
  }
  throw new Error('PeerJS could not be loaded (no internet?)');
}

// Are we being served by the local Node server?
export async function detectLocalServer() {
  try {
    const r = await fetch('api/info', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.server === 'marble-mayhem' ? j : null;
  } catch { return null; }
}

const randId = () => Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/g, 'x').padEnd(10, 'x');

// ======================= race screen =======================
export class HostNet {
  // onEvent(m): m is a server-style message ({t:'phone-msg', pid, msg} etc.)
  // onStatus(text, ok): connection status for the lobby
  // onReady(net): called once the join link is known
  constructor({ onEvent, onStatus, onReady }) {
    this.onEvent = onEvent; this.onStatus = onStatus || (() => {}); this.onReady = onReady || (() => {});
    this.mode = null; this.room = null; this.joinUrl = ''; this.secureUrl = null; this.info = null;
  }

  async start() {
    // add ?online to the address to use peer-to-peer even when the local server is running
    // (handy for testing the GitHub Pages way of connecting before pushing)
    const forceOnline = new URLSearchParams(location.search).has('online');
    const info = forceOnline ? null : await detectLocalServer();
    if (info) this._startWs(info);
    else await this._startPeer();
  }

  send(pid, msg) {
    if (this.mode === 'ws') this._wsSend({ t: 'send', pid, msg });
    else if (this.mode === 'peer') { const c = this.conns.get(pid); if (c && c.open) { try { c.send(msg); } catch { /* closing */ } } }
  }
  broadcast(msg) {
    if (this.mode === 'ws') this._wsSend({ t: 'broadcast', msg });
    else if (this.mode === 'peer') for (const c of this.conns.values()) if (c.open) { try { c.send(msg); } catch { /* closing */ } }
  }
  kick(pid) {
    if (this.mode === 'ws') this._wsSend({ t: 'kick', pid });
    else this.send(pid, { t: 'kicked' });
  }
  ready() { return this.mode === 'ws' ? this.ws?.readyState === 1 : this.mode === 'peer' && !!this.room; }

  // ---------------- local server ----------------
  _wsSend(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  _startWs(info) {
    this.mode = 'ws'; this.info = info;
    this.joinUrl = info.url; this.secureUrl = info.secureUrl || null;
    this.onReady(this);
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      this.ws = ws;
      ws.onopen = () => { ws.send(JSON.stringify({ t: 'host' })); this.onStatus('', true); };
      ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this.onEvent(m); };
      ws.onclose = () => { this.onEvent({ t: 'all-gone' }); this.onStatus('Reconnecting to the local server…', false); setTimeout(connect, 1500); };
    };
    connect();
  }

  // ---------------- peer-to-peer ----------------
  async _startPeer() {
    this.mode = 'peer';
    this.conns = new Map(); // pid -> DataConnection
    this.onStatus('Connecting…', false);
    try { this.Peer = await loadPeerJS(); } catch {
      this.onStatus('Couldn’t reach the internet to set up phone connections. Check the connection and refresh.', false);
      return;
    }
    // keep-alive: ping phones every 2 s and drop ones silent for 30 s (generous, so a phone busy
    // drawing marble previews, or briefly switched away, isn't kicked)
    setInterval(() => {
      const now = Date.now();
      for (const c of this.conns.values()) {
        if (now - (c.lastSeen || now) > 30000) { try { c.close(); } catch { /* ignore */ } }
        else if (c.open) { try { c.send({ t: 'ping' }); } catch { /* ignore */ } }
      }
    }, 2000);
    let code = store.get('mm:room');
    if (!/^[A-Z]{4}$/.test(code || '')) code = makeRoomCode();
    this._open(code, 0);
  }

  _open(code, attempt) {
    if (this.peer) { try { this.peer.destroy(); } catch { /* ignore */ } }
    const peer = new this.Peer(PEER_PREFIX + code, { debug: 0 });
    this.peer = peer;
    peer.on('open', () => {
      this.room = code;
      store.set('mm:room', code);
      this.joinUrl = new URL('play.html?room=' + code, location.href).href;
      this.onStatus('', true);
      this.onReady(this);
    });
    peer.on('connection', (conn) => this._accept(conn));
    peer.on('disconnected', () => {
      if (peer !== this.peer || peer.destroyed) return;
      this.onStatus('Lost the connection server — reconnecting… (phones already in can keep playing)', false);
      setTimeout(() => { if (peer === this.peer && !peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch { /* ignore */ } } }, 1500);
    });
    peer.on('error', (err) => {
      if (peer !== this.peer) return;
      const type = err && err.type;
      if (type === 'unavailable-id') {
        // after a refresh the old registration can linger for a few seconds: retry, then pick a new code
        if (attempt < 4) setTimeout(() => this._open(code, attempt + 1), 2000);
        else this._open(makeRoomCode(), 0);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(type)) {
        this.onStatus('Can’t reach the connection server — retrying…', false);
        setTimeout(() => {
          if (peer !== this.peer) return;
          if (peer.destroyed) this._open(code, 0);
          else if (peer.disconnected) { try { peer.reconnect(); } catch { this._open(code, 0); } }
        }, 3000);
      } else if (type === 'browser-incompatible') {
        this.onStatus('This browser can’t do WebRTC — try Chrome, Edge or Firefox.', false);
      }
    });
  }

  newRoom() { this._open(makeRoomCode(), 0); }

  _accept(conn) {
    conn.on('data', (m) => this._fromPhone(conn, m));
    const gone = () => {
      if (conn.pid && this.conns.get(conn.pid) === conn) {
        this.conns.delete(conn.pid);
        this.onEvent({ t: 'phone-disconnect', pid: conn.pid });
      }
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  _fromPhone(conn, m) {
    conn.lastSeen = Date.now();
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch { return; } }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'phone') {
      const pid = typeof m.pid === 'string' && /^[a-z0-9]{6,20}$/.test(m.pid) ? m.pid : randId();
      const old = this.conns.get(pid);
      if (old && old !== conn) { old.pid = null; try { old.send({ t: 'moved' }); } catch { /* ignore */ } setTimeout(() => { try { old.close(); } catch { /* ignore */ } }, 200); }
      conn.pid = pid;
      this.conns.set(pid, conn);
      try { conn.send({ t: 'welcome', pid, host: true }); } catch { /* ignore */ }
      this.onEvent({ t: 'phone-connect', pid });
      return;
    }
    if (m.t === 'pong' || !conn.pid) return;
    this.onEvent({ t: 'phone-msg', pid: conn.pid, msg: m });
  }
}

// ======================= phone =======================
// onMsg(m) receives the same messages the local server sends phones
// ('welcome', 'view', 'pos', 'nohost', 'hostup', 'kicked', 'moved').
export class PhoneNet {
  constructor({ onMsg, onStatus }) {
    this.onMsg = onMsg; this.onStatus = onStatus || (() => {});
    const qp = new URLSearchParams(location.search);
    this.room = (qp.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    this.mode = this.room ? 'peer' : 'ws';
    this.pid = null;
    this.moved = false;
  }

  start(pid) {
    this.pid = pid;
    if (this.mode === 'ws') this._wsConnect();
    else this._peerConnect();
  }

  send(m) {
    if (this.mode === 'ws') { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }
    else if (this.conn && this.conn.open) { try { this.conn.send(m); } catch { /* closing */ } }
  }
  isOpen() { return this.mode === 'ws' ? this.ws?.readyState === 1 : !!(this.conn && this.conn.open); }
  reconnectNow() {
    if (this.moved) return;
    if (this.mode === 'ws') { try { this.ws?.close(); } catch { /* ignore */ } }
    else if (!this.isOpen()) this._peerConnect();
  }

  // ---------------- local server ----------------
  _wsConnect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => { this.onStatus(''); ws.send(JSON.stringify({ t: 'phone', pid: this.pid })); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this._got(m); };
    ws.onclose = () => { if (this.moved) return; this.onStatus('Reconnecting…'); setTimeout(() => this._wsConnect(), 1200); };
  }

  // ---------------- peer-to-peer ----------------
  async _peerConnect() {
    if (this.connecting) return;
    this.connecting = true;
    this.onStatus('Connecting…');
    try {
      if (!this.Peer) this.Peer = await loadPeerJS();
      if (!this.peer || this.peer.destroyed) {
        this.peer = new this.Peer({ debug: 0 });
        await new Promise((res, rej) => {
          this.peer.once('open', res);
          this.peer.once('error', rej);
          setTimeout(() => rej(new Error('timeout')), 12000);
        });
        this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch { /* ignore */ } });
      }
      const conn = this.peer.connect(PEER_PREFIX + this.room, { reliable: true });
      this.conn = conn;
      let opened = false;
      conn.on('open', () => {
        opened = true; this.connecting = false;
        this.onStatus('');
        conn.send({ t: 'phone', pid: this.pid });
        this._lastHeard = Date.now();
      });
      conn.on('data', (m) => { this._lastHeard = Date.now(); if (m && m.t === 'ping') { try { conn.send({ t: 'pong' }); } catch { /* ignore */ } return; } this._got(m); });
      const retry = () => {
        if (this.conn !== conn) return;
        this.conn = null; this.connecting = false;
        if (this.moved) return;
        this.onMsg({ t: 'nohost' });
        setTimeout(() => this._peerConnect(), 2000);
      };
      conn.on('close', retry);
      conn.on('error', retry);
      this.peer.once('error', (err) => {
        if (err && err.type === 'peer-unavailable') { this.onStatus(`Can’t find game ${this.room}. Is the race screen open? Retrying…`); retry(); }
      });
      setTimeout(() => { if (!opened && this.conn === conn) { try { conn.close(); } catch { /* ignore */ } retry(); } }, 12000);
      if (!this._watch) {
        // if the race screen goes quiet (it pings every 2 s), reconnect
        this._watch = setInterval(() => { if (this.conn && this.conn.open && Date.now() - (this._lastHeard || 0) > 20000) { try { this.conn.close(); } catch { /* ignore */ } } }, 3000);
      }
    } catch (e) {
      this.connecting = false;
      this.onStatus('Can’t reach the game. Check your internet connection… retrying');
      try { this.peer?.destroy(); } catch { /* ignore */ }
      this.peer = null;
      setTimeout(() => this._peerConnect(), 3000);
    }
  }

  _got(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'moved') this.moved = true;
    this.onMsg(m);
  }
}
