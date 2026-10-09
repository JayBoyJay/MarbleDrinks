// Marble race physics, in track coordinates:
//   s = distance along the track, u = sideways offset (+ is left), h = height above the floor.
// Working in track space keeps marbles on the course (no flying off into the void)
// while still giving bumps, bounces, pile-ups, jumps and overtakes.

import { DS, MARBLE_R as R, sectionAt, surfSlope } from './track.js';
import { rollPower } from '../powers.js';

const G = 9.81;
const GE = 7.0;          // effective gravity for a rolling sphere (5/7 g)
const ROLL_MU = 0.012;   // rolling resistance
const DRAG = 0.0054;     // air drag (sets top speed)
const MAX_V = 22;
const STEP = 1 / 120;

export const BOOSTS_PER_RACE = 3;
export const BOOST_COOLDOWN = 3;
export const STEER_ACC = 9;    // sideways push at full tilt (tilt-steer mode)
export const gateAmp = (hw, w) => Math.max(0.3, hw * 0.62 - w / 2);

export class RaceSim {
  constructor(track, entrants, rand = Math.random, opts = {}) {
    this.track = track;
    this.opts = { pickups: true, tilt: false, ...opts };
    this.pickups = (this.opts.pickups ? track.pickups || [] : []).map((p) => ({ ...p, back: 0 }));
    this.tempZones = [];
    this.zoneId = 0;
    this.rank = new Map();
    this.rand = rand;
    this.t = 0;
    this.acc = 0;
    this.started = false;
    this.events = [];
    this.finishOrder = [];
    this.pegs = [...track.pegs].sort((a, b) => a.s - b.s);
    this.zones = track.zones.map((z) => ({ ...z, mu: z.type === 'slow' ? track.themeData.slow.mu : z.type === 'runout' ? 0.9 : 0 }));
    this.muScale = track.themeData.muScale;
    this.gravity = track.themeData.gravity || 1; // the moon is floaty
    this.bumpers = track.bumpers || [];
    this.windmills = track.windmills || [];
    this.portals = track.portals || [];
    this.tramps = track.tramps || [];

    // starting grid behind the gate: rows of 4
    const n = entrants.length;
    const order = [...entrants].sort(() => rand() - 0.5);
    this.marbles = order.map((e, i) => {
      const row = Math.floor(i / 4), col = i % 4;
      const inRow = Math.min(4, n - row * 4);
      const spread = 1.2;
      return {
        id: e.id, name: e.name, skin: e.skin, bot: !!e.bot,
        s: 5.4 - row * 1.05, u: (col - (inRow - 1) / 2) * spread + (rand() - 0.5) * 0.1, h: 0,
        vs: 0, vu: 0, vh: 0,
        // tiny per-marble differences, like real marbles of slightly different weight
        drag: 0.97 + rand() * 0.06, roll: 0.9 + rand() * 0.2,
        ph1: rand() * 100, ph2: rand() * 100, wob: 0.7 + rand() * 0.6,
        finished: false, finishTime: null, place: null,
        boosts: BOOSTS_PER_RACE, boostT: 0, boostCd: 0, stuckT: 0,
        lastSection: null, airT: 0, steer: 0,
        power: null, botUseAt: 0, ghostT: 0, magnetT: 0, shieldT: 0, frozenT: 0, scrambleT: 0,
        botBoostAt: [8 + rand() * 20, 25 + rand() * 25, 45 + rand() * 30],
      };
    });
    this.leaderId = null;
    this.lastId = null;
  }

  start() { this.started = true; this.t = 0; }

  boost(id) {
    const m = this.marbles.find((x) => x.id === id);
    if (!m || !this.started || m.finished || m.boosts <= 0 || m.boostCd > 0) return false;
    m.boosts--; m.boostT = 0.9; m.boostCd = BOOST_COOLDOWN;
    this.events.push({ type: 'boost', id: m.id });
    return true;
  }

