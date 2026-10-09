// Marble skins, shared by the race screen and the phone controller.
// Each skin draws an equirectangular texture (2:1) on a canvas. The race screen
// wraps it on a sphere; phones render a small shaded sphere preview from it.
// To add a skin: add an entry to SKINS (and a painter if it needs a new type).
// Later idea: a 'photo' type that paints a player's face photo onto the front.

export const SKINS = [
  { id: 'ruby',      name: 'Ruby Swirl',     type: 'swirl',   c: ['#c3102f', '#ff7a8a', '#5a0012'] },
  { id: 'ocean',     name: 'Deep Ocean',     type: 'swirl',   c: ['#0a4c8f', '#4fd1ff', '#06213f'] },
  { id: 'lime',      name: 'Lime Zest',      type: 'stripes', c: ['#7bdc2a', '#e9ff9a', '#2f6b08'] },
  { id: 'sunset',    name: 'Sunset',         type: 'stripes', c: ['#ff5e3a', '#ffcb3a', '#b8216b'] },
  { id: 'galaxy',    name: 'Galaxy',         type: 'galaxy',  c: ['#120a2e', '#7b4dff', '#ff4fd8'] },
  { id: 'catseye',   name: "Cat's Eye",      type: 'catseye', c: ['#dff3f2', '#ff8a00', '#ffd23f'] },
  { id: 'cateye2',   name: 'Green Eye',      type: 'catseye', c: ['#e8f7e4', '#11a35a', '#bfff6b'] },
  { id: 'eight',     name: 'Eight Ball',     type: 'number',  c: ['#111111', '#ffffff', '#111111'], n: 8 },
  { id: 'nine',      name: 'Nine Ball',      type: 'pool',    c: ['#f6f1e4', '#f2b705', '#111111'], n: 9 },
  { id: 'checker',   name: 'Chequered Flag', type: 'checker', c: ['#ffffff', '#111111'] },
  { id: 'bumble',    name: 'Bumblebee',      type: 'stripes', c: ['#ffcc00', '#1a1a1a'], hard: true },
  { id: 'zebra',     name: 'Zebra',          type: 'zebra',   c: ['#f5f5f5', '#141414'] },
  { id: 'lava',      name: 'Molten',         type: 'lava',    c: ['#1b0d07', '#ff4d00', '#ffd000'] },
  { id: 'ice',       name: 'Frostbite',      type: 'crackle', c: ['#cfefff', '#5fb6ff', '#ffffff'] },
  { id: 'smiley',    name: 'Smiley',         type: 'face',    c: ['#ffd23f', '#3a2a00'] },
  { id: 'grumpy',    name: 'Grumpy',         type: 'face',    c: ['#8fd3ff', '#08263d'], grumpy: true },
  { id: 'rainbow',   name: 'Rainbow',        type: 'rainbow', c: [] },
  { id: 'camo',      name: 'Camo',           type: 'camo',    c: ['#4b5d2a', '#7b8c4a', '#2d3319', '#a39b6b'] },
  { id: 'halves',    name: 'Half & Half',    type: 'halves',  c: ['#ff2d87', '#2de1ff'] },
  { id: 'spots',     name: 'Polka',          type: 'dots',    c: ['#ffffff', '#ff3355'] },
  { id: 'mint',      name: 'Mint Choc',      type: 'dots',    c: ['#9ff2cf', '#4a2a17'], small: true },
  { id: 'gold',      name: 'Golden Orb',     type: 'metal',   c: ['#e7b416', '#fff1a8', '#8a5a00'] },
  { id: 'chrome',    name: 'Chrome',         type: 'metal',   c: ['#b9c2cc', '#ffffff', '#3d4752'] },
  { id: 'toxic',     name: 'Toxic',          type: 'spiral',  c: ['#39ff14', '#0b2b00', '#d4ff00'] },
];

export const SKIN_BY_ID = Object.fromEntries(SKINS.map((s) => [s.id, s]));

