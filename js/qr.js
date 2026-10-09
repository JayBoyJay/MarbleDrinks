// Minimal QR code generator (byte mode, error correction level M, versions 1-10).
// Runs in the browser so the game can make its own join QR on a static host.

// [ecCodewordsPerBlock, [[blockCount, dataCodewordsPerBlock], ...]] for level M
const VERSIONS = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
  7: [18, [[4, 31]]],
  8: [22, [[2, 38], [2, 39]]],
  9: [22, [[3, 36], [2, 37]]],
  10: [26, [[4, 43], [1, 44]]],
};
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// ---- Galois field GF(256), primitive polynomial 0x11d
const EXP = new Array(512), LOG = new Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gmul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly; // leading coefficient 1
}
function rsRemainder(data, degree) {
  const gen = rsGenerator(degree);
  const res = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ res.shift();
    res.push(0);
    for (let i = 0; i < degree; i++) res[i] ^= gmul(gen[i + 1], factor);
  }
  return res;
}

function dataCapacity(v) {
  return VERSIONS[v][1].reduce((s, [n, k]) => s + n * k, 0);
}

function encodeData(bytes, v) {
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capBits = dataCapacity(v) * 8;
  put(0, Math.min(4, capBits - bits.length));
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; out.push(b);
  }
  for (let pad = 0xec; out.length < dataCapacity(v); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function interleave(data, v) {
  const [ec, groups] = VERSIONS[v];
  const blocks = [], ecBlocks = [];
  let off = 0;
  for (const [n, k] of groups) for (let i = 0; i < n; i++) {
    const blk = data.slice(off, off + k); off += k;
    blocks.push(blk); ecBlocks.push(rsRemainder(blk, ec));
  }
  const out = [];
  const maxK = Math.max(...blocks.map(b => b.length));
  for (let i = 0; i < maxK; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ec; i++) for (const b of ecBlocks) out.push(b[i]);
  return out;
}

function bchBits(value, poly, polyDeg) {
  let v = value << polyDeg;
  for (let i = 31; i >= polyDeg; i--) if ((v >>> i) & 1) v ^= poly << (i - polyDeg);
  return (value << polyDeg) | v;
}

function buildMatrix(v, codewords, mask) {
  const size = 17 + 4 * v;
  const m = Array.from({ length: size }, () => new Array(size).fill(null));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c, val) => { m[r][c] = val ? 1 : 0; fn[r][c] = true; };

  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      set(rr, cc, on);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[v];
  for (const r of al) for (const c of al) {
    if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (r === al[al.length - 1] && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
      set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  // format info (level M = 00)
  const fmt = bchBits((0b00 << 3) | mask, 0x537, 10) ^ 0x5412;
  const fbit = i => (fmt >>> i) & 1;
  for (let i = 0; i <= 5; i++) set(i, 8, fbit(i));
  set(7, 8, fbit(6)); set(8, 8, fbit(7)); set(8, 7, fbit(8));
  for (let i = 9; i < 15; i++) set(8, 14 - i, fbit(i));
  for (let i = 0; i < 8; i++) set(8, size - 1 - i, fbit(i));
  for (let i = 8; i < 15; i++) set(size - 15 + i, 8, fbit(i));
  set(size - 8, 8, 1); // dark module
  if (v >= 7) {
    const ver = bchBits(v, 0x1f25, 12);
    for (let i = 0; i < 18; i++) {
      const b = (ver >>> i) & 1, a = Math.floor(i / 3), c = size - 11 + (i % 3);
      set(a, c, b); set(c, a, b);
    }
  }
  // data
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);
  const maskFn = [
    (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ][mask];
  let bi = 0, up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < size; k++) {
      const r = up ? size - 1 - k : k;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (fn[r][c]) continue;
        let b = bi < bits.length ? bits[bi] : 0; bi++;
        if (maskFn(r, c)) b ^= 1;
        m[r][c] = b;
      }
    }
    up = !up;
  }
  return m;
}

function penalty(m) {
  const n = m.length; let p = 0;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) {
    let run = 1;
    for (let j = 1; j < n; j++) {
      const a = pass ? m[j][i] : m[i][j], b = pass ? m[j - 1][i] : m[i][j - 1];
      if (a === b) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) {
    const s = m[i][j] + m[i + 1][j] + m[i][j + 1] + m[i + 1][j + 1];
    if (s === 0 || s === 4) p += 3;
  }
  const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) for (let j = 0; j <= n - 11; j++) {
    let h1 = true, h2 = true, v1 = true, v2 = true;
    for (let k = 0; k < 11; k++) {
      if (m[i][j + k] !== pat[k]) h1 = false;
      if (m[i][j + k] !== pat[10 - k]) h2 = false;
      if (m[j + k][i] !== pat[k]) v1 = false;
      if (m[j + k][i] !== pat[10 - k]) v2 = false;
    }
    p += 40 * (h1 + h2 + v1 + v2);
  }
  let dark = 0; for (const row of m) for (const x of row) dark += x;
  p += Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10;
  return p;
}

export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  let v = 1;
  while (v <= 10 && dataCapacity(v) < bytes.length + 2 + (v < 10 ? 0 : 1)) v++;
  if (v > 10) throw new Error('Text too long for QR');
  const cws = interleave(encodeData(bytes, v), v);
  let best = null, bestP = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const mtx = buildMatrix(v, cws, mask);
    const p = penalty(mtx);
    if (p < bestP) { bestP = p; best = mtx; }
  }
  return best;
}

export function qrSvg(text, { margin = 2, dark = '#000', light = '#fff' } = {}) {
  const m = qrMatrix(text);
  const n = m.length + margin * 2;
  let path = '';
  m.forEach((row, r) => row.forEach((x, c) => { if (x) path += `M${c + margin} ${r + margin}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}

export function qrDataUrl(text, opts) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qrSvg(text, opts)); }
