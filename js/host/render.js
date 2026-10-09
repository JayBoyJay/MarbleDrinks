// three.js scene: track geometry, terrain, decorations, marbles and effects.
import * as THREE from 'three';
import { RoomEnvironment } from '../../vendor/RoomEnvironment.js';
import { DS, MARBLE_R, worldPos, frameAt, surfH, surfSlope, renderH, LIP_W, LIP_H } from './track.js';
import { gateAmp } from './sim.js';
import { skinCanvas, skinMaterial, SKIN_BY_ID } from '../skins.js';
import { buildFeatures, animateFeatures, buildSky, buildThemeDecor, buildFans } from './extras.js';
import { makeHat, animateHat } from './hats3d.js';

export class World {
  constructor(canvas) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const q = new URLSearchParams(location.search).get('quality');
    this.pixelRatio = q === 'low' ? 0.6 : Math.min(window.devicePixelRatio, 1.75);
    r.setPixelRatio(this.pixelRatio);
    r.shadowMap.enabled = q !== 'low';
    this.adaptive = { t: 0, frames: 0, locked: q === 'high' };
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 900);
    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 220;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.sunDir = new THREE.Vector3(-0.5, 1, 0.35).normalize();

    this.trackGroup = null;
    this.marbles = new Map();
    this.tmp = { x: 0, y: 0, z: 0 };
    this.sparks = makeSparks();
    this.smoke = makeSmoke();
    this.scene.add(this.smoke.group);
    this.shakeT = 0;
    this.pickupObjs = [];
    this.tempZoneMeshes = new Map();
    this.scene.add(this.sparks.points);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ---------------- track ----------------
  buildTrack(track) {
    if (this.trackGroup) { disposeGroup(this.trackGroup); this.scene.remove(this.trackGroup); }
    this.clearMarbles();
    const T = track.themeData;
    this.track = track;
    const g = this.trackGroup = new THREE.Group();
    this.scene.add(g);

    // sky and fog
    this.scene.background = skyTexture(T.sky, T.horizon);
    this.scene.fog = new THREE.Fog(T.horizon, T.fog[0], T.fog[1]);
    this.hemi.color.set(T.sky); this.hemi.groundColor.set(T.ground[2]);
    this.sun.color.set(T.sun);
    this.sun.intensity = track.theme === 'lava' ? 1.4 : 2.3;
    this.hemi.intensity = track.theme === 'lava' ? 0.7 : 1.1;

    const smp = track.samples;
    const P = (s, u, h) => { worldPos(track, s, u, h, this.tmp); return new THREE.Vector3(this.tmp.x, this.tmp.y, this.tmp.z); };
    const HS = (s, u) => surfH(frameAt(track, s), u);

    // --- the dug channel: one curved cross-section per sample, broken at gaps and bridges ---
    const icy = track.theme === 'snow';
    const chanMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: icy ? 0.35 : 0.97, metalness: 0, map: grainTexture(), side: THREE.DoubleSide });
    const floorCol = new THREE.Color(T.floor);
    const wallCol = floorCol.clone().multiplyScalar(icy ? 0.92 : 0.8);
    const lipCol = new THREE.Color(T.ground[0]).lerp(floorCol, 0.35);
    const ridgeCol = floorCol.clone().multiplyScalar(0.72);
    const jitter = mulberry32(track.seed ^ 0x5eed);
    const runs = []; let cur = null;
    for (let i = 0; i < smp.length; i++) {
      if (smp[i].gap || smp[i].bridge) { cur = null; continue; }
      if (!cur) { cur = []; runs.push(cur); }
      cur.push(i);
    }
    for (const run of runs) {
      if (run.length < 2) continue;
      // extend each run by one sample so it meets the bridge deck without a crack
      const first = run[0], last = run[run.length - 1];
      if (first > 0 && smp[first - 1].bridge) run.unshift(first - 1);
      if (last < smp.length - 1 && smp[last + 1].bridge) run.push(last + 1);
      const b = new GeoBuilder();
      for (const i of run) {
        const sm = smp[i];
        const pts = [], cols = [], uvs = [];
        for (const u of acrossChannel(sm.hw)) {
          const a = Math.abs(u);
          const skirt = a > sm.hw + LIP_W + 0.01;
          const h = skirt ? -1.8 : renderH(sm, u);
          pts.push(P(sm.s, u, h));
          let c;
          if (a <= sm.hw) {
            const t = Math.max(0, (a / sm.hw - 0.45) / 0.55);
            c = floorCol.clone().lerp(wallCol, t * t);
            if (sm.div > 0.05 && a < sm.div + 0.7) c.lerp(ridgeCol, Math.min(1, sm.div) * (1 - a / (sm.div + 0.7)));
          } else c = wallCol.clone().lerp(lipCol, Math.min(1, (a - sm.hw) / LIP_W));
          const j = 0.94 + jitter() * 0.1; c.multiplyScalar(j);
          cols.push(c); uvs.push([u / 2.5, sm.s / 2.5]);
        }
        b.ring(pts, cols, uvs);
      }
      const m = new THREE.Mesh(b.build(), chanMat); m.receiveShadow = true; m.castShadow = true; g.add(m);
    }

    // --- bridge decks (the only part that isn't dug into the ground) ---
    {
      const plankA = new THREE.Color(0x9b6b3f), plankB = new THREE.Color(0x7c5230);
      const deckMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
      const sideMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.8, side: THREE.DoubleSide });
      let run = null; const bRuns = [];
      for (let i = 0; i < smp.length; i++) { if (smp[i].bridge) { if (!run) { run = []; bRuns.push(run); } run.push(i); } else run = null; }
      for (const r of bRuns) {
        const top = new GeoBuilder(), sides = new GeoBuilder();
        for (const i of r) {
          const sm = smp[i], hw = sm.hw, ss = sm.s;
          const c = (Math.floor(ss / DS) % 2) ? plankA : plankB;
          top.ring([P(ss, hw + 0.15, 0), P(ss, -hw - 0.15, 0)], [c, c], [[0, ss / 3], [1, ss / 3]]);
          sides.ring([P(ss, hw, 0), P(ss, hw, 0.35), P(ss, hw + 0.15, 0.35), P(ss, hw + 0.15, -0.3), P(ss, -hw - 0.15, -0.3), P(ss, -hw - 0.15, 0.35), P(ss, -hw, 0.35), P(ss, -hw, 0)]);
        }
        const tm = new THREE.Mesh(top.build(), deckMat); tm.receiveShadow = true; g.add(tm);
        const sdm = new THREE.Mesh(sides.build(), sideMat); sdm.castShadow = true; sdm.receiveShadow = true; g.add(sdm);
      }
    }

    // --- surface zones, painted onto the curved floor ---
    for (const z of track.zones) {
      if (z.type === 'runout') continue;
      const isSlow = z.type === 'slow';
      const mat = isSlow
        ? new THREE.MeshStandardMaterial({ color: T.slow.color, roughness: 1, map: speckleTexture(T.slow.color), side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ color: 0xffffff, map: chevronTexture(T.fast.color), emissive: T.fast.color, emissiveIntensity: 0.35, emissiveMap: chevronTexture(T.fast.color), roughness: 0.4, transparent: true, side: THREE.DoubleSide });
      const b = new GeoBuilder();
      for (let s = z.s0; s <= z.s1 + 1e-6; s += DS) {
        const f = frameAt(track, s);
        const u0 = Math.max(z.u0, -f.hw * 0.9), u1 = Math.min(z.u1, f.hw * 0.9);
        const pts = [], uvs = [];
        for (let k = 0; k <= 8; k++) { const u = u1 + (u0 - u1) * k / 8; pts.push(P(s, u, surfH(f, u) + 0.03)); uvs.push([k / 8, (s - z.s0) / 2]); }
        b.ring(pts, null, uvs);
      }
      const m = new THREE.Mesh(b.build(), mat); m.receiveShadow = true; g.add(m);
    }

    // --- pegs: stakes driven into the sand ---
    if (track.pegs.length) {
      const geo = new THREE.CylinderGeometry(0.17, 0.21, 1.1, 10);
      const pegMat = new THREE.MeshStandardMaterial({ color: track.theme === 'snow' ? 0xe23b4e : track.theme === 'lava' ? 0x2b2626 : 0x8a5a2e, roughness: 0.7 });
      const im = new THREE.InstancedMesh(geo, pegMat, track.pegs.length);
      track.pegs.forEach((p, i) => im.setMatrixAt(i, frameMatrix(track, p.s, p.u, HS(p.s, p.u) + 0.35)));
      im.castShadow = true; im.receiveShadow = true; g.add(im);
    }

    // --- speed humps: sand bumps across the lane ---
    if (track.bumps.length) {
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(T.floor).multiplyScalar(0.85), roughness: 1, side: THREE.DoubleSide, map: grainTexture() });
      for (const bp of track.bumps) {
        const f = frameAt(track, bp.s);
        const u0 = Math.max(bp.u0, -f.hw * 0.95), u1 = Math.min(bp.u1, f.hw * 0.95);
        const b = new GeoBuilder();
        for (let k = 0; k <= 10; k++) {
          const a = k / 10 * Math.PI, s = bp.s - Math.cos(a) * 0.45;
          const ring = [];
          for (let q = 0; q <= 10; q++) { const u = u1 + (u0 - u1) * q / 10; ring.push(P(s, u, HS(s, u) + Math.sin(a) * 0.2)); }
          b.ring(ring);
        }
        const m = new THREE.Mesh(b.build(), mat); m.castShadow = true; m.receiveShadow = true; g.add(m);
      }
    }

    // --- sweeper logs (animated) ---
    this.gates = track.gates.map((gt) => {
      const geo = new THREE.BoxGeometry(gt.w, 0.75, gt.d);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.5 }));
      m.castShadow = true; g.add(m);
      return { def: gt, mesh: m };
    });

    // --- start gate, lines, arches ---
    {
      const f = frameAt(track, 6.2);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(f.hw * 2 + 0.6, 0.45, 0.25), new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.5 }));
      bar.applyMatrix4(frameMatrix(track, 6.2, 0, 0.55));
      bar.castShadow = true; g.add(bar);
      this.startBar = { mesh: bar, base: bar.position.clone(), up: new THREE.Vector3(...f.u) };
      g.add(curvedStrip(track, 6.45, checkerTexture(8, 1)));
      g.add(curvedStrip(track, track.finishS, checkerTexture(8, 1)));
      g.add(finishArch(track, T));
      g.add(startTower(track, T));
    }

    // --- power-up pickups: disposable vapes hovering over the channel ---
    this.pickupObjs = (track.pickups || []).map((p, i) => {
      const f = frameAt(track, p.s);
      const base = P(p.s, p.u, surfH(f, p.u) + 0.75);
      const obj = makeVape(VAPE_COLORS[i % VAPE_COLORS.length]);
      obj.position.copy(base);
      obj.userData = { base, phase: i * 1.7, wisp: Math.random() * 2 };
      g.add(obj);
      return obj;
    });

    // --- terrain, bridge dressing, decor ---
    const terrain = buildTerrain(track, T);
    g.add(terrain.mesh);
    if (terrain.water) g.add(terrain.water);
    g.add(buildBridgeDressing(track, T, terrain.heightAt));
    g.add(buildDecor(track, T, terrain));
    this.terrain = terrain;

    // bounds for overview cameras
    const box = new THREE.Box3();
    for (let i = 0; i < smp.length; i += 8) box.expandByPoint(new THREE.Vector3(smp[i].x, smp[i].y, smp[i].z));
    this.bounds = box;

    // wacky features, skies, world scenery and the crowd
    this.features = buildFeatures(track, g);
    g.add(buildSky(track, box.getCenter(new THREE.Vector3())));
    g.add(buildThemeDecor(track, terrain));
    this.fans = buildFans(track, terrain);
    g.add(this.fans.group);
    this.fans.update(0, null);
  }

  // ---------------- marbles ----------------
  // the crowd: pass the distances of marbles still racing so fans near them cheer
  syncFans(t, racerS) { this.fans?.update(t, racerS); }

  // smoke puff at a world position
  puff(pos, color = '#ffffff', n = 16, size = 1) { this.smoke.puff(pos, color, n, size); }

  // smoke puff at a point on the track
  puffAt(s, u, h, color, n, size) {
    if (!this.track) return;
    worldPos(this.track, s, u, surfH(frameAt(this.track, s), u) + h, this.tmp);
    this.smoke.puff(new THREE.Vector3(this.tmp.x, this.tmp.y, this.tmp.z), color, n, size);
  }

  marblePos(id) { return this.marbles.get(id)?.mesh.position.clone(); }

  shake(sec) { this.shakeT = Math.max(this.shakeT, sec); }

  // show/hide vapes, bob and spin them, and let them blow the odd wisp
  syncPickups(simPickups, simTime, time, dt, enabled = true) {
    for (let i = 0; i < this.pickupObjs.length; i++) {
      const o = this.pickupObjs[i];
      const avail = enabled && (!simPickups || !simPickups.length || simTime >= simPickups[i].back);
      o.visible = avail;
      if (!avail) continue;
      const u = o.userData;
      o.position.copy(u.base); o.position.y += Math.sin(time * 2.2 + u.phase) * 0.12;
      o.rotation.y = time * 1.4 + u.phase;
      u.wisp -= dt;
      if (u.wisp <= 0) {
        u.wisp = 1.6 + Math.random() * 2;
        if (o.position.distanceTo(this.camera.position) < 45) this.smoke.puff(o.position.clone().add(new THREE.Vector3(0, 0.62, 0)), '#ffffff', 2, 0.35);
      }
    }
  }

  // temporary slow patches dropped by Sand Bombs
  syncTempZones(zones) {
    const live = new Set();
    for (const z of zones || []) {
      live.add(z.id);
      if (this.tempZoneMeshes.has(z.id)) continue;
      const T = this.track.themeData;
      const b = new GeoBuilder();
      for (let s = Math.max(0.5, z.s0); s <= z.s1 + 1e-6; s += DS) {
        const f = frameAt(this.track, s);
        const pts = [], uvs = [];
        for (let k = 0; k <= 8; k++) { const u = f.hw * 0.92 - (f.hw * 1.84 * k) / 8; const p = {}; worldPos(this.track, s, u, surfH(f, u) + 0.05, p); pts.push(new THREE.Vector3(p.x, p.y, p.z)); uvs.push([k / 8, (s - z.s0) / 2]); }
        b.ring(pts, null, uvs);
      }
      const m = new THREE.Mesh(b.build(), new THREE.MeshStandardMaterial({ color: T.slow.color, roughness: 1, map: speckleTexture(T.slow.color), side: THREE.DoubleSide }));
      m.receiveShadow = true;
      this.scene.add(m);
      this.tempZoneMeshes.set(z.id, m);
      const mid = (z.s0 + z.s1) / 2;
      for (const ss of [z.s0 + 1, mid, z.s1 - 1]) this.puffAt(ss, 0, 0.3, '#d9c08a', 8, 1.3);
    }
    for (const [id, m] of this.tempZoneMeshes) if (!live.has(id)) {
      this.scene.remove(m); m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); this.tempZoneMeshes.delete(id);
    }
  }

  clearMarbles() {
    for (const m of this.marbles.values()) if (m.bubble) { this.scene.remove(m.bubble); m.bubble.geometry.dispose(); m.bubble.material.dispose(); }
    for (const m of this.marbles.values()) if (m.hat) { this.scene.remove(m.hat); m.hat.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
    this.syncTempZones([]);
    for (const m of this.marbles.values()) { this.scene.remove(m.mesh); this.scene.remove(m.label); m.mesh.geometry.dispose(); m.mesh.material.map?.dispose(); m.mesh.material.dispose(); m.label.material.map.dispose(); m.label.material.dispose(); }
    this.marbles.clear();
  }

  setMarbles(list) {
    this.clearMarbles();
    const geo = new THREE.SphereGeometry(MARBLE_R, 40, 28);
    for (const e of list) {
      const tex = new THREE.CanvasTexture(skinCanvas(e.skin, 512));
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const mat = new THREE.MeshPhysicalMaterial({ map: tex, ...skinMaterial(SKIN_BY_ID[e.skin] || {}), emissive: 0x000000 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      const label = nameSprite(e.name, e.bot);
      this.scene.add(mesh, label);
      const hat = e.hat && e.hat !== 'none' ? makeHat(e.hat) : null;
      if (hat) this.scene.add(hat);
      this.marbles.set(e.id, { mesh, label, hat, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, 0)), last: null });
    }
  }

  // place marbles from sim state
  syncMarbles(simMarbles, dt, labelsVisible) {
    const tr = this.track;
    for (const sm of simMarbles) {
      const vis = this.marbles.get(sm.id); if (!vis) continue;
      // sit the marble on the curved channel surface (offset along its normal)
      const fr = frameAt(tr, sm.s);
      const k = surfSlope(fr, sm.u), inv = 1 / Math.sqrt(1 + k * k);
      worldPos(tr, sm.s, sm.u - MARBLE_R * k * inv, surfH(fr, sm.u) + MARBLE_R * inv + sm.h, this.tmp);
      const pos = new THREE.Vector3(this.tmp.x, this.tmp.y, this.tmp.z);
      if (vis.last) {
        const d = pos.clone().sub(vis.last);
        const dist = d.length();
        if (dist > 1e-5 && dist < 3) {
          const f = frameAt(tr, sm.s);
          const up = new THREE.Vector3(...f.u);
          const axis = new THREE.Vector3().crossVectors(up, d).normalize();
          vis.q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, dist / MARBLE_R));
        }
      }
      vis.last = pos;
      vis.mesh.position.copy(pos);
      vis.mesh.quaternion.copy(vis.q);
      vis.label.position.set(pos.x, pos.y + (vis.hat ? 1.45 : 1.05), pos.z);
      if (vis.hat) {
        // hats float just above the marble and face the way it's going; they never roll
        vis.hat.position.set(pos.x, pos.y + MARBLE_R + 0.07 + Math.sin(performance.now() / 260 + pos.x) * 0.03, pos.z);
        const fr2 = frameAt(tr, sm.s);
        vis.hat.rotation.set(0, Math.atan2(fr2.f[0], fr2.f[2]), 0);
        vis.hat.visible = sm.ghostT > 0 ? Math.floor(performance.now() / 120) % 2 === 0 : true;
      }
      // keep name tags a readable, steady size on screen whether near or far
      const ls = Math.max(0.42, Math.min(1.7, pos.distanceTo(this.camera.position) * 0.075));
      vis.label.scale.set(1.5 * ls, 0.375 * ls, 1);
      vis.label.visible = labelsVisible;
      const boosting = sm.boostT > 0;
      vis.mesh.material.emissive.setHex(boosting ? 0xff8a00 : 0x000000);
      vis.mesh.material.emissiveIntensity = boosting ? 0.6 : 0;
      if (boosting) for (let k = 0; k < 3; k++) this.sparks.emit(pos, sm);
      // power-up effects
      const mat = vis.mesh.material;
      const ghost = sm.ghostT > 0;
      mat.transparent = ghost; mat.opacity = ghost ? 0.35 : 1; mat.depthWrite = !ghost;
      if (sm.frozenT > 0) { mat.emissive.setHex(0x7fd8ff); mat.emissiveIntensity = 0.9; }
      else if (sm.magnetT > 0) { mat.emissive.setHex(0xff3355); mat.emissiveIntensity = 0.35 + 0.25 * Math.sin(performance.now() / 90); }
      else if (sm.scrambleT > 0) { mat.emissive.setHex(0x5cff9d); mat.emissiveIntensity = 0.4; }
      if (sm.shieldT > 0) {
        if (!vis.bubble) {
          vis.bubble = new THREE.Mesh(new THREE.SphereGeometry(MARBLE_R * 1.55, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0x3de1ff, transparent: true, opacity: 0.25, roughness: 0.1, emissive: 0x3de1ff, emissiveIntensity: 0.35, depthWrite: false }));
          this.scene.add(vis.bubble);
        }
        vis.bubble.visible = true; vis.bubble.position.copy(pos);
      } else if (vis.bubble) vis.bubble.visible = false;
      if (sm.frozenT > 0 && Math.random() < 0.2) this.smoke.puff(pos, '#dff6ff', 1, 0.4);
    }
    this.sparks.update(dt);
    this.smoke.update(dt);
  }

  animate(time, raceStarted, startT, simT = time) {
    if (!this.track) return;
    animateFeatures(this.features, simT);
    for (const vis of this.marbles.values()) if (vis.hat) animateHat(vis.hat, time);
    for (const gt of this.gates) {
      const d = gt.def;
      const f = frameAt(this.track, d.s);
      const amp = gateAmp(f.hw, d.w);
      const u = Math.sin(simT * d.speed + d.phase) * amp;
      const M = frameMatrix(this.track, d.s, u, surfH(f, u) + 0.36);
      gt.mesh.position.setFromMatrixPosition(M);
      gt.mesh.quaternion.setFromRotationMatrix(M);
    }
    if (this.startBar) {
      const lift = raceStarted ? Math.min(1, startT * 2) * 1.6 : 0;
      this.startBar.mesh.position.copy(this.startBar.base).addScaledVector(this.startBar.up, lift);
    }
    if (this.terrain?.water && this.track.theme === 'lava') this.terrain.water.material.emissiveIntensity = 0.9 + Math.sin(time * 1.5) * 0.15;
  }

  // split screen: one viewport per pane, each with its own camera
  renderPanes() {
    const r = this.renderer, W = window.innerWidth, H = window.innerHeight;
    r.setScissorTest(true);
    for (const p of this.panes) {
      const x = p.rect.x * W, y = (1 - p.rect.y - p.rect.h) * H, w = p.rect.w * W, h = p.rect.h * H;
      r.setViewport(x, y, w, h); r.setScissor(x, y, w, h);
      if (this.shakeT > 0) p.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 0));
      this.updateShadowFocus(p.focus);
      // name tags sized for this pane's camera
      for (const vis of this.marbles.values()) {
        const ls = Math.max(0.42, Math.min(2.4, vis.mesh.position.distanceTo(p.camera.position) * 0.075));
        vis.label.scale.set(1.5 * ls, 0.375 * ls, 1);
      }
      r.render(this.scene, p.camera);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
  }

  updateShadowFocus(target) {
    this.sun.position.copy(target).addScaledVector(this.sunDir, 90);
    this.sun.target.position.copy(target);
  }

  render(dt = 0) {
    let saved = null;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      saved = this.camera.position.clone();
      const a = Math.min(1, this.shakeT) * 0.35;
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a));
    }
    if (!this.marbles.size) this.smoke.update(dt);
    if (this.panes && this.panes.length) this.renderPanes();
    else this.renderer.render(this.scene, this.camera);
    if (saved) this.camera.position.copy(saved);
    // automatic quality: if frames are slow, render fewer pixels, then drop shadows
    const a = this.adaptive;
    if (a.locked || !dt) return;
    a.t += dt; a.frames++;
    if (a.t > 2.5) {
      const fps = a.frames / a.t; a.t = 0; a.frames = 0;
      if (fps < 28) {
        if (this.pixelRatio > 0.75) { this.pixelRatio = Math.max(0.7, this.pixelRatio * 0.75); this.renderer.setPixelRatio(this.pixelRatio); this.resize(); }
        else if (this.renderer.shadowMap.enabled) { this.renderer.shadowMap.enabled = false; this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); }); a.locked = true; }
      }
    }
  }
}

