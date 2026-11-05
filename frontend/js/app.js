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
function renderScenarioForm() {
  const sc = S.scenario;
  $('#sc-resource').value = sc.resource;
  $('#sc-unit').value = sc.unit_size;
  $('#sc-supply').value = sc.supply;
  $('#sc-unitlabel').value = sc.unit_label;
  const tb = $('#fac-table tbody');
  tb.innerHTML = sc.facilities.map((f, i) => `<tr>
    <td><input type="text" data-f="${i}" data-k="name" value="${esc(f.name)}"></td>
    <td><input type="number" data-f="${i}" data-k="demand" min="0" max="3" value="${f.demand}"></td>
    <td><input type="number" data-f="${i}" data-k="capacity" min="0" max="3" value="${f.capacity}"></td>
    <td><input type="number" data-f="${i}" data-k="cost" min="0" max="20" step="0.1" value="${f.cost}"></td>
    <td><input type="number" data-f="${i}" data-k="priority" min="0" max="10" step="0.5" value="${f.priority}"></td>
    <td><input type="number" data-f="${i}" data-k="min_service" min="0" max="3" value="${f.min_service}"></td>
    <td><button class="btn small" data-del="${i}" title="Remove facility" aria-label="Remove ${esc(f.name)}" ${sc.facilities.length <= 2 ? 'disabled' : ''}>✕</button></td></tr>`).join('');
  ['capacity', 'demand', 'fairness', 'min_service'].forEach((k) => {
    $(`#lam-${k}`).value = sc.lambdas[k];
    $(`#lam-${k}-v`).textContent = (+sc.lambdas[k]).toFixed(1);
  });
}
const onScenarioChange = debounce(() => refreshModel(), 350);
$('#fac-table').addEventListener('input', (e) => {
  const t = e.target; if (!t.dataset.k) return;
  const f = S.scenario.facilities[+t.dataset.f];
  f[t.dataset.k] = t.type === 'number' ? clampNum(t) : t.value;
  onScenarioChange();
});
$('#fac-table').addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  S.scenario.facilities.splice(+b.dataset.del, 1);
  renderScenarioForm(); refreshModel();
});
$('#fac-add').addEventListener('click', () => {
  if (S.scenario.facilities.length >= 6) return toast('At most 6 facilities: the statevector limit is 16 qubits.', true);
  S.scenario.facilities.push({ name: `Facility ${S.scenario.facilities.length + 1}`, kind: 'clinic', demand: 2, capacity: 2, cost: 1.2, priority: 2, min_service: 0 });
  renderScenarioForm(); refreshModel();
});
for (const [id, k] of [['#sc-resource', 'resource'], ['#sc-unit', 'unit_size'], ['#sc-supply', 'supply'], ['#sc-unitlabel', 'unit_label']]) {
  $(id).addEventListener('input', (e) => { S.scenario[k] = e.target.type === 'number' ? clampNum(e.target) : e.target.value; onScenarioChange(); });
}
['capacity', 'demand', 'fairness', 'min_service'].forEach((k) => {
  $(`#lam-${k}`).addEventListener('input', (e) => {
    S.scenario.lambdas[k] = +e.target.value;
    $(`#lam-${k}-v`).textContent = (+e.target.value).toFixed(1);
    onScenarioChange();
  });
});
$('#lam-auto').addEventListener('click', async () => {
  const s = S.model?.suggested; if (!s) return;
  S.scenario.lambdas.capacity = Math.min(80, s.capacity);
  S.scenario.lambdas.min_service = Math.min(80, s.min_service);
  renderScenarioForm(); await refreshModel();
  toast(`Hard penalties set to ${s.capacity}: larger than the objective's maximum swing (${fmt(s.objective_swing, 1)}).`);
});
function clampNum(t) {
  let v = +t.value; if (Number.isNaN(v)) v = 0;
  if (t.min !== '') v = Math.max(+t.min, v);
  if (t.max !== '') v = Math.min(+t.max, v);
  return v;
}

