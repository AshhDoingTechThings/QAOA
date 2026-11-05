// QAOA Health Optimiser — UI controller.
import { CityScene, escapeHtml as esc } from './city.js';
import { IsingScene } from './ising.js';
import { LandscapeScene, SkylineScene } from './landscape.js';
import { barChart, lineChart, heatmap, circuitSVG, fmt } from './charts.js';

const API = location.protocol === 'file:' ? 'http://localhost:8000' : '';
const SOLVERS = {
  qaoa: { name: 'QAOA', color: '#3987e5' },
  qaoan: { name: 'QAOA (noisy)', color: '#d95926' },
  sa: { name: 'Simulated annealing', color: '#199e70' },
  greedy: { name: 'Rule-based greedy', color: '#c98500' },
  exact: { name: 'Exact optimum', color: '#d55181' },
};
const ORDER = ['qaoa', 'qaoan', 'sa', 'greedy', 'exact'];
const MUTED = '#898781';
const ICON_OK = '<svg width="13" height="13" viewBox="0 0 16 16"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_NO = '<svg width="13" height="13" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const statusHTML = (ok, a = 'feasible', b = 'violated') => `<span class="status ${ok ? 'ok' : 'no'}">${ok ? ICON_OK : ICON_NO}${ok ? a : b}</span>`;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const tooltip = $('#tooltip');

const S = { stage: 0, presets: {}, presetKey: 'ventilators', scenario: null, model: null, exact: null, greedy: null, sa: null, qaoa: null, landscape: null, landKey: null, bench: null, sel: 'exact', busy: false };

const city = new CityScene();
const ising = new IsingScene(tooltip);
const land = new LandscapeScene(tooltip);
const sky = new SkylineScene(tooltip);
ising.mount($('#host-ising'));
land.mount($('#host-land'));
sky.mount($('#host-sky'));

/* ---------------------------------------------------------------- helpers */