// ---------------- geometry helpers ----------------
// Builds a tube-like strip: each call to ring() adds a cross-section; consecutive
// sections are stitched together (open profile unless closed=true).
class GeoBuilder {
  constructor() { this.rings = []; }
  ring(points, colors, uvs, _tag, closed = false) { this.rings.push({ points, colors, uvs, closed }); }
  build() {
    const pos = [], col = [], uv = [], idx = [];
    const R = this.rings; if (!R.length) return new THREE.BufferGeometry();
    const n = R[0].points.length;
    const hasCol = !!R[0].colors, hasUv = !!R[0].uvs;
    for (let r = 0; r < R.length; r++) {
      for (let k = 0; k < n; k++) {
        const p = R[r].points[k]; pos.push(p.x, p.y, p.z);
        if (hasCol) { const c = R[r].colors[k]; col.push(c.r, c.g, c.b); }
        if (hasUv) uv.push(R[r].uvs[k][0], R[r].uvs[k][1]); else uv.push(k / (n - 1), r * 0.1);
      }
    }
    const segs = R[0].closed ? n : n - 1;
    for (let r = 0; r < R.length - 1; r++) for (let k = 0; k < segs; k++) {
      const a = r * n + k, b = r * n + ((k + 1) % n), c = (r + 1) * n + k, d = (r + 1) * n + ((k + 1) % n);
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (hasCol) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }
}

export function frameMatrix(track, s, u, h) {
  const f = frameAt(track, s);
  const l = new THREE.Vector3(...f.l), up = new THREE.Vector3(...f.u), fw = new THREE.Vector3(...f.f);
  const M = new THREE.Matrix4().makeBasis(l, up, fw);
  const p = {}; worldPos(track, s, u, h, p);
  M.setPosition(p.x, p.y, p.z);
  return M;
}

// cross-section sample positions: skirt, lip, running surface, lip, skirt
function acrossChannel(hw) {
  const out = [-(hw + LIP_W + 0.2)];
  for (let k = 0; k < 6; k++) out.push(-(hw + LIP_W) + (k * LIP_W) / 6);
  for (let k = 0; k <= 22; k++) out.push(-hw + (k * 2 * hw) / 22);
  for (let k = 1; k <= 6; k++) out.push(hw + (k * LIP_W) / 6);
  out.push(hw + LIP_W + 0.2);
  return out;
}

// a start/finish line that follows the curve of the channel floor
function curvedStrip(track, s, tex) {
  const b = new GeoBuilder();
  for (const ss of [s - 0.3, s + 0.3]) {
    const f = frameAt(track, ss);
    const pts = [], uvs = [];
    for (let k = 0; k <= 16; k++) {
      const u = f.hw - (2 * f.hw * k) / 16;
      const p = {}; worldPos(track, ss, u, surfH(f, u) + 0.025, p);
      pts.push(new THREE.Vector3(p.x, p.y, p.z)); uvs.push([k / 16, ss > s ? 1 : 0]);
    }
    b.ring(pts, null, uvs);
  }
  const m = new THREE.Mesh(b.build(), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }));
  m.receiveShadow = true;
  return m;
}