/* ------------------------------------------------------------- model/QUBO */
async function refreshModel() {
  try {
    const m = await api('/api/model', S.scenario);
    S.model = m;
    S.exact = S.greedy = S.sa = S.qaoa = null;
    S.bench = null;
    renderModel();
    city.setScenario(S.scenario);
    ising.setModel(m, S.scenario);
    resetQAOAView();
    S.exact = await api('/api/solve/exact', S.scenario);
    S.greedy = await api('/api/solve/greedy', S.scenario);
    renderValidity();
    renderOverview();
    renderResults();
    if (CITY_HOST[S.stage]) setStage(S.stage);
  } catch (e) {
    toast(e.message, true);
    $('#sc-size').textContent = e.message;
  }
}

function renderOverview() {
  const sc = S.scenario, m = S.model, ex = S.exact;
  const D = sc.facilities.reduce((a, f) => a + f.demand, 0);
  $('#ov-title').textContent = sc.name;
  $('#ov-sub').textContent = sc.description || '';
  const tiles = [
    kpi('Stock vs demand', `${sc.supply} / ${D}`, `${sc.supply * sc.unit_size} ${esc(sc.unit_label)} for ${D * sc.unit_size} requested`),
    kpi('Facilities', sc.facilities.length, esc(sc.resource)),
    kpi('Qubits', m.n_qubits, `${m.n_facility_qubits} allocation + ${m.n_slack} slack`),
    kpi('Search space', (m.hilbert_dim).toLocaleString(), 'bit-strings (2ⁿ)'),
  ];
  if (ex) tiles.push(kpi('Feasible plans', ex.n_feasible_allocations, `of ${Math.pow(4, sc.facilities.length)} allocations`));
  $('#ov-kpis').innerHTML = tiles.join('');
  $('#sc-kpis').innerHTML = tiles.join('');
  $('#sc-size').textContent = `${m.n_qubits} qubits · ${m.hilbert_dim.toLocaleString()} states`;
}

function renderModel() {
  const m = S.model;
  $('#qubo-sub').textContent = `${m.n_qubits}×${m.n_qubits} · constant ${fmt(m.const, 2)} · build ${fmt(m.build_ms, 1)} ms`;
  const groups = [];
  for (let f = 0; f < m.n_facility_qubits / 2; f++) groups.push([2 * f, 2 * f + 2]);
  if (m.n_slack) groups.push([m.n_facility_qubits, m.n_qubits]);
  heatmap($('#qubo-canvas'), m.Q, m.labels, groups);
  $('#register').innerHTML = m.labels.map((l, i) => {
    const owner = m.qubit_owner[i];
    const nm = owner >= 0 ? S.scenario.facilities[owner].name : 'stock slack';
    return `<span class="qchip ${owner < 0 ? 'slack' : ''}" title="${esc(nm)}">q${i} ${l}</span>`;
  }).join('');
  const names = { cost: 'H_cost', capacity: 'λ₁ H_capacity', demand: 'λ₂ H_demand', fairness: 'λ₃ H_fairness', min_service: 'λ₄ H_min' };
  $('#terms-table').innerHTML = `<tr><th>Term</th><th>Linear</th><th>Quadratic</th></tr>` +
    Object.entries(m.components).map(([k, c]) => `<tr><td>${names[k]}</td><td>${c.linear}</td><td>${c.quadratic}</td></tr>`).join('');
  $('#lam-hint').innerHTML = `Recommended hard penalty ≥ <b>${fmt(m.suggested.capacity, 1)}</b>, which exceeds the objective's maximum swing of ${fmt(m.suggested.objective_swing, 1)}. Penalties that are too small give infeasible ground states; penalties that are too large flatten the landscape QAOA has to search.`;
  // Ising KPIs
  $('#ising-kpis').innerHTML = [
    kpi('Z terms', m.h.filter((h) => Math.abs(h) > 1e-12).length, 'local fields h_i'),
    kpi('ZZ terms', m.J_edges.length, `→ ${2 * m.J_edges.length} CNOT / layer`),
    kpi('Offset', fmt(m.offset, 1), 'constant energy'),
    kpi('max |h|, |J|', fmt(m.max_abs_coef, 2), 'normalises γ'),
  ].join('');
}

