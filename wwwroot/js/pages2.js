/* =========================================================
   Pages: rates, financing, accounting, reports, banking, setup
   ========================================================= */
'use strict';
const BENTYPES = ['Supplier', 'Financier', 'Customer', 'Employee', 'Other'];
const kpi = (l, v, d) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
const phead = (title, sub, btn) => `<div class="phead"><div><h1 class="h1">${title}</h1>${sub ? `<div class="sub2">${sub}</div>` : ''}</div>${btn || ''}</div>`;
const yes = v => v ? `<span class="chip c-clr">${t('Yes')}</span>` : `<span class="chip c-can">${t('No')}</span>`;
const activeChip = v => v ? `<span class="chip c-clr">${t('Active')}</span>` : `<span class="chip c-can">${t('Inactive')}</span>`;
const fld = (id, label, inner, req, cls) => `<div class="fg ${cls || ''}"><label class="lbl" for="${id}">${label}${req ? ' <span class="req">*</span>' : ''}</label>${inner}</div>`;
const inp = (id, v, extra) => `<input class="in" id="${id}" value="${esc(v ?? '')}" ${extra || ''}>`;
const sel = (id, opts, v, extra) => `<select class="in" id="${id}" ${extra || ''}>${opts.map(o => { const [k, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
const swRow = (id, label, on, hint, dis) => `<label class="swrow"><span><span class="b" style="display:block">${label}</span>${hint ? `<span class="sm mut">${hint}</span>` : ''}</span><input type="checkbox" class="sw" id="${id}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}></label>`;
const mfoot = btn => `<div class="mf"><button class="btn btn-o" onclick="closeM()">${t('Cancel')}</button>${btn}</div>`;
const usdNow = (v, cur) => { const r = latest(); return r ? conv(v, cur, 'USD', r) : 0; };
const usdT = v => money(v, 'USD');
function tbl(head, rows, empty, cls) {
  if (!rows.length) return `<div class="empty">${empty || t('Nothing here yet.')}</div>`;
  return `<div class="tw"><table class="tbl ${cls || ''}"><thead><tr>${head.map(h => `<th class="${h.n ? 'num' : ''}">${h.l ?? h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${head[i] && head[i].n ? 'num' : ''}" data-h="${esc(String(head[i] && (head[i].l ?? head[i]) || ''))}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/* =================== EXCHANGE RATES =================== */
function ratesPage() {
  const L = D.rates, fin = can.fin(), e = S.rEdit || {};
  const r0 = L[0], m30 = rateOn(addDays(today(), -30));
  const pct = (a, b) => b ? ((a - b) / b * 100) : 0;
  const ch30 = r0 && m30 && m30 !== r0 ? pct(+r0.SDG, +m30.SDG) : null;
  const last90 = L.filter(r => r.date >= addDays(today(), -90));
  const hi = last90.length ? Math.max(...last90.map(r => +r.SDG)) : null, lo = last90.length ? Math.min(...last90.map(r => +r.SDG)) : null;
  const pts = L.slice(0, 60).reverse().map(r => ({ label: fd(r.date).slice(0, 5), value: +r.SDG, tip: `${fd(r.date)}\n1 USD = ${rnum(r.SDG)} SDG\n1 USD = ${rnum(r.QAR)} QAR` }));
  const form = fin ? `<section class="card"><h2 class="h3">${e.id ? t('Correct the rate of {d}', { d: fd(e.date) }) : t('Enter a rate')}</h2>
    <div class="sm mut" style="margin-top:2px">${t('A rate used by any cheque is locked and cannot change. Alert above {p}% change.', { p: D.settings.rateAlertPct })}</div>
    <div class="fgrid">${fld('r_d', t('Date'), dateIn('r_d', e.date || today()), 1)}${fld('r_q', t('1 USD in QAR'), inp('r_q', e.QAR ?? (r0 ? r0.QAR : ''), 'inputmode="decimal" dir="ltr"'), 1)}
     ${fld('r_s', t('1 USD in SDG'), inp('r_s', e.SDG ?? '', 'inputmode="decimal" dir="ltr"'), 1)}${fld('r_src', t('Source'), inp('r_src', e.source ?? (r0 ? r0.source : ''), `placeholder="${t('e.g. Central Bank of Sudan')}"`), 1)}</div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">${e.id ? `<button class="btn btn-o" onclick="S.rEdit=null;render()">${t('Cancel')}</button>` : ''}<button class="btn btn-y" onclick="saveRate(false)">${t('Save rate')}</button></div></section>` : '';
  const f = F('rates'), p = pageOf('rates', L);
  const rows = p.rows.map((r, i) => {
    const prev = L[p.st + i + 1], d = prev ? pct(+r.SDG, +prev.SDG) : 0;
    return [FD(r.date), `<bdi dir="ltr">${rnum(r.QAR)}</bdi>`, `<bdi dir="ltr">${rnum(r.SDG)}</bdi>`,
      prev ? `<span class="${Math.abs(d) > +D.settings.rateAlertPct ? 'late' : 'mut'}"><bdi dir="ltr">${d > 0 ? '+' : ''}${d.toFixed(2)}%</bdi></span>` : '—',
      esc(r.source || '—'), `${esc(r.setBy)}<div class="sm mut">${FD(r.setAt)}</div>`,
      r.locked ? `<span class="chip c-lock">${ic('lock')}${t('Locked')}</span>` : fin ? `<button class="btn btn-o btn-sm" onclick="S.rEdit=D.rates.find(x=>x.id==='${r.id}');render();scrollTo(0,0)">${ic('edit')}${t('Correct')}</button>` : `<span class="chip c-open">${t('Not used yet')}</span>`];
  });
  return phead(t('Exchange rates'), t('Rates per 1 USD. Each cheque keeps the rate of its approval, issue and clearing.')) +
    `<div class="kpis">${kpi(t('Latest SDG rate'), r0 ? `<bdi dir="ltr">${rnum(r0.SDG)}</bdi>` : '—', r0 ? FD(r0.date) : '')}
     ${kpi(t('Change in 30 days'), ch30 == null ? '—' : `<bdi dir="ltr" class="${ch30 > 0 ? 'late' : ''}">${ch30 > 0 ? '+' : ''}${ch30.toFixed(1)}%</bdi>`, t('SDG per USD'))}
     ${kpi(t('Highest / lowest, 90 days'), hi == null ? '—' : `<bdi dir="ltr" style="font-size:22px">${rnum(hi)} / ${rnum(lo)}</bdi>`)}
     ${kpi(t('Latest QAR rate'), r0 ? `<bdi dir="ltr">${rnum(r0.QAR)}</bdi>` : '—')}</div>
    ${form}
    <section class="card"><h2 class="h3">${t('SDG per USD')}</h2><div class="sm mut" style="margin:2px 0 10px">${t('Last {n} rates · hover a point for the detail', { n: pts.length })}</div>${lineChart(pts, { plain: v => rnum(Math.round(v)), title: t('SDG per USD') })}</section>
    <div class="card flat">${tbl([t('Date'), { l: t('QAR'), n: 1 }, { l: t('SDG'), n: 1 }, { l: t('Change'), n: 1 }, t('Source'), t('Entered by'), ''], rows, t('No exchange rate yet.'))}${pager('rates', p)}</div>`;
}
async function saveRate(confirm) {
  const body = { date: dval('r_d'), QAR: val('r_q'), SDG: val('r_s'), source: val('r_src'), confirm: !!confirm };
  if (!body.date) { toast(t('Enter the date as dd/MM/yyyy.')); return; }
  const j = await act('saveRate', body, t('Rate saved'), { raw: true, after: () => { S.rEdit = null; } });
  if (j && j.confirm) confirmBox(t('Check the rate'), `<div class="warnbox">${ic('alert')}<span>${esc(tErr(j.error))}</span></div>`, t('Save anyway'), () => saveRate(true));
}

/* =================== CONTRACTS =================== */
function kStats(k) {
  const cs = D.cheques.filter(c => !['Rejected', 'Cancelled'].includes(c.status) && c.lines.some(l => l.opNo === k.opNo));
  let used = 0, paid = 0;
  cs.forEach(c => c.lines.filter(l => l.opNo === k.opNo).forEach(l => { used += +l.principal || 0; if (c.status === 'Cleared') paid += +l.principal || 0; }));
  return { used, paid, remaining: +k.principal - used, cheques: cs };
}
function contractsPage() {
  if (!can.seeAll()) return denied();
  const fin = can.fin(), L = D.contracts, f = F('k');
  const q = f.q.trim().toLowerCase();
  const rows = L.filter(k => !q || (k.opNo + ' ' + nm(B(k.financierId)) + ' ' + B(k.financierId).nameEn).toLowerCase().includes(q)).filter(k => !f.ent || String(k.entityId) === f.ent);
  const st = new Map(L.map(k => [k.id, kStats(k)]));
  const totP = L.reduce((a, k) => a + usdNow(k.principal, k.currency), 0), totR = L.reduce((a, k) => a + usdNow(st.get(k.id).remaining, k.currency), 0);
  const ending = L.filter(k => daysUntil(k.endDate) >= 0 && daysUntil(k.endDate) <= 90 && st.get(k.id).remaining > 0).length;
  const prog = L.slice().sort((a, b) => usdNow(b.principal, b.currency) - usdNow(a.principal, a.currency)).slice(0, 8).map(k => { const s = st.get(k.id); return { label: `${k.opNo} · ${nm(B(k.financierId))}`, value: s.used, total: +k.principal, sub: `${money(s.used, k.currency)} / ${money(k.principal, k.currency)}`, tip: `${k.opNo}\n${t('Requested')}: ${money(s.used, k.currency)}\n${t('Cleared')}: ${money(s.paid, k.currency)}\n${t('Remaining')}: ${money(s.remaining, k.currency)}` }; });
  const byFin = {}; L.forEach(k => { const n = nm(B(k.financierId)); byFin[n] = (byFin[n] || 0) + usdNow(st.get(k.id).remaining, k.currency); });
  const trs = rows.map(k => { const s = st.get(k.id);
    return [`<b>${esc(k.opNo)}</b><div class="sm mut">${esc(nm(B(k.financierId)))}</div>`, esc(nm(E(k.entityId))), M(k.principal, k.currency), M(k.profit, k.currency), M(s.used, k.currency),
      `<span class="${s.remaining <= 0 ? 'mut' : 'b'}">${M(s.remaining, k.currency)}</span>`, `${k.termMonths} ${t('months')} · ${k.instalments} ${t('instalments')}`,
      `${FD(k.startDate)} – ${FD(k.endDate)}${daysUntil(k.endDate) < 0 ? `<div class="sm late">${t('Ended')}</div>` : ''}`,
      `<div style="display:flex;gap:6px;flex-wrap:wrap">${fin ? `<button class="btn btn-o btn-sm" onclick="contractModal(${k.id})">${t('Edit')}</button><button class="btn btn-o btn-sm" onclick="extendModal(${k.id})">${t('Extend')}</button>` : ''}<button class="btn btn-o btn-sm" onclick="logModal(${k.id})">${t('History')}</button></div>`]; });
  return phead(t('Contracts register'), t('Financing operations. Requests for instalments must match a contract here.'), fin ? `<button class="btn btn-y" onclick="contractModal(0)">${ic('plus')}${t('Register contract')}</button>` : '') +
    `<div class="kpis">${kpi(t('Contracts'), N(L.length))}${kpi(t('Total principal (USD)'), M(totP, 'USD'), t('at the latest rate'))}${kpi(t('Remaining principal (USD)'), M(totR, 'USD'), t('not yet requested'))}${kpi(t('Ending in 90 days'), N(ending), t('with principal remaining'))}</div>
    ${L.length ? `<div class="charts"><section class="card"><h2 class="h3">${t('Principal requested so far')}</h2><div class="sm mut" style="margin:2px 0 6px">${t('Largest contracts · requested against total principal')}</div>${progRows(prog)}</section>
     <section class="card"><h2 class="h3">${t('Remaining principal by financier')}</h2><div class="sm mut" style="margin:2px 0 10px">${t('USD at the latest rate')}</div>${hbar(Object.entries(byFin).map(([l, v]) => ({ label: l, value: v })), { plain: usdT, title: t('Remaining principal by financier') })}</section></div>` : ''}
    <div class="card flat"><div class="fbar">${searchBox('k', t('Operation no. or financier'))}<select class="in" onchange="setF('k','ent',this.value)"><option value="">${t('All entities')}</option>${D.entities.map(e => `<option value="${e.id}" ${String(e.id) === f.ent ? 'selected' : ''}>${esc(nm(e))}</option>`).join('')}</select></div>
     ${tbl([t('Operation'), t('Entity'), { l: t('Principal'), n: 1 }, { l: t('Profit'), n: 1 }, { l: t('Requested'), n: 1 }, { l: t('Remaining'), n: 1 }, t('Term'), t('Period'), ''], trs, t('No contracts registered yet.'), 'cards')}</div>`;
}
function contractModal(id) {
  const k = D.contracts.find(x => x.id === id) || { currency: 'USD', entityId: (D.entities[0] || {}).id, startDate: today() };
  const fins = D.beneficiaries.filter(b => b.type === 'Financier');
  modal(`${mhead(id ? t('Edit contract {o}', { o: k.opNo }) : t('Register contract'))}<div class="mb">
   ${fins.length ? '' : `<div class="warnbox">${ic('alert')}<span>${t('Add the financier first as a beneficiary of type Financier.')}</span></div>`}
   <div class="fgrid" style="margin-top:0">${fld('k_op', t('Operation no.'), inp('k_op', k.opNo, 'dir="ltr"'), 1)}
    ${fld('k_fin', t('Financier'), sel('k_fin', [[0, t('Choose')], ...fins.map(b => [b.id, nm(b)])], k.financierId), 1)}
    ${fld('k_ent', t('Entity'), sel('k_ent', D.entities.map(e => [e.id, nm(e)]), k.entityId), 1)}${fld('k_cur', t('Currency'), sel('k_cur', CURS, k.currency), 1)}
    ${fld('k_pr', t('Principal'), inp('k_pr', k.principal, 'inputmode="decimal" dir="ltr"'), 1)}${fld('k_pf', t('Profit'), inp('k_pf', k.profit, 'inputmode="decimal" dir="ltr"'), 1)}
    ${fld('k_tm', t('Term (months)'), inp('k_tm', k.termMonths, 'inputmode="numeric" dir="ltr"'), 1)}${fld('k_in', t('Number of instalments'), inp('k_in', k.instalments, 'inputmode="numeric" dir="ltr"'), 1)}
    ${fld('k_sd', t('Start date'), dateIn('k_sd', k.startDate), 1)}${fld('k_nt', t('Notes'), inp('k_nt', k.notes), 0, 'full')}</div></div>
   ${mfoot(`<button class="btn btn-y" onclick="act('saveContract',{id:${id},opNo:val('k_op'),financierId:val('k_fin'),entityId:val('k_ent'),currency:val('k_cur'),principal:val('k_pr'),profit:val('k_pf'),termMonths:val('k_tm'),instalments:val('k_in'),startDate:dval('k_sd'),notes:val('k_nt')},'${js(t('Contract saved'))}',{after:closeM})">${t('Save')}</button>`)}`, true);
}
function extendModal(id) {
  const k = D.contracts.find(x => x.id === id);
  modal(`${mhead(t('Extend contract {o}', { o: k.opNo }), t('Ends on {d}', { d: fd(k.endDate) }))}<div class="mb"><div class="fgrid" style="margin-top:0">
   ${fld('x_m', t('Add months'), inp('x_m', '', 'inputmode="numeric" dir="ltr"'), 1)}${fld('x_i', t('New number of instalments (optional)'), inp('x_i', '', 'inputmode="numeric" dir="ltr"'))}${fld('x_n', t('Note'), inp('x_n', '', `placeholder="${t('e.g. rescheduling letter ref.')}"`), 1, 'full')}</div></div>
   ${mfoot(`<button class="btn btn-y" onclick="act('extendContract',{id:${id},months:val('x_m'),instalments:val('x_i'),note:val('x_n')},'${js(t('Contract extended'))}',{after:j=>{closeM();S.after=()=>confirmBox(t('Contract extended'),'<div class=&quot;vbox&quot;>'+esc(tErr(j.alert||''))+'</div>',t('OK'),null)}})">${t('Extend')}</button>`)}`);
}
function logModal(id) {
  const k = D.contracts.find(x => x.id === id); let log = []; try { log = JSON.parse(k.log || '[]'); } catch (e) { }
  const s = kStats(k);
  modal(`${mhead(t('Contract {o}', { o: k.opNo }), esc(nm(B(k.financierId))))}<div class="mb">
   <h3 class="h3" style="margin-bottom:12px">${t('History')}</h3>${log.slice().reverse().map(x => `<div class="tl"><div>${esc(x.text)} · <span class="mut">${esc(x.by)}</span></div><div class="sm mut">${FD(x.at)}</div></div>`).join('') || `<div class="mut">${t('No history.')}</div>`}
   <h3 class="h3" style="margin:16px 0 8px">${t('Requests against this contract')}</h3>${s.cheques.map(c => `<div class="task"><a class="lnk" href="#/cheque/${c.id}" onclick="closeM()"><bdi dir="ltr">${c.id}</bdi></a> ${chip(c.status)} <span class="sm mut">${payTxt(c)}</span></div>`).join('') || `<div class="mut">${t('None yet.')}</div>`}</div>`, true);
}

/* =================== PAYMENTS ON ACCOUNT =================== */
function poaPage() {
  if (!can.seeAll()) return denied();
  const L = visible().filter(c => isPoa(c) && !['Rejected', 'Cancelled'].includes(c.status));
  const open = L.filter(c => !c.poa), over = open.filter(c => daysUntil(c.poaSettleDate) < 0);
  return phead(t('Payments on account'), t('Advance payments waiting for the invoice that settles them')) +
    `<div class="kpis">${kpi(t('Open'), N(open.length))}${kpi(t('Overdue to settle'), `<span class="${over.length ? 'late' : ''}">${N(over.length)}</span>`)}${kpi(t('Open value (USD)'), M(open.reduce((a, c) => a + usdOf(c), 0), 'USD'))}${kpi(t('Settled'), N(L.length - open.length))}</div>` +
    chqList('poa', L, [{ k: 'open', label: t('Open'), f: c => !c.poa, sort: (a, b) => (a.poaSettleDate || '') < (b.poaSettleDate || '') ? -1 : 1 }, { k: 'od', label: t('Overdue'), f: c => !c.poa && daysUntil(c.poaSettleDate) < 0 }, { k: 'done', label: t('Settled'), f: c => !!c.poa }], t('No payments on account.'));
}

/* =================== JOURNAL ENTRIES =================== */
const KINDS = ['Issue', 'Revaluation', 'Revaluation reversal', 'Clearing', 'Return', 'Payment on account settled'];
function entriesPage() {
  if (!can.seeAll()) return denied();
  const f = F('je', { kind: '', post: '' });
  let L = visible().flatMap(c => entriesOf(c, f.x ? [f.x] : []));
  if (f.ent) L = L.filter(e => String(e.c.entityId) === f.ent);
  if (f.kind) L = L.filter(e => e.kind === f.kind);
  if (f.post === 'no') L = L.filter(e => !postedOf(e.key)); if (f.post === 'yes') L = L.filter(e => postedOf(e.key));
  if (f.from || f.to) L = L.filter(e => inRange(f, e.date));
  const q = f.q.trim().toLowerCase(); if (q) L = L.filter(e => (e.key + ' ' + e.c.id + ' ' + B(e.c.benId).nameEn).toLowerCase().includes(q));
  L.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : a.key < b.key ? 1 : -1);
  S.jeRows = L;
  const notPosted = L.filter(e => !postedOf(e.key)).length;
  const p = pageOf('je', L);
  return phead(t('Journal entries'), t('Built from each cheque. Post them in the accounting system, then mark them here.'), `<button class="btn btn-o" onclick="exportEntries()">${ic('dl')}${t('Export to Excel')}</button>`) +
   `<div class="kpis">${kpi(t('Entries shown'), N(L.length))}${kpi(t('Not posted yet'), `<span class="${notPosted ? 'late' : ''}">${N(notPosted)}</span>`)}${kpi(t('Posted'), N(L.length - notPosted))}</div>
   <div class="card flat"><div class="fbar">${searchBox('je', t('Cheque or beneficiary'))}
    <select class="in" onchange="setF('je','ent',this.value)"><option value="">${t('All entities')}</option>${D.entities.map(e => `<option value="${e.id}" ${String(e.id) === f.ent ? 'selected' : ''}>${esc(nm(e))}</option>`).join('')}</select>
    <select class="in" onchange="setF('je','kind',this.value)"><option value="">${t('All entry types')}</option>${KINDS.map(k => `<option value="${k}" ${k === f.kind ? 'selected' : ''}>${t(k)}</option>`).join('')}</select>
    <select class="in" onchange="setF('je','post',this.value)"><option value="">${t('Posted and not posted')}</option><option value="no" ${f.post === 'no' ? 'selected' : ''}>${t('Not posted')}</option><option value="yes" ${f.post === 'yes' ? 'selected' : ''}>${t('Posted')}</option></select>
    <div style="display:flex;gap:8px;align-items:center"><span class="sm mut">${t('Revalue at')}</span><div style="width:150px">${dateIn('je_x', f.x, `onchange="setF('je','x',pd(this.value))"`)}</div></div></div>
    <div style="padding:0 16px 8px">${f.x ? `<div class="note" style="margin-top:12px">${t('Revaluation of outstanding foreign-currency cheques at the rate of {d}, reversed the next day.', { d: fd(f.x) })}</div>` : ''}${p.rows.map(e => entryHtml(e)).join('') || `<div class="empty">${t('No entries match.')}</div>`}</div>${pager('je', p)}</div>`;
}
function exportEntries() {
  const rows = [];
  (S.jeRows || []).forEach(e => { const p = postedOf(e.key); e.lines.forEach(l => rows.push([e.key, fd(e.date), e.kind, e.c.id, B(e.c.benId).nameEn, E(e.c.entityId).nameEn, l[0], l[1], l[2] || '', l[3] || '', e.cur, p ? p.by : '', p ? fd(p.at) : ''])); });
  csv('journal-entries', ['Entry', 'Date', 'Type', 'Cheque', 'Beneficiary', 'Entity', 'Account', 'Description', 'Debit', 'Credit', 'Currency', 'Posted by', 'Posted on'], rows);
}

/* =================== REPORTS =================== */
const REPORTS = [['overview', 'Overview'], ['outstanding', 'Outstanding & revaluation'], ['realised', 'Realised FX differences'], ['ageing', 'Due & ageing'], ['entity', 'By entity & currency'], ['contracts', 'Contracts & remaining principal'], ['poa', 'Payments on account'], ['prior', 'Payments before request']];
function reportsPage() {
  if (!can.seeAll()) return denied();
  const f = F('rep', { tab: 'overview' });
  const fn = { overview: repOverview, outstanding: repOutstanding, realised: repRealised, ageing: repAgeing, entity: repEntity, contracts: repContracts, poa: repPoa, prior: repPrior }[f.tab] || repOverview;
  const r = fn(f);
  S.repCsv = r.csv;
  return phead(t('Reports'), t('Figures in USD use the rate saved with each cheque unless the report says otherwise.'), `<div style="display:flex;gap:8px">${r.csv ? `<button class="btn btn-o" onclick="csv(S.repCsv.name,S.repCsv.head,S.repCsv.rows)">${ic('dl')}${t('Export to Excel')}</button>` : ''}<button class="btn btn-o" onclick="print()">${ic('print')}${t('Print')}</button></div>`) +
   `<div class="ul-tabs" role="tablist">${REPORTS.map(([k, l]) => `<button role="tab" aria-selected="${k === f.tab}" class="${k === f.tab ? 'on' : ''}" onclick="setF('rep','tab','${k}')">${t(l)}</button>`).join('')}</div>
   ${r.filters ? `<div class="card" style="padding:14px 16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">${r.filters}</div>` : ''}
   ${r.kpis ? `<div class="kpis">${r.kpis}</div>` : ''}${r.charts ? `<div class="charts">${r.charts}</div>` : ''}${r.table ? `<div class="card flat">${r.table}</div>` : ''}`;
}
const ccard = (title, sub, body) => `<section class="card"><h2 class="h3">${title}</h2><div class="sm mut" style="margin:2px 0 10px">${sub}</div>${body}</section>`;
const dFilter = (key, prop, label, v) => `<div style="display:flex;gap:8px;align-items:center"><span class="sm mut">${label}</span><div style="width:150px">${dateIn(key + '_' + prop, v, `onchange="setF('${key}','${prop}',pd(this.value))"`)}</div></div>`;
const entSel = f => `<select class="in" style="width:auto" onchange="setF('rep','ent',this.value)"><option value="">${t('All entities')}</option>${D.entities.map(e => `<option value="${e.id}" ${String(e.id) === f.ent ? 'selected' : ''}>${esc(nm(e))}</option>`).join('')}</select>`;
const byEnt = (f, L) => f.ent ? L.filter(c => String(c.entityId) === f.ent) : L;
const days = (a, b) => (a && b) ? Math.round((new Date(b.slice(0, 10) + 'T12:00:00Z') - new Date(a.slice(0, 10) + 'T12:00:00Z')) / 864e5) : null;
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const dTxt = v => v == null ? '—' : `${v.toFixed(1)} <span class="sm mut" style="font-weight:400">${t('days')}</span>`;

function repOverview(f) {
  const L = byEnt(f, visible()).filter(c => !['Rejected', 'Cancelled'].includes(c.status));
  const a1 = avg(L.filter(c => c.appr).map(c => days(c.createdAt, c.appr.at)));
  const a2 = avg(L.filter(c => c.issue && c.appr).map(c => days((c.appr2 || c.appr).at, c.issue.at)));
  const a3 = avg(L.filter(c => c.closed && c.closed.status === 'Cleared').map(c => days(c.issue.at, c.closed.at)));
  const closed = L.filter(c => c.closed), ret = closed.filter(c => c.closed.status === 'Returned');
  const all = visible(), rej = all.filter(c => c.status === 'Rejected').length, decided = all.filter(c => c.appr || c.status === 'Rejected').length;
  const top = {}; L.forEach(c => { const k = nm(B(c.benId)); top[k] = (top[k] || 0) + usdOf(c); });
  const ops = {}; L.forEach(c => { ops[t(c.opType)] = (ops[t(c.opType)] || 0) + usdOf(c); });
  const months = lastMonths(12);
  const mv = months.map(m => L.filter(c => c.appr && c.appr.at.slice(0, 7) === m.key));
  return {
    filters: entSel(f),
    kpis: kpi(t('Request → CFO approval'), dTxt(a1), t('average')) + kpi(t('Approval → cheque issued'), dTxt(a2), t('average')) + kpi(t('Issued → cleared'), dTxt(a3), t('average')) +
      kpi(t('Returned cheques'), closed.length ? `${(ret.length / closed.length * 100).toFixed(1)}%` : '—', t('{a} of {b} cleared or returned', { a: ret.length, b: closed.length })) +
      kpi(t('Rejected requests'), decided ? `${(rej / decided * 100).toFixed(1)}%` : '—', t('{a} of {b} decided', { a: rej, b: decided })),
    charts: ccard(t('Approved per month, last 12 months'), t('USD equivalent · hover for the count'), vbars(months.map(m => m.label.slice(0, 2) + '/' + m.label.slice(5)), [{ name: t('Approved'), values: mv.map(l => l.reduce((a, c) => a + usdOf(c), 0)), color: CH.gold }], { plain: usdT, tipx: i => t('{n} cheques', { n: mv[i].length }), title: t('Approved per month') })) +
      ccard(t('Top beneficiaries'), t('All requests except rejected and cancelled · USD'), hbar(Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([l, v]) => ({ label: l, value: v })), { plain: usdT, title: t('Top beneficiaries') })) +
      ccard(t('By operation type'), t('USD equivalent'), hbar(Object.entries(ops).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ label: l, value: v })), { plain: usdT, color: CH.blue, title: t('By operation type') }))
  };
}
function repOutstanding(f) {
  const d = f.x || today(), r = rateOn(d);
  const L = byEnt(f, visible()).filter(c => c.issue && c.purpose !== 'Guarantee' && c.issue.at.slice(0, 10) <= d && !(c.closed && c.closed.at.slice(0, 10) <= d) && !['Cancelled', 'Rejected'].includes(c.status));
  const rows = L.map(c => {
    const fc = c.appr.funcCur || E(c.entityId).funcCur, p = c.payCur || c.currency, carry = c.issue.carry != null ? +c.issue.carry : +c.appr.funcVal;
    const now = r ? round(conv(c.payAmt, p, fc, r), fc) : carry, diff = round(now - carry, fc), usd = r ? conv(c.payAmt, p, 'USD', r) : usdOf(c);
    return { c, fc, p, carry, now, diff, usd, diffUsd: r ? diff / perUsd(fc, r) : 0 };
  });
  const byAcc = {}; rows.forEach(x => { const k = AC(x.c.issue.accountId) ? acctName(AC(x.c.issue.accountId)) : x.c.issue.bank; byAcc[k] = (byAcc[k] || 0) + x.usd; });
  const net = rows.reduce((a, x) => a + x.diffUsd, 0);
  return {
    filters: entSel(f) + dFilter('rep', 'x', t('Report date'), d) + (r ? `<span class="sm mut">${t('Rate of {d}: 1 USD = {s} SDG, {q} QAR', { d: fd(r.date), s: rnum(r.SDG), q: rnum(r.QAR) })}</span>` : `<span class="late sm">${t('No rate on or before this date.')}</span>`),
    kpis: kpi(t('Outstanding cheques'), N(rows.length)) + kpi(t('Outstanding value (USD)'), M(rows.reduce((a, x) => a + x.usd, 0), 'USD'), t('at the report-date rate')) + kpi(t('Unrealised FX difference (USD)'), net > 0 ? `<span class="loss">${t('Loss')} ${M(net, 'USD')}</span>` : net < 0 ? `<span class="gain">${t('Gain')} ${M(-net, 'USD')}</span>` : M(0, 'USD')),
    charts: ccard(t('Outstanding by bank account'), t('USD at the report-date rate'), hbar(Object.entries(byAcc).map(([l, v]) => ({ label: l, value: v })), { plain: usdT, title: t('Outstanding by bank account') })),
    table: tbl([t('Cheque'), t('Entity'), t('Cheque no.'), { l: t('Cheque amount'), n: 1 }, { l: t('Carrying value'), n: 1 }, { l: t('Value at report date'), n: 1 }, { l: t('Difference'), n: 1 }, t('Due date')],
      rows.map(x => [`<a class="lnk" href="#/cheque/${x.c.id}"><bdi dir="ltr">${x.c.id}</bdi></a><div class="sm mut">${esc(nm(B(x.c.benId)))}</div>`, esc(nm(E(x.c.entityId))), `<bdi dir="ltr">${esc(x.c.issue.no)}</bdi>`, M(x.c.payAmt, x.p), M(x.carry, x.fc), M(x.now, x.fc), fxSpan(x.diff, x.fc), FD(x.c.dueDate)]), t('No outstanding cheques on this date.'), 'cards'),
    csv: { name: 'outstanding-' + d, head: ['Cheque', 'Beneficiary', 'Entity', 'Cheque no.', 'Account', 'Cheque amount', 'Currency', 'Functional currency', 'Carrying value', 'Value at report date', 'Difference (+ loss / - gain)', 'USD at report date', 'Due date'], rows: rows.map(x => [x.c.id, B(x.c.benId).nameEn, E(x.c.entityId).nameEn, x.c.issue.no, x.c.issue.bank, x.c.payAmt, x.p, x.fc, x.carry, x.now, x.diff, round(x.usd, 'USD'), fd(x.c.dueDate)]) }
  };
}
function repRealised(f) {
  const from = f.from || addDays(today(), -182), to = f.to || today();
  const L = byEnt(f, visible()).filter(c => c.closed && c.closed.status === 'Cleared' && c.closed.at.slice(0, 10) >= from && c.closed.at.slice(0, 10) <= to);
  const rows = L.map(c => { const fc = c.appr.funcCur || E(c.entityId).funcCur, r = { QAR: +c.closed.qar, SDG: +c.closed.sdg }, iss = +c.issue.fxDiff || 0, clr = +c.closed.fxDiff || 0; return { c, fc, iss, clr, usd: r.SDG ? (iss + clr) / perUsd(fc, r) : 0 }; });
  const months = lastMonths(6), mv = months.map(m => -rows.filter(x => x.c.closed.at.slice(0, 7) === m.key).reduce((a, x) => a + x.usd, 0));
  const net = rows.reduce((a, x) => a + x.usd, 0);
  return {
    filters: entSel(f) + dFilter('rep', 'from', t('Cleared from'), from) + dFilter('rep', 'to', t('to'), to),
    kpis: kpi(t('Cheques cleared'), N(rows.length)) + kpi(t('Net FX difference (USD)'), net > 0 ? `<span class="loss">${t('Loss')} ${M(net, 'USD')}</span>` : net < 0 ? `<span class="gain">${t('Gain')} ${M(-net, 'USD')}</span>` : M(0, 'USD'), t('at issue and at clearing')) +
      kpi(t('Cheques with a loss'), N(rows.filter(x => x.iss + x.clr > 0).length)) + kpi(t('Cheques with a gain'), N(rows.filter(x => x.iss + x.clr < 0).length)),
    charts: ccard(t('Realised FX result per month'), t('Last 6 months · USD · gain up, loss down'), signedBars(months.map(m => m.label), mv, { plain: usdT, title: t('Realised FX result per month') })),
    table: tbl([t('Cheque'), t('Entity'), t('Cleared'), { l: t('At issue'), n: 1 }, { l: t('At clearing'), n: 1 }, { l: t('Total'), n: 1 }], rows.map(x => [`<a class="lnk" href="#/cheque/${x.c.id}"><bdi dir="ltr">${x.c.id}</bdi></a><div class="sm mut">${esc(nm(B(x.c.benId)))}</div>`, esc(nm(E(x.c.entityId))), FD(x.c.closed.at), fxSpan(x.iss, x.fc), fxSpan(x.clr, x.fc), fxSpan(x.iss + x.clr, x.fc)]), t('No cheques cleared in this period.'), 'cards'),
    csv: { name: 'realised-fx', head: ['Cheque', 'Beneficiary', 'Entity', 'Cleared on', 'Functional currency', 'FX difference at issue', 'FX difference at clearing', 'Total (+ loss / - gain)', 'Total USD'], rows: rows.map(x => [x.c.id, B(x.c.benId).nameEn, E(x.c.entityId).nameEn, fd(x.c.closed.at), x.fc, x.iss, x.clr, x.iss + x.clr, round(x.usd, 'USD')]) }
  };
}
function repAgeing(f) {
  const L = byEnt(f, visible()).filter(c => ['Approved', 'Posted', 'Received', 'Delivered'].includes(c.status));
  const B_ = [[t('Overdue over 30 days'), n => n < -30], [t('Overdue 1–30 days'), n => n < 0 && n >= -30], [t('Due in 0–7 days'), n => n >= 0 && n <= 7], [t('8–30 days'), n => n > 7 && n <= 30], [t('31–60 days'), n => n > 30 && n <= 60], [t('61–90 days'), n => n > 60 && n <= 90], [t('Over 90 days'), n => n > 90]];
  const g = B_.map(([l, fn]) => { const x = L.filter(c => fn(daysUntil(c.dueDate))); return { l, x, v: x.reduce((a, c) => a + usdOf(c), 0) }; });
  const od = g[0].x.length + g[1].x.length;
  return {
    filters: entSel(f),
    kpis: kpi(t('Open commitments'), N(L.length)) + kpi(t('Value (USD)'), M(L.reduce((a, c) => a + usdOf(c), 0), 'USD')) + kpi(t('Overdue'), `<span class="${od ? 'late' : ''}">${N(od)}</span>`, M(g[0].v + g[1].v, 'USD')) + kpi(t('Due in 7 days'), N(g[2].x.length), M(g[2].v, 'USD')),
    charts: ccard(t('Commitments by due date'), t('Approved and issued, not cleared · USD · hover for the count'), vbars(g.map(x => x.l), [{ name: t('Due'), values: g.map(x => x.v), color: CH.gold }], { plain: usdT, tipx: i => t('{n} cheques', { n: g[i].x.length }), title: t('Commitments by due date') })),
    table: tbl([t('Period'), { l: t('Cheques'), n: 1 }, { l: t('Value (USD)'), n: 1 }, t('Cheques')], g.map(x => [x.l, N(x.x.length), M(x.v, 'USD'), x.x.slice(0, 6).map(c => `<a href="#/cheque/${c.id}"><bdi dir="ltr">${c.id}</bdi></a>`).join(', ') + (x.x.length > 6 ? ' …' : '')])),
    csv: { name: 'ageing', head: ['Cheque', 'Beneficiary', 'Entity', 'Stage', 'Due date', 'Days', 'Cheque amount', 'Currency', 'USD'], rows: L.map(c => [c.id, B(c.benId).nameEn, E(c.entityId).nameEn, stageName(c.status), fd(c.dueDate), daysUntil(c.dueDate), c.payAmt ?? c.amount, c.payCur, round(usdOf(c), 'USD')]) }
  };
}
function repEntity(f) {
  const from = f.from || addDays(today(), -365), to = f.to || today();
  const L = visible().filter(c => c.appr && !['Rejected', 'Cancelled'].includes(c.status) && c.appr.at.slice(0, 10) >= from && c.appr.at.slice(0, 10) <= to);
  const rows = []; D.entities.forEach(e => CURS.forEach(cur => { const x = L.filter(c => c.entityId === e.id && (c.payCur || c.currency) === cur); if (x.length) rows.push({ e, cur, n: x.length, amt: x.reduce((a, c) => a + +(c.payAmt ?? c.amount), 0), usd: x.reduce((a, c) => a + usdOf(c), 0), open: x.filter(c => OUTSTANDING.includes(c.status) || c.status === 'Approved').reduce((a, c) => a + usdOf(c), 0) }); }));
  const ent = D.entities.map(e => ({ label: nm(e), value: rows.filter(r => r.e === e).reduce((a, r) => a + r.usd, 0) }));
  const curs = CURS.map(c => ({ label: c, value: rows.filter(r => r.cur === c).reduce((a, r) => a + r.usd, 0), color: CH.blue }));
  return {
    filters: dFilter('rep', 'from', t('Approved from'), from) + dFilter('rep', 'to', t('to'), to),
    kpis: kpi(t('Approved cheques'), N(L.length)) + kpi(t('Approved value (USD)'), M(L.reduce((a, c) => a + usdOf(c), 0), 'USD')),
    charts: ccard(t('By entity'), t('USD at the approval rate'), hbar(ent, { plain: usdT, title: t('By entity') })) + ccard(t('By payment currency'), t('USD at the approval rate'), hbar(curs, { plain: usdT, title: t('By payment currency') })),
    table: tbl([t('Entity'), t('Currency'), { l: t('Cheques'), n: 1 }, { l: t('Amount'), n: 1 }, { l: t('USD'), n: 1 }, { l: t('Still open (USD)'), n: 1 }], rows.map(r => [esc(nm(r.e)), r.cur, N(r.n), M(r.amt, r.cur), M(r.usd, 'USD'), M(r.open, 'USD')]), t('No approved cheques in this period.')),
    csv: { name: 'by-entity', head: ['Entity', 'Currency', 'Cheques', 'Amount', 'USD', 'Still open USD'], rows: rows.map(r => [r.e.nameEn, r.cur, r.n, r.amt, round(r.usd, 'USD'), round(r.open, 'USD')]) }
  };
}
function repContracts(f) {
  const L = D.contracts.filter(k => !f.ent || String(k.entityId) === f.ent).map(k => ({ k, s: kStats(k) }));
  return {
    filters: entSel(f),
    kpis: kpi(t('Contracts'), N(L.length)) + kpi(t('Remaining principal (USD)'), M(L.reduce((a, x) => a + usdNow(x.s.remaining, x.k.currency), 0), 'USD'), t('at the latest rate')) + kpi(t('Fully requested'), N(L.filter(x => x.s.remaining <= 0).length)),
    charts: ccard(t('Remaining principal by contract'), t('USD at the latest rate'), hbar(L.map(x => ({ label: x.k.opNo + ' · ' + nm(B(x.k.financierId)), value: usdNow(x.s.remaining, x.k.currency) })).sort((a, b) => b.value - a.value).slice(0, 10), { plain: usdT, title: t('Remaining principal by contract') })) +
      ccard(t('Paid (cleared) against principal'), t('Largest contracts'), progRows(L.slice().sort((a, b) => usdNow(b.k.principal, b.k.currency) - usdNow(a.k.principal, a.k.currency)).slice(0, 8).map(x => ({ label: x.k.opNo, value: x.s.paid, total: +x.k.principal, sub: `${money(x.s.paid, x.k.currency)} / ${money(x.k.principal, x.k.currency)}` })))),
    table: tbl([t('Operation'), t('Financier'), { l: t('Principal'), n: 1 }, { l: t('Requested'), n: 1 }, { l: t('Cleared'), n: 1 }, { l: t('Remaining'), n: 1 }, t('Ends')], L.map(x => [esc(x.k.opNo), esc(nm(B(x.k.financierId))), M(x.k.principal, x.k.currency), M(x.s.used, x.k.currency), M(x.s.paid, x.k.currency), M(x.s.remaining, x.k.currency), FD(x.k.endDate)]), t('No contracts registered yet.')),
    csv: { name: 'contracts', head: ['Operation', 'Financier', 'Entity', 'Currency', 'Principal', 'Profit', 'Requested principal', 'Cleared principal', 'Remaining principal', 'Start', 'End'], rows: L.map(x => [x.k.opNo, B(x.k.financierId).nameEn, E(x.k.entityId).nameEn, x.k.currency, x.k.principal, x.k.profit, x.s.used, x.s.paid, x.s.remaining, fd(x.k.startDate), fd(x.k.endDate)]) }
  };
}
function repPoa(f) {
  const L = byEnt(f, visible()).filter(c => isPoa(c) && !['Rejected', 'Cancelled'].includes(c.status) && !c.poa);
  const by = {}; L.forEach(c => { const k = nm(B(c.benId)); by[k] = (by[k] || 0) + usdOf(c); });
  return {
    filters: entSel(f),
    kpis: kpi(t('Open payments on account'), N(L.length)) + kpi(t('Open value (USD)'), M(L.reduce((a, c) => a + usdOf(c), 0), 'USD')) + kpi(t('Overdue to settle'), N(L.filter(c => daysUntil(c.poaSettleDate) < 0).length)),
    charts: ccard(t('Open by beneficiary'), t('USD'), hbar(Object.entries(by).map(([l, v]) => ({ label: l, value: v })), { plain: usdT, title: t('Open by beneficiary') })),
    table: tbl([t('Cheque'), t('Entity'), { l: t('Amount'), n: 1 }, t('Settle by'), t('Stage')], L.map(c => [`<a class="lnk" href="#/cheque/${c.id}"><bdi dir="ltr">${c.id}</bdi></a><div class="sm mut">${esc(nm(B(c.benId)))}</div>`, esc(nm(E(c.entityId))), payTxt(c), `${FD(c.poaSettleDate)}${daysUntil(c.poaSettleDate) < 0 ? `<div class="sm late">${t('{n} days overdue', { n: -daysUntil(c.poaSettleDate) })}</div>` : ''}`, chip(c.status)]), t('No open payments on account.'), 'cards'),
    csv: { name: 'payments-on-account', head: ['Cheque', 'Beneficiary', 'Entity', 'Amount', 'Currency', 'USD', 'Settle by', 'Stage'], rows: L.map(c => [c.id, B(c.benId).nameEn, E(c.entityId).nameEn, c.payAmt ?? c.amount, c.payCur, round(usdOf(c), 'USD'), fd(c.poaSettleDate), stageName(c.status)]) }
  };
}
function repPrior(f) {
  const L = byEnt(f, visible()).filter(c => c.priorPaid);
  const months = lastMonths(6), mv = months.map(m => L.filter(c => c.createdAt.slice(0, 7) === m.key));
  const gaps = L.map(c => days(c.priorDate, c.createdAt)).filter(x => x != null);
  return {
    filters: entSel(f),
    kpis: kpi(t('Payments before request'), N(L.length)) + kpi(t('Value (USD)'), M(L.reduce((a, c) => a + usdOf(c), 0), 'USD')) + kpi(t('Average delay to request'), dTxt(avg(gaps))),
    charts: ccard(t('Per month'), t('Requests flagged as paid before the request · USD · hover for the count'), vbars(months.map(m => m.label), [{ name: t('Value'), values: mv.map(l => l.reduce((a, c) => a + usdOf(c), 0)), color: CH.gold }], { plain: usdT, tipx: i => t('{n} cheques', { n: mv[i].length }), title: t('Payments before request') })),
    table: tbl([t('Cheque'), t('Requested by'), t('Date paid'), t('Requested on'), { l: t('Days'), n: 1 }, t('How it was paid'), t('Stage')], L.map(c => [`<a class="lnk" href="#/cheque/${c.id}"><bdi dir="ltr">${c.id}</bdi></a><div class="sm mut">${esc(nm(B(c.benId)))} · ${payTxt(c)}</div>`, esc(U(c.requesterId).fullName), FD(c.priorDate), FD(c.createdAt), N(days(c.priorDate, c.createdAt)), `${esc(c.priorMethod || '')} · ${esc(c.priorRef || '')}`, chip(c.status)]), t('None.'), 'cards'),
    csv: { name: 'paid-before-request', head: ['Cheque', 'Beneficiary', 'Requested by', 'Date paid', 'Requested on', 'Days', 'Method', 'Reference', 'Amount', 'Currency', 'Stage'], rows: L.map(c => [c.id, B(c.benId).nameEn, U(c.requesterId).fullName, fd(c.priorDate), fd(c.createdAt), days(c.priorDate, c.createdAt), c.priorMethod, c.priorRef, c.amount, c.currency, stageName(c.status)]) }
  };
}

