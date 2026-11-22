/* =========================================================
   ChequeTrack v2 — core: state, language, dates, shell, sign-in
   ========================================================= */
'use strict';
let D = null;                       // data from /api/state
const S = { user: null, page: 'home', arg: '', q: new URLSearchParams(), f: {}, open: {}, brand: {}, policy: null, lang: 'en' };
let busy = false;

/* ---------- language ---------- */
let LANG = 'en';
function t(s, v) {
  let r = LANG === 'ar' ? ((typeof AR !== 'undefined' && AR[s]) || s) : s;
  if (v) for (const k in v) r = r.split('{' + k + '}').join(v[k]);
  return r;
}
function setLang(l) {
  LANG = l === 'ar' ? 'ar' : 'en'; S.lang = LANG;
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
  try { localStorage.setItem('ct.lang', LANG); } catch (e) { }
}
async function switchLang() {
  setLang(LANG === 'ar' ? 'en' : 'ar');
  if (S.user) api('/api/act', { action: 'setLang', lang: LANG });
  render();
}
function nm(o) { if (!o) return '—'; return LANG === 'ar' && o.nameAr ? o.nameAr : (o.nameEn || o.nameAr || '—'); }

/* ---------- small helpers ---------- */
const $ = s => document.querySelector(s);
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function js(s) { return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function val(id) { const e = document.getElementById(id); return e ? e.value.trim() : ''; }
function chk(id) { const e = document.getElementById(id); return !!(e && e.checked); }
function num(v) { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; }
function money(n, c) {
  if (n == null || n === '' || isNaN(n)) return '—';
  const d = c === 'SDG' ? 0 : 2;
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) + (c ? ' ' + c : '');
}
function M(n, c) { return `<bdi class="num" dir="ltr">${money(n, c)}</bdi>`; }
function N(n, d) { return `<bdi class="num" dir="ltr">${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: d ?? 0 })}</bdi>`; }
function rnum(n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 4 }); }
function round(v, c) { const f = c === 'SDG' ? 1 : 100; return Math.round(v * f) / f; }
function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

