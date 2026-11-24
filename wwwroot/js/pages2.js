/* =========================================================
   Pages: rates, financing, accounting, reports, banking, setup
   ========================================================= */
'use strict';
const BENTYPES = ['Supplier', 'Financier', 'Customer', 'Employee', 'Other'];
const kpi = (l, v, d) => `<div class="kpi"><div class="l">${l}</div><div class="v${String(v).replace(/<[^>]*>/g, '').length > 11 ? ' lg' : ''}">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
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
  const e = S.rEdit || {}, canFix = has('rates', 'edit'), L = D.rates, fin = has('rates', 'create') || (canFix && !!e.id);
  const r0 = L[0], m30 = rateOn(addDays(today(), -30));
  const pct = (a, b) => b ? ((a - b) / b * 100) : 0;
  const ch30 = r0 && m30 && m30 !== r0 ? pct(+r0.SDG, +m30.SDG) : null;
  const last90 = L.filter(r => r.date >= addDays(today(), -90));
  const hi = last90.length ? Math.max(...last90.map(r => +r.SDG)) : null, lo = last90.length ? Math.min(...last90.map(r => +r.SDG)) : null;
  const pts = L.slice(0, 60).reverse().map(r => ({ label: fd(r.date), value: +r.SDG, tip: `${fd(r.date)}\n1 USD = ${rnum(r.SDG)} SDG\n1 USD = ${rnum(r.QAR)} QAR` }));
  const form = fin ? `<section class="card"><h2 class="h3">${e.id ? t('Correct the rate of {d}', { d: fd(e.date) }) : t('Enter a rate')}</h2>
    <div class="sm mut" style="margin-top:2px">${t('A rate used by any cheque is locked and cannot change. Alert above {p}% change.', { p: D.settings.rateAlertPct })}</div>
    <div class="fgrid">${fld('r_d', t('Date'), dateIn('r_d', e.date || today()), 1)}${fld('r_q', t('1 USD in QAR'), inp('r_q', e.QAR ?? (r0 ? r0.QAR : ''), 'inputmode="decimal" dir="ltr"'), 1)}
     ${fld('r_s', t('1 USD in SDG'), inp('r_s', e.SDG ?? '', 'inputmode="decimal" dir="ltr"'), 1)}${fld('r_src', t('Source'), inp('r_src', e.source ?? (r0 ? r0.source : ''), `placeholder="${t('e.g. Central Bank of Sudan')}"`), 1)}</div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">${e.id ? `<button class="btn btn-o" onclick="S.rEdit=null;render()">${t('Cancel')}</button>` : ''}<button class="btn btn-y" onclick="saveRate(false)">${t('Save rate')}</button></div></section>` : '';
  // the table reads its rows from the server one page at a time, with the date filter applied there
  const f = F('rates'), rp = { size: f.size }; if (f.from) rp.from = f.from; if (f.to) rp.to = f.to;
  const pg = spGet('rates', '/api/rates', rp), PR = pg ? pg.rows : [];
  S.rRows = new Map(PR.map(r => [r.id, r]));
  const rows = PR.map((r, i) => {
    const prev = PR[i + 1] || L.find(x => x.date < r.date), d = prev ? pct(+r.SDG, +prev.SDG) : 0;
    return [FD(r.date), `<bdi dir="ltr">${rnum(r.QAR)}</bdi>`, `<bdi dir="ltr">${rnum(r.SDG)}</bdi>`,
      prev ? `<span class="${Math.abs(d) > +D.settings.rateAlertPct ? 'late' : 'mut'}"><bdi dir="ltr">${d > 0 ? '+' : ''}${d.toFixed(2)}%</bdi></span>` : '—',
      esc(r.source || '—'), `${esc(byN(r.setBy))}<div class="sm mut">${FD(r.setAt)}</div>`,
      r.locked ? `<span class="chip c-lock">${ic('lock')}${t('Locked')}</span>` : canFix ? `<button class="btn btn-o btn-sm" onclick="S.rEdit=S.rRows.get('${esc(js(r.id))}');render();scrollTo(0,0)">${ic('edit')}${t('Correct')}</button>` : `<span class="chip c-open">${t('Not used yet')}</span>`];
  });
  return phead(t('Exchange rates'), t('Rates per 1 USD. Each cheque keeps the rate of its approval, issue and clearing.')) +
    `<div class="kpis">${kpi(t('Latest SDG rate'), r0 ? `<bdi dir="ltr">${rnum(r0.SDG)}</bdi>` : '—', r0 ? FD(r0.date) : '')}
     ${kpi(t('Change in 30 days'), ch30 == null ? '—' : `<bdi dir="ltr" class="${ch30 > 0 ? 'late' : ''}">${ch30 > 0 ? '+' : ''}${ch30.toFixed(1)}%</bdi>`, t('SDG per USD'))}
     ${kpi(t('Highest / lowest, 90 days'), hi == null ? '—' : `<bdi dir="ltr" style="font-size:22px">${rnum(hi)} / ${rnum(lo)}</bdi>`)}
     ${kpi(t('Latest QAR rate'), r0 ? `<bdi dir="ltr">${rnum(r0.QAR)}</bdi>` : '—')}</div>
    ${form}
    <section class="card"><h2 class="h3">${t('SDG per USD')}</h2><div class="sm mut" style="margin:2px 0 10px">${t('Last {n} rates · hover a point for the detail', { n: pts.length })}</div>${lineChart(pts, { plain: v => rnum(Math.round(v)), title: t('SDG per USD') })}</section>
    <div class="card flat"><div class="fbar">${dFilter('rates', 'from', t('From'), f.from)}${dFilter('rates', 'to', t('to'), f.to)}</div>
     ${!pg ? spLoading() : pg.err ? `<div class="empty late">${esc(tErr(pg.err))}</div>` : tbl([t('Date'), { l: t('QAR'), n: 1 }, { l: t('SDG'), n: 1 }, { l: t('Change'), n: 1 }, t('Source'), t('Entered by'), ''], rows, t('No exchange rate yet.')) + spPager('rates', pg, f.from || f.to ? null : pg.total)}</div>`;
}
async function saveRate(confirm) {
  const body = { date: dval('r_d'), QAR: val('r_q'), SDG: val('r_s'), source: val('r_src'), confirm: !!confirm };
  if (!body.date) { toast(t('Enter the date as dd/MM/yyyy.')); return; }
  const j = await act('saveRate', body, t('Rate saved'), { raw: true, after: () => { S.rEdit = null; } });
  if (j && j.confirm) confirmBox(t('Check the rate'), `<div class="warnbox">${ic('alert')}<span>${esc(tErr(j.error))}</span></div>`, t('Save anyway'), () => saveRate(true));
}

