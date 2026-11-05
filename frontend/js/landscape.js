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

}
