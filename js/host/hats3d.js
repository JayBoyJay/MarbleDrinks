// 3D hat models, built from simple shapes. Each hat's base sits at y = 0,
// sized for a marble of radius 0.45.
import * as THREE from 'three';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; };

function stripes(c1, c2, n = 6) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d');
  for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? c2 : c1; ctx.fillRect((i * 64) / n, 0, 64 / n + 1, 64); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function starry() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#3b1f7a'; ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#ffd23f';
  for (let i = 0; i < 14; i++) { const x = Math.random() * 128, y = Math.random() * 128, r = 3 + Math.random() * 4; ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const BUILDERS = {
  tophat() {
    const g = new THREE.Group(), black = std(0x15151a, { roughness: 0.35 });
    g.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.03, 32), black, 0, 0.015));
    g.add(mesh(new THREE.CylinderGeometry(0.24, 0.25, 0.42, 32), black, 0, 0.24));
    g.add(mesh(new THREE.CylinderGeometry(0.255, 0.255, 0.08, 32), std(0xc0392b), 0, 0.08));
    return g;
  },
  party() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.ConeGeometry(0.22, 0.55, 24), new THREE.MeshStandardMaterial({ map: stripes('#ff3d7f', '#ffd23f'), roughness: 0.5 }), 0, 0.275));
    g.add(mesh(new THREE.SphereGeometry(0.07, 12, 8), std(0x3de1ff), 0, 0.57));
    return g;
  },
  crown() {
    const g = new THREE.Group(), gold = std(0xf1c232, { metalness: 0.9, roughness: 0.25 });
    g.add(mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.15, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xf1c232, metalness: 0.9, roughness: 0.25, side: THREE.DoubleSide }), 0, 0.075));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.add(mesh(new THREE.ConeGeometry(0.06, 0.16, 8), gold, Math.cos(a) * 0.25, 0.22, Math.sin(a) * 0.25));
      g.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), std(i % 2 ? 0xe0115f : 0x2e86de, { metalness: 0.3, roughness: 0.1 }), Math.cos(a) * 0.272, 0.08, Math.sin(a) * 0.272));
    }
    return g;
  },
  cowboy() {
    const g = new THREE.Group(), brown = std(0x8b5a2b);
    const brim = mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.03, 32), brown, 0, 0.02); brim.scale.set(1, 1, 0.8); g.add(brim);
    const crown = mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.28, 24), brown, 0, 0.16); crown.scale.set(1, 1, 0.85); g.add(crown);
    g.add(mesh(new THREE.CylinderGeometry(0.255, 0.255, 0.05, 24), std(0x2b1a0e), 0, 0.06));
    return g;
  },
  viking() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.SphereGeometry(0.3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(0x8e9aa6, { metalness: 0.7, roughness: 0.35 }), 0, -0.05));
    for (const side of [-1, 1]) {
      const horn = mesh(new THREE.ConeGeometry(0.06, 0.32, 12), std(0xf3ead2), side * 0.32, 0.14);
      horn.rotation.z = -side * 1.0; g.add(horn);
    }
    return g;
  },
  propeller() {
    const g = new THREE.Group();
    const cap = new THREE.SphereGeometry(0.29, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    g.add(mesh(cap, new THREE.MeshStandardMaterial({ map: stripes('#ff3d3d', '#3d7bff', 8), roughness: 0.5 }), 0, -0.06));
    g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), std(0x333333), 0, 0.28));
    const blades = new THREE.Group(); blades.position.y = 0.34; blades.name = 'spin';
    for (const a of [0, Math.PI]) { const b = mesh(new THREE.BoxGeometry(0.34, 0.01, 0.07), std(0xffd23f), Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17); blades.add(b); }
    g.add(blades);
    return g;
  },
  wizard() {
    const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ map: starry(), roughness: 0.6 });
    g.add(mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.03, 32), mat, 0, 0.015));
    const cone = mesh(new THREE.ConeGeometry(0.26, 0.75, 24), mat, 0, 0.39); cone.rotation.z = 0.12; g.add(cone);
    return g;
  },
  chef() {
    const g = new THREE.Group(), white = std(0xffffff, { roughness: 0.8 });
    g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 24), white, 0, 0.1));
    for (const [x, z] of [[0, 0], [0.12, 0.05], [-0.12, 0.05], [0, -0.12], [0.06, 0.12]]) g.add(mesh(new THREE.SphereGeometry(0.16, 12, 10), white, x, 0.3, z));
    return g;
  },
  halo() {
    const g = new THREE.Group();
    const ring = mesh(new THREE.TorusGeometry(0.24, 0.035, 10, 32), new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffd23f, emissiveIntensity: 1.2 }), 0, 0.22);
    ring.rotation.x = Math.PI / 2; ring.name = 'bob'; g.add(ring);
    return g;
  },
  cone() {
    const g = new THREE.Group(), orange = std(0xff6a13);
    g.add(mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), orange, 0, 0.02));
    g.add(mesh(new THREE.ConeGeometry(0.2, 0.5, 24), orange, 0, 0.29));
    g.add(mesh(new THREE.CylinderGeometry(0.115, 0.145, 0.08, 24), std(0xffffff), 0, 0.26));
    return g;
  },
  santa() {
    const g = new THREE.Group();
    const cone = mesh(new THREE.ConeGeometry(0.24, 0.48, 24), std(0xd4202c), 0, 0.26); cone.rotation.z = 0.35; g.add(cone);
    const band = mesh(new THREE.TorusGeometry(0.24, 0.06, 10, 28), std(0xffffff, { roughness: 0.9 }), 0, 0.04); band.rotation.x = Math.PI / 2; g.add(band);
    g.add(mesh(new THREE.SphereGeometry(0.07, 12, 8), std(0xffffff, { roughness: 0.9 }), -0.16, 0.48));
    return g;
  },
  sombrero() {
    const g = new THREE.Group(), straw = std(0xe6c36a, { roughness: 0.9 });
    g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.03, 36), straw, 0, 0.02));
    const rim = mesh(new THREE.TorusGeometry(0.6, 0.05, 8, 40), straw, 0, 0.05); rim.rotation.x = Math.PI / 2; g.add(rim);
    g.add(mesh(new THREE.ConeGeometry(0.24, 0.42, 24), straw, 0, 0.23));
    g.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.07, 24), new THREE.MeshStandardMaterial({ map: stripes('#e74c3c', '#27ae60', 10) }), 0, 0.09));
    return g;
  },
  bunny() {
    const g = new THREE.Group(), white = std(0xffffff, { roughness: 0.9 }), pink = std(0xff9fcf);
    for (const side of [-1, 1]) {
      const ear = new THREE.Group(); ear.position.set(side * 0.13, 0, 0); ear.rotation.z = -side * 0.18;
      const outer = mesh(new THREE.CapsuleGeometry(0.075, 0.38, 6, 12), white, 0, 0.26); outer.scale.set(1, 1, 0.5); ear.add(outer);
      const inner = mesh(new THREE.CapsuleGeometry(0.04, 0.3, 6, 12), pink, 0, 0.26, 0.03); inner.scale.set(1, 1, 0.4); ear.add(inner);
      g.add(ear);
    }
    return g;
  },
};

export function makeHat(id) {
  const b = BUILDERS[id];
  if (!b) return null;
  const g = b();
  g.userData.hat = id;
  return g;
}

// gentle idle animation: propellers spin, halos bob
export function animateHat(g, t) {
  const spin = g.getObjectByName('spin'); if (spin) spin.rotation.y = t * 14;
  const bob = g.getObjectByName('bob'); if (bob) bob.position.y = 0.24 + Math.sin(t * 3) * 0.04;
}