  setSteer(id, v) {
    const m = this.marbles.find((x) => x.id === id);
    if (m) m.steer = Math.max(-1, Math.min(1, Number(v) || 0));
  }

  // ---------------- power-ups ----------------
  usePower(id) {
    const m = this.marbles.find((x) => x.id === id);
    if (!m || !m.power || m.finished || !this.started) return false;
    const key = m.power; m.power = null;
    const ev = { type: 'power', id: m.id, power: key, targets: [] };
    const racing = this.marbles.filter((x) => !x.finished && x !== m);
    const ahead = racing.filter((x) => x.s > m.s).sort((a, b) => a.s - b.s);
    const hit = (x) => {
      if (x.shieldT > 0) { x.shieldT = 0; this.events.push({ type: 'blocked', id: x.id, by: m.id }); return false; }
      ev.targets.push(x.id); return true;
    };
    switch (key) {
      case 'turbo': m.boostT = 1.7; break;
      case 'ghost': m.ghostT = 3; break;
      case 'magnet': m.magnetT = 4; break;
      case 'shield': m.shieldT = 12; break;
      case 'sandbomb':
        this.tempZones.push({ id: ++this.zoneId, s0: m.s - 11, s1: m.s - 3, u0: -99, u1: 99, type: 'slow', mu: this.track.themeData.slow.mu * 1.15, until: this.t + 9 });
        break;
      case 'bonk': {
        const x = ahead[0];
        if (x && x.s - m.s < 30) { if (hit(x)) { x.vs *= 0.45; x.vu += (x.u >= 0 ? 1 : -1) * 7; } }
        else ev.miss = true;
        break;
      }
      case 'freeze': {
        const x = racing.reduce((best, y) => (!best || y.s > best.s ? y : best), null);
        if (x) { if (hit(x)) x.frozenT = 2; } else ev.miss = true;
        break;
      }
      case 'swap': {
        const x = ahead[Math.floor(this.rand() * ahead.length)];
        if (x) {
          if (hit(x)) for (const k of ['s', 'u', 'vs', 'vu', 'h', 'vh']) [m[k], x[k]] = [x[k], m[k]];
        } else ev.miss = true;
        break;
      }
      case 'scramble': for (const x of racing) if (!x.bot && hit(x)) x.scrambleT = 5; break;
      case 'earthquake':
        for (const x of racing) if (hit(x)) { x.vu += (this.rand() - 0.5) * 10; x.vh = 2.6; x.h = 0.001; x.vs *= 0.75; }
        break;
    }
    this.events.push(ev);
    return true;
  }