function renderValidity() {
  const b = $('#valid-badge'); const ex = S.exact;
  if (!ex) return;
  b.className = 'badge ' + (ex.formulation_valid ? 'ok' : 'no');
  b.innerHTML = ex.formulation_valid ? '✓ QUBO ground state = feasible optimum' : '✕ QUBO ground state is infeasible: increase λ₁/λ₄';
}

/* ------------------------------------------------------------------ QAOA */
['q-p', 'q-alpha', 'q-e1', 'q-e2', 'q-ro'].forEach((id) => {
  const inp = $('#' + id);
  inp.addEventListener('input', () => { $(`#${id}-v`).textContent = id === 'q-p' ? inp.value : (+inp.value).toFixed(id === 'q-alpha' ? 2 : 3); });
});
function qaoaParams() {
  return {
    p: +$('#q-p').value, objective: seg('q-obj'), alpha: +$('#q-alpha').value, init: seg('q-init'),
    optimizer: $('#q-opt').value, shots: +$('#q-shots').value, restarts: 2,
    noise: { enabled: $('#q-noise').checked, e1: +$('#q-e1').value, e2: +$('#q-e2').value, readout: +$('#q-ro').value, trajectories: 64 },
  };
}
function resetQAOAView() {
  $('#q-kpis').innerHTML = '<div class="muted small">No run yet.</div>';
  $('#q-verify').innerHTML = '';
  $('#q-circ').innerHTML = '';
  $('#ch-conv').innerHTML = '';
  $('#q-qasm').disabled = true;
  $('#evo-step').max = 0; $('#evo-label').textContent = 'Run QAOA (step 4) to animate';
  circuitSVG($('#circ-svg'), S.model, +$('#q-p').value);
  $('#circ-sub').textContent = `${S.model.n_qubits} qubits · repeated p times`;
}

async function ensureLandscape(objective, alpha) {
  const key = JSON.stringify([S.scenario, objective, alpha]);
  if (S.landKey === key) return;
  $('#land-busy').classList.add('on');
  try {
    S.landscape = await api('/api/landscape', { scenario: S.scenario, resolution: 40, objective, alpha });
    S.landKey = key;
    land.setLandscape(S.landscape);
    $('#land-legend').innerHTML = `${objective === 'cvar' ? 'CVaR<sub>α</sub>' : '⟨H<sub>C</sub>⟩'} from ${fmt(S.landscape.min, 1)} to ${fmt(S.landscape.max, 1)} · ground energy ${fmt(S.landscape.e_ground, 1)}`;
  } finally { $('#land-busy').classList.remove('on'); }
}

async function runQAOA() {
  const P = qaoaParams();
  $('#q-run').disabled = true;
  $('#q-status').textContent = 'optimising γ, β on the simulator…';
  try {
    const landP = ensureLandscape(P.objective, P.alpha);
    const r = await api('/api/solve/qaoa', { scenario: S.scenario, ...P });
    await landP;
    S.qaoa = r;
    land.setPath(r.trace);
    renderQAOA();
    renderResults();
    markDone(4);
    $('#q-status').textContent = `done in ${fmt(r.runtime_ms / 1000, 2)} s`;
  } catch (e) { toast(e.message, true); $('#q-status').textContent = ''; }
  finally { $('#q-run').disabled = false; }
}
$('#q-run').addEventListener('click', runQAOA);

