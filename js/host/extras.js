// Extra 3D for the wackier side of Marble Mayhem: the new track features
// (bumpers, windmills, portals, bounce pads), themed skies and scenery for the
// Moon, Castle, Candy Land and Neon City, and crowds of marble fans on the banks.
import * as THREE from 'three';
import { DS, MARBLE_R, worldPos, frameAt, surfH, renderH, LIP_W } from './track.js';
import { skinCanvas, SKINS } from '../skins.js';
import { frameMatrix, canvasTex, mulberry32 } from './render.js';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
const put = (m, x, y, z, rot) => { m.position.set(x, y, z); if (rot) m.rotation.copy(rot); return m; };
const P = (track, s, u, h) => { const o = {}; worldPos(track, s, u, h, o); return new THREE.Vector3(o.x, o.y, o.z); };

// ---------------- track features ----------------
export function buildFeatures(track, g) {
  const T = track.themeData;
  const out = { bumpers: [], windmills: [], portals: [], tramps: [] };

  // pinball bumpers
  const bumpGeo = new THREE.CylinderGeometry(0.42, 0.46, 0.6, 24);
  const capGeo = new THREE.TorusGeometry(0.36, 0.07, 10, 28);
  for (const b of track.bumpers || []) {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(bumpGeo, std(T.accent, { roughness: 0.3, metalness: 0.2 })));
    const cap = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe14d, emissiveIntensity: 0.4 }));
    cap.rotation.x = Math.PI / 2; cap.position.y = 0.32; grp.add(cap);
    grp.applyMatrix4(frameMatrix(track, b.s, b.u, surfH(frameAt(track, b.s), b.u) + 0.28));
    grp.traverse((o) => { o.castShadow = true; });
    g.add(grp);
    out.bumpers.push({ def: b, cap });
  }

  // windmills: a hub and a long spinning bar
  for (const w of track.windmills || []) {
    const base = new THREE.Group();
    base.applyMatrix4(frameMatrix(track, w.s, 0, surfH(frameAt(track, w.s), 0)));
    base.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.9, 16), std(0x444455, { metalness: 0.6 })), 0, 0.45, 0));
    const rot = new THREE.Group(); rot.position.y = 0.38;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, w.len * 2), new THREE.MeshStandardMaterial({ map: hazard(), roughness: 0.5 }));
    rot.add(bar);
    rot.add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), std(T.accent)));
    base.add(rot);
    base.traverse((o) => { o.castShadow = true; });
    g.add(base);
    out.windmills.push({ def: w, rot });
  }

  // portals: an orange ring in, a blue ring out, swirling
  const swirl = swirlTexture();
  for (const p of track.portals || []) {
    for (const [s, color] of [[p.sIn, 0xff8a00], [p.sOut, 0x2fa4ff]]) {
      const f = frameAt(track, s);
      const u = p.side * f.hw * 0.48;
      const grp = new THREE.Group();
      grp.applyMatrix4(frameMatrix(track, s, u, surfH(f, u) + 0.95));
      grp.add(new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.11, 12, 40), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4 })));
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.92, 40), new THREE.MeshBasicMaterial({ map: swirl, color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      grp.add(disc);
      g.add(grp);
      out.portals.push({ def: p, disc });
    }
  }

  // bounce pads: a springy strip right across the channel
  for (const tp of track.tramps || []) {
    const pts = [];
    for (const ds of [-0.7, 0.7]) {
      const s = tp.s + ds, f = frameAt(track, s), ring = [];
      for (let k = 0; k <= 12; k++) { const u = f.hw * 0.95 - (f.hw * 1.9 * k) / 12; ring.push(P(track, s, u, surfH(f, u) + 0.05)); }
      pts.push(ring);
    }
    const geo = ribbon(pts);
    const pad = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1e88ff, emissive: 0x1e88ff, emissiveIntensity: 0.25, roughness: 0.3, side: THREE.DoubleSide }));
    pad.receiveShadow = true;
    g.add(pad);
    out.tramps.push({ def: tp, pad });
  }
  return out;
}

