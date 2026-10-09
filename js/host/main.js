// Race screen controller: owns the game state, talks to phones via the local
// server, and drives the lobby -> countdown -> race -> results loop.
import { World } from './render.js';
import { Director } from './camera.js';
import { generateTrack, THEMES, THEME_KEYS, sectionAt } from './track.js';
import { RaceSim, BOOSTS_PER_RACE, BOOST_COOLDOWN } from './sim.js';
import { SKINS, SKIN_BY_ID, skinPreview, registerCustomSkin, isCustomSkin, customSkinId, skinName, hasCustomSkin, skinColor } from '../skins.js';
import { POWERS } from '../powers.js';
import { HostNet } from '../net.js';
import { qrSvg } from '../qr.js';
import { HATS, HAT_IDS } from '../hats.js';
import { Commentator, NTH, BOOTH, words } from './commentator.js';
import { KOKORO_VOICES, DEFAULT_VOICES } from './voices.js';

const $ = (id) => document.getElementById(id);
const BOT_NAMES = ['Rollo', 'Clink', 'Pebbles', 'Sir Bounce', 'Glassy', 'Swirly', 'Mibs', 'Bonk', 'Taw', 'Shooter'];
const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const PICK_TIMEOUT = 45;
const AFTER_WIN_TIMEOUT = 25;

// ---------------- persistent state ----------------
const store = {
  load(k, d) { try { const v = JSON.parse(localStorage.getItem('mm:' + k)); return v ?? d; } catch { return d; } },
  save(k, v) { try { localStorage.setItem('mm:' + k, JSON.stringify(v)); } catch {} },
};

const state = {
  phase: 'lobby',
  players: new Map(Object.entries(store.load('players', {})).map(([pid, p]) => [pid, { ...p, connected: false, ready: false }])),
  tally: store.load('tally', {}),
  settings: { bots: 3, boosts: true, steer: 'off', pickups: true, camera: 'all', commentator: true, voiceEngine: 'browser', voices: { browser: ['', ''], kokoro: [...DEFAULT_VOICES.kokoro], server: [...DEFAULT_VOICES.server] }, aiWriter: false, aiModel: '', theme: 'random', length: 'medium', ...store.load('settings', {}) },
  track: null,
  sim: null,
  raceTime: 0,
  results: null,
  countdownT: 0,
};

function savePlayers() {
  const out = {};
  for (const [pid, p] of state.players) out[pid] = { pid, name: p.name, skin: p.skin, photo: p.photo, hat: p.hat };
  store.save('players', out);
}

// ---------------- photo skins ----------------
const PHOTO_MAX = 400_000; // characters of data URL (a 256px JPEG is ~30-60k)
function loadPhoto(pid, photo) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { registerCustomSkin(customSkinId(pid), img, photo.mode); resolve(true); };
    img.onerror = () => resolve(false);
    img.src = photo.data;
  });
}
// small preview images for custom skins, so phones can show other players' photo marbles
const thumbCache = new Map();
function thumbOf(skin, size = 64) {
  if (!isCustomSkin(skin) || !hasCustomSkin(skin)) return null;
  const key = skin + ':' + size;
  if (!thumbCache.has(key)) thumbCache.set(key, skinPreview(skin, size));
  return thumbCache.get(key);
}
function clearThumbs(skin) { for (const k of [...thumbCache.keys()]) if (k.startsWith(skin + ':')) thumbCache.delete(k); }

// ---------------- 3D world ----------------
const world = new World($('scene'));
const director = new Director(world);
let subTimer = null;
const caster = new Commentator({
  onCaption: (text, who) => {
    const el = $('subtitle');
    el.textContent = '';
    if (text) { const b = document.createElement('b'); b.textContent = (who || '').split(' ')[0]; el.append(b, text); }
    el.classList.toggle('dusty', who === BOOTH[1]);
    el.classList.toggle('hidden', !text);
    clearTimeout(subTimer); if (text) subTimer = setTimeout(() => el.classList.add('hidden'), 5000);
  },
  onStatus: (msg) => { $('voiceStatus').textContent = msg; },
});

function newTrack() {
  const theme = state.settings.theme === 'random' ? THEME_KEYS[Math.floor(Math.random() * THEME_KEYS.length)] : state.settings.theme;
  state.track = generateTrack({ theme, length: state.settings.length });
  world.buildTrack(state.track);
  director.setMode('orbit');
  renderTrackCard();
  pushViews();
}

// ---------------- networking ----------------
// Phones connect peer-to-peer (GitHub Pages) or through the local Wi-Fi server; see js/net.js.
const net = new HostNet({
  onEvent: (m) => onServer(m),
  onStatus: (text, ok) => { netStatus = ok ? '' : text; renderJoin(); },
  onReady: () => { renderJoin(); pushViews(); checkAi(); },
});
let netStatus = 'Connecting…';
function sendTo(pid, msg) { net.send(pid, msg); }

function onServer(m) {
  if (m.t === 'all-gone') { for (const p of state.players.values()) p.connected = false; renderLobby(); return; }
  if (m.t === 'phones') { for (const pid of m.pids) markConnected(pid, true); }
  else if (m.t === 'phone-connect') markConnected(m.pid, true);
  else if (m.t === 'phone-disconnect') markConnected(m.pid, false);
  else if (m.t === 'phone-msg') onPhone(m.pid, m.msg);
  else if (m.t === 'replaced') toast('Race screen opened in another tab — this one is now inactive.');
}

function markConnected(pid, on) {
  const p = state.players.get(pid);
  if (p) { p.connected = on; if (!on && state.phase === 'lobby') p.ready = false; }
  renderLobby();
  pushView(pid);
}

function freeSkin() {
  const taken = new Set([...state.players.values()].map((p) => p.skin));
  const free = SKINS.filter((s) => !taken.has(s.id));
  return (free.length ? free : SKINS)[Math.floor(Math.random() * (free.length || SKINS.length))].id;
}