function finishArch(track, T) {
  const g = new THREE.Group();
  const s = track.finishS, f = frameAt(track, s), w = f.hw + LIP_W * 0.6;
  const base = renderH(f, w);
  const postMat = new THREE.MeshStandardMaterial({ color: T.rail, metalness: 0.5, roughness: 0.3 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 4.6, 12), postMat);
    post.applyMatrix4(frameMatrix(track, s, side * w, base + 2.0)); post.castShadow = true; g.add(post);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.6, 1.0, 0.15), [postMat, postMat, postMat, postMat, new THREE.MeshStandardMaterial({ map: bannerTexture('FINISH') }), new THREE.MeshStandardMaterial({ map: bannerTexture('FINISH') })]);
  banner.applyMatrix4(frameMatrix(track, s, 0, base + 4.0)); banner.castShadow = true; g.add(banner);
  return g;
}

function startTower(track, T) {
  const g = new THREE.Group();
  const s = 6.6, f = frameAt(track, s), w = f.hw + LIP_W * 0.6;
  const base = renderH(f, w);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.8, 0.9, 0.15), new THREE.MeshStandardMaterial({ map: bannerTexture('START') }));
  banner.applyMatrix4(frameMatrix(track, s, 0, base + 3.2)); g.add(banner);
  const postMat = new THREE.MeshStandardMaterial({ color: T.rail, metalness: 0.5, roughness: 0.3 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 3.8, 10), postMat);
    post.applyMatrix4(frameMatrix(track, s, side * w, base + 1.5)); post.castShadow = true; g.add(post);
  }
  return g;
}

