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

}
