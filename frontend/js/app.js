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
function showEvo(i) {
  const ev = S.qaoa?.evolution; if (!ev) return;
  ising.setBloch(ev[i].bloch);
  $('#evo-label').textContent = `${i}/${ev.length - 1} · ${ev[i].label} · ⟨H_C⟩ = ${fmt(ev[i].exp, 2)}`;
}
$('#evo-step').addEventListener('input', (e) => showEvo(+e.target.value));
let evoTimer = null;
$('#evo-play').addEventListener('click', () => {
  if (!S.qaoa) return toast('Run QAOA first (step 4).');
  if (evoTimer) { clearInterval(evoTimer); evoTimer = null; $('#evo-play').textContent = '▶'; return; }
  let i = 0; showEvo(0); $('#evo-step').value = 0; $('#evo-play').textContent = '❚❚';
  evoTimer = setInterval(() => {
    i++;
    if (i >= S.qaoa.evolution.length) { clearInterval(evoTimer); evoTimer = null; $('#evo-play').textContent = '▶'; return; }
    $('#evo-step').value = i; showEvo(i);
  }, 1100);
});
$('#q-qasm').addEventListener('click', () => {
  const q = S.qaoa?.circuit?.qasm; if (!q) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([q], { type: 'text/plain' }));
  a.download = `qaoa_p${S.qaoa.p}_${S.model.n_qubits}q.qasm`;
  a.click();
  URL.revokeObjectURL(a.href);
});