// ---------------- terrain ----------------
// The hillside is shaped around the channel: inside the channel's footprint the
// ground sits just under the channel mesh, a sandy bank runs along the lip, and
// beyond that it blends into a smooth hill that follows the course downhill.
function buildTerrain(track, T) {
  const smp = track.samples;
  const pts = [];
  for (let i = 0; i < smp.length; i += 2) {
    const s = smp[i];
    const lh = Math.hypot(s.lx, s.lz) || 1, fh = Math.hypot(s.fx, s.fz) || 1;
    pts.push({ ...s, lxh: s.lx / lh, lzh: s.lz / lh, fxh: s.fx / fh, fzh: s.fz / fh });
  }
  const lastI = pts.length - 1;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minTrackY = Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); minTrackY = Math.min(minTrackY, p.y); }
  const M = 75;
  minX -= M; maxX += M; minZ -= M; maxZ += M;
  const RES = 1.5;
  const nx = Math.ceil((maxX - minX) / RES) + 1, nz = Math.ceil((maxZ - minZ) / RES) + 1;
  const H = new Float32Array(nx * nz), E = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = minX + i * RES, z = minZ + j * RES;
    let best = Infinity, bi = 0, wSum = 0, ySum = 0;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      const dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz;
      if (d2 < best) { best = d2; bi = k; }
      const w = 1 / (d2 + 16); wSum += w; ySum += w * p.y;
    }
    const n = pts[bi], d = Math.sqrt(best);
    const far = Math.max(0, d - 30);
    const hill = ySum / wSum - 0.07 * Math.max(0, d - 10) - 0.004 * far * far;
    const du = (x - n.x) * n.lxh + (z - n.z) * n.lzh;
    const df = (x - n.x) * n.fxh + (z - n.z) * n.fzh;
    const a = Math.abs(du);
    const foot = n.hw + LIP_W;
    const endCap = (bi === 0 && df < -0.4) || (bi === lastI && df > 0.4);
    const noise = noise2(x * 0.06, z * 0.06) * 2.6 + noise2(x * 0.19, z * 0.19) * 0.6;
    let h, e;
    if (n.gap && a < foot + 1.5 && !endCap) { h = n.y - 6; e = 0; }
    else if (n.bridge && !endCap) {
      // a ravine under the bridge
      e = Math.max(0, a - n.hw - 1.5);
      const ravine = n.y - 11 + e * 1.1;
      const t = smooth01((e - 3) / 10);
      h = Math.min(ravine, hill + noise) * (1 - t) + (hill + noise) * t;
    } else if (a < foot && !endCap) {
      e = 0;
      h = a < n.hw ? n.y + n.ly * du - 1.4 : n.y + n.ly * du + renderH(n, a) - 0.3;
    } else {
      e = endCap ? Math.max(0, Math.abs(df) - 0.4) : a - foot;
      const edgeU = endCap ? 0 : Math.sign(du) * foot;
      const berm = n.y + n.ly * edgeU + LIP_H - 0.25 + (endCap ? 0.4 : 0);
      const t = smooth01(e / 9);
      h = berm * (1 - t) + (hill + noise) * t;
    }
    H[j * nx + i] = h; E[j * nx + i] = e;
  }
  const geo = new THREE.PlaneGeometry((nx - 1) * RES, (nz - 1) * RES, nx - 1, nz - 1);
  geo.rotateX(-Math.PI / 2);
  const pa = geo.attributes.position;
  for (let k = 0; k < pa.count; k++) {
    const i = k % nx, j = Math.floor(k / nx);
    pa.setXYZ(k, minX + i * RES, H[j * nx + i], minZ + j * RES);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  let lowY = Infinity; for (const v of H) lowY = Math.min(lowY, v);
  const waterY = T.water != null ? Math.min(lowY + 6, minTrackY - 5) : -Infinity;
  const colors = new Float32Array(pa.count * 3);
  const c0 = new THREE.Color(T.ground[0]), c1 = new THREE.Color(T.ground[1]), c2 = new THREE.Color(T.ground[2]), rock = new THREE.Color(T.rockColor);
  const dug = new THREE.Color(T.floor).lerp(c0, 0.45);
  for (let k = 0; k < pa.count; k++) {
    const x = pa.getX(k), z = pa.getZ(k), y = pa.getY(k);
    const t = noise2(x * 0.08, z * 0.08) * 0.5 + 0.5;
    const c = c0.clone().lerp(c1, t).lerp(c2, Math.max(0, noise2(x * 0.21 + 9, z * 0.21) * 0.6));
    const steep = 1 - nrm.getY(k);
    if (steep > 0.22) c.lerp(rock, Math.min(1, (steep - 0.22) * 2.5));
    // freshly dug earth along the channel banks
    const e = E[k];
    if (e < 4) c.lerp(dug, (1 - e / 4) * 0.8);
    if (y < waterY + 1.2 && T.water != null && track.theme !== 'lava') c.lerp(new THREE.Color(0xd8c38f), 0.6);
    if (track.theme === 'lava' && y < waterY + 3) c.lerp(new THREE.Color(0x5a1a08), 0.6);
    colors[k * 3] = c.r; colors[k * 3 + 1] = c.g; colors[k * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  mesh.receiveShadow = true;
  if (T.glow) {
    // Neon City: a glowing grid over the ground
    const grid = canvasTex(64, 64, (ctx, w, h) => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ff3dbe'; ctx.fillRect(0, 0, w, 2); ctx.fillRect(0, 0, 2, h); });
    grid.repeat.set((maxX - minX) / 6, (maxZ - minZ) / 6);
    mesh.material.emissive = new THREE.Color(0xffffff); mesh.material.emissiveMap = grid; mesh.material.emissiveIntensity = 0.7;
  }

  let water = null;
  if (T.water != null) {
    const wg = new THREE.PlaneGeometry(maxX - minX + 400, maxZ - minZ + 400);
    wg.rotateX(-Math.PI / 2);
    const lava = track.theme === 'lava';
    water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({
      color: T.water, roughness: lava ? 0.6 : 0.08, metalness: lava ? 0 : 0.3,
      emissive: lava ? 0xff3a00 : 0x000000, emissiveIntensity: lava ? 1 : 0, transparent: !lava, opacity: 0.85,
    }));
    water.position.set((minX + maxX) / 2, waterY, (minZ + maxZ) / 2);
  }

  const heightAt = (x, z) => {
    const fi = (x - minX) / RES, fj = (z - minZ) / RES;
    const i = Math.max(0, Math.min(nx - 2, Math.floor(fi))), j = Math.max(0, Math.min(nz - 2, Math.floor(fj)));
    const tx = Math.min(1, Math.max(0, fi - i)), tz = Math.min(1, Math.max(0, fj - j));
    const a = H[j * nx + i], b = H[j * nx + i + 1], c = H[(j + 1) * nx + i], d = H[(j + 1) * nx + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
  return { mesh, water, heightAt, waterY, bounds: { minX, maxX, minZ, maxZ }, pts };
}

function smooth01(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

function buildBridgeDressing(track, T, heightAt) {
  const g = new THREE.Group();
  for (const br of track.bridges) {
    const postMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.8 });
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xe9d8a6, roughness: 0.9 });
    const posts = [];
    for (let s = br.s0; s <= br.s1 + 1e-6; s += 2) for (const side of [-1, 1]) {
      const f = frameAt(track, s);
      posts.push(frameMatrix(track, s, side * (f.hw + 0.1), 0.6));
    }
    const pg = new THREE.CylinderGeometry(0.07, 0.07, 1.2, 6);
    const im = new THREE.InstancedMesh(pg, postMat, posts.length);
    posts.forEach((M, k) => im.setMatrixAt(k, M)); im.castShadow = true; g.add(im);
    // ropes
    for (const side of [-1, 1]) {
      const pts = [];
      for (let s = br.s0; s <= br.s1 + 1e-6; s += 0.5) { const f = frameAt(track, s); const p = {}; const sag = 0.18 * Math.sin(((s - br.s0) % 2) / 2 * Math.PI); worldPos(track, s, side * (f.hw + 0.1), 1.15 - sag, p); pts.push(new THREE.Vector3(p.x, p.y, p.z)); }
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.035, 5, false);
      g.add(new THREE.Mesh(tube, ropeMat));
    }
    // towers at both ends
    for (const s of [br.s0 - 1, br.s1 + 1]) for (const side of [-1, 1]) {
      const f = frameAt(track, s);
      const p = {}; worldPos(track, s, side * (f.hw + 0.5), 0, p);
      const ground = heightAt(p.x, p.z);
      const h = p.y + 3 - ground;
      const tw = new THREE.Mesh(new THREE.BoxGeometry(0.5, h, 0.5), postMat);
      tw.position.set(p.x, ground + h / 2, p.z); tw.castShadow = true; g.add(tw);
    }
  }
  return g;
}