// Material hints for the 3D renderer.
export function skinMaterial(skin) {
  if (skin.type === 'metal') return { metalness: 0.95, roughness: 0.18, clearcoat: 0.3 };
  if (skin.type === 'catseye') return { metalness: 0.0, roughness: 0.05, clearcoat: 1.0 };
  return { metalness: 0.05, roughness: 0.22, clearcoat: 0.9 };
}

// ---------- texture painting ----------
function rng(seed) {
  let s = 0; for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

// Paint per-pixel with f(lon, lat) -> [r,g,b]; lon in [-PI,PI], lat in [-PI/2,PI/2]
function paintFn(ctx, W, H, f) {
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W - 0.5) * Math.PI * 2;
      const c = f(lon, lat);
      const i = (y * W + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// cartesian on unit sphere
function dir(lon, lat) { const cl = Math.cos(lat); return [cl * Math.sin(lon), Math.sin(lat), cl * Math.cos(lon)]; }

const PAINTERS = {
  swirl(ctx, W, H, s, r) {
    const [a, b, d] = s.c.map(hex);
    const k1 = 2 + r() * 2, k2 = 1 + r() * 2, ph = r() * 6;
    paintFn(ctx, W, H, (lon, lat) => {
      const [x, y, z] = dir(lon, lat);
      const t = Math.sin(k1 * x + Math.sin(k2 * y * 3 + ph) * 2 + z * 2.5) * 0.5 + 0.5;
      const u = Math.sin(5 * y + 3 * x - 2 * z + ph) * 0.5 + 0.5;
      return mix(mix(d, a, Math.min(1, t * 1.6)), b, Math.pow(u * t, 3));
    });
  },
  spiral(ctx, W, H, s) {
    const [a, b, d] = s.c.map(hex);
    paintFn(ctx, W, H, (lon, lat) => {
      const t = Math.sin(lon * 3 + lat * 9) * 0.5 + 0.5;
      return t > 0.55 ? a : t > 0.45 ? d : mix(b, a, t * 0.3);
    });
  },
  stripes(ctx, W, H, s) {
    const cols = s.c.map(hex);
    const n = s.hard ? 7 : 9;
    paintFn(ctx, W, H, (lon, lat) => {
      const v = (lat / Math.PI + 0.5) * n + Math.sin(lon * 2) * (s.hard ? 0 : 0.35);
      const i = Math.floor(v), f = v - i;
      const c0 = cols[((i % cols.length) + cols.length) % cols.length];
      const c1 = cols[(((i + 1) % cols.length) + cols.length) % cols.length];
      return s.hard ? c0 : mix(c0, c1, f > 0.8 ? (f - 0.8) * 5 : 0);
    });
  },
  galaxy(ctx, W, H, s, r) {
    const [a, b, d] = s.c.map(hex);
    paintFn(ctx, W, H, (lon, lat) => {
      const [x, y, z] = dir(lon, lat);
      const n = Math.sin(x * 4 + Math.sin(y * 5) * 1.5) * Math.cos(z * 3 + y * 2) * 0.5 + 0.5;
      return mix(a, n > 0.6 ? d : b, Math.pow(n, 2.2));
    });
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 140; i++) { const sz = r() < 0.1 ? 2 : 1; ctx.globalAlpha = 0.5 + r() * 0.5; ctx.fillRect(r() * W, r() * H, sz, sz); }
    ctx.globalAlpha = 1;
  },
  catseye(ctx, W, H, s) {
    const [base, vein, hi] = s.c.map(hex);
    paintFn(ctx, W, H, (lon, lat) => {
      // a twisted vein that wraps around the marble
      const ribbon = Math.abs(lat - Math.sin(lon * 2) * 0.55);
      const t = Math.max(0, 1 - ribbon / 0.32);
      const g = Math.max(0, 1 - ribbon / 0.12);
      const glassy = mix(base, [255, 255, 255], (Math.sin(lon * 3 + lat * 2) * 0.5 + 0.5) * 0.25);
      return mix(mix(glassy, vein, t), hi, g * 0.8);
    });
  },
  number(ctx, W, H, s) {
    const [base, circle, ink] = s.c;
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    drawNumberDisc(ctx, W, H, circle, ink, s.n);
  },
  pool(ctx, W, H, s) {
    const [white, band, ink] = s.c;
    ctx.fillStyle = white; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = band; ctx.fillRect(0, H * 0.3, W, H * 0.4);
    drawNumberDisc(ctx, W, H, white, ink, s.n);
  },
  checker(ctx, W, H, s) {
    const n = 16, m = 8;
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { ctx.fillStyle = s.c[(i + j) % 2]; ctx.fillRect((i * W) / n, (j * H) / m, W / n + 1, H / m + 1); }
  },
  zebra(ctx, W, H, s) {
    const [a, b] = s.c.map(hex);
    paintFn(ctx, W, H, (lon, lat) => {
      const v = Math.sin(lon * 7 + Math.sin(lat * 6) * 1.4 + Math.sin(lon * 2) * 0.8);
      return v > 0.25 ? b : a;
    });
  },
  lava(ctx, W, H, s) {
    const [rock, hot, glow] = s.c.map(hex);
    paintFn(ctx, W, H, (lon, lat) => {
      const [x, y, z] = dir(lon, lat);
      const n = Math.abs(Math.sin(x * 6 + Math.sin(y * 7) * 2) + Math.sin(z * 5 + x * 3)) * 0.5;
      const crack = Math.max(0, 1 - n * 5);
      return mix(mix(rock, hot, crack), glow, Math.pow(crack, 4));
    });
  },
  crackle(ctx, W, H, s) {
    const [a, b, c] = s.c.map(hex);
    paintFn(ctx, W, H, (lon, lat) => {
      const [x, y, z] = dir(lon, lat);
      const n = Math.abs(Math.sin(x * 9 + y * 3) * Math.sin(z * 7 - y * 5));
      return mix(mix(a, b, Math.sin(y * 3 + x) * 0.25 + 0.25), c, n < 0.06 ? 1 : 0);
    });
  },
  face(ctx, W, H, s) {
    const [base, ink] = s.c;
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    // face sits at lon = 0 (horizontal centre); squash horizontally since equirect stretches
    const cx = W / 2, cy = H / 2;
    ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.ellipse(cx - W * 0.045, cy - H * 0.1, W * 0.012, H * 0.06, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + W * 0.045, cy - H * 0.1, W * 0.012, H * 0.06, 0, 0, 7); ctx.fill();
    ctx.lineWidth = H * 0.035;
    ctx.beginPath();
    if (s.grumpy) {
      ctx.ellipse(cx, cy + H * 0.2, W * 0.06, H * 0.08, 0, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - W * 0.07, cy - H * 0.22); ctx.lineTo(cx - W * 0.025, cy - H * 0.18);
      ctx.moveTo(cx + W * 0.07, cy - H * 0.22); ctx.lineTo(cx + W * 0.025, cy - H * 0.18); ctx.stroke();
    } else {
      ctx.ellipse(cx, cy + H * 0.02, W * 0.07, H * 0.14, 0, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
  },
  rainbow(ctx, W, H) {
    paintFn(ctx, W, H, (lon, lat) => {
      const h = ((lon / (Math.PI * 2) + 0.5) * 360 + lat * 60) % 360;
      return hsl(h, 0.85, 0.55);
    });
  },
  camo(ctx, W, H, s, r) {
    ctx.fillStyle = s.c[0]; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = s.c[1 + Math.floor(r() * 3)];
      const x = r() * W, y = r() * H, rx = 8 + r() * 22, ry = 6 + r() * 12;
      for (const dx of [-W, 0, W]) { ctx.beginPath(); ctx.ellipse(x + dx, y, rx, ry, r() * 3, 0, 7); ctx.fill(); }
    }
  },
  halves(ctx, W, H, s) {
    const [a, b] = s.c;
    ctx.fillStyle = a; ctx.fillRect(0, 0, W / 2, H);
    ctx.fillStyle = b; ctx.fillRect(W / 2, 0, W / 2, H);
    ctx.fillStyle = '#fff'; ctx.fillRect(W / 2 - 2, 0, 4, H); ctx.fillRect(0, 0, 3, H);
  },
  dots(ctx, W, H, s, r) {
    ctx.fillStyle = s.c[0]; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = s.c[1];
    const rows = s.small ? 9 : 6;
    for (let j = 0; j < rows; j++) {
      const lat = (0.5 - (j + 0.5) / rows) * Math.PI;
      const count = Math.max(1, Math.round((s.small ? 18 : 10) * Math.cos(lat)));
      for (let i = 0; i < count; i++) {
        const x = ((i + (j % 2) * 0.5) / count) * W + (s.small ? r() * 6 : 0), y = ((j + 0.5) / rows) * H;
        const rr = (s.small ? 3 : 7) ;
        ctx.beginPath(); ctx.ellipse(x, y, rr / Math.max(0.3, Math.cos(lat)), rr, 0, 0, 7); ctx.fill();
      }
    }
  },
  metal(ctx, W, H, s) {
    const [a, b, d] = s.c.map(hex);
    paintFn(ctx, W, H, (lon, lat) => {
      const t = Math.sin(lat * 3 + Math.sin(lon * 2) * 0.4) * 0.5 + 0.5;
      return mix(d, mix(a, b, t * t), 0.35 + t * 0.65);
    });
  },
};

function drawNumberDisc(ctx, W, H, disc, ink, n) {
  ctx.fillStyle = disc;
  ctx.beginPath(); ctx.ellipse(W / 2, H / 2, W * 0.07, H * 0.17, 0, 0, 7); ctx.fill();
  ctx.fillStyle = ink; ctx.font = `bold ${Math.round(H * 0.24)}px Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.save(); ctx.translate(W / 2, H / 2 + H * 0.01); ctx.scale(0.75, 1); ctx.fillText(String(n), 0, 0); ctx.restore();
}

function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

// ---------- photo skins ----------
// A player's own photo or image. 'face' puts it on the front of the marble as a
// round decal (rest of the marble in the photo's edge colour); 'wrap' wraps the
// image right around the marble.
const CUSTOM = new Map(); // skin id -> { img, mode }
export const isCustomSkin = (id) => typeof id === 'string' && id.startsWith('custom:');
export function customSkinId(pid) { return 'custom:' + pid; }
export function registerCustomSkin(id, img, mode = 'face') {
  CUSTOM.set(id, { img, mode: mode === 'wrap' ? 'wrap' : 'face' });
  for (const c of [texCache, previewCache]) for (const k of [...c.keys()]) if (k.startsWith(id + ':')) c.delete(k);
}
export function hasCustomSkin(id) { return CUSTOM.has(id); }
export function skinName(id) { return isCustomSkin(id) ? 'Photo marble' : SKIN_BY_ID[id]?.name || ''; }

function paintCustom(ctx, W, H, { img, mode }) {
  const S = 256;
  const src = document.createElement('canvas'); src.width = src.height = S;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0, S, S);
  if (mode === 'wrap') {
    // the square image twice around the marble keeps it from looking stretched
    ctx.drawImage(src, 0, 0, W / 2, H); ctx.drawImage(src, W / 2, 0, W / 2, H);
    return;
  }
  const sd = sctx.getImageData(0, 0, S, S).data;
  // background: average colour around the edge of the photo
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < S; i += 4) for (const [x, y] of [[i, 2], [i, S - 3], [2, i], [S - 3, i]]) { const k = (y * S + x) * 4; r += sd[k]; g += sd[k + 1]; b += sd[k + 2]; n++; }
  const bg = [r / n, g / n, b / n];
  const R0 = 0.8; // radius of the decal on the front of the marble
  paintFn(ctx, W, H, (lon, lat) => {
    const [x, y, z] = dir(lon, lat);
    if (z <= 0) return bg;
    const px = x / R0, py = y / R0, rr = px * px + py * py;
    if (rr >= 1) return bg;
    const tx = Math.min(S - 1, Math.max(0, Math.floor((px + 1) / 2 * S)));
    const ty = Math.min(S - 1, Math.max(0, Math.floor((1 - py) / 2 * S)));
    const k = (ty * S + tx) * 4;
    const c = [sd[k], sd[k + 1], sd[k + 2]];
    return rr > 0.86 ? mix(c, bg, (rr - 0.86) / 0.14) : c;
  });
}

const texCache = new Map();
export function skinCanvas(skinId, W = 256) {
  const key = skinId + ':' + W;
  if (texCache.has(key)) return texCache.get(key);
  const skin = SKIN_BY_ID[skinId] || SKINS[0];
  const H = W / 2;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (CUSTOM.has(skinId)) paintCustom(ctx, W, H, CUSTOM.get(skinId));
  else (PAINTERS[skin.type] || PAINTERS.swirl)(ctx, W, H, skin, rng(skin.id));
  texCache.set(key, cv);
  return cv;
}

// A shaded sphere preview as a data URL (used for phone pickers, lobby cards, HUD)
const previewCache = new Map();
export function skinPreview(skinId, size = 96) {
  const key = skinId + ':' + size;
  if (previewCache.has(key)) return previewCache.get(key);
  const src = skinCanvas(skinId, 256);
  const sctx = src.getContext('2d', { willReadFrequently: true });
  const sd = sctx.getImageData(0, 0, src.width, src.height).data;
  const SW = src.width, SH = src.height;
  const metal = (SKIN_BY_ID[skinId] || {}).type === 'metal';
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const L = norm([-0.45, 0.6, 0.65]);
  // tilt so we see a bit of the top
  const tilt = 0.35, ct = Math.cos(tilt), st = Math.sin(tilt);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size * 2 - 1, y = 1 - (py + 0.5) / size * 2;
      const rr = x * x + y * y;
      const i = (py * size + px) * 4;
      if (rr > 1) { img.data[i + 3] = 0; continue; }
      const z = Math.sqrt(1 - rr);
      // rotate normal by tilt around X for texture lookup
      const ny = y * ct - z * st, nz = y * st + z * ct;
      const lon = Math.atan2(x, nz), lat = Math.asin(Math.max(-1, Math.min(1, ny)));
      const tx = Math.min(SW - 1, Math.floor((lon / (Math.PI * 2) + 0.5) * SW));
      const ty = Math.min(SH - 1, Math.floor((0.5 - lat / Math.PI) * SH));
      const si = (ty * SW + tx) * 4;
      const diff = Math.max(0, x * L[0] + y * L[1] + z * L[2]);
      const h = norm([L[0], L[1], L[2] + 1]);
      const spec = Math.pow(Math.max(0, x * h[0] + y * h[1] + z * h[2]), metal ? 18 : 60) * (metal ? 0.9 : 1.1);
      const rim = Math.pow(1 - z, 3) * 0.25;
      const shade = 0.35 + diff * 0.75;
      const edge = Math.min(1, (1 - Math.sqrt(rr)) * size * 0.5); // anti-alias edge
      for (let k = 0; k < 3; k++) img.data[i + k] = Math.min(255, sd[si + k] * shade + 255 * (spec + rim));
      img.data[i + 3] = 255 * edge;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL();
  previewCache.set(key, url);
  return url;
}

function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }

// Main colour of a skin, for UI accents
export function skinColor(skinId) {
  const s = SKIN_BY_ID[skinId];
  if (!s || !s.c.length) return '#ff5e9c';
  return s.type === 'pool' || s.type === 'catseye' ? s.c[1] : s.c[0];
}
