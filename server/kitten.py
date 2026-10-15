#!/usr/bin/env python3
"""Kitten TTS voice service for Marble Mayhem.

The commentary booth asks this small service for each line (POST /tts) and gets
back a WAV file. The model is loaded once and kept in memory.

Setup (once):
    pip install kittentts soundfile numpy
    (Kitten TTS needs espeak-ng for pronunciation: https://github.com/espeak-ng/espeak-ng/releases)

Run:
    python server/kitten.py            (listens on http://127.0.0.1:8190)
    KITTEN_MODEL=KittenML/kitten-tts-mini-0.8 python server/kitten.py   (bigger model)

start.bat and `node server/server.js` find it on port 8190 automatically.
"""
import io
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get('KITTEN_HOST', '127.0.0.1')
PORT = int(os.environ.get('KITTEN_PORT', '8190'))
MODEL = os.environ.get('KITTEN_MODEL', 'KittenML/kitten-tts-nano-0.1')
VOICES = ['Jasper', 'Bruno', 'Hugo', 'Leo', 'Bella', 'Luna', 'Rosie', 'Kiki']
DEFAULT_VOICE = 'Jasper'
MAX_CHARS = 400

_model = None
_lock = threading.Lock()  # the model is not thread-safe, so one line at a time


def load_model():
    global _model
    if _model is None:
        from kittentts import KittenTTS
        print(f'Loading Kitten TTS model {MODEL} ...', flush=True)
        _model = KittenTTS(MODEL)
        print('Kitten TTS ready.', flush=True)
    return _model


def synth(text, voice, speed):
    import numpy as np
    model = load_model()
    with _lock:
        try:
            audio = model.generate(text, voice=voice, speed=speed)
        except TypeError:
            # older releases don't take a speed argument
            audio = model.generate(text, voice=voice)
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    rate = 24000
    return audio, rate


def to_wav(audio, rate):
    import wave
    import numpy as np
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype('<i2')
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip('/') == '/health':
            return self._json(200, {'ok': True, 'engine': 'kitten-tts', 'model': MODEL, 'voices': VOICES, 'loaded': _model is not None})
        self._json(404, {'error': 'not found'})

    def do_POST(self):
        if self.path.rstrip('/') != '/tts':
            return self._json(404, {'error': 'not found'})
        try:
            length = int(self.headers.get('Content-Length') or 0)
            data = json.loads(self.rfile.read(length) or b'{}')
            text = str(data.get('text') or '').strip()[:MAX_CHARS]
            voice = data.get('voice') if data.get('voice') in VOICES else DEFAULT_VOICE
            speed = max(0.5, min(1.5, float(data.get('speed') or 1.0)))
            if not text:
                return self._json(400, {'error': 'no text'})
            audio, rate = synth(text, voice, speed)
            wav = to_wav(audio, rate)
        except Exception as e:  # keep the service alive whatever a line does
            print('TTS error:', e, file=sys.stderr, flush=True)
            return self._json(500, {'error': str(e)})
        self.send_response(200)
        self.send_header('Content-Type', 'audio/wav')
        self.send_header('Content-Length', str(len(wav)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(wav)

    def log_message(self, fmt, *args):
        pass  # keep the console quiet; errors still print


if __name__ == '__main__':
    try:
        load_model()  # load up front so the first race line isn't slow
    except Exception as e:
        print(f'Could not load Kitten TTS: {e}', file=sys.stderr)
        print('The game still runs; the commentary will show as captions only.', file=sys.stderr)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'Kitten TTS listening on http://{HOST}:{PORT}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