/* =================== CONTRACTS =================== */
function kStats(k) {
  // totals over every cheque come from the server; the list shows the recent ones (all of them: "Show all")
  const u = kUseOf(k.opNo), used = +u.used || 0, paid = +u.paid || 0;
  const cs = D.cheques.filter(c => !['Rejected', 'Cancelled'].includes(c.status) && c.lines.some(l => l.opNo === k.opNo));
  return { used, paid, remaining: +k.principal - used, cheques: cs, count: +u.n || cs.length };
}
function kShowAll(op) { closeM(); const f = F('all', { tab: 'all' }); f.tab = 'all'; f.op = op; f.page = 1; go('cheques'); }
const KCLOSE = ['Fully settled', 'Not renewed', 'Cancelled', 'Other'];
function addMonths(iso, n) {
  const d = new Date((iso || today()) + 'T12:00:00Z'), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0, 10);
}
/** The owner may always follow up a contract; others need the "Follow up" right. */
function kCanFollow(k) { return has('contracts', 'follow') || (k.ownerId && k.ownerId === S.user.id); }
function kDone(j, title) { closeM(); if (j && j.alert) S.after = () => confirmBox(title, `<div class="vbox">${esc(tErr(j.alert))}</div>`, t('OK'), null); }
function contractsPage() {
  if (!has('contracts')) return denied();
  const L = D.contracts, f = F('k', { tab: 'all' }), q = f.q.trim().toLowerCase();
  const st = new Map(L.map(k => [k.id, kStats(k)])), ks = new Map(L.map(k => [k.id, kState(k)]));
  const open = L.filter(k => !ks.get(k.id).closed);
  const tabs = [
    { k: 'all', label: t('Active'), f: k => !ks.get(k.id).closed },
    { k: 'att', label: t('Needs follow-up'), f: k => ks.get(k.id).attention },
    { k: 'soon', label: t('Expiring soon'), f: k => ks.get(k.id).soon },
    { k: 'exp', label: t('Expired'), f: k => ks.get(k.id).expired },
    { k: 'closed', label: t('Closed'), f: k => ks.get(k.id).closed }];
  const tab = tabs.find(x => x.k === f.tab) || tabs[0];
  const rows = L.filter(tab.f).filter(k => !q || (k.opNo + ' ' + nm(B(k.financierId)) + ' ' + B(k.financierId).nameEn).toLowerCase().includes(q))
    .filter(k => !f.ent || String(k.entityId) === f.ent).sort((a, b) => kExp(a) < kExp(b) ? -1 : 1);
  const totR = open.reduce((a, k) => a + usdNow(st.get(k.id).remaining, k.currency), 0);
  const nSoon = L.filter(k => ks.get(k.id).soon).length, nExp = L.filter(k => ks.get(k.id).expired).length;
  const prog = open.slice().sort((a, b) => usdNow(b.principal, b.currency) - usdNow(a.principal, a.currency)).slice(0, 8).map(k => { const s = st.get(k.id); return { label: `${k.opNo} · ${nm(B(k.financierId))}`, value: s.used, total: +k.principal, sub: `<bdi dir="ltr">${money(s.used, k.currency)} / ${money(k.principal, k.currency)}</bdi>`, tip: `${k.opNo}\n${t('Requested')}: ${money(s.used, k.currency)}\n${t('Cleared')}: ${money(s.paid, k.currency)}\n${t('Remaining')}: ${money(s.remaining, k.currency)}` }; });
  const byFin = {}; open.forEach(k => { const n = nm(B(k.financierId)); byFin[n] = (byFin[n] || 0) + usdNow(st.get(k.id).remaining, k.currency); });
  const trs = rows.map(k => { const s = st.get(k.id), x = ks.get(k.id);
    return [`<a class="lnk" href="javascript:void(0)" onclick="kModal(${k.id})"><b><bdi dir="ltr" style="white-space:nowrap">${esc(k.opNo)}</bdi></b></a><div class="sm mut">${esc(nm(B(k.financierId)))}</div>`, esc(nm(E(k.entityId))),
      M(k.principal, k.currency), `<span class="${s.remaining <= 0 ? 'mut' : 'b'}">${M(s.remaining, k.currency)}</span>`,
      `${FD(kExp(k))}<div style="margin-top:4px">${kChip(k)}</div>`,
      `${k.ownerId ? esc(UN(k.ownerId)) : `<span class="mut">${t('Not assigned')}</span>`}${k.followUpDate ? `<div class="sm ${x.due ? 'late' : 'mut'}">${t('next follow-up {d}', { d: fd(k.followUpDate) })}</div>` : ''}`,
      `<div style="display:flex;gap:6px;flex-wrap:wrap">${!x.closed && kCanFollow(k) ? `<button class="btn btn-y btn-sm" onclick="kFollowModal(${k.id})">${t('Follow up')}</button>` : ''}<button class="btn btn-o btn-sm" onclick="kModal(${k.id})">${t('Details')}</button></div>`]; });
  return phead(t('Contracts register'), t('Financing operations, their expiry and follow-up. Requests for instalments must match a contract here.'), has('contracts', 'create') ? `<button class="btn btn-y" onclick="contractModal(0)">${ic('plus')}${t('Register contract')}</button>` : '') +
    `<div class="kpis">${kpi(t('Active contracts'), N(open.length))}${kpi(t('Remaining principal (USD)'), M(totR, 'USD'), t('not yet requested'))}${kpi(t('Expiring soon'), `<span class="${nSoon ? 'soon' : ''}">${N(nSoon)}</span>`, t('within their reminder period'))}${kpi(t('Expired, not closed'), `<span class="${nExp ? 'late' : ''}">${N(nExp)}</span>`, t('renew or close them'))}</div>
    ${open.length ? `<div class="charts"><section class="card"><h2 class="h3">${t('Principal requested so far')}</h2><div class="sm mut" style="margin:2px 0 6px">${t('Largest contracts · requested against total principal')}</div>${progRows(prog)}</section>
     <section class="card"><h2 class="h3">${t('Remaining principal by financier')}</h2><div class="sm mut" style="margin:2px 0 10px">${t('USD at the latest rate')}</div>${hbar(Object.entries(byFin).map(([l, v]) => ({ label: l, value: v })), { plain: usdT, title: t('Remaining principal by financier') })}</section></div>` : ''}
    <div class="tabs" role="tablist">${tabs.map(x => `<button type="button" role="tab" aria-selected="${x === tab}" class="tab ${x === tab ? 'on' : ''}" onclick="setF('k','tab','${x.k}')">${esc(x.label)} <b>${L.filter(x.f).length}</b></button>`).join('')}</div>
    <div class="card flat"><div class="fbar">${searchBox('k', t('Operation no. or financier'))}<select class="in" onchange="setF('k','ent',this.value)"><option value="">${t('All entities')}</option>${D.entities.map(e => `<option value="${e.id}" ${String(e.id) === f.ent ? 'selected' : ''}>${esc(nm(e))}</option>`).join('')}</select></div>
     ${ptbl('kt', [t('Operation'), t('Entity'), { l: t('Principal'), n: 1 }, { l: t('Remaining'), n: 1 }, t('Expiry'), t('Follow-up'), ''], trs, tab.k === 'all' ? t('No contracts registered yet.') : t('Nothing here.'), 'cards', { noSearch: true })}</div>`;
}
function contractModal(id) {
  const k = D.contracts.find(x => x.id === id) || { currency: 'USD', entityId: (D.entities[0] || {}).id, startDate: today(), noticeDays: 30 };
  const fins = D.beneficiaries.filter(b => b.type === 'Financier');
  const followers = D.users.filter(u => u.active && (u.id === k.ownerId || (RK(u.role) && (RK(u.role).perms.contracts || []).length)));
  const auto = !id || !k.expiryDate || k.expiryDate === k.endDate;
  modal(`${mhead(id ? t('Edit contract {o}', { o: k.opNo }) : t('Register contract'))}<div class="mb">
   ${fins.length ? '' : `<div class="warnbox">${ic('alert')}<span>${t('Add the financier first as a beneficiary of type Financier.')}</span></div>`}
   <div class="fgrid" style="margin-top:0">${fld('k_op', t('Operation no.'), inp('k_op', k.opNo, 'dir="ltr"'), 1)}
    ${fld('k_fin', t('Financier'), sel('k_fin', [[0, t('Choose')], ...fins.map(b => [b.id, nm(b)])], k.financierId), 1)}
    ${fld('k_ent', t('Entity'), sel('k_ent', D.entities.map(e => [e.id, nm(e)]), k.entityId), 1)}${fld('k_cur', t('Currency'), sel('k_cur', CURS, k.currency), 1)}
    ${fld('k_pr', t('Principal'), inp('k_pr', k.principal, 'inputmode="decimal" dir="ltr"'), 1)}${fld('k_pf', t('Profit'), inp('k_pf', k.profit, 'inputmode="decimal" dir="ltr"'), 1)}
    ${fld('k_tm', t('Term (months)'), inp('k_tm', k.termMonths, 'inputmode="numeric" dir="ltr" oninput="kAutoExp()"'), 1)}${fld('k_in', t('Number of instalments'), inp('k_in', k.instalments, 'inputmode="numeric" dir="ltr"'), 1)}
    ${fld('k_sd', t('Start date'), dateIn('k_sd', k.startDate, 'onchange="kAutoExp()"'), 1)}
    ${fld('k_ex', t('Expiry date'), dateIn('k_ex', k.expiryDate || k.endDate || '', `data-auto="${auto ? 1 : 0}" oninput="this.dataset.auto='0'" onchange="if(event.isTrusted===false)this.dataset.auto='0'"`), 1)}
    ${fld('k_nd', t('Start following up (days before expiry)'), inp('k_nd', k.noticeDays || 30, 'inputmode="numeric" dir="ltr"'), 1)}
    ${fld('k_ow', t('Follow-up by'), sel('k_ow', [[0, t('Not assigned')], ...followers.map(u => [u.id, un(u)])], k.ownerId || 0))}
    ${fld('k_nt', t('Notes'), inp('k_nt', k.notes), 0, 'full')}</div>
   <div class="hint">${t('The expiry date follows the term until you change it. The follow-up starts in "Waiting for you" and the daily digest that many days before.')}</div></div>
   ${mfoot(`<button class="btn btn-y" onclick="act('saveContract',{id:${id},opNo:val('k_op'),financierId:val('k_fin'),entityId:val('k_ent'),currency:val('k_cur'),principal:val('k_pr'),profit:val('k_pf'),termMonths:val('k_tm'),instalments:val('k_in'),startDate:dval('k_sd'),expiryDate:dval('k_ex'),noticeDays:val('k_nd'),ownerId:val('k_ow'),notes:val('k_nt')},'${js(t('Contract saved'))}',{after:closeM})">${t('Save')}</button>`)}`, true);
}
/** While the expiry date follows the term, keep it at start date + term. */
function kAutoExp() {
  const ex = document.getElementById('k_ex'); if (!ex || ex.dataset.auto !== '1') return;
  const sd = dval('k_sd'), tm = parseInt(val('k_tm'), 10);
  if (sd && tm > 0) ex.value = fd(addMonths(sd, tm));
}
function extendModal(id) {
  const k = D.contracts.find(x => x.id === id);
  modal(`${mhead(t('Extend contract {o}', { o: k.opNo }), t('Ends on {d}', { d: fd(k.endDate) }))}<div class="mb"><div class="fgrid" style="margin-top:0">
   ${fld('x_m', t('Add months'), inp('x_m', '', 'inputmode="numeric" dir="ltr"'), 1)}${fld('x_i', t('New number of instalments (optional)'), inp('x_i', '', 'inputmode="numeric" dir="ltr"'))}${fld('x_n', t('Note'), inp('x_n', '', `placeholder="${t('e.g. rescheduling letter ref.')}"`), 1, 'full')}</div>
   <div class="hint">${t('The term and the instalment schedule change. If the expiry date is earlier than the new end, it moves to the new end.')}</div></div>
   ${mfoot(`<button class="btn btn-y" onclick="act('extendContract',{id:${id},months:val('x_m'),instalments:val('x_i'),note:val('x_n')},'${js(t('Contract extended'))}',{after:j=>kDone(j,'${js(t('Contract extended'))}')})">${t('Extend')}</button>`)}`);
}
function kFollowModal(id) {
  const k = D.contracts.find(x => x.id === id);
  modal(`${mhead(t('Follow up contract {o}', { o: k.opNo }), `${esc(nm(B(k.financierId)))} · ${t('Expiry')} ${fd(kExp(k))}`)}<div class="mb">
   <div style="margin-bottom:12px">${kChip(k)}</div>
   <div class="fgrid" style="margin-top:0">${fld('kf_n', t('What was done or agreed'), `<textarea class="in" id="kf_n" rows="3" placeholder="${t('e.g. asked the bank for the renewal letter')}"></textarea>`, 1, 'full')}
    ${fld('kf_d', t('Next follow-up (optional)'), dateIn('kf_d', ''))}</div>
   <div class="hint">${t('On that date it comes back in "Waiting for you". Leave it empty when nothing more is needed.')}</div></div>
   ${mfoot(`<button class="btn btn-y" onclick="act('followContract',{id:${id},note:val('kf_n'),nextDate:dval('kf_d')},'${js(t('Follow-up saved'))}',{after:closeM})">${t('Save')}</button>`)}`);
}
function kRenewModal(id) {
  const k = D.contracts.find(x => x.id === id), cur = kExp(k);
  modal(`${mhead(t('Renew contract {o}', { o: k.opNo }), t('Expires on {d}', { d: fd(cur) }))}<div class="mb"><div class="fgrid" style="margin-top:0">
   ${fld('kr_d', t('New expiry date'), dateIn('kr_d', addMonths(cur, 12)), 1)}${fld('kr_n', t('Note'), inp('kr_n', '', `placeholder="${t('e.g. renewal letter ref.')}"`), 1, 'full')}</div>
   <div class="hint">${t('Only the expiry date changes. To change the term or the instalments, use Extend.')}</div></div>
   ${mfoot(`<button class="btn btn-y" onclick="act('renewContract',{id:${id},expiryDate:dval('kr_d'),note:val('kr_n')},'${js(t('Contract renewed'))}',{after:j=>kDone(j,'${js(t('Contract renewed'))}')})">${t('Renew')}</button>`)}`);
}
function kCloseModal(id) {
  const k = D.contracts.find(x => x.id === id);
  modal(`${mhead(t('Close contract {o}', { o: k.opNo }), esc(nm(B(k.financierId))))}<div class="mb"><div class="fgrid" style="margin-top:0">
   ${fld('kc_r', t('Reason'), sel('kc_r', KCLOSE.map(x => [x, t(x)]), 'Fully settled'), 1)}${fld('kc_n', t('Note'), inp('kc_n', ''), 0, 'full')}</div>
   <div class="hint">${t('A closed contract takes no new instalment requests and drops out of the follow-up. You can reopen it.')}</div></div>
   ${mfoot(`<button class="btn btn-r" onclick="act('closeContract',{id:${id},reason:val('kc_r'),note:val('kc_n')},'${js(t('Contract closed'))}',{after:j=>kDone(j,'${js(t('Contract closed'))}')})">${t('Close contract')}</button>`)}`);
}
function kReopenModal(id) {
  const k = D.contracts.find(x => x.id === id);
  modal(`${mhead(t('Reopen contract {o}', { o: k.opNo }))}<div class="mb"><div class="fgrid" style="margin-top:0">${fld('ko_n', t('Why is it reopened?'), inp('ko_n', ''), 1, 'full')}</div></div>
   ${mfoot(`<button class="btn btn-y" onclick="act('reopenContract',{id:${id},note:val('ko_n')},'${js(t('Contract reopened'))}',{after:closeM})">${t('Reopen')}</button>`)}`);
}
/** History entries in the reader's language (older entries keep their saved English text). */
function kLogText(x) {
  const d = x.date ? fd(x.date) : '', n = x.note ? ' · ' + x.note : '';
  switch (x.kind) {
    case 'follow': return t('Follow-up') + ': ' + (x.note || '') + (d ? ' · ' + t('next follow-up {d}', { d }) : '');
    case 'renew': return t('Renewed until {d}', { d }) + n;
    case 'extend': return t('Extended to {d}', { d }) + n;
    case 'close': return t('Closed') + ' · ' + t(x.reason || '') + n;
    case 'reopen': return t('Reopened') + n;
    case 'create': return LANG === 'ar' ? t('Contract registered') + (d ? ' · ' + t('expiry {d}', { d }) : '') : x.text;
    case 'edit': return LANG === 'ar' ? t('Contract updated') + (d ? ' · ' + t('expiry {d}', { d }) : '') : x.text;
    default: return x.text;
  }
}
function kModal(id) {
  const k = D.contracts.find(x => x.id === id); if (!k) return;
  let log = []; try { log = JSON.parse(k.log || '[]'); } catch (e) { }
  const s = kStats(k), x = kState(k), ed = has('contracts', 'edit');
  const btns = [
    !x.closed && kCanFollow(k) ? `<button class="btn btn-y btn-sm" onclick="kFollowModal(${k.id})">${t('Follow up')}</button>` : '',
    ed && !x.closed ? `<button class="btn btn-o btn-sm" onclick="kRenewModal(${k.id})">${t('Renew')}</button><button class="btn btn-o btn-sm" onclick="extendModal(${k.id})">${t('Extend')}</button>` : '',
    ed ? `<button class="btn btn-o btn-sm" onclick="contractModal(${k.id})">${ic('edit')}${t('Edit')}</button>` : '',
    ed ? (x.closed ? `<button class="btn btn-o btn-sm" onclick="kReopenModal(${k.id})">${t('Reopen')}</button>` : `<button class="btn btn-o btn-sm" onclick="kCloseModal(${k.id})">${t('Close')}</button>`) : '',
    has('contracts', 'delete') && !s.count ? `<button class="btn btn-r btn-sm" onclick="confirmBox('${js(t('Delete contract'))}','${js(t('Delete {n}?', { n: k.opNo }))}','${js(t('Delete'))}',()=>act('delContract',{id:${k.id}},'${js(t('Deleted'))}',{after:closeM}),true)">${ic('trash')}${t('Delete')}</button>` : ''].join('');
  modal(`${mhead(t('Contract {o}', { o: k.opNo }), esc(nm(B(k.financierId))) + ' · ' + esc(nm(E(k.entityId))))}<div class="mb">
   <div class="pairs" style="margin-top:0">${pair(t('Expiry date'), `${FD(kExp(k))} ${kChip(k)}`)}${pair(t('Start following up'), t('{n} days before expiry', { n: k.noticeDays || 30 }))}
    ${pair(t('Follow-up by'), k.ownerId ? esc(UN(k.ownerId)) : `<span class="mut">${t('Not assigned')}</span>`)}${pair(t('Next follow-up'), k.followUpDate ? FD(k.followUpDate) : '—')}
    ${pair(t('Term'), `${FD(k.startDate)} – ${FD(k.endDate)} · ${k.termMonths} ${t('months')} · ${k.instalments} ${t('instalments')}`)}${pair(t('Principal'), `${M(k.principal, k.currency)} · ${t('Remaining')} ${M(s.remaining, k.currency)}`)}
    ${x.closed ? pair(t('Closed'), `${esc(kLogText({ kind: 'close', reason: (k.closeReason || '').split(' · ')[0], note: (k.closeReason || '').split(' · ').slice(1).join(' · ') }))} · ${esc(byN(k.closedBy || ''))} ${FD(k.closedAt)}`) : ''}</div>
   ${btns ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">${btns}</div>` : ''}
   <h3 class="h3" style="margin:18px 0 12px">${t('Follow-up history')}</h3>${log.slice().reverse().map(e => `<div class="tl"><div>${esc(kLogText(e))} · <span class="mut">${esc(byN(e.by))}</span></div><div class="sm mut">${FD(e.at)}</div></div>`).join('') || `<div class="mut">${t('No history.')}</div>`}
   <h3 class="h3" style="margin:16px 0 8px;display:flex;justify-content:space-between;gap:8px;align-items:center">${t('Requests against this contract')}${s.count && has('cheques') ? `<button class="btn btn-o btn-sm" onclick="kShowAll('${esc(js(k.opNo))}')">${t('Show all {n}', { n: N(s.count) })}</button>` : ''}</h3>${s.cheques.slice(0, 20).map(c => `<div class="task"><a class="lnk" href="#/cheque/${c.id}" onclick="closeM()"><bdi dir="ltr">${c.id}</bdi></a> ${chip(c.status)} <span class="sm mut">${payTxt(c)}</span></div>`).join('') || `<div class="mut">${t('None yet.')}</div>`}</div>`, true);
}
const logModal = kModal;

/* =================== PAYMENTS ON ACCOUNT =================== */
function poaPage() {
  if (!has('poa')) return denied();
  if (!repData()) return phead(t('Payments on account'), '', '') + repBar() + `<div class="card">${spLoading()}</div>`;
  const L = visible().filter(c => isPoa(c) && !['Rejected', 'Cancelled'].includes(c.status));
  const open = L.filter(c => !c.poa), over = open.filter(c => daysUntil(c.poaSettleDate) < 0);
  return phead(t('Payments on account'), t('Advance payments waiting for the invoice that settles them')) + repBar() +
    `<div class="kpis">${kpi(t('Open'), N(open.length))}${kpi(t('Overdue to settle'), `<span class="${over.length ? 'late' : ''}">${N(over.length)}</span>`)}${kpi(t('Open value (USD)'), M(open.reduce((a, c) => a + usdOf(c), 0), 'USD'))}${kpi(t('Settled'), N(L.length - open.length))}</div>` +
    chqList('poa', L, [{ k: 'open', label: t('Open'), f: c => !c.poa, sort: (a, b) => (a.poaSettleDate || '') < (b.poaSettleDate || '') ? -1 : 1 }, { k: 'od', label: t('Overdue'), f: c => !c.poa && daysUntil(c.poaSettleDate) < 0 }, { k: 'done', label: t('Settled'), f: c => !!c.poa }], t('No payments on account.'));
}

/* =================== JOURNAL ENTRIES =================== */
const KINDS = ['Issue', 'Revaluation', 'Revaluation reversal', 'Clearing', 'Return', 'Payment on account settled'];
function entriesPage() {
  if (!has('entries')) return denied();
  if (!repData()) return phead(t('Journal entries'), '', '') + repBar() + `<div class="card">${spLoading()}</div>`;
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
  return (phead(t('Journal entries'), t('Built from each cheque. Post them in the accounting system, then mark them here.'), `<button class="btn btn-o" onclick="exportEntries()">${ic('dl')}${t('Export to Excel')}</button>`) + repBar()) +
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
  if (!has('reports')) return denied();
  if (!repData()) return phead(t('Reports'), '', '') + repBar() + `<div class="card">${spLoading()}</div>`;
  const f = F('rep', { tab: 'overview' });
  const fn = { overview: repOverview, outstanding: repOutstanding, realised: repRealised, ageing: repAgeing, entity: repEntity, contracts: repContracts, poa: repPoa, prior: repPrior }[f.tab] || repOverview;
  const r = fn(f);
  S.repCsv = r.csv;
  return phead(t('Reports'), t('Figures in USD use the rate saved with each cheque unless the report says otherwise.'), `<div style="display:flex;gap:8px">${r.csv ? `<button class="btn btn-o" onclick="csv(S.repCsv.name,S.repCsv.head,S.repCsv.rows)">${ic('dl')}${t('Export to Excel')}</button>` : ''}<button class="btn btn-o" onclick="print()">${ic('print')}${t('Print')}</button></div>`) +
   repBar() + `<div class="ul-tabs" role="tablist">${REPORTS.map(([k, l]) => `<button role="tab" aria-selected="${k === f.tab}" class="${k === f.tab ? 'on' : ''}" onclick="setF('rep','tab','${k}')">${t(l)}</button>`).join('')}</div>
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
    charts: ccard(t('Approved per month, last 12 months'), t('USD equivalent · hover for the count'), vbars(months.map(m => m.label), [{ name: t('Approved'), values: mv.map(l => l.reduce((a, c) => a + usdOf(c), 0)), color: CH.gold }], { plain: usdT, tipx: i => t('{n} cheques', { n: mv[i].length }), title: t('Approved per month') })) +
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
    table: ptbl('r_out', [t('Cheque'), t('Entity'), t('Cheque no.'), { l: t('Cheque amount'), n: 1 }, { l: t('Carrying value'), n: 1 }, { l: t('Value at report date'), n: 1 }, { l: t('Difference'), n: 1 }, t('Due date')],
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
    table: ptbl('r_real', [t('Cheque'), t('Entity'), t('Cleared'), { l: t('At issue'), n: 1 }, { l: t('At clearing'), n: 1 }, { l: t('Total'), n: 1 }], rows.map(x => [`<a class="lnk" href="#/cheque/${x.c.id}"><bdi dir="ltr">${x.c.id}</bdi></a><div class="sm mut">${esc(nm(B(x.c.benId)))}</div>`, esc(nm(E(x.c.entityId))), FD(x.c.closed.at), fxSpan(x.iss, x.fc), fxSpan(x.clr, x.fc), fxSpan(x.iss + x.clr, x.fc)]), t('No cheques cleared in this period.'), 'cards'),
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
    table: ptbl('r_age', [t('Period'), { l: t('Cheques'), n: 1 }, { l: t('Value (USD)'), n: 1 }, t('Cheques')], g.map(x => [x.l, N(x.x.length), M(x.v, 'USD'), x.x.slice(0, 6).map(c => `<a href="#/cheque/${c.id}"><bdi dir="ltr">${c.id}</bdi></a>`).join(', ') + (x.x.length > 6 ? ' …' : '')])),
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
    table: ptbl('r_ent', [t('Entity'), t('Currency'), { l: t('Cheques'), n: 1 }, { l: t('Amount'), n: 1 }, { l: t('USD'), n: 1 }, { l: t('Still open (USD)'), n: 1 }], rows.map(r => [esc(nm(r.e)), r.cur, N(r.n), M(r.amt, r.cur), M(r.usd, 'USD'), M(r.open, 'USD')]), t('No approved cheques in this period.')),
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
    table: ptbl('r_k', [t('Operation'), t('Financier'), { l: t('Principal'), n: 1 }, { l: t('Requested'), n: 1 }, { l: t('Cleared'), n: 1 }, { l: t('Remaining'), n: 1 }, t('Ends')], L.map(x => [esc(x.k.opNo), esc(nm(B(x.k.financierId))), M(x.k.principal, x.k.currency), M(x.s.used, x.k.currency), M(x.s.paid, x.k.currency), M(x.s.remaining, x.k.currency), FD(x.k.endDate)]), t('No contracts registered yet.')),
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
    table: ptbl('r_poa', [t('Cheque'), t('Entity'), { l: t('Amount'), n: 1 }, t('Settle by'), t('Stage')], L.map(c => [`<a class="lnk" href="#/cheque/${c.id}"><bdi dir="ltr">${c.id}</bdi></a><div class="sm mut">${esc(nm(B(c.benId)))}</div>`, esc(nm(E(c.entityId))), payTxt(c), `${FD(c.poaSettleDate)}${daysUntil(c.poaSettleDate) < 0 ? `<div class="sm late">${t('{n} days overdue', { n: -daysUntil(c.poaSettleDate) })}</div>` : ''}`, chip(c.status)]), t('No open payments on account.'), 'cards'),
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
    table: ptbl('r_prior', [t('Cheque'), t('Requested by'), t('Date paid'), t('Requested on'), { l: t('Days'), n: 1 }, t('How it was paid'), t('Stage')], L.map(c => [`<a class="lnk" href="#/cheque/${c.id}"><bdi dir="ltr">${c.id}</bdi></a><div class="sm mut">${esc(nm(B(c.benId)))} · ${payTxt(c)}</div>`, esc(UN(c.requesterId)), FD(c.priorDate), FD(c.createdAt), N(days(c.priorDate, c.createdAt)), `${esc(c.priorMethod || '')} · ${esc(c.priorRef || '')}`, chip(c.status)]), t('None.'), 'cards'),
    csv: { name: 'paid-before-request', head: ['Cheque', 'Beneficiary', 'Requested by', 'Date paid', 'Requested on', 'Days', 'Method', 'Reference', 'Amount', 'Currency', 'Stage'], rows: L.map(c => [c.id, B(c.benId).nameEn, U(c.requesterId).fullName, fd(c.priorDate), fd(c.createdAt), days(c.priorDate, c.createdAt), c.priorMethod, c.priorRef, c.amount, c.currency, stageName(c.status)]) }
  };
}