function onPhone(pid, msg) {
  let p = state.players.get(pid);
  switch (msg.t) {
    case 'join': {
      const name = String(msg.name || '').trim().slice(0, 16) || 'Player';
      if (!p) {
        if (state.phase === 'race' || state.phase === 'countdown') { /* joins next race */ }
        p = { pid, name, skin: freeSkin(), connected: true, ready: false };
        state.players.set(pid, p);
        feedLine(`👋 ${name} joined`);
      } else p.name = name;
      if (state.tally[pid]) state.tally[pid].name = name;
      savePlayers();
      break;
    }
    case 'photo': {
      if (!p || typeof msg.data !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(msg.data) || msg.data.length > PHOTO_MAX) break;
      const photo = { data: msg.data, mode: msg.mode === 'wrap' ? 'wrap' : 'face' };
      loadPhoto(pid, photo).then((ok) => {
        if (!ok) return;
        const id = customSkinId(pid);
        clearThumbs(id);
        p.photo = photo; p.skin = id;
        savePlayers(); renderLobby(); pushViews();
      });
      return;
    }
    case 'hat': {
      if (p && HAT_IDS.includes(msg.hat)) { p.hat = msg.hat; savePlayers(); }
      break;
    }
    case 'skin': {
      if (!p) break;
      if (isCustomSkin(msg.skin)) { if (msg.skin === customSkinId(pid) && p.photo) { p.skin = msg.skin; savePlayers(); } break; }
      if (!SKIN_BY_ID[msg.skin]) break;
      const takenBy = [...state.players.values()].find((o) => o.skin === msg.skin && o.pid !== pid);
      if (!takenBy) { p.skin = msg.skin; savePlayers(); }
      break;
    }
    case 'ready': {
      if (!p) break;
      p.ready = !!msg.v;
      if (state.phase === 'results' && p.ready) maybeLeaveResults();
      break;
    }
    case 'steer': {
      if (p && !state.paused && (state.phase === 'race' || state.phase === 'finishing') && state.settings.steer === 'tilt') state.sim.setSteer(pid, msg.v);
      return; // high-frequency message: no lobby re-render
    }
    case 'power': {
      if (p && !state.paused && state.phase === 'race' && state.settings.pickups) state.sim.usePower(pid);
      break;
    }
    case 'boost': {
      if (p && !state.paused && state.phase === 'race' && state.settings.boosts) state.sim.boost(pid);
      break;
    }
    case 'pick': {
      if (state.phase === 'results') resolvePick(pid, msg.target);
      break;
    }
    case 'leave': {
      if (p && state.phase !== 'race') { state.players.delete(pid); savePlayers(); }
      break;
    }
  }
  renderLobby();
  pushViews();
  checkAutoStart();
}

// what each phone should show
function viewFor(pid) {
  const p = state.players.get(pid);
  const all = [...state.players.values()];
  const v = {
    t: 'view', phase: state.phase,
    you: p ? { joined: true, name: p.name, skin: p.skin, hat: p.hat || 'none', ready: !!p.ready, hasPhoto: !!p.photo, thumb: thumbOf(p.skin, 168), photoThumb: p.photo ? thumbOf(customSkinId(pid), 128) : null } : { joined: false },
    taken: all.filter((o) => o.pid !== pid).map((o) => o.skin),
    players: state.phase === 'race' ? [] : all.map((o) => ({ name: o.name, skin: o.skin, thumb: thumbOf(o.skin, 44), ready: !!o.ready, connected: !!o.connected, you: o.pid === pid })),
    boostsOn: state.settings.boosts,
    tilt: state.settings.steer === 'tilt',
    secureUrl: net.secureUrl || null,
    track: state.track ? { name: THEMES[state.track.theme].name } : null,
    countdown: state.phase === 'countdown' ? Math.ceil(state.countdownT) : null,
    paused: !!state.paused,
  };
  // what the phone needs to draw its own radar: the track seed (phones rebuild
  // the identical track) and who's in the race; positions stream separately
  if (['countdown', 'race', 'finishing'].includes(state.phase) && state.sim) {
    const tr = state.sim.track;
    v.field = {
      track: { seed: tr.seed, theme: tr.theme, lengthKey: tr.lengthKey },
      pickupsOn: state.settings.pickups,
      marbles: state.sim.marbles.map((m) => ({ id: m.id, name: m.name, color: skinColor(m.skin), bot: m.bot, you: m.id === pid })),
    };
  }
  if ((state.phase === 'race' || state.phase === 'finishing') && state.sim) {
    const st = state.sim.standings();
    const idx = st.findIndex((m) => m.id === pid);
    if (idx >= 0) {
      const m = st[idx];
      v.race = { place: idx + 1, total: st.length, boosts: m.boosts, cd: Math.max(0, m.boostCd), maxBoosts: BOOSTS_PER_RACE, cooldown: BOOST_COOLDOWN, finished: m.finished, progress: Math.min(1, m.s / state.sim.track.finishS) };
      v.race.pickupsOn = state.settings.pickups;
      v.race.power = m.power ? { key: m.power, ...POWERS[m.power] } : null;
      v.race.pickCount = m.pickCount || 0;
      v.race.replaced = m.lastReplaced ? { key: m.lastReplaced, ...POWERS[m.lastReplaced] } : null;
      v.race.status = m.frozenT > 0 ? '🧊 Frozen!' : m.scrambleT > 0 ? '🌀 Steering scrambled!' : m.ghostT > 0 ? '👻 Ghost mode' : m.magnetT > 0 ? '🧲 Magnet on' : m.shieldT > 0 ? '🛡️ Shielded' : '';
    } else v.race = { spectator: true };
  }
  if (state.phase === 'results' && state.results) {
    const R = state.results;
    const mine = R.order.findIndex((o) => o.id === pid);
    v.results = {
      place: mine >= 0 ? mine + 1 : null, total: R.order.length,
      winner: R.order[0]?.name,
      bestHuman: R.humans[0]?.id === pid && R.order[0]?.id !== pid,
      picks: R.picks.filter((k) => k.by === pid && !k.target).map((k) => ({ kind: k.kind, options: R.humans.filter((h) => h.id !== pid).map((h) => ({ pid: h.id, name: h.name, skin: h.skin, thumb: thumbOf(h.skin) })) })),
      waiting: R.picks.filter((k) => !k.target).map((k) => ({ kind: k.kind, by: nameOf(k.by) })),
      damage: R.done ? (R.damage[pid] || { drinks: 0, sips: 0, why: [] }) : null,
      allDamage: R.done ? Object.entries(R.damage).map(([id, d]) => ({ name: nameOf(id), skin: skinOf(id), thumb: thumbOf(skinOf(id)), ...d })) : null,
      done: R.done,
    };
  }
  return v;
}
function nameOf(id) { return state.players.get(id)?.name || state.tally[id]?.name || '?'; }
function skinOf(id) { return state.players.get(id)?.skin || state.tally[id]?.skin || 'ruby'; }

let viewQueued = false;
function pushViews() {
  if (viewQueued) return; viewQueued = true;
  queueMicrotask(() => { viewQueued = false; for (const pid of state.players.keys()) pushView(pid); });
}
function pushView(pid) { sendTo(pid, viewFor(pid)); }

// ---------------- lobby ----------------
function humans() { return [...state.players.values()]; }
function connectedHumans() { return humans().filter((p) => p.connected); }