/* --------------------------------------------------------------- results */
function solverResults() {
  const out = {};
  if (S.qaoa) {
    out.qaoa = { sol: S.qaoa.solution, rt: S.qaoa.runtime_ms, note: `P_opt ${pct(S.qaoa.sampled.p_opt_alloc, 2)} · feasible shots ${pct(S.qaoa.sampled.feasibility_rate)}` };
    if (S.qaoa.noisy) out.qaoan = { sol: S.qaoa.noisy.best_measured, rt: S.qaoa.runtime_ms + S.qaoa.noisy.runtime_ms, note: `P_opt ${pct(S.qaoa.noisy.p_opt_alloc, 2)} · feasible shots ${pct(S.qaoa.noisy.feasibility_rate)}` };
  }
  if (S.sa) out.sa = { sol: S.sa.solution, rt: S.sa.runtime_ms, note: 'best of 12 restarts' };
  if (S.greedy) out.greedy = { sol: S.greedy.solution, rt: S.greedy.runtime_ms, note: 'priority/cost rule' };
  if (S.exact) out.exact = { sol: S.exact.solution, rt: S.exact.runtime_ms, note: `${S.exact.n_states.toLocaleString()} states enumerated` };
  return out;
}
function renderResults() {
  const R = solverResults();
  const keys = ORDER.filter((k) => R[k]);
  if (!keys.includes(S.sel)) S.sel = keys.includes('qaoa') ? 'qaoa' : 'exact';
  $('#solver-pick').innerHTML = keys.map((k) => `<button class="btn small ${k === S.sel ? 'on' : ''}" data-s="${k}"><span class="swatch" style="background:${SOLVERS[k].color}"></span>${SOLVERS[k].name}</button>`).join('') +
    (R.sa ? '' : `<button class="btn small" id="run-sa">+ run simulated annealing</button>`);
  $$('#solver-pick [data-s]').forEach((b) => b.addEventListener('click', () => { S.sel = b.dataset.s; renderResults(); showSolver(S.sel); }));
  $('#run-sa')?.addEventListener('click', runSA);
  if (!keys.length) return;
  const sc = S.scenario;
  barChart($('#ch-alloc'), {
    categories: sc.facilities.map((f) => f.name),
    series: keys.map((k) => ({ name: SOLVERS[k].name, color: SOLVERS[k].color, values: R[k].sol.alloc })),
    refs: { values: sc.facilities.map((f) => f.demand) }, yMax: 3, ticks: 3, yFormat: (v) => fmt(v, 0), unit: ' units', height: 210,
  });
  const opt = S.exact?.optimum;
  $('#cmp-table').innerHTML = `<tr><th>Solver</th><th>Allocation</th><th>Objective</th><th>Gap</th><th>r</th><th>Constraints</th><th>Status</th><th>Runtime</th><th>Notes</th></tr>` +
    keys.map((k) => {
      const s = R[k].sol;
      return `<tr><td><span class="swatch" style="background:${SOLVERS[k].color}"></span>${SOLVERS[k].name}</td>
        <td class="mono">[${s.alloc.join(', ')}]</td><td>${fmt(s.objective, 2)}</td>
        <td>${s.gap_pct !== undefined ? fmt(s.gap_pct, 1) + '%' : '—'}</td><td>${s.approx_ratio !== undefined ? fmt(s.approx_ratio, 3) : '—'}</td>
        <td>${s.constraints_satisfied}/${s.constraints_total}</td><td>${statusHTML(s.feasible)}</td>
        <td>${fmt(R[k].rt, 1)} ms</td><td class="muted" style="text-align:left">${R[k].note}</td></tr>`;
    }).join('') + (opt !== undefined ? `<tr><td class="muted" colspan="9" style="text-align:left">C<sub>opt</sub> = ${fmt(opt, 3)} (exact enumeration of the original constrained problem)</td></tr>` : '');
}
function showSolver(k) {
  const R = solverResults();
  if (!R[k]) { city.setAllocation(null); return; }
  const s = R[k].sol, sc = S.scenario;
  city.setAllocation(s.alloc, SOLVERS[k].color, { animate: true });
  city.pulse();
  $('#res-ov-title').textContent = `${SOLVERS[k].name}: ${s.total_allocated}/${sc.supply} units allocated`;
  $('#res-ov-sub').innerHTML = `objective ${fmt(s.objective, 2)} · Jain fairness ${fmt(s.jain_fairness, 3)} · ${s.feasible ? 'all constraints met' : 'constraint violated'}`;
  $('#res-title').innerHTML = `Constraint check: ${SOLVERS[k].name} ${statusHTML(s.feasible)}`;
  const rows = s.checks.map((c) => `<tr><td>${c.type.replace('_', ' ')}</td><td style="text-align:left">${esc(c.facility)}</td><td class="mono">${c.detail}</td><td>${statusHTML(c.ok, 'met', 'violated')}</td></tr>`).join('');
  const parts = sc.facilities.map((f, i) => `<tr><td style="text-align:left">${esc(f.name)}</td><td>${s.alloc[i]}</td><td>${s.alloc_amount[i]}</td><td>${f.demand}</td><td>${f.demand ? pct(s.alloc[i] / f.demand, 0) : '—'}</td></tr>`).join('');
  $('#res-checks').innerHTML = `<div class="table-wrap"><table class="data compact"><tr><th>Facility</th><th>Units</th><th>${esc(sc.unit_label)}</th><th>Demand</th><th>Coverage</th></tr>${parts}</table></div>
    <div class="hr"></div><div class="table-wrap"><table class="data compact"><tr><th>Constraint</th><th style="text-align:left">Scope</th><th>Check</th><th>Status</th></tr>${rows}</table></div>
    <p class="small muted" style="margin-top:8px">bit-string <span class="mono">${s.bitstring}</span> (q${S.model.n_qubits - 1}…q0) · QUBO energy ${fmt(s.energy, 2)}</p>`;
}
async function runSA() {
  try { S.sa = await api('/api/solve/sa', { scenario: S.scenario, seed: 0 }); renderResults(); }
  catch (e) { toast(e.message, true); }
}

