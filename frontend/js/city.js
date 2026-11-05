// 3D regional healthcare network: depot (stock) in the centre, facilities on a ring.
import { THREE, Viewport, label, ease } from './viewport.js';

const UNIT = 0.72, GAP = 0.92, R = 8.6;
const KIND = {
  hospital: { h: 3.4, w: 2.3 }, children: { h: 2.5, w: 2.4 }, trauma: { h: 2.9, w: 2.1 },
  clinic: { h: 1.9, w: 2.0 }, rural: { h: 1.5, w: 1.9, roof: true },
};
const CRIT = 0xd03b3b;

export class CityScene {
  constructor() {
    this.vp = new Viewport({ position: [0, 19, 24], target: [0, 1.0, 0], autoRotate: true, fov: 40 });
    this.root = new THREE.Group();
    this.dyn = new THREE.Group();
    this.vp.scene.add(this.root, this.dyn);
    this.vp.scene.fog = new THREE.Fog(0x0a0d14, 30, 60);
    this.tweens = [];
    this.flows = [];
    this.vp.updaters.push((dt, t) => this._tick(dt, t));
    this._ground();
  }

  mount(host) { this.vp.mount(host); }

  _ground() {
    const disk = new THREE.Mesh(new THREE.CircleGeometry(13.5, 96),
      new THREE.MeshStandardMaterial({ color: 0x0f1320, roughness: 0.9, metalness: 0.1 }));
    disk.rotation.x = -Math.PI / 2;
    this.vp.scene.add(disk);
    const polar = new THREE.PolarGridHelper(13.5, 12, 6, 96, 0x2a3346, 0x1c2333);
    polar.position.y = 0.01;
    this.vp.scene.add(polar);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(13.5, 0.05, 8, 160),
      new THREE.MeshBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.5 }));
    ring.rotation.x = Math.PI / 2;
    this.vp.scene.add(ring);

    // depot / hybrid optimiser core
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.6, 6),
      new THREE.MeshStandardMaterial({ color: 0x1b2233, metalness: 0.5, roughness: 0.4 }));
    base.position.y = 0.3;
    this.vp.scene.add(base);
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1),
      new THREE.MeshBasicMaterial({ color: 0xa58bff, wireframe: true, transparent: true, opacity: 0.85 }));
    this.core.position.y = 2.1;
    this.coreGlow = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.55 }));
    this.coreGlow.position.y = 2.1;
    const orbit = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.025, 8, 80),
      new THREE.MeshBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.6 }));
    orbit.position.y = 2.1;
    orbit.rotation.x = Math.PI / 2.4;
    this.orbit = orbit;
    this.vp.scene.add(this.core, this.coreGlow, orbit);
    this.depotLabel = label('<b>Regional stock</b><small>hybrid optimiser</small>');
    this.depotLabel.position.set(0, 3.6, 0);
    this.vp.scene.add(this.depotLabel);
  }

  setScenario(sc) {
    this.sc = sc;
    this.vp.clearGroup(this.root);
    this.vp.clearGroup(this.dyn);
    this.tweens = [];
    this.flows = [];
    const F = sc.facilities.length;
    this.slots = [];
    this.facLabels = [];
    sc.facilities.forEach((f, i) => {
      const ang = -Math.PI / 2 + (i / F) * Math.PI * 2 + (F % 2 ? 0 : Math.PI / F);
      const pos = new THREE.Vector3(Math.cos(ang) * R, 0, Math.sin(ang) * R);
      const k = KIND[f.kind] || KIND.hospital;
      const g = new THREE.Group();
      g.position.copy(pos);
      g.lookAt(0, 0, 0);
      const body = new THREE.Mesh(new THREE.BoxGeometry(k.w, k.h, k.w),
        new THREE.MeshStandardMaterial({ color: 0x34405a, metalness: 0.25, roughness: 0.6 }));
      body.position.y = k.h / 2;
      g.add(body);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry),
        new THREE.LineBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.55 }));
      edges.position.copy(body.position);
      g.add(edges);
      // window strips
      for (let y = 0.6; y < k.h - 0.3; y += 0.55) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(k.w * 0.8, 0.12, 0.02),
          new THREE.MeshBasicMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.35 + 0.25 * Math.random() }));
        win.position.set(0, y, k.w / 2 + 0.011);
        g.add(win);
      }
      if (k.roof) {
        const roof = new THREE.Mesh(new THREE.ConeGeometry(k.w * 0.78, 0.9, 4),
          new THREE.MeshStandardMaterial({ color: 0x283149, roughness: 0.7 }));
        roof.position.y = k.h + 0.45;
        roof.rotation.y = Math.PI / 4;
        g.add(roof);
      }
      // healthcare cross
      const crossMat = new THREE.MeshBasicMaterial({ color: 0xeef1f6 });
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.03), crossMat);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.03), crossMat);
      [c1, c2].forEach((c) => { c.position.set(0, k.h - 0.45, k.w / 2 + 0.03); g.add(c); });
      this.root.add(g);

      // unit stack between building and depot
      const dir = pos.clone().normalize();
      const stackPos = pos.clone().sub(dir.clone().multiplyScalar(k.w / 2 + 1.0));
      const slotsY = [0, 1, 2].map((s) => 0.45 + s * GAP);
      this.slots.push({ base: stackPos, y: slotsY, kind: k, pos });
      // demand ghosts
      for (let s = 0; s < f.demand; s++) {
        const ghost = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(UNIT, UNIT, UNIT)),
          new THREE.LineBasicMaterial({ color: 0xeef1f6, transparent: true, opacity: 0.4 }));
        ghost.position.set(stackPos.x, slotsY[s], stackPos.z);
        this.root.add(ghost);
      }
      // capacity ceiling
      const capY = f.capacity === 0 ? 0.05 : slotsY[f.capacity - 1] + UNIT / 2 + 0.06;
      const cap = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25),
        new THREE.MeshBasicMaterial({ color: CRIT, transparent: true, opacity: 0.32, side: THREE.DoubleSide }));
      cap.rotation.x = -Math.PI / 2;
      cap.position.set(stackPos.x, capY, stackPos.z);
      const capEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.25, 1.25)),
        new THREE.LineBasicMaterial({ color: CRIT }));
      capEdge.rotation.x = -Math.PI / 2;
      capEdge.position.copy(cap.position);
      this.root.add(cap, capEdge);
      // pad
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 32),
        new THREE.MeshStandardMaterial({ color: 0x232a3b }));
      pad.position.set(stackPos.x, 0.03, stackPos.z);
      this.root.add(pad);

      const lb = label('');
      lb.position.set(pos.x, k.h + (k.roof ? 1.6 : 1.0), pos.z);
      this.root.add(lb);
      this.facLabels.push(lb);
    });
    this._labels(null);
    this._stock(sc.supply);
  }

}