function renderLobby() {
  $('botCount').textContent = state.settings.bots;
  for (const [seg, key] of [['boostSeg', 'boosts'], ['pickSeg', 'pickups'], ['steerSeg', 'steer'], ['camSeg', 'camera'], ['comSeg', 'commentator'], ['engSeg', 'voiceEngine'], ['aiSeg', 'aiWriter'], ['themeSeg', 'theme'], ['lenSeg', 'length']]) {
    for (const b of $(seg).querySelectorAll('button')) {
      const val = ['boosts', 'pickups', 'commentator', 'aiWriter'].includes(key) ? (b.dataset.v === 'on') : b.dataset.v;
      b.classList.toggle('on', state.settings[key] === val);
    }
  }
  const grid = $('pgrid'); grid.textContent = '';
  for (const p of humans()) {
    const d = document.createElement('div');
    d.className = 'pcard' + (p.ready ? ' ready' : '') + (p.connected ? '' : ' off');
    d.innerHTML = `<img alt=""><div style="min-width:0"><div class="nm"></div><div class="st"></div></div><button class="x" title="Remove">✕</button>`;
    d.querySelector('img').src = skinPreview(p.skin, 80);
    d.querySelector('.nm').textContent = p.name;
    d.querySelector('.st').textContent = !p.connected ? 'offline' : p.ready ? 'READY' : skinName(p.skin);
    d.querySelector('.x').onclick = () => { state.players.delete(p.pid); net.kick(p.pid); savePlayers(); renderLobby(); pushViews(); };
    grid.appendChild(d);
  }
  for (let i = 0; i < state.settings.bots; i++) {
    const d = document.createElement('div');
    d.className = 'pcard'; d.style.opacity = 0.6;
    d.innerHTML = `<div style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.12);display:grid;place-items:center">🤖</div><div><div class="nm"></div><div class="st">CPU</div></div>`;
    d.querySelector('.nm').textContent = BOT_NAMES[i];
    grid.appendChild(d);
  }
  const ch = connectedHumans();
  const ready = ch.filter((p) => p.ready).length;
  $('readyNote').textContent = ch.length === 0
    ? (state.settings.bots >= 2 ? 'No phones yet — you can still watch a CPU race.' : 'Waiting for players to join…')
    : `${ready}/${ch.length} ready — starts automatically when everyone is ready`;
  $('startBtn').disabled = ch.length + state.settings.bots < 2;
  renderTally();
}

function renderTrackCard() {
  const tr = state.track;
  $('trackName').textContent = THEMES[tr.theme].name;
  const chips = $('trackChips'); chips.textContent = '';
  const seen = new Set();
  for (const s of tr.sections) {
    if (['start', 'finish', 'bend'].includes(s.mod) || seen.has(s.label)) continue;
    seen.add(s.label);
    const c = document.createElement('span'); c.className = 'chip'; c.textContent = s.label; chips.appendChild(c);
  }
  const len = document.createElement('span'); len.className = 'chip'; len.style.background = 'var(--hot)';
  len.textContent = `${Math.round(tr.finishS)} m`; chips.appendChild(len);
}

