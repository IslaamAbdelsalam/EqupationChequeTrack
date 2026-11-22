/* =========================================================
   Charts — small SVG charts, no libraries.
   Colours: Equpation yellow #FFC400 and blue #2A6FB8 (values are also labelled or tabled) (checked for colour-blind
   separation and 3:1 contrast); loss red / gain blue for FX.
   Every bar has a hover tooltip; values are also labelled or tabled.
   ========================================================= */
'use strict';
const CH = { gold: '#FFC400', blue: '#2A6FB8', red: '#B3261E', grid: '#EFEDE8', axis: '#D8D6D0', ink: '#5A554D' };

function short(v) {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e9) return s + (a / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
  if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
  return s + (Math.round(a * 100) / 100);
}
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function tipAttr(s) { return `data-tip="${esc(s)}"`; }
function noData() { return `<div class="empty sm">${t('No data for this period.')}</div>`; }

/** Horizontal bars: items [{label, value, tip}] — one colour, labelled values. */
function hbar(items, o) {
  o = o || {};
  items = items.filter(i => i.value > 0);
  if (!items.length) return noData();
  const plain = o.plain || (v => short(v)), W = 600, rowH = 34, lw = 190, vw = 110, bw = W - lw - vw - 16;
  const max = Math.max(...items.map(i => i.value)), rtl = LANG === 'ar';
  const H = items.length * rowH + 6;
  const X = x => rtl ? W - x : x, anc = a => rtl ? (a === 'start' ? 'end' : a === 'end' ? 'start' : a) : a;
  let g = '';
  items.forEach((it, k) => {
    const y = k * rowH + 4, w = Math.max(3, it.value / max * bw), x0 = lw + 8;
    const rx = rtl ? W - x0 - w : x0;
    const label = it.label.length > 26 ? it.label.slice(0, 25) + '…' : it.label;
    g += `<g ${tipAttr(it.tip || (it.label + ': ' + plain(it.value)))}>
      <rect x="0" y="${y - 2}" width="${W}" height="${rowH - 2}" fill="transparent"/>
      <text x="${X(lw)}" y="${y + rowH / 2 + 2}" text-anchor="${anc('end')}">${esc(label)}</text>
      <rect x="${rx}" y="${y + 6}" width="${w}" height="${rowH - 16}" rx="4" fill="${it.color || o.color || CH.gold}"/>
      <text x="${X(x0 + w + 8)}" y="${y + rowH / 2 + 2}" text-anchor="${anc('start')}" style="font-weight:600">${esc(plain(it.value))}</text></g>`;
  });
  return `<div class="chart" role="img" aria-label="${esc(o.title || '')}" dir="ltr"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet">${g}</svg></div>`;
}

/** Vertical grouped bars over categories (time runs left to right). series [{name, values, color}] */
function vbars(cats, series, o) {
  o = o || {};
  const all = series.flatMap(s => s.values);
  if (!all.some(v => v > 0)) return noData();
  const W = 600, H = 240, pl = 54, pr = 10, pt = 12, pb = 34, cw = (W - pl - pr) / cats.length;
  const max = niceMax(Math.max(...all)), Y = v => pt + (H - pt - pb) * (1 - v / max);
  const plain = o.plain || (v => short(v));
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = max * k / 4, y = Y(v);
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="${k ? 'gr' : 'ax'}" stroke-width="1"/><text x="${pl - 8}" y="${y + 4}" text-anchor="end">${short(v)}</text>`;
  }
  const n = series.length, gap = 2, bw = Math.min(34, (cw * 0.7 - gap * (n - 1)) / n);
  cats.forEach((c, i) => {
    const x0 = pl + i * cw + (cw - (bw * n + gap * (n - 1))) / 2;
    series.forEach((s, j) => {
      const v = s.values[i] || 0, y = Y(v), h = Math.max(0, H - pb - y);
      const tip = `${c}\n${n > 1 ? s.name + ': ' : ''}${plain(v)}${o.tipx ? '\n' + o.tipx(i, j) : ''}`;
      g += `<g ${tipAttr(tip)}><rect x="${x0 + j * (bw + gap) - 1}" y="${pt}" width="${bw + 2}" height="${H - pt - pb}" fill="transparent"/>${h > 0 ? `<rect x="${x0 + j * (bw + gap)}" y="${y}" width="${bw}" height="${h}" rx="4" fill="${s.color}"/><rect x="${x0 + j * (bw + gap)}" y="${H - pb - Math.min(h, 4)}" width="${bw}" height="${Math.min(h, 4)}" fill="${s.color}"/>` : ''}</g>`;
    });
    g += `<text x="${pl + i * cw + cw / 2}" y="${H - pb + 18}" text-anchor="middle">${esc(c)}</text>`;
  });
  const legend = n > 1 ? `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `${legend}<div class="chart" role="img" aria-label="${esc(o.title || '')}" dir="ltr"><svg viewBox="0 0 ${W} ${H}">${g}</svg></div>`;
}

