// 3D QAOA p=1 energy landscape surface with the optimiser's path drawn on it,
// plus the measured bit-string "skyline".
import { THREE, Viewport, label } from './viewport.js';

// sequential blue ramp (dark surface): low energy (good) = bright
const RAMP = ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];
const rampColor = (t) => {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = new THREE.Color(RAMP[i]), b = new THREE.Color(RAMP[Math.min(i + 1, RAMP.length - 1)]);
  return a.lerp(b, f);
};
export { RAMP };

const W = 12, D = 8, HMAX = 4.2;
// square-root height scale: expands the low-energy valleys the optimiser cares about
const hScale = (t) => Math.sqrt(Math.max(0, t));

export class LandscapeScene {
  constructor(tooltip) {
    this.vp = new Viewport({ position: [9, 8, 13], target: [0, 0.8, 0], fov: 42 });
    this.g = new THREE.Group();
    this.path = new THREE.Group();
    this.vp.scene.add(this.g, this.path);
    this.tooltip = tooltip;
    this.vp.onHover = (hit) => this._hover(hit);
    this.vp.updaters.push((dt, t) => this._tick(dt, t));
    this.anim = null;
  }

  mount(host) { this.vp.mount(host); }

  setLandscape(L) {
    this.L = L;
    this.vp.clearGroup(this.g);
    this.vp.clearGroup(this.path);
    this.vp.pickables = [];
    const nG = L.gammas.length, nB = L.betas.length;
    const geo = new THREE.PlaneGeometry(W, D, nG - 1, nB - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const span = L.max - L.min || 1;
    for (let b = 0; b < nB; b++) {
      for (let a = 0; a < nG; a++) {
        const idx = b * nG + a;
        const z = L.Z[a][b];
        const t = (z - L.min) / span;           // 0 = best
        pos.setY(idx, hScale(t) * HMAX);
        const c = rampColor(1 - hScale(t));
        colors.set([c.r, c.g, c.b], idx * 3);
      }
    }
    // PlaneGeometry after rotateX: x along gamma (−W/2..W/2), z along beta (−D/2..D/2) but rows go +z→−z
    // flip rows so row 0 is β_min at z = +D/2 → ok, we keep and compute mapping consistently below.
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }));
    this.g.add(mesh);
    this.vp.pickables = [mesh];
    this.mesh = mesh;
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.05 }));
    this.g.add(wire);
    // base frame + axes
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, HMAX, D)),
      new THREE.LineBasicMaterial({ color: 0x3a4254, transparent: true, opacity: 0.6 }));
    frame.position.y = HMAX / 2;
    this.g.add(frame);
    const lg = label('γ  (cost angle) →', 'label3d axis'); lg.position.set(0, -0.4, D / 2 + 0.8); this.g.add(lg);
    const lb = label('β  (mixer angle) →', 'label3d axis'); lb.position.set(W / 2 + 1.2, -0.4, 0); this.g.add(lb);
    const le = label('⟨H<sub>C</sub>⟩ ↑', 'label3d axis'); le.position.set(-W / 2 - 0.6, HMAX, -D / 2); this.g.add(le);
    for (const [txt, x] of [['0', -W / 2], ['π/2', 0], ['π', W / 2]]) {
      const l = label(txt, 'label3d axis'); l.position.set(x, -0.2, D / 2 + 0.3); this.g.add(l);
    }
    for (const [txt, z] of [['−π/2', -D / 2], ['0', 0], ['π/2', D / 2]]) {
      const l = label(txt, 'label3d axis'); l.position.set(W / 2 + 0.3, -0.2, z); this.g.add(l);
    }
    // grid minimum marker
    const m = this.toWorld(L.argmin.gamma, L.argmin.beta, L.min);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.04, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(m).add(new THREE.Vector3(0, 0.05, 0));
    this.g.add(ring);
    const lm = label('grid min', 'label3d axis'); lm.position.copy(m).add(new THREE.Vector3(0, -0.45, 0)); this.g.add(lm);
  }

  toWorld(g, b, z) {
    const L = this.L;
    const g0 = L.gammas[0], g1 = L.gammas[L.gammas.length - 1];
    const b0 = L.betas[0], b1 = L.betas[L.betas.length - 1];
    const x = ((g - g0) / (g1 - g0) - 0.5) * W;
    // PlaneGeometry rows run from +D/2 (row 0) … after rotateX(-π/2) row 0 sits at z = −D/2·(−1)… compute empirically:
    const zc = (0.5 - (b - b0) / (b1 - b0)) * D * -1;
    const y = hScale((z - L.min) / ((L.max - L.min) || 1)) * HMAX;
    return new THREE.Vector3(x, y, zc);
  }

}
