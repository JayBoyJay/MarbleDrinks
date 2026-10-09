// Modular track generator.
// A track is built from "modules" (hairpin, split, bridge, peg forest, jump...)
// laid down by a turtle that descends a hill. The track is a channel dug into
// the hillside: a curved U-shaped trough, like Jelle's Sand Marble Rally.
// The result is sampled every DS units along the centreline; the physics and
// the renderer both work from those samples.

export const DS = 0.5;          // sample spacing along the track
export const BASE_HW = 2.6;     // half width of a normal section
export const MARBLE_R = 0.45;

export const THEMES = {
  meadow: {
    name: 'Meadow Run', sky: 0x8fd3ff, horizon: 0xdff4ff, fog: [60, 260],
    ground: [0x4f9a35, 0x7cc04f, 0x3b7a28], rockColor: 0x8a8f86,
    floor: 0xcf9e66, wall: 0x7b4a24, rail: 0xffffff, accent: 0xff4d6d,
    slow: { name: 'Mud Pit', color: 0x5b3a1e, mu: 0.33 }, fast: { name: 'Speed Strip', color: 0x2ad1ff },
    decor: 'trees', water: 0x3fa7d6, muScale: 1, sun: 0xfff2d6,
  },
  desert: {
    name: 'Desert Canyon', sky: 0xf2b872, horizon: 0xffe2b0, fog: [50, 240],
    ground: [0xd9a15f, 0xe8bd7c, 0xb87a3e], rockColor: 0xa85a32,
    floor: 0xe7c48f, wall: 0xa0522d, rail: 0xfff1d6, accent: 0x2ec4b6,
    slow: { name: 'Sand Trap', color: 0xf3d79b, mu: 0.36 }, fast: { name: 'Tailwind', color: 0xff6b35 },
    decor: 'cacti', water: null, muScale: 1.05, sun: 0xffe0b0,
  },
  snow: {
    name: 'Frozen Peaks', sky: 0xbcdcff, horizon: 0xf1f7ff, fog: [45, 220],
    ground: [0xf4f8ff, 0xffffff, 0xd5e4f5], rockColor: 0x6d7f93,
    floor: 0xb4dcf7, wall: 0x2f5f94, rail: 0xffffff, accent: 0xff3b6b,
    slow: { name: 'Snowdrift', color: 0xffffff, mu: 0.3 }, fast: { name: 'Black Ice', color: 0x6fc9ff },
    decor: 'pines', water: null, muScale: 0.65, sun: 0xffffff,
  },
  lava: {
    name: 'Volcano Dash', sky: 0x2b0c10, horizon: 0x7a2412, fog: [35, 200],
    ground: [0x2e2626, 0x3d3232, 0x1c1717], rockColor: 0x2a2020,
    floor: 0x46464f, wall: 0x1e1e24, rail: 0xff7a2a, accent: 0xffb000,
    slow: { name: 'Ash Bog', color: 0x77706b, mu: 0.34 }, fast: { name: 'Lava Vent', color: 0xff5a00 },
    decor: 'lavarocks', water: 0xff4a00, muScale: 1, sun: 0xffb27a,
  },
  moon: {
    name: 'Moon Base', sky: 0x02030a, horizon: 0x0b1030, fog: [120, 420],
    ground: [0x85858b, 0x9c9ca2, 0x5e5e66], rockColor: 0x4a4a52,
    floor: 0xb3b3b8, wall: 0x50505a, rail: 0xdfe6ff, accent: 0x4dd2ff,
    slow: { name: 'Moon Dust', color: 0x8d8d92, mu: 0.32 }, fast: { name: 'Rocket Strip', color: 0x4dd2ff },
    decor: 'moon', water: null, muScale: 0.9, sun: 0xffffff, gravity: 0.38, stars: true,
  },
  castle: {
    name: 'Castle Siege', sky: 0x7fb2e6, horizon: 0xd8e6f2, fog: [60, 260],
    ground: [0x5c8f3a, 0x77a64a, 0x456e2b], rockColor: 0x8a8580,
    floor: 0xb9ab95, wall: 0x6f6658, rail: 0xe8d9a8, accent: 0xc0392b,
    slow: { name: 'Moat Mud', color: 0x4e3b25, mu: 0.33 }, fast: { name: 'Royal Carpet', color: 0xd4202c },
    decor: 'castle', water: 0x3d6f8f, muScale: 1, sun: 0xffecc9,
  },
  candy: {
    name: 'Candy Land', sky: 0xffb3dd, horizon: 0xfff0f8, fog: [60, 260],
    ground: [0x9be8b0, 0xc8f5d0, 0x7ed99a], rockColor: 0xff9fcf,
    floor: 0xffe1b5, wall: 0xff6fae, rail: 0xffffff, accent: 0x7b4dff,
    slow: { name: 'Syrup Swamp', color: 0x9b4a1f, mu: 0.36 }, fast: { name: 'Sugar Rush', color: 0xff3dbe },
    decor: 'candy', water: 0xff8fd0, muScale: 0.95, sun: 0xfff3fa,
  },
  neon: {
    name: 'Neon City', sky: 0x090018, horizon: 0x3a0a5c, fog: [60, 300],
    ground: [0x140a2a, 0x1c0f3a, 0x0c0620], rockColor: 0x2a1d4a,
    floor: 0x2b2440, wall: 0x14102a, rail: 0x3de1ff, accent: 0xff3dbe,
    slow: { name: 'Static Field', color: 0x5a3a8a, mu: 0.32 }, fast: { name: 'Hyperlane', color: 0x3de1ff },
    decor: 'neon', water: null, muScale: 0.9, sun: 0xb9a6ff, stars: true, glow: true,
  },
};
export const THEME_KEYS = Object.keys(THEMES);

