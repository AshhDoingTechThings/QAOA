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