function renderQAOA() {
  const r = S.qaoa, id = r.ideal, sm = r.sampled;
  const tiles = [
    kpi('⟨H<sub>C</sub>⟩', fmt(id.expectation, 1), `uniform ${fmt(id.uniform_expectation, 0)} · ground ${fmt(id.ground_energy, 1)}`),
    kpi('P<sub>opt</sub> (ideal)', pct(id.p_opt_alloc_exact, 2), `${fmt(id.amplification_opt, 1)}× over uniform`),
    kpi('Feasible mass', pct(id.feasible_mass), `${fmt(id.amplification_feasible, 2)}× over uniform ${pct(id.uniform_feasible)}`),
    kpi('Best measured', fmt(r.solution.objective, 2), `${r.solution.feasible ? 'feasible' : 'infeasible'} · gap ${r.solution.gap_pct !== undefined ? fmt(r.solution.gap_pct, 1) + '%' : '—'}`),
    kpi('Circuit evals', r.evaluations, `${r.optimizer} · ${fmt(r.optimize_ms, 0)} ms`),
  ];
  if (r.noisy) tiles.push(kpi('Noisy feasible shots', pct(r.noisy.feasibility_rate), `ideal ${pct(sm.feasibility_rate)} · F≈${fmt(r.noisy.est_fidelity, 3)}`));
  $('#q-kpis').innerHTML = tiles.join('');
  const qc = r.qiskit_check;
  $('#q-verify').innerHTML = qc
    ? `<span class="badge ok">✓ Verified against Qiskit Statevector</span> <span class="small muted">fidelity ${qc.fidelity.toFixed(9)} · max |Δp| ${qc.max_prob_diff.toExponential(1)}</span>`
    : '<span class="badge">Qiskit not installed: analytic resource estimates</span>';
  const c = r.circuit, tr = c.transpiled;
  $('#q-circ').innerHTML = `<tr><th>Connectivity</th><th>Depth</th><th>CX</th><th>Total gates</th></tr>` +
    (tr ? `<tr><td>All-to-all</td><td>${tr.all_to_all.depth}</td><td>${tr.all_to_all.cx}</td><td>${tr.all_to_all.size}</td></tr>
           <tr><td>Linear chain (SWAPs)</td><td>${tr.linear.depth}</td><td>${tr.linear.cx}</td><td>${tr.linear.size}</td></tr>` :
      `<tr><td>Analytic</td><td>${c.analytic.depth}</td><td>${c.analytic.cx}</td><td>—</td></tr>`) +
    `<tr><td class="muted">Qubits · p</td><td colspan="3">${c.n_qubits} · ${c.p}</td></tr>`;
  $('#q-qasm').disabled = !c.qasm;
  // convergence
  const trc = r.trace;
  const series = [{ name: r.objective === 'cvar' ? `CVaR α=${r.alpha}` : '⟨H_C⟩', color: SOLVERS.qaoa.color, points: trc.map((t, i) => [i, t.v]), markers: false }];
  if (r.objective === 'cvar') series.push({ name: '⟨H_C⟩', color: MUTED, dashed: true, points: trc.map((t, i) => [i, t.exp]), markers: false });
  lineChart($('#ch-conv'), { series, xLabel: 'evaluation', yFormat: (v) => fmt(v, 0), yMin: Math.floor(Math.min(...trc.map((t) => Math.min(t.v, t.exp))) / 10) * 10, height: 200 });
  circuitSVG($('#circ-svg'), S.model, r.p, r.gammas, r.betas);
  $('#circ-sub').textContent = `γ = [${r.gammas.map((g) => g.toFixed(2)).join(', ')}] · β = [${r.betas.map((b) => b.toFixed(2)).join(', ')}]`;
  // skyline
  const rows = [{ name: 'Ideal', color: SOLVERS.qaoa.color, dist: sm.distribution }];
  if (r.noisy) rows.push({ name: 'Noisy', color: SOLVERS.qaoan.color, dist: r.noisy.distribution });
  sky.setData(rows, S.scenario, S.exact.solution.alloc);
  $('#sky-legend').innerHTML = rows.map((x) => `<span class="swatch" style="background:${x.color}"></span>${x.name}`).join(' &nbsp; ');
  // evolution
  const ev = r.evolution;
  $('#evo-step').max = ev.length - 1;
  $('#evo-step').value = ev.length - 1;
  showEvo(ev.length - 1);
}