/* =================== BANKING =================== */
function banksPage() {
  if (!can.seeAll()) return denied();
  const cfo = can.banking();
  const bRows = D.banks.map(b => [`<b>${esc(nm(b))}</b>${b.nameAr && LANG !== 'ar' ? `<div class="sm mut" dir="rtl">${esc(b.nameAr)}</div>` : ''}`, b.currency, N(D.accounts.filter(a => a.bankId === b.id).length), activeChip(b.active), cfo ? `<button class="btn btn-o btn-sm" onclick="bankModal(${b.id})">${t('Edit')}</button>` : '']);
  const aRows = D.accounts.map(a => {
    const iss = D.cheques.filter(c => c.issue && c.issue.accountId === a.id), out = iss.filter(c => OUTSTANDING.includes(c.status));
    const nf = nextFree(a.id), left = D.books.filter(k => k.accountId === a.id && k.active).reduce((s, k) => s + (k.to - k.from + 1), 0) - iss.length - D.voided.filter(v => v.accountId === a.id).length;
    return [`<b>${esc(nm(BK(a.bankId)))} ••${esc(a.last4)}</b><div class="sm mut">${esc(a.description || '')}</div>`, esc(nm(E(a.entityId))), a.currency, `<bdi dir="ltr">${esc(a.ledger || '—')}</bdi>`, N(iss.length), M(out.reduce((s, c) => s + usdOf(c), 0), 'USD'),
      nf ? `<bdi dir="ltr">${nf}</bdi><div class="sm ${left < 10 ? 'late' : 'mut'}">${t('{n} left', { n: Math.max(0, left) })}</div>` : `<span class="late">${t('No chequebook')}</span>`, activeChip(a.active), cfo ? `<button class="btn btn-o btn-sm" onclick="accountModal(${a.id})">${t('Edit')}</button>` : ''];
  });
  const byB = D.accounts.map(a => ({ label: `${nm(BK(a.bankId))} ••${a.last4}`, value: D.cheques.filter(c => c.issue && c.issue.accountId === a.id && OUTSTANDING.includes(c.status)).reduce((s, c) => s + usdOf(c), 0) }));
  return phead(t('Banks & accounts'), cfo ? t('Each account belongs to one entity and one currency.') : t('Managed by the CFO.'), cfo ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-o" onclick="bankModal(0)">${ic('plus')}${t('Add bank')}</button><button class="btn btn-y" onclick="accountModal(0)" ${D.banks.length ? '' : 'disabled'}>${ic('plus')}${t('Add account')}</button></div>` : '') +
    `<section class="card flat"><div style="padding:16px 16px 4px"><h2 class="h3">${t('Banks')}</h2></div>${tbl([t('Bank'), t('Currency'), { l: t('Accounts'), n: 1 }, t('Status'), ''], bRows, t('No banks yet.'))}</section>
     <section class="card flat"><div style="padding:16px 16px 4px"><h2 class="h3">${t('Accounts')}</h2></div>${tbl([t('Account'), t('Entity'), t('Currency'), t('Ledger account'), { l: t('Cheques issued'), n: 1 }, { l: t('Outstanding (USD)'), n: 1 }, t('Next number'), t('Status'), ''], aRows, t('No accounts yet.'), 'cards')}</section>
     ${D.accounts.length ? `<div class="charts">${ccard(t('Outstanding cheques by account'), t('Issued and not yet cleared · USD'), hbar(byB, { plain: usdT, title: t('Outstanding cheques by account') }))}</div>` : ''}`;
}
function bankModal(id) {
  const b = D.banks.find(x => x.id === id) || { currency: 'SDG', active: true };
  modal(`${mhead(id ? t('Edit bank') : t('Add bank'))}<div class="mb"><div class="fgrid" style="margin-top:0">${fld('b_en', t('Name (English)'), inp('b_en', b.nameEn), 1)}${fld('b_ar', t('Name (Arabic)'), inp('b_ar', b.nameAr, 'dir="rtl"'))}${fld('b_cur', t('Currency'), sel('b_cur', CURS, b.currency), 1)}</div>${id ? swRow('b_act', t('Active'), b.active) : ''}</div>
   ${mfoot(`<button class="btn btn-y" onclick="act('saveBank',{id:${id},nameEn:val('b_en'),nameAr:val('b_ar'),currency:val('b_cur'),active:${id ? "chk('b_act')" : 'true'}},'${js(t('Saved'))}',{after:closeM})">${t('Save')}</button>`)}`);
}
function accountModal(id) {
  const a = D.accounts.find(x => x.id === id) || { bankId: (D.banks[0] || {}).id, entityId: (D.entities[0] || {}).id, active: true };
  modal(`${mhead(id ? t('Edit account') : t('Add account'))}<div class="mb"><div class="fgrid" style="margin-top:0">
   ${fld('a_b', t('Bank'), sel('a_b', D.banks.map(b => [b.id, `${nm(b)} · ${b.currency}`]), a.bankId), 1)}${fld('a_e', t('Entity'), sel('a_e', D.entities.map(e => [e.id, nm(e)]), a.entityId), 1)}
   ${fld('a_l4', t('Last 4 digits of the account number'), inp('a_l4', a.last4, 'inputmode="numeric" maxlength="4" dir="ltr"'), 1)}${fld('a_lg', t('Ledger account'), inp('a_lg', a.ledger, 'dir="ltr"'))}${fld('a_d', t('Description'), inp('a_d', a.description), 0, 'full')}</div>
   <div class="hint">${t('Store only the last 4 digits — never the full account number.')}</div>${id ? swRow('a_act', t('Active'), a.active) : ''}</div>
   ${mfoot(`<button class="btn btn-y" onclick="act('saveAccount',{id:${id},bankId:val('a_b'),entityId:val('a_e'),last4:val('a_l4'),ledger:val('a_lg'),description:val('a_d'),active:${id ? "chk('a_act')" : 'true'}},'${js(t('Saved'))}',{after:closeM})">${t('Save')}</button>`)}`);
}
function booksPage() {
  if (!can.seeAll()) return denied();
  const cfo = can.banking();
  const rows = D.books.map(k => {
    const used = D.cheques.filter(c => c.issue && c.issue.accountId === k.accountId && +c.issue.no >= k.from && +c.issue.no <= k.to).length;
    const vd = D.voided.filter(v => v.accountId === k.accountId && v.number >= k.from && v.number <= k.to).length, size = k.to - k.from + 1, left = size - used - vd;
    return [esc(acctName(AC(k.accountId))), `<bdi dir="ltr">${k.from} – ${k.to}</bdi>`, `<div style="min-width:140px"><div class="prog"><i style="width:${(used + vd) / size * 100}%"></i></div><div class="sm mut" style="margin-top:4px">${t('{u} used · {v} voided', { u: used, v: vd })}</div></div>`,
      `<span class="${left < 10 && k.active ? 'late' : ''}">${N(left)}</span>`, activeChip(k.active), `${esc(k.by || '')}<div class="sm mut">${FD(k.at)}</div>`, cfo ? `<button class="btn btn-o btn-sm" onclick="bookModal(${k.id})">${t('Edit')}</button>` : ''];
  });
  return phead(t('Chequebooks'), t('Cheque numbers can be issued only from an active chequebook of the account.'), cfo ? `<button class="btn btn-y" onclick="bookModal(0)" ${D.accounts.length ? '' : 'disabled'}>${ic('plus')}${t('Add chequebook')}</button>` : '') +
    `<div class="card flat">${tbl([t('Account'), t('Numbers'), t('Usage'), { l: t('Left'), n: 1 }, t('Status'), t('Added by'), ''], rows, t('No chequebooks yet.'), 'cards')}</div>`;
}
function bookModal(id) {
  const k = D.books.find(x => x.id === id) || { accountId: (D.accounts[0] || {}).id, active: true };
  modal(`${mhead(id ? t('Edit chequebook') : t('Add chequebook'))}<div class="mb"><div class="fgrid" style="margin-top:0">${fld('k_a', t('Account'), sel('k_a', D.accounts.filter(a => a.active || a.id === k.accountId).map(a => [a.id, acctName(a)]), k.accountId), 1, 'full')}
   ${fld('k_f', t('First number'), inp('k_f', k.from, 'inputmode="numeric" dir="ltr"'), 1)}${fld('k_t', t('Last number'), inp('k_t', k.to, 'inputmode="numeric" dir="ltr"'), 1)}</div>${id ? swRow('k_act', t('Active'), k.active) : ''}</div>
   ${mfoot(`<button class="btn btn-y" onclick="act('saveBook',{id:${id},accountId:val('k_a'),from:val('k_f'),to:val('k_t'),active:${id ? "chk('k_act')" : 'true'}},'${js(t('Saved'))}',{after:closeM})">${t('Save')}</button>`)}`);
}
function voidedPage() {
  if (!can.seeAll()) return denied();
  const rows = D.voided.map(v => [esc(acctName(AC(v.accountId))), `<bdi dir="ltr">${v.number}</bdi>`, esc(v.reason), `${esc(v.by)}<div class="sm mut">${FD(v.at)}</div>`]);
  return phead(t('Voided numbers'), t('Spoiled or cancelled cheque leaves. A voided number can never be issued.'), can.void() ? `<button class="btn btn-y" onclick="voidModal()" ${D.accounts.length ? '' : 'disabled'}>${ic('plus')}${t('Void a number')}</button>` : '') +
    `<div class="card flat">${tbl([t('Account'), t('Number'), t('Reason'), t('Recorded by')], rows, t('No voided numbers.'), 'cards')}</div>`;
}
function voidModal() {
  modal(`${mhead(t('Void a cheque number'))}<div class="mb"><div class="fgrid" style="margin-top:0">${fld('v_a', t('Account'), sel('v_a', D.accounts.map(a => [a.id, acctName(a)])), 1, 'full')}${fld('v_n', t('Cheque number'), inp('v_n', '', 'inputmode="numeric" dir="ltr"'), 1)}${fld('v_r', t('Reason'), inp('v_r', '', `placeholder="${t('e.g. spoiled while writing')}"`), 1)}</div></div>
   ${mfoot(`<button class="btn btn-r" onclick="act('voidNo',{accountId:val('v_a'),number:val('v_n'),reason:val('v_r')},'${js(t('Number voided'))}',{after:closeM})">${t('Void number')}</button>`)}`);
}

/* =================== BENEFICIARIES =================== */
function bensPage() {
  if (!can.seeAll()) return denied();
  const fin = can.fin(), f = F('ben', { x: '' }), q = f.q.trim().toLowerCase();
  const use = id => (D.benUse.find(x => x.id === id) || { n: 0 }).n;
  const L = D.beneficiaries.filter(b => (!f.x || b.type === f.x) && (!q || (b.code + ' ' + b.nameEn + ' ' + (b.nameAr || '') + ' ' + (b.contact || '')).toLowerCase().includes(q)));
  const p = pageOf('ben', L);
  const rows = p.rows.map(b => [`<b>${esc(nm(b))}</b>${LANG === 'ar' ? '' : b.nameAr ? `<div class="sm mut" dir="rtl">${esc(b.nameAr)}</div>` : ''}<div class="sm mut"><bdi dir="ltr">${esc(b.code)}</bdi></div>`, t(b.type), `${esc(b.contact || '—')}<div class="sm mut"><bdi dir="ltr">${esc(b.phone || '')}</bdi> ${esc(b.email || '')}</div>`, N(use(b.id)),
    fin ? `<div style="display:flex;gap:6px"><button class="btn btn-o btn-sm" onclick="benModal(${b.id})">${t('Edit')}</button>${use(b.id) ? '' : `<button class="btn btn-r btn-sm" aria-label="${t('Delete')}" onclick="confirmBox('${js(t('Delete beneficiary'))}','${js(t('Delete {n}?', { n: nm(b) }))}','${js(t('Delete'))}',()=>act('delBen',{id:${b.id}},'${js(t('Deleted'))}'),true)">${ic('trash')}</button>`}</div>` : '']);
  return phead(t('Beneficiaries'), t('Suppliers, financiers and others who receive cheques'), can.request() ? `<button class="btn btn-y" onclick="benModal(0)">${ic('plus')}${t('Add beneficiary')}</button>` : '') +
    `<div class="card flat"><div class="fbar">${searchBox('ben', t('Name, code or contact'))}<select class="in" onchange="setF('ben','x',this.value)"><option value="">${t('All types')}</option>${BENTYPES.map(x => `<option value="${x}" ${x === f.x ? 'selected' : ''}>${t(x)}</option>`).join('')}</select></div>
     ${tbl([t('Beneficiary'), t('Type'), t('Contact'), { l: t('Used'), n: 1 }, ''], rows, t('No beneficiaries yet.'), 'cards')}${pager('ben', p)}</div>`;
}
function benModal(id, quick) {
  const b = D.beneficiaries.find(x => x.id === id) || { type: S.nf && FINANCING.includes(S.nf.opType) ? 'Financier' : 'Supplier' };
  S.benQuick = !!quick;
  modal(`${mhead(id ? t('Edit beneficiary') : t('Add beneficiary'))}<div class="mb"><div class="fgrid" style="margin-top:0">
   ${fld('n_en', t('Name (English)'), inp('n_en', b.nameEn), 1)}${fld('n_ar', t('Name (Arabic)'), inp('n_ar', b.nameAr, 'dir="rtl"'))}
   ${fld('n_ty', t('Type'), sel('n_ty', BENTYPES.map(x => [x, t(x)]), b.type), 1)}${fld('n_cd', t('Code'), inp('n_cd', b.code, `dir="ltr" placeholder="${t('Automatic if empty')}"`))}
   ${fld('n_ct', t('Contact person'), inp('n_ct', b.contact))}${fld('n_ph', t('Phone'), inp('n_ph', b.phone, 'dir="ltr" inputmode="tel"'))}${fld('n_em', t('Email'), inp('n_em', b.email, 'dir="ltr" type="email"'), 0, 'full')}</div></div>
   ${mfoot(`<button class="btn btn-y" onclick="saveBen(${id})">${t('Save')}</button>`)}`, true);
}
function saveBen(id) {
  act('saveBen', { id, nameEn: val('n_en'), nameAr: val('n_ar'), type: val('n_ty'), code: val('n_cd'), contact: val('n_ct'), phone: val('n_ph'), email: val('n_em') }, t('Saved'),
    { after: j => { closeM(); if (S.benQuick && S.nf && j.id) S.nf.benId = j.id; } });
}

/* =================== ENTITIES, DEPARTMENTS =================== */
function entitiesPage() {
  if (!can.admin()) return denied();
  const rows = D.entities.map(e => [`<b>${esc(e.nameEn)}</b>`, `<span dir="rtl">${esc(e.nameAr || '')}</span>`, `<span class="chip c-appr">${e.funcCur}</span>`, N(D.cheques.filter(c => c.entityId === e.id).length), N(D.accounts.filter(a => a.entityId === e.id).length), `<button class="btn btn-o btn-sm" onclick="entModal(${e.id})">${t('Edit')}</button>`]);
  return phead(t('Entities'), t('Each entity keeps its books in its functional currency.'), `<button class="btn btn-y" onclick="entModal(0)">${ic('plus')}${t('Add entity')}</button>`) +
    (D.settings.funcConfirmed ? `<div class="okbox">${ic('check')}<span>${t('Functional currencies are confirmed.')}</span></div>` : `<div class="warnbox">${ic('alert')}<span style="flex:1">${t('Confirm with the accountant that each functional currency is right before the first approval. It cannot change once cheques are approved.')}</span><button class="btn btn-y btn-sm" onclick="act('confirmFunc',{},'${js(t('Confirmed'))}')">${t('Confirm')}</button></div>`) +
    `<div class="card flat">${tbl([t('Name (English)'), t('Name (Arabic)'), t('Functional currency'), { l: t('Cheques'), n: 1 }, { l: t('Bank accounts'), n: 1 }, ''], rows)}</div>`;
}
function entModal(id) {
  const e = D.entities.find(x => x.id === id) || { funcCur: 'SDG' };
  modal(`${mhead(id ? t('Edit entity') : t('Add entity'))}<div class="mb"><div class="fgrid" style="margin-top:0">${fld('e_en', t('Name (English)'), inp('e_en', e.nameEn), 1)}${fld('e_ar', t('Name (Arabic)'), inp('e_ar', e.nameAr, 'dir="rtl"'))}${fld('e_fc', t('Functional currency'), sel('e_fc', CURS, e.funcCur), 1)}</div></div>
   ${mfoot(`<button class="btn btn-y" onclick="act('saveEntity',{id:${id},nameEn:val('e_en'),nameAr:val('e_ar'),funcCur:val('e_fc')},'${js(t('Saved'))}',{after:closeM})">${t('Save')}</button>`)}`);
}
function deptsPage() {
  if (!can.admin()) return denied();
  const rows = D.departments.map(d => [`<b>${esc(d.nameEn)}</b>`, `<span dir="rtl">${esc(d.nameAr || '')}</span>`, N(D.users.filter(u => u.deptId === d.id && u.active).length), N(D.cheques.filter(c => c.deptId === d.id).length), `<button class="btn btn-o btn-sm" onclick="deptModal(${d.id})">${t('Edit')}</button>`]);
  const by = D.departments.map(d => ({ label: nm(d), value: D.cheques.filter(c => c.deptId === d.id && !['Rejected', 'Cancelled'].includes(c.status)).reduce((a, c) => a + usdOf(c), 0) }));
  return phead(t('Departments'), '', `<button class="btn btn-y" onclick="deptModal(0)">${ic('plus')}${t('Add department')}</button>`) +
    `<div class="card flat">${tbl([t('Name (English)'), t('Name (Arabic)'), { l: t('Active users'), n: 1 }, { l: t('Requests'), n: 1 }, ''], rows)}</div>
     <div class="charts">${ccard(t('Requests by department'), t('USD equivalent, excluding rejected and cancelled'), hbar(by, { plain: usdT, title: t('Requests by department') }))}</div>`;
}
function deptModal(id) {
  const d = D.departments.find(x => x.id === id) || {};
  modal(`${mhead(id ? t('Edit department') : t('Add department'))}<div class="mb"><div class="fgrid" style="margin-top:0">${fld('d_en', t('Name (English)'), inp('d_en', d.nameEn), 1)}${fld('d_ar', t('Name (Arabic)'), inp('d_ar', d.nameAr, 'dir="rtl"'))}</div></div>
   ${mfoot(`<button class="btn btn-y" onclick="act('saveDept',{id:${id},nameEn:val('d_en'),nameAr:val('d_ar')},'${js(t('Saved'))}',{after:closeM})">${t('Save')}</button>`)}`);
}

/* =================== USERS =================== */
function usersPage() {
  if (!can.admin()) return denied();
  const f = F('usr', { x: '' }), q = f.q.trim().toLowerCase();
  const L = D.users.filter(u => (!f.x || u.role === f.x) && (!q || (u.fullName + ' ' + u.username + ' ' + (u.email || '')).toLowerCase().includes(q)));
  const noMail = D.users.filter(u => u.active && !u.email).length;
  const status = u => !u.active ? `<span class="chip c-can">${t('Disabled')}</span>` : u.lockedUntil ? `<span class="chip c-ret">${ic('lock')}${t('Locked')}</span>` : `<span class="chip c-clr">${t('Active')}</span>`;
  const rows = L.map(u => [`<b>${esc(u.fullName)}</b><div class="sm mut"><bdi dir="ltr">${esc(u.username)}</bdi></div>`, u.email ? `<bdi dir="ltr">${esc(u.email)}</bdi>` : `<span class="late">${t('Missing')}</span>`,
    `<span class="chip role">${t(ROLES[u.role] || u.role)}</span>`, esc(nm(Dp(u.deptId))), u.lang === 'ar' ? 'العربية' : 'English', u.twoFa ? `<span class="chip c-appr">${ic('shield')}${t('On')}</span>` : `<span class="mut">${t('Off')}</span>`, status(u),
    u.lastLogin ? FD(u.lastLogin) : '<span class="mut">—</span>', `<button class="btn btn-o btn-sm" onclick="userModal(${u.id})">${t('Edit')}</button>`]);
  const roleCounts = Object.keys(ROLES).map(r => ({ label: t(ROLES[r]), value: D.users.filter(u => u.active && u.role === r).length }));
  return phead(t('Users'), t('Email is required: it is used for password reset and sign-in codes.'), `<button class="btn btn-y" onclick="userModal(0)">${ic('plus')}${t('Add user')}</button>`) +
    (noMail ? `<div class="warnbox">${ic('alert')}<span>${t('{n} active users have no email and cannot reset their password. Add it.', { n: noMail })}</span></div>` : '') +
    (D.settings.mailReady ? '' : `<div class="vbox">${ic('info')}<span>${t('Email is not set up yet, so reset links and sign-in codes cannot be sent.')} <a href="#/settings" onclick="F('set').tab='smtp'">${t('Set up email')}</a></span></div>`) +
    `<div class="card flat"><div class="fbar">${searchBox('usr', t('Name, username or email'))}<select class="in" onchange="setF('usr','x',this.value)"><option value="">${t('All roles')}</option>${Object.keys(ROLES).map(r => `<option value="${r}" ${r === f.x ? 'selected' : ''}>${t(ROLES[r])}</option>`).join('')}</select></div>
     ${tbl([t('User'), t('Email'), t('Role'), t('Department'), t('Language'), t('Two-step'), t('Status'), t('Last sign-in'), ''], rows, t('No users.'), 'cards')}</div>
     <div class="charts">${ccard(t('Active users by role'), '', hbar(roleCounts, { plain: v => String(v), title: t('Active users by role') }))}</div>`;
}
function userModal(id) {
  const u = D.users.find(x => x.id === id) || { role: 'USER', deptId: (D.departments[0] || {}).id, lang: 'ar', active: true, mustChange: true };
  const mail = D.settings.mailReady;
  modal(`${mhead(id ? t('Edit user') : t('Add user'), id ? esc(u.username) : '')}<div class="mb">
   <div class="fgrid" style="margin-top:0">${fld('u_fn', t('Full name'), inp('u_fn', u.fullName), 1)}${fld('u_un', t('Username'), inp('u_un', u.username, 'dir="ltr" autocomplete="off"'), 1)}
    ${fld('u_em', t('Email'), inp('u_em', u.email, 'dir="ltr" type="email" autocomplete="off"'), 1)}${fld('u_ro', t('Role'), sel('u_ro', Object.keys(ROLES).map(r => [r, t(ROLES[r])]), u.role), 1)}
    ${fld('u_dp', t('Department'), sel('u_dp', D.departments.map(d => [d.id, nm(d)]), u.deptId), 1)}${fld('u_lg', t('Language'), sel('u_lg', [['ar', 'العربية'], ['en', 'English']], u.lang), 1)}
    ${fld('u_pw', id ? t('New password (leave empty to keep)') : t('Temporary password'), `<input class="in" id="u_pw" type="password" autocomplete="new-password" oninput="polHint('u_pw','u_ph')"><div class="pol" id="u_ph"></div>`, !id, 'full')}</div>
   <div style="margin-top:12px">${swRow('u_act', t('Active'), u.active)}${swRow('u_mc', t('Must change password at next sign-in'), u.mustChange)}
    ${swRow('u_2f', t('Two-step verification'), u.twoFa, mail ? t('A 6-digit code is emailed at each sign-in.') : t('Set up email first.'), !mail && !u.twoFa)}</div>
   ${id ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${u.lockedUntil ? `<button class="btn btn-o btn-sm" onclick="act('unlockUser',{id:${id}},'${js(t('Account unlocked'))}',{after:closeM})">${ic('lock')}${t('Unlock')}</button>` : ''}
     <button class="btn btn-o btn-sm" ${mail && u.email ? '' : 'disabled'} onclick="act('sendReset',{id:${id}},'${js(t('Reset link sent to {e}', { e: u.email }))}')">${ic('mail')}${t('Send password reset link')}</button></div>` : ''}</div>
   ${mfoot(`<button class="btn btn-y" onclick="saveUser(${id})">${t('Save')}</button>`)}`, true);
}
function saveUser(id) {
  act('saveUser', { id, fullName: val('u_fn'), username: val('u_un'), email: val('u_em'), role: val('u_ro'), deptId: val('u_dp'), lang: val('u_lg'), password: document.getElementById('u_pw').value, active: chk('u_act'), mustChange: chk('u_mc'), twoFa: chk('u_2f') }, t('User saved'), { after: closeM });
}

/* =================== SETTINGS =================== */
function settingsPage() {
  if (!can.admin()) return denied();
  const f = F('set', { tab: 'general' }), s = D.settings, P = s.policy, sm = s.smtp || {}, A = s.acc;
  const tabs = [['general', 'General'], ['approval', 'Approvals & rates'], ['accounts', 'Accounts'], ['smtp', 'Email'], ['alerts', 'Alerts'], ['policy', 'Sign-in policy']];
  const save = (sec, body) => `<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px"><button class="btn btn-y" onclick="act('saveSettings',Object.assign({section:'${sec}'},${body}),'${js(t('Settings saved'))}')">${t('Save')}</button></div>`;
  let body = '';
  if (f.tab === 'general') body = `<div class="fgrid">${fld('g_c', t('Company name'), inp('g_c', s.company), 1)}${fld('g_rc', t('Report currency'), sel('g_rc', CURS, s.reportCurrency))}${fld('g_tz', t('Time zone'), inp('g_tz', s.timeZone, 'dir="ltr"'))}</div>
    <div style="margin-top:16px"><div class="lbl">${t('Logo')}</div><div class="drop"><img class="blogo" src="${esc((S.logo ?? s.logo) || '/img/logo.png')}" alt="">
     <label class="btn btn-o btn-sm">${ic('file')}${t('Choose image')}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="hide" onchange="pickLogo(this)"></label>${(S.logo ?? s.logo) ? `<button class="btn btn-o btn-sm" onclick="S.logo='';render()">${t('Remove')}</button>` : ''}<span class="sm mut">${t('PNG or JPG, up to 250 KB. Without one, the Equpation logo is used.')}</span></div></div>
    ${save('general', "{company:val('g_c'),reportCurrency:val('g_rc'),timeZone:val('g_tz'),logo:(S.logo??D.settings.logo)}")}`;
  if (f.tab === 'approval') body = `<div class="fgrid">${fld('a_lim', t('Second approval above (USD)'), inp('a_lim', s.secondLimitUsd, 'inputmode="decimal" dir="ltr"'), 1)}${fld('a_pct', t('Rate alert when the change is above (%)'), inp('a_pct', s.rateAlertPct, 'inputmode="decimal" dir="ltr"'), 1)}</div>
    <div class="hint">${t('Related-party payments and payments made before the request always need second approval.')}</div>${save('approval', "{secondLimitUsd:val('a_lim'),rateAlertPct:val('a_pct')}")}`;
  if (f.tab === 'accounts') body = `<div class="sm mut" style="margin-top:4px">${t('Ledger account numbers used in the journal entries.')}</div><div class="fgrid">
    ${[['payables', 'Payables'], ['deferred', 'Deferred cheques'], ['finPrincipal', 'Financing principal'], ['finProfit', 'Accrued financing profit'], ['poa', 'Payments on account'], ['fxDiff', 'FX differences']].map(([k, l]) => fld('ac_' + k, t(l), inp('ac_' + k, A[k], 'dir="ltr"'), 1)).join('')}</div>
    ${save('accounts', "{payables:val('ac_payables'),deferred:val('ac_deferred'),finPrincipal:val('ac_finPrincipal'),finProfit:val('ac_finProfit'),poa:val('ac_poa'),fxDiff:val('ac_fxDiff')}")}`;
  if (f.tab === 'smtp') body = `${s.mailReady ? `<div class="okbox" style="margin-top:12px">${ic('check')}<span>${t('Email is set up.')}</span></div>` : `<div class="vbox" style="margin-top:12px">${ic('info')}<span>${t('Needed for password reset links and two-step sign-in codes. Office 365: smtp.office365.com, port 587, TLS on.')}</span></div>`}
    <div class="fgrid">${fld('m_h', t('SMTP server'), inp('m_h', sm.host, 'dir="ltr" placeholder="smtp.office365.com"'))}${fld('m_p', t('Port'), inp('m_p', sm.port || 587, 'inputmode="numeric" dir="ltr"'))}
     ${fld('m_u', t('User name'), inp('m_u', sm.user, 'dir="ltr" autocomplete="off"'))}${fld('m_pw', t('Password'), `<input class="in" id="m_pw" type="password" autocomplete="new-password" placeholder="${sm.passSet ? t('Saved — type to replace') : ''}">`)}
     ${fld('m_f', t('Sender email'), inp('m_f', sm.from, 'dir="ltr" type="email"'))}${fld('m_fn', t('Sender name'), inp('m_fn', sm.fromName || 'ChequeTrack'))}</div>
    ${swRow('m_ssl', t('Use TLS (STARTTLS)'), sm.ssl !== false)}
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px"><button class="btn btn-o" ${s.mailReady ? '' : 'disabled'} onclick="act('testEmail',{},'${js(t('Test email sent to {e}', { e: S.user.email || '' }))}')">${ic('mail')}${t('Send test email to me')}</button>
     <button class="btn btn-y" onclick="act('saveSettings',{section:'smtp',host:val('m_h'),port:val('m_p'),user:val('m_u'),password:document.getElementById('m_pw').value,from:val('m_f'),fromName:val('m_fn'),ssl:chk('m_ssl')},'${js(t('Settings saved'))}')">${t('Save')}</button></div>`;
  if (f.tab === 'alerts') { const EV = [['approved', 'Approved by the CFO'], ['approved2', 'Second approval'], ['issued', 'Cheque issued'], ['received', 'Received by requester'], ['delivered', 'Handed to beneficiary'], ['cleared', 'Cleared'], ['returned', 'Returned'], ['solved', 'Returned cheque settled'], ['rejected', 'Rejected']];
    body = `<div class="fgrid">${fld('l_d', t('Alert window (days before the due date)'), inp('l_d', s.alertDays, 'inputmode="numeric" dir="ltr"'), 1)}${fld('l_t', t('Daily digest time'), inp('l_t', s.alertTime, 'dir="ltr" placeholder="09:00"'), 1)}</div>
    <div style="margin-top:14px">${swRow('l_hide', t('Hide Telegram from the menu'), s.hideTelegram)}</div><h3 class="h3" style="margin:18px 0 6px">${t('Post to Telegram when')}</h3>
    ${EV.map(([k, l]) => `<label class="chk"><input type="checkbox" class="tge" data-k="${k}" ${s.tgEvents[k] ? 'checked' : ''}> ${t(l)}</label>`).join('')}
    ${save('alerts', "{alertDays:val('l_d'),alertTime:val('l_t'),hideTelegram:chk('l_hide'),tgEvents:Object.fromEntries([...document.querySelectorAll('.tge')].map(e=>[e.dataset.k,e.checked]))}")}`; }
  if (f.tab === 'policy') body = `<div class="fgrid">${fld('p_ml', t('Minimum length'), inp('p_ml', P.minLen, 'inputmode="numeric" dir="ltr"'))}${fld('p_ex', t('Password expires after (days, 0 = never)'), inp('p_ex', P.expiryDays, 'inputmode="numeric" dir="ltr"'))}
     ${fld('p_ma', t('Failed attempts before lock'), inp('p_ma', P.maxAttempts, 'inputmode="numeric" dir="ltr"'))}${fld('p_lm', t('Lock for (minutes)'), inp('p_lm', P.lockMinutes, 'inputmode="numeric" dir="ltr"'))}${fld('p_sm', t('Sign out after inactivity (minutes)'), inp('p_sm', P.sessionMin, 'inputmode="numeric" dir="ltr"'))}</div>
    <div style="margin-top:14px">${swRow('p_up', t('Upper and lower case letters'), P.upper)}${swRow('p_dg', t('At least one number'), P.digit)}${swRow('p_sp', t('At least one symbol'), P.special)}${swRow('p_fc', t('New users change the password at first sign-in'), P.firstChange)}</div>
    ${save('policy', "{minLen:val('p_ml'),expiryDays:val('p_ex'),maxAttempts:val('p_ma'),lockMinutes:val('p_lm'),sessionMin:val('p_sm'),upper:chk('p_up'),digit:chk('p_dg'),special:chk('p_sp'),firstChange:chk('p_fc')}")}`;
  return phead(t('Settings'), '') + `<div class="ul-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${k === f.tab}" class="${k === f.tab ? 'on' : ''}" onclick="setF('set','tab','${k}')">${t(l)}</button>`).join('')}</div><section class="card" style="max-width:900px">${body}</section>`;
}
async function pickLogo(inp) {
  const f = inp.files[0]; if (!f) return;
  if (f.size > 250 * 1024) { toast(t('The logo is too large (max about 250 KB).')); return; }
  S.logo = `data:${f.type};base64,${await readFile(f)}`; render();
}

/* =================== TELEGRAM =================== */
function telegramPage() {
  if (!can.seeAll()) return denied();
  const s = D.settings, mg = can.telegram();
  return phead(t('Telegram alerts'), t('Cheque events and a daily digest are posted to a Telegram channel.'), `<button class="btn btn-o" ${s.tokenSet ? '' : 'disabled'} onclick="act('sendDigest',{},'${js(t('Digest sent'))}')">${ic('bell')}${t('Send digest now')}</button>`) +
   `<div class="row"><div class="col1"><section class="card"><h2 class="h3">${t('Connection')}</h2>
     ${s.tokenSet ? `<div class="okbox" style="margin-top:12px">${ic('check')}<span>${t('Connected to {c}', { c: `<bdi dir="ltr">${esc(s.telegramChannel)}</bdi>` })}</span></div>` : `<div class="warnbox" style="margin-top:12px">${ic('alert')}<span>${t('Not connected.')}</span></div>`}
     ${mg ? `<div class="fgrid">${fld('tg_c', t('Channel'), inp('tg_c', s.telegramChannel, 'dir="ltr" placeholder="@channel or -100…"'), 1, 'full')}${fld('tg_t', t('Bot token'), `<input class="in" id="tg_t" type="password" dir="ltr" autocomplete="off" placeholder="${s.tokenSet ? t('Saved — type to replace') : '123456789:AA…'}">`, !s.tokenSet, 'full')}</div>
      <div class="hint">${t('Add the bot to the channel as an admin first. The token is stored encrypted and never shown again.')}</div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">${s.tokenSet ? `<button class="btn btn-r" onclick="confirmBox('${js(t('Disconnect Telegram'))}','${js(t('Stop posting alerts to the channel?'))}','${js(t('Disconnect'))}',()=>act('tgDisconnect',{},'${js(t('Disconnected'))}'),true)">${t('Disconnect')}</button>` : ''}<button class="btn btn-y" onclick="act('tgConnect',{channel:val('tg_c'),token:val('tg_t')},'${js(t('Connected — a test message was posted'))}')">${t('Connect and test')}</button></div>` : ''}
     ${s.cronUrl ? `<div class="dv"></div><div class="lbl">${t('Wake-up link for the daily digest')}</div><div class="sm mut">${t('On the free plan, call this link every 15 minutes from a free scheduler such as cron-job.org.')}</div><div class="note" style="margin-top:8px;overflow-wrap:anywhere" dir="ltr">${esc(s.cronUrl)}</div>` : ''}</section></div>
    <div class="col2"><section class="card"><h2 class="h3">${t('Latest posts')}</h2>${D.tgFeed.map(m => `<div class="task"><div style="flex:1 1 300px;white-space:pre-line">${esc(String(m.text || '').replace(/<[^>]+>/g, ''))}</div><div class="sm ${m.sent ? 'mut' : 'late'}" style="text-align:end">${FD(m.at)}<div>${m.sent ? t('Sent') : esc(m.error || t('Not sent'))}</div></div></div>`).join('') || `<div class="empty">${t('Nothing posted yet.')}</div>`}</section>
     <section class="card"><h2 class="h3">${t('Daily digests')}</h2>${D.alerts.map(a => `<div class="task"><div style="flex:1">${t('{n} cheques due', { n: a.count })} · <span class="mut">${esc(a.by || t('automatic'))}</span></div><div class="sm ${a.sent ? 'mut' : 'late'}">${FD(a.at)} · ${a.sent ? t('Sent') : esc(a.error || t('Not sent'))}</div></div>`).join('') || `<div class="empty">${t('No digest yet.')}</div>`}</section></div></div>`;
}

/* =================== AUDIT =================== */
function auditPage() {
  if (!can.audit()) return denied();
  const f = F('aud', { x: '' }), q = f.q.trim().toLowerCase();
  let L = D.audit.filter(a => (!f.x || a.user === f.x) && (!q || (a.action + ' ' + a.entity + ' ' + a.details).toLowerCase().includes(q)) && inRange(f, (a.at || '').slice(0, 10)));
  S.audRows = L;
  const p = pageOf('aud', L), users = [...new Set(D.audit.map(a => a.user))].sort();
  return phead(t('Audit log'), t('Every change, who made it and when. It cannot be edited.'), `<button class="btn btn-o" onclick="csv('audit-log',['When','User','Action','Record','Details'],S.audRows.map(a=>[fd(a.at),a.user,a.action,a.entity,a.details]))">${ic('dl')}${t('Export to Excel')}</button>`) +
   `<div class="card flat"><div class="fbar">${searchBox('aud', t('Action, record or details'))}<select class="in" onchange="setF('aud','x',this.value)"><option value="">${t('All users')}</option>${users.map(u => `<option ${u === f.x ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
    ${dFilter('aud', 'from', t('From'), f.from)}${dFilter('aud', 'to', t('to'), f.to)}</div>
    ${tbl([t('When'), t('User'), t('Action'), t('Record'), t('Details')], p.rows.map(a => [`<span style="white-space:nowrap">${FD(a.at)}</span>`, esc(a.user), `<b>${esc(t(a.action))}</b>`, `<bdi dir="ltr">${esc(a.entity)}</bdi>`, `<span class="sm">${esc(a.details)}</span>`]), t('No entries.'), 'cards')}${pager('aud', p)}</div>`;
}

/* =================== GO-LIVE CHECKLIST =================== */
function checklistPage() {
  if (!can.checklist()) return denied();
  const s = D.settings, U_ = D.users.filter(u => u.active);
  const missingAcc = D.entities.flatMap(e => CURS.filter(c => c === e.funcCur || c === 'USD').filter(c => !D.accounts.some(a => a.active && a.entityId === e.id && a.currency === c)).map(c => `${nm(e)} · ${c}`));
  const items = [
    [U_.some(u => u.role === 'CFO'), t('An active CFO'), '#/users'],
    [U_.some(u => u.role === 'ADMIN'), t('A System Admin (until then the CFO acts as admin)'), '#/users'],
    [U_.some(u => u.role === 'FIN'), t('At least one Finance user'), '#/users'],
    [U_.filter(u => u.role === 'FIN').length >= 2, t('Two Finance users, so one can issue what the other requested'), '#/users'],
    [U_.some(u => u.role === 'TOP'), t('Top Management user for second approvals'), '#/users'],
    [D.users.length && !U_.some(u => !u.email), t('Every active user has an email'), '#/users'],
    [s.mailReady, t('Email set up for password reset'), '#/settings'],
    [s.funcConfirmed, t('Functional currencies confirmed'), '#/entities'],
    [D.banks.length > 0, t('Banks added'), '#/banks'],
    [!missingAcc.length, missingAcc.length ? t('Bank accounts missing: {l}', { l: missingAcc.join(', ') }) : t('Bank accounts for each entity'), '#/banks'],
    [D.accounts.filter(a => a.active).every(a => D.books.some(k => k.active && k.accountId === a.id)) && D.accounts.length > 0, t('An active chequebook for every account'), '#/books'],
    [D.rates.some(r => r.date === today()), t("Today's exchange rate entered"), '#/rates'],
    [!!s.tokenSet || s.hideTelegram, t('Telegram connected (optional)'), '#/telegram'],
    [D.beneficiaries.length > 0, t('Beneficiaries added'), '#/beneficiaries']];
  const done = items.filter(i => i[0]).length;
  return phead(t('Go-live checklist'), t('{a} of {b} done', { a: done, b: items.length })) +
    `<section class="card"><div class="prog" style="margin-bottom:16px"><i style="width:${done / items.length * 100}%"></i></div>${items.map(([ok, l, h]) => `<div class="task"><div class="okl ${ok ? '' : 'no'}" style="flex:1">${ic(ok ? 'check' : 'x')}<span>${esc(l)}</span></div>${ok ? '' : `<a class="btn btn-o btn-sm" href="${h}">${t('Fix')}</a>`}</div>`).join('')}</section>`;
}

/* =================== PROFILE =================== */
function profilePage() {
  const u = S.user, me = D.users.find(x => x.id === u.id) || {};
  return phead(t('My profile'), '') + `<div class="row"><section class="card col1" style="max-width:560px"><div style="display:flex;gap:14px;align-items:center"><div class="av" style="width:56px;height:56px;font-size:22px">${esc((u.fullName || '?')[0])}</div><div><div class="h3">${esc(u.fullName)}</div><div class="mut"><bdi dir="ltr">${esc(u.username)}</bdi></div></div></div>
   <div class="pairs">${pair(t('Role'), `<span class="chip role">${t(ROLES[u.role] || u.role)}</span>`)}${pair(t('Department'), esc(nm(Dp(u.deptId))))}${pair(t('Email'), u.email ? `<bdi dir="ltr">${esc(u.email)}</bdi>` : `<span class="late">${t('Missing — ask the System Admin')}</span>`)}${pair(t('Two-step verification'), me.twoFa ? t('On') : t('Off'))}</div>
   <div class="dv"></div><div class="lbl">${t('Language')}</div><div class="seg">${[['ar', 'العربية'], ['en', 'English']].map(([k, l]) => `<label class="${LANG === k ? 'on' : ''}"><input type="radio" name="pl" ${LANG === k ? 'checked' : ''} onchange="if(LANG!=='${k}')switchLang()"> ${l}</label>`).join('')}</div>
   <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px"><a class="btn btn-y" href="#/password">${ic('key')}${t('Change password')}</a><button class="btn btn-o" onclick="logout()">${ic('logout')}${t('Sign out')}</button></div></section></div>`;
}