/* ---------- dates: stored yyyy-MM-dd, always shown dd/MM/yyyy ---------- */
function fd(iso) {
  if (!iso) return '';
  const s = String(iso); if (s.length < 10 || s[4] !== '-') return s;
  return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) + (s.length > 10 ? s.slice(10, 16) : '');
}
function FD(iso) { return iso ? `<bdi class="num" dir="ltr">${fd(iso)}</bdi>` : '—'; }
function pd(str) {
  const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(String(str || '').trim());
  if (!m) return '';
  const iso = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  const d = new Date(iso + 'T12:00:00Z');
  return isNaN(d) || d.toISOString().slice(0, 10) !== iso ? '' : iso;
}
function fmon(ym) { return ym && ym.length >= 7 ? ym.slice(5, 7) + '/' + ym.slice(0, 4) : ''; }
function pmon(s) { const m = /^(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim()); return m && +m[1] >= 1 && +m[1] <= 12 ? m[2] + '-' + m[1].padStart(2, '0') : ''; }
function today() { return (D && D.today) || new Date().toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function daysUntil(s) { if (!s) return 9999; return Math.round((new Date(s.slice(0, 10) + 'T12:00:00Z') - new Date(today() + 'T12:00:00Z')) / 864e5); }
function dateIn(id, iso, extra) {
  return `<div class="dt"><input class="in" id="${id}" value="${fd(iso || '')}" placeholder="dd/MM/yyyy" inputmode="numeric" autocomplete="off" dir="ltr" ${extra || ''}>` +
    `<button type="button" class="dtb" aria-label="${t('Pick a date')}" onclick="pickDate('${id}')">${ic('cal')}</button>` +
    `<input type="date" class="dtp" id="${id}_p" tabindex="-1" aria-hidden="true" onchange="var e=document.getElementById('${id}');e.value=fd(this.value);e.dispatchEvent(new Event('change',{bubbles:true}))"></div>`;
}
function pickDate(id) {
  const p = document.getElementById(id + '_p'); if (!p) return;
  p.value = pd(val(id)) || today();
  try { p.showPicker(); } catch (e) { p.focus(); p.click(); }
}
function dval(id) { return pd(val(id)); }
function dueTxt(c) {
  if (['Cleared', 'Solved', 'Rejected', 'Cancelled'].includes(c.status)) return `<div>${FD(c.dueDate)}</div>`;
  const n = daysUntil(c.dueDate), al = (D && D.settings.alertDays) || 7;
  const w = n < 0 ? t('{n} days overdue', { n: -n }) : n === 0 ? t('Today') : n === 1 ? t('Tomorrow') : t('In {n} days', { n });
  return `<div>${FD(c.dueDate)}</div><div class="sm ${n < 0 ? 'late' : n <= al ? 'soon' : 'mut'}">${w}</div>`;
}

/* ---------- icons (inline, no libraries) ---------- */
const IC = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>',
  cheque: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  contract: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  rates: '<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 7h6"/>',
  chart: '<path d="M4 20h16"/><path d="M7 16v-5M12 16V7M17 16v-8"/>',
  bank: '<path d="M3 10h18L12 4z"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 21h18"/>',
  setup: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="m5 12 5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', down: '<path d="m6 9 6 6 6-6"/>',
  dl: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17.5v.5"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 8v.5M12 11v5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>', key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>', shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>'
};
function ic(n) { return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`; }

/* ---------- server ---------- */
async function api(path, body) {
  const opt = body === undefined ? { credentials: 'same-origin' } :
    { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ChequeTrack' }, body: JSON.stringify(body) };
  let r; try { r = await fetch(path, opt); } catch (e) { return { ok: false, error: t('No connection to the server. Check your internet and try again.') }; }
  let j = null; try { j = await r.json(); } catch (e) { }
  if (r.status === 401 && !path.startsWith('/api/login') && S.user) { S.user = null; D = null; S.loginMsg = t('Your session has ended. Please sign in again.'); closeM(); render(); return { ok: false, error: '' }; }
  if (!r.ok && !(j && j.error)) return { ok: false, error: t('Server error ({n}). Please try again.', { n: r.status }) };
  return j || { ok: false, error: t('Unexpected server response.') };
}
async function loadState() {
  const j = await api('/api/state');
  if (j && j.me) { D = j; S.user = j.me; return true; }
  return false;
}
async function act(action, data, okMsg, opt) {
  opt = opt || {};
  if (busy) return null; busy = true; document.body.style.cursor = 'progress';
  try {
    const j = await api('/api/act', Object.assign({ action }, data || {}));
    if (!j.ok) {
      if (opt.raw && (j.dup || j.confirm)) return j;
      if (j.error) toast(tErr(j.error));
      return j;
    }
    await loadState(); if (opt.after) opt.after(j); render(); if (okMsg) toast(okMsg);
    return j;
  } finally { busy = false; document.body.style.cursor = ''; }
}

/* ---------- lookups ---------- */
const B = id => (D.beneficiaries.find(x => x.id === id) || { nameEn: '—', type: '' });
const E = id => (D.entities.find(x => x.id === id) || { nameEn: '—', funcCur: 'SDG' });
const U = id => (D.users.find(x => x.id === id) || { fullName: '—', fullNameAr: '' });
const Dp = id => (D.departments.find(x => x.id === id) || { nameEn: '—' });
const AC = id => D.accounts.find(x => x.id === id);
const BK = id => D.banks.find(x => x.id === id);
const K = op => D.contracts.find(x => x.opNo === op);
const R = () => S.user.role;
/** A user's name in the reader's language (English name when no Arabic one is saved). */
function un(u) { if (!u) return '—'; return LANG === 'ar' && u.fullNameAr ? u.fullNameAr : (u.fullName || u.fullNameAr || '—'); }
const UN = id => un(U(id));
/** Names saved on records ("approved by …") are English names: show the reader's language when the user is known. */
function byN(name) { if (!name || !D) return name || ''; const u = D.users.find(x => x.fullName === name); return u ? un(u) : name; }
const RK = k => (D && D.roles ? D.roles.find(r => r.key === k) : null);
function roleName(k) { const r = RK(k); return r ? nm(r) : t(ROLES[k] || k || '—'); }
function acctName(a) { if (!a) return '—'; const b = BK(a.bankId); return `${nm(b)} ••${a.last4} · ${a.currency}`; }

/* ---------- access: the role's rights (Roles & permissions), the same ones the server checks ---------- */
const ROLES = { USER: 'Department User', FIN: 'Finance', CFO: 'CFO', TOP: 'Top Management', ADMIN: 'System Admin', AUDIT: 'Auditor' }; // built-in role names
/** has('contracts') = may open the page; has('contracts','edit') = may change its records. */
function has(page, op) { const p = (S.user && S.user.perms) || {}; return !!(p[page] && p[page].includes(op || 'view')); }
const can = {
  request: () => has('requests', 'create'),
  approve: () => has('approvals', 'approve'), approve2: () => has('approvals', 'approve2'),
  issue: () => has('issue', 'issue'), clear: () => has('followup', 'clear'), settle: () => has('followup', 'settle')
};
/** Contract data reaches roles that open the contracts register or the reports. */
const seesContracts = () => has('contracts') || has('reports');

/* ---------- cheque stages ---------- */
const STAGES = {
  Pending: ['Pending CFO', 'c-pend'], Pending2: ['Second approval', 'c-2nd'], Approved: ['Approved – to issue', 'c-appr'],
  Posted: ['Issued to requester', 'c-iss'], Received: ['Received by requester', 'c-rec'], Delivered: ['With beneficiary', 'c-ben'],
  Cleared: ['Cleared', 'c-clr'], Returned: ['Returned', 'c-ret'], Solved: ['Returned – settled', 'c-sol'], Rejected: ['Rejected', 'c-ret'], Cancelled: ['Cancelled', 'c-can']
};
const OPEN = ['Approved', 'Posted', 'Received', 'Delivered', 'Returned'];
const OUTSTANDING = ['Posted', 'Received', 'Delivered'];
function stageName(s) { return t((STAGES[s] || [s])[0]); }
function chip(s) { const x = STAGES[s] || [s, 'c-can']; return `<span class="chip ${x[1]}">${esc(t(x[0]))}</span>`; }

/* ---------- money in other currencies ---------- */
function latest() { return D.rates[0] || null; }
function rateOn(iso) { return D.rates.find(r => r.date <= iso) || null; }
function perUsd(c, r) { return c === 'USD' ? 1 : c === 'QAR' ? +r.QAR : +r.SDG; }
function conv(a, f, to, r) { if (f === to) return +a; if (!r) return 0; return +a / perUsd(f, r) * perUsd(to, r); }
function snapRate(c) {
  if (c.appr && c.appr.qar) return { QAR: +c.appr.qar, SDG: +c.appr.sdg, date: c.appr.rateDate, id: c.appr.rateId };
  return rateOn((c.docDate || c.createdAt || today()).slice(0, 10)) || latest();
}
function usdOf(c) { if (c.appr && c.appr.usdEq != null) return +c.appr.usdEq; const r = snapRate(c); return r ? conv(c.amount, c.currency, 'USD', r) : 0; }
function inCur(c, cur) { const r = snapRate(c); return r ? conv(c.amount, c.currency, cur, r) : 0; }
function payTxt(c) { return c.payAmt != null ? M(c.payAmt, c.payCur) : M(c.amount, c.currency); }
function visible() { return D.cheques; }
function mine() { return D.cheques.filter(c => c.requesterId === S.user.id); }

/* ---------- toast, modal, confirm ---------- */
function toast(m) { const e = $('#toast'); e.innerHTML = `<div class="toast" role="status">${esc(m)}</div>`; clearTimeout(toast.t); toast.t = setTimeout(() => e.innerHTML = '', 4200); }
function modal(html, wide) { $('#modal').innerHTML = `<div class="ov" onmousedown="if(event.target===this)closeM()"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`; const f = $('#modal input:not([type=hidden]):not(.dtp),#modal select,#modal textarea'); if (f) setTimeout(() => f.focus(), 30); }
function mhead(title, sub) { return `<div class="mh"><div><h2>${esc(title)}</h2>${sub ? `<div class="sm mut" style="margin-top:2px">${sub}</div>` : ''}</div><button class="x" onclick="closeM()" aria-label="${t('Close')}">${ic('x')}</button></div>`; }
function closeM() { $('#modal').innerHTML = ''; }
function confirmBox(title, msgHtml, okText, cb, danger) {
  S._cb = cb;
  modal(`${mhead(title)}<div class="mb">${msgHtml}</div><div class="mf"><button class="btn btn-o" onclick="closeM()">${t('Cancel')}</button><button class="btn ${danger ? 'btn-r' : 'btn-y'}" onclick="var f=S._cb;closeM();f&&f()">${esc(okText)}</button></div>`);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modal').innerHTML) closeM(); });

/* ---------- files ---------- */
function readFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej; r.readAsDataURL(file);
  });
}
function csv(name, head, rows) {
  const e = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const text = '﻿' + [head, ...rows].map(r => r.map(e).join(',')).join('\r\n');
  try {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '-' + today() + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    toast(t('Exported {n} rows', { n: rows.length }));
  } catch (err) {
    navigator.clipboard && navigator.clipboard.writeText(text.replace(/,/g, '\t'));
    toast(t('Copied — paste it into Excel'));
  }
}

/* ---------- lists: search, filters, paging ---------- */
function F(key, def) { return S.f[key] = S.f[key] || Object.assign({ q: '', tab: '', ent: '', cur: '', from: '', to: '', page: 1, size: 25, x: '' }, def || {}); }
function setF(key, prop, v, keepId) {
  const f = F(key); f[prop] = v; if (prop !== 'page') f.page = 1;
  render();
  if (keepId) { const el = document.getElementById(keepId); if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) { } } }
}
function searchBox(key, ph) {
  return `<label class="srch" style="flex:1 1 240px">${ic('search')}<input class="in" id="q_${key}" type="search" placeholder="${esc(ph)}" aria-label="${esc(ph)}" value="${esc(F(key).q)}" oninput="setF('${key}','q',this.value,'q_${key}')"></label>`;
}
function pageOf(key, rows) {
  const f = F(key), n = rows.length, pages = Math.max(1, Math.ceil(n / f.size));
  if (f.page > pages) f.page = pages;
  const st = (f.page - 1) * f.size;
  return { rows: rows.slice(st, st + f.size), n, pages, st };
}
function pager(key, p) {
  const f = F(key);
  if (p.n <= 10) return `<div class="pager"><span class="sm mut">${t('{n} rows', { n: p.n })}</span></div>`;
  return `<div class="pager"><span class="sm mut">${t('Showing {a}–{b} of {n}', { a: p.st + 1, b: Math.min(p.st + f.size, p.n), n: p.n })}</span>
   <div style="display:flex;gap:8px;align-items:center">
    <button class="btn btn-o btn-sm" ${f.page <= 1 ? 'disabled' : ''} onclick="setF('${key}','page',${f.page - 1})">${t('Previous')}</button>
    <span class="sm">${f.page} / ${p.pages}</span>
    <button class="btn btn-o btn-sm" ${f.page >= p.pages ? 'disabled' : ''} onclick="setF('${key}','page',${f.page + 1})">${t('Next')}</button>
    <select class="in" aria-label="${t('Rows per page')}" onchange="setF('${key}','size',+this.value)">${[25, 50, 100].map(x => `<option ${x === f.size ? 'selected' : ''}>${x}</option>`).join('')}</select>
   </div></div>`;
}
function inRange(f, d) { if (f.from && (!d || d < f.from)) return false; if (f.to && (!d || d > f.to)) return false; return true; }

/* ---------- navigation ---------- */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('reset=')) return { page: 'reset', arg: h.slice(6), q: new URLSearchParams() };
  const [path, q] = h.split('?'); const parts = (path || '').split('/');
  return { page: parts[0] || 'home', arg: decodeURIComponent(parts[1] || ''), q: new URLSearchParams(q || '') };
}
function go(p) { if (location.hash === '#/' + p) { route(); } else location.hash = '#/' + p; }
function route() {
  const r = parseHash();
  if (r.page === 'reset') { S.resetToken = r.arg; S.resetInfo = null; history.replaceState(null, '', location.pathname); }
  else { S.page = r.page; S.arg = r.arg; S.q = r.q; }
  closeM(); S.side = false;
  render(); window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
function toggleMenu() {
  if (window.matchMedia('(max-width:1199px)').matches) { S.side = !S.side; document.querySelector('.side')?.classList.toggle('open', S.side); }
  else { const off = document.body.classList.toggle('nomenu'); try { localStorage.setItem('ct.nomenu', off ? '1' : ''); } catch (e) { } }
}
try { if (localStorage.getItem('ct.nomenu')) document.body.classList.add('nomenu'); } catch (e) { }
document.addEventListener('click', e => { if (S.side && !e.target.closest('.side,.burger')) { S.side = false; document.querySelector('.side')?.classList.remove('open'); } });

function menu() {
  const tasks = myTasks();
  const cnt = f => tasks.filter(f).length;
  const items = [];
  items.push({ id: 'home', ic: 'home', label: t('Home'), cnt: tasks.length });
  if (can.request()) items.push({ id: 'new', ic: 'plus', label: t('New request') });
  const ch = [], fin = [];
  if (has('requests')) ch.push({ id: 'mine', label: t('My requests'), cnt: cnt(x => x.mine) });
  if (has('cheques')) ch.push({ id: 'cheques', label: S.user.scope === 'all' ? t('All cheques') : S.user.scope === 'dept' ? t('Department cheques') : t('Cheques') });
  if (has('approvals')) ch.push({ id: 'approvals', label: t('Approvals'), cnt: cnt(x => x.kind === 'approve') });
  if (has('issue')) ch.push({ id: 'issue', label: t('Issue cheques'), cnt: cnt(x => x.kind === 'issue') });
  if (has('followup')) ch.push({ id: 'followup', label: t('Due & follow-up'), cnt: cnt(x => x.kind === 'clear' || x.kind === 'settle') });
  if (has('contracts')) fin.push({ id: 'contracts', label: t('Contracts register'), cnt: cnt(x => x.kind === 'contract') });
  if (has('poa')) fin.push({ id: 'poa', label: t('Payments on account'), cnt: cnt(x => x.kind === 'poa') });
  if (ch.length || fin.length || has('rates')) items.push({ h: t('Operations') });
  items.push({ g: 'cheques', ic: 'cheque', label: t('Cheques'), items: ch });
  items.push({ g: 'fin', ic: 'contract', label: t('Financing'), items: fin });
  if (has('rates')) items.push({ id: 'rates', ic: 'rates', label: t('Exchange rates'), cnt: cnt(x => x.kind === 'rate') });
  const acc = [], bank = [];
  if (has('reports')) acc.push({ id: 'reports', label: t('Reports') });
  if (has('entries')) acc.push({ id: 'entries', label: t('Journal entries') });
  if (has('banks')) bank.push({ id: 'banks', label: t('Banks & accounts') });
  if (has('books')) bank.push({ id: 'books', label: t('Chequebooks') });
  if (has('voided')) bank.push({ id: 'voided', label: t('Voided numbers') });
  if (acc.length || bank.length) items.push({ h: t('Finance') });
  items.push({ g: 'acc', ic: 'chart', label: t('Accounting & reports'), items: acc });
  items.push({ g: 'bank', ic: 'bank', label: t('Banking'), items: bank });
  const um = [], md = [], sy = [];
  if (has('users')) um.push({ id: 'users', label: t('User accounts') });
  if (has('roles')) um.push({ id: 'roles', label: t('Roles & permissions') });
  if (has('departments')) um.push({ id: 'departments', label: t('Departments') });
  if (has('security')) um.push({ id: 'security', label: t('Sign-in & passwords') });
  if (has('beneficiaries')) md.push({ id: 'beneficiaries', label: t('Beneficiaries') });
  if (has('entities')) md.push({ id: 'entities', label: t('Entities') });
  if (has('settings')) sy.push({ id: 'settings', label: t('Settings') });
  if (has('telegram') && !D.settings.hideTelegram) sy.push({ id: 'telegram', label: t('Telegram alerts') });
  if (has('audit')) sy.push({ id: 'audit', label: t('Audit log') });
  if (has('checklist')) sy.push({ id: 'checklist', label: t('Go-live checklist') });
  if (um.length || md.length || sy.length) items.push({ h: t('Administration') });
  items.push({ g: 'users', ic: 'users', label: t('User management'), items: um });
  items.push({ g: 'data', ic: 'db', label: t('Master data'), items: md });
  items.push({ g: 'setup', ic: 'setup', label: t('System'), items: sy });
  return items;
}
function toggleGrp(g) { S.open[g] = !isOpen(g); try { localStorage.setItem('ct.open', JSON.stringify(S.open)); } catch (e) { } render(); }
const PARENT = { cheque: 'cheques', role: 'roles' };
function isOpen(g) { const m = menu().find(x => x.g === g); const active = m && m.items.some(i => i.id === S.page || PARENT[S.page] === i.id); return S.open[g] === undefined ? active : (S.open[g] || active); }
function cntB(n) { return n ? `<span class="cnt">${n}</span>` : ''; }
function sideHtml() {
  const m = menu();
  const b = D.settings;
  return `<aside class="side ${S.side ? 'open' : ''}" aria-label="${t('Main menu')}">
   <div class="brand"><img class="blogo" src="${esc(b.logo || '/img/logo.svg')}" alt="${esc(b.company || 'Equpation')}"><span class="bname">ChequeTrack</span>
     <button class="mtog" aria-label="${t('Menu')}" onclick="toggleMenu()"><svg class="ic mc" viewBox="0 0 24 24" aria-hidden="true"><path d="m11 7-5 5 5 5"/><path d="m18 7-5 5 5 5"/></svg><svg class="ic mx" viewBox="0 0 24 24" aria-hidden="true">${IC.x}</svg></button></div>
   <nav class="mnav">
   ${m.map(i => i.h ? `<div class="mhead">${esc(i.h)}</div>` : i.g ? (i.items.length ? `<div class="grp ${isOpen(i.g) ? 'open' : ''}">
      <button class="nav ${i.items.some(x => x.id === S.page || PARENT[S.page] === x.id) ? 'has-on' : ''}" aria-expanded="${isOpen(i.g)}" onclick="toggleGrp('${i.g}')">${ic(i.ic)}${esc(i.label)}${cntB(i.items.reduce((s, x) => s + (x.cnt || 0), 0) && !isOpen(i.g) ? i.items.reduce((s, x) => s + (x.cnt || 0), 0) : 0)}<svg class="ic chev" viewBox="0 0 24 24" aria-hidden="true">${IC.down}</svg></button>
      <div class="subs">${i.items.map(x => `<a class="sub ${S.page === x.id || PARENT[S.page] === x.id ? 'on' : ''}" href="#/${x.id}" ${S.page === x.id ? 'aria-current="page"' : ''}>${esc(x.label)}${cntB(x.cnt)}</a>`).join('')}</div></div>` : '')
      : `<a class="nav ${S.page === i.id ? 'on' : ''}" href="#/${i.id}" ${S.page === i.id ? 'aria-current="page"' : ''}>${ic(i.ic)}${esc(i.label)}${cntB(i.cnt)}</a>`).join('')}
   <div class="mhead">${t('Account')}</div>
   <a class="nav ${S.page === 'profile' ? 'on' : ''}" href="#/profile">${ic('key')}${t('My profile')}</a>
   <button class="nav" onclick="logout()">${ic('logout')}${t('Sign out')}</button>
   </nav></aside>`;
}
function topHtml() {
  const u = S.user;
  return `<header class="top">
   <button class="btn btn-o btn-sm burger" aria-label="${t('Menu')}" onclick="toggleMenu()">${ic('menu')}</button>
   <div class="srch">${ic('search')}<input class="in" id="gq" type="search" placeholder="${t('Search by reference, beneficiary or cheque no.')}" aria-label="${t('Search cheques')}" oninput="gsearch(this.value)" onblur="setTimeout(()=>{const r=document.getElementById('gres');if(r)r.innerHTML=''},200)"><div id="gres"></div></div>
   <div class="sp"></div>
   <button class="btn btn-o btn-sm" onclick="switchLang()" ${LANG === 'ar' ? 'lang="en"' : 'lang="ar"'}>${ic('globe')}${LANG === 'ar' ? 'English' : 'العربية'}</button>
   <a class="who" href="#/profile" style="text-decoration:none;color:inherit"><div class="nm" style="text-align:end"><div class="b">${esc(un(u))}</div><div class="sm mut">${esc(roleName(u.role))}</div></div><div class="av">${esc((un(u) || '?').trim()[0] || '?')}</div></a>
  </header>`;
}
function gsearch(q) {
  const box = document.getElementById('gres'); if (!box) return;
  q = q.trim().toLowerCase(); if (q.length < 2) { box.innerHTML = ''; return; }
  const hits = D.cheques.filter(c => (c.id + ' ' + B(c.benId).nameEn + ' ' + (B(c.benId).nameAr || '') + ' ' + (c.issue ? c.issue.no : '') + ' ' + (c.docNo || '')).toLowerCase().includes(q)).slice(0, 8);
  box.innerHTML = `<div class="sres">${hits.length ? hits.map(c => `<a href="#/cheque/${c.id}"><b>${c.id}</b> · ${esc(nm(B(c.benId)))} <span class="sm mut">· ${payTxt(c)}</span> ${chip(c.status)}</a>`).join('') : `<div class="empty">${t('No match')}</div>`}</div>`;
}

/* ---------- the waiting-for-you list (also drives the menu counters) ---------- */
function myTasks() {
  if (!D) return [];
  const me = S.user.id, out = [];
  for (const c of D.cheques) {
    if (can.approve() && c.status === 'Pending' && c.requesterId !== me) out.push({ c, kind: 'approve', act: t('Review') });
    if (can.approve2() && c.status === 'Pending2' && c.requesterId !== me && !(c.appr && c.appr.byId === me)) out.push({ c, kind: 'approve', act: t('Review') });
    if (can.issue() && c.status === 'Approved' && c.requesterId !== me) out.push({ c, kind: 'issue', act: t('Issue') });
    if (can.clear() && c.status === 'Delivered' && daysUntil(c.dueDate) <= 0 && !(c.issue && c.issue.byId === me)) out.push({ c, kind: 'clear', act: t('Clear or return') });
    if (can.settle() && c.status === 'Returned') out.push({ c, kind: 'settle', act: t('Settle') });
    if (has('poa', 'settle') && c.opType === 'Payment on account' && !c.poa && ['Posted', 'Received', 'Delivered', 'Cleared'].includes(c.status) && daysUntil(c.poaSettleDate) <= 7) out.push({ c, kind: 'poa', act: t('Settle') });
    if (c.requesterId === me && c.status === 'Posted') out.push({ c, kind: 'recv', mine: true, act: t('I received it') });
    if (c.requesterId === me && c.status === 'Received') out.push({ c, kind: 'deliv', mine: true, act: t('Confirm delivery') });
  }
  // contracts: the owner follows them up; without an owner, whoever may follow up contracts
  if (has('contracts')) for (const k of D.contracts) {
    const st = kState(k);
    if (st.closed || !st.attention) continue;
    if (k.ownerId ? k.ownerId === me : has('contracts', 'follow')) out.push({ c: null, k, kind: 'contract', act: t('Follow up') });
  }
  if (has('rates', 'create') && !D.rates.some(x => x.date === today())) out.unshift({ c: null, kind: 'rate', act: t('Enter rate') });
  return out;
}
/** Where a contract stands: expired, inside its reminder period, follow-up due, closed. */
function kExp(k) { return k.expiryDate || k.endDate; }
function kState(k) {
  const closed = k.status === 'Closed', n = daysUntil(kExp(k)), nd = k.noticeDays || 30;
  const expired = !closed && n < 0, soon = !closed && n >= 0 && n <= nd, due = !closed && !!k.followUpDate && daysUntil(k.followUpDate) <= 0;
  return { closed, expired, soon, due, n, attention: expired || soon || due };
}
function kChip(k) {
  const s = kState(k);
  if (s.closed) return `<span class="chip c-can">${t('Closed')}</span>`;
  if (s.expired) return `<span class="chip c-ret">${t('Expired {n} days ago', { n: -s.n })}</span>`;
  if (s.soon) return `<span class="chip c-pend">${s.n === 0 ? t('Expires today') : t('Expires in {n} days', { n: s.n })}</span>`;
  return `<span class="chip c-clr">${t('Active')}</span>`;
}

/* ---------- shell ---------- */
function render() {
  const root = $('#root');
  if (S.resetToken) { root.innerHTML = resetView(); return; }
  if (S.setup) { root.innerHTML = setupView(); return; }
  if (!S.user) { root.innerHTML = authView(); return; }
  if (S.forced) { root.innerHTML = `<div class="login"><div class="lcard">${passwordForm(true)}</div></div>`; return; }
  if (!D) { root.innerHTML = `<div class="empty">${t('Loading…')}</div>`; return; }
  let body;
  try { body = pageView(); }
  catch (e) { console.error(e); body = `<div class="errbox">${ic('alert')}<span>${t('This page could not be shown.')} ${esc(e.message)}</span></div>`; }
  root.innerHTML = `<div class="app">${sideHtml()}<div class="main">${topHtml()}<main class="wrap" id="main">${body}</main></div></div>`;
  if (S.after) { const f = S.after; S.after = null; try { f(); } catch (e) { console.error(e); } }
}
function denied() { return `<div class="card empty">${t('This page is not available for your role.')}</div>`; }
function pageView() {
  const P = {
    home: homePage, new: newRequestPage, mine: minePage, cheques: chequesPage, approvals: approvalsPage, issue: issuePage, followup: followupPage,
    cheque: chequePage, rates: ratesPage, contracts: contractsPage, poa: poaPage, entries: entriesPage, reports: reportsPage,
    banks: banksPage, books: booksPage, voided: voidedPage, beneficiaries: bensPage, entities: entitiesPage, departments: deptsPage,
    users: usersPage, roles: rolesPage, role: rolePage, security: securityPage, settings: settingsPage, telegram: telegramPage, audit: auditPage, checklist: checklistPage, profile: profilePage, password: () => `<div class="card" style="max-width:520px">${passwordForm(false)}</div>`
  };
  const fn = P[S.page] || homePage;
  return fn(S.arg);
}

/* ---------- sign-in, forgot password, two-step, set-up ---------- */
function brandBlock() {
  const b = S.brand || {};
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
    <div style="display:flex;align-items:center;gap:10px;min-width:0"><img class="blogo" style="height:44px;flex:none" src="${esc(b.logo || '/img/logo.svg')}" alt="${esc(b.company || 'Equpation')}"><div style="min-width:0"><div class="bname">ChequeTrack</div><div class="sm mut">${t('cheque management')}</div></div></div>
    <button class="btn btn-o btn-sm" onclick="setLang(LANG==='ar'?'en':'ar');render()">${LANG === 'ar' ? 'English' : 'العربية'}</button></div>`;
}
function authView() {
  const v = S.auth || 'login';
  let inner = '';
  if (v === 'login') inner = `<h1>${t('Sign in')}</h1><div class="mut">${t('Use your ChequeTrack username and password.')}</div>
    <form onsubmit="doLogin(event)">${S.loginMsg ? `<div class="errbox" id="l_err">${ic('alert')}<span>${esc(S.loginMsg)}</span></div>` : '<div id="l_err"></div>'}
     <div><label class="lbl" for="l_u">${t('Username')}</label><input class="in" id="l_u" autocomplete="username" dir="ltr" required></div>
     <div><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px"><label class="lbl" for="l_p">${t('Password')}</label><a class="sm b" href="javascript:void(0)" onclick="S.auth='forgot';S.loginMsg='';render()">${t('Forgot password?')}</a></div>
      <div style="position:relative"><input class="in" id="l_p" type="password" autocomplete="current-password" required style="padding-inline-end:52px"><button type="button" class="dtb" aria-label="${t('Show password')}" onclick="var p=document.getElementById('l_p');p.type=p.type==='password'?'text':'password'">${ic('eye')}</button></div></div>
     <button class="btn btn-y w">${t('Sign in')}</button></form>
     <div class="sm mut" style="margin-top:16px;text-align:center">${t('If two-step verification is on for your account, you will be asked for a code next.')}</div>`;
  if (v === 'code') inner = `<h1>${t('Enter your code')}</h1><div class="mut">${t('We sent a 6-digit code to {e}. It is valid for 10 minutes.', { e: `<bdi dir="ltr">${esc(S.codeMail || '')}</bdi>` })}</div>
    <form onsubmit="doLogin2(event)"><div id="l_err"></div><div><label class="lbl" for="l_c">${t('Code')}</label><input class="in" id="l_c" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr" style="letter-spacing:6px;font-size:20px" required></div>
    <button class="btn btn-y w">${t('Sign in')}</button><a class="sm" href="javascript:void(0)" onclick="S.auth='login';render()" style="text-align:center">${t('Back to sign in')}</a></form>`;
  if (v === 'forgot') inner = `<h1>${t('Forgot your password?')}</h1><div class="mut">${t('Enter the email saved on your ChequeTrack account. We will send you a link to set a new password.')}</div>
    <form onsubmit="doForgot(event)"><div id="l_err"></div><div><label class="lbl" for="f_e">${t('Email')}</label><input class="in" id="f_e" type="email" autocomplete="email" dir="ltr" required></div>
    <button class="btn btn-y w">${t('Send reset link')}</button><a class="sm" href="javascript:void(0)" onclick="S.auth='login';render()" style="text-align:center">${t('Back to sign in')}</a></form>`;
  if (v === 'sent') inner = `<div style="width:52px;height:52px;border-radius:50%;background:#EEE6FF;color:var(--ydark);display:grid;place-items:center;margin-top:20px">${ic('mail')}</div>
    <h1 style="margin-top:14px">${t('Check your email')}</h1><p>${t('If {e} belongs to an active account, a reset link is on its way.', { e: `<b dir="ltr">${esc(S.sentTo || '')}</b>` })}</p>
    <p class="sm mut">${t('The link works once and expires after 30 minutes. Nothing after 5 minutes? Check your spam folder or send it again.')}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-o" onclick="S.auth='forgot';render()">${t('Send again')}</button><button class="btn btn-y" onclick="S.auth='login';render()">${t('Back to sign in')}</button></div>`;
  return `<div class="login"><main class="lcard">${brandBlock()}${inner}</main></div>`;
}
function lerr(m) { const e = document.getElementById('l_err'); if (e) e.outerHTML = `<div class="errbox" id="l_err">${ic('alert')}<span>${esc(tErr(m))}</span></div>`; }
async function doLogin(e) {
  e.preventDefault();
  const j = await api('/api/login', { username: val('l_u'), password: document.getElementById('l_p').value });
  if (!j.ok) { lerr(j.error); return; }
  S.loginMsg = '';
  if (j.twofa) { S.ticket = j.ticket; S.codeMail = j.email; S.auth = 'code'; render(); return; }
  await afterSignIn(j);
}
async function doLogin2(e) {
  e.preventDefault();
  const j = await api('/api/login2', { ticket: S.ticket, code: val('l_c') });
  if (!j.ok) { lerr(j.error); return; }
  const me = await api('/api/me'); await afterSignIn({ user: me.user, forced: me.forced, sessionMin: me.sessionMin, policy: me.policy });
}
async function afterSignIn(j) {
  S.user = j.user; S.policy = j.policy || S.policy; S.auth = 'login';
  setLang(j.user.lang || LANG);
  if (j.forced) { S.forced = j.forced; render(); return; }
  await loadState(); startIdle(j.sessionMin);
  if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '#/home'; else route();
  render();
}
async function doForgot(e) {
  e.preventDefault();
  const em = val('f_e');
  const j = await api('/api/forgot', { email: em });
  if (!j.ok) { lerr(j.error); return; }
  S.sentTo = em; S.auth = 'sent'; render();
}
async function logout(reason) {
  await api('/api/logout', { reason: reason || '' });
  S.user = null; D = null; S.auth = 'login'; S.loginMsg = reason === 'idle' ? t('You were signed out after a period of inactivity.') : '';
  location.hash = ''; render();
}
function polHint(id, out) {
  const P = S.policy || { minLen: 8 }, pw = document.getElementById(id).value, r = [];
  r.push([pw.length >= P.minLen, t('At least {n} characters', { n: P.minLen })]);
  if (P.upper) r.push([/[A-Z]/.test(pw) && /[a-z]/.test(pw), t('Upper and lower case letters')]);
  if (P.digit) r.push([/\d/.test(pw), t('At least one number')]);
  if (P.special) r.push([/[^A-Za-z0-9]/.test(pw), t('At least one symbol (e.g. @ # !)')]);
  document.getElementById(out).innerHTML = r.map(([ok, s]) => `<span class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '•'} ${s}</span>`).join('');
}
function resetView() {
  if (!S.resetInfo) {
    S.resetInfo = { loading: true };
    api('/api/reset', { token: S.resetToken, check: '1' }).then(j => { S.resetInfo = j; render(); });
  }
  const i = S.resetInfo;
  let inner = `<div class="empty">${t('Loading…')}</div>`;
  if (!i.loading && !i.ok) inner = `<h1>${t('Link not valid')}</h1><div class="errbox">${ic('alert')}<span>${esc(tErr(i.error || ''))}</span></div><div style="margin-top:16px"><button class="btn btn-y" onclick="S.resetToken=null;S.auth='forgot';render()">${t('Ask for a new link')}</button></div>`;
  if (i.ok) inner = `<h1>${t('Set a new password')}</h1><div class="mut">${t('Hello {n}, choose a new password for ChequeTrack.', { n: esc((LANG === 'ar' && i.nameAr) || i.name || '') })}</div>
   <form onsubmit="doReset(event)"><div id="l_err"></div>
    <div><label class="lbl" for="r_1">${t('New password')}</label><input class="in" id="r_1" type="password" autocomplete="new-password" required oninput="polHint('r_1','r_h')"><div class="pol" id="r_h"></div></div>
    <div><label class="lbl" for="r_2">${t('Confirm new password')}</label><input class="in" id="r_2" type="password" autocomplete="new-password" required></div>
    <button class="btn btn-y w">${t('Save and sign in')}</button><div class="sm mut">${t('You are signed out on any other device.')}</div></form>`;
  return `<div class="login"><main class="lcard">${brandBlock()}${inner}</main></div>`;
}
async function doReset(e) {
  e.preventDefault();
  const a = document.getElementById('r_1').value, b = document.getElementById('r_2').value;
  if (a !== b) { lerr(t('The two passwords do not match.')); return; }
  const j = await api('/api/reset', { token: S.resetToken, password: a });
  if (!j.ok) { lerr(j.error); return; }
  S.resetToken = null; const me = await api('/api/me');
  await afterSignIn({ user: me.user, forced: me.forced, sessionMin: me.sessionMin, policy: me.policy });
  toast(t('Your password was changed.'));
}
function setupView() {
  const reset = S.reset;
  return `<div class="login"><main class="lcard">${brandBlock()}
   <h1>${reset ? t('Create the CFO sign-in') : t('First-time setup')}</h1>
   <div class="mut">${reset ? t('The CFO account was reset from Azure. Departments, users, cheques and settings are kept.') : t('Create the CFO account. The CFO can then add the other users.')}</div>
   <form onsubmit="doSetup(event)"><div id="l_err"></div>
    ${reset ? '' : `<div><label class="lbl" for="s_c">${t('Company name')}</label><input class="in" id="s_c" value="Equpation" required></div>`}
    <div><label class="lbl" for="s_n">${t('Full name (English)')}</label><input class="in" id="s_n" dir="ltr" required></div>
    <div><label class="lbl" for="s_na">${t('Full name (Arabic)')}</label><input class="in" id="s_na" dir="rtl"></div>
    <div><label class="lbl" for="s_u">${t('Username')}</label><input class="in" id="s_u" dir="ltr" required></div>
    <div><label class="lbl" for="s_e">${t('Email')}</label><input class="in" id="s_e" type="email" dir="ltr" required></div>
    <div><label class="lbl" for="s_p">${t('Password')}</label><input class="in" id="s_p" type="password" autocomplete="new-password" required oninput="polHint('s_p','s_h')"><div class="pol" id="s_h"></div></div>
    <button class="btn btn-y w">${t('Save and sign in')}</button></form></main></div>`;
}
async function doSetup(e) {
  e.preventDefault();
  const j = await api('/api/setup', { company: val('s_c'), fullName: val('s_n'), fullNameAr: val('s_na'), username: val('s_u'), email: val('s_e'), password: document.getElementById('s_p').value, lang: LANG, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  if (!j.ok) { lerr(j.error); return; }
  S.setup = false; const me = await api('/api/me');
  await afterSignIn({ user: me.user, forced: me.forced, sessionMin: me.sessionMin, policy: me.policy });
}
function passwordForm(forced) {
  return `${forced ? brandBlock() : ''}<h1 class="h1" style="margin:${forced ? '24px' : '0'} 0 4px">${t('Change password')}</h1>
   <div class="mut">${forced === true && S.forced === 'expired' ? t('Your password has expired. Choose a new one.') : forced ? t('Choose your own password before you continue.') : t('Choose a new password.')}</div>
   <form onsubmit="doChangePwd(event)" style="display:flex;flex-direction:column;gap:14px;margin-top:18px"><div id="l_err"></div>
    <div><label class="lbl" for="p_o">${t('Current password')}</label><input class="in" id="p_o" type="password" autocomplete="current-password" required></div>
    <div><label class="lbl" for="p_n">${t('New password')}</label><input class="in" id="p_n" type="password" autocomplete="new-password" required oninput="polHint('p_n','p_h')"><div class="pol" id="p_h"></div></div>
    <div><label class="lbl" for="p_c">${t('Confirm new password')}</label><input class="in" id="p_c" type="password" autocomplete="new-password" required></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-y">${t('Save password')}</button>${forced ? `<button type="button" class="btn btn-o" onclick="logout()">${t('Sign out')}</button>` : ''}</div></form>`;
}
async function doChangePwd(e) {
  e.preventDefault();
  const n = document.getElementById('p_n').value;
  if (n !== document.getElementById('p_c').value) { lerr(t('The two passwords do not match.')); return; }
  const j = await api('/api/password', { old: document.getElementById('p_o').value, new: n });
  if (!j.ok) { lerr(j.error); return; }
  toast(t('Your password was changed.'));
  if (S.forced) { S.forced = null; await loadState(); location.hash = '#/home'; }
  render();
}

/* ---------- idle sign-out ---------- */
let idleT = null, idleMin = 30;
function startIdle(min) {
  idleMin = min || 30;
  const reset = () => { clearTimeout(idleT); idleT = setTimeout(() => { if (S.user) logout('idle'); }, idleMin * 60000); };
  if (!startIdle.on) { ['click', 'keydown', 'mousemove', 'touchstart'].forEach(ev => document.addEventListener(ev, reset, { passive: true })); startIdle.on = true; }
  reset();
}

/* ---------- start ---------- */
async function boot() {
  let l = 'en'; try { l = localStorage.getItem('ct.lang') || ((navigator.language || '').startsWith('ar') ? 'ar' : 'en'); } catch (e) { }
  setLang(l);
  try { S.open = JSON.parse(localStorage.getItem('ct.open') || '{}') || {}; } catch (e) { S.open = {}; }
  const r = parseHash();
  if (r.page === 'reset') { S.resetToken = r.arg; history.replaceState(null, '', location.pathname); }
  else { S.page = r.page; S.arg = r.arg; S.q = r.q; }
  const j = await api('/api/me');
  S.brand = (j && j.brand) || {}; S.policy = (j && j.policy) || S.policy;
  if (j && j.setup) { S.setup = true; S.reset = !!j.reset; render(); return; }
  if (j && j.user) {
    S.user = j.user; setLang(j.user.lang || LANG);
    if (j.forced) { S.forced = j.forced; render(); return; }
    await loadState(); startIdle(j.sessionMin);
  }
  render();
}