export function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const D2R = Math.PI / 180;

// ---------------- channel profile ----------------
// Cross-section of the dug channel: a flat-ish bottom that curves up into
// sandy walls, a rounded lip, then the hillside. `a` is |u| from the centre.
export const WALL_H = 0.95;   // wall height at the edge of the running surface (u = hw)
export const LIP_W = 1.5;     // width of the rounded lip outside the running surface
export const LIP_H = 1.15;    // lip crest height

export function surfH(sm, u) {
  const a = Math.abs(u), hw = sm.hw, keep = 1 - (sm.flat || 0);
  const f = hw * 0.36;
  let h = 0;
  if (a > f) { const t = Math.min(1.15, (a - f) / (hw - f)); h = WALL_H * t * t * keep; }
  if (sm.div > 0.02) {
    const w = sm.div + 0.7;
    if (a < w) { const t = 1 - (a / w) * (a / w); h = Math.max(h, 1.2 * t * Math.min(1, sm.div / 0.5)); }
  }
  return h + (sm.ramp || 0);
}

export function surfSlope(sm, u) {
  const e = 0.02;
  return (surfH(sm, u + e) - surfH(sm, u - e)) / (2 * e);
}

// render profile, including the lip beyond the running surface
export function renderH(sm, u) {
  const a = Math.abs(u), hw = sm.hw;
  if (a <= hw) return surfH(sm, u);
  const keep = 1 - (sm.flat || 0);
  const t = Math.min(1, (a - hw) / LIP_W);
  const rise = Math.sin(Math.min(1, t * 1.6) * Math.PI / 2); // round over the crest
  const fall = t > 0.62 ? (t - 0.62) / 0.38 : 0;
  return (WALL_H + (LIP_H - WALL_H) * rise - 0.25 * fall * fall) * keep + (sm.ramp || 0) * (1 - t);
}

// ---------------- modules ----------------
// A module returns pieces (len, turn in degrees, slope in degrees, optional
// width/divider profiles) and features positioned in module-local distance.
// `dir` (+1 left / -1 right) is chosen by the generator so the track never runs
// into itself.