/* =================== BANKING =================== */
function banksPage() {
  if (!has('banks')) return denied();
  const cfo = has('banks', 'create') || has('banks', 'edit');
  const bRows = D.banks.map(b => [`<b>${esc(nm(b))}</b>${b.nameAr && LANG !== 'ar' ? `<div class="sm mut" dir="rtl">${esc(b.nameAr)}</div>` : ''}`, b.currency, N(D.accounts.filter(a => a.bankId === b.id).length), activeChip(b.active), cfo ? `<button class="btn btn-o btn-sm" onclick="bankModal(${b.id})">${t('Edit')}</button>` : '']);
  const aRows = D.accounts.map(a => {
    const au = acctUseOf(a.id), iss = { length: +au.issued || 0 }, out = D.cheques.filter(c => c.issue && c.issue.accountId === a.id && OUTSTANDING.includes(c.status));
    const nf = nextFree(a.id), left = D.books.filter(k => k.accountId === a.id && k.active).reduce((s, k) => s + (k.to - k.from + 1), 0) - (+au.inBooks || 0) - (+au.vd || 0);
    return [`<b>${esc(nm(BK(a.bankId)))} ••${esc(a.last4)}</b><div class="sm mut">${esc(a.description || '')}</div>`, esc(nm(E(a.entityId))), a.currency, `<bdi dir="ltr">${esc(a.ledger || '—')}</bdi>`, N(iss.length), M(out.reduce((s, c) => s + usdOf(c), 0), 'USD'),
      nf ? `<bdi dir="ltr">${nf}</bdi><div class="sm ${left < 10 ? 'late' : 'mut'}">${t('{n} left', { n: Math.max(0, left) })}</div>` : `<span class="late">${t('No chequebook')}</span>`, activeChip(a.active), cfo ? `<button class="btn btn-o btn-sm" onclick="accountModal(${a.id})">${t('Edit')}</button>` : ''];
  });
  const byB = D.accounts.map(a => ({ label: `${nm(BK(a.bankId))} ••${a.last4}`, value: D.cheques.filter(c => c.issue && c.issue.accountId === a.id && OUTSTANDING.includes(c.status)).reduce((s, c) => s + usdOf(c), 0) }));
  return phead(t('Banks & accounts'), cfo ? t('Each account belongs to one entity and one currency.') : t('Managed by the CFO.'), cfo ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-o" onclick="bankModal(0)">${ic('plus')}${t('Add bank')}</button><button class="btn btn-y" onclick="accountModal(0)" ${D.banks.length ? '' : 'disabled'}>${ic('plus')}${t('Add account')}</button></div>` : '') +
    `<section class="card flat"><div style="padding:16px 16px 4px"><h2 class="h3">${t('Banks')}</h2></div>${ptbl('bk', [t('Bank'), t('Currency'), { l: t('Accounts'), n: 1 }, t('Status'), ''], bRows, t('No banks yet.'))}</section>
     <section class="card flat"><div style="padding:16px 16px 4px"><h2 class="h3">${t('Accounts')}</h2></div>${ptbl('ac', [t('Account'), t('Entity'), t('Currency'), t('Ledger account'), { l: t('Cheques issued'), n: 1 }, { l: t('Outstanding (USD)'), n: 1 }, t('Next number'), t('Status'), ''], aRows, t('No accounts yet.'), 'cards')}</section>
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
  if (!has('books')) return denied();
  const cfo = has('books', 'create') || has('books', 'edit');
  const rows = D.books.map(k => {
    const bu = (D.bookUse || []).find(x => x.id === k.id) || {};      // counted by the server over every number
    const used = +bu.used || 0, vd = +bu.vd || 0, size = k.to - k.from + 1, left = size - used - vd;
    return [esc(acctName(AC(k.accountId))), `<bdi dir="ltr">${k.from} – ${k.to}</bdi>`, `<div style="min-width:140px"><div class="prog"><i style="width:${(used + vd) / size * 100}%"></i></div><div class="sm mut" style="margin-top:4px">${t('{u} used · {v} voided', { u: used, v: vd })}</div></div>`,
      `<span class="${left < 10 && k.active ? 'late' : ''}">${N(left)}</span>`, activeChip(k.active), `${esc(byN(k.by || ''))}<div class="sm mut">${FD(k.at)}</div>`, cfo ? `<button class="btn btn-o btn-sm" onclick="bookModal(${k.id})">${t('Edit')}</button>` : ''];
  });
  return phead(t('Chequebooks'), t('Cheque numbers can be issued only from an active chequebook of the account.'), cfo ? `<button class="btn btn-y" onclick="bookModal(0)" ${D.accounts.length ? '' : 'disabled'}>${ic('plus')}${t('Add chequebook')}</button>` : '') +
    `<div class="card flat">${ptbl('bks', [t('Account'), t('Numbers'), t('Usage'), { l: t('Left'), n: 1 }, t('Status'), t('Added by'), ''], rows, t('No chequebooks yet.'), 'cards')}</div>`;
}
function bookModal(id) {
  const k = D.books.find(x => x.id === id) || { accountId: (D.accounts[0] || {}).id, active: true };
  modal(`${mhead(id ? t('Edit chequebook') : t('Add chequebook'))}<div class="mb"><div class="fgrid" style="margin-top:0">${fld('k_a', t('Account'), sel('k_a', D.accounts.filter(a => a.active || a.id === k.accountId).map(a => [a.id, acctName(a)]), k.accountId), 1, 'full')}
   ${fld('k_f', t('First number'), inp('k_f', k.from, 'inputmode="numeric" dir="ltr"'), 1)}${fld('k_t', t('Last number'), inp('k_t', k.to, 'inputmode="numeric" dir="ltr"'), 1)}</div>${id ? swRow('k_act', t('Active'), k.active) : ''}</div>
   ${mfoot(`<button class="btn btn-y" onclick="act('saveBook',{id:${id},accountId:val('k_a'),from:val('k_f'),to:val('k_t'),active:${id ? "chk('k_act')" : 'true'}},'${js(t('Saved'))}',{after:closeM})">${t('Save')}</button>`)}`);
}
function voidedPage() {
  if (!has('voided')) return denied();
  const f = F('vd', { acc: '' }), qp = { size: f.size }; if (f.acc) qp.account = f.acc;
  const pg = spGet('vd', '/api/voided', qp);
  const rows = (pg ? pg.rows : []).map(v => [esc(acctName(AC(v.accountId))), `<bdi dir="ltr">${v.number}</bdi>`, esc(v.reason), `${esc(byN(v.by))}<div class="sm mut">${FD(v.at)}</div>`]);
  return phead(t('Voided numbers'), t('Spoiled or cancelled cheque leaves. A voided number can never be issued.'), has('voided', 'create') ? `<button class="btn btn-y" onclick="voidModal()" ${D.accounts.length ? '' : 'disabled'}>${ic('plus')}${t('Void a number')}</button>` : '') +
    `<div class="card flat"><div class="fbar"><select class="in" aria-label="${t('Account')}" onchange="setF('vd','acc',this.value)"><option value="">${t('All accounts')}</option>${D.accounts.map(a => `<option value="${a.id}" ${String(a.id) === f.acc ? 'selected' : ''}>${esc(acctName(a))}</option>`).join('')}</select></div>
     ${!pg ? spLoading() : pg.err ? `<div class="empty late">${esc(tErr(pg.err))}</div>` : tbl([t('Account'), t('Number'), t('Reason'), t('Recorded by')], rows, t('No voided numbers.'), 'cards') + spPager('vd', pg, null)}</div>`;
}
function voidModal() {
  modal(`${mhead(t('Void a cheque number'))}<div class="mb"><div class="fgrid" style="margin-top:0">${fld('v_a', t('Account'), sel('v_a', D.accounts.map(a => [a.id, acctName(a)])), 1, 'full')}${fld('v_n', t('Cheque number'), inp('v_n', '', 'inputmode="numeric" dir="ltr"'), 1)}${fld('v_r', t('Reason'), inp('v_r', '', `placeholder="${t('e.g. spoiled while writing')}"`), 1)}</div></div>
   ${mfoot(`<button class="btn btn-r" onclick="act('voidNo',{accountId:val('v_a'),number:val('v_n'),reason:val('v_r')},'${js(t('Number voided'))}',{after:closeM})">${t('Void number')}</button>`)}`);
}

/* =================== BENEFICIARIES =================== */
function bensPage() {
  if (!has('beneficiaries')) return denied();
  const fin = has('beneficiaries', 'edit'), canDel = has('beneficiaries', 'delete'), f = F('ben', { x: '' }), q = f.q.trim().toLowerCase();
  const use = id => (D.benUse.find(x => x.id === id) || { n: 0 }).n;
  const L = D.beneficiaries.filter(b => (!f.x || b.type === f.x) && (!q || (b.code + ' ' + b.nameEn + ' ' + (b.nameAr || '') + ' ' + (b.contact || '')).toLowerCase().includes(q)));
  const p = pageOf('ben', L);
  const rows = p.rows.map(b => [`<b>${esc(nm(b))}</b>${LANG === 'ar' ? '' : b.nameAr ? `<div class="sm mut" dir="rtl">${esc(b.nameAr)}</div>` : ''}<div class="sm mut"><bdi dir="ltr">${esc(b.code)}</bdi></div>`, t(b.type), `${esc(b.contact || '—')}<div class="sm mut"><bdi dir="ltr">${esc(b.phone || '')}</bdi> ${esc(b.email || '')}</div>`, N(use(b.id)),
    fin || canDel ? `<div style="display:flex;gap:6px">${fin ? `<button class="btn btn-o btn-sm" onclick="benModal(${b.id})">${t('Edit')}</button>` : ''}${use(b.id) || !canDel ? '' : `<button class="btn btn-r btn-sm" aria-label="${t('Delete')}" onclick="confirmBox('${js(t('Delete beneficiary'))}','${js(t('Delete {n}?', { n: nm(b) }))}','${js(t('Delete'))}',()=>act('delBen',{id:${b.id}},'${js(t('Deleted'))}'),true)">${ic('trash')}</button>`}</div>` : '']);
  return phead(t('Beneficiaries'), t('Suppliers, financiers and others who receive cheques'), has('beneficiaries', 'create') ? `<button class="btn btn-y" onclick="benModal(0)">${ic('plus')}${t('Add beneficiary')}</button>` : '') +
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
  if (!has('entities')) return denied();
  const ed = has('entities', 'edit');
  const rows = D.entities.map(e => [`<b>${esc(e.nameEn)}</b>`, `<span dir="rtl">${esc(e.nameAr || '')}</span>`, `<span class="chip c-appr">${e.funcCur}</span>`, N(((D.entUse || []).find(x => x.id === e.id) || {}).n || 0), N(D.accounts.filter(a => a.entityId === e.id).length), ed ? `<button class="btn btn-o btn-sm" onclick="entModal(${e.id})">${t('Edit')}</button>` : '']);
  return phead(t('Entities'), t('Each entity keeps its books in its functional currency.'), has('entities', 'create') ? `<button class="btn btn-y" onclick="entModal(0)">${ic('plus')}${t('Add entity')}</button>` : '') +
    (D.settings.funcConfirmed ? `<div class="okbox">${ic('check')}<span>${t('Functional currencies are confirmed.')}</span></div>` : `<div class="warnbox">${ic('alert')}<span style="flex:1">${t('Confirm with the accountant that each functional currency is right before the first approval. It cannot change once cheques are approved.')}</span>${ed ? `<button class="btn btn-y btn-sm" onclick="act('confirmFunc',{},'${js(t('Confirmed'))}')">${t('Confirm')}</button>` : ''}</div>`) +
    `<div class="card flat">${ptbl('ent', [t('Name (English)'), t('Name (Arabic)'), t('Functional currency'), { l: t('Cheques'), n: 1 }, { l: t('Bank accounts'), n: 1 }, ''], rows)}</div>`;
}
function entModal(id) {
  const e = D.entities.find(x => x.id === id) || { funcCur: 'SDG' };
  modal(`${mhead(id ? t('Edit entity') : t('Add entity'))}<div class="mb"><div class="fgrid" style="margin-top:0">${fld('e_en', t('Name (English)'), inp('e_en', e.nameEn), 1)}${fld('e_ar', t('Name (Arabic)'), inp('e_ar', e.nameAr, 'dir="rtl"'))}${fld('e_fc', t('Functional currency'), sel('e_fc', CURS, e.funcCur), 1)}</div></div>
   ${mfoot(`<button class="btn btn-y" onclick="act('saveEntity',{id:${id},nameEn:val('e_en'),nameAr:val('e_ar'),funcCur:val('e_fc')},'${js(t('Saved'))}',{after:closeM})">${t('Save')}</button>`)}`);
}
function deptsPage() {
  if (!has('departments')) return denied();
  const ed = has('departments', 'edit'), del = has('departments', 'delete'), addRole = has('roles', 'create');
  const rows = D.departments.map(d => {
    const users = D.users.filter(u => u.deptId === d.id), roles = D.roles.filter(r => r.deptId === d.id), reqs = +(((D.deptUse || []).find(x => x.id === d.id) || {}).n || 0);
    return [`<b>${esc(nm(d))}</b><div class="sm mut" ${LANG === 'ar' ? 'dir="ltr"' : 'dir="rtl"'}>${esc(LANG === 'ar' ? d.nameEn : (d.nameAr || ''))}</div>`, N(users.filter(u => u.active).length),
      roles.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${roles.map(r => has('roles') ? `<a class="chip role" href="#/role/${r.id}">${esc(nm(r))}</a>` : `<span class="chip role">${esc(nm(r))}</span>`).join('')}</div>` : `<span class="sm mut">${t('Uses the roles for all departments')}</span>`,
      N(reqs),
      `<div style="display:flex;gap:6px;flex-wrap:wrap">${ed ? `<button class="btn btn-o btn-sm" onclick="deptModal(${d.id})">${t('Edit')}</button>` : ''}${addRole ? `<a class="btn btn-o btn-sm" href="#/role/new?dept=${d.id}">${ic('plus')}${t('Add role')}</a>` : ''}${del && !users.length && !roles.length && !reqs ? `<button class="btn btn-r btn-sm" aria-label="${t('Delete')}" onclick="confirmBox('${js(t('Delete department'))}','${js(t('Delete {n}?', { n: nm(d) }))}','${js(t('Delete'))}',()=>act('delDept',{id:${d.id}},'${js(t('Deleted'))}'),true)">${ic('trash')}</button>` : ''}</div>`];
  });
  const by = D.departments.map(d => ({ label: nm(d), value: +(((D.deptUse || []).find(x => x.id === d.id) || {}).usd || 0) }));
  return phead(t('Departments'), t('Each department can have its own roles. Roles for all departments can be given to anyone.'), has('departments', 'create') ? `<button class="btn btn-y" onclick="deptModal(0)">${ic('plus')}${t('Add department')}</button>` : '') +
    `<div class="card flat">${ptbl('dep', [t('Department'), { l: t('Active users'), n: 1 }, t('Department roles'), { l: t('Requests'), n: 1 }, ''], rows, '', 'cards')}</div>
     <div class="charts">${ccard(t('Requests by department'), t('USD equivalent at approval, excluding rejected and cancelled'), hbar(by, { plain: usdT, title: t('Requests by department') }))}</div>`;
}
function deptModal(id) {
  const d = D.departments.find(x => x.id === id) || {};
  modal(`${mhead(id ? t('Edit department') : t('Add department'))}<div class="mb"><div class="fgrid" style="margin-top:0">${fld('d_en', t('Name (English)'), inp('d_en', d.nameEn), 1)}${fld('d_ar', t('Name (Arabic)'), inp('d_ar', d.nameAr, 'dir="rtl"'))}</div></div>
   ${mfoot(`<button class="btn btn-y" onclick="act('saveDept',{id:${id},nameEn:val('d_en'),nameAr:val('d_ar')},'${js(t('Saved'))}',{after:closeM})">${t('Save')}</button>`)}`);
}

