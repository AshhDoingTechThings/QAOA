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

}