export function animateFeatures(feat, simT) {
  if (!feat) return;
  for (const w of feat.windmills) w.rot.rotation.y = simT * w.def.omega + w.def.phase;
  for (const b of feat.bumpers) b.cap.material.emissiveIntensity = b.def.hitT != null && simT - b.def.hitT < 0.25 ? 3 : 0.4;
  for (const p of feat.portals) p.disc.rotation.z = -simT * 3;
  for (const t of feat.tramps) t.pad.material.emissiveIntensity = t.def.hitT != null && simT - t.def.hitT < 0.3 ? 1.5 : 0.25;
}

function ribbon(rings) {
  const pos = [], idx = [];
  const n = rings[0].length;
  for (const r of rings) for (const p of r) pos.push(p.x, p.y, p.z);
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < n - 1; k++) { const a = i * n + k, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  return geo;
}
function hazard() {
  return canvasTex(64, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ffd400'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#111';
    for (let y = -w; y < h + w; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + 16); ctx.lineTo(w, y + 32); ctx.lineTo(0, y + 16); ctx.fill(); }
  });
}
function swirlTexture() {
  return canvasTex(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0.1)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 6;
    for (let k = 0; k < 4; k++) { ctx.beginPath(); for (let t = 0; t < 1; t += 0.02) { const a = t * 5 + (k * Math.PI) / 2, r = t * w * 0.48; ctx.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r); } ctx.stroke(); }
  }, false);
}

// ---------------- skies ----------------
export function buildSky(track, center) {
  const T = track.themeData, g = new THREE.Group();
  if (T.stars) {
    const n = 1800, pos = new Float32Array(n * 3), rand = mulberry32(track.seed ^ 77);
    for (let i = 0; i < n; i++) {
      const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = 600;
      const y = Math.abs(u) * 0.9 + 0.05; // keep stars above the horizon
      const xz = Math.sqrt(1 - y * y);
      pos.set([center.x + Math.cos(a) * xz * r, center.y + y * r, center.z + Math.sin(a) * xz * r], i * 3);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false })));
  }
  if (track.theme === 'moon') {
    const earth = new THREE.Mesh(new THREE.SphereGeometry(45, 48, 32), new THREE.MeshBasicMaterial({ map: earthTexture(), fog: false }));
    earth.position.set(center.x - 260, center.y + 210, center.z - 380);
    earth.rotation.set(0.3, 1.2, 0.2);
    g.add(earth);
  }
  if (track.theme === 'neon') {
    const sun = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshBasicMaterial({ map: synthSun(), transparent: true, fog: false }));
    sun.position.set(center.x, center.y + 40, center.z - 520);
    g.add(sun);
  }
  return g;
}
function earthTexture() {
  return canvasTex(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1f5fbf'; ctx.fillRect(0, 0, w, h);
    const rand = mulberry32(5);
    ctx.fillStyle = '#3f9a4a';
    for (let i = 0; i < 26; i++) { ctx.beginPath(); ctx.ellipse(rand() * w, h * 0.2 + rand() * h * 0.6, 20 + rand() * 50, 12 + rand() * 30, rand() * 3, 0, 7); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 40; i++) { ctx.beginPath(); ctx.ellipse(rand() * w, rand() * h, 10 + rand() * 40, 3 + rand() * 6, rand(), 0, 7); ctx.fill(); }
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, 14); ctx.fillRect(0, h - 14, w, 14);
  }, false);
}
function synthSun() {
  return canvasTex(256, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#ffe14d'); g.addColorStop(1, '#ff3dbe');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 2, 0, 7); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 7; k++) { const y = h * 0.55 + k * 15; ctx.fillRect(0, y, w, 3 + k * 1.5); }
  }, false);
}

