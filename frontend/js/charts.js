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

