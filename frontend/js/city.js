// 3D regional healthcare network: depot (stock) in the centre, facilities on a ring.
import { THREE, Viewport, label, ease } from './viewport.js';

const UNIT = 0.72, GAP = 0.92, R = 8.6;
const KIND = {
  hospital: { h: 3.4, w: 2.3 }, children: { h: 2.5, w: 2.4 }, trauma: { h: 2.9, w: 2.1 },
  clinic: { h: 1.9, w: 2.0 }, rural: { h: 1.5, w: 1.9, roof: true },
};
const CRIT = 0xd03b3b;

