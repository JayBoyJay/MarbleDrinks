// Commentary voices. The only voice engine is Kitten TTS, a small text-to-speech
// model that runs on the local Marble Mayhem server (see server/kitten.py).
// The race screen asks the server for each line as a WAV file (api/tts), decodes it
// and plays it. If the server or Kitten isn't running, the booth shows captions only.

// Kitten TTS preset voices (the names the model ships with).
export const KITTEN_VOICES = [
  ['Jasper', 'Jasper (male)'], ['Bruno', 'Bruno (male)'], ['Hugo', 'Hugo (male)'], ['Leo', 'Leo (male)'],
  ['Bella', 'Bella (female)'], ['Luna', 'Luna (female)'], ['Rosie', 'Rosie (female)'], ['Kiki', 'Kiki (female)'],
];
// Ray (play-by-play) and Dusty (colour)
export const DEFAULT_VOICES = { kitten: ['Jasper', 'Bruno'] };

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

// ---------------- Kitten TTS via the local server ----------------
export class KittenEngine {
  constructor(onStatus) { this.kind = 'kitten'; this.onStatus = onStatus || (() => {}); this.cache = new Cache(); this.available = null; this.warned = false; }
  async synth(text, voice, speed) {
    const key = `${voice}|${speed.toFixed(2)}|${text}`;
    let buf = this.cache.get(key);
    if (buf) return buf;
    const res = await fetch('api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: text, voice, speed }) });
    if (!res.ok) throw new Error(await res.text().catch(() => `voice server said ${res.status}`));
    buf = await audioCtx().decodeAudioData(await res.arrayBuffer());
    this.cache.set(key, buf);
    this.available = true;
    return buf;
  }
  async speak(text, { voice, speaker = 0, energy = 0.5 }) {
    const v = voice || DEFAULT_VOICES.kitten[speaker] || DEFAULT_VOICES.kitten[0];
    const buf = await this.synth(text, v, 0.98 + energy * 0.22);
    await playBuffer(buf);
  }
  stop() {}
}
