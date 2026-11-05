// Lightweight SVG charts (bars, lines) + canvas heatmap + circuit diagram.
const NS = 'http://www.w3.org/2000/svg';
const tt = () => document.getElementById('tooltip');

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
function showTip(html, x, y) {
  const t = tt();
  t.innerHTML = html;
  t.style.display = 'block';
  const w = t.offsetWidth;
  t.style.left = Math.min(x + 14, window.innerWidth - w - 8) + 'px';
  t.style.top = y + 14 + 'px';
}
function hideTip() { tt().style.display = 'none'; }

function niceMax(v) {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * e >= v) return m * e;
  return 10 * e;
}
function niceStep(span, n = 4) {
  const raw = span / n, e = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= raw) return m * e;
  return 10 * e;
}
const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : (+v).toFixed(d));

function legend(container, series) {
  if (series.length < 2) return;
  const lg = document.createElement('div');
  lg.className = 'legend';
  lg.innerHTML = series.map((s) => `<span><span class="swatch" style="background:${s.color};${s.dashed ? 'opacity:.6' : ''}"></span>${s.name}</span>`).join('');
  container.appendChild(lg);
}

function roundedTopBar(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Grouped bar chart. */
export function barChart(container, { categories, series, yMax, yFormat = (v) => fmt(v), height = 220, refs = null, unit = '', legendItems = null, ticks = 4 }) {
  container.innerHTML = '';
  legend(container, legendItems || series);
  const W = Math.max(320, container.clientWidth || 560), H = height, m = { t: 10, r: 8, b: 34, l: 44 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, container);
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vmax = yMax ?? niceMax(Math.max(1e-9, ...series.flatMap((s) => s.values.map((v, i) => (v ?? 0) + ((s.errors && s.errors[i]) || 0))), ...(refs ? refs.values : [])));
  const st = yMax === undefined ? niceStep(vmax, ticks) : vmax / ticks;
  const vtop = yMax === undefined ? Math.ceil(vmax / st - 1e-9) * st : vmax;
  const y = (v) => m.t + ih - (v / vtop) * ih;
  for (let k = 0; k * st <= vtop + 1e-9; k++) {
    const v = k * st;
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: k === 0 ? 'baseline' : 'gridline', 'stroke-width': 1 }, svg);
    const t = el('text', { x: m.l - 6, y: y(v) + 3.5, 'text-anchor': 'end' }, svg); t.textContent = yFormat(v);
  }
  const gw = iw / categories.length;
  const pad = Math.min(18, gw * 0.18);
  const bw = Math.max(4, Math.min(28, (gw - 2 * pad - (series.length - 1) * 2) / series.length));
  const groupW = bw * series.length + 2 * (series.length - 1);
  categories.forEach((c, ci) => {
    const gx = m.l + ci * gw + (gw - groupW) / 2;
    const t = el('text', { x: m.l + ci * gw + gw / 2, y: H - m.b + 15, 'text-anchor': 'middle', class: 'lbl-strong' }, svg);
    t.textContent = c.length > 18 ? c.slice(0, 17) + '…' : c;
    series.forEach((s, si) => {
      const v = s.values[ci];
      if (v === null || v === undefined) return;
      const x = gx + si * (bw + 2);
      const color = s.colors ? s.colors[ci] : s.color;
      const p = el('path', { d: roundedTopBar(x, y(v), bw, Math.max(0, m.t + ih - y(v))), fill: color }, svg);
      if (s.ghost && s.ghost[ci]) { p.setAttribute('fill-opacity', '0.3'); p.setAttribute('stroke', color); p.setAttribute('stroke-dasharray', '3 2'); }
      if (s.errors && s.errors[ci]) {
        const e = s.errors[ci], cx = x + bw / 2;
        el('line', { x1: cx, x2: cx, y1: y(v + e), y2: y(Math.max(0, v - e)), stroke: 'var(--text-secondary)', 'stroke-width': 1.2 }, svg);
        el('line', { x1: cx - 3, x2: cx + 3, y1: y(v + e), y2: y(v + e), stroke: 'var(--text-secondary)', 'stroke-width': 1.2 }, svg);
      }
      const hit = el('rect', { x: x - 1, y: m.t, width: bw + 2, height: ih, fill: 'transparent' }, svg);
      hit.addEventListener('mousemove', (ev) => showTip(`<div class="t">${s.names ? s.names[ci] : s.name}</div><div class="r">${c}<b>${yFormat(v)}${unit}${s.errors && s.errors[ci] ? ' ± ' + yFormat(s.errors[ci]) : ''}</b></div>${s.notes && s.notes[ci] ? `<div class="r">${s.notes[ci]}</div>` : ''}`, ev.clientX, ev.clientY));
      hit.addEventListener('mouseleave', hideTip);
    });
    if (refs && refs.values[ci] !== undefined) {
      const ry = y(refs.values[ci]);
      el('line', { x1: gx - 4, x2: gx + groupW + 4, y1: ry, y2: ry, stroke: 'var(--text-primary)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, svg);
    }
  });
}

