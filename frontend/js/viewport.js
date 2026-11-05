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