const MODULES = {
  sweeper: { label: 'Sweeping Bend', make(r, dir) {
    const a = 70 + r() * 60, R = 13 + r() * 7;
    return { pieces: [{ len: R * a * D2R, turn: a * dir, slope: 6 + r() * 2 }] };
  } },
  hairpin: { label: 'Hairpin', make(r, dir) {
    const R = 9 + r() * 2;
    return { pieces: [{ len: 4, turn: 0, slope: 5 }, { len: R * 175 * D2R, turn: 175 * dir, slope: 6.5 }, { len: 5, turn: 0, slope: 6 }] };
  } },
  chicane: { label: 'Chicane', make(r, dir) {
    const a = 45 + r() * 15, R = 9 + r() * 2;
    return { pieces: [{ len: R * a * D2R, turn: a * dir, slope: 7 }, { len: R * a * 2 * D2R, turn: -2 * a * dir, slope: 7 }, { len: R * a * D2R, turn: a * dir, slope: 7 }] };
  } },
  spiral: { label: 'Spiral', make(r, dir) {
    const a = 210 + r() * 40, R = 11.5;
    return { pieces: [{ len: R * a * D2R, turn: a * dir, slope: 8.5 }] };
  } },
  pegs: { label: 'Peg Forest', make(r, dir) {
    const len = 30, f = { pegs: [] };
    let row = 0;
    // rows of 3 and 2 pegs; every gap is wider than a marble and the edge pegs
    // hug the walls so nothing can be pinned
    for (let s = 5; s < len - 4; s += 3.1, row++) {
      const us = row % 2 ? [-1.2, 1.2] : [-2.62, 0, 2.62];
      for (const u of us) if (Math.abs(u) > 2 || r() < 0.85) f.pegs.push({ s: s + (r() - 0.5) * 0.4, u: u + (Math.abs(u) > 2 ? 0 : (r() - 0.5) * 0.2), r: 0.2 });
    }
    return { pieces: [{ len, turn: r() * 25 * dir, slope: 12.5 }], feats: f };
  } },
  split: { label: 'The Split', make(r, dir) {
    const len = 46, W = 4.5;
    const hw = (s) => BASE_HW + (W - BASE_HW) * smooth01((s - 1) / 8) * (1 - smooth01((s - 37) / 8));
    const div = (s) => 1.15 * smooth01((s - 6) / 7) * (1 - smooth01((s - 32) / 7));
    const f = { bumps: [], zones: [], pegs: [], split: [{ s0: 6, s1: 39 }] };
    // two lanes with different flavours; the coin decides which side gets which
    const side = r() < 0.5 ? 1 : -1; // +1 = left lane gets the rough option
    const rough = r() < 0.5 ? 'humps' : 'pegs';
    if (rough === 'humps') for (const s of [15, 20, 25, 30]) f.bumps.push({ s, u0: side > 0 ? 0 : -9, u1: side > 0 ? 9 : 0 });
    else for (let s = 14, k = 0; s < 31; s += 1.7, k++) for (const u of (k % 2 ? [2.85] : [1.3, 4.6])) f.pegs.push({ s, u: u * side, r: 0.2 });
    // the other lane: a slow patch followed by a speed strip (risk then reward)
    f.zones.push({ s0: 13, s1: 21, type: 'slow', u0: side > 0 ? -9 : 0, u1: side > 0 ? 0 : 9 });
    f.zones.push({ s0: 24, s1: 31, type: 'fast', u0: side > 0 ? -9 : 0, u1: side > 0 ? 0 : 9 });
    return { pieces: [{ len, turn: r() * 35 * dir, slope: 7.5, hw, div }], feats: f };
  } },
  bridge: { label: 'Rickety Bridge', make(r, dir) {
    const len = 36, BH = 1.55;
    const hw = (s) => BASE_HW + (BH - BASE_HW) * smooth01((s - 3) / 3) * (1 - smooth01((s - 30) / 3));
    // the channel flattens out as it reaches the planks, then curves back after
    const flat = (s) => smooth01((s - 2) / 4) * (1 - smooth01((s - 30) / 4));
    return { pieces: [{ len, turn: r() * 14 * dir, slope: 3.5, hw, flat, bridge: [7, 29] }], feats: { bridges: [{ s0: 7, s1: 29 }] } };
  } },
  sandtrap: { label: 'Trap', make() {
    return { pieces: [{ len: 26, turn: 0, slope: 8.5 }], feats: { zones: [{ s0: 6, s1: 19, type: 'slow' }] } };
  } },
  humps: { label: 'Speed Humps', make() {
    return { pieces: [{ len: 26, turn: 0, slope: 9 }], feats: { bumps: [6, 11, 16, 21].map((s) => ({ s })) } };
  } },
  jump: { label: 'Big Air', make() {
    return {
      pieces: [{ len: 32, turn: 0, slope: 9, gap: [21, 24.5] }],
      feats: { zones: [{ s0: 8, s1: 18, type: 'fast' }], jumps: [{ s: 21, gap0: 21, gap1: 24.5 }] },
    };
  } },
  gates: { label: 'Sweeper Alley', make(r, dir) {
    const g = [];
    for (const s of [8, 15, 22]) g.push({ s, w: 1.2, d: 0.55, speed: 1.1 + r() * 0.8, phase: r() * 6.28 });
    return { pieces: [{ len: 29, turn: r() * 18 * dir, slope: 7.5 }], feats: { gates: g } };
  } },
  plunge: { label: 'The Plunge', make() {
    return { pieces: [{ len: 5, turn: 0, slope: 6 }, { len: 14, turn: 0, slope: 21 }, { len: 8, turn: 0, slope: 4 }] };
  } },
  chute: { label: 'Chute', make(r, dir) {
    return { pieces: [{ len: 30, turn: r() * 22 * dir, slope: 10 }], feats: { zones: [{ s0: 5, s1: 25, type: 'fast' }] } };
  } },
};