function renderTally() {
  const rows = Object.entries(state.tally).sort((a, b) => b[1].pts - a[1].pts || b[1].wins - a[1].wins);
  const tb = $('tallyBody'); tb.textContent = '';
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="6" class="note">No races yet.</td></tr>'; return; }
  rows.forEach(([pid, t], i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td><td><img alt=""><span></span></td><td class="n"></td><td class="n"></td><td class="n"></td><td class="n"></td>`;
    tr.querySelector('img').src = skinPreview(t.skin || 'ruby', 44);
    tr.querySelector('span').textContent = t.name;
    const tds = tr.querySelectorAll('td.n');
    tds[0].textContent = t.pts; tds[1].textContent = t.wins; tds[2].textContent = t.drinks; tds[3].textContent = t.sips;
    tb.appendChild(tr);
  });
}

function bindLobby() {
  for (const b of document.querySelectorAll('[data-bots]')) b.onclick = () => { state.settings.bots = Math.max(0, Math.min(8, state.settings.bots + Number(b.dataset.bots))); saveSettings(); };
  for (const b of $('boostSeg').querySelectorAll('button')) b.onclick = () => { state.settings.boosts = b.dataset.v === 'on'; saveSettings(); pushViews(); };
  for (const b of $('comSeg').querySelectorAll('button')) b.onclick = () => { state.settings.commentator = b.dataset.v === 'on'; caster.enabled = state.settings.commentator; if (!caster.enabled) caster.stop(); saveSettings(); };
  for (const b of $('engSeg').querySelectorAll('button')) b.onclick = () => { unlockAudio(); state.settings.voiceEngine = b.dataset.v; applyVoiceSettings(); saveSettings(); checkAi(); };
  for (const b of $('aiSeg').querySelectorAll('button')) b.onclick = () => { state.settings.aiWriter = b.dataset.v === 'on'; applyVoiceSettings(); saveSettings(); checkAi(); };
  for (const [sel, i] of [['voiceSel', 0], ['voiceSel2', 1]]) $(sel).onchange = () => { state.settings.voices[state.settings.voiceEngine][i] = $(sel).value; applyVoiceSettings(); saveSettings(); };
  $('aiModel').onchange = () => { state.settings.aiModel = $('aiModel').value; saveSettings(); };
  $('voiceTest').onclick = () => {
    unlockAudio(); const was = caster.enabled; caster.enabled = true;
    caster.say('Welcome to Marble Mayhem! I am Ray Marbles.', 5, 30, { speaker: 0, energy: 0.8 });
    caster.say("And I'm Dusty Rollins. Remember folks, last place drinks.", 4.9, 30, { speaker: 1, energy: 0.5 });
    if (state.settings.aiWriter) caster.aiLine('Introduce yourself to the party in one line.', { track: THEMES[state.track.theme].name }, 4.8, 30);
    caster.enabled = was;
  };
  state.settings.voices = { browser: ['', ''], kokoro: [...DEFAULT_VOICES.kokoro], server: [...DEFAULT_VOICES.server], ...(state.settings.voices || {}) };
  applyVoiceSettings();
  if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = renderVoices;
  checkAi();
  for (const b of $('camSeg').querySelectorAll('button')) b.onclick = () => { state.settings.camera = b.dataset.v; director.style = b.dataset.v; saveSettings(); };
  for (const b of $('pickSeg').querySelectorAll('button')) b.onclick = () => { state.settings.pickups = b.dataset.v === 'on'; saveSettings(); pushViews(); };
  for (const b of $('steerSeg').querySelectorAll('button')) b.onclick = () => { state.settings.steer = b.dataset.v; saveSettings(); renderJoin(); pushViews(); };
  for (const b of $('themeSeg').querySelectorAll('button')) b.onclick = () => { state.settings.theme = b.dataset.v; saveSettings(); newTrack(); };
  for (const b of $('lenSeg').querySelectorAll('button')) b.onclick = () => { state.settings.length = b.dataset.v; saveSettings(); newTrack(); };
  $('reroll').onclick = () => newTrack();
  $('startBtn').onclick = () => { unlockAudio(); startCountdown(); };
  $('resetTally').onclick = () => { if (confirm('Reset the tally for everyone?')) { state.tally = {}; store.save('tally', {}); renderTally(); } };
  $('fullscreen').onclick = () => { unlockAudio(); document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); };
  $('nextBtn').onclick = () => leaveResults(true);
  $('menuBtn').onclick = () => leaveResults(false);
  $('pauseBtn').onclick = () => setPaused(true);
  $('resumeBtn').onclick = () => setPaused(false);
  $('restartBtn').onclick = () => restartRace();
  $('exitBtn').onclick = () => exitToMenu();
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f') $('fullscreen').click();
    if ((e.key === 'Escape' || e.key === 'p' || e.key === ' ') && ['countdown', 'race', 'finishing'].includes(state.phase)) { e.preventDefault(); setPaused(!state.paused); }
    if (e.key === 'Enter' && state.phase === 'lobby' && !$('startBtn').disabled) $('startBtn').click();
  });
}
function saveSettings() { store.save('settings', state.settings); renderLobby(); }

// The join QR. Online (GitHub Pages) it's a link with the room code; on the local
// server it's the Wi-Fi address. With the local server, tilt steering needs the
// secure (https) link, because phones only share motion sensors with secure pages.
let shownUrl = '';
function renderJoin() {
  const url = net.mode === 'ws' && state.settings.steer === 'tilt' && net.secureUrl ? net.secureUrl : net.joinUrl;
  if (!url) {
    $('qr').innerHTML = ''; $('url').textContent = netStatus || 'Connecting…';
    $('netnote').textContent = '';
    return;
  }
  if (url !== shownUrl) { $('qr').innerHTML = qrSvg(url, { margin: 2 }); shownUrl = url; }
  $('url').textContent = net.mode === 'peer' ? `Game code: ${net.room}` : url.replace(/^https?:\/\//, '');
  const secure = url === net.secureUrl;
  $('netnote').textContent = netStatus
    ? netStatus
    : net.mode === 'peer'
      ? 'Scan with any phone (Wi-Fi or mobile data). Or open this page’s address + /play.html and enter the code.'
      : url.includes('localhost')
        ? 'Could not find a Wi-Fi address — check the network, or start the server with HOST_IP set.'
        : secure ? 'Tilt mode uses a secure link: on the warning page tap “Advanced” → “Proceed” (or “Show details” → “visit this website” on iPhone).'
          : state.settings.steer === 'tilt' ? 'Tilt steering needs the secure link, which could not start. Check the terminal.'
            : 'Phones must be on the same Wi-Fi as this computer.';
}

function checkAutoStart() {
  if (state.phase !== 'lobby') return;
  const ch = connectedHumans();
  if (ch.length >= 1 && ch.every((p) => p.ready)) startCountdown();
}

// ---------------- race flow ----------------
function show(id) {
  for (const x of ['lobby', 'hud', 'results']) $(x).classList.toggle('hidden', x !== id);
}

function entrants() {
  const list = connectedHumans().map((p) => ({ id: p.pid, name: p.name, skin: p.skin, hat: p.hat || 'none', bot: false }));
  const taken = new Set(list.map((e) => e.skin));
  const free = SKINS.filter((s) => !taken.has(s.id)).sort(() => Math.random() - 0.5);
  for (let i = 0; i < state.settings.bots; i++) list.push({ id: 'bot' + i, name: BOT_NAMES[i], skin: (free[i] || SKINS[i]).id, hat: Math.random() < 0.5 ? HATS[1 + Math.floor(Math.random() * (HATS.length - 1))].id : 'none', bot: true });
  return list;
}

function startCountdown() {
  if (state.phase !== 'lobby') return;
  $('pauseBtn').classList.remove('hidden');
  const ents = entrants();
  if (ents.length < 2) return;
  state.sim = new RaceSim(state.track, ents, Math.random, { pickups: state.settings.pickups, tilt: state.settings.steer === 'tilt' });
  world.setMarbles(ents);
  world.syncMarbles(state.sim.marbles, 0, true);
  state.phase = 'countdown';
  // a longer build-up when the booth is on, so the welcome can be heard
  state.countdownT = caster.enabled ? 8.999 : 3.999;
  state.lastCount = 99;
  state.calls = new Set();
  state.worstPos = new Map();
  director.setMode('grid');
  show('hud');
  $('hudTrack').textContent = THEMES[state.track.theme].name;
  $('hudSection').textContent = 'On the grid';
  $('feed').textContent = '';
  caster.line('welcome', { track: THEMES[state.track.theme].name, n: words(ents.length) }, 2, 9);
  caster.line('world_' + state.track.theme, {}, 1.95, 10);
  const tallies = Object.values(state.tally);
  if (tallies.length) {
    const top = [...tallies].sort((a, b) => b.pts - a.pts)[0];
    const thirsty = [...tallies].sort((a, b) => b.drinks - a.drinks)[0];
    const raceNo = Math.max(...tallies.map((t) => t.races)) + 1;
    const vars = { tallyLeader: top.name, tallyPts: top.pts, thirsty: thirsty.name, thirstyDrinks: words(thirsty.drinks), raceNo: words(raceNo) };
    if (thirsty.drinks >= 2 || top.pts > 0) setTimeout(() => caster.line('welcomeTally', vars, 1.9, 8), 300);
  }
  renderStandings();
  pushViews();
}

function startRace() {
  state.phase = 'race';
  state.raceTime = 0;
  state.winnerTime = null;
  state.sim.start();
  director.setMode('race');
  $('countdown').innerHTML = '<div style="color:var(--gold)">GO!</div>';
  setTimeout(() => { if ($('countdown').textContent === 'GO!') $('countdown').textContent = ''; }, 900);
  beep(880, 0.35);
  caster.line('go', {}, 3, 2);
  pushViews();
}

function finishRace() {
  const sim = state.sim;
  state.phase = 'results';
  const st = sim.standings();
  const order = st.map((m) => ({ id: m.id, name: m.name, skin: m.skin, bot: m.bot, time: m.finished ? m.finishTime : null, gap: m.finished ? null : Math.round(sim.track.finishS - m.s) }));
  const humansOrder = order.filter((o) => !o.bot);
  const N = humansOrder.length;
  const picks = [], fixed = [];
  if (N >= 2) {
    picks.push({ kind: 'drink', by: humansOrder[0].id, target: null });
    if (N >= 3) picks.push({ kind: 'sip', by: humansOrder[1].id, target: null });
    fixed.push({ kind: 'drink', id: humansOrder[N - 1].id, why: 'Last place' });
    if (N >= 3) fixed.push({ kind: 'sip', id: humansOrder[N - 2].id, why: 'Second last' });
  }
  state.results = { order, humans: humansOrder, picks, fixed, damage: {}, done: picks.length === 0, startedAt: performance.now() };
  // points & podium tally (humans only)
  order.forEach((o, i) => {
    if (o.bot) return;
    const t = state.tally[o.id] ||= { name: o.name, skin: o.skin, pts: 0, wins: 0, podiums: 0, races: 0, drinks: 0, sips: 0, gaveDrinks: 0, gaveSips: 0, lasts: 0 };
    t.name = o.name; t.skin = o.skin;
    t.races++; t.pts += POINTS[i] || 0;
    if (i === 0) t.wins++;
    if (i < 3) t.podiums++;
  });
  if (N >= 2) state.tally[humansOrder[N - 1].id].lasts++;
  for (const p of state.players.values()) p.ready = false;
  if (state.results.done) finalizeDamage();
  store.save('tally', state.tally);
  director.setMode('results');
  show('results');
  renderResults();
  pushViews();
  fanfare();
  if (humansOrder.length >= 2) caster.line('lastHome', { a: humansOrder[humansOrder.length - 1].name }, 2.5, 8);
}

function resolvePick(pid, target) {
  const R = state.results;
  const pick = R.picks.find((k) => k.by === pid && !k.target);
  if (!pick || !R.humans.some((h) => h.id === target) || target === pid) return;
  pick.target = target;
  if (R.picks.every((k) => k.target)) finalizeDamage();
  renderResults();
  pushViews();
}

function finalizeDamage() {
  const R = state.results;
  const dmg = {};
  const add = (id, kind, why) => { const d = dmg[id] ||= { drinks: 0, sips: 0, why: [] }; d[kind === 'drink' ? 'drinks' : 'sips']++; d.why.push(why); };
  for (const k of R.picks) if (k.target) add(k.target, k.kind, `${k.kind === 'drink' ? 'Drink' : 'Sip'} from ${nameOf(k.by)}`);
  for (const f of R.fixed) add(f.id, f.kind, f.why);
  R.damage = dmg; R.done = true;
  const words = (d) => [d.drinks ? (d.drinks === 1 ? 'a drink' : `${d.drinks} drinks`) : '', d.sips ? (d.sips === 1 ? 'a sip' : `${d.sips} sips`) : ''].filter(Boolean).join(' and ');
  const list = Object.entries(dmg).map(([id, d]) => `${nameOf(id)}, ${words(d)}`).join('. ');
  if (list) setTimeout(() => caster.line('damage', { list }, 2, 12), 1200);
  if (caster.ai) setTimeout(() => caster.aiLine('Sum up the race and roast the drinkers in one line.', { ...raceFacts(), damage: list }, 1.8, 20), 2500);
  for (const [id, d] of Object.entries(dmg)) { const t = state.tally[id]; if (t) { t.drinks += d.drinks; t.sips += d.sips; } }
  for (const k of R.picks) { const t = state.tally[k.by]; if (t && k.target) t[k.kind === 'drink' ? 'gaveDrinks' : 'gaveSips']++; }
  store.save('tally', state.tally);
}

function maybeLeaveResults() {
  const R = state.results;
  if (!R?.done) return;
  const ch = connectedHumans();
  if (ch.length && ch.every((p) => p.ready)) goLobby(true);
}

function goLobby(autoStart) {
  state.paused = false;
  $('pauseMenu').classList.add('hidden');
  state.phase = 'lobby';
  state.results = null;
  caster.stop();
  world.clearMarbles();
  $('countdown').textContent = '';
  if (!autoStart) for (const p of state.players.values()) p.ready = false;
  show('lobby');
  newTrack();
  renderLobby();
  pushViews();
  if (autoStart) setTimeout(checkAutoStart, 1200);
}

// ---------------- pause menu ----------------
function setPaused(on) {
  if (on && !['countdown', 'race', 'finishing'].includes(state.phase)) return;
  state.paused = on;
  $('pauseMenu').classList.toggle('hidden', !on);
  $('pauseBtn').classList.toggle('hidden', on);
  if (on) { caster.stop(); window.speechSynthesis?.cancel(); }
  else caster.say('And we are back underway!', 2, 3, { speaker: 0, energy: 0.6 });
  pushViews();
}
// throw this race away and go back to the lobby (nothing goes on the tally)
function exitToMenu() {
  state.paused = false;
  $('pauseMenu').classList.add('hidden');
  feedLine('Race abandoned');
  goLobby(false);
}
// same track, fresh start
function restartRace() {
  state.paused = false;
  $('pauseMenu').classList.add('hidden');
  caster.stop();
  world.clearMarbles();
  state.phase = 'lobby';
  startCountdown();
}
// from the results: settle any picks still pending, then the menu or a new race
function leaveResults(raceAgain) {
  const R = state.results;
  if (R && !R.done) {
    for (const k of R.picks) if (!k.target) { const opts = R.humans.filter((h) => h.id !== k.by); k.target = opts[Math.floor(Math.random() * opts.length)].id; }
    finalizeDamage();
  }
  goLobby(false);
  if (raceAgain) setTimeout(() => startCountdown(), 300);
}

// ---------------- results UI ----------------
function renderResults() {
  const R = state.results;
  const list = $('resList'); list.textContent = '';
  const medals = ['🥇', '🥈', '🥉'];
  const winT = R.order[0]?.time;
  R.order.forEach((o, i) => {
    const d = document.createElement('div');
    d.className = 'rrow' + (i === 0 ? ' first' : '') + (o.bot ? ' bot' : '');
    d.innerHTML = `<div class="p"></div><img alt=""><div class="nm"></div><div class="t"></div><div class="pts"></div>`;
    d.querySelector('.p').textContent = medals[i] || i + 1;
    d.querySelector('img').src = skinPreview(o.skin, 64);
    d.querySelector('.nm').textContent = o.name + (o.bot ? ' (CPU)' : '');
    d.querySelector('.t').textContent = o.time == null ? `DNF · ${o.gap} m to go` : i === 0 ? fmtTime(o.time) : `+${(o.time - winT).toFixed(2)}s`;
    d.querySelector('.pts').textContent = o.bot ? '' : `+${POINTS[i] || 0} pts`;
    list.appendChild(d);
  });
  $('resTitle').textContent = R.order[0] ? `${R.order[0].name} wins!` : 'Results';

  const cons = $('cons'); cons.textContent = '';
  if (R.humans.length < 2) {
    cons.innerHTML = '<div class="note">Drinks need at least two phone players. Scan the QR code in the lobby to join.</div>';
  }
  if (R.order[0]?.bot && R.humans.length >= 2) {
    const n = document.createElement('div'); n.className = 'note';
    n.textContent = `A CPU marble won, so ${R.humans[0].name} — the best human — gets to pick.`;
    cons.appendChild(n);
  }
  for (const k of R.picks) {
    const c = document.createElement('div'); c.className = 'ccard give';
    c.innerHTML = `<div class="who"><img alt=""><span></span></div><div class="what"></div><div class="opts"></div>`;
    c.querySelector('img').src = skinPreview(skinOf(k.by), 64);
    c.querySelector('.who span').textContent = nameOf(k.by);
    const word = k.kind === 'drink' ? 'a drink 🍺' : 'a sip 🥃';
    if (k.target) c.querySelector('.what').textContent = `gives ${word} to ${nameOf(k.target)}`;
    else {
      const left = Math.max(0, Math.ceil(PICK_TIMEOUT - (performance.now() - R.startedAt) / 1000));
      c.querySelector('.what').textContent = `is choosing who gets ${word} on their phone… (${left}s)`;
      const opts = c.querySelector('.opts');
      for (const h of R.humans.filter((h) => h.id !== k.by)) {
        const b = document.createElement('button'); b.textContent = h.name;
        b.onclick = () => resolvePick(k.by, h.id);
        opts.appendChild(b);
      }
    }
    cons.appendChild(c);
  }
  for (const f of R.fixed) {
    const c = document.createElement('div'); c.className = 'ccard take';
    c.innerHTML = `<div class="who"><img alt=""><span></span></div><div class="what"></div>`;
    c.querySelector('img').src = skinPreview(skinOf(f.id), 64);
    c.querySelector('.who span').textContent = nameOf(f.id);
    c.querySelector('.what').textContent = `${f.why} — takes ${f.kind === 'drink' ? 'a drink 🍺' : 'a sip 🥃'}`;
    cons.appendChild(c);
  }
  if (R.done && Object.keys(R.damage).length) {
    const h = document.createElement('div'); h.className = 'label'; h.style.marginTop = '8px'; h.textContent = 'Total';
    cons.appendChild(h);
    const wrap = document.createElement('div'); wrap.className = 'damage';
    for (const [id, d] of Object.entries(R.damage)) {
      const e = document.createElement('div'); e.className = 'dmg';
      e.innerHTML = `<img alt=""><div><b></b><span></span></div>`;
      e.querySelector('img').src = skinPreview(skinOf(id), 64);
      e.querySelector('b').textContent = nameOf(id);
      e.querySelector('span').textContent = '🍺'.repeat(d.drinks) + '🥃'.repeat(d.sips);
      wrap.appendChild(e);
    }
    cons.appendChild(wrap);
  }
  $('nextNote').textContent = R.done ? 'or everyone taps "Ready" on their phone' : 'Waiting for picks… (leaving now picks at random)';
}

// ---------------- race HUD ----------------
let feedTimer = new Map();
function feedLine(text) {
  const f = $('feed');
  const d = document.createElement('div'); d.textContent = text;
  f.appendChild(d);
  while (f.children.length > 4) f.firstChild.remove();
  setTimeout(() => d.remove(), 6000);
}
function rateLimited(key, sec) {
  const now = performance.now();
  if ((feedTimer.get(key) || 0) > now) return true;
  feedTimer.set(key, now + sec * 1000); return false;
}

function handleEvents() {
  const sim = state.sim;
  const name = (id) => sim.marbles.find((m) => m.id === id)?.name || '?';
  for (const e of sim.events.splice(0)) {
    const isHuman = (id) => { const m = sim.marbles.find((x) => x.id === id); return m && !m.bot; };
    if (e.type === 'lead') { caster.line(isHuman(e.id) && isHuman(e.prev) ? 'leadHuman' : 'lead', { a: name(e.id), b: name(e.prev) }, 2, 3); if (!rateLimited('lead', 2.5)) feedLine(`🔥 ${name(e.id)} takes the lead!`); }
    else if (e.type === 'last') { if (isHuman(e.id)) caster.line(isHuman(e.prev) ? 'escape' : 'last', { a: name(e.id), b: name(e.prev) }, 1.8, 4); if (!rateLimited('last', 6)) feedLine(`🍺 ${name(e.id)} drops to last…`); }
    else if (e.type === 'jump') { caster.line('jump', { a: name(e.id) }, 0.8, 2.5); if (!rateLimited('jump', 8)) feedLine(`🚀 ${name(e.id)} catches big air!`); }
    else if (e.type === 'boost') { if (isHuman(e.id)) caster.line('boost', { a: name(e.id) }, 0.7, 2.5); if (!rateLimited('boost' + e.id, 1)) feedLine(`⚡ ${name(e.id)} hits the boost!`); }
    else if (e.type === 'section') { caster.line('section', { a: name(e.id), label: e.label }, 0.6, 3); if (!rateLimited('sec', 4)) feedLine(`📣 ${name(e.id)} leads into ${e.label}`); }
    else if (e.type === 'clash') { caster.line('clash', { a: name(e.a), b: name(e.b) }, 0.7, 2.5); if (!rateLimited('clash', 7)) feedLine(`💥 Contact between ${name(e.a)} and ${name(e.b)}!`); }
    else if (e.type === 'pickup') {
      const pk = sim.pickups[e.index];
      world.puffAt(pk.s, pk.u, 0.9, '#ffffff', 26, 1.6);
      const m = sim.marbles.find((x) => x.id === e.id);
      if (m && !m.bot) caster.line('pickup', { a: name(e.id), power: POWERS[e.power].name }, 0.5, 3);
      if (m && !m.bot && !rateLimited('pick' + e.id, 2)) feedLine(`💨 ${name(e.id)} grabbed ${POWERS[e.power].icon} ${POWERS[e.power].name}${e.replaced ? ` (dropped ${POWERS[e.replaced].name})` : ''}`);
    }
    else if (e.type === 'power') {
      const P = POWERS[e.power];
      const at = world.marblePos(e.id);
      if (at) world.puff(at, P.color, 14, 1);
      for (const t of e.targets) { const tp = world.marblePos(t); if (tp) world.puff(tp, P.color, 10, 0.9); }
      if (e.power === 'earthquake') world.shake(1.2);
      const who = e.targets.length === 1 ? ` on ${name(e.targets[0])}` : '';
      caster.power(e.power, { a: name(e.id), t: e.targets.length === 1 ? name(e.targets[0]) : 'everyone', miss: e.miss }, isHuman(e.id) ? 1.8 : 1.2);
      if (!rateLimited('pow' + e.id, 1)) feedLine(`${P.icon} ${name(e.id)} used ${P.name}${who}${e.miss ? ' … and missed!' : '!'}`);
    }
    else if (e.type === 'portal') {
      world.puffAt(e.from, e.u, 0.9, '#ff8a00', 14, 1.1); world.puffAt(e.to, e.u, 0.9, '#2fa4ff', 14, 1.1);
      caster.line('portal', { a: name(e.id) }, 1.4, 3);
      if (!rateLimited('portal' + e.id, 2)) feedLine(`🌀 ${name(e.id)} takes the portal shortcut!`);
    }
    else if (e.type === 'tramp') { caster.line('tramp', { a: name(e.id) }, 0.8, 2.5); }
    else if (e.type === 'bumper') { if (isHuman(e.id)) caster.line('bumper', { a: name(e.id) }, 0.6, 2.5); }
    else if (e.type === 'blocked' && !rateLimited('blk', 2)) {
      caster.line('blocked', { a: name(e.id) }, 1.9, 2.5); feedLine(`🛡️ ${name(e.id)}'s shield blocked it!`); const at = world.marblePos(e.id); if (at) world.puff(at, '#3de1ff', 10, 1); }
    else if (e.type === 'finish') {
      if (e.place === 1) caster.line('win', { a: name(e.id), track: THEMES[sim.track.theme].name }, 4, 5);
      else if (e.place === 2) {
        const w = sim.marbles.find((m) => m.place === 1), me = sim.marbles.find((m) => m.id === e.id);
        if (w && me.finishTime - w.finishTime < 0.35) caster.line('photo', { a: w.name, b: me.name }, 4.5, 4);
        else caster.line('podium', { a: name(e.id), nth: NTH[2] }, 1.5, 4);
      }
      else if (e.place === 3) caster.line('podium', { a: name(e.id), nth: NTH[3] }, 1.5, 4);
      if (e.place === 1) { feedLine(`🏆 ${name(e.id)} WINS!`); state.winnerTime = state.raceTime; beep(660, 0.15); setTimeout(() => beep(990, 0.4), 160); }
      else if (e.place <= 3) feedLine(`🏁 ${name(e.id)} finishes ${['', '1st', '2nd', '3rd'][e.place]}`);
      else beep(520, 0.06);
    }
  }
}

function renderStandings() {
  const sim = state.sim; if (!sim) return;
  const st = sim.standings();
  const box = $('hudStandings');
  const leaderS = st[0].finished ? sim.track.finishS : st[0].s;
  const humanIdx = st.map((m, i) => (!m.bot ? i : -1)).filter((i) => i >= 0);
  const lastTwo = new Set(humanIdx.length >= 2 ? humanIdx.slice(-2) : []);
  let html = '';
  st.forEach((m, i) => {
    const gap = m.finished ? (i === 0 ? fmtTime(m.finishTime) : '+' + (m.finishTime - st[0].finishTime).toFixed(1) + 's') : i === 0 ? `${Math.max(0, Math.round(sim.track.finishS - m.s))} m` : `−${Math.round(leaderS - m.s)} m`;
    const cls = ['row', i === 0 ? 'p1' : '', m.finished ? 'fin' : '', m.bot ? 'bot' : '', !m.finished && lastTwo.has(i) && state.phase === 'race' ? 'lastzone' : ''].join(' ');
    html += `<div class="${cls}"><div class="pos">${i + 1}</div><img src="${skinPreview(m.skin, 48)}" alt=""><div class="nm">${esc(m.name)}</div><div class="gap">${gap}</div></div>`;
  });
  box.innerHTML = html;

  const dots = $('dots');
  if (dots.children.length !== st.length) { dots.textContent = ''; for (const m of sim.marbles) { const img = document.createElement('img'); img.src = skinPreview(m.skin, 44); img.dataset.id = m.id; dots.appendChild(img); } }
  for (const img of dots.children) {
    const m = sim.marbles.find((x) => x.id === img.dataset.id);
    img.style.left = `calc(14px + (100% - 28px) * ${Math.min(1, m.s / sim.track.finishS).toFixed(4)})`;
  }
  $('hudTimer').textContent = fmtTime(state.raceTime);
  const lead = st.find((m) => !m.finished) || st[0];
  const sec = sectionAt(sim.track, lead.s);
  if (state.phase === 'race') $('hudSection').textContent = sec.mod === 'bend' ? '' : sec.label;
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtTime(t) { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; }

// distance calls, the home straight and comebacks
function raceCalls() {
  const sim = state.sim;
  const st = sim.standings();
  const lead = st.find((m) => !m.finished);
  if (!lead) return;
  const toGo = sim.track.finishS - lead.s;
  for (const d of [150, 75]) if (toGo < d && toGo > d - 25 && !state.calls.has(d) && !st[0].finished) { state.calls.add(d); caster.line('toGo', { dist: d === 150 ? 'A hundred and fifty' : 'Seventy-five', lead: lead.name }, 2.2, 3); }
  if (toGo < 28 && !state.calls.has('home') && !st[0].finished) { state.calls.add('home'); caster.line('homeStraight', { lead: lead.name }, 2.6, 3); }
  // a human who has been last and is now on the podium
  st.forEach((m, i) => {
    if (m.bot) return;
    const worst = Math.max(state.worstPos.get(m.id) ?? 0, i);
    state.worstPos.set(m.id, worst);
    if (worst >= st.length - 1 && i <= 2 && state.raceTime > 10 && !state.calls.has('cb' + m.id)) { state.calls.add('cb' + m.id); caster.line('comeback', { a: m.name, pos: NTH[i + 1] }, 2, 4); }
  });
}

function raceFacts() {
  const sim = state.sim;
  const st = sim.standings();
  const racing = st.filter((m) => !m.finished);
  const humans = st.filter((m) => !m.bot);
  return {
    track: THEMES[sim.track.theme].name,
    percentDone: Math.round(Math.min(1, (racing[0] || st[0]).s / sim.track.finishS) * 100),
    order: st.slice(0, 8).map((m, i) => `${i + 1}. ${m.name}${m.bot ? ' (computer)' : ''}${m.power ? ` holding ${POWERS[m.power].name}` : ''}`),
    gapLeaderToSecond: racing.length > 1 ? Math.round(racing[0].s - racing[1].s) + ' m' : 'n/a',
    lastHumanDrinksIfItStays: humans.length > 1 ? humans[humans.length - 1].name : null,
    tally: Object.values(state.tally).map((t) => `${t.name}: ${t.pts} pts, ${t.drinks} drinks`).slice(0, 6),
  };
}

function colourCommentary() {
  const sim = state.sim;
  const st = sim.standings().filter((m) => !m.finished);
  if (st.length < 2) return;
  // the local AI writes Dusty's colour lines when it's switched on
  if (caster.ai && Math.random() < 0.7) {
    caster.lastSaid = performance.now(); // don't ask again while it thinks
    caster.aiLine('Give one fresh piece of colour commentary about the race right now.', raceFacts(), 0.5, 7);
    return;
  }
  const holder = st.find((m) => !m.bot && m.power);
  if (holder && Math.random() < 0.4) { caster.line('holding', { a: holder.name, power: POWERS[holder.power].name }, 0.4, 3); return; }
  const humans = st.filter((m) => !m.bot);
  caster.line('filler', {
    lead: st[0].name, second: st[1].name, gap: Math.max(1, Math.round(st[0].s - st[1].s)),
    last: (humans[humans.length - 1] || st[st.length - 1]).name,
  }, 0.3, 3);
}

// ---------------- commentator settings ----------------
function applyVoiceSettings() {
  const S = state.settings;
  caster.enabled = S.commentator;
  caster.setEngine(S.voiceEngine);
  caster.voiceNames = S.voices[S.voiceEngine] || ['', ''];
  caster.ai = S.aiWriter;
  caster.aiModel = S.aiModel;
  renderVoices();
}
function renderVoices() {
  const eng = state.settings.voiceEngine;
  const opts = eng === 'browser'
    ? [['', 'Automatic'], ...caster.browserVoices().map((v) => [v.name, `${v.name} (${v.lang})`])]
    : KOKORO_VOICES;
  for (const [id, i] of [['voiceSel', 0], ['voiceSel2', 1]]) {
    const sel = $(id); sel.textContent = '';
    for (const [v, label] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o); }
    sel.value = state.settings.voices[eng]?.[i] ?? '';
  }
  if (eng === 'browser') $('voiceStatus').textContent = 'Built-in voices: instant and offline, but a bit robotic. Kokoro sounds far more natural.';
  if (eng === 'kokoro' && !caster.engines.kokoro?.ready && !$('voiceStatus').textContent.startsWith('Downloading')) $('voiceStatus').textContent = 'Kokoro runs right here in the browser. The first time it downloads the voice model (needs internet once).';
}
// is a local voice server / AI model running? (checked through the game server)
let aiInfo = null;
async function checkAi() {
  aiInfo = null;
  if (net.mode === 'ws') { try { aiInfo = await (await fetch('api/ai-status')).json(); } catch { aiInfo = null; } }
  const localOnly = net.mode !== 'ws' ? ' (needs the local server version: start.bat or node server/server.js)' : '';
  const S = state.settings;
  const sel = $('aiModel'); sel.textContent = '';
  const models = aiInfo?.models || [];
  if (!models.length) { const o = document.createElement('option'); o.value = ''; o.textContent = aiInfo?.llm ? 'Default model' : 'No AI server found'; sel.appendChild(o); }
  for (const m of models) { const o = document.createElement('option'); o.value = m; o.textContent = m; sel.appendChild(o); }
  if (S.aiModel && models.includes(S.aiModel)) sel.value = S.aiModel; else { S.aiModel = models[0] || ''; caster.aiModel = S.aiModel; }
  const notes = [];
  if (S.voiceEngine === 'server') notes.push(localOnly ? `⚠️ The voice server option${localOnly}. Pick Kokoro to get the natural voice right here.` : aiInfo?.tts ? '✅ Voice server connected.' : `⚠️ No voice server at ${aiInfo?.ttsUrl || 'port 8880'}. Start Kokoro-FastAPI (see README), or pick Kokoro to run it in the browser.`);
  if (S.aiWriter) notes.push(localOnly ? `⚠️ AI banter${localOnly}; the scripted lines still play.` : aiInfo?.llm ? `✅ AI banter on (${S.aiModel || 'default model'}).` : '⚠️ No local AI found. Start Ollama or LM Studio (see README); the scripted lines still play.');
  if (notes.length) $('voiceStatus').textContent = notes.join(' ');
}

// ---------------- split-screen pane labels ----------------
let paneSig = '';
function renderPaneLabels() {
  const panes = (state.phase === 'race' || state.phase === 'finishing') ? director.panes : null;
  const sig = panes ? panes.map((p) => p.label + JSON.stringify(p.rect)).join('|') : '';
  if (sig === paneSig) return;
  paneSig = sig;
  const layer = $('paneLayer'); layer.textContent = '';
  if (!panes || panes.length < 2) return;
  for (const p of panes) {
    const d = document.createElement('div'); d.className = 'pane';
    Object.assign(d.style, { left: p.rect.x * 100 + '%', top: p.rect.y * 100 + '%', width: p.rect.w * 100 + '%', height: p.rect.h * 100 + '%' });
    const l = document.createElement('span'); l.textContent = p.label; if (p.rect.y === 0) l.style.top = '76px'; d.appendChild(l);
    layer.appendChild(d);
  }
}

// ---------------- audio ----------------
let actx = null;
function unlockAudio() { if (!actx) { try { actx = new AudioContext(); } catch {} } else actx.resume?.(); }
function beep(freq, dur, type = 'triangle', vol = 0.18) {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
  o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
}
function fanfare() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.25, 'square', 0.08), i * 130)); }

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 5000);
}