// ---------------- decor ----------------
function buildDecor(track, T, terrain) {
  const g = new THREE.Group();
  const { minX, maxX, minZ, maxZ } = terrain.bounds;
  const rand = mulberry32(track.seed);
  const pts = terrain.pts;
  const clearOf = (x, z, pad) => { for (const p of pts) if (Math.hypot(x - p.x, z - p.z) < p.hw + pad) return false; return true; };
  const spots = [];
  for (let k = 0; k < 2400 && spots.length < 420; k++) {
    const x = minX + 30 + rand() * (maxX - minX - 60), z = minZ + 30 + rand() * (maxZ - minZ - 60);
    const y = terrain.heightAt(x, z);
    if (y < terrain.waterY + 1.5) continue;
    if (!clearOf(x, z, LIP_W + 3)) continue;
    spots.push({ x, y, z, s: 0.7 + rand() * 0.8, r: rand() * 6.28 });
  }
  const addInstanced = (geo, mat, list, shadow = true) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((sp, k) => im.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(sp.x, sp.y, sp.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sp.r, 0)), new THREE.Vector3(sp.s, sp.s, sp.s))));
    im.castShadow = shadow; im.receiveShadow = true; g.add(im);
  };
  const rocks = [], plants = [];
  for (const sp of spots) (rand() < 0.28 ? rocks : plants).push(sp);
  const rockGeo = new THREE.DodecahedronGeometry(1, 0); rockGeo.scale(1.2, 0.7, 1); rockGeo.translate(0, 0.25, 0);
  addInstanced(rockGeo, new THREE.MeshStandardMaterial({ color: T.rockColor, roughness: 1, flatShading: true }), rocks);

  if (T.decor === 'trees') {
    addInstanced(cyl(0.18, 0.25, 1.6, 0.8), mat(0x6b4423), plants);
    addInstanced(merge([cone(1.3, 2.2, 2.2), cone(1.0, 1.8, 3.3)]), mat(0x2f7d32, true), plants.filter((_, i) => i % 2 === 0));
    addInstanced(sphereAt(1.4, 2.6), mat(0x3f9a3a, true), plants.filter((_, i) => i % 2 === 1));
  } else if (T.decor === 'pines') {
    addInstanced(cyl(0.15, 0.2, 1.2, 0.6), mat(0x4a3424), plants);
    addInstanced(merge([cone(1.4, 2.0, 1.8), cone(1.1, 1.8, 2.9), cone(0.8, 1.5, 3.9)]), mat(0x1f4d3a, true), plants);
    addInstanced(merge([cone(0.55, 0.7, 4.45)]), mat(0xffffff, true), plants);
  } else if (T.decor === 'cacti') {
    const cactus = merge([cyl(0.32, 0.36, 3.2, 1.6), armGeo(0.22, 1.2, 1.4, 0.6), armGeo(0.2, 0.9, 1.9, -0.55)]);
    addInstanced(cactus, mat(0x3f8f3a, true), plants.filter((_, i) => i % 3 !== 0));
    addInstanced(merge([cyl(0.6, 0.9, 0.5, 0.25)]), mat(0xb98b5a, true), plants.filter((_, i) => i % 3 === 0));
  } else if (T.decor === 'lavarocks') {
    const spikes = merge([cone(0.9, 3.5, 1.75), cone(0.6, 2.4, 1.2, 0.8)]);
    addInstanced(spikes, mat(0x1b1414, true), plants);
    addInstanced(new THREE.IcosahedronGeometry(0.35, 0), new THREE.MeshStandardMaterial({ color: 0xff6a00, emissive: 0xff4400, emissiveIntensity: 1.5 }), plants.filter((_, i) => i % 3 === 0), false);
  }
  return g;
}