// ---------- wackier modules ----------
Object.assign(MODULES, {
  waves: { label: 'Rolling Waves', make(r, dir) {
    // a run of humps: down, up, down, up… marbles slow on every rise
    const pieces = [];
    for (let k = 0; k < 4; k++) pieces.push({ len: 9, turn: (r() - 0.5) * 8, slope: 15 }, { len: 6, turn: 0, slope: -6 });
    pieces.push({ len: 6, turn: 0, slope: 8 });
    return { pieces };
  } },
  bumpers: { label: 'Pinball Alley', make(r, dir) {
    // springy round bumpers that kick marbles away, like a pinball table
    const b = [];
    for (let s = 6, k = 0; s < 30; s += 4.5, k++) {
      const us = k % 2 ? [-1.1, 1.1] : [0];
      for (const u of us) b.push({ s: s + (r() - 0.5) * 0.6, u: u + (r() - 0.5) * 0.3, r: 0.42 });
    }
    return { pieces: [{ len: 36, turn: r() * 14 * dir, slope: 9 }], feats: { bumpers: b } };
  } },
  windmill: { label: 'The Windmill', make(r, dir) {
    // a big spinning bar right across the channel
    const w = [{ s: 14, len: BASE_HW - 0.5, omega: (1.3 + r() * 0.6) * (r() < 0.5 ? 1 : -1), phase: r() * 6.28 }, { s: 26, len: BASE_HW - 0.5, omega: (1.0 + r() * 0.6) * (r() < 0.5 ? 1 : -1), phase: r() * 6.28 }];
    return { pieces: [{ len: 34, turn: r() * 10 * dir, slope: 8 }], feats: { windmills: w } };
  } },
  portal: { label: 'Portal Shortcut', make(r, dir) {
    // one half of the channel has a portal that jumps marbles 24 m ahead
    const side = r() < 0.5 ? 1 : -1;
    const u0 = side > 0 ? 0.2 : -9, u1 = side > 0 ? 9 : -0.2;
    return {
      pieces: [{ len: 40, turn: r() * 20 * dir, slope: 7 }],
      feats: { portals: [{ sIn: 8, sOut: 32, u0, u1, side }], zones: [{ s0: 3, s1: 7.5, type: 'slow', u0, u1 }] },
    };
  } },
  tramps: { label: 'Bounce Pads', make(r, dir) {
    // trampolines launch marbles high over the pegs between them
    const pegs = [];
    for (const s of [12, 14.4]) for (const u of [-1.6, 0, 1.6]) pegs.push({ s: s + (r() - 0.5) * 0.3, u, r: 0.2 });
    return {
      pieces: [{ len: 32, turn: r() * 12 * dir, slope: 8 }],
      feats: { tramps: [{ s: 8 }, { s: 21 }], pegs },
    };
  } },
  slalom: { label: 'Slalom', make(r, dir) {
    const R = 8.5, a = 38;
    const pieces = [];
    for (let k = 0; k < 4; k++) pieces.push({ len: R * a * D2R * (k === 0 ? 1 : 2), turn: (k % 2 ? -1 : 1) * dir * a * (k === 0 ? 1 : 2), slope: 7.5 });
    pieces.push({ len: R * a * D2R, turn: dir * a, slope: 7 });
    return { pieces };
  } },
});