/* =================== USER ACCOUNTS =================== */
function scopeName(s) { return s === 'all' ? t('All departments') : s === 'dept' ? t('Own department') : t('Own requests only'); }
/** Roles a user of this department may have: the department's own roles, then the roles for all departments. */
function rolesFor(deptId) { return D.roles.filter(r => r.deptId === deptId).concat(D.roles.filter(r => r.deptId == null)); }
function roleOpts(deptId, cur) {
  const own = D.roles.filter(r => r.deptId === deptId), all = D.roles.filter(r => r.deptId == null);
  const o = r => `<option value="${esc(r.key)}" ${r.key === cur ? 'selected' : ''}>${esc(nm(r))}</option>`;
  return (own.length ? `<optgroup label="${esc(t('Roles of {d}', { d: nm(Dp(deptId)) }))}">${own.map(o).join('')}</optgroup>` : '') + `<optgroup label="${esc(t('Roles for all departments'))}">${all.map(o).join('')}</optgroup>`;
}
function uDeptChanged() {
  const dep = +val('u_dp'), ro = document.getElementById('u_ro'); if (!ro) return;
  const cur = ro.value, ok = rolesFor(dep).some(r => r.key === cur);
  ro.innerHTML = roleOpts(dep, ok ? cur : 'USER'); uRoleHint();
}
function uRoleHint() {
  const r = RK(val('u_ro')), h = document.getElementById('u_rh'); if (!h) return;
  h.innerHTML = r ? `${esc(t('Sees: {s}', { s: scopeName(r.scope) }))} · ${esc(t('{n} pages', { n: Object.keys(r.perms || {}).length }))}${has('roles') && r.id ? ` · <a href="#/role/${r.id}" onclick="closeM()">${t('See the rights')}</a>` : ''}` : '';
}
function usersPage() {
  if (!has('users')) return denied();
  const f = F('usr', { x: '', dep: '' }), q = f.q.trim().toLowerCase(), ed = has('users', 'edit');
  const L = D.users.filter(u => (!f.x || u.role === f.x) && (!f.dep || String(u.deptId) === f.dep) && (!q || (u.fullName + ' ' + (u.fullNameAr || '') + ' ' + u.username + ' ' + (u.email || '')).toLowerCase().includes(q)));
  const noMail = D.users.filter(u => u.active && !u.email).length, noAr = D.users.filter(u => u.active && !u.fullNameAr).length;
  const status = u => !u.active ? `<span class="chip c-can">${t('Disabled')}</span>` : u.lockedUntil ? `<span class="chip c-ret">${ic('lock')}${t('Locked')}</span>` : `<span class="chip c-clr">${t('Active')}</span>`;
  const other = u => LANG === 'ar' ? (u.fullNameAr ? `<div class="sm mut" dir="ltr">${esc(u.fullName)}</div>` : '') : (u.fullNameAr ? `<div class="sm mut" dir="rtl">${esc(u.fullNameAr)}</div>` : '');
  const rows = L.map(u => [`<b>${esc(un(u))}</b>${other(u)}<div class="sm mut"><bdi dir="ltr">${esc(u.username)}</bdi></div>`, u.email ? `<bdi dir="ltr">${esc(u.email)}</bdi>` : `<span class="late">${t('Missing')}</span>`,
    RK(u.role) && has('roles') ? `<a class="chip role" href="#/role/${RK(u.role).id}">${esc(roleName(u.role))}</a>` : `<span class="chip role">${esc(roleName(u.role))}</span>`, esc(nm(Dp(u.deptId))), u.lang === 'ar' ? 'العربية' : 'English', u.twoFa ? `<span class="chip c-appr">${ic('shield')}${t('On')}</span>` : `<span class="mut">${t('Off')}</span>`, status(u),
    u.lastLogin ? FD(u.lastLogin) : '<span class="mut">—</span>', ed ? `<button class="btn btn-o btn-sm" onclick="userModal(${u.id})">${t('Edit')}</button>` : '']);
  const roleCounts = D.roles.map(r => ({ label: nm(r), value: D.users.filter(u => u.active && u.role === r.key).length })).filter(x => x.value > 0);
  return phead(t('User accounts'), t('Email is required: it is used for password reset and sign-in codes.'), has('users', 'create') ? `<button class="btn btn-y" onclick="userModal(0)">${ic('plus')}${t('Add user')}</button>` : '') +
    (noMail ? `<div class="warnbox">${ic('alert')}<span>${t('{n} active users have no email and cannot reset their password. Add it.', { n: noMail })}</span></div>` : '') +
    (noAr ? `<div class="vbox">${ic('info')}<span>${noAr === 1 ? t('1 active user has no Arabic name yet, so the English name shows in Arabic screens.') : t('{n} active users have no Arabic name yet, so their English name shows in Arabic screens.', { n: noAr })}</span></div>` : '') +
    (D.settings.mailReady ? '' : `<div class="vbox">${ic('info')}<span>${t('Email is not set up yet, so reset links and sign-in codes cannot be sent.')} ${has('settings') ? `<a href="#/settings" onclick="F('set').tab='smtp'">${t('Set up email')}</a>` : ''}</span></div>`) +
    `<div class="card flat"><div class="fbar">${searchBox('usr', t('Name, username or email'))}<select class="in" onchange="setF('usr','x',this.value)"><option value="">${t('All roles')}</option>${D.roles.map(r => `<option value="${esc(r.key)}" ${r.key === f.x ? 'selected' : ''}>${esc(nm(r))}</option>`).join('')}</select>
     <select class="in" onchange="setF('usr','dep',this.value)"><option value="">${t('All departments')}</option>${D.departments.map(d => `<option value="${d.id}" ${String(d.id) === f.dep ? 'selected' : ''}>${esc(nm(d))}</option>`).join('')}</select></div>
     ${ptbl('usr', [t('User'), t('Email'), t('Role'), t('Department'), t('Language'), t('Two-step'), t('Status'), t('Last sign-in'), ''], rows, t('No users.'), 'cards', { noSearch: true })}</div>
     <div class="charts">${ccard(t('Active users by role'), '', hbar(roleCounts, { plain: v => String(v), title: t('Active users by role') }))}</div>`;
}
function userModal(id) {
  const u = D.users.find(x => x.id === id) || { role: 'USER', deptId: (D.departments[0] || {}).id, lang: 'ar', active: true, mustChange: true };
  const mail = D.settings.mailReady;
  modal(`${mhead(id ? t('Edit user') : t('Add user'), id ? esc(u.username) : '')}<div class="mb">
   <div class="fgrid" style="margin-top:0">${fld('u_fn', t('Full name (English)'), inp('u_fn', u.fullName, 'dir="ltr"'), 1)}${fld('u_fa', t('Full name (Arabic)'), inp('u_fa', u.fullNameAr, 'dir="rtl"'))}
    ${fld('u_un', t('Username'), inp('u_un', u.username, 'dir="ltr" autocomplete="off"'), 1)}${fld('u_em', t('Email'), inp('u_em', u.email, 'dir="ltr" type="email" autocomplete="off"'), 1)}
    ${fld('u_dp', t('Department'), sel('u_dp', D.departments.map(d => [d.id, nm(d)]), u.deptId, 'onchange="uDeptChanged()"'), 1)}
    ${fld('u_ro', t('Role'), `<select class="in" id="u_ro" onchange="uRoleHint()">${roleOpts(u.deptId, u.role)}</select><div class="hint" id="u_rh"></div>`, 1)}
    ${fld('u_lg', t('Language'), sel('u_lg', [['ar', 'العربية'], ['en', 'English']], u.lang), 1)}
    ${fld('u_pw', id ? t('New password (leave empty to keep)') : t('Temporary password'), `<input class="in" id="u_pw" type="password" autocomplete="new-password" oninput="polHint('u_pw','u_ph')"><div class="pol" id="u_ph"></div>`, !id)}</div>
   <div class="hint">${t('The name shows in the language each person uses ChequeTrack in. Without an Arabic name, the English one is used.')}</div>
   <div style="margin-top:12px">${swRow('u_act', t('Active'), u.active)}${swRow('u_mc', t('Must change password at next sign-in'), u.mustChange)}
    ${swRow('u_2f', t('Two-step verification'), u.twoFa, mail ? t('A 6-digit code is emailed at each sign-in.') : t('Set up email first.'), !mail && !u.twoFa)}</div>
   ${id ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${u.lockedUntil ? `<button class="btn btn-o btn-sm" onclick="act('unlockUser',{id:${id}},'${js(t('Account unlocked'))}',{after:closeM})">${ic('lock')}${t('Unlock')}</button>` : ''}
     <button class="btn btn-o btn-sm" ${mail && u.email ? '' : 'disabled'} onclick="act('sendReset',{id:${id}},'${js(t('Reset link sent to {e}', { e: u.email }))}')">${ic('mail')}${t('Send password reset link')}</button></div>` : ''}</div>
   ${mfoot(`<button class="btn btn-y" onclick="saveUser(${id})">${t('Save')}</button>`)}`, true);
  uRoleHint();
}
function saveUser(id) {
  act('saveUser', { id, fullName: val('u_fn'), fullNameAr: val('u_fa'), username: val('u_un'), email: val('u_em'), role: val('u_ro'), deptId: val('u_dp'), lang: val('u_lg'), password: document.getElementById('u_pw').value, active: chk('u_act'), mustChange: chk('u_mc'), twoFa: chk('u_2f') }, t('User saved'), { after: closeM });
}

/* =================== ROLES & PERMISSIONS =================== */
const PAGE_LABEL = { requests: 'Cheque requests (own)', cheques: 'Cheques list', approvals: 'Approvals', issue: 'Issue cheques', followup: 'Due & follow-up', contracts: 'Contracts register', poa: 'Payments on account', rates: 'Exchange rates',
  reports: 'Reports', entries: 'Journal entries', banks: 'Banks & accounts', books: 'Chequebooks', voided: 'Voided numbers', users: 'User accounts', roles: 'Roles & permissions', departments: 'Departments', security: 'Sign-in & passwords',
  beneficiaries: 'Beneficiaries', entities: 'Entities', settings: 'Settings', telegram: 'Telegram alerts', audit: 'Audit log', checklist: 'Go-live checklist' };
const PAGE_HINT = { requests: "Create raises a request; Delete cancels one's own request while it waits.", cheques: 'Which cheques depends on "Cheques this role sees".', approvals: 'Approving also allows rejecting at that stage.',
  followup: 'Clear / return records the bank result; Settle closes a returned cheque.', contracts: 'Edit also covers extend, renew, close and reopen.', rates: 'Edit corrects a rate that is not used by a cheque yet.',
  users: 'Edit also covers unlock and password reset links.', telegram: 'Edit connects or disconnects the channel.', beneficiaries: 'Create also lets requesters add a beneficiary from the request form.' };
const OP_LABEL = { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', approve: 'First approval', approve2: 'Second approval', issue: 'Issue cheques', clear: 'Clear / return', settle: 'Settle', follow: 'Follow up', post: 'Mark as posted', send: 'Send digest' };
const GROUPS = [['ops', 'Operations'], ['fin', 'Finance'], ['users', 'User management'], ['data', 'Master data'], ['system', 'System']];
const CRUD = ['view', 'create', 'edit', 'delete'];
const OP_ICON = { view: 'eye', create: 'plus', edit: 'edit', delete: 'trash' };
const OP_HELP = { view: 'opens the page', create: 'adds new records', edit: 'changes records', delete: 'removes or cancels' };
/** The key shown above the access matrix: each symbol with its name and what it allows. */
function mxKey() {
  const item = (icon, name, help) => `<div class="mxk"><span class="mxi ${icon === 'check' ? 'ok' : ''}">${icon ? ic(icon) : '<span class="mxdash">—</span>'}</span><span><b>${t(name)}</b><span class="mut"> · ${t(help)}</span></span></div>`;
  return `<div class="mxkey" role="note"><div class="mxkh">${ic('info')}${t('Key')}</div><div class="mxkl">${CRUD.map(o => item(OP_ICON[o], OP_LABEL[o], OP_HELP[o])).join('')}${item('check', 'Allowed', 'can do this step')}${item('', 'No access', 'cannot open the page')}</div></div>`;
}
function mxCell(c, r) {
  const on = (r.perms || {})[c.page] || [], slots = CRUD.filter(o => c.ops.includes(o));
  if (!slots.some(o => on.includes(o))) return `<td class="mxc"><span class="mxdash" title="${esc(t('No access'))}">—</span></td>`;
  return `<td class="mxc">${slots.map(o => on.includes(o) ? `<span class="mxi" title="${esc(t(OP_LABEL[o]))}" aria-label="${esc(t(OP_LABEL[o]))}">${ic(OP_ICON[o])}</span>` : '').join('')}</td>`;
}
function rolesPage() {
  if (!has('roles')) return denied();
  const f = F('rol', { tab: 'list', dep: '' }), q = f.q.trim().toLowerCase();
  const L = D.roles.filter(r => (!f.dep || (f.dep === 'all' ? r.deptId == null : String(r.deptId) === f.dep)) && (!q || (r.nameEn + ' ' + (r.nameAr || '')).toLowerCase().includes(q)));
  const users = r => D.users.filter(u => u.role === r.key && u.active).length;
  const tabs = [['list', t('Roles')], ['matrix', t('Access matrix')]];
  const bar = `<div class="ul-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${k === f.tab}" class="${k === f.tab ? 'on' : ''}" onclick="setF('rol','tab','${k}')">${l}</button>`).join('')}</div>
    <div class="card flat"><div class="fbar">${searchBox('rol', t('Role name'))}<select class="in" onchange="setF('rol','dep',this.value)"><option value="">${t('All roles')}</option><option value="all" ${f.dep === 'all' ? 'selected' : ''}>${t('Roles for all departments')}</option>${D.departments.map(d => `<option value="${d.id}" ${String(d.id) === f.dep ? 'selected' : ''}>${esc(t('Roles of {d}', { d: nm(d) }))}</option>`).join('')}</select>
    ${f.tab === 'matrix' ? `<button class="btn btn-o btn-sm" onclick="exportMatrix()">${ic('dl')}${t('Export to Excel')}</button>` : ''}</div>`;
  let body;
  if (f.tab === 'matrix') {
    S.mxRoles = L;
    body = L.length ? mxKey() + `<div class="tw"><table class="tbl mx"><thead><tr><th>${t('Page')}</th>${L.map(r => `<th><a href="#/role/${r.id}">${esc(nm(r))}</a>${r.deptId ? `<div class="sm mut">${esc(nm(Dp(r.deptId)))}</div>` : ''}</th>`).join('')}</tr></thead><tbody>
      ${GROUPS.map(([g, gl]) => `<tr class="mxg"><td colspan="${L.length + 1}">${t(gl)}</td></tr>` + D.permCatalog.filter(c => c.group === g).map(c =>
        `<tr><td><b>${t(PAGE_LABEL[c.page] || c.page)}</b></td>${L.map(r => mxCell(c, r)).join('')}</tr>` +
        c.ops.filter(o => !CRUD.includes(o)).map(o => `<tr class="mxs"><td>${t(OP_LABEL[o])}</td>${L.map(r => ((r.perms || {})[c.page] || []).includes(o) ? `<td class="mxc"><span class="mxi ok" title="${esc(t('Allowed'))}" aria-label="${esc(t('Allowed'))}">${ic('check')}</span></td>` : `<td class="mxc"><span class="mxdash">—</span></td>`).join('')}</tr>`).join('')).join('')).join('')}
      </tbody></table></div>` : `<div class="empty">${t('No roles.')}</div>`;
  } else {
    body = ptbl('rol', [t('Role'), t('Department'), t('Cheques it sees'), t('Rights'), { l: t('Active users'), n: 1 }, t('Last change'), ''], L.map(r => {
      const pages = Object.keys(r.perms || {}), n = users(r);
      return [`<a class="lnk" href="#/role/${r.id}"><b>${esc(nm(r))}</b></a>${r.builtIn ? ` <span class="chip c-lock">${t('Built-in')}</span>` : ''}<div class="sm mut" ${LANG === 'ar' ? 'dir="ltr"' : 'dir="rtl"'}>${esc(LANG === 'ar' ? r.nameEn : (r.nameAr || ''))}</div>`,
        r.deptId ? esc(nm(Dp(r.deptId))) : `<span class="mut">${t('All departments')}</span>`, esc(scopeName(r.scope)),
        pages.length ? `<span class="sm">${esc(pages.slice(0, 4).map(p => t(PAGE_LABEL[p] || p)).join(' · '))}${pages.length > 4 ? ' · ' + esc(t('{n} more', { n: pages.length - 4 })) : ''}</span>` : `<span class="mut">${t('No access')}</span>`,
        n ? `<a href="#/users" onclick="F('usr').x='${js(r.key)}'">${N(n)}</a>` : N(0), r.updatedAt ? `${esc(byN(r.updatedBy))}<div class="sm mut">${FD(r.updatedAt)}</div>` : '<span class="mut">—</span>',
        `<div style="display:flex;gap:6px;flex-wrap:wrap"><a class="btn btn-o btn-sm" href="#/role/${r.id}">${has('roles', 'edit') ? t('Edit') : t('Open')}</a>${has('roles', 'create') ? `<a class="btn btn-o btn-sm" href="#/role/new?copy=${r.id}">${t('Copy')}</a>` : ''}</div>`];
    }), t('No roles.'), 'cards', { noSearch: true });
  }
  return phead(t('Roles & permissions'), t('What each role can open and do, page by page, and which cheques it sees. Built-in roles keep the access the system had before.'), has('roles', 'create') ? `<a class="btn btn-y" href="#/role/new">${ic('plus')}${t('Add role')}</a>` : '') + bar + body + '</div>';
}
function exportMatrix() {
  const L = S.mxRoles || D.roles;
  const gName = g => (GROUPS.find(x => x[0] === g) || [g, g])[1], rows = [];
  D.permCatalog.forEach(c => {
    rows.push([gName(c.group), PAGE_LABEL[c.page] || c.page, ...L.map(r => { const on = (r.perms || {})[c.page] || []; return CRUD.filter(o => on.includes(o)).map(o => OP_LABEL[o]).join(', ') || 'No access'; })]);
    c.ops.filter(o => !CRUD.includes(o)).forEach(o => rows.push([gName(c.group), '   ' + OP_LABEL[o], ...L.map(r => ((r.perms || {})[c.page] || []).includes(o) ? 'Allowed' : '')]));
  });
  csv('access-matrix', ['Group', 'Page / workflow step', ...L.map(r => r.nameEn)], rows);
}
/** Role editor: the draft lives in S.rd so ticking boxes keeps what was typed. */
function rolePage(arg) {
  if (!has('roles')) return denied();
  const isNew = arg === 'new', src = isNew ? D.roles.find(r => String(r.id) === S.q.get('copy')) : D.roles.find(r => String(r.id) === arg);
  if (!isNew && !src) return `<div class="card empty">${t('Role not found.')} <a href="#/roles">${t('Back to roles')}</a></div>`;
  const key = isNew ? 'new:' + (S.q.get('copy') || '') + ':' + (S.q.get('dept') || '') : 'id:' + src.id + ':' + src.updatedAt;
  if (!S.rd || S.rd.key !== key) S.rd = {
    key, nameEn: isNew ? (src ? src.nameEn + ' (copy)' : '') : src.nameEn, nameAr: isNew ? (src && src.nameAr ? src.nameAr + ' (نسخة)' : '') : (src.nameAr || ''),
    deptId: isNew ? +(S.q.get('dept') || (src && src.deptId) || 0) : (src.deptId || 0), scope: src ? src.scope : 'own', notes: src && !isNew ? src.notes : '',
    perms: JSON.parse(JSON.stringify(src ? src.perms || {} : { requests: ['view', 'create', 'delete'], rates: ['view'], beneficiaries: ['create'] }))
  };
  const rd = S.rd, canSave = isNew ? has('roles', 'create') : has('roles', 'edit'), dis = canSave ? '' : 'disabled', builtIn = !isNew && src.builtIn;
  const users = isNew ? [] : D.users.filter(u => u.role === src.key);
  const cb = (page, op, ops) => ops.includes(op) ? `<label class="pchk"><input type="checkbox" ${dis} ${(rd.perms[page] || []).includes(op) ? 'checked' : ''} onchange="rdTick('${page}','${op}',this.checked)" aria-label="${esc(t(PAGE_LABEL[page]) + ' · ' + t(OP_LABEL[op]))}"></label>` : '<span class="mut">·</span>';
  const grid = GROUPS.map(([g, gl]) => `<tr class="mxg"><td colspan="7">${t(gl)}</td></tr>` + D.permCatalog.filter(c => c.group === g).map(c => {
    const extra = c.ops.filter(o => !CRUD.includes(o)), on = rd.perms[c.page] || [];
    return `<tr class="${on.length ? 'pon' : ''}"><td><div class="b">${t(PAGE_LABEL[c.page] || c.page)}</div>${PAGE_HINT[c.page] ? `<div class="sm mut">${t(PAGE_HINT[c.page])}</div>` : ''}</td>
      ${CRUD.map(op => `<td class="pc" data-h="${esc(t(OP_LABEL[op]))}">${cb(c.page, op, c.ops)}</td>`).join('')}
      <td data-h="${esc(t('Workflow steps'))}">${extra.length ? extra.map(op => `<label class="pchk wf"><input type="checkbox" ${dis} ${on.includes(op) ? 'checked' : ''} onchange="rdTick('${c.page}','${op}',this.checked)"> ${t(OP_LABEL[op])}</label>`).join('') : '<span class="mut">—</span>'}</td>
      <td>${canSave ? `<button class="btn btn-o btn-sm" onclick="rdAll('${c.page}')">${on.length === c.ops.length ? t('None') : t('All')}</button>` : ''}</td></tr>`;
  }).join('')).join('');
  const wf = ['approvals', 'issue', 'followup', 'poa', 'entries'].some(p => (rd.perms[p] || []).some(o => o !== 'view'));
  return `<nav class="sm" aria-label="${t('Breadcrumb')}"><a href="#/roles">${t('Roles & permissions')}</a> <span class="mut">/ ${esc(isNew ? t('New role') : nm(src))}</span></nav>` +
    phead(isNew ? t('New role') : esc(nm(src)), builtIn ? t('Built-in role: you can change its rights and names, but it is for all departments and cannot be deleted.') : t('Tick what this role may open and do on each page.'),
      `<div style="display:flex;gap:8px;flex-wrap:wrap">${!isNew && has('roles', 'create') ? `<a class="btn btn-o" href="#/role/new?copy=${src.id}">${t('Copy as new role')}</a>` : ''}${!isNew && !builtIn && has('roles', 'delete') && !users.length ? `<button class="btn btn-r" onclick="confirmBox('${js(t('Delete role'))}','${js(t('Delete {n}?', { n: nm(src) }))}','${js(t('Delete'))}',()=>act('delRole',{id:${src.id}},'${js(t('Deleted'))}',{after:()=>{S.rd=null;go('roles')}}),true)">${ic('trash')}${t('Delete')}</button>` : ''}${canSave ? `<button class="btn btn-y" onclick="saveRole(${isNew ? 0 : src.id})">${t('Save role')}</button>` : ''}</div>`) +
    `<div class="row"><section class="card col2"><h2 class="h3">${t('Role')}</h2><div class="fgrid">
      ${fld('rl_en', t('Name (English)'), `<input class="in" id="rl_en" dir="ltr" value="${esc(rd.nameEn)}" ${dis} oninput="S.rd.nameEn=this.value">`, 1)}
      ${fld('rl_ar', t('Name (Arabic)'), `<input class="in" id="rl_ar" dir="rtl" value="${esc(rd.nameAr)}" ${dis} oninput="S.rd.nameAr=this.value">`)}
      ${fld('rl_dp', t('Department'), `<select class="in" id="rl_dp" ${dis || (builtIn ? 'disabled' : '')} onchange="S.rd.deptId=+this.value"><option value="0">${t('All departments')}</option>${D.departments.map(d => `<option value="${d.id}" ${d.id === rd.deptId ? 'selected' : ''}>${esc(nm(d))}</option>`).join('')}</select>`)}
      ${fld('rl_nt', t('Notes'), `<input class="in" id="rl_nt" value="${esc(rd.notes)}" ${dis} oninput="S.rd.notes=this.value">`)}</div>
      <div class="lbl" style="margin-top:16px">${t('Cheques this role sees')}</div><div class="seg">${['own', 'dept', 'all'].map(k => `<label class="${rd.scope === k ? 'on' : ''}"><input type="radio" name="rl_sc" ${dis} ${rd.scope === k ? 'checked' : ''} onchange="S.rd.scope='${k}';render()"> ${scopeName(k)}</label>`).join('')}</div>
      <div class="hint">${t('Approving, issuing and clearing apply only to the cheques the role sees.')}${wf && rd.scope === 'own' ? ` <span class="late">${t('With "Own requests only", this role cannot act on other people\'s cheques.')}</span>` : ''}</div></section>
     <section class="card col1"><h2 class="h3">${t('Users with this role')}</h2>${users.length ? users.map(u => `<div class="task"><div style="flex:1">${esc(un(u))}<div class="sm mut">${esc(nm(Dp(u.deptId)))}</div></div>${u.active ? '' : `<span class="chip c-can">${t('Disabled')}</span>`}</div>`).join('') : `<div class="empty sm">${isNew ? t('Save the role, then give it to users under User accounts.') : t('No users have this role.')}</div>`}</section></div>
     <section class="card"><div class="chead"><h2 class="h3">${t('Rights by page')}</h2>${canSave ? `<div style="display:flex;gap:8px"><button class="btn btn-o btn-sm" onclick="rdBulk('view')">${t('View everything')}</button><button class="btn btn-o btn-sm" onclick="rdBulk('none')">${t('Clear all')}</button></div>` : ''}</div>
      <div class="tw"><table class="tbl perm cards"><thead><tr><th>${t('Page')}</th>${CRUD.map(op => `<th class="pc"><span class="mxi">${ic(OP_ICON[op])}</span><div>${t(OP_LABEL[op])}</div></th>`).join('')}<th>${t('Workflow steps')}</th><th></th></tr></thead><tbody>${grid}</tbody></table></div></section>`;
}
function rdTick(page, op, on) {
  const p = S.rd.perms, cur = new Set(p[page] || []);
  if (on) { cur.add(op); if (op !== 'view' && !(op === 'create' && page === 'beneficiaries')) cur.add('view'); } else { cur.delete(op); if (op === 'view') cur.clear(); }
  if (cur.size) p[page] = [...cur]; else delete p[page];
  render();
}
function rdAll(page) {
  const c = D.permCatalog.find(x => x.page === page), on = S.rd.perms[page] || [];
  if (on.length === c.ops.length) delete S.rd.perms[page]; else S.rd.perms[page] = c.ops.slice();
  render();
}
function rdBulk(kind) {
  if (kind === 'none') S.rd.perms = {};
  else D.permCatalog.forEach(c => { const cur = new Set(S.rd.perms[c.page] || []); cur.add('view'); S.rd.perms[c.page] = [...cur]; });
  render();
}
function saveRole(id) {
  const rd = S.rd, mine = id && RK(S.user.role) && RK(S.user.role).id === id;
  const go2 = () => act('saveRole', { id, nameEn: rd.nameEn.trim(), nameAr: rd.nameAr.trim(), deptId: rd.deptId, scope: rd.scope, notes: rd.notes, perms: rd.perms }, t('Role saved'), { after: j => { S.rd = null; if (!id && j.id) go('role/' + j.id); } });
  if (mine && !(rd.perms.roles || []).includes('edit')) confirmBox(t('Your own role'), t('You are taking away your own right to change roles. Continue?'), t('Save role'), go2, true);
  else go2();
}