/* -------------------------------------------------------------- benchmark */
async function runBenchmark() {
  const ps = $$('#b-p button.on').map((b) => +b.dataset.v);
  if (!ps.length) return toast('Select at least one QAOA depth.', true);
  const n = +$('#b-seeds').value;
  const P = qaoaParams();
  $('#b-run').disabled = true;
  $('#b-status').textContent = `running ${n} seed(s) × ${ps.length} depth(s)${$('#b-noise').checked ? ' × (ideal + noisy)' : ''}…`;
  try {
    S.bench = await api('/api/benchmark', { scenario: S.scenario, seeds: [...Array(n).keys()], p_list: ps, shots: 1024, objective: P.objective, alpha: P.alpha, noise: { ...P.noise, enabled: $('#b-noise').checked } });
    renderBench();
    markDone(6);
    $('#b-status').textContent = `done in ${fmt(S.bench.total_ms / 1000, 1)} s`;
  } catch (e) { toast(e.message, true); $('#b-status').textContent = ''; }
  finally { $('#b-run').disabled = false; }
}
$('#b-run').addEventListener('click', runBenchmark);

function rowColor(key) {
  if (key === 'exact') return SOLVERS.exact.color;
  if (key === 'greedy') return SOLVERS.greedy.color;
  if (key === 'sa') return SOLVERS.sa.color;
  return key.endsWith('n') ? SOLVERS.qaoan.color : SOLVERS.qaoa.color;
}
function renderBench() {
  const B = S.bench, rows = B.rows;
  const legendItems = [SOLVERS.qaoa, SOLVERS.qaoan, SOLVERS.sa, SOLVERS.greedy, SOLVERS.exact].filter((s) => rows.some((r) => rowColor(r.key) === s.color));
  const short = (r) => r.key === 'exact' ? 'Exact' : r.key === 'greedy' ? 'Greedy' : r.key === 'sa' ? 'SA' : `p${r.p}${r.key.endsWith('n') ? '·noisy' : ''}`;
  barChart($('#ch-ratio'), {
    categories: rows.map(short), legendItems,
    series: [{ name: 'r', names: rows.map((r) => r.solver), colors: rows.map((r) => rowColor(r.key)), values: rows.map((r) => r.approx_ratio.mean), errors: rows.map((r) => r.approx_ratio.std),
      notes: rows.map((r) => `found optimum in ${pct(r.found_optimum_rate, 0)} of runs`) }],
    yMax: 1, yFormat: (v) => fmt(v, 2), height: 230,
  });
  barChart($('#ch-time'), {
    categories: rows.map(short), legendItems,
    series: [{ name: 'ms', names: rows.map((r) => r.solver), colors: rows.map((r) => rowColor(r.key)), values: rows.map((r) => r.runtime_ms.mean), errors: rows.map((r) => r.runtime_ms.std) }],
    yFormat: (v) => fmt(v, 0), unit: ' ms', height: 230,
  });
  const q = rows.filter((r) => r.key.startsWith('qaoa') && !r.key.endsWith('n'));
  const qn = rows.filter((r) => r.key.endsWith('n'));
  const uniformFeas = S.exact ? S.exact.n_feasible_states / S.exact.n_states : null;
  const xs = q.map((r) => r.p);
  const feasSeries = [{ name: 'QAOA ideal', color: SOLVERS.qaoa.color, points: q.map((r) => [r.p, r.feasibility_rate.mean]) }];
  if (qn.length) feasSeries.push({ name: 'QAOA noisy', color: SOLVERS.qaoan.color, points: qn.map((r) => [r.p, r.feasibility_rate.mean]) });
  if (uniformFeas !== null) feasSeries.push({ name: 'uniform random', color: MUTED, dashed: true, markers: false, points: xs.map((p) => [p, uniformFeas]) });
  lineChart($('#ch-feas'), { series: feasSeries, xLabel: 'QAOA depth p', xTicks: xs, yFormat: (v) => pct(v, 0), yMin: 0, height: 220 });
  const poptSeries = [{ name: 'QAOA ideal', color: SOLVERS.qaoa.color, points: q.map((r) => [r.p, r.p_opt.mean]) }];
  if (qn.length) poptSeries.push({ name: 'QAOA noisy', color: SOLVERS.qaoan.color, points: qn.map((r) => [r.p, r.p_opt.mean]) });
  if (S.model) poptSeries.push({ name: 'uniform random', color: MUTED, dashed: true, markers: false, points: xs.map((p) => [p, Math.pow(2, S.model.n_slack) / S.model.hilbert_dim]) });
  lineChart($('#ch-popt'), { series: poptSeries, xLabel: 'QAOA depth p', xTicks: xs, yFormat: (v) => pct(v, 2), yMin: 0, height: 220 });
  const dSeries = [{ name: 'all-to-all', color: '#3987e5', points: q.map((r) => [r.p, r.depth]) }];
  if (q[0] && q[0].depth_linear) dSeries.push({ name: 'linear chain', color: '#9085e9', points: q.map((r) => [r.p, r.depth_linear]) });
  lineChart($('#ch-depth'), { series: dSeries, xLabel: 'QAOA depth p', xTicks: xs, yFormat: (v) => fmt(v, 0), yMin: 0, height: 220 });
  const sc = B.scaling;
  lineChart($('#ch-scale'), {
    series: [{ name: 'qubits needed', color: '#3987e5', points: sc.map((s) => [s.facilities, s.qubits]) },
      { name: 'exact-simulation limit (16)', color: MUTED, dashed: true, markers: false, points: sc.map((s) => [s.facilities, 16]) }],
    xLabel: 'facilities', yFormat: (v) => fmt(v, 0), yMin: 0, height: 220,
  });
  $('#b-table').innerHTML = `<tr><th>Solver</th><th>Objective (mean ± std)</th><th>r</th><th>Gap</th><th>Optimum found</th><th>Feasible shots</th><th>P<sub>opt</sub></th><th>Runtime</th><th>Qubits</th><th>Depth (a2a / linear)</th><th>CX (a2a / linear)</th></tr>` +
    rows.map((r) => `<tr><td><span class="swatch" style="background:${rowColor(r.key)}"></span>${r.solver}</td>
      <td>${fmt(r.objective.mean, 2)} ± ${fmt(r.objective.std, 2)}</td><td>${fmt(r.approx_ratio.mean, 3)}</td><td>${r.gap_pct.mean !== null ? fmt(r.gap_pct.mean, 1) + '%' : '—'}</td>
      <td>${pct(r.found_optimum_rate, 0)}</td><td>${r.feasibility_rate ? pct(r.feasibility_rate.mean) : '—'}</td><td>${r.p_opt ? pct(r.p_opt.mean, 2) : '—'}</td>
      <td>${fmt(r.runtime_ms.mean, 1)} ms</td><td>${r.qubits ?? '—'}</td><td>${r.depth ? `${r.depth} / ${r.depth_linear ?? '—'}` : '—'}</td><td>${r.cx ? `${r.cx} / ${r.cx_linear ?? '—'}` : '—'}</td></tr>`).join('') +
    `<tr><td colspan="11" class="muted" style="text-align:left">Seeds ${B.seeds.join(', ')} · C<sub>opt</sub> = ${fmt(B.optimum, 3)} · ${B.n_qubits} qubits · formulation ${B.formulation_valid ? 'valid ✓' : 'INVALID ✕'}</td></tr>`;
}

/* ---------------------------------------------------------- full pipeline */
async function runAll() {
  if (S.busy) return;
  S.busy = true;
  const btn = $('#run-all'); btn.disabled = true;
  try {
    setStage(1); await sleep(1600);
    setStage(2); markDone(1); await sleep(1600);
    setStage(3); markDone(2); await sleep(1600);
    markDone(3);
    setStage(4);
    await runQAOA();
    await sleep(500);
    $('#evo-play').click();
    if (!S.sa) await runSA();
    await sleep(2500);
    if (evoTimer) { clearInterval(evoTimer); evoTimer = null; $('#evo-play').textContent = '▶'; }
    S.sel = 'qaoa';
    setStage(5); markDone(5);
    renderResults();
    toast('Pipeline complete. Open step 6 to run the multi-seed benchmark.');
  } finally { S.busy = false; btn.disabled = false; }
}
$('#run-all').addEventListener('click', runAll);

/* ------------------------------------------------------------------ boot */