function smooth01(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

const FEATURE_MODULES = ['pegs', 'split', 'bridge', 'sandtrap', 'humps', 'jump', 'gates', 'plunge', 'chute', 'waves', 'bumpers', 'windmill', 'portal', 'tramps'];
const BEND_MODULES = ['sweeper', 'hairpin', 'chicane', 'spiral', 'sweeper', 'slalom'];

export const LENGTHS = { short: 5, medium: 8, long: 11 }; // number of feature modules

// ---------------- generator ----------------
export function generateTrack({ seed = (Math.random() * 1e9) | 0, theme = 'meadow', length = 'medium' } = {}) {
  let best = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const t = buildOnce(seed + attempt * 7919, theme, length);
    if (!t) continue;
    if (!best || t.conflicts < best.conflicts) best = t;
    if (t.conflicts === 0) break;
  }
  return best;
}

// Rebuild one exact track from its seed (phones use this to draw their radar).
export function buildTrackFromSeed(seed, theme, lengthKey) { return buildOnce(seed, theme, lengthKey); }

// Clearance between two parts of the track that are far apart along the course.
// The channel is dug into a single hillside, so it may never cross itself.
const CLEAR = 7;

function buildOnce(seed, themeKey, lengthKey) {
  const r = mulberry(seed);
  const theme = THEMES[themeKey];
  const nFeat = LENGTHS[lengthKey] || 8;

  // features in random order; always a split, a bridge and a jump
  // every track gets a split, a bridge, a jump, and at least one wacky module
  const must = ['split', 'bridge', 'jump', ['bumpers', 'windmill', 'portal', 'tramps'][Math.floor(r() * 4)]];
  const pool = FEATURE_MODULES.filter((m) => !must.includes(m));
  const feats = [...must];
  while (feats.length < nFeat) {
    const m = pool[Math.floor(r() * pool.length)];
    if (feats.filter((x) => x === m).length < 2) feats.push(m);
  }
  shuffle(feats, r);
  for (let i = 1; i < feats.length; i++) if (feats[i] === feats[i - 1]) { const j = (i + 2) % feats.length; [feats[i], feats[j]] = [feats[j], feats[i]]; }

  const st = { x: 0, z: 0, yaw: 0, s: 0 };
  const placed = [];   // coarse points of everything laid so far
  const pieces = [];
  const featuresAll = { pegs: [], bumps: [], zones: [], jumps: [], gates: [], bridges: [], split: [], bumpers: [], windmills: [], portals: [], tramps: [] };
  const sections = [];

  // lay a module only if it keeps clear of the track already laid
  const tryLay = (list) => {
    const sim = { ...st };
    const pts = [];
    for (const { built } of list) for (const p of built.pieces) traceTurtle(sim, p, pts);
    for (const q of pts) for (const o of placed) {
      if (q.s - o.s < 40) continue;
      if (Math.hypot(q.x - o.x, q.z - o.z) < q.hw + o.hw + CLEAR) return false;
    }
    for (const { mod, label, built } of list) {
      const s0 = st.s;
      for (const p of built.pieces) { p.s0 = st.s; pieces.push(p); traceTurtle(st, p, placed); }
      if (built.feats) for (const [k, l] of Object.entries(built.feats)) for (const f of l) {
        const g = { ...f };
        for (const key of ['s', 's0', 's1', 'gap0', 'gap1', 'sIn', 'sOut']) if (key in g) g[key] += s0;
        featuresAll[k].push(g);
      }
      sections.push({ s0, s1: st.s, mod, label });
    }
    return true;
  };
  const labelOf = (m) => (m === 'sandtrap' ? theme.slow.name : m === 'chute' ? theme.fast.name + ' Chute' : MODULES[m].label);
  const entry = (m, dir) => ({ mod: m, label: labelOf(m), built: MODULES[m].make(r, dir) });

  tryLay([{ mod: 'start', label: 'Start', built: { pieces: [{ len: 14, turn: 0, slope: 4 }] } }]);

  for (let i = 0; i < feats.length; i++) {
    let ok = false;
    for (let k = 0; k < 14 && !ok; k++) {
      const dir = r() < 0.5 ? 1 : -1;
      const list = [];
      // a bend between features most of the time (and always when retrying)
      if (i > 0 && (k > 0 || r() < 0.8)) list.push(entry(BEND_MODULES[Math.floor(r() * BEND_MODULES.length)], dir));
      list.push(entry(feats[i], r() < 0.5 ? 1 : -1));
      ok = tryLay(list);
    }
    if (!ok) return null;
  }
  // home straight and run-out, with a gentle bend in if needed
  let ok = false;
  for (let k = 0; k < 10 && !ok; k++) {
    const list = [];
    if (k > 0) list.push(entry('sweeper', r() < 0.5 ? 1 : -1));
    list.push({ mod: 'finish', label: 'Home Straight', built: { pieces: [{ len: 8, turn: 0, slope: 5 }, { len: 26, turn: 0, slope: -1.5 }] } });
    ok = tryLay(list);
  }
  if (!ok) return null;
  const length = st.s;
  const finishS = length - 26;

  const samples = sampleTrack(pieces, length);
  featuresAll.zones.forEach((z) => { z.u0 ??= -99; z.u1 ??= 99; });
  featuresAll.bumps.forEach((b) => { b.u0 ??= -99; b.u1 ??= 99; });
  featuresAll.zones.push({ s0: finishS + 1, s1: length, type: 'runout', u0: -99, u1: 99 });

  const conflicts = countConflicts(samples);
  const pickups = placePickups(samples, finishS, featuresAll, r);
  return { seed, theme: themeKey, themeData: theme, lengthKey, samples, length, finishS, sections, conflicts, pickups, ...featuresAll };
}

