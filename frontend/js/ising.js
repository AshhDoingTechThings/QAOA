// 3D Ising interaction graph: each qubit a Bloch sphere, each J_ij a bond.
import { THREE, Viewport, label } from './viewport.js';

const NEG = 0x3987e5, POS = 0xe34948;

export class IsingScene {
  constructor(tooltip) {
    this.vp = new Viewport({ position: [0, 11, 14], target: [0, 0, 0], autoRotate: true, fov: 45 });
    this.vp.controls.maxPolarAngle = Math.PI;
    this.g = new THREE.Group();
    this.vp.scene.add(this.g);
    this.arrows = [];
    this.targets = [];
    this.tooltip = tooltip;
    this.vp.updaters.push((dt) => this._tick(dt));
    this.vp.onHover = (hit) => this._hover(hit);
  }

  mount(host) { this.vp.mount(host); }

  setModel(model, scenario) {
    this.vp.clearGroup(this.g);
    this.arrows = []; this.targets = []; this.vp.pickables = [];
    const n = model.n_qubits, F = model.n_facility_qubits / 2;
    const pos = [];
    for (let f = 0; f < F; f++) {
      const a = -Math.PI / 2 + (f / F) * Math.PI * 2;
      const c = new THREE.Vector3(Math.cos(a) * 6.2, 0, Math.sin(a) * 6.2);
      const t = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(1.05);
      pos.push(c.clone().sub(t), c.clone().add(t));
      const lb = label(`${escape(scenario.facilities[f].name)}`, 'label3d');
      lb.position.copy(c.clone().multiplyScalar(1.32)).setY(-1.0);
      this.g.add(lb);
    }
    for (let j = 0; j < model.n_slack; j++) {
      const a = (j / model.n_slack) * Math.PI * 2;
      pos.push(new THREE.Vector3(Math.cos(a) * 2.1, 0.0, Math.sin(a) * 2.1));
    }
    if (model.n_slack) {
      const lb = label('slack register<small>Σa + s = S</small>');
      lb.position.set(0, 1.6, 0);
      this.g.add(lb);
    }
    this.pos = pos;
    const maxJ = Math.max(1e-9, ...model.J_edges.map((e) => Math.abs(e.J)));
    const maxH = Math.max(1e-9, ...model.h.map(Math.abs));
    const up = new THREE.Vector3(0, 1, 0);
    for (const e of model.J_edges) {
      const a = pos[e.i], b = pos[e.j];
      const w = Math.abs(e.J) / maxJ;
      const len = a.distanceTo(b);
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.02 + 0.09 * w, 0.02 + 0.09 * w, len, 8, 1, true),
        new THREE.MeshBasicMaterial({ color: e.J < 0 ? NEG : POS, transparent: true, opacity: 0.18 + 0.6 * w, depthWrite: false }));
      cyl.position.copy(a).add(b).multiplyScalar(0.5);
      cyl.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
      this.g.add(cyl);
    }
    this.degree = new Array(n).fill(0);
    model.J_edges.forEach((e) => { this.degree[e.i]++; this.degree[e.j]++; });
    for (let i = 0; i < n; i++) {
      const slack = i >= model.n_facility_qubits;
      const hw = model.h[i] / maxH;
      const tint = new THREE.Color(hw < 0 ? NEG : POS).multiplyScalar(Math.abs(hw));
      const sph = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 20),
        new THREE.MeshStandardMaterial({ color: 0x1a2234, emissive: tint, emissiveIntensity: 0.7, transparent: true, opacity: 0.42, roughness: 0.2, metalness: 0.1, depthWrite: false }));
      sph.position.copy(pos[i]);
      sph.userData = { i, label: model.labels[i], h: model.h[i], slack };
      this.g.add(sph);
      this.vp.pickables.push(sph);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.012, 6, 64),
        new THREE.MeshBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: slack ? 0.25 : 0.45 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(pos[i]);
      this.g.add(ring);
      if (slack) {
        const dash = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.78, 1)),
          new THREE.LineBasicMaterial({ color: 0xa9b1c3, transparent: true, opacity: 0.25 }));
        dash.position.copy(pos[i]);
        this.g.add(dash);
      }
      const axis = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.5, 4),
        new THREE.MeshBasicMaterial({ color: 0x6f7890 }));
      axis.position.copy(pos[i]);
      this.g.add(axis);
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), pos[i], 0.62, 0xeef1f6, 0.2, 0.12);
      this.g.add(arrow);
      this.arrows.push({ arrow, cur: new THREE.Vector3(1, 0, 0), len: 1 });
      this.targets.push({ v: new THREE.Vector3(1, 0, 0), len: 1 });
      const lb = label(`q${i}`, 'label3d q');
      lb.position.copy(pos[i]).add(new THREE.Vector3(0, -0.95, 0));
      this.g.add(lb);
    }
  }

  /** bloch: array of [x, y, z] (Bloch coords) */
  setBloch(bloch) {
    bloch.forEach(([x, y, z], i) => {
      if (!this.targets[i]) return;
      const v = new THREE.Vector3(x, z, -y);
      const len = v.length();
      this.targets[i].v.copy(len > 1e-6 ? v.normalize() : new THREE.Vector3(0, 1, 0));
      this.targets[i].len = len;
    });
  }

  _tick(dt) {
    const k = 1 - Math.exp(-dt * 6);
    this.arrows.forEach((a, i) => {
      const t = this.targets[i];
      a.cur.lerp(t.v, k).normalize();
      a.len += (t.len - a.len) * k;
      a.arrow.setDirection(a.cur);
      a.arrow.setLength(Math.max(0.08, 0.62 * a.len), 0.2 * Math.max(a.len, 0.3), 0.12);
    });
  }

}
