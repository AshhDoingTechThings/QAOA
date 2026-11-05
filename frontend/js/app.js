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
async function api(path, body) {
  const r = await fetch(API + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail); } catch {}
    throw new Error(msg);
  }
  return r.json();
}
let toastT;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.style.display = 'block';
  clearTimeout(toastT); toastT = setTimeout(() => (t.style.display = 'none'), err ? 6000 : 3000);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const kpi = (k, v, s = '') => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
const pct = (v, d = 1) => (v === null || v === undefined ? '—' : (100 * v).toFixed(d) + '%');
const seg = (id) => $(`#${id} button.on`)?.dataset.v;
$$('.seg').forEach((g) => g.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (g.id === 'b-p') { b.classList.toggle('on'); return; }
  g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
}));

/* ------------------------------------------------------------------ stages */
const CITY_HOST = { 0: '#host-city-0', 1: '#host-city-1', 5: '#host-city-5' };
function setStage(i) {
  S.stage = i;
  $$('.stage').forEach((s) => s.classList.toggle('active', +s.dataset.stage === i));
  $$('.step').forEach((s) => s.classList.toggle('active', +s.dataset.stage === i));
  if (CITY_HOST[i]) city.mount($(CITY_HOST[i]));
  if (i === 5) showSolver(S.sel);
  else if (CITY_HOST[i]) city.setAllocation(i === 0 && S.exact ? S.exact.solution.alloc : null, SOLVERS.exact.color, { animate: true });
  tooltip.style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  // charts size themselves to their container, so draw them once visible
  requestAnimationFrame(() => {
    if (i === 4 && S.qaoa) renderQAOA();
    if (i === 5 && S.exact) renderResults();
    if (i === 6 && S.bench) renderBench();
  });
}
$$('.step').forEach((b) => b.addEventListener('click', () => setStage(+b.dataset.stage)));
$$('#flow .node').forEach((n) => n.addEventListener('click', () => setStage(+n.dataset.go)));
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (e.key === 'ArrowRight') setStage(Math.min(6, S.stage + 1));
  if (e.key === 'ArrowLeft') setStage(Math.max(0, S.stage - 1));
});
function markDone(...ids) { ids.forEach((i) => $(`.step[data-stage="${i}"]`).classList.add('done')); }

/* ---------------------------------------------------------------- scenario */