// ---------------- main loop ----------------
let lastT = performance.now(), hudT = 0, phoneT = 0, resT = 0, posT = 0;
// marble positions for the phone radars, ~10 times a second
function broadcastPositions() {
  const sim = state.sim;
  if (!sim || !net.ready()) return;
  const r2 = (x) => Math.round(x * 100) / 100;
  net.broadcast({
    t: 'pos', st: r2(sim.t),
    m: sim.marbles.map((m) => [r2(m.s), r2(m.u)]),
    pk: sim.pickups.map((p) => (sim.t >= p.back ? 1 : 0)).join(''),
    tz: sim.tempZones.map((z) => [r2(z.s0), r2(z.s1)]),
  });
}
const TIME_SCALE = Number(new URLSearchParams(location.search).get('speed')) || 1; // testing aid
function frame(now) {
  const realDt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const dt = state.paused ? 0 : realDt * TIME_SCALE;
  const sim = state.sim;

  if (state.phase === 'countdown') {
    state.countdownT -= dt;
    const c = Math.ceil(state.countdownT);
    if (c !== state.lastCount && c > 0) {
      state.lastCount = c;
      if (c <= 3) { $('countdown').innerHTML = `<div>${c}</div>`; beep(440, 0.15); if (c === 3) caster.line('grid', {}, 2.2, 2.5); }
      else $('countdown').innerHTML = '<div style="font-size:12vh">GET READY</div>';
      pushViews();
    }
    if (state.countdownT <= 0) startRace();
  }
  if (state.phase === 'race') {
    state.raceTime += dt;
    sim.update(dt, state.settings.boosts);
    handleEvents();
    raceCalls();
    // colour commentary when it's been quiet for a while
    if (caster.enabled && caster.quietFor() > 6 && state.raceTime > 5) colourCommentary();
    const doneByTime = state.winnerTime != null && state.raceTime - state.winnerTime > AFTER_WIN_TIMEOUT;
    if (sim.allFinished() || doneByTime || state.raceTime > 300) {
      state.phase = 'finishing';
      state.finishT = 2.5;
    }
    phoneT += dt;
    if (phoneT > 0.25) { phoneT = 0; pushViews(); }
    posT += realDt;
    if (posT > 0.1) { posT = 0; broadcastPositions(); }
  }
  if (state.phase === 'finishing') {
    sim.update(dt, false);
    state.finishT -= dt;
    if (state.finishT <= 0) finishRace();
  }
  if (state.phase === 'results') {
    // keep marbles settling in the run-out while results show
    sim?.update(dt, false);
    resT += dt;
    const R = state.results;
    if (resT > 1) {
      resT = 0;
      if (!R.done && (performance.now() - R.startedAt) / 1000 > PICK_TIMEOUT) {
        for (const k of R.picks) if (!k.target) { const opts = R.humans.filter((h) => h.id !== k.by); k.target = opts[Math.floor(Math.random() * opts.length)].id; }
        finalizeDamage(); pushViews();
      }
      renderResults();
    }
  }

  if (sim && state.phase !== 'lobby') world.syncMarbles(sim.marbles, dt, state.phase !== 'results');
  const racingNow = sim && state.phase !== 'lobby';
  world.animate(now / 1000, sim?.started && state.phase !== 'lobby', state.raceTime, racingNow ? sim.t : now / 1000);
  world.syncFans(now / 1000, racingNow && sim.started ? sim.marbles.filter((m) => !m.finished).map((m) => m.s) : null);
  const inRace = sim && state.phase !== 'lobby';
  world.syncPickups(inRace ? sim.pickups : null, inRace ? sim.t : 0, now / 1000, realDt, state.settings.pickups);
  if (inRace) world.syncTempZones(sim.tempZones);
  director.style = state.settings.camera;
  director.update(dt, sim);
  renderPaneLabels();

  hudT += dt;
  if (hudT > 0.1 && (state.phase === 'race' || state.phase === 'finishing' || state.phase === 'countdown')) {
    hudT = 0;
    renderStandings();
    const cap = $('caption');
    cap.textContent = director.caption;
    cap.classList.toggle('hidden', !director.caption);
  }
  world.render(realDt);
  requestAnimationFrame(frame);
}

// ---------------- boot ----------------
// re-load saved photo skins, then refresh anything showing them
Promise.all([...state.players.values()].filter((p) => p.photo).map((p) => loadPhoto(p.pid, p.photo))).then(() => { renderLobby(); pushViews(); });
bindLobby();
newTrack();
renderLobby();
renderJoin();
net.start();
requestAnimationFrame(frame);

// handy for testing from the browser console
window.mm = { state, startCountdown, newTrack, world, director, net };
