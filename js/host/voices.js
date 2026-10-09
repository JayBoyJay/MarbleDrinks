// Voice engines for the commentators. Each engine turns a line into sound and
// resolves when it has finished playing.
//  - browser: the computer's built-in voices (offline, instant, robotic-ish)
//  - kokoro:  Kokoro-82M running inside the race screen's browser (natural;
//             downloads ~90-300 MB once from the internet, then cached).
//             Uses the graphics card (WebGPU) when available.
//  - server:  any OpenAI-compatible local voice server (e.g. Kokoro-FastAPI),
//             reached through the game server at /api/tts. Best quality and
//             speed if you have it running.

export const KOKORO_VOICES = [
  ['bm_george', 'George (British)'], ['bm_fable', 'Fable (British)'], ['bm_lewis', 'Lewis (British)'], ['bm_daniel', 'Daniel (British)'],
  ['am_michael', 'Michael (American)'], ['am_adam', 'Adam (American)'], ['am_eric', 'Eric (American)'], ['am_liam', 'Liam (American)'],
  ['am_onyx', 'Onyx (American)'], ['am_fenrir', 'Fenrir (American)'], ['am_puck', 'Puck (American)'],
  ['af_heart', 'Heart (American)'], ['af_bella', 'Bella (American)'], ['af_nicole', 'Nicole (American)'],
  ['bf_emma', 'Emma (British)'], ['bf_isabella', 'Isabella (British)'],
];
export const DEFAULT_VOICES = { kokoro: ['bm_george', 'am_michael'], server: ['bm_george', 'am_michael'], browser: ['', ''] };

let actx = null;
function audioCtx() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx; }

let currentSrc = null;
export function stopAudio() { try { currentSrc?.stop(); } catch {} currentSrc = null; }
function playBuffer(buf) {
  return new Promise((resolve) => {
    const ctx = audioCtx();
    const src = ctx.createBufferSource();
    currentSrc = src;
    src.buffer = buf;
    const gain = ctx.createGain(); gain.gain.value = 1.1;
    src.connect(gain).connect(ctx.destination);
    src.onended = () => resolve();
    src.start();
    // safety net in case onended never fires
    setTimeout(resolve, buf.duration * 1000 + 400);
  });
}

// small cache so repeated calls ("And they're off!") don't re-synthesise
class Cache {
  constructor(n = 80) { this.n = n; this.map = new Map(); }
  get(k) { const v = this.map.get(k); if (v) { this.map.delete(k); this.map.set(k, v); } return v; }
  set(k, v) { this.map.set(k, v); if (this.map.size > this.n) this.map.delete(this.map.keys().next().value); }
}

// ---------------- built-in browser voices ----------------
const PREFERRED = [
  ['Google UK English Male', 'Daniel', 'Microsoft Ryan', 'Arthur', 'Microsoft George', 'Microsoft Guy'],
  ['Google US English', 'Alex', 'Microsoft Guy', 'Microsoft Christopher', 'Fred', 'Samantha', 'Microsoft Aria'],
];
export class BrowserEngine {
  constructor() { this.kind = 'browser'; this.synth = window.speechSynthesis || null; this.ready = !!this.synth; }
  voices() { return this.synth ? this.synth.getVoices().filter((v) => /^en/i.test(v.lang)) : []; }
  pick(name, speaker) {
    const vs = this.voices();
    if (name) { const v = vs.find((x) => x.name === name); if (v) return v; }
    for (const n of PREFERRED[speaker] || PREFERRED[0]) { const v = vs.find((x) => x.name.includes(n)); if (v) return v; }
    return vs[speaker] || vs[0] || null;
  }
  speak(text, { voice, speaker = 0, energy = 0.5 }) {
    return new Promise((resolve) => {
      if (!this.synth) { setTimeout(resolve, 1500 + text.length * 50); return; }
      const u = new SpeechSynthesisUtterance(text);
      const v = this.pick(voice, speaker); if (v) u.voice = v;
      u.rate = 1.0 + energy * 0.28; u.pitch = (speaker ? 0.92 : 1.0) + energy * 0.18; u.volume = 1;
      u.onend = resolve; u.onerror = resolve;
      setTimeout(resolve, 1500 + text.length * 110);
      this.synth.speak(u);
    });
  }
  stop() { this.synth?.cancel(); }
}

// ---------------- Kokoro in the browser ----------------
const KOKORO_URL = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export class KokoroEngine {
  constructor(onStatus) { this.kind = 'kokoro'; this.ready = false; this.loading = null; this.onStatus = onStatus || (() => {}); this.cache = new Cache(); }
  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const webgpu = !!navigator.gpu && !!(await navigator.gpu.requestAdapter().catch(() => null));
      this.onStatus(`Downloading Kokoro voice model${webgpu ? ' (graphics card)' : ''}… this happens once`);
      const { KokoroTTS } = await import(KOKORO_URL);
      this.tts = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
        dtype: webgpu ? 'fp32' : 'q8', device: webgpu ? 'webgpu' : 'wasm',
        progress_callback: (p) => { if (p.status === 'progress' && p.total) this.onStatus(`Downloading Kokoro voice model… ${Math.round((p.loaded / p.total) * 100)}%`); },
      });
      this.device = webgpu ? 'graphics card' : 'processor';
      this.ready = true;
      this.onStatus(`Kokoro ready (running on the ${this.device})`);
    })().catch((e) => { this.loading = null; this.onStatus(`Kokoro failed to load: ${e.message || e}. Falling back to browser voices.`); throw e; });
    return this.loading;
  }
  async synth(text, voice, speed) {
    const key = `${voice}|${speed.toFixed(2)}|${text}`;
    let buf = this.cache.get(key);
    if (buf) return buf;
    const raw = await this.tts.generate(text, { voice, speed });
    const ctx = audioCtx();
    buf = ctx.createBuffer(1, raw.audio.length, raw.sampling_rate);
    buf.copyToChannel(raw.audio, 0);
    this.cache.set(key, buf);
    return buf;
  }
  async speak(text, { voice, speaker = 0, energy = 0.5 }) {
    if (!this.ready) await this.load();
    const v = voice || DEFAULT_VOICES.kokoro[speaker];
    const buf = await this.synth(text, v, 0.98 + energy * 0.22);
    await playBuffer(buf);
  }
  stop() {}
}

// ---------------- local voice server (OpenAI-compatible) ----------------
export class ServerEngine {
  constructor(onStatus) { this.kind = 'server'; this.ready = true; this.onStatus = onStatus || (() => {}); this.cache = new Cache(); }
  async synth(text, voice, speed) {
    const key = `${voice}|${speed.toFixed(2)}|${text}`;
    let buf = this.cache.get(key);
    if (buf) return buf;
    const res = await fetch('api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: text, voice, speed }) });
    if (!res.ok) throw new Error(`voice server said ${res.status}`);
    buf = await audioCtx().decodeAudioData(await res.arrayBuffer());
    this.cache.set(key, buf);
    return buf;
  }
  async speak(text, { voice, speaker = 0, energy = 0.5 }) {
    const v = voice || DEFAULT_VOICES.server[speaker];
    const buf = await this.synth(text, v, 0.98 + energy * 0.22);
    await playBuffer(buf);
  }
  stop() {}
}
