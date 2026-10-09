// Camera director with two styles:
//  - 'all' (default): every marble is always on screen. The field is split into
//    groups by the gaps between them, and each group gets its own split-screen
//    pane (up to 4), so every player can see their marble to steer and decide.
//  - 'broadcast': cuts between chase, pack, trackside and "battle for last
//    place" shots, like a marble league broadcast.
import * as THREE from 'three';
import { worldPos, frameAt } from './track.js';

const v = (o) => new THREE.Vector3(o.x, o.y, o.z);

// split-screen layouts (x, y from the top-left, as fractions of the screen);
// pane 0 always holds the leaders
const LAYOUTS = {
  1: [{ x: 0, y: 0, w: 1, h: 1 }],
  2: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }],
  3: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }],
  4: [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }],
};

export class Director {
  constructor(world) {
    this.world = world;
    this.cam = world.camera;
    this.pos = new THREE.Vector3(0, 30, -30);
    this.look = new THREE.Vector3();
    this.mode = 'orbit';
    this.shot = null;
    this.shotT = 0;
    this.caption = '';
    this.t = 0;
    this.tmp = {};
    this.focusS = new Map();
    this.style = 'all';
    this.paneCams = [];
    this.paneCount = 1; this.wantCount = 1; this.wantT = 0;
    this.panes = null;
  }

  P(s, u, h) { worldPos(this.world.track, s, u, h, this.tmp); return v(this.tmp); }

  setMode(mode) { this.mode = mode; this.shot = null; this.shotT = 0; this.cut = true; this.paneCut = true; this.world.panes = null; this.panes = null; this.paneCount = this.wantCount = 1; }

  update(dt, sim) {
    this.t += dt;
    const tr = this.world.track;
    if (!tr) return;
    let pos, look, k = 1 - Math.exp(-dt * 3.5);

    if (this.mode === 'orbit') {
      const b = this.world.bounds, c = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3());
      const r = Math.max(size.x, size.z) * 0.75 + 30;
      const a = this.t * 0.06;
      pos = new THREE.Vector3(c.x + Math.cos(a) * r, b.max.y + r * 0.35, c.z + Math.sin(a) * r);
      look = c.clone().setY(c.y - size.y * 0.1);
      this.caption = '';
    } else if (this.mode === 'grid') {
      const a = Math.sin(this.t * 0.5) * 2.5;
      pos = this.P(-1.5, a, 3.4);
      look = this.P(6, 0, 0.4);
      this.caption = '';
    } else if (this.mode === 'results') {
      const c = this.P(tr.finishS + 14, 0, 0);
      const a = this.t * 0.25;
      pos = c.clone().add(new THREE.Vector3(Math.cos(a) * 11, 6.5, Math.sin(a) * 11));
      look = c;
      this.caption = '';
    } else if (this.style === 'all' && sim) {
      this.updatePanes(dt, sim);
      return;
    } else {
      ({ pos, look } = this.raceShot(dt, sim));
    }
    this.world.panes = null; this.panes = null;