/* =================== SIGN-IN & PASSWORDS =================== */
function securityPage() {
  if (!has('security')) return denied();
  const P = D.settings.policy, ed = has('security', 'edit'), dis = ed ? '' : 'disabled', U_ = D.users.filter(u => u.active);
  const save = (sec, body) => !ed ? '' : `<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px"><button class="btn btn-y" onclick="act('saveSettings',Object.assign({section:'${sec}'},${body}),'${js(t('Settings saved'))}')">${t('Save')}</button></div>`;
  return phead(t('Sign-in & passwords'), t('Password rules, account lock and session time for every user.')) +
    (has('users') ? `<div class="kpis">${kpi(t('Active users'), N(U_.length))}${kpi(t('Two-step verification on'), N(U_.filter(u => u.twoFa).length))}${kpi(t('Locked accounts'), N(D.users.filter(u => u.lockedUntil).length))}${kpi(t('Users without email'), `<span class="${U_.some(u => !u.email) ? 'late' : ''}">${N(U_.filter(u => !u.email).length)}</span>`)}</div>` : '') +
    `<section class="card" style="max-width:900px">` + (`<div class="fgrid">${fld('p_ml', t('Minimum length'), inp('p_ml', P.minLen, 'inputmode="numeric" dir="ltr" ' + dis))}${fld('p_ex', t('Password expires after (days, 0 = never)'), inp('p_ex', P.expiryDays, 'inputmode=\"numeric\" dir=\"ltr\" ' + dis))}
     ${fld('p_ma', t('Failed attempts before lock'), inp('p_ma', P.maxAttempts, 'inputmode=\"numeric\" dir=\"ltr\" ' + dis))}${fld('p_lm', t('Lock for (minutes)'), inp('p_lm', P.lockMinutes, 'inputmode=\"numeric\" dir=\"ltr\" ' + dis))}${fld('p_sm', t('Sign out after inactivity (minutes)'), inp('p_sm', P.sessionMin, 'inputmode=\"numeric\" dir=\"ltr\" ' + dis))}</div>
    <div style="margin-top:14px">${swRow('p_up', t('Upper and lower case letters'), P.upper, '', !ed)}${swRow('p_dg', t('At least one number'), P.digit, '', !ed)}${swRow('p_sp', t('At least one symbol'), P.special, '', !ed)}${swRow('p_fc', t('New users change the password at first sign-in'), P.firstChange, '', !ed)}</div>
    ${save('policy', "{minLen:val('p_ml'),expiryDays:val('p_ex'),maxAttempts:val('p_ma'),lockMinutes:val('p_lm'),sessionMin:val('p_sm'),upper:chk('p_up'),digit:chk('p_dg'),special:chk('p_sp'),firstChange:chk('p_fc')}")}`) + `</section>`;
}