// ---------------- scenery per world ----------------
export function buildThemeDecor(track, terrain) {
  const T = track.themeData, g = new THREE.Group();
  const rand = mulberry32(track.seed ^ 0xdec0);
  const pts = terrain.pts;
  const clear = (x, z, pad) => { for (const p of pts) if (Math.hypot(x - p.x, z - p.z) < p.hw + LIP_W + pad) return false; return true; };
  const { minX, maxX, minZ, maxZ } = terrain.bounds;
  const spots = (n, pad, tries = 600) => {
    const out = [];
    for (let k = 0; k < tries && out.length < n; k++) {
      const x = minX + 50 + rand() * (maxX - minX - 100), z = minZ + 50 + rand() * (maxZ - minZ - 100);
      if (!clear(x, z, pad)) continue;
      const y = terrain.heightAt(x, z);
      if (y < terrain.waterY + 1) continue;
      out.push({ x, y, z, r: rand() * Math.PI * 2, s: 0.8 + rand() * 0.6 });
    }
    return out;
  };
  const place = (obj, sp) => { obj.position.set(sp.x, sp.y, sp.z); obj.rotation.y = sp.r; obj.scale.multiplyScalar(sp.s); obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); g.add(obj); };

  if (track.theme === 'moon') {
    for (const sp of spots(26, 4)) place(crater(rand), sp);
    for (const sp of spots(5, 14)) place(moonBase(rand), sp);
    for (const sp of spots(6, 8)) place(antenna(), sp);
    const f = frameAt(track, 3);
    const flag = new THREE.Group();
    flag.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 8), std(0xdddddd, { metalness: 0.8 })), 0, 1.6, 0));
    flag.add(put(new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide })), 0.8, 2.6, 0));
    const fp = P(track, 3, f.hw + LIP_W + 1.5, 0); flag.position.set(fp.x, terrain.heightAt(fp.x, fp.z), fp.z);
    g.add(flag);
  } else if (track.theme === 'castle') {
    for (const sp of spots(3, 30, 1200)) place(castle(rand), { ...sp, s: 1 + rand() * 0.4 });
    for (const sp of spots(8, 12)) place(tower(rand), sp);
    for (const sp of spots(10, 5)) place(banner(rand), { ...sp, s: 1 });
  } else if (track.theme === 'candy') {
    for (const sp of spots(30, 5)) place(lollipop(rand), sp);
    for (const sp of spots(18, 5)) place(candyCane(), sp);
    for (const sp of spots(40, 4)) place(gumdrop(rand), sp);
    for (const sp of spots(10, 6)) place(donut(rand), sp);
  } else if (track.theme === 'neon') {
    for (const sp of spots(40, 18, 1500)) place(building(rand), { ...sp, s: 1 });
    for (const sp of spots(30, 4)) place(pylon(rand), sp);
  }
  // Neon City: glowing strips along both lips of the channel
  if (T.glow) g.add(glowLips(track));
  return g;
}