    // never put the camera inside the hillside
    const ground = this.world.terrain?.heightAt(pos.x, pos.z);
    const clear = this.mode === 'race' && this.shot ? ({ pack: 4.5, trackside: 3, heli: 6 }[this.shot.type] || 1.6) : 1.6;
    if (ground != null && pos.y < ground + clear) pos.y = ground + clear;
    if (this.cut) { this.pos.copy(pos); this.look.copy(look); this.cut = false; }
    else { this.pos.lerp(pos, k); this.look.lerp(look, Math.min(1, k * 1.6)); }
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
    this.world.updateShadowFocus(this.look);
  }

  pickShot(sim) {
    const st = sim.standings();
    const leader = st[0];
    const winnerIn = st.some((m) => m.finished);
    const nearFinish = leader && !leader.finished && sim.track.finishS - leader.s < 32;
    if (nearFinish) return { type: 'finish', dur: 12, caption: 'FINISH LINE' };
    const racing = st.filter((m) => !m.finished);
    const options = winnerIn
      ? ['last', 'pack', 'last', 'chaseAny']
      : ['chase', 'pack', 'trackside', 'last', 'heli', 'chase', 'trackside'];
    let type = options[Math.floor(Math.random() * options.length)];
    if (this.shot && type === this.shot.type) type = options[(options.indexOf(type) + 1) % options.length];
    const shot = { type, dur: 5 + Math.random() * 3 };
    if (type === 'chase') { shot.id = leader.id; shot.caption = 'LEADER CAM'; }
    if (type === 'chaseAny') { const m = racing[Math.floor(Math.random() * racing.length)] || leader; shot.id = m.id; shot.caption = m.name.toUpperCase(); }
    if (type === 'last') { const m = racing.length >= 2 ? racing[racing.length - 1] : st[st.length - 1]; shot.id = m.id; shot.caption = 'FIGHT FOR LAST'; }
    if (type === 'pack') shot.caption = 'THE PACK';
    if (type === 'heli') { shot.id = leader.id; shot.caption = 'HELI CAM'; }
    if (type === 'trackside') {
      shot.s = Math.min(sim.track.finishS - 4, leader.s + 26 + Math.random() * 10);
      const f = frameAt(sim.track, shot.s);
      shot.side = Math.random() < 0.5 ? -1 : 1;
      shot.camPos = this.P(shot.s + 4, shot.side * (f.hw + 3), 4);
      shot.caption = '';
      shot.dur = 7;
    }
    return shot;
  }

  raceShot(dt, sim) {
    this.shotT += dt;
    if (!this.shot || this.shotT > this.shot.dur || (this.shot.type === 'trackside' && this.trackSideDone(sim))) {
      const prevType = this.shot?.type;
      this.shot = this.pickShot(sim); this.shotT = 0;
      if (prevType !== this.shot.type || this.shot.type === 'trackside') this.cut = true;
    }
    const sh = this.shot;
    this.caption = sh.caption || '';
    const byId = (id) => sim.marbles.find((m) => m.id === id);
    const smoothS = (key, s) => { const p = this.focusS.get(key); const n = p == null || this.cut ? s : p + (s - p) * Math.min(1, dt * 5); this.focusS.set(key, n); return n; };

    if (sh.type === 'chase' || sh.type === 'chaseAny' || sh.type === 'last') {
      if (sh.type === 'chase') sh.id = sim.standings()[0].id;
      const m = byId(sh.id);
      const s = smoothS('chase', m.s);
      return { pos: this.P(s - 6.5, m.u * 0.4, 3.1), look: this.P(s + 2.5, m.u * 0.6, 0.5) };
    }
    if (sh.type === 'heli') {
      const m = byId(sh.id); const s = smoothS('heli', m.s);
      return { pos: this.P(s - 4, 0, 0).add(new THREE.Vector3(0, 17, 0)), look: this.P(s + 3, 0, 0) };
    }
    if (sh.type === 'pack') {
      const racing = sim.standings().filter((x) => !x.finished);
      const list = racing.length ? racing : sim.marbles;
      const mid = list[Math.floor(list.length / 2)].s;
      const s = smoothS('pack', mid);
      const f = frameAt(sim.track, s);
      return { pos: this.P(s - 5, (f.hw + 5) * (Math.sin(this.t * 0.2) > 0 ? 1 : -1), 8.5), look: this.P(s + 1, 0, 0) };
    }
    if (sh.type === 'trackside') {
      const st = sim.standings();
      // look at the nearest marbles around this spot
      const near = st.reduce((best, m) => (Math.abs(m.s - sh.s) < Math.abs(best.s - sh.s) ? m : best), st[0]);
      const s = smoothS('ts', Math.min(near.s, sh.s + 12));
      return { pos: sh.camPos, look: this.P(s, near.u, 0.5) };
    }
    if (sh.type === 'finish') {
      const tr = sim.track;
      const camS = tr.finishS + 7;
      const f = frameAt(tr, camS);
      return { pos: this.P(camS, f.hw + 3.5, 2.4), look: this.P(tr.finishS - 4, 0, 0.6) };
    }
    return { pos: this.pos.clone(), look: this.look.clone() };
  }

  // ---------------- all-marbles split screen ----------------
  updatePanes(dt, sim) {
    const st = sim.standings();
    let racing = st.filter((m) => !m.finished);
    if (!racing.length) racing = st.slice(-3); // everyone's home: watch the run-out
    // how many panes: one per big gap in the field (max 4), changed only after
    // the new count has held for a moment so the screen doesn't flicker
    // a new pane whenever a group would stretch over more than SPAN metres,
    // so marbles stay big enough on screen to steer by
    const SPAN = 30;
    let want = 1, head = racing[0]?.s ?? 0;
    for (let i = 1; i < racing.length; i++) if (head - racing[i].s > SPAN) { want++; head = racing[i].s; }
    want = Math.min(4, want, racing.length);
    if (want !== this.wantCount) { this.wantCount = want; this.wantT = 0; }
    this.wantT += dt;
    if (this.wantCount !== this.paneCount && (this.wantT > 1.2 || this.paneCam == null)) { this.paneCount = this.wantCount; this.paneCut = true; }
    const n = Math.min(this.paneCount, racing.length);
    // split the field at its n-1 biggest gaps
    const gaps = [];
    for (let i = 1; i < racing.length; i++) gaps.push({ i, g: racing[i - 1].s - racing[i].s });
    const cuts = gaps.sort((a, b) => b.g - a.g).slice(0, n - 1).map((x) => x.i).sort((a, b) => a - b);
    const groups = [];
    let start = 0;
    for (const c of [...cuts, racing.length]) { groups.push(racing.slice(start, c)); start = c; }

    const W = window.innerWidth, H = window.innerHeight;
    const rects = LAYOUTS[groups.length];
    const humansLeft = racing.filter((m) => !m.bot);
    const lastHuman = humansLeft[humansLeft.length - 1];
    this.panes = groups.map((g, i) => {
      let pc = this.paneCams[i];
      if (!pc) pc = this.paneCams[i] = { cam: new THREE.PerspectiveCamera(55, 1, 0.1, 900), pos: new THREE.Vector3(), look: new THREE.Vector3() };
      const r = rects[i];
      const aspect = (r.w * W) / Math.max(1, r.h * H);
      const { pos, look } = this.frameGroup(g, sim, aspect);
      const ground = this.world.terrain?.heightAt(pos.x, pos.z);
      if (ground != null && pos.y < ground + 3) pos.y = ground + 3;
      if (this.paneCut) { pc.pos.copy(pos); pc.look.copy(look); }
      else { const k = 1 - Math.exp(-dt * 3); pc.pos.lerp(pos, k); pc.look.lerp(look, Math.min(1, k * 1.5)); }
      pc.cam.aspect = aspect; pc.cam.updateProjectionMatrix();
      pc.cam.position.copy(pc.pos); pc.cam.lookAt(pc.look);
      const p0 = st.indexOf(g[0]) + 1, p1 = st.indexOf(g[g.length - 1]) + 1;
      const names = g.length <= 3 ? g.map((m) => m.name).join(' · ') : `${g.length} marbles`;
      const label = (p0 === p1 ? `P${p0}` : `P${p0}–${p1}`) + '  ' + names + (lastHuman && g.includes(lastHuman) && humansLeft.length > 1 ? '  🍺' : '');
      return { camera: pc.cam, rect: r, label, focus: pc.look };
    });
    this.paneCut = false;
    this.paneCam = true;
    this.world.panes = this.panes;
    this.caption = '';
    // keep the main camera roughly on the lead group (used for shadows and sound)
    this.cam.position.copy(this.panes[0].camera.position);
    this.cam.quaternion.copy(this.panes[0].camera.quaternion);
  }

  // a camera behind and above a group of marbles, far enough back to fit them all
  frameGroup(group, sim, aspect) {
    const tr = sim.track;
    const pts = group.map((m) => this.P(m.s, m.u, 0.5));
    const c = new THREE.Vector3();
    for (const p of pts) c.add(p);
    c.divideScalar(pts.length);
    const midS = group.reduce((a, m) => a + m.s, 0) / group.length;
    const f = frameAt(tr, midS);
    const fwd = new THREE.Vector3(f.f[0], 0, f.f[2]).normalize();
    const side = new THREE.Vector3(f.l[0], 0, f.l[2]).normalize();
    // how far the group spreads sideways and along the view direction
    let lat = 0, lon = 0;
    for (const p of pts) { const d = p.clone().sub(c); lat = Math.max(lat, Math.abs(d.dot(side))); lon = Math.max(lon, Math.abs(d.dot(fwd))); }
    const rad = Math.max(lat, lon);
    const vf = (55 * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    // looking down the track, the length of the group is foreshortened, so it
    // needs less room than its width
    const d = Math.max(7, Math.min(90, Math.max((lat + 2.5) / Math.tan(hf / 2), (lon * 0.55 + 2.5) / Math.tan(vf / 2))));
    const look = c.clone().addScaledVector(fwd, Math.min(6, rad * 0.3));
    const pos = c.clone().addScaledVector(fwd, -d * 0.72).addScaledVector(side, d * 0.12).add(new THREE.Vector3(0, d * 0.62, 0));
    return { pos, look };
  }

  trackSideDone(sim) {
    const leader = sim.standings()[0];
    return leader.s > this.shot.s + 14;
  }
}
