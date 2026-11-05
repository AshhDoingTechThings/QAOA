// Shared Three.js viewport: renderer + camera + orbit controls + CSS2D labels.
// Viewports only render while their host element is on screen.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/CSS2DRenderer.js';

export { THREE, CSS2DObject };

export function label(html, cls = 'label3d') {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  return new CSS2DObject(el);
}

export class Viewport {
  constructor({ fov = 45, position = [14, 12, 16], target = [0, 0, 0], autoRotate = false, bg = null } = {}) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    if (bg) this.renderer.setClearColor(bg, 1);
    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });

    this.scene = new THREE.Scene();
    this.baseFov = fov;
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 500);
    this.camera.position.set(...position);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = autoRotate;
    this.controls.autoRotateSpeed = 0.5;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; });
    // wheel-zoom only after the user clicks into the view, so page scrolling is never hijacked
    this.controls.enableZoom = false;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 60;
    this.renderer.domElement.addEventListener('pointerdown', () => { this.controls.enableZoom = true; });
    this.renderer.domElement.addEventListener('pointerleave', () => { this.controls.enableZoom = false; });

    this.scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x101420, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(10, 18, 8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xa58bff, 0.7);
    rim.position.set(-12, 6, -10);
    this.scene.add(rim);

    this.updaters = [];
    this.clock = new THREE.Clock();
    this.host = null;
    this.visible = false;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-9, -9);
    this.pickables = [];
    this.onHover = null;
    this._loop = this._loop.bind(this);

    this.renderer.domElement.addEventListener('pointermove', (e) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this._pointerClient = [e.clientX, e.clientY];
    });
    this.renderer.domElement.addEventListener('pointerleave', () => {
      this.pointer.set(-9, -9);
      if (this.onHover) this.onHover(null);
    });

    this.ro = new ResizeObserver(() => this.resize());
    this.io = new IntersectionObserver((ents) => {
      this.visible = ents.some((e) => e.isIntersecting);
      if (this.visible) this._kick();
    });
  }

  mount(host) {
    if (this.host === host) return;
    if (this.host) { this.ro.unobserve(this.host); this.io.unobserve(this.host); }
    this.host = host;
    host.prepend(this.labels.domElement);
    host.prepend(this.renderer.domElement);
    this.ro.observe(host);
    this.io.observe(host);
    this.resize();
    this._kick();
  }

  resize() {
    if (!this.host) return;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    // portrait screens: widen the field of view so the whole scene stays in frame
    this.camera.fov = this.camera.aspect < 1 ? Math.min(this.baseFov * 1.7, this.baseFov / this.camera.aspect * 0.85) : this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  _kick() { if (!this._running) { this._running = true; requestAnimationFrame(this._loop); } }

  _loop() {
    if (!this.visible || !this.host || !this.host.offsetParent) { this._running = false; return; }
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    for (const u of this.updaters) u(dt, t);
    this.controls.update();
    if (this.onHover && this.pickables.length) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
      this.onHover(hit ? { object: hit.object, client: this._pointerClient } : null);
    }
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    requestAnimationFrame(this._loop);
  }

}