function crater(rand) {
  const g = new THREE.Group(), r = 2 + rand() * 4;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.18, 8, 32), std(0xa6a6aa, { roughness: 1 }));
  rim.rotation.x = Math.PI / 2; rim.scale.z = 0.5; rim.position.y = 0.05; g.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(r, 32), std(0x6c6c72, { roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.08; g.add(floor);
  return g;
}
function moonBase(rand) {
  const g = new THREE.Group(), white = std(0xf2f4f8, { roughness: 0.4, metalness: 0.1 });
  const domes = [[0, 0, 4], [9, 2, 2.6], [-7, 5, 3]];
  for (const [x, z, r] of domes) {
    g.add(put(new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), white), x, 0, z));
    g.add(put(new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 8, 32), std(0x4dd2ff, { emissive: 0x4dd2ff, emissiveIntensity: 0.8 })), x, 0.2, z, new THREE.Euler(Math.PI / 2, 0, 0)));
  }
  for (const [a, b] of [[0, 1], [0, 2]]) {
    const [x1, z1] = domes[a], [x2, z2] = domes[b];
    const len = Math.hypot(x2 - x1, z2 - z1);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, len, 16), white);
    tube.rotation.z = Math.PI / 2; tube.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    tube.position.set((x1 + x2) / 2, 0.7, (z1 + z2) / 2);
    g.add(tube);
  }
  return g;
}
function antenna() {
  const g = new THREE.Group(), metal = std(0xcfd6e0, { metalness: 0.8, roughness: 0.3 });
  g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 4, 8), metal), 0, 2, 0));
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 3), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, metalness: 0.4 }));
  dish.position.y = 4.4; dish.rotation.x = Math.PI * 0.75; g.add(dish);
  g.add(put(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff3355, emissive: 0xff3355, emissiveIntensity: 2 })), 0, 4.1, 0.2));
  return g;
}
function flagTexture() {
  return canvasTex(160, 100, (ctx, w, h) => {
    ctx.fillStyle = '#ff3d7f'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff'; ctx.font = '900 30px Arial Black, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('MARBLE', w / 2, h * 0.35); ctx.fillText('MAYHEM', w / 2, h * 0.7);
  }, false);
}
function stoneTexture() {
  return canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#8f877c'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? -12 : 0; x < w; x += 24) {
      const v = 120 + Math.random() * 40; ctx.fillStyle = `rgb(${v},${v - 6},${v - 14})`; ctx.fillRect(x + 1, y + 1, 22, 14);
    }
  });
}
let stoneMat = null;
function stone() { if (!stoneMat) { const t = stoneTexture(); t.repeat.set(2, 2); stoneMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }); } return stoneMat; }
function tower(rand, r = 1.6, h = 10) {
  const g = new THREE.Group();
  g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, h, 20), stone()), 0, h / 2 - 0.5, 0));
  g.add(put(new THREE.Mesh(new THREE.ConeGeometry(r * 1.25, r * 2.2, 20), std(rand() < 0.5 ? 0xb83227 : 0x2c5aa0)), 0, h + r * 1.1 - 0.5, 0));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), std(0x333333));
  pole.position.y = h + r * 2.2 + 0.2; g.add(pole);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.6), new THREE.MeshStandardMaterial({ color: rand() < 0.5 ? 0xffd23f : 0xc0392b, side: THREE.DoubleSide }));
  fl.position.set(0.55, h + r * 2.2 + 0.7, 0); g.add(fl);
  return g;
}
function castle(rand) {
  const g = new THREE.Group();
  const keep = new THREE.Mesh(new THREE.BoxGeometry(9, 9, 9), stone()); keep.position.y = 4; g.add(keep);
  for (let i = 0; i < 12; i++) { // crenellations
    const a = i % 3, side = Math.floor(i / 3);
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 1.2), stone());
    const t = -3.3 + a * 3.3;
    m.position.set(side === 0 ? t : side === 1 ? 4 : side === 2 ? -t : -4, 9, side === 0 ? 4 : side === 1 ? t : side === 2 ? -4 : -t);
    g.add(m);
  }
  for (const [x, z] of [[-5.5, -5.5], [5.5, -5.5], [-5.5, 5.5], [5.5, 5.5]]) { const t = tower(rand, 1.8, 13); t.position.set(x, 0, z); g.add(t); }
  const gate = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 0.3), std(0x3b2a1a)); gate.position.set(0, 1.5, 4.55); g.add(gate);
  return g;
}
function banner(rand) {
  const g = new THREE.Group();
  g.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 8), std(0x5a3a1a)), 0, 2, 0));
  const b = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.6), new THREE.MeshStandardMaterial({ color: [0xc0392b, 0x2c5aa0, 0xf1c232, 0x27ae60][Math.floor(rand() * 4)], side: THREE.DoubleSide }));
  b.position.set(0.48, 3, 0); g.add(b);
  return g;
}
// shared geometry and materials keep the draw cost down
const memo = new Map();
const once = (key, make) => { if (!memo.has(key)) memo.set(key, make()); return memo.get(key); };
function lollipop(rand) {
  const g = new THREE.Group(), h = 2.5 + rand() * 3;
  g.add(put(new THREE.Mesh(once('stickGeo', () => new THREE.CylinderGeometry(0.1, 0.1, 1, 8)), once('white', () => std(0xffffff))), 0, h / 2, 0));
  g.children[0].scale.y = h;
  const ci = Math.floor(rand() * 4);
  const colors = [['#ff3d7f', '#ffffff'], ['#3de1ff', '#ffffff'], ['#ffd23f', '#ff6b35'], ['#7b4dff', '#ff9fcf']][ci];
  const mats = once('lolly' + ci, () => {
    const tex = canvasTex(128, 128, (ctx, w) => { for (let k = 0; k < 12; k++) { ctx.fillStyle = colors[k % 2]; ctx.beginPath(); ctx.moveTo(w / 2, w / 2); ctx.arc(w / 2, w / 2, w / 2, (k * Math.PI) / 6, ((k + 1) * Math.PI) / 6 + 0.02); ctx.fill(); } }, false);
    const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 });
    return [std(colors[0]), face, face];
  });
  const disc = new THREE.Mesh(once('lollyGeo', () => new THREE.CylinderGeometry(1.1, 1.1, 0.3, 32)), mats);
  disc.rotation.x = Math.PI / 2; disc.position.y = h + 0.9; g.add(disc);
  return g;
}
function candyCane() { return once('caneProto', makeCane).clone(); }
function makeCane() {
  const pts = [];
  for (let i = 0; i <= 10; i++) pts.push(new THREE.Vector3(0, i * 0.45, 0));
  for (let i = 1; i <= 10; i++) { const a = (i / 10) * Math.PI; pts.push(new THREE.Vector3(0.8 - Math.cos(a) * 0.8, 4.5 + Math.sin(a) * 0.8, 0)); }
  const tex = canvasTex(64, 64, (ctx, w, h) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#e8152f'; for (let x = -h; x < w + h; x += 22) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 10, 0); ctx.lineTo(x + 10 + h, h); ctx.lineTo(x + h, h); ctx.fill(); } });
  tex.repeat.set(12, 1);
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.22, 12), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 }));
}
function gumdrop(rand) {
  const c = [0xff3d7f, 0x3de1ff, 0x5cff9d, 0xffd23f, 0xb06bff, 0xff7a1a][Math.floor(rand() * 6)];
  const m = new THREE.Mesh(once('gumGeo', () => new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2)), once('gum' + c, () => std(c, { roughness: 0.35 })));
  m.scale.set(1.2, 1.5, 1.2);
  return m;
}
function donut(rand) {
  const g = new THREE.Group();
  const d = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.6, 16, 32), std(0xc98a4b)); d.rotation.x = Math.PI / 2; d.position.y = 0.6; g.add(d);
  const icing = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.45, 16, 32, Math.PI * 2), std(rand() < 0.5 ? 0xff9fcf : 0x7b4dff, { roughness: 0.3 }));
  icing.rotation.x = Math.PI / 2; icing.position.y = 0.85; icing.scale.z = 0.6; g.add(icing);
  return g;
}
let windowTex = null;
function building(rand) {
  if (!windowTex) windowTex = canvasTex(64, 128, (ctx, w, h) => {
    ctx.fillStyle = '#0d0820'; ctx.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 10) for (let x = 4; x < w; x += 10) { if (Math.random() < 0.55) { ctx.fillStyle = ['#3de1ff', '#ff3dbe', '#ffe14d', '#b9a6ff'][Math.floor(Math.random() * 4)]; ctx.fillRect(x, y, 5, 6); } }
  });
  const w = 4 + rand() * 6, d = 4 + rand() * 6, h = 10 + rand() * 40;
  const tex = windowTex.clone(); tex.needsUpdate = true; tex.repeat.set(w / 6, h / 12);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0x15102a, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1, map: tex }));
  m.position.y = h / 2 - 1;
  const g = new THREE.Group(); g.add(m);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.3, d + 0.3), new THREE.MeshBasicMaterial({ color: rand() < 0.5 ? 0x3de1ff : 0xff3dbe }));
  edge.position.y = h - 1; g.add(edge);
  return g;
}
function pylon(rand) {
  const c = rand() < 0.5 ? 0x3de1ff : 0xff3dbe, h = 3 + rand() * 4;
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.25, h, 0.25), new THREE.MeshBasicMaterial({ color: c }));
  m.position.y = h / 2;
  const g = new THREE.Group(); g.add(m);
  return g;
}
function glowLips(track) {
  const g = new THREE.Group();
  for (const [side, color] of [[1, 0xff3dbe], [-1, 0x3de1ff]]) {
    const rings = [];
    for (let i = 0; i < track.samples.length; i += 2) {
      const sm = track.samples[i];
      if (sm.gap) { if (rings.length > 1) g.add(strip(rings.splice(0), color)); rings.length = 0; continue; }
      const u = side * (sm.hw + LIP_W * 0.42);
      const h = renderH(sm, u) + 0.04;
      rings.push([P(track, sm.s, u - side * 0.1, h), P(track, sm.s, u + side * 0.1, h)]);
    }
    if (rings.length > 1) g.add(strip(rings, color));
  }
  return g;
}
function strip(rings, color) {
  return new THREE.Mesh(ribbon(rings), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
}

// ---------------- the crowd ----------------
// Marble fans on the banks at the start, the finish and the big features.
// They hop about, and go wild when racers roll past.
export function buildFans(track, terrain) {
  const rand = mulberry32(track.seed ^ 0xfa25);
  const spots = [];
  const zones = [[0.5, 12], [track.finishS - 12, track.finishS + 14]];
  for (const sec of track.sections) {
    if (['jump', 'split', 'bridge', 'bumpers', 'windmill', 'portal', 'tramps', 'plunge'].includes(sec.mod)) {
      const mid = (sec.s0 + sec.s1) / 2;
      zones.push([mid - 7, mid + 7]);
    }
  }
  for (const [a, b] of zones) {
    for (let s = Math.max(0.5, a); s < Math.min(track.length - 1, b); s += 1.15) {
      const f = frameAt(track, s);
      if (f.bridge) continue;
      for (const side of [-1, 1]) for (let row = 0; row < 2; row++) {
        if (rand() < 0.25) continue;
        const u = side * (f.hw + LIP_W + 1.1 + row * 1.15 + rand() * 0.3);
        const p = P(track, s + (rand() - 0.5) * 0.4, u, 0);
        const y = terrain.heightAt(p.x, p.z);
        if (Math.abs(y - f.y) > 5) continue; // not on a cliff or down a ravine
        const toward = P(track, s, 0, 0).sub(p);
        spots.push({ x: p.x, y: y + MARBLE_R * 0.95, z: p.z, s, yaw: Math.atan2(-toward.z, toward.x), phase: rand() * 6.28, speed: 5 + rand() * 4 });
      }
    }
  }
  // a handful of skins, one instanced mesh per skin
  const skins = [...SKINS].sort(() => rand() - 0.5).slice(0, 10);
  const geo = new THREE.SphereGeometry(MARBLE_R * 0.95, 20, 14);
  const groups = skins.map((sk) => {
    const tex = new THREE.CanvasTexture(skinCanvas(sk.id, 256)); tex.colorSpace = THREE.SRGBColorSpace;
    return { mat: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, metalness: 0.05 }), list: [] };
  });
  const hatList = [];
  for (const sp of spots) {
    groups[Math.floor(rand() * groups.length)].list.push(sp);
    if (rand() < 0.4) { sp.hat = true; hatList.push(sp); }
  }
  const root = new THREE.Group();
  const meshes = [];
  for (const gr of groups) {
    if (!gr.list.length) continue;
    const im = new THREE.InstancedMesh(geo, gr.mat, gr.list.length);
    im.castShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(im); meshes.push({ im, list: gr.list });
  }
  let hats = null;
  if (hatList.length) {
    hats = new THREE.InstancedMesh(new THREE.ConeGeometry(0.18, 0.42, 14).translate(0, 0.21, 0), new THREE.MeshStandardMaterial({ roughness: 0.5 }), hatList.length);
    const cols = [0xff3d7f, 0xffd23f, 0x3de1ff, 0x5cff9d, 0xb06bff];
    hatList.forEach((sp, i) => hats.setColorAt(i, new THREE.Color(cols[i % cols.length])));
    hats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(hats);
  }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), V = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  return {
    group: root,
    count: spots.length,
    // racerS: distances along the track of marbles still racing
    update(t, racerS) {
      for (const sp of spots) {
        let near = false;
        if (racerS) for (const s of racerS) if (Math.abs(s - sp.s) < 14) { near = true; break; }
        const amp = near ? 0.75 : 0.12;
        const spd = near ? sp.speed * 1.4 : sp.speed * 0.5;
        sp.h = Math.abs(Math.sin(t * spd + sp.phase)) * amp;
      }
      for (const { im, list } of meshes) {
        list.forEach((sp, i) => { Q.setFromAxisAngle(UP, sp.yaw); V.set(sp.x, sp.y + sp.h, sp.z); im.setMatrixAt(i, M.compose(V, Q, S)); });
        im.instanceMatrix.needsUpdate = true;
      }
      if (hats) {
        hatList.forEach((sp, i) => { Q.setFromAxisAngle(UP, sp.yaw); V.set(sp.x, sp.y + sp.h + MARBLE_R * 0.9, sp.z); hats.setMatrixAt(i, M.compose(V, Q, S)); });
        hats.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