const mat = (c, flat) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: !!flat });
function cyl(r0, r1, h, y) { const g = new THREE.CylinderGeometry(r0, r1, h, 8); g.translate(0, y, 0); return g; }
function cone(r, h, y, x = 0) { const g = new THREE.ConeGeometry(r, h, 8); g.translate(x, y, 0); return g; }
function sphereAt(r, y) { const g = new THREE.IcosahedronGeometry(r, 1); g.translate(0, y, 0); return g; }
function armGeo(r, h, y, x) {
  const a = new THREE.CylinderGeometry(r, r, Math.abs(x) + 0.2, 6); a.rotateZ(Math.PI / 2); a.translate(x / 2, y, 0);
  const b = new THREE.CylinderGeometry(r, r, h, 6); b.translate(x, y + h / 2, 0);
  return merge([a, b]);
}
function merge(geos) {
  const pos = [], nrm = [];
  for (let g of geos) {
    g = g.index ? g.toNonIndexed() : g;
    pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}

// ---------------- sparks (boost effect) ----------------
// ---------------- vape pickups ----------------
const VAPE_COLORS = [[0xff3d7f, 0xffb35c], [0x3de1ff, 0x7b4dff], [0x5cff9d, 0x1fb6ff], [0xffd23f, 0xff5e3a], [0xb06bff, 0xff4fd8], [0xff7a1a, 0xffe14d]];

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}
function extrudeCentered(shape, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  return g;
}
let vapeGeos = null;
function makeVape([c1, c2]) {
  if (!vapeGeos) vapeGeos = {
    body: extrudeCentered(roundedRect(0.4, 0.62, 0.15), 0.16, 0.04),
    band: extrudeCentered(roundedRect(0.4, 0.2, 0.08), 0.16, 0.045),
    tip: extrudeCentered(roundedRect(0.24, 0.2, 0.08), 0.1, 0.03),
    led: new THREE.CylinderGeometry(0.035, 0.035, 0.01, 12),
    ring: new THREE.TorusGeometry(0.42, 0.03, 8, 32),
  };
  const g = new THREE.Group();
  const body = new THREE.Mesh(vapeGeos.body, new THREE.MeshPhysicalMaterial({ color: c1, clearcoat: 1, clearcoatRoughness: 0.15, roughness: 0.3, metalness: 0.25, emissive: c1, emissiveIntensity: 0.12 }));
  const band = new THREE.Mesh(vapeGeos.band, new THREE.MeshPhysicalMaterial({ color: c2, clearcoat: 1, roughness: 0.3, metalness: 0.25 }));
  band.position.y = -0.39;
  const tip = new THREE.Mesh(vapeGeos.tip, new THREE.MeshStandardMaterial({ color: 0x1b1b22, roughness: 0.4 }));
  tip.position.y = 0.42;
  const led = new THREE.Mesh(vapeGeos.led, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 }));
  led.rotation.x = Math.PI / 2; led.position.set(0, -0.41, 0.125);
  const ring = new THREE.Mesh(vapeGeos.ring, new THREE.MeshStandardMaterial({ color: c1, emissive: c1, emissiveIntensity: 0.9, transparent: true, opacity: 0.7 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = -0.62;
  for (const m of [body, band, tip]) m.castShadow = true;
  g.add(body, band, tip, led, ring);
  g.scale.setScalar(1.3);
  return g;
}

// ---------------- smoke ----------------
function makeSmoke() {
  const tex = canvasTex(128, 128, (ctx, w, h) => {
    // a few overlapping soft blobs so each puff looks billowy
    for (let i = 0; i < 6; i++) {
      const x = w / 2 + (Math.random() - 0.5) * w * 0.3, y = h / 2 + (Math.random() - 0.5) * h * 0.3, r = w * (0.22 + Math.random() * 0.18);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    }
  }, false);
  const N = 260;
  const group = new THREE.Group();
  const parts = [];
  for (let i = 0; i < N; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
    sp.visible = false; sp.renderOrder = 5;
    group.add(sp);
    parts.push({ sp, vel: new THREE.Vector3(), life: 0, max: 1, size: 1, grow: 1, op: 0.8, spin: 0 });
  }
  let next = 0;
  return {
    group,
    puff(pos, color = '#ffffff', n = 16, size = 1) {
      for (let k = 0; k < n; k++) {
        const p = parts[next]; next = (next + 1) % N;
        p.sp.position.set(pos.x + (Math.random() - 0.5) * 0.4 * size, pos.y + (Math.random() - 0.5) * 0.3 * size, pos.z + (Math.random() - 0.5) * 0.4 * size);
        p.vel.set((Math.random() - 0.5) * 2.2 * size, (0.6 + Math.random() * 1.4) * size, (Math.random() - 0.5) * 2.2 * size);
        p.max = p.life = 1.6 + Math.random() * 1.3;
        p.size = (0.45 + Math.random() * 0.4) * size;
        p.grow = (1.8 + Math.random() * 1.2) * size;
        p.op = 0.75 + Math.random() * 0.25;
        p.sp.material.color.set(color).lerp(new THREE.Color(0xffffff), 0.35);
        p.sp.material.rotation = Math.random() * 6.28;
        p.spin = (Math.random() - 0.5) * 1.2;
        p.sp.visible = true;
      }
    },
    update(dt) {
      if (!dt) return;
      const damp = Math.pow(0.25, dt);
      for (const p of parts) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { p.sp.visible = false; continue; }
        p.vel.multiplyScalar(damp); p.vel.y += 0.25 * dt;
        p.sp.position.addScaledVector(p.vel, dt);
        p.size += p.grow * dt;
        p.sp.scale.set(p.size, p.size, 1);
        p.sp.material.rotation += p.spin * dt;
        const t = p.life / p.max;
        p.sp.material.opacity = p.op * Math.min(1, (1 - t) * 6) * Math.pow(t, 0.8);
      }
    },
  };
}

function makeSparks() {
  const N = 600;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.18, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  points.frustumCulled = false;
  const life = new Float32Array(N), vel = new Float32Array(N * 3);
  let next = 0;
  return {
    points,
    emit(p) {
      const i = next; next = (next + 1) % N;
      pos[i * 3] = p.x + (Math.random() - 0.5) * 0.4; pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.4; pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.4;
      vel[i * 3] = (Math.random() - 0.5) * 2; vel[i * 3 + 1] = Math.random() * 2.5; vel[i * 3 + 2] = (Math.random() - 0.5) * 2;
      life[i] = 0.6 + Math.random() * 0.3;
    },
    update(dt) {
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue; }
        life[i] -= dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        vel[i * 3 + 1] -= 4 * dt;
        const t = Math.max(0, life[i]);
        col[i * 3] = t * 1.6; col[i * 3 + 1] = t * 0.9; col[i * 3 + 2] = t * 0.2;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
  };
}

// ---------------- textures ----------------
export function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
function skyTexture(top, bottom) {
  return canvasTex(4, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#' + new THREE.Color(top).getHexString());
    g.addColorStop(0.75, '#' + new THREE.Color(bottom).getHexString());
    g.addColorStop(1, '#' + new THREE.Color(bottom).getHexString());
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, false);
}
function grainTexture() {
  return canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { const v = 200 + Math.random() * 55; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1); }
  });
}
function speckleTexture(color) {
  const base = '#' + new THREE.Color(color).getHexString();
  return canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(Math.random() * w, Math.random() * h, 0.5 + Math.random() * 2.2, 0, 7); ctx.fill(); }
  });
}
function chevronTexture(color) {
  const c = '#' + new THREE.Color(color).getHexString();
  return canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(20,20,20,0.55)'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = c; ctx.lineWidth = 16; ctx.lineJoin = 'miter';
    ctx.beginPath(); ctx.moveTo(12, h * 0.25); ctx.lineTo(w / 2, h * 0.7); ctx.lineTo(w - 12, h * 0.25); ctx.stroke();
  });
}
function hazardTexture() {
  return canvasTex(128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#ffd400'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111';
    for (let x = -h; x < w + h; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 16, 0); ctx.lineTo(x + 16 - h, h); ctx.lineTo(x - h, h); ctx.fill(); }
  });
}
function checkerTexture(nx, ny) {
  return canvasTex(nx * 16, ny * 32, (ctx, w, h) => {
    for (let i = 0; i < nx * 2; i++) for (let j = 0; j < 4; j++) { ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff'; ctx.fillRect(i * 8, j * (h / 4), 8, h / 4); }
  }, false);
}
function bannerTexture(text) {
  return canvasTex(512, 96, (ctx, w, h) => {
    for (let i = 0; i < 32; i++) for (let j = 0; j < 6; j++) { ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff'; ctx.fillRect(i * 16, j * 16, 16, 16); }
    ctx.fillStyle = '#111'; ctx.fillRect(w * 0.22, 8, w * 0.56, h - 16);
    ctx.fillStyle = '#fff'; ctx.font = '900 64px Arial Black, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 3);
  }, false);
}
function nameSprite(name, bot) {
  const tex = canvasTex(256, 64, (ctx, w, h) => {
    ctx.font = '700 34px system-ui, Arial, sans-serif';
    const tw = Math.min(w - 8, ctx.measureText(name).width + 28);
    ctx.fillStyle = bot ? 'rgba(40,40,50,0.7)' : 'rgba(10,10,20,0.78)';
    roundRect(ctx, (w - tw) / 2, 8, tw, 48, 24); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, w / 2, 33, w - 30);
  }, false);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.5, 0.375, 1); s.renderOrder = 10;
  return s;
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// ---------------- misc ----------------
function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) for (const m of [].concat(o.material)) { for (const k of ['map', 'emissiveMap']) m[k]?.dispose(); m.dispose(); }
  });
}
export function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function noise2(x, y) {
  // cheap smooth value noise
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => { let n = a * 374761393 + b * 668265263; n = (n ^ (n >>> 13)) * 1274126177; return ((n ^ (n >>> 16)) >>> 0) / 4294967296 * 2 - 1; };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}