  collectPickups(m) {
    if (m.finished || m.h > 0.9) return;
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (this.t < p.back || Math.abs(p.s - m.s) > 0.8 || Math.abs(p.u - m.u) > 0.75) continue;
      p.back = this.t + 2.5; // the vape reappears shortly after
      const n = this.marbles.length;
      const pos = n > 1 ? (this.rank.get(m.id) ?? 0) / (n - 1) : 0;
      const replaced = m.power;
      m.power = rollPower(pos, this.opts.tilt, this.rand);
      m.pickCount = (m.pickCount || 0) + 1; m.lastReplaced = replaced;
      if (m.bot) m.botUseAt = this.t + 1 + this.rand() * 3;
      this.events.push({ type: 'pickup', id: m.id, power: m.power, replaced, index: i });
      return;
    }
  }

  update(dt, boostsEnabled) {
    if (!this.started) return;
    this.acc += Math.min(dt, 0.6);
    while (this.acc >= STEP) { this.step(STEP, boostsEnabled); this.acc -= STEP; }
  }

  step(dt, boostsEnabled) {
    const tr = this.track, smp = tr.samples;
    this.t += dt;
    const ms = this.marbles;

    for (const m of ms) {
      const prevS = m.s;
      const fi = Math.max(0, Math.min(smp.length - 2, Math.floor(m.s / DS)));
      const a = smp[fi], b = smp[fi + 1], ft = m.s / DS - fi;
      const slope = a.slope + (b.slope - a.slope) * ft;
      const kappa = a.kappa + (b.kappa - a.kappa) * ft;
      const latG = -(a.ly + (b.ly - a.ly) * ft);
      const hw = a.hw + (b.hw - a.hw) * ft;
      const div = a.div + (b.div - a.div) * ft;
      const flat = a.flat + (b.flat - a.flat) * ft;
      const prof = { hw, div, flat };
      const overGap = a.gap && b.gap;

      if (boostsEnabled && m.bot && !m.finished && m.boosts > 0 && this.t > m.botBoostAt[BOOSTS_PER_RACE - m.boosts]) this.boost(m.id);
      if (m.boostCd > 0) m.boostCd -= dt;
      if (m.bot && m.power && this.t > m.botUseAt) this.usePower(m.id);
      for (const k of ['ghostT', 'magnetT', 'shieldT', 'frozenT', 'scrambleT']) if (m[k] > 0) m[k] -= dt;

      const grounded = m.h <= 1e-4 && m.vh <= 0;
      let as = 0, au = 0;
      if (grounded) {
        let mu = ROLL_MU * this.muScale * m.roll, latDamp = 1.1;
        for (const z of this.zones.concat(this.tempZones)) {
          if (m.s < z.s0 || m.s > z.s1 || m.u < z.u0 || m.u > z.u1) continue;
          if (z.type === 'slow') { if (m.shieldT <= 0) { mu += z.mu; latDamp = 3; } }
          else if (z.type === 'fast') { as += 6.5; latDamp = 0.5; }
          else if (z.type === 'runout') { mu += z.mu; latDamp = 4; }
        }
        if (this.muScale < 0.8) latDamp *= 0.5; // icy theme: more sliding about
        as += GE * Math.sin(slope);
        if (Math.abs(m.vs) > 0.05) as -= mu * GE * Math.cos(slope) * Math.sign(m.vs);
        as -= DRAG * m.drag * m.vs * Math.abs(m.vs);
        au += GE * latG - m.vs * m.vs * kappa - m.vu * latDamp;
        // the curved channel walls push marbles back toward the middle
        au -= GE * 0.95 * surfSlope(prof, m.u);
        if (!m.finished) au += (m.scrambleT > 0 ? -m.steer : m.steer) * STEER_ACC;
        // track imperfections: gentle wandering so no two races are alike
        au += m.wob * (Math.sin(m.s * 0.83 + m.ph1) * 1.1 + Math.sin(m.s * 2.1 + m.ph2) * 0.55);
      } else {
        as -= 0.004 * m.vs * Math.abs(m.vs);
        au += m.steer * STEER_ACC * 0.3;
        m.vh -= G * this.gravity * dt;
        m.h += m.vh * dt;
        m.airT += dt;
        if (m.h <= 0) {
          if (overGap) { m.h = 0; m.vh = 2.5; } // safety net: never fall through a gap
          else {
            const impact = -m.vh;
            m.h = 0; m.vh = impact > 2.5 ? impact * 0.22 : 0;
            if (m.airT > 0.35) this.events.push({ type: 'land', id: m.id, air: m.airT });
            m.airT = 0;
          }
        }
      }

      if (m.boostT > 0) { as += 11; m.boostT -= dt; }
      if (m.magnetT > 0 && !m.finished) {
        // pulled along toward the nearest marble ahead
        let tgt = null;
        for (const x of ms) if (x !== m && !x.finished && x.s > m.s + 1.2 && (!tgt || x.s < tgt.s)) tgt = x;
        if (tgt) { as += 7; au += Math.max(-4, Math.min(4, (tgt.u - m.u) * 2)); }
      }

      // keep marbles rolling: rarely stopped, never stuck
      if (!m.finished) {
        if (m.vs < 1.2) as += 2.2;
        if (m.vs < 0.4) m.stuckT += dt; else m.stuckT = Math.max(0, m.stuckT - dt);
        // properly stuck: a little hop frees it (pegs and gates are low)
        if (m.stuckT > 1.0) { m.vs += 2; m.vu += (this.rand() - 0.5) * 2; m.vh = 4.2; m.h = 0.001; m.stuckT = 0; }
        // no real progress for a few seconds (pinned by a gate, a bumper…): hop on
        if (m.progT == null || m.s > m.progS + 1.5) { m.progS = m.s; m.progT = this.t; }
        else if (this.t - m.progT > 4) { m.vs = Math.max(m.vs, 0) + 3; m.vh = 4.5; m.h = 0.001; m.progS = m.s; m.progT = this.t; }
      }

      m.vs = Math.max(-6, Math.min(MAX_V, m.vs + as * dt));
      m.vu += au * dt;
      if (m.frozenT > 0) m.vs = Math.min(m.vs, 1);
      m.s += m.vs * dt;
      m.u += m.vu * dt;

      // walls
      const lim = flat > 0.5 ? hw - R : hw - 0.15;
      if (m.u > lim) { m.u = lim; if (m.vu > 0) { m.vu = -m.vu * 0.45; m.vs *= 0.996; } }
      else if (m.u < -lim) { m.u = -lim; if (m.vu < 0) { m.vu = -m.vu * 0.45; m.vs *= 0.996; } }
      // split divider
      if (div > 0.03 && m.h < 1.2) {
        const dl = div + R * 0.5;
        if (Math.abs(m.u) < dl) {
          const side = m.u === 0 ? (this.rand() < 0.5 ? -1 : 1) : Math.sign(m.u);
          m.u = side * dl;
          if (m.vu * side < 0) m.vu = -m.vu * 0.5;
        }
      }

      // pegs
      if (m.h < 0.6 && m.ghostT <= 0) {
        let lo = 0, hi = this.pegs.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (this.pegs[mid].s < m.s - 1) lo = mid + 1; else hi = mid; }
        for (let k = lo; k < this.pegs.length && this.pegs[k].s < m.s + 1; k++) {
          const p = this.pegs[k];
          collideCircle(m, p.s, p.u, p.r + R, 0, 0.3);
        }
      }
      // sweeper gates
      if (m.h < 0.7 && m.ghostT <= 0) for (const g of tr.gates) {
        if (Math.abs(m.s - g.s) > 2) continue;
        const amp = gateAmp(frameHw(tr, g.s), g.w);
        const gu = Math.sin(this.t * g.speed + g.phase) * amp;
        const gv = Math.cos(this.t * g.speed + g.phase) * amp * g.speed;
        collideBox(m, g.s, gu, g.d / 2, g.w / 2, gv);
      }
      // pinball bumpers: springy, they kick you away
      if (m.h < 0.8 && m.ghostT <= 0) for (const b of this.bumpers) {
        if (Math.abs(m.s - b.s) > 1.2) continue;
        const ds = m.s - b.s, du = m.u - b.u, d = Math.hypot(ds, du), rad = b.r + R;
        if (d >= rad || d < 1e-6) continue;
        const nx = ds / d, ny = du / d;
        m.s = b.s + nx * rad; m.u = b.u + ny * rad;
        const vn = m.vs * nx + m.vu * ny;
        if (vn < 0) { m.vs -= 2.2 * vn * nx; m.vu -= 2.2 * vn * ny; }
        m.vs += nx * 2.5; m.vu += ny * 4.5; // the kick
        b.hitT = this.t;
        this.events.push({ type: 'bumper', id: m.id });
      }
      // windmills: a spinning bar across the channel
      if (m.h < 0.7 && m.ghostT <= 0) for (const w of this.windmills) {
        if (Math.abs(m.s - w.s) > w.len + 1) continue;
        const th = this.t * w.omega + w.phase, cs = Math.cos(th), sn = Math.sin(th);
        // closest point on the bar to the marble
        const rs = m.s - w.s, ru = m.u;
        const k = Math.max(-w.len, Math.min(w.len, rs * cs + ru * sn));
        const ps = k * cs, pu = k * sn;
        const ds = rs - ps, du = ru - pu, d = Math.hypot(ds, du), rad = R + 0.14;
        if (d >= rad) continue;
        const nx = d > 1e-6 ? ds / d : 1, ny = d > 1e-6 ? du / d : 0;
        m.s = w.s + ps + nx * rad; m.u = pu + ny * rad;
        const bvs = -w.omega * pu, bvu = w.omega * ps; // the bar's own speed at that point
        const vn = (m.vs - bvs) * nx + (m.vu - bvu) * ny;
        if (vn < 0) { m.vs -= 1.6 * vn * nx; m.vu -= 1.6 * vn * ny; }
      }
      // portals: roll into the ring, pop out further down the track
      for (const p of this.portals) {
        if (prevS < p.sIn && m.s >= p.sIn && m.u >= p.u0 && m.u <= p.u1 && m.h < 1.2 && !m.finished) {
          m.s = p.sOut + (m.s - p.sIn); m.vs = Math.max(m.vs, 6);
          this.events.push({ type: 'portal', id: m.id, from: p.sIn, to: p.sOut, u: m.u });
        }
      }
      // bounce pads
      for (const tp of this.tramps) {
        if (prevS < tp.s && m.s >= tp.s && m.h < 0.2) {
          m.vh = 6.2; m.h = 0.001; m.vs = Math.max(m.vs * 1.05, 7);
          tp.hitT = this.t;
          this.events.push({ type: 'tramp', id: m.id });
        }
      }

      // speed humps
      for (const bump of tr.bumps) {
        if (prevS < bump.s && m.s >= bump.s && m.h < 0.05 && m.u >= bump.u0 && m.u <= bump.u1) {
          m.vs *= 0.93; m.vh = Math.min(2.4, 0.17 * Math.max(0, m.vs)); m.h = 0.001;
        }
      }
      // jump ramps
      for (const j of tr.jumps) {
        if (prevS < j.gap0 && m.s >= j.gap0 && m.h < 0.3) {
          m.vs = Math.max(m.vs, 10.5);
          m.vh = m.vs * Math.sin(16 * Math.PI / 180); m.h = 0.001;
          this.events.push({ type: 'jump', id: m.id });
        }
      }

      this.collectPickups(m);

      // finish
      if (!m.finished && m.s >= tr.finishS) {
        m.finished = true; m.finishTime = this.t;
        this.finishOrder.push(m.id); m.place = this.finishOrder.length;
        this.events.push({ type: 'finish', id: m.id, place: m.place });
      }
      if (m.s > tr.length - R - 0.2) { m.s = tr.length - R - 0.2; if (m.vs > 0) m.vs = -m.vs * 0.25; }
      if (m.s < R) { m.s = R; if (m.vs < 0) m.vs = 0; }

      // commentary on the leader entering a new section
      const sec = sectionAt(tr, m.s);
      if (sec !== m.lastSection) { m.lastSection = sec; if (m.id === this.leaderId && sec.mod !== 'bend') this.events.push({ type: 'section', id: m.id, label: sec.label }); }
    }

    // marble vs marble
    for (let i = 0; i < ms.length; i++) {
      const A = ms[i];
      for (let j = i + 1; j < ms.length; j++) {
        const B = ms[j];
        if (A.ghostT > 0 || B.ghostT > 0) continue;
        const ds = B.s - A.s; if (ds > 2 * R || ds < -2 * R) continue;
        const du = B.u - A.u, dh = B.h - A.h;
        const d2 = ds * ds + du * du + dh * dh;
        if (d2 >= 4 * R * R || d2 < 1e-8) continue;
        const d = Math.sqrt(d2), nx = ds / d, ny = du / d, nz = dh / d;
        const push = (2 * R - d) / 2;
        A.s -= nx * push; A.u -= ny * push; B.s += nx * push; B.u += ny * push;
        if (A.h > 0 || B.h > 0) { A.h = Math.max(0, A.h - nz * push); B.h = Math.max(0, B.h + nz * push); }
        const rv = (B.vs - A.vs) * nx + (B.vu - A.vu) * ny + (B.vh - A.vh) * nz;
        if (rv < 0) {
          const jimp = -(1 + 0.7) * rv / 2;
          A.vs -= jimp * nx; A.vu -= jimp * ny; B.vs += jimp * nx; B.vu += jimp * ny;
          if (A.h > 0.01) A.vh -= jimp * nz; if (B.h > 0.01) B.vh += jimp * nz;
          if (-rv > 4) this.events.push({ type: 'clash', a: A.id, b: B.id });
        }
      }
    }

    // standings changes
    const st = this.standings();
    st.forEach((m, i) => this.rank.set(m.id, i));
    if (this.tempZones.length) this.tempZones = this.tempZones.filter((z) => z.until > this.t);
    const racing = st.filter((m) => !m.finished);
    if (st.length && st[0].id !== this.leaderId) {
      if (this.leaderId && !st[0].finished) this.events.push({ type: 'lead', id: st[0].id, prev: this.leaderId });
      this.leaderId = st[0].id;
    }
    const last = st[st.length - 1];
    if (last && last.id !== this.lastId && st.length > 2) {
      if (this.lastId && racing.length > 1) this.events.push({ type: 'last', id: last.id, prev: this.lastId });
      this.lastId = last.id;
    }
  }

  standings() {
    return [...this.marbles].sort((a, b) => {
      if (a.finished && b.finished) return a.place - b.place;
      if (a.finished) return -1; if (b.finished) return 1;
      return b.s - a.s;
    });
  }

  allFinished() { return this.marbles.every((m) => m.finished); }
}