/** Signed bars around zero: positive = gain (blue, up), negative = loss (red, down). */
function signedBars(cats, values, o) {
  o = o || {};
  if (!values.some(v => Math.abs(v) > 0)) return noData();
  const W = 600, H = 240, pl = 54, pr = 10, pt = 12, pb = 34, cw = (W - pl - pr) / cats.length;
  const m = niceMax(Math.max(...values.map(Math.abs))), Y = v => pt + (H - pt - pb) * (0.5 - v / (2 * m));
  const plain = o.plain || (v => short(v));
  let g = '';
  [-m, -m / 2, 0, m / 2, m].forEach(v => { const y = Y(v); g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="${v === 0 ? 'ax' : 'gr'}" stroke-width="1"/><text x="${pl - 8}" y="${y + 4}" text-anchor="end">${short(v)}</text>`; });
  const bw = Math.min(30, cw * 0.6);
  cats.forEach((c, i) => {
    const v = values[i] || 0, x = pl + i * cw + (cw - bw) / 2, y0 = Y(0), y1 = Y(v);
    const tip = `${c}\n${v >= 0 ? t('Gain') : t('Loss')}: ${plain(Math.abs(v))}`;
    g += `<g ${tipAttr(tip)}><rect x="${x - 2}" y="${pt}" width="${bw + 4}" height="${H - pt - pb}" fill="transparent"/>`;
    if (v) g += `<rect x="${x}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.max(2, Math.abs(y1 - y0))}" rx="4" fill="${v >= 0 ? CH.blue : CH.red}"/>`;
    g += `</g><text x="${pl + i * cw + cw / 2}" y="${H - pb + 18}" text-anchor="middle">${esc(c)}</text>`;
  });
  const legend = `<div class="legend"><span><i style="background:${CH.blue}"></i>${t('Gain')}</span><span><i style="background:${CH.red}"></i>${t('Loss')}</span></div>`;
  return `${legend}<div class="chart" role="img" aria-label="${esc(o.title || '')}" dir="ltr"><svg viewBox="0 0 ${W} ${H}">${g}</svg></div>`;
}

/** Progress rows (HTML): items [{label, value, total, sub}] */
function progRows(items) {
  if (!items.length) return noData();
  return items.map(i => {
    const p = i.total > 0 ? Math.min(100, i.value / i.total * 100) : 0;
    return `<div style="margin:10px 0" ${tipAttr(i.tip || '')}><div style="display:flex;justify-content:space-between;gap:12px;font-size:14px"><span class="b">${esc(i.label)}</span><span class="sm mut">${i.sub || ''}</span></div>
      <div class="prog" style="margin-top:6px" role="progressbar" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${p}%"></i></div></div>`;
  }).join('');
}

/** Last n months as [{key:'yyyy-MM', label:'MM/yyyy'}] ending this month. */
function lastMonths(n) {
  const out = [], d = new Date(today() + 'T12:00:00Z'); d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d); x.setUTCMonth(d.getUTCMonth() - i); const k = x.toISOString().slice(0, 7); out.push({ key: k, label: fmon(k) }); }
  return out;
}

/* tooltip */
document.addEventListener('mouseover', e => {
  const el = e.target.closest && e.target.closest('[data-tip]'); const tip = document.getElementById('tip'); if (!tip) return;
  if (!el || !el.getAttribute('data-tip')) { tip.style.display = 'none'; return; }
  tip.textContent = el.getAttribute('data-tip'); tip.style.display = 'block';
});
document.addEventListener('mousemove', e => {
  const tip = document.getElementById('tip'); if (!tip || tip.style.display !== 'block') return;
  tip.style.left = Math.max(8, Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)) + 'px';
  tip.style.top = Math.min(e.clientY + 16, innerHeight - tip.offsetHeight - 8) + 'px';
});
document.addEventListener('scroll', () => { const tip = document.getElementById('tip'); if (tip) tip.style.display = 'none'; }, { passive: true });

/** Line over time (one series): points [{label, value, tip}] — 2px line, 8px markers, hover per point. */
function lineChart(points, o) {
  o = o || {};
  if (points.length < 2) return noData();
  const W = 600, H = 220, pl = 58, pr = 14, pt = 14, pb = 34;
  const vs = points.map(p => p.value), lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.15 || hi * 0.02 || 1;
  const y0 = lo - pad, y1 = hi + pad, X = i => pl + (W - pl - pr) * i / (points.length - 1), Y = v => pt + (H - pt - pb) * (1 - (v - y0) / (y1 - y0));
  const plain = o.plain || (v => short(v)), col = o.color || CH.gold;
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = y0 + (y1 - y0) * k / 4, y = Y(v); g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="${k ? 'gr' : 'ax'}" stroke-width="1"/><text x="${pl - 8}" y="${y + 4}" text-anchor="end">${esc(plain(v))}</text>`; }
  g += `<polyline fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" points="${points.map((p, i) => X(i) + ',' + Y(p.value)).join(' ')}"/>`;
  const every = Math.ceil(points.length / 7);
  points.forEach((p, i) => {
    g += `<g ${tipAttr(p.tip || (p.label + ': ' + plain(p.value)))}><circle cx="${X(i)}" cy="${Y(p.value)}" r="12" fill="transparent"/><circle cx="${X(i)}" cy="${Y(p.value)}" r="4" fill="${col}" stroke="#fff" stroke-width="2"/></g>`;
    if (i % every === 0 || i === points.length - 1) g += `<text x="${X(i)}" y="${H - pb + 18}" text-anchor="middle">${esc(p.label)}</text>`;
  });
  return `<div class="chart" role="img" aria-label="${esc(o.title || '')}" dir="ltr"><svg viewBox="0 0 ${W} ${H}">${g}</svg></div>`;
}