// Rows of power-up pickups (vapes) every ~60 m, kept off jumps, bridges,
// pegs and the home straight. In a split, each lane gets its own.
function placePickups(samples, finishS, feats, r) {
  const out = [];
  const blocked = (s) =>
    feats.jumps.some((j) => s > j.gap0 - 12 && s < j.gap1 + 4) ||
    feats.bridges.some((b) => s > b.s0 - 4 && s < b.s1 + 4) ||
    feats.pegs.some((p) => Math.abs(p.s - s) < 2.5) ||
    feats.gates.some((g) => Math.abs(g.s - s) < 6) ||
    feats.bumps.some((b) => Math.abs(b.s - s) < 2) ||
    feats.bumpers.some((b) => Math.abs(b.s - s) < 2.5) ||
    feats.windmills.some((w) => Math.abs(w.s - s) < 4) ||
    feats.tramps.some((t) => Math.abs(t.s - s) < 6) ||
    feats.portals.some((p) => s > p.sIn - 3 && s < p.sOut + 2);
  for (let s = 32; s < finishS - 20; s += 55 + r() * 15) {
    let ss = s;
    for (let k = 0; k < 12 && blocked(ss); k++) ss += 3;
    if (blocked(ss) || ss > finishS - 20) continue;
    const sm = samples[Math.round(ss / DS)];
    const us = sm.div > 0.3
      ? [-(sm.div + sm.hw) / 2, (sm.div + sm.hw) / 2]
      : [-0.48 * sm.hw, 0, 0.48 * sm.hw];
    for (const u of us) out.push({ s: ss, u });
  }
  return out;
}

function shuffle(a, r) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }

// advance the turtle along a piece, recording a coarse point every ~2 units
function traceTurtle(st, p, out) {
  const n = Math.max(1, Math.ceil(p.len / 2));
  for (let i = 0; i < n; i++) {
    st.yaw += (p.turn * D2R) / n;
    const h = (p.len / n) * Math.cos(p.slope * D2R);
    st.x += Math.sin(st.yaw) * h; st.z += Math.cos(st.yaw) * h;
    st.s += p.len / n;
    const ls = ((i + 1) / n) * p.len;
    out.push({ x: st.x, z: st.z, s: st.s, hw: p.hw ? p.hw(ls) : BASE_HW });
  }
}