function frameHw(tr, s) { const i = Math.max(0, Math.min(tr.samples.length - 1, Math.round(s / DS))); return tr.samples[i].hw; }

function collideCircle(m, cs, cu, rad, vs0, e) {
  const ds = m.s - cs, du = m.u - cu;
  const d2 = ds * ds + du * du;
  if (d2 >= rad * rad || d2 < 1e-9) return;
  const d = Math.sqrt(d2), nx = ds / d, ny = du / d;
  m.s = cs + nx * rad; m.u = cu + ny * rad;
  const vn = (m.vs - vs0) * nx + m.vu * ny;
  if (vn < 0) {
    m.vs -= (1 + e) * vn * nx; m.vu -= (1 + e) * vn * ny;
    // pegs deflect more than they stop: turn part of the impact into a sideways kick
    const side = Math.abs(ny) > 0.05 ? Math.sign(ny) : (Math.random() < 0.5 ? -1 : 1);
    m.vu += side * -vn * 0.55;
    if (m.vs < 1) m.vs = 1;
  }
}

function collideBox(m, bs, bu, hs, hu, bv) {
  const cs = Math.max(bs - hs, Math.min(bs + hs, m.s));
  const cu = Math.max(bu - hu, Math.min(bu + hu, m.u));
  let ds = m.s - cs, du = m.u - cu;
  let d2 = ds * ds + du * du;
  if (d2 >= R * R) return;
  if (d2 < 1e-9) { ds = m.s < bs ? -1 : 1; du = 0; d2 = 1; }
  const d = Math.sqrt(d2), nx = ds / d, ny = du / d;
  m.s = cs + nx * R; m.u = cu + ny * R;
  const vn = m.vs * nx + (m.vu - bv) * ny;
  if (vn < 0) { m.vs -= 1.5 * vn * nx; m.vu -= 1.5 * vn * ny; }
}