/* =================== SETTINGS =================== */
function settingsPage() {
  if (!has('settings')) return denied();
  const f = F('set', { tab: 'general' }), s = D.settings, sm = s.smtp || {}, A = s.acc, ed = has('settings', 'edit');
  const tabs = [['general', 'General'], ['approval', 'Approvals & rates'], ['accounts', 'Accounts'], ['smtp', 'Email'], ['alerts', 'Alerts']];
  if (!tabs.some(x => x[0] === f.tab)) f.tab = 'general';
  const save = (sec, body) => !ed ? '' : `<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px"><button class="btn btn-y" onclick="act('saveSettings',Object.assign({section:'${sec}'},${body}),'${js(t('Settings saved'))}')">${t('Save')}</button></div>`;
  let body = '';
  if (f.tab === 'general') body = `<div class="fgrid">${fld('g_c', t('Company name'), inp('g_c', s.company), 1)}${fld('g_rc', t('Report currency'), sel('g_rc', CURS, s.reportCurrency))}${fld('g_tz', t('Time zone'), inp('g_tz', s.timeZone, 'dir="ltr"'))}</div>
    <div style="margin-top:16px"><div class="lbl">${t('Logo')}</div><div class="drop"><img class="blogo" src="${esc((S.logo ?? s.logo) || '/img/logo.svg')}" alt="">
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
    ${!ed ? '' : `<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px"><button class="btn btn-o" ${s.mailReady ? '' : 'disabled'} onclick="act('testEmail',{},'${js(t('Test email sent to {e}', { e: S.user.email || '' }))}')">${ic('mail')}${t('Send test email to me')}</button>
     <button class="btn btn-y" onclick="act('saveSettings',{section:'smtp',host:val('m_h'),port:val('m_p'),user:val('m_u'),password:document.getElementById('m_pw').value,from:val('m_f'),fromName:val('m_fn'),ssl:chk('m_ssl')},'${js(t('Settings saved'))}')">${t('Save')}</button></div>`}`;
  if (f.tab === 'alerts') { const EV = [['approved', 'Approved by the CFO'], ['approved2', 'Second approval'], ['issued', 'Cheque issued'], ['received', 'Received by requester'], ['delivered', 'Handed to beneficiary'], ['cleared', 'Cleared'], ['returned', 'Returned'], ['solved', 'Returned cheque settled'], ['rejected', 'Rejected']];
    body = `<div class="fgrid">${fld('l_d', t('Alert window (days before the due date)'), inp('l_d', s.alertDays, 'inputmode="numeric" dir="ltr"'), 1)}${fld('l_t', t('Daily digest time'), inp('l_t', s.alertTime, 'dir="ltr" placeholder="09:00"'), 1)}</div>
    <div style="margin-top:14px">${swRow('l_hide', t('Hide Telegram from the menu'), s.hideTelegram)}</div><h3 class="h3" style="margin:18px 0 6px">${t('Post to Telegram when')}</h3>
    ${EV.map(([k, l]) => `<label class="chk"><input type="checkbox" class="tge" data-k="${k}" ${s.tgEvents[k] ? 'checked' : ''}> ${t(l)}</label>`).join('')}
    ${save('alerts', "{alertDays:val('l_d'),alertTime:val('l_t'),hideTelegram:chk('l_hide'),tgEvents:Object.fromEntries([...document.querySelectorAll('.tge')].map(e=>[e.dataset.k,e.checked]))}")}`; }
  return phead(t('Settings'), '') + `<div class="ul-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${k === f.tab}" class="${k === f.tab ? 'on' : ''}" onclick="setF('set','tab','${k}')">${t(l)}</button>`).join('')}</div><section class="card" style="max-width:900px">${body}</section>`;
}
async function pickLogo(inp) {
  const f = inp.files[0]; if (!f) return;
  if (f.size > 250 * 1024) { toast(t('The logo is too large (max about 250 KB).')); return; }
  S.logo = `data:${f.type};base64,${await readFile(f)}`; render();
}

/* =================== TELEGRAM =================== */
async function revealCron() { const j = await api('/api/secret/cron'); if (j && j.ok) { S.cronFull = j.url; render(); } else toast(tErr((j && j.error) || '')); }
function telegramPage() {
  if (!has('telegram')) return denied();
  const s = D.settings, mg = has('telegram', 'edit');
  return phead(t('Telegram alerts'), t('Cheque events and a daily digest are posted to a Telegram channel.'), `${has('telegram', 'send') ? `<button class="btn btn-o" ${s.tokenSet ? '' : 'disabled'} onclick="act('sendDigest',{},'${js(t('Digest sent'))}')">${ic('bell')}${t('Send digest now')}</button>` : ''}`) +
   `<div class="row"><div class="col1"><section class="card"><h2 class="h3">${t('Connection')}</h2>
     ${s.tokenSet ? `<div class="okbox" style="margin-top:12px">${ic('check')}<span>${t('Connected to {c}', { c: `<bdi dir="ltr">${esc(s.telegramChannel)}</bdi>` })}</span></div>` : `<div class="warnbox" style="margin-top:12px">${ic('alert')}<span>${t('Not connected.')}</span></div>`}
     ${mg ? `<div class="fgrid">${fld('tg_c', t('Channel'), inp('tg_c', s.telegramChannel, 'dir="ltr" placeholder="@channel or -100…"'), 1, 'full')}${fld('tg_t', t('Bot token'), `<input class="in" id="tg_t" type="password" dir="ltr" autocomplete="off" placeholder="${s.tokenSet ? t('Saved — type to replace') : '123456789:AA…'}">`, !s.tokenSet, 'full')}</div>
      <div class="hint">${t('Add the bot to the channel as an admin first. The token is stored encrypted and never shown again.')}</div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">${s.tokenSet ? `<button class="btn btn-r" onclick="confirmBox('${js(t('Disconnect Telegram'))}','${js(t('Stop posting alerts to the channel?'))}','${js(t('Disconnect'))}',()=>act('tgDisconnect',{},'${js(t('Disconnected'))}'),true)">${t('Disconnect')}</button>` : ''}<button class="btn btn-y" onclick="act('tgConnect',{channel:val('tg_c'),token:val('tg_t')},'${js(t('Connected — a test message was posted'))}')">${t('Connect and test')}</button></div>` : ''}
     ${s.cronUrl ? `<div class="dv"></div><div class="lbl">${t('Wake-up link for the daily digest')}</div><div class="sm mut">${t('On the free plan, call this link every 15 minutes from a free scheduler such as cron-job.org.')}</div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px"><div class="note" id="cron_url" style="flex:1 1 260px;overflow-wrap:anywhere" dir="ltr">${esc(S.cronFull || s.cronUrl)}</div>${S.cronFull ? `<button class="btn btn-o btn-sm" onclick="navigator.clipboard&&navigator.clipboard.writeText(S.cronFull).then(()=>toast(t('Copied')))">${t('Copy')}</button>` : `<button class="btn btn-o btn-sm" onclick="revealCron()">${t('Show link')}</button>`}</div>
     <div class="sm mut" style="margin-top:6px">${s.cronEnv ? t('The key is set on the server (CRON_KEY).') : t('The link contains a secret key. Viewing it is written to the audit log.')}</div>` : ''}${s.tokenEnv ? `<div class="okbox sm" style="margin-top:10px">${ic('lock')}<span>${t('The bot token is set on the server (TELEGRAM_BOT_TOKEN), not in the app.')}</span></div>` : ''}</section></div>
    <div class="col2"><section class="card"><h2 class="h3">${t('Latest posts')}</h2>${D.tgFeed.map(m => `<div class="task"><div style="flex:1 1 300px;white-space:pre-line">${esc(String(m.text || '').replace(/<[^>]+>/g, ''))}</div><div class="sm ${m.sent ? 'mut' : 'late'}" style="text-align:end">${FD(m.at)}<div>${m.sent ? t('Sent') : esc(m.error || t('Not sent'))}</div></div></div>`).join('') || `<div class="empty">${t('Nothing posted yet.')}</div>`}</section>
     <section class="card"><h2 class="h3">${t('Daily digests')}</h2>${D.alerts.map(a => `<div class="task"><div style="flex:1">${a.count === 1 ? t('1 item to follow up') : t('{n} items to follow up', { n: a.count })} · <span class="mut">${esc(a.by && a.by !== 'System' ? byN(a.by) : t('automatic'))}</span></div><div class="sm ${a.sent ? 'mut' : 'late'}">${FD(a.at)} · ${a.sent ? t('Sent') : esc(a.error || t('Not sent'))}</div></div>`).join('') || `<div class="empty">${t('No digest yet.')}</div>`}</section></div></div>`;
}

/* =================== AUDIT =================== */
function auditPage() {
  if (!has('audit')) return denied();
  // read from the server one page at a time; search, user and dates are filtered in SQL
  const f = F('aud', { x: '' });
  const qp = { size: f.size }; if (f.q.trim()) qp.q = f.q.trim().slice(0, 100); if (f.x) qp.user = f.x; if (f.from) qp.from = f.from; if (f.to) qp.to = f.to;
  const pg = spGet('aud', '/api/audit', qp);
  if (pg && pg.users) S.audUsers = pg.users;
  const users = S.audUsers || [];
  return phead(t('Audit log'), t('Every change, who made it and when. It cannot be edited.'), `<button class="btn btn-o" onclick="exportAudit()">${ic('dl')}${t('Export to Excel')}</button>`) +
   `<div class="card flat"><div class="fbar">${searchBox('aud', t('Action, record or details'))}<select class="in" aria-label="${t('User')}" onchange="setF('aud','x',this.value)"><option value="">${t('All users')}</option>${users.map(u => `<option value="${esc(u)}" ${u === f.x ? 'selected' : ''}>${esc(byN(u))}</option>`).join('')}</select>
    ${dFilter('aud', 'from', t('From'), f.from)}${dFilter('aud', 'to', t('to'), f.to)}</div>
    ${!pg ? spLoading() : pg.err ? `<div class="empty late">${esc(tErr(pg.err))}</div>` : tbl([t('When'), t('User'), t('Action'), t('Record'), t('Details')], pg.rows.map(a => [`<span style="white-space:nowrap">${FD(a.at)}</span>`, esc(byN(a.user)), `<b>${esc(t(a.action))}</b>`, `<bdi dir="ltr">${esc(a.entity)}</bdi>`, `<span class="sm">${esc(a.details)}</span>`]), t('No entries.'), 'cards') + spPager('aud', pg, null)}</div>`;
}
async function exportAudit() {
  const f = F('aud'), qp = {}; if (f.q.trim()) qp.q = f.q.trim().slice(0, 100); if (f.x) qp.user = f.x; if (f.from) qp.from = f.from; if (f.to) qp.to = f.to;
  toast(t('Preparing the export…'));
  const rows = await spAll('/api/audit', qp, 20000); if (!rows) return;
  csv('audit-log', ['When', 'User', 'Action', 'Record', 'Details'], rows.map(a => [fd(a.at), a.user, a.action, a.entity, a.details]));
}

/* =================== GO-LIVE CHECKLIST =================== */
function checklistPage() {
  if (!has('checklist')) return denied();
  const s = D.settings, U_ = D.users.filter(u => u.active);
  const withRight = (page, op) => U_.filter(u => RK(u.role) && ((RK(u.role).perms || {})[page] || []).includes(op));
  const missingAcc = D.entities.flatMap(e => CURS.filter(c => c === e.funcCur || c === 'USD').filter(c => !D.accounts.some(a => a.active && a.entityId === e.id && a.currency === c)).map(c => `${nm(e)} · ${c}`));
  const items = [
    [U_.some(u => u.role === 'CFO'), t('An active CFO'), '#/users'],
    [!!D.anyAdmin, t('A System Admin (until then the CFO acts as admin)'), '#/users'],
    [withRight('issue', 'issue').length >= 1, t('At least one user who can issue cheques'), '#/users'],
    [withRight('issue', 'issue').length >= 2, t('Two users who can issue cheques, so one can issue what the other requested'), '#/users'],
    [withRight('approvals', 'approve2').length >= 1, t('A user who can give second approvals'), '#/users'],
    [withRight('rates', 'create').length >= 1, t('A user who can enter exchange rates'), '#/users'],
    [D.users.length && !U_.some(u => !u.fullNameAr), t('Every active user has an Arabic name'), '#/users'],
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
  return phead(t('My profile'), '') + `<div class="row"><section class="card col1" style="max-width:560px"><div style="display:flex;gap:14px;align-items:center"><div class="av" style="width:56px;height:56px;font-size:22px">${esc((un(u) || '?')[0])}</div><div><div class="h3">${esc(un(u))}</div>${LANG === 'ar' ? (u.fullName && u.fullNameAr ? `<div class="sm mut" dir="ltr">${esc(u.fullName)}</div>` : '') : (u.fullNameAr ? `<div class="sm mut" dir="rtl">${esc(u.fullNameAr)}</div>` : '')}<div class="mut"><bdi dir="ltr">${esc(u.username)}</bdi></div></div></div>
   <div class="pairs">${pair(t('Role'), `<span class="chip role">${esc(roleName(u.role))}</span>`)}${pair(t('Department'), esc(nm(Dp(u.deptId))))}${pair(t('Cheques I can see'), esc(scopeName(u.scope)))}${pair(t('Email'), u.email ? `<bdi dir="ltr">${esc(u.email)}</bdi>` : `<span class="late">${t('Missing — ask the System Admin')}</span>`)}${pair(t('Two-step verification'), me.twoFa ? t('On') : t('Off'))}</div>
   <div class="dv"></div><div class="lbl">${t('Language')}</div><div class="seg">${[['ar', 'العربية'], ['en', 'English']].map(([k, l]) => `<label class="${LANG === k ? 'on' : ''}"><input type="radio" name="pl" ${LANG === k ? 'checked' : ''} onchange="if(LANG!=='${k}')switchLang()"> ${l}</label>`).join('')}</div>
   <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px"><a class="btn btn-y" href="#/password">${ic('key')}${t('Change password')}</a><button class="btn btn-o" onclick="logout()">${ic('logout')}${t('Sign out')}</button></div></section></div>`;
}