function sampleTrack(pieces, length) {
  const N = Math.floor(length / DS) + 1;
  const kappa = new Float32Array(N), slope = new Float32Array(N), hw = new Float32Array(N), div = new Float32Array(N);
  const flat = new Float32Array(N), ramp = new Float32Array(N);
  const bridge = new Uint8Array(N), gap = new Uint8Array(N);
  let pi = 0;
  for (let i = 0; i < N; i++) {
    const s = i * DS;
    while (pi < pieces.length - 1 && s >= pieces[pi].s0 + pieces[pi].len) pi++;
    const p = pieces[pi], ls = s - p.s0;
    kappa[i] = (p.turn * D2R) / p.len;
    slope[i] = p.slope * D2R;
    hw[i] = p.hw ? p.hw(ls) : BASE_HW;
    div[i] = p.div ? p.div(ls) : 0;
    flat[i] = p.flat ? p.flat(ls) : 0;
    if (p.bridge && ls >= p.bridge[0] && ls <= p.bridge[1]) bridge[i] = 1;
    if (p.gap) {
      if (ls >= p.gap[0] && ls < p.gap[1]) gap[i] = 1;
      // a sand kicker in front of the gap
      if (ls >= p.gap[0] - 3 && ls < p.gap[0]) ramp[i] = 0.55 * (ls - (p.gap[0] - 3)) / 3;
    }
  }
  const ks = boxSmooth(kappa, 4), sl = boxSmooth(slope, 10);
  const samples = new Array(N);
  let x = 0, y = 0, z = 0, yaw = 0;
  for (let i = 0; i < N; i++) {
    const a = sl[i], k = ks[i];
    const fx = Math.sin(yaw) * Math.cos(a), fy = -Math.sin(a), fz = Math.cos(yaw) * Math.cos(a);
    // a little banking into corners; the curved walls do the rest
    const bank = Math.max(-0.4, Math.min(0.4, 0.6 * Math.atan((8 * 8 * k) / 9.81)));
    const hlx = Math.cos(yaw), hlz = -Math.sin(yaw); // horizontal left
    const cb = Math.cos(bank), sb = Math.sin(bank);
    const lx = hlx * cb, ly = -sb, lz = hlz * cb;
    // up = forward x left
    let ux = fy * lz - fz * ly, uy = fz * lx - fx * lz, uz = fx * ly - fy * lx;
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    samples[i] = { s: i * DS, x, y, z, fx, fy, fz, lx, ly, lz, ux, uy, uz, slope: a, kappa: k, bank, hw: hw[i], div: div[i], flat: flat[i], ramp: ramp[i], bridge: bridge[i], gap: gap[i] };
    yaw += k * DS;
    x += fx * DS; y += fy * DS; z += fz * DS;
  }
  return samples;
}

function boxSmooth(arr, rad) {
  const out = new Float32Array(arr.length);
  let sum = 0, cnt = 0;
  const n = arr.length;
  for (let i = -rad; i < n; i++) {
    const add = i + rad, rem = i - rad - 1;
    if (add < n) { sum += arr[add]; cnt++; }
    if (rem >= 0) { sum -= arr[rem]; cnt--; }
    if (i >= 0) out[i] = sum / cnt;
  }
  return out;
}

function countConflicts(samples) {
  // the dug channel can't pass over or under itself
  let c = 0;
  for (let i = 0; i < samples.length; i += 4) {
    const a = samples[i];
    for (let j = i + 70; j < samples.length; j += 4) {
      const b = samples[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) < a.hw + b.hw + CLEAR - 1.5) c++;
    }
  }
  return c;
}

// ---------- lookup helpers ----------
export function sampleAt(track, s) {
  const smp = track.samples;
  const f = Math.max(0, Math.min(smp.length - 1.001, s / DS));
  const i = Math.floor(f), t = f - i;
  const a = smp[i], b = smp[i + 1];
  return { a, b, t, i };
}

// world position of track point (s, u, h above the centreline plane)
export function worldPos(track, s, u, h, out) {
  const { a, b, t } = sampleAt(track, s);
  const L = (k) => a[k] + (b[k] - a[k]) * t;
  out.x = L('x') + L('lx') * u + L('ux') * h;
  out.y = L('y') + L('ly') * u + L('uy') * h;
  out.z = L('z') + L('lz') * u + L('uz') * h;
  return out;
}

export function frameAt(track, s) {
  const { a, b, t } = sampleAt(track, s);
  const L = (k) => a[k] + (b[k] - a[k]) * t;
  return {
    x: L('x'), y: L('y'), z: L('z'),
    f: [L('fx'), L('fy'), L('fz')], l: [L('lx'), L('ly'), L('lz')], u: [L('ux'), L('uy'), L('uz')],
    slope: L('slope'), kappa: L('kappa'), hw: L('hw'), div: L('div'), bank: L('bank'), flat: L('flat'), ramp: L('ramp'),
    bridge: a.bridge, gap: a.gap && b.gap,
  };
}

export function sectionAt(track, s) {
  for (const sec of track.sections) if (s >= sec.s0 && s < sec.s1) return sec;
  return track.sections[track.sections.length - 1];
}
