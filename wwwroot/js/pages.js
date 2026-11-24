/* =========================================================
   Pages: home, requests, cheque lists, the cheque page
   ========================================================= */
'use strict';
const FINANCING = ['Financing instalment', 'Final settlement', 'Institutional instalment'];
const SPLIT = ['Final settlement', 'Institutional instalment'];
const OPTYPES = ['Supplier payment', 'Financing instalment', 'Final settlement', 'Institutional instalment', 'Payment on account', 'Other'];
const DOCTYPES = ['Invoice', 'Contract', 'Settlement letter', 'Financing agreement', 'Purchase order', 'Other'];
const CURS = ['USD', 'QAR', 'SDG'];
const isFin = c => FINANCING.includes(c.opType);
const isPoa = c => c.opType === 'Payment on account';

/* ---------- second approval reasons (shown in the reader's language) ---------- */
function need2Reasons(usd, related, prior) {
  const r = [], lim = +D.settings.secondLimitUsd;
  if (usd > lim) r.push(t('above the {n} USD limit', { n: lim.toLocaleString('en-US') }));
  if (related) r.push(t('related party'));
  if (prior) r.push(t('paid before the request'));
  return r;
}

/* =================== HOME =================== */
function homePage() {
  const me = S.user.id, L = visible(), tasks = myTasks();
  const r = can.approve() ? 'CFO' : can.approve2() ? 'TOP' : can.issue() ? 'FIN' : has('users', 'edit') ? 'ADMIN' : has('audit') ? 'AUDIT' : 'USER';
  const k = (l, v, d) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
  const usd = arr => arr.reduce((s, c) => s + usdOf(c), 0);
  const committed = L.filter(c => ['Approved', 'Posted', 'Received', 'Delivered'].includes(c.status));
  const due7 = committed.filter(c => daysUntil(c.dueDate) <= 7);
  const thisMonth = today().slice(0, 7);
  let kp = '';
  if (r === 'CFO') kp = k(t('Waiting for your approval'), N(L.filter(c => c.status === 'Pending' && c.requesterId !== me).length)) + k(t('Approved, not yet issued'), N(L.filter(c => c.status === 'Approved').length)) + k(t('Due in the next 7 days'), N(due7.length)) + k(t('Open commitments (USD)'), M(usd(committed)), t('{n} approved or issued cheques', { n: committed.length }));
  else if (r === 'TOP') kp = k(t('Waiting for second approval'), N(tasks.filter(x => x.kind === 'approve').length)) + k(t('Approved this month (USD)'), M(usd(L.filter(c => c.appr && c.appr.at.slice(0, 7) === thisMonth)))) + k(t('Outstanding cheques (USD)'), M(usd(L.filter(c => OUTSTANDING.includes(c.status))))) + k(t('Returned, not settled'), N(L.filter(c => c.status === 'Returned').length));
  else if (r === 'FIN') kp = k(t('To issue'), N(tasks.filter(x => x.kind === 'issue').length)) + k(t('Due — clear or return'), N(tasks.filter(x => x.kind === 'clear').length)) + k(t('Returned, not settled'), N(L.filter(c => c.status === 'Returned').length)) + k(t("Today's rate"), D.rates.some(x => x.date === today()) ? t('Entered') : `<span class="late">${t('Missing')}</span>`);
  else if (r === 'ADMIN') kp = k(t('Active users'), N(D.users.filter(u => u.active).length)) + k(t('Users without email'), N(D.users.filter(u => u.active && !u.email).length)) + k(t('Locked accounts'), N(D.users.filter(u => u.lockedUntil).length)) + k(t('Email for password reset'), D.settings.mailReady ? t('Ready') : `<span class="late">${t('Not set up')}</span>`);
  else if (r === 'AUDIT') kp = k(t('Open cheques'), N(L.filter(c => OPEN.includes(c.status)).length)) + k(t('Outstanding cheques (USD)'), M(usd(L.filter(c => OUTSTANDING.includes(c.status))))) + k(t('Returned, not settled'), N(L.filter(c => c.status === 'Returned').length)) + k(t('Approved this month (USD)'), M(usd(L.filter(c => c.appr && c.appr.at.slice(0, 7) === thisMonth))));
  else { const my = mine(); kp = k(t('Waiting for approval'), N(my.filter(c => c.status === 'Pending' || c.status === 'Pending2').length)) + k(t('Approved — being issued'), N(my.filter(c => c.status === 'Approved').length)) + k(t('With me — to confirm'), N(my.filter(c => ['Posted', 'Received'].includes(c.status)).length)) + k(t('Cleared'), N(my.filter(c => c.status === 'Cleared').length)); }

  const rt = rateOn(today()), rtToday = rt && rt.date === today();
  const prev = rt ? D.rates.find(x => x.date < rt.date) : null;
  const jump = (rt && prev) ? Math.abs(rt.SDG - prev.SDG) / prev.SDG * 100 : 0;
  const rateCard = `<section class="card"><div class="chead"><h2 class="h3">${rtToday ? t("Today's rate") : t('Latest rate')}</h2><span class="sm mut">${rt ? FD(rt.date) : ''}</span></div>
    ${rt ? `<div style="display:grid;gap:4px;margin-top:8px;font-size:20px;font-weight:600"><div><bdi dir="ltr">1 USD = ${rnum(rt.QAR)} QAR</bdi></div><div><bdi dir="ltr">1 USD = ${rnum(rt.SDG)} SDG</bdi></div></div>
    <div class="sm mut" style="margin-top:8px">${t('Source')}: ${esc(rt.source || '—')} · ${t('entered by {n}', { n: esc(byN(rt.setBy)) })} ${FD(rt.setAt)}</div>
    ${jump > +D.settings.rateAlertPct ? `<div class="warnbox sm" style="margin-top:10px">${ic('alert')}<span>${t('SDG moved {p}% from {d}.', { p: jump.toFixed(1), d: fd(prev.date) })}</span></div>` : ''}
    ${!rtToday ? `<div class="warnbox sm" style="margin-top:10px">${ic('alert')}<span>${t("Today's rate has not been entered yet.")}</span></div>` : ''}` : `<div class="empty">${t('No exchange rate yet.')}</div>`}
    <a class="sm" href="#/rates" style="display:inline-block;margin-top:10px">${t('All exchange rates')}</a></section>`;
  const soon = L.filter(c => committed.includes(c) && daysUntil(c.dueDate) <= 7).sort((a, b) => a.dueDate < b.dueDate ? -1 : 1).slice(0, 6);
  const dueCard = `<section class="card"><h2 class="h3" style="margin-bottom:6px">${t('Due this week')}</h2>${soon.length ? soon.map(c => `<div class="task" style="gap:14px;align-items:flex-start">
    <div style="flex:0 0 100px">${dueTxt(c)}</div><div style="flex:1 1 150px;min-width:0"><a class="lnk" href="#/cheque/${c.id}">${esc(nm(B(c.benId)))}</a><div class="sm mut"><bdi dir="ltr">${c.id}</bdi> · ${payTxt(c)}</div><div style="margin-top:6px">${chip(c.status)}</div></div></div>`).join('') : `<div class="empty sm">${t('Nothing due this week.')}</div>`}</section>`;

  const taskRows = tasks.slice(0, 8).map(x => {
    if (x.kind === 'contract') { const k = x.k, s = kState(k);
      return `<div class="task"><div style="flex:1 1 240px;min-width:0"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><bdi class="b" dir="ltr">${esc(k.opNo)}</bdi>${kChip(k)}${s.due ? `<span class="chip c-2nd">${t('Follow-up due')}</span>` : ''}</div>
        <div style="margin-top:3px">${esc(nm(B(k.financierId)))}</div><div class="sm mut">${t('Contract expiry {d}', { d: fd(kExp(k)) })}${k.followUpDate ? ' · ' + t('next follow-up {d}', { d: fd(k.followUpDate) }) : ''}</div></div>
        <button class="btn btn-y btn-sm" onclick="kFollowModal(${k.id})">${x.act}</button></div>`; }
    if (x.kind === 'msg') { const c = x.c, m = x.msgs[x.msgs.length - 1];
      return `<div class="task"><div style="flex:1 1 240px;min-width:0"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><bdi class="b" dir="ltr">${c.id}</bdi><span class="chip c-2nd">${x.msgs.length > 1 ? t('{n} new messages', { n: x.msgs.length }) : t('New message')}</span><span class="chip c-pend">${t(m.kind)}</span></div>
        <div style="margin-top:3px">${t('From {n}', { n: esc(m.by) })} · ${esc(nm(B(c.benId)))}</div><div class="sm mut" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.text)}</div><div class="sm mut">${FD(m.at)}</div></div>
        <a class="btn btn-y btn-sm" href="#/cheque/${c.id}">${x.act}</a></div>`; }
    if (x.kind === 'rate') return `<div class="task"><div style="flex:1 1 240px"><div class="b">${t("Today's exchange rate is missing")}</div><div class="sm mut">${t('Approvals, issues and clearing need it.')}</div></div><a class="btn btn-y btn-sm" href="#/rates">${x.act}</a></div>`;
    const c = x.c, need = c.status === 'Pending' ? need2Reasons(usdOf(c), c.related, c.priorPaid) : [];
    return `<div class="task"><div style="flex:1 1 240px;min-width:0"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><bdi class="b" dir="ltr">${c.id}</bdi>${chip(c.status)}</div>
      <div style="margin-top:3px">${esc(nm(B(c.benId)))}</div><div class="sm mut">${esc(nm(E(c.entityId)))} · ${t(c.opType)} · ${t('from {n}', { n: esc(UN(c.requesterId)) })}</div></div>
      <div style="text-align:end"><div class="b">${payTxt(c)}</div><div class="sm mut">${c.currency !== 'USD' ? M(usdOf(c), 'USD') : ''}${need.length ? ' · ' + esc(need.join(', ')) : ''}</div></div>
      <a class="btn btn-y btn-sm" href="#/cheque/${c.id}">${x.act}</a></div>`;
  }).join('');
  const waitCard = `<section class="card"><div class="chead"><h2 class="h3">${t('Waiting for you')}</h2>${tasks.length > 8 ? `<span class="sm mut">${t('{n} more', { n: tasks.length - 8 })}</span>` : ''}</div>${taskRows || `<div class="empty">${t('Nothing is waiting for you.')}</div>`}</section>`;

  return `<div class="phead"><div><h1 class="h1">${t('Home')}</h1><div class="sub2">${t(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(today() + 'T12:00:00Z').getUTCDay()])}, ${FD(today())}</div></div>
    ${can.request() ? `<a class="btn btn-y" href="#/new">${ic('plus')}${t('New request')}</a>` : ''}</div>
   <div class="kpis">${kp}</div>
   <div class="row eq"><div class="col2">${waitCard}</div><div class="col1">${rateCard}${dueCard}${kHomeCard()}</div></div>
   ${homeCharts()}`;
}

/** Contracts that need attention, for roles that open the contracts register. */
function kHomeCard() {
  if (!has('contracts')) return '';
  const L = D.contracts.filter(k => kState(k).attention).sort((a, b) => kExp(a) < kExp(b) ? -1 : 1);
  if (!L.length) return '';
  return `<section class="card"><div class="chead"><h2 class="h3">${t('Contracts to follow up')}</h2><a class="sm" href="#/contracts" onclick="F('k').tab='att'">${t('Open register')}</a></div>
    ${L.slice(0, 5).map(k => `<div class="task" style="gap:12px"><div style="flex:1 1 150px;min-width:0"><a class="lnk" href="javascript:void(0)" onclick="kModal(${k.id})"><bdi dir="ltr">${esc(k.opNo)}</bdi> · ${esc(nm(B(k.financierId)))}</a>
      <div class="sm mut">${t('Expiry')} ${FD(kExp(k))}${k.ownerId ? ' · ' + esc(UN(k.ownerId)) : ''}</div></div>${kChip(k)}</div>`).join('')}${L.length > 5 ? `<div class="sm mut" style="margin-top:8px">${t('{n} more', { n: L.length - 5 })}</div>` : ''}</section>`;
}
function homeCharts() {
  const L = has('cheques') ? visible() : mine();
  if (!L.length) return '';
  const usdT = v => money(v, 'USD');
  const open = L.filter(c => ['Pending', 'Pending2', ...OPEN].includes(c.status));
  const byStage = ['Pending', 'Pending2', 'Approved', 'Posted', 'Received', 'Delivered', 'Returned'].map(s => {
    const l = open.filter(c => c.status === s), v = l.reduce((a, c) => a + usdOf(c), 0);
    return { label: stageName(s), value: v, tip: `${stageName(s)}\n${t('{n} cheques', { n: l.length })} · ${usdT(v)}` };
  });
  const months = lastMonths(6);
  const approved = months.map(m => L.filter(c => c.appr && c.appr.at.slice(0, 7) === m.key && !['Rejected', 'Cancelled'].includes(c.status)).reduce((a, c) => a + usdOf(c), 0));
  const cleared = months.map(m => L.filter(c => c.closed && c.closed.status === 'Cleared' && c.closed.at.slice(0, 7) === m.key).reduce((a, c) => a + (c.closed.usdEq != null ? +c.closed.usdEq : usdOf(c)), 0));
  const committed = L.filter(c => ['Approved', 'Posted', 'Received', 'Delivered'].includes(c.status));
  const weeks = [t('Overdue'), t('This week'), t('Next week'), t('In 2 weeks'), t('In 3 weeks')];
  const wv = [0, 0, 0, 0, 0], wn = [0, 0, 0, 0, 0];
  committed.forEach(c => { const n = daysUntil(c.dueDate); const i = n < 0 ? 0 : n < 7 ? 1 : n < 14 ? 2 : n < 21 ? 3 : n < 28 ? 4 : -1; if (i >= 0) { wv[i] += usdOf(c); wn[i]++; } });
  const byEnt = D.entities.map(e => { const l = committed.filter(c => c.entityId === e.id), v = l.reduce((a, c) => a + usdOf(c), 0); return { label: nm(e), value: v, tip: `${nm(e)}\n${t('{n} cheques', { n: l.length })} · ${usdT(v)}` }; });
  const card = (title, sub, body) => `<section class="card"><h2 class="h3">${title}</h2><div class="sm mut" style="margin:2px 0 10px">${sub}</div>${body}</section>`;
  return `<div class="charts">
    ${card(t('Open cheques by stage'), t('Value in USD at each cheque’s locked rate · hover for the count'), hbar(byStage, { plain: usdT, title: t('Open cheques by stage') }))}
    ${card(t('Approved and cleared, last 6 months'), t('USD equivalent'), vbars(months.map(m => m.label), [{ name: t('Approved'), values: approved, color: CH.gold }, { name: t('Cleared'), values: cleared, color: CH.blue }], { plain: usdT, title: t('Approved and cleared, last 6 months') }))}
    ${card(t('Due in the next 4 weeks'), t('Approved and issued cheques by due date · USD'), vbars(weeks, [{ name: t('Due'), values: wv, color: CH.gold }], { plain: usdT, tipx: i => t('{n} cheques', { n: wn[i] }), title: t('Due in the next 4 weeks') }))}
    ${card(t('Open commitments by entity'), t('Approved and issued, not yet cleared · USD'), hbar(byEnt, { plain: usdT, title: t('Open commitments by entity') }))}
  </div>`;
}

/* =================== CHEQUE LISTS =================== */
function chqTable(key, rows, empty) {
  const p = pageOf(key, rows);
  if (!rows.length) return `<div class="empty">${empty || t('No cheques here.')}</div>`;
  return `<div class="tw"><table class="tbl cards"><thead><tr><th>${t('Cheque')}</th><th>${t('Entity')}</th><th class="num">${t('Amount')}</th><th>${t('Due date')}</th><th>${t('Stage')}</th></tr></thead><tbody>
   ${p.rows.map(c => `<tr class="click" onclick="go('cheque/${c.id}')"><td><a class="lnk" href="#/cheque/${c.id}" onclick="event.stopPropagation()"><bdi dir="ltr">${c.id}</bdi> · ${esc(nm(B(c.benId)))}</a><div class="sm mut">${t(c.opType)} · ${esc(UN(c.requesterId))}</div></td>
     <td data-h="${t('Entity')}">${esc(nm(E(c.entityId)))}</td><td class="num" data-h="${t('Amount')}"><div class="b">${payTxt(c)}</div>${(c.payCur || c.currency) !== 'USD' ? `<div class="sm mut">${M(usdOf(c), 'USD')}</div>` : ''}</td>
     <td data-h="${t('Due date')}" style="white-space:nowrap">${dueTxt(c)}</td><td data-h="${t('Stage')}">${chip(c.status)}</td></tr>`).join('')}
   </tbody></table></div>${pager(key, p)}`;
}
function chqList(key, list, tabs, empty) {
  const f = F(key, { tab: tabs[0].k });
  const tab = tabs.find(x => x.k === f.tab) || tabs[0];
  const q = f.q.trim().toLowerCase();
  let rows = list.filter(tab.f);
  if (q) rows = rows.filter(c => (c.id + ' ' + B(c.benId).nameEn + ' ' + (B(c.benId).nameAr || '') + ' ' + U(c.requesterId).fullName + ' ' + (U(c.requesterId).fullNameAr || '') + ' ' + (c.issue ? c.issue.no : '') + ' ' + (c.docNo || '') + ' ' + (c.reason || '')).toLowerCase().includes(q));
  if (f.ent) rows = rows.filter(c => String(c.entityId) === f.ent);
  if (f.cur) rows = rows.filter(c => (c.payCur || c.currency) === f.cur || c.currency === f.cur);
  if (f.from || f.to) rows = rows.filter(c => inRange(f, c.dueDate));
  if (tab.sort) rows = rows.slice().sort(tab.sort);
  S.lastRows = rows;
  return `<div class="tabs" role="tablist">${tabs.map(x => `<button type="button" role="tab" aria-selected="${x === tab}" class="tab ${x === tab ? 'on' : ''}" onclick="setF('${key}','tab','${x.k}')">${esc(x.label)} <b>${list.filter(x.f).length}</b></button>`).join('')}</div>
   <div class="card flat"><div class="fbar">${searchBox(key, t('Filter this list'))}
     <select class="in" aria-label="${t('Entity')}" onchange="setF('${key}','ent',this.value)"><option value="">${t('All entities')}</option>${D.entities.map(e => `<option value="${e.id}" ${String(e.id) === f.ent ? 'selected' : ''}>${esc(nm(e))}</option>`).join('')}</select>
     <select class="in" aria-label="${t('Currency')}" onchange="setF('${key}','cur',this.value)"><option value="">${t('All currencies')}</option>${CURS.map(c => `<option ${c === f.cur ? 'selected' : ''}>${c}</option>`).join('')}</select>
     <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="sm mut">${t('Due')}</span><div style="width:150px">${dateIn('df_' + key, f.from, `aria-label="${t('Due from')}" onchange="setF('${key}','from',pd(this.value))"`)}</div><span class="sm mut">${t('to')}</span><div style="width:150px">${dateIn('dt_' + key, f.to, `aria-label="${t('Due to')}" onchange="setF('${key}','to',pd(this.value))"`)}</div></div>
     <button class="btn btn-o btn-sm" onclick="exportCheques()">${ic('dl')}${t('Export to Excel')}</button>
   </div>${chqTable(key, rows, empty)}</div>`;
}
function exportCheques() {
  const rows = S.lastRows || [];
  csv('cheques', ['Reference', 'Stage', 'Beneficiary', 'Entity', 'Operation type', 'Purpose', 'Contract amount', 'Contract currency', 'Cheque amount', 'Payment currency', 'USD equivalent', 'Due date', 'Document', 'Document date', 'Requested by', 'Department', 'Approved by', 'Approval rate date', 'Cheque no.', 'Account', 'Issued by', 'Cleared/returned', 'Clearing rate date', 'Realised FX difference'],
    rows.map(c => [c.id, stageName(c.status), B(c.benId).nameEn, E(c.entityId).nameEn, c.opType, c.purpose, c.amount, c.currency, c.payAmt ?? '', c.payCur, round(usdOf(c), 'USD'), fd(c.dueDate), [c.docType, c.docNo].filter(Boolean).join(' '), fd(c.docDate),
      U(c.requesterId).fullName, Dp(c.deptId).nameEn, c.appr ? c.appr.by : '', c.appr ? fd(c.appr.rateDate) : '', c.issue ? c.issue.no : '', c.issue ? c.issue.bank : '', c.issue ? c.issue.by : '', c.closed ? c.closed.status + ' ' + fd(c.closed.at) : '', c.closed ? fd(c.closed.rateDate) : '', c.closed && c.closed.fxDiff != null ? c.closed.fxDiff : '']));
}
const closedSt = ['Cleared', 'Solved', 'Rejected', 'Cancelled'];
function chequesPage() {
  if (!has('cheques')) return denied();
  const sc = S.user.scope;
  return `<div class="phead"><div><h1 class="h1">${sc === 'all' ? t('All cheques') : sc === 'dept' ? t('Department cheques') : t('Cheques')}</h1><div class="sub2">${sc === 'dept' ? t('Requests raised in your department, by stage') : t('Every request and cheque, by stage')}</div></div></div>` +
    chqList('all', visible(), [
      { k: 'all', label: t('All'), f: () => true },
      { k: 'p1', label: t('Pending CFO'), f: c => c.status === 'Pending' },
      { k: 'p2', label: t('Second approval'), f: c => c.status === 'Pending2' },
      { k: 'ap', label: t('To issue'), f: c => c.status === 'Approved' },
      { k: 'out', label: t('Outstanding'), f: c => OUTSTANDING.includes(c.status) },
      { k: 'ret', label: t('Returned'), f: c => c.status === 'Returned' },
      { k: 'cl', label: t('Closed'), f: c => closedSt.includes(c.status) }]);
}
function minePage() {
  const my = mine(), acts = myTasks().filter(x => x.mine);
  const box = acts.length ? `<section class="card act"><h2 class="h3" style="color:var(--ydark)">${t('Action needed from you')}</h2>${acts.map(x => `<div class="task"><div style="flex:1 1 240px"><bdi class="b" dir="ltr">${x.c.id}</bdi> · ${esc(nm(B(x.c.benId)))} · ${payTxt(x.c)}
     <div class="sm mut">${x.kind === 'recv' ? t('{n} issued this cheque to you. Confirm when you have it.', { n: esc(byN(x.c.issue.by)) }) : t('Confirm when you hand it to the beneficiary.')}</div></div><a class="btn btn-y btn-sm" href="#/cheque/${x.c.id}">${x.act}</a></div>`).join('')}</section>` : '';
  return `<div class="phead"><div><h1 class="h1">${t('My requests')}</h1><div class="sub2">${t('Every request you raised and where it is now')}</div></div><a class="btn btn-y" href="#/new">${ic('plus')}${t('New request')}</a></div>${box}` +
    chqList('mine', my, [
      { k: 'all', label: t('All'), f: () => true },
      { k: 'wait', label: t('Waiting approval'), f: c => c.status === 'Pending' || c.status === 'Pending2' },
      { k: 'ap', label: t('Being issued'), f: c => c.status === 'Approved' },
      { k: 'me', label: t('With me'), f: c => ['Posted', 'Received'].includes(c.status) },
      { k: 'ben', label: t('With beneficiary'), f: c => c.status === 'Delivered' },
      { k: 'cl', label: t('Closed'), f: c => closedSt.includes(c.status) || c.status === 'Returned' }], t('You have not raised any requests yet.'));
}
function approvalsPage() {
  if (!has('approvals')) return denied();
  const me = S.user.id;
  const a1 = can.approve(), a2 = can.approve2(), any = !a1 && !a2; // view only: both stages
  const list = visible().filter(c => ((a1 || any) && c.status === 'Pending') || ((a2 || any) && c.status === 'Pending2'));
  return `<div class="phead"><div><h1 class="h1">${t('Approvals')}</h1><div class="sub2">${a2 && !a1 ? t('Second approval: above the limit, related party, or paid before the request.') : t('First approval: the rate of the document date is locked and saved with the cheque.')}</div></div></div>` +
    chqList('appr', list, [{ k: 'mine', label: t('Waiting for me'), f: c => c.requesterId !== me && !(c.appr && c.appr.byId === me) }, { k: 'all', label: t('All waiting'), f: () => true }], t('No requests are waiting.'));
}
function issuePage() {
  if (!has('issue')) return denied();
  return `<div class="phead"><div><h1 class="h1">${t('Issue cheques')}</h1><div class="sub2">${t('Approved requests to issue, and cheques being followed up')}</div></div></div>` +
    chqList('iss', visible(), [
      { k: 'ap', label: t('To issue'), f: c => c.status === 'Approved' },
      { k: 'req', label: t('With requesters'), f: c => ['Posted', 'Received'].includes(c.status) },
      { k: 'ben', label: t('With beneficiary'), f: c => c.status === 'Delivered', sort: (a, b) => a.dueDate < b.dueDate ? -1 : 1 },
      { k: 'ret', label: t('Returned'), f: c => c.status === 'Returned' }], t('Nothing here.'));
}
function followupPage() {
  if (!has('followup')) return denied();
  const L = visible().filter(c => ['Approved', 'Posted', 'Received', 'Delivered', 'Returned'].includes(c.status));
  const by = (a, b) => a.dueDate < b.dueDate ? -1 : 1, al = D.settings.alertDays;
  return `<div class="phead"><div><h1 class="h1">${t('Due & follow-up')}</h1><div class="sub2">${t('Open cheques, soonest first. The alert window is {n} days.', { n: al })}</div></div></div>` +
    chqList('fu', L, [
      { k: 'od', label: t('Overdue'), f: c => c.status !== 'Returned' && daysUntil(c.dueDate) < 0, sort: by },
      { k: 'wk', label: t('Due soon'), f: c => c.status !== 'Returned' && daysUntil(c.dueDate) >= 0 && daysUntil(c.dueDate) <= al, sort: by },
      { k: 'later', label: t('Later'), f: c => c.status !== 'Returned' && daysUntil(c.dueDate) > al, sort: by },
      { k: 'ret', label: t('Returned'), f: c => c.status === 'Returned', sort: by }], t('Nothing here.'));
}

/* =================== NEW REQUEST =================== */
function nfNew() {
  const ent = D.entities[0];
  return { entityId: ent ? ent.id : 0, opType: 'Supplier payment', purpose: 'Payment', benId: 0, related: false, currency: 'USD', payCur: 'USD',
    lines: [{ opNo: '', instNo: '', month: '', due: '', paidBefore: '', requested: '', principal: '' }],
    docType: 'Invoice', docNo: '', docDate: '', project: '', counterAcct: '', files: [], dueDate: '', priority: 'Normal', priorityReason: '',
    recipientType: 'Beneficiary', recipientName: '', priorPaid: false, priorDate: '', priorMethod: '', priorRef: '', remainDate: '', poaSettleDate: '', reason: '' };
}
function nfs(k, v, rerender) { S.nf[k] = v; if (rerender) render(); else refreshSum(); }
function nfl(i, k, v) { S.nf.lines[i][k] = v; refreshSum(); }
function nfAddLine() { S.nf.lines.push({ opNo: '', instNo: '', month: '', due: '', paidBefore: '', requested: '', principal: '' }); render(); }
function nfDelLine(i) { if (S.nf.lines.length > 1) { S.nf.lines.splice(i, 1); render(); } }
async function nfFiles(inp, kind) {
  for (const f of inp.files) {
    if (f.size > 10 * 1024 * 1024) { toast(t('{n} is larger than 10 MB.', { n: f.name })); continue; }
    if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(f.type)) { toast(t('{n}: only PDF, JPG, PNG or WEBP files.', { n: f.name })); continue; }
    S.nf.files.push({ kind, name: f.name, type: f.type, size: f.size, data: await readFile(f) });
  }
  render();
}
function nfDelFile(i) { S.nf.files.splice(i, 1); render(); }
function nfCalc() {
  const n = S.nf, fin = FINANCING.includes(n.opType);
  let total = 0, principal = 0, partial = false;
  n.lines.forEach(l => { const rq = num(l.requested), d = num(l.due), pb = num(l.paidBefore); total += rq; if (fin) principal += num(l.principal); if (d > 0 && rq < d - pb) partial = true; });
  const ent = E(+n.entityId), fc = ent.funcCur, rt = n.docDate ? rateOn(n.docDate) : null;
  const usd = rt ? conv(total, n.currency, 'USD', rt) : null, fv = rt ? conv(total, n.currency, fc, rt) : null;
  return { total, principal, profit: total - principal, partial, fin, fc, rt, usd, fv };
}
function nfSummary() {
  const n = S.nf, x = nfCalc(), ent = E(+n.entityId);
  const need = x.usd != null ? need2Reasons(x.usd, n.related, n.priorPaid) : need2Reasons(0, n.related, n.priorPaid);
  const checks = [];
  if (x.fin) n.lines.filter(l => l.opNo).forEach(l => {
    const k = KR(l.opNo), full = K(l.opNo);
    if (!k) checks.push([false, t('Operation {o} is not in the contracts register', { o: l.opNo })]);
    else if (k.status === 'Closed') checks.push([false, t('Operation {o} is closed in the contracts register', { o: l.opNo })]);
    else if (k.financierId !== +n.benId) checks.push([false, t('Operation {o} belongs to another financier', { o: l.opNo })]);
    else if (k.currency !== n.currency) checks.push([false, t('Operation {o} is in {c}', { o: l.opNo, c: k.currency })]);
    else if (full && full.principal != null) { const rem = contractRemaining(full); checks.push([num(l.principal) <= rem, t('Contract {o}: remaining principal {r}', { o: l.opNo, r: money(rem, k.currency) })]); }
    else checks.push([true, t('Linked to contract {o}', { o: l.opNo })]);
  });
  const kw = x.fin ? kWarns(n.lines.map(l => l.opNo), n.dueDate) : [];
  const hasAcct = D.acctCurs.some(a => a.entityId === +n.entityId && a.cur === n.payCur);
  checks.push([hasAcct, hasAcct ? t('{e} has a bank account in {c}', { e: nm(ent), c: n.payCur }) : t('{e} has no bank account in {c}', { e: nm(ent), c: n.payCur })]);
  checks.push([n.files.some(f => f.kind === 'doc'), t('Supporting document attached')]);
  if (n.docDate) checks.push([n.docDate <= today(), t('Document dated today or before')]);
  return `<h2 class="h3">${t('Summary')}</h2>
   <div class="sm mut" style="margin-top:14px">${t('Total requested')}</div><div style="font-size:26px;font-weight:700">${M(x.total, n.currency)}</div>
   ${x.fin ? `<div class="sm mut">${t('Principal {p} · profit {f}', { p: money(x.principal, n.currency), f: money(x.profit, n.currency) })}</div>` : ''}
   <div class="dv"></div>
   ${x.rt ? `<div class="sm mut">${t('Value at the document-date rate')}</div><div style="font-size:18px;font-weight:600">${M(round(x.fv, x.fc), x.fc)}</div>
     <div class="sm mut">${FD(x.rt.date)} · <bdi dir="ltr">1 USD = ${rnum(perUsd(x.fc === 'USD' ? n.currency : x.fc, x.rt))} ${x.fc === 'USD' ? n.currency : x.fc}</bdi> · ${t('locked when the CFO approves')}</div>`
      : `<div class="sm mut">${t('Enter the document date to see the value at its rate.')}</div>`}
   ${n.payCur !== n.currency ? `<div class="okl" style="margin-top:10px">${ic('info')}<span>${t('Paid in {p}: the cheque amount is set with the issue-day rate.', { p: n.payCur })}</span></div>` : ''}
   <div class="dv"></div><div class="sm mut">${t('Approval route')}</div><div class="b">${need.length ? t('CFO, then Top Management') : t('CFO only')}</div>
   <div class="sm mut">${need.length ? esc(need.join(', ')) : t('Below {n} USD and not a related party', { n: (+D.settings.secondLimitUsd).toLocaleString('en-US') })}</div>
   ${kw.length ? `<div class="dv"></div>${kWarnBox(kw, t('You can still submit; the CFO will see this warning.'))}` : ''}
   <div class="dv"></div><div style="display:flex;flex-direction:column;gap:8px">${checks.map(([ok, s]) => `<div class="okl ${ok ? '' : 'no'}">${ic(ok ? 'check' : 'x')}<span>${esc(s)}</span></div>`).join('')}</div>
   <button class="btn btn-y w" style="margin-top:20px" onclick="submitReq(false)">${t('Submit for approval')}</button>
   <button class="btn btn-o w" style="margin-top:10px" onclick="S.nf=null;go('mine')">${t('Cancel')}</button>`;
}
function refreshSum() { const e = document.getElementById('nf_sum'); if (e) e.innerHTML = nfSummary();
  const w = document.getElementById('nf_kw'); if (w && S.nf) w.innerHTML = FINANCING.includes(S.nf.opType) ? kWarnBox(kWarns(S.nf.lines.map(l => l.opNo), S.nf.dueDate)) : ''; const r = document.getElementById('nf_rem'); if (r) r.classList.toggle('hide', !nfCalc().partial); }
function contractRemaining(k) {
  const used = D.cheques.filter(c => !['Rejected', 'Cancelled'].includes(c.status)).flatMap(c => c.lines).filter(l => l.opNo === k.opNo).reduce((a, l) => a + (+l.principal || 0), 0);
  return +k.principal - used;
}
function newRequestPage() {
  if (!can.request()) return denied();
  if (!S.nf) S.nf = nfNew();
  const n = S.nf, fin = FINANCING.includes(n.opType), split = SPLIT.includes(n.opType), x = nfCalc();
  const bens = D.beneficiaries.slice().sort((a, b) => nm(a).localeCompare(nm(b)));
  const opt = (arr, v, lab) => arr.map(o => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(lab ? lab(o) : o)}</option>`).join('');
  // every requester picks the contract from the register (light list sent to all users)
  const contracts = (D.contractRefs || D.contracts || []).filter(k => k.financierId === +n.benId && k.currency === n.currency && k.status !== 'Closed');
  const kOpt = k => { const e = kExp(k), x = e && e < today(); return `${k.opNo}${e ? ' · ' + (x ? t('expired {d}', { d: fd(e) }) : t('expires {d}', { d: fd(e) })) : ''}`; };
  const lineRow = (l, i) => `<tr>
    ${fin ? `<td>${!contracts.length ? `<input class="in" aria-label="${t('Operation no.')}" value="${esc(l.opNo)}" placeholder="${t('Contract no.')}" oninput="nfl(${i},'opNo',this.value)">` : `<select class="in" aria-label="${t('Contract')}" style="min-width:190px" onchange="nfl(${i},'opNo',this.value)"><option value="">${t('Choose the contract')}</option>${contracts.map(k => `<option value="${esc(k.opNo)}" ${k.opNo === l.opNo ? 'selected' : ''}>${esc(kOpt(k))}</option>`).join('')}${l.opNo && !contracts.some(k => k.opNo === l.opNo) ? `<option selected>${esc(l.opNo)}</option>` : ''}</select>`}</td>
      <td><input class="in" aria-label="${t('Instalment')}" value="${esc(l.instNo)}" inputmode="numeric" oninput="nfl(${i},'instNo',this.value)" style="width:84px"></td>
      <td><input class="in" aria-label="${t('Month')}" value="${esc(l.month)}" placeholder="MM/yyyy" dir="ltr" oninput="nfl(${i},'month',this.value)" style="width:104px"></td>`
      : `<td><input class="in" aria-label="${t('Reference')}" value="${esc(l.opNo)}" placeholder="${t('Invoice or PO no.')}" oninput="nfl(${i},'opNo',this.value)"></td>`}
    <td><input class="in num" dir="ltr" aria-label="${t('Due')}" value="${esc(l.due)}" inputmode="decimal" oninput="nfl(${i},'due',this.value)"></td>
    <td><input class="in num" dir="ltr" aria-label="${t('Paid before')}" value="${esc(l.paidBefore)}" inputmode="decimal" oninput="nfl(${i},'paidBefore',this.value)"></td>
    <td><input class="in num" dir="ltr" aria-label="${t('Requested now')}" value="${esc(l.requested)}" inputmode="decimal" oninput="nfl(${i},'requested',this.value)"></td>
    ${fin ? `<td><input class="in num" dir="ltr" aria-label="${t('Principal')}" value="${esc(l.principal)}" inputmode="decimal" oninput="nfl(${i},'principal',this.value)"></td>` : ''}
    <td><button class="btn btn-o btn-sm" type="button" aria-label="${t('Remove line')}" ${n.lines.length < 2 ? 'disabled' : ''} onclick="nfDelLine(${i})">${ic('x')}</button></td></tr>`;
  const fileChips = kind => n.files.map((f, i) => f.kind === kind ? `<span class="file">${ic('file')}<span><b>${esc(f.name)}</b> <span class="sm mut">· ${kb(f.size)}</span></span><button class="x" type="button" aria-label="${t('Remove')}" onclick="nfDelFile(${i})">${ic('x')}</button></span>` : '').join(' ');
  return `<div class="phead"><div><h1 class="h1">${t('New request')}</h1><div class="sub2">${t('It goes to the CFO for approval. You can follow it under My requests.')}</div></div></div>
  <div class="row" style="gap:20px">
   <div class="col2">
    <section class="card"><h2 class="h3 sec-h"><span class="n">1</span>${t('What is this payment for?')}</h2>
     <div class="fgrid">
      <div class="fg"><label class="lbl" for="nf_ent">${t('Entity')} <span class="req">*</span></label><select class="in" id="nf_ent" onchange="nfs('entityId',+this.value,true)">${D.entities.map(e => `<option value="${e.id}" ${e.id === +n.entityId ? 'selected' : ''}>${esc(nm(e))}</option>`).join('')}</select></div>
      <div class="fg"><label class="lbl" for="nf_op">${t('Operation type')} <span class="req">*</span></label><select class="in" id="nf_op" onchange="nfs('opType',this.value,true)">${opt(OPTYPES, n.opType, t)}</select></div>
      <div class="fg"><label class="lbl" for="nf_ben">${t('Beneficiary')} <span class="req">*</span></label><select class="in" id="nf_ben" onchange="nfs('benId',+this.value,true)"><option value="0">${t('Choose')}</option>${bens.map(b => `<option value="${b.id}" ${b.id === +n.benId ? 'selected' : ''}>${esc(nm(b))} · ${t(b.type)}</option>`).join('')}</select>
        <a class="sm" href="javascript:void(0)" style="margin-top:6px" onclick="benModal(0,true)">${t('Add a new beneficiary')}</a></div>
      <div class="fg"><label class="lbl" for="nf_rel">${t('Relationship to the company')} <span class="req">*</span></label><select class="in" id="nf_rel" onchange="nfs('related',this.value==='1')"><option value="0">${t('Not a related party')}</option><option value="1" ${n.related ? 'selected' : ''}>${t('Related party')}</option></select></div>
     </div>
     <fieldset style="border:0;padding:0;margin:16px 0 0"><legend class="lbl">${t('Purpose')} <span class="req">*</span></legend>
      <div class="seg">${['Payment', 'Guarantee'].map(p => `<label class="${n.purpose === p ? 'on' : ''}"><input type="radio" name="nf_pur" ${n.purpose === p ? 'checked' : ''} onchange="nfs('purpose','${p}',true)"> ${t(p)}</label>`).join('')}</div>
      ${n.purpose === 'Guarantee' ? `<div class="hint">${t('Guarantee cheques have no journal entries and are not revalued.')}</div>` : ''}</fieldset>
    </section>

    <section class="card"><h2 class="h3 sec-h"><span class="n">2</span>${t('Amount')}</h2>
     <div class="fgrid">
      <div class="fg"><label class="lbl" for="nf_cur">${t('Contract currency')} <span class="req">*</span></label><select class="in" id="nf_cur" onchange="nfs('currency',this.value,true)">${opt(CURS, n.currency)}</select></div>
      <div class="fg"><label class="lbl" for="nf_pc">${t('Payment currency')} <span class="req">*</span></label><select class="in" id="nf_pc" onchange="nfs('payCur',this.value,true)">${opt(CURS, n.payCur)}</select>
       ${n.payCur !== n.currency ? `<div class="hint">${t('Differs from the contract currency, so the cheque amount is set with the issue-day rate.')}</div>` : ''}</div>
     </div>
     ${fin ? `<div id="nf_kw" style="margin-top:14px">${kWarnBox(kWarns(n.lines.map(l => l.opNo), n.dueDate))}</div>` : ''}
     ${fin && n.benId && !contracts.length ? `<div class="warnbox" style="margin-top:14px">${ic('alert')}<span>${t('No contract is registered for this financier in {c}. Finance must register it first.', { c: n.currency })}</span></div>` : ''}
     <div class="tw" style="margin-top:16px"><table class="tbl sm" style="min-width:${fin ? 880 : 640}px"><thead><tr>
      ${fin ? `<th>${t('Contract')}</th><th>${t('Instalment')}</th><th>${t('Month')}</th>` : `<th>${t('Reference')}</th>`}
      <th class="num">${t('Due')}</th><th class="num">${t('Paid before')}</th><th class="num">${t('Requested now')}</th>${fin ? `<th class="num">${t('Principal')}${split ? ' *' : ''}</th>` : ''}<th></th></tr></thead>
      <tbody>${n.lines.map(lineRow).join('')}</tbody></table></div>
     <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-o btn-sm" type="button" onclick="nfAddLine()">${ic('plus')}${t('Add line')}</button>
      <span class="hint" style="margin:0">${split ? t('Final settlement and institutional instalment: separate the principal from the profit.') : t('If “Requested now” is less than what remains due, a date for the remaining balance is required.')}</span></div>
     <div class="fgrid">
      <div class="fg ${x.partial ? '' : 'hide'}" id="nf_rem"><label class="lbl" for="nf_rd">${t('Date for the remaining balance')} <span class="req">*</span></label>${dateIn('nf_rd', n.remainDate, `onchange="nfs('remainDate',pd(this.value))"`)}</div>
      ${isPoa(n) ? `<div class="fg"><label class="lbl" for="nf_poa">${t('Settlement date of the payment on account')} <span class="req">*</span></label>${dateIn('nf_poa', n.poaSettleDate, `onchange="nfs('poaSettleDate',pd(this.value))"`)}</div>` : ''}
     </div>
    </section>

    <section class="card"><h2 class="h3 sec-h"><span class="n">3</span>${t('Supporting document')}</h2>
     <div class="fgrid">
      <div class="fg"><label class="lbl" for="nf_dt">${t('Document type')} <span class="req">*</span></label><select class="in" id="nf_dt" onchange="nfs('docType',this.value)">${opt(DOCTYPES, n.docType, t)}</select></div>
      <div class="fg"><label class="lbl" for="nf_dn">${t('Document number')} <span class="req">*</span></label><input class="in" id="nf_dn" value="${esc(n.docNo)}" oninput="nfs('docNo',this.value)"></div>
      <div class="fg"><label class="lbl" for="nf_dd">${t('Document date')} <span class="req">*</span></label>${dateIn('nf_dd', n.docDate, `onchange="nfs('docDate',pd(this.value))"`)}</div>
      <div class="fg"><label class="lbl" for="nf_pr">${t('Project')}</label><input class="in" id="nf_pr" value="${esc(n.project)}" oninput="nfs('project',this.value)"></div>
      <div class="fg"><label class="lbl" for="nf_ca">${t('Counter account')}</label><input class="in" id="nf_ca" value="${esc(n.counterAcct)}" placeholder="${esc(D.settings.acc.payables)}" dir="ltr" oninput="nfs('counterAcct',this.value)"></div>
     </div>
     <div style="margin-top:16px"><div class="lbl">${t('Attachment')} <span class="req">*</span></div>
      <div class="drop">${fileChips('doc') || `<span class="mut">${t('No file yet')}</span>`}<label class="btn btn-o btn-sm" style="margin-inline-start:auto">${ic('file')}${t('Add file')}<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple class="hide" onchange="nfFiles(this,'doc')"></label></div>
      <div class="hint">${t('PDF or photo, up to 10 MB.')}</div></div>
    </section>

    <section class="card"><h2 class="h3 sec-h"><span class="n">4</span>${t('Payment')}</h2>
     <div class="fgrid">
      <div class="fg"><label class="lbl" for="nf_due">${t('Due date')} <span class="req">*</span></label>${dateIn('nf_due', n.dueDate, `onchange="nfs('dueDate',pd(this.value))"`)}</div>
      <div class="fg"><label class="lbl" for="nf_pm">${t('Payment method')}</label><select class="in" id="nf_pm"><option>${t('Cheque')}</option></select></div>
      <div class="fg"><label class="lbl" for="nf_pri">${t('Priority')}</label><select class="in" id="nf_pri" onchange="nfs('priority',this.value,true)"><option value="Normal">${t('Normal')}</option><option value="Urgent" ${n.priority === 'Urgent' ? 'selected' : ''}>${t('Urgent')}</option></select></div>
      ${n.priority === 'Urgent' ? `<div class="fg full"><label class="lbl" for="nf_prr">${t('Why is it urgent?')} <span class="req">*</span></label><input class="in" id="nf_prr" value="${esc(n.priorityReason)}" oninput="nfs('priorityReason',this.value)"></div>` : ''}
     </div>
     <fieldset style="border:0;padding:0;margin:18px 0 0"><legend class="lbl">${t('Who receives the cheque?')} <span class="req">*</span></legend>
      <label class="chk"><input type="radio" name="nf_rcp" ${n.recipientType !== 'Other' ? 'checked' : ''} onchange="nfs('recipientType','Beneficiary',true)"> ${t('The beneficiary')}</label>
      <label class="chk"><input type="radio" name="nf_rcp" ${n.recipientType === 'Other' ? 'checked' : ''} onchange="nfs('recipientType','Other',true)"> ${t('Someone else, with an authorisation letter')}</label></fieldset>
     ${n.recipientType === 'Other' ? `<div class="fgrid"><div class="fg"><label class="lbl" for="nf_rn">${t('Name of the person')} <span class="req">*</span></label><input class="in" id="nf_rn" value="${esc(n.recipientName)}" oninput="nfs('recipientName',this.value)"></div>
       <div class="fg"><div class="lbl">${t('Authorisation letter')} <span class="req">*</span></div><div class="drop">${fileChips('auth') || `<span class="mut">${t('No file yet')}</span>`}<label class="btn btn-o btn-sm" style="margin-inline-start:auto">${ic('file')}${t('Add file')}<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" class="hide" onchange="nfFiles(this,'auth')"></label></div></div></div>` : ''}
     <div class="dv"></div>
     <label style="display:flex;gap:14px;align-items:flex-start"><input class="sw" type="checkbox" ${n.priorPaid ? 'checked' : ''} onchange="nfs('priorPaid',this.checked,true)">
      <span><span class="b" style="display:block">${t('This payment was already made before this request')}</span><span class="sm mut">${t('It then needs second approval and shows in the report of payments made before a request.')}</span></span></label>
     ${n.priorPaid ? `<div class="fgrid"><div class="fg"><label class="lbl" for="nf_pd">${t('Date paid')} <span class="req">*</span></label>${dateIn('nf_pd', n.priorDate, `onchange="nfs('priorDate',pd(this.value))"`)}</div>
       <div class="fg"><label class="lbl" for="nf_pmm">${t('How it was paid')} <span class="req">*</span></label><input class="in" id="nf_pmm" value="${esc(n.priorMethod)}" placeholder="${t('e.g. transfer, cash')}" oninput="nfs('priorMethod',this.value)"></div>
       <div class="fg"><label class="lbl" for="nf_prf">${t('Reference')} <span class="req">*</span></label><input class="in" id="nf_prf" value="${esc(n.priorRef)}" oninput="nfs('priorRef',this.value)"></div></div>` : ''}
     <div class="fg" style="margin-top:16px"><label class="lbl" for="nf_note">${t('Notes')}</label><textarea class="in" id="nf_note" rows="2" oninput="nfs('reason',this.value)">${esc(n.reason)}</textarea></div>
    </section>
   </div>
   <aside class="col1"><section class="card" id="nf_sum" style="position:sticky;top:84px">${nfSummary()}</section></aside>
  </div>`;
}
async function submitReq(confirmDup, confirmK) {
  const n = S.nf;
  const lines = n.lines.map(l => ({ opNo: l.opNo.trim(), instNo: parseInt(l.instNo, 10) || 0, month: l.month ? (pmon(l.month) || l.month) : '', due: num(l.due), paidBefore: num(l.paidBefore), requested: num(l.requested), principal: num(l.principal) }));
  if (!n.benId) { toast(t('Choose a beneficiary.')); return; }
  if (lines.some(l => l.month && !/^\d{4}-\d{2}$/.test(l.month))) { toast(t('Month must look like 11/2026.')); return; }
  const kw = FINANCING.includes(n.opType) ? kWarns(lines.map(l => l.opNo), n.dueDate) : [];
  if (kw.length && !confirmK) { confirmBox(t('Contract expiry'), kWarnBox(kw, t('Do you want to submit the request anyway? The CFO will see this warning.')), t('Submit anyway'), () => submitReq(confirmDup, true)); return; }
  const body = Object.assign({}, n, { lines, files: n.files.map(f => ({ kind: f.kind, name: f.name, type: f.type, data: f.data })), confirmDup: !!confirmDup });
  const j = await act('submitReq', body, null, { raw: true });
  if (!j) return;
  if (j.dup) { confirmBox(t('Possible duplicate'), `<div class="warnbox">${ic('alert')}<span>${esc(j.error)}</span></div>`, t('Submit anyway'), () => submitReq(true, true)); return; }
  if (j.ok) { S.nf = null; toast(t('Request {id} sent to the CFO.', { id: j.id })); go('cheque/' + j.id); }
}

/* =================== THE CHEQUE PAGE =================== */
function chequePage(id) {
  const c = D.cheques.find(x => x.id === id);
  if (!c) return `<div class="card empty">${t('This cheque is not available to you.')}</div>`;
  const b = B(c.benId), ent = E(c.entityId), fc = (c.appr && c.appr.funcCur) || ent.funcCur;
  const big = c.payAmt != null ? M(c.payAmt, c.payCur) : M(c.amount, c.currency);
  const head = `<nav class="sm" aria-label="${t('Breadcrumb')}"><a href="#/${has('cheques') ? 'cheques' : 'mine'}">${has('cheques') ? (S.user.scope === 'all' ? t('All cheques') : S.user.scope === 'dept' ? t('Department cheques') : t('Cheques')) : t('My requests')}</a> <span class="mut">/ <bdi dir="ltr">${c.id}</bdi></span></nav>
   <section class="card" style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap">
    <div style="min-width:0"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><h1 class="h1" style="font-size:26px"><bdi dir="ltr">${c.id}</bdi></h1>${chip(c.status)}${c.priority === 'Urgent' ? `<span class="chip c-ret">${t('Urgent')}</span>` : ''}</div>
     <div style="font-size:18px;font-weight:600;margin-top:6px">${esc(nm(b))}</div>
     <div class="mut" style="margin-top:2px">${t(c.opType)} · ${esc(nm(ent))} · ${t('requested by {n} on {d}', { n: esc(UN(c.requesterId)), d: fd(c.createdAt) })}</div></div>
    <div style="text-align:end"><div style="font-size:28px;font-weight:700">${big}</div>
     <div class="mut sm">${c.payAmt != null ? t('Cheque amount') : t('Requested amount')}${c.currency !== (c.payCur || c.currency) || c.payAmt == null ? ' · ' + t('contract amount {a}', { a: money(c.amount, c.currency) }) : ''}</div>
     <button class="btn btn-o btn-sm" style="margin-top:10px" onclick="window.print()">${ic('print')}${t('Print')}</button></div></section>`;
  const acts = actionPanel(c);
  const L = c.lines || [];
  const fin = isFin(c);
  const kw = ['Rejected', 'Cancelled', 'Cleared', 'Solved'].includes(c.status) ? [] : chqWarns(c);
  if (kw.length) { S._kwSeen = S._kwSeen || {}; if (!S._kwSeen[c.id]) { S._kwSeen[c.id] = 1; setTimeout(() => toast(kw[0]), 50); } }
  const left = `
   ${kWarnBox(kw, t('The request can continue; check the contract renewal with Finance.'))}
   ${acts}
   <section class="card"><h2 class="h3">${t('Request')}</h2><div class="pairs">
    ${pair(t('Entity'), `${esc(nm(ent))} · ${t('functional currency {c}', { c: fc })}`)}${pair(t('Operation type'), t(c.opType))}${pair(t('Purpose'), t(c.purpose))}
    ${pair(t('Relationship to the company'), c.related ? `<span class="chip c-2nd">${t('Related party')}</span>` : t('Not a related party'))}
    ${pair(t('Contract currency / payment currency'), `${c.currency} / ${c.payCur || c.currency}`)}${pair(t('Due date'), FD(c.dueDate))}
    ${pair(t('Requested by'), `${esc(UN(c.requesterId))} · ${esc(nm(Dp(c.deptId)))}`)}
    ${pair(t('Payment'), `${t('Cheque')} · ${c.recipientType === 'Other' ? t('to {n}, with authorisation', { n: esc(c.recipientName || '') }) : t('handed to the beneficiary')} · ${t(c.priority === 'Urgent' ? 'Urgent' : 'Normal')}`)}
    ${c.priorityReason ? pair(t('Why urgent'), esc(c.priorityReason)) : ''}${c.remainDate ? pair(t('Remaining balance due'), FD(c.remainDate)) : ''}${c.poaSettleDate ? pair(t('Payment on account settles'), FD(c.poaSettleDate)) : ''}
    ${c.priorPaid ? pair(t('Paid before the request'), `${FD(c.priorDate)} · ${esc(c.priorMethod || '')} · ${esc(c.priorRef || '')}`) : ''}
    ${c.reason ? pair(t('Notes'), esc(c.reason)) : ''}</div></section>
   ${L.length ? `<section class="card"><div class="chead"><h2 class="h3">${t('Line items')}</h2><span class="sm mut">${t('Amounts in {c}, the contract currency', { c: c.currency })}</span></div>
    <div class="tw"><table class="tbl sm"><thead><tr>${fin ? `<th>${t('Operation no.')}</th><th>${t('Instalment')}</th><th>${t('Month')}</th>` : `<th>${t('Reference')}</th>`}<th class="num">${t('Due')}</th><th class="num">${t('Paid before')}</th><th class="num">${t('Requested')}</th>${fin ? `<th class="num">${t('Principal')}</th><th class="num">${t('Profit')}</th>` : ''}</tr></thead>
    <tbody>${L.map(l => `<tr>${fin ? `<td>${esc(l.opNo)}</td><td>${l.instNo || ''}</td><td>${fmon(l.month)}</td>` : `<td>${esc(l.opNo || '—')}</td>`}<td class="num">${N(l.due, 2)}</td><td class="num">${N(l.paidBefore, 2)}</td><td class="num">${N(l.requested, 2)}</td>${fin ? `<td class="num">${N(l.principal, 2)}</td><td class="num">${N(l.requested - l.principal, 2)}</td>` : ''}</tr>`).join('')}</tbody>
    ${L.length > 1 ? `<tfoot><tr><td colspan="${fin ? 5 : 3}">${t('Total')}</td><td class="num">${N(c.amount, 2)}</td>${fin ? `<td class="num">${N(L.reduce((a, l) => a + (+l.principal), 0), 2)}</td><td class="num">${N(L.reduce((a, l) => a + (l.requested - l.principal), 0), 2)}</td>` : ''}</tr></tfoot>` : ''}</table></div></section>` : ''}
   <section class="card"><h2 class="h3">${t('Supporting document')}</h2><div class="pairs">
    ${pair(t('Type and number'), `${esc(t(c.docType || '—'))} · ${esc(c.docNo || '—')}`)}${pair(t('Document date'), FD(c.docDate))}${pair(t('Project'), esc(c.project || '—'))}${pair(t('Counter account'), esc(c.counterAcct || D.settings.acc.payables))}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">${(c.files || []).map(f => `<a class="file" href="/api/file/${f.id}" target="_blank" rel="noopener">${ic('file')}<span><b>${esc(f.name)}</b> <span class="sm mut">· ${kb(f.size)} · ${t({ doc: 'document', auth: 'authorisation', prior: 'payment proof' }[f.kind] || f.kind)}</span></span></a>`).join('') || `<span class="mut sm">${t('No attachment (request from the first version).')}</span>`}</div></section>
   ${c.issue ? `<section class="card"><h2 class="h3">${t('Cheque')}</h2><div class="pairs">
    ${pair(t('Cheque no.'), `<bdi dir="ltr">${esc(c.issue.no)}</bdi>`)}${pair(t('Account'), esc(AC(c.issue.accountId) ? acctName(AC(c.issue.accountId)) : c.issue.bank))}${pair(t('Cheque date'), FD(c.issue.date))}
    ${pair(t('Issued by'), `${esc(byN(c.issue.by))} · ${FD(c.issue.at)}`)}${c.delivered ? pair(t('Handed to'), `${esc(c.delivered.to || nm(b))} · ${FD(c.delivered.at)}`) : ''}
    ${c.closed ? pair(c.closed.status === 'Cleared' ? t('Clearing recorded by') : t('Return recorded by'), `${esc(byN(c.closed.by))} · ${FD(c.closed.at)}`) : ''}
    ${c.closed && c.closed.reason ? pair(t('Return reason'), esc(c.closed.reason)) : ''}${c.solved ? pair(t('Settled'), `${t(c.solved.method || '')} · ${esc(c.solved.note)} · ${esc(byN(c.solved.by))}`) : ''}
    ${c.poa ? pair(t('Payment on account settled'), `${esc(c.poa.reference)} · ${esc(byN(c.poa.by))} · ${FD(c.poa.at)}`) : ''}</div></section>` : ''}
   <section class="card"><h2 class="h3" style="margin-bottom:14px">${t('History')}</h2>${chqHistory(c).map(h => `<div class="tl"><div>${h[0]}</div><div class="sm mut">${FD(h[1])}</div></div>`).join('')}</section>`;
  const right = `${msgCard(c)}${contractCard(c)}${ratesCard(c)}${entriesCard(c)}`;
  msgMarkRead(c);
  return `${head}<section class="card" aria-label="${t('Progress')}" style="overflow-x:auto">${stepper(c)}</section>
   <div class="row" style="gap:20px"><div class="col2" style="flex:3 1 520px">${left}</div><div class="col1" style="flex:2 1 340px">${right}</div></div>`;
}
/** The contracts this request pays, with their expiry. */
function contractCard(c) {
  if (!isFin(c)) return '';
  const ops = [...new Set((c.lines || []).map(l => l.opNo).filter(Boolean))];
  if (!ops.length) return '';
  return `<section class="card"><h2 class="h3" style="margin-bottom:10px">${t('Linked contract')}</h2>${ops.map(op => {
    const k = KR(op), full = K(op), e = k && kExp(k);
    if (!k) return `<div class="task"><div style="flex:1"><bdi class="b" dir="ltr">${esc(op)}</bdi><div class="sm late">${t('Not in the contracts register')}</div></div></div>`;
    const open = full && has('contracts') ? ` click" onclick="kModal(${full.id})` : '';
    return `<div class="task${open}"><div style="flex:1 1 200px;min-width:0"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><bdi class="b" dir="ltr">${esc(op)}</bdi>${kChip(k)}</div>
      <div style="margin-top:3px">${esc(nm(B(k.financierId)))} · ${k.currency}</div>
      <div class="sm mut">${t('Contract expiry {d}', { d: fd(e) || '—' })}${e && c.dueDate > e ? ' · <span class="late">' + t('request due {d}', { d: fd(c.dueDate) }) + '</span>' : ''}</div></div>
      ${open ? `<span class="btn btn-o btn-sm">${t('Open')}</span>` : ''}</div>`;
  }).join('')}</section>`;
}
/** Messages between the stages of the request: questions, document changes, modifications, answers. */
function msgCard(c) {
  const ms = MSGS(c.id), me = S.user.id;
  const others = [...new Set([c.requesterId, c.appr && c.appr.byId, c.appr2 && c.appr2.byId, c.issue && c.issue.byId].filter(x => x && x !== me))];
  const users = D.users.filter(u => u.active && u.id !== me).sort((a, b) => un(a).localeCompare(un(b)));
  const toOpt = ['all', 'requester', 'approver', 'finance', 'user'].filter(k => !(k === 'requester' && c.requesterId === me));
  const f = S.msgF && S.msgF.id === c.id ? S.msgF : (S.msgF = { id: c.id, to: c.requesterId === me ? 'approver' : 'requester', kind: 'Query', user: others[0] || 0, text: '' });
  const list = ms.length ? ms.map(m => `<div class="msg ${m.byId === me ? 'me' : ''} ${!m.read && m.byId !== me ? 'new' : ''}">
      <div class="mgh"><span class="b">${esc(m.by)}</span><span class="mut">→ ${esc(msgToTxt(m))}</span><span class="chip c-2nd">${t(m.kind)}</span></div>
      <div class="mgt">${esc(m.text).replace(/\n/g, '<br>')}</div>
      <div class="sm mut">${FD(m.at)} · ${t('stage: {s}', { s: t((STAGES[m.stage] || [m.stage])[0]) })}</div></div>`).join('')
    : `<div class="empty sm">${t('No messages yet. Ask a question or request a change here.')}</div>`;
  return `<section class="card" id="msgs"><div class="chead"><h2 class="h3">${t('Messages')}</h2><span class="sm mut">${ms.length ? N(ms.length) : ''}</span></div>
   <div class="msgs">${list}</div>
   <div class="dv"></div>
   <div class="fgrid" style="margin-top:0">
    <div class="fg"><label class="lbl" for="m_to">${t('To')}</label><select class="in" id="m_to" onchange="S.msgF.to=this.value;render()">${toOpt.map(k => `<option value="${k}" ${f.to === k ? 'selected' : ''}>${t(MSG_TO[k])}</option>`).join('')}</select></div>
    ${f.to === 'user' ? `<div class="fg"><label class="lbl" for="m_u">${t('Person')}</label><select class="in" id="m_u" onchange="S.msgF.user=+this.value"><option value="0">${t('Choose')}</option>${users.map(u => `<option value="${u.id}" ${u.id === +f.user ? 'selected' : ''}>${esc(un(u))}</option>`).join('')}</select></div>` : ''}
    <div class="fg"><label class="lbl" for="m_k">${t('Type')}</label><select class="in" id="m_k" onchange="S.msgF.kind=this.value">${MSG_KINDS.map(k => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${t(k)}</option>`).join('')}</select></div>
    <div class="fg full"><label class="lbl" for="m_tx">${t('Message')}</label><textarea class="in" id="m_tx" rows="3" maxlength="2000" oninput="S.msgF.text=this.value">${esc(f.text)}</textarea></div>
   </div>
   <button class="btn btn-y btn-sm" style="margin-top:12px" onclick="msgSend('${c.id}')">${ic('check')}${t('Send')}</button></section>`;
}
async function msgSend(id) {
  const f = S.msgF; if (!f || f.id !== id) return;
  const text = (f.text || '').trim(); if (!text) { toast(t('Write the message.')); return; }
  if (f.to === 'user' && !+f.user) { toast(t('Choose who the message is for.')); return; }
  const j = await act('comment', { id, to: f.to, toUserId: +f.user || 0, kind: f.kind, text }, t('Message sent.'));
  if (j && j.ok) { S.msgF = null; render(); }
}
function msgMarkRead(c) {
  const un = MSGS(c.id).filter(m => !m.read && m.byId !== S.user.id);
  if (!un.length) return;
  un.forEach(m => m.read = true);
  api('/api/act', { action: 'readComments', id: c.id });
  setTimeout(() => { const y = window.scrollY; render(); window.scrollTo(0, y); }, 0);
}
function pair(l, v) { return `<div><div class="pl">${l}</div><div class="pv">${v}</div></div>`; }

function stepper(c) {
  if (c.status === 'Rejected' || c.status === 'Cancelled')
    return `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">${chip(c.status)}<span>${c.rejected ? t('Rejected by {n}: {r}', { n: esc(byN(c.rejected.by)), r: esc(c.rejected.reason) }) : t('Cancelled by the requester.')}</span></div>`;
  const ret = ['Returned', 'Solved'].includes(c.status);
  // last step that is complete; the one after it is "now"
  const upTo = { Pending: 0, Pending2: 1, Approved: 2, Posted: 3, Received: 4, Delivered: 5, Cleared: 6, Returned: 6, Solved: 6 }[c.status] ?? 0;
  const steps = [
    [t('Requested'), c.createdAt], [t('CFO approval'), c.appr && c.appr.at],
    [t('Second approval'), c.appr2 ? c.appr2.at : (c.appr && !c.need2 ? 'skip' : null)],
    [t('Issued'), c.issue && c.issue.at], [t('Received'), c.received && c.received.at], [t('With beneficiary'), c.delivered && c.delivered.at],
    [ret ? t('Returned') : t('Cleared'), c.closed && c.closed.at]];
  return `<div class="steps7"><div class="ln"><i style="width:${upTo / 6 * 100}%"></i></div>${steps.map((s, i) => {
    const skip = s[1] === 'skip', done = !skip && i <= upTo, cur = i === upTo + 1;
    const last = i === 6 && done;
    const cls = skip ? 'skip' : last ? (ret ? 'x' : 'end') : done ? 'd' : cur ? 'cur' : '';
    const when = skip ? t('Not needed') : done && s[1] ? FD(String(s[1]).slice(0, 10)) : cur ? t('Now') : '';
    return `<div class="step"><div class="dot ${cls}">${done ? ic(last && ret ? 'x' : 'check') : ''}</div><div class="b" style="${skip ? 'color:var(--mut)' : ''}">${s[0]}</div><div class="mut">${when}</div></div>`;
  }).join('')}</div>`;
}

function chqHistory(c) {
  const h = [[t('Requested by {n}', { n: esc(UN(c.requesterId)) }), c.createdAt]];
  if (c.appr) h.push([t('Approved by {n} · rate of {d} saved and locked', { n: esc(byN(c.appr.by)), d: fd(c.appr.rateDate) }), c.appr.at]);
  if (c.appr && !c.need2) h.push([t('Second approval not needed'), c.appr.at]);
  if (c.appr2) h.push([t('Second approval by {n}', { n: esc(byN(c.appr2.by)) }), c.appr2.at]);
  if (c.rejected) h.push([t('Rejected by {n}: {r}', { n: esc(byN(c.rejected.by)), r: esc(c.rejected.reason) }), c.rejected.at]);
  if (c.issue) h.push([t('Cheque {no} issued to {r} by {n}', { no: esc(c.issue.no), r: esc(UN(c.requesterId)), n: esc(byN(c.issue.by)) }) + (c.issue.rateId ? ' · ' + t('rate of {d} locked', { d: fd(c.issue.rateDate) }) : ''), c.issue.at]);
  if (c.received) h.push([t('Receipt confirmed by {n}', { n: esc(byN(c.received.by)) }), c.received.at]);
  if (c.delivered) h.push([t('Handed to {to} by {n}', { to: esc(c.delivered.to || nm(B(c.benId))), n: esc(byN(c.delivered.by)) }), c.delivered.at]);
  if (c.closed) h.push([(c.closed.status === 'Cleared' ? t('Cleared · recorded by {n}', { n: esc(byN(c.closed.by)) }) : t('Returned · recorded by {n}', { n: esc(byN(c.closed.by)) })) + (c.closed.rateDate ? ' · ' + t('rate of {d} saved', { d: fd(c.closed.rateDate) }) : ''), c.closed.at]);
  if (c.solved) h.push([t('Returned cheque settled by {n}: {m}', { n: esc(byN(c.solved.by)), m: esc(t(c.solved.method || '') + ' · ' + c.solved.note) }), c.solved.at]);
  if (c.poa) h.push([t('Payment on account settled by {n}', { n: esc(byN(c.poa.by)) }), c.poa.at]);
  if (c.status === 'Cancelled') h.push([t('Cancelled by the requester'), '']);
  return h;
}

/* ----- rate snapshots (A3, A4) ----- */
function rateBlock(title, badge, sub, r, extra) {
  return `<div class="rate" style="margin-top:12px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div class="b">${title}</div><span class="chip c-lock">${ic('lock')}${badge}</span></div>
   <div class="sm mut">${sub}</div>
   <div class="big"><bdi dir="ltr">1 USD = ${rnum(r.sdg)} SDG</bdi></div><div class="sm"><bdi dir="ltr">1 USD = ${rnum(r.qar)} QAR</bdi></div>
   <div class="sm mut" style="margin:6px 0 10px"><bdi dir="ltr">${esc(r.rateId || '')}</bdi> · ${esc(r.src || t('no source'))} · ${t('entered by {n}', { n: esc(byN(r.rateBy) || '—') })}</div>${extra}</div>`;
}
function ratesCard(c) {
  const fc = (c.appr && c.appr.funcCur) || E(c.entityId).funcCur;
  let h = '';
  if (c.appr && c.appr.qar) {
    const fp = c.appr.funcPrincipal != null ? +c.appr.funcPrincipal : 0;
    h += rateBlock(t('At approval'), t('Locked'), t('Rate of {d}, the document date', { d: fd(c.appr.rateDate) }), c.appr,
      `<div class="sm" style="margin:-4px 0 8px">${t('Approved by {n}', { n: esc(byN(c.appr.by)) })} · ${FD(c.appr.at)}</div>
       <div class="line"><span>${t('Recorded value')}</span><span class="b">${M(c.appr.funcVal, fc)}</span></div>
       ${isFin(c) ? `<div class="line"><span>${t('Principal / profit')}</span><span>${N(fp)} / ${N((+c.appr.funcVal) - fp)}</span></div>` : ''}
       <div class="line"><span>${t('USD equivalent')}</span><span>${M(c.appr.usdEq, 'USD')}</span></div>`);
  } else if (c.status === 'Pending' || c.status === 'Pending2') {
    const r = rateOn(c.docDate || c.createdAt.slice(0, 10));
    h += `<div class="note" style="margin-top:12px">${r ? t('The rate of {d} ({id}) will be locked when the CFO approves.', { d: fd(r.date), id: r.id }) : t('There is no rate on or before the document date yet.')}</div>`;
  }
  if (c.issue && c.issue.rateId) h += rateBlock(t('At issue'), t('Locked'), t('Rate of {d}, the issue day · paid in {p}, contract in {k}', { d: fd(c.issue.rateDate), p: c.payCur, k: c.currency }), c.issue,
    `<div class="line"><span>${t('Cheque amount')}</span><span class="b">${M(c.payAmt, c.payCur)}</span></div>
     <div class="line"><span>${t('FX difference')}</span>${fxSpan(c.issue.fxDiff, fc)}</div>`);
  if (c.closed && c.closed.rateId) h += rateBlock(c.closed.status === 'Cleared' ? t('At clearing') : t('At return'), t('Saved'), t('Rate of {d}, the day it was recorded', { d: fd(c.closed.rateDate) }), c.closed,
    `<div class="sm" style="margin:-4px 0 8px">${c.closed.status === 'Cleared' ? t('Cleared by {n}', { n: esc(byN(c.closed.by)) }) : t('Returned · recorded by {n}', { n: esc(byN(c.closed.by)) })} · ${FD(c.closed.at)}</div>
     <div class="line"><span>${t('USD equivalent')}</span><span>${M(c.closed.usdEq, 'USD')}</span></div>
     ${c.closed.status === 'Cleared' ? `<div class="line"><span>${t('Realised FX difference')}</span>${fxSpan(c.closed.fxDiff, fc)}</div>
     ${(c.payCur || c.currency) === fc ? `<div class="sm mut" style="margin-top:6px">${t('The cheque is in {c}, the entity’s own currency, so clearing adds no difference.', { c: fc })}</div>` : ''}` : ''}`);
  return `<section class="card"><h2 class="h3">${t('Exchange rates')}</h2><div class="sm mut" style="margin-top:2px">${t('Saved with this cheque at each step. They never change.')}</div>${h || `<div class="empty sm">${t('No rate yet.')}</div>`}</section>`;
}
function fxSpan(v, cur) { v = +v || 0; if (!v) return `<span class="b">${M(0, cur)}</span>`; return v > 0 ? `<span class="loss">${t('Loss')} ${M(v, cur)}</span>` : `<span class="gain">${t('Gain')} ${M(-v, cur)}</span>`; }

/* ----- journal entries built from the cheque (only the "posted" mark is stored) ----- */
function entriesOf(c, revalDates) {
  const out = [];
  if (!c.appr || c.purpose === 'Guarantee' || !c.issue) return out;
  const A = D.settings.acc, fc = c.appr.funcCur || E(c.entityId).funcCur;
  const fv = +c.appr.funcVal || 0, fp = isFin(c) ? (+c.appr.funcPrincipal || 0) : 0, fprof = round(fv - fp, fc);
  const carry = c.issue.carry != null ? +c.issue.carry : fv, fx = +c.issue.fxDiff || 0;
  const acct = AC(c.issue.accountId), bankAcc = acct ? (acct.ledger || '') : '', bankName = acct ? acctName(acct) : (c.issue.bank || t('Bank'));
  const debit = [];
  if (isFin(c)) { if (fp) debit.push([A.finPrincipal, t('Financing principal'), fp, 0]); if (fprof) debit.push([A.finProfit, t('Accrued financing profit'), fprof, 0]); }
  else if (isPoa(c)) debit.push([A.poa, t('Payments on account'), fv, 0]);
  else debit.push([c.counterAcct || A.payables, c.counterAcct ? t('Counter account') : t('Payables'), fv, 0]);
  const iss = debit.slice();
  if (fx > 0) iss.push([A.fxDiff, t('FX differences'), fx, 0]); if (fx < 0) iss.push([A.fxDiff, t('FX differences'), 0, -fx]);
  iss.push([A.deferred, t('Deferred cheques'), 0, carry]);
  out.push({ key: 'ISS-' + c.id, date: c.issue.at.slice(0, 10), kind: 'Issue', c, cur: fc, lines: iss });
  const closedAt = c.closed ? c.closed.at.slice(0, 10) : null;
  (revalDates || []).forEach(d => {
    const p = c.payCur || c.currency;
    if (p === fc || c.issue.at.slice(0, 10) > d || (closedAt && closedAt <= d)) return;
    const r = rateOn(d); if (!r) return;
    const diff = round(conv(c.payAmt, p, fc, r) - carry, fc); if (!diff) return;
    const k = d.replace(/-/g, '');
    const L = diff > 0 ? [[A.fxDiff, t('FX differences'), diff, 0], [A.deferred, t('Deferred cheques'), 0, diff]] : [[A.deferred, t('Deferred cheques'), -diff, 0], [A.fxDiff, t('FX differences'), 0, -diff]];
    out.push({ key: `REV-${k}-${c.id}`, date: d, kind: 'Revaluation', c, cur: fc, lines: L, note: t('Rate of {d}', { d: fd(r.date) }) });
    out.push({ key: `RVR-${k}-${c.id}`, date: addDays(d, 1), kind: 'Revaluation reversal', c, cur: fc, lines: L.map(l => [l[0], l[1], l[3], l[2]]) });
  });
  if (c.closed && c.closed.status === 'Cleared') {
    const cv = c.closed.funcVal != null ? +c.closed.funcVal : carry, d = +c.closed.fxDiff || 0;
    const L = [[A.deferred, t('Deferred cheques'), carry, 0]];
    if (d > 0) L.push([A.fxDiff, t('FX differences'), d, 0]); if (d < 0) L.push([A.fxDiff, t('FX differences'), 0, -d]);
    L.push([bankAcc || '—', bankName, 0, cv]);
    out.push({ key: 'CLR-' + c.id, date: closedAt, kind: 'Clearing', c, cur: fc, lines: L });
  }
  if (c.closed && c.closed.status === 'Returned') out.push({ key: 'RET-' + c.id, date: closedAt, kind: 'Return', c, cur: fc, lines: iss.map(l => [l[0], l[1], l[3], l[2]]) });
  if (isPoa(c) && c.poa) out.push({ key: 'POA-' + c.id, date: c.poa.at.slice(0, 10), kind: 'Payment on account settled', c, cur: fc, lines: [[A.payables, t('Payables'), fv, 0], [A.poa, t('Payments on account'), 0, fv]] });
  return out;
}
function postedOf(key) { return D.posted.find(p => p.key === key); }
function entryHtml(e, compact) {
  const p = postedOf(e.key);
  return `<div class="entry"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
    <div><span class="b">${t(e.kind)}</span> <span class="sm mut">· ${FD(e.date)}${compact ? '' : ` · <a href="#/cheque/${e.c.id}"><bdi dir="ltr">${e.c.id}</bdi></a> · ${esc(nm(B(e.c.benId)))}`}${e.note ? ' · ' + esc(e.note) : ''}</span></div>
    ${p ? `<span class="chip c-clr">${t('Posted by {n}', { n: esc(byN(p.by)) })} · ${FD(p.at)}${has('entries', 'post') ? ` <button class="x" style="padding:0 0 0 6px" aria-label="${t('Undo')}" onclick="act('unpostEntry',{key:'${e.key}'},'${js(t('Unmarked'))}')">${ic('x')}</button>` : ''}</span>`
      : has('entries', 'post') ? `<button class="btn btn-y btn-sm" onclick="act('postEntry',{key:'${e.key}'},'${js(t('Marked as posted'))}')">${t('Mark as posted')}</button>` : `<span class="chip c-open">${t('Not posted')}</span>`}</div>
   <div class="tw"><table class="tbl sm" style="margin-top:6px"><thead><tr><th>${t('Account')}</th><th class="num">${t('Debit')} ${e.cur}</th><th class="num">${t('Credit')} ${e.cur}</th></tr></thead>
   <tbody>${e.lines.map(l => `<tr><td><bdi dir="ltr">${esc(l[0])}</bdi> ${esc(l[1])}</td><td class="num">${l[2] ? N(l[2], 2) : ''}</td><td class="num">${l[3] ? N(l[3], 2) : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function entriesCard(c) {
  if (!has('entries')) return '';
  const es = entriesOf(c);
  if (c.purpose === 'Guarantee') return `<section class="card"><h2 class="h3">${t('Journal entries')}</h2><div class="sm mut" style="margin-top:6px">${t('Guarantee cheques have no journal entries.')}</div></section>`;
  return `<section class="card"><h2 class="h3">${t('Journal entries')}</h2>${es.length ? es.map(e => entryHtml(e, true)).join('') : `<div class="sm mut" style="margin-top:6px">${t('Entries appear once the cheque is issued.')}</div>`}</section>`;
}

/* ----- what happens next: the action panel ----- */
function nextFree(accId) {
  const used = new Set(D.cheques.filter(c => c.issue && c.issue.accountId === accId).map(c => String(Number(c.issue.no))));
  const vd = new Set(D.voided.filter(v => v.accountId === accId).map(v => String(v.number)));
  for (const b of D.books.filter(b => b.accountId === accId && b.active).sort((a, b) => a.from - b.from))
    for (let n = b.from; n <= b.to && n < b.from + 100000; n++) if (!used.has(String(n)) && !vd.has(String(n))) return n;
  return null;
}
function panel(title, body, buttons) {
  return `<section class="card act"><h2 class="h3">${title}</h2>${body}${buttons ? `<div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:16px">${buttons}</div>` : ''}</section>`;
}
function why(msg) { return `<div class="vbox" style="margin-top:10px">${ic('info')}<span>${msg}</span></div>`; }
function actionPanel(c) {
  let poa = '';
  if (isPoa(c) && !c.poa && ['Posted', 'Received', 'Delivered', 'Cleared'].includes(c.status) && has('poa', 'settle'))
    poa = panel(t('Settle the payment on account'), `<div class="sm mut" style="margin-top:2px">${t('Due to settle on {d}.', { d: fd(c.poaSettleDate) })}</div><div class="fg" style="margin-top:12px"><label class="lbl" for="p_rf">${t('Invoice or document that settles it')} <span class="req">*</span></label><input class="in" id="p_rf"></div>`,
      `<button class="btn btn-y" onclick="act('settlePoa',{id:'${c.id}',reference:val('p_rf')},'${js(t('Payment on account settled'))}')">${t('Mark as settled')}</button>`);
  return mainPanel(c) + poa;
}
function mainPanel(c) {
  const me = S.user.id, mineC = c.requesterId === me, fc = E(c.entityId).funcCur;
  if (c.status === 'Pending') {
    if (can.approve()) {
      if (mineC) return panel(t('CFO approval'), why(t('You raised this request, so you cannot approve it. Another CFO must approve it.')));
      const rt = rateOn(c.docDate || c.createdAt.slice(0, 10));
      if (!rt) return panel(t('CFO approval'), `<div class="warnbox" style="margin-top:10px">${ic('alert')}<span>${t('There is no exchange rate on or before the document date ({d}). Finance must enter it first.', { d: fd(c.docDate) })}</span></div>`);
      const usd = conv(c.amount, c.currency, 'USD', rt), fv = conv(c.amount, c.currency, fc, rt), need = need2Reasons(usd, c.related, c.priorPaid);
      return panel(t('CFO approval'), `<div class="rate" style="margin-top:12px"><div style="display:flex;justify-content:space-between;gap:10px"><div class="b">${t('Rate to lock and save with this cheque')}</div><span class="chip c-lock">${ic('lock')}${t('On approval')}</span></div>
         <div class="sm mut">${t('Rate of {d}, the document date', { d: fd(rt.date) })}</div><div class="big"><bdi dir="ltr">1 USD = ${rnum(rt.SDG)} SDG</bdi></div><div class="sm"><bdi dir="ltr">1 USD = ${rnum(rt.QAR)} QAR</bdi></div>
         <div class="sm mut" style="margin:6px 0 10px">${esc(rt.id)} · ${esc(rt.source || '—')} · ${t('entered by {n}', { n: esc(byN(rt.setBy)) })}</div>
         <div class="line"><span>${t('USD equivalent')}</span><span class="b">${M(round(usd, 'USD'), 'USD')}</span></div><div class="line"><span>${t('Value in {c}', { c: fc })}</span><span class="b">${M(round(fv, fc), fc)}</span></div></div>
        ${need.length ? `<div class="vbox" style="margin-top:12px">${ic('info')}<span>${t('Needs second approval ({w}). After you approve, it goes to Top Management.', { w: esc(need.join(', ')) })}</span></div>` : ''}
        <div class="fg" style="margin-top:14px"><label class="lbl" for="a_rs">${t('Rejection reason')} <span class="mut" style="font-weight:400">(${t('required to reject')})</span></label><input class="in" id="a_rs"></div>`,
        `<button class="btn btn-r" onclick="rejectChq('${c.id}')">${t('Reject')}</button><button class="btn btn-g" onclick="act('approve',{id:'${c.id}'},'${js(t('Approved — rate locked'))}')">${ic('lock')}${t('Approve and lock rate')}</button>`);
    }
    if (mineC) return panel(t('Waiting for the CFO'), `<div class="sm mut" style="margin-top:6px">${t('You can cancel the request while it waits for the CFO.')}</div>`, `<button class="btn btn-o" onclick="confirmBox('${js(t('Cancel request'))}','${js(t('Cancel {id}? This cannot be undone.', { id: c.id }))}','${js(t('Cancel request'))}',()=>act('cancelReq',{id:'${c.id}'},'${js(t('Request cancelled'))}'),true)">${t('Cancel my request')}</button>`);
    return panel(t('Waiting for the CFO'), why(t('Only the CFO gives the first approval.')));
  }
  if (c.status === 'Pending2') {
    if (can.approve2()) {
      if (mineC) return panel(t('Second approval'), why(t('You raised this request, so you cannot give its second approval.')));
      if (c.appr && c.appr.byId === me) return panel(t('Second approval'), why(t('You gave the first approval, so you cannot give the second one.')));
      const need = need2Reasons(+c.appr.usdEq, c.related, c.priorPaid);
      return panel(t('Second approval'), `<div class="vbox" style="margin-top:10px">${ic('info')}<span>${t('Needs second approval because: {w}.', { w: esc(need.join(', ')) })}</span></div>
        <div class="fg" style="margin-top:14px"><label class="lbl" for="a_rs">${t('Rejection reason')} <span class="mut" style="font-weight:400">(${t('required to reject')})</span></label><input class="in" id="a_rs"></div>`,
        `<button class="btn btn-r" onclick="rejectChq('${c.id}')">${t('Reject')}</button><button class="btn btn-g" onclick="act('approve2',{id:'${c.id}'},'${js(t('Second approval given'))}')">${t('Give second approval')}</button>`);
    }
    return panel(t('Waiting for second approval'), why(t('Top Management gives the second approval.')));
  }
  if (c.status === 'Approved') {
    if (!can.issue()) return panel(t('Waiting to be issued'), why(t('Finance issues the cheque.')));
    if (mineC) return panel(t('Issue cheque'), why(t('You raised this request, so another Finance member must issue its cheque.')));
    const p = c.payCur || c.currency;
    const accts = D.accounts.filter(a => a.active && a.entityId === c.entityId && a.currency === p);
    if (!accts.length) return panel(t('Issue cheque'), `<div class="warnbox" style="margin-top:10px">${ic('alert')}<span>${t('{e} has no active account in {c}. The CFO must add one under Banking.', { e: esc(nm(E(c.entityId))), c: p })}</span></div>`);
    const sel = +(S.issAcc && accts.some(a => a.id === S.issAcc) ? S.issAcc : accts[0].id), nf = nextFree(sel);
    let amt = '';
    if (p !== c.currency) {
      const rt = rateOn(today());
      if (!rt) amt = `<div class="warnbox">${ic('alert')}<span>${t("Enter today's exchange rate first: the cheque amount uses the issue-day rate.")}</span></div>`;
      else { const pa = round(conv(c.amount, c.currency, p, rt), p), carry = round(conv(pa, p, fc, rt), fc), diff = round(carry - (+c.appr.funcVal || 0), fc);
        amt = `<div class="rate"><div class="sm mut">${t('Issue-day rate {d}: 1 USD = {r} {c}', { d: fd(rt.date), r: rnum(perUsd(p === 'USD' ? c.currency : p, rt)), c: p === 'USD' ? c.currency : p })}</div><div class="line"><span>${t('Cheque amount')}</span><span class="b">${M(pa, p)}</span></div><div class="line"><span>${t('FX difference')}</span>${fxSpan(diff, fc)}</div></div>`; }
    } else amt = `<div class="line"><span>${t('Cheque amount')}</span><span class="b">${M(c.amount, p)}</span></div>`;
    return panel(t('Issue cheque'), `<div class="sm mut" style="margin-top:2px">${t('Write the cheque, then issue it to {n}.', { n: esc(UN(c.requesterId)) })}</div>
      <div class="fgrid"><div class="fg"><label class="lbl" for="i_acc">${t('Account')} <span class="req">*</span></label><select class="in" id="i_acc" onchange="S.issAcc=+this.value;render()">${accts.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(acctName(a))}${a.description ? ' · ' + esc(a.description) : ''}</option>`).join('')}</select></div>
       <div class="fg"><label class="lbl" for="i_no">${t('Cheque number')} <span class="req">*</span></label><input class="in" id="i_no" value="${nf || ''}" inputmode="numeric" dir="ltr"><div class="hint">${nf ? t('Next free number: {n}', { n: nf }) : t('No free number: the CFO must add a chequebook.')}</div></div>
       <div class="fg"><label class="lbl" for="i_dt">${t('Cheque date')} <span class="req">*</span></label>${dateIn('i_dt', c.dueDate)}</div></div>
      <div style="margin-top:14px">${amt}</div>`, `<button class="btn btn-y" onclick="issueChq('${c.id}')">${t('Issue cheque')}</button>`);
  }
  if (c.status === 'Posted') {
    if (mineC) return panel(t('Confirm receipt'), `<div class="okbox" style="margin-top:10px">${ic('check')}<span>${t('{n} issued this cheque to you. Confirm when you have it in hand.', { n: esc(byN(c.issue.by)) })}</span></div>`, `<button class="btn btn-y" onclick="act('receive',{id:'${c.id}'},'${js(t('Receipt confirmed'))}')">${t('I received the cheque')}</button>`);
    return panel(t('With the requester'), why(t('Waiting for {n} to confirm receipt.', { n: esc(UN(c.requesterId)) })));
  }
  if (c.status === 'Received') {
    if (mineC) return panel(t('Hand it to the beneficiary'), `<div class="fgrid"><div class="fg"><label class="lbl" for="d_to">${t('Handed to (person)')}</label><input class="in" id="d_to" value="${esc(B(c.benId).contact || '')}"></div><div class="fg"><label class="lbl" for="d_dt">${t('Date')}</label>${dateIn('d_dt', today())}</div></div>`,
      `<button class="btn btn-y" onclick="act('deliver',{id:'${c.id}',to:val('d_to'),date:dval('d_dt')},'${js(t('Delivery confirmed'))}')">${t('Confirm delivery to the beneficiary')}</button>`);
    return panel(t('With the requester'), why(t('Waiting for {n} to hand it to the beneficiary.', { n: esc(UN(c.requesterId)) })));
  }
  if (c.status === 'Delivered') {
    if (!can.clear()) return panel(t('With the beneficiary'), why(t('Finance or the CFO record clearing or return from the due date.')));
    if (daysUntil(c.dueDate) > 0) return panel(t('With the beneficiary'), why(t('It can be cleared or returned from the due date ({d}).', { d: fd(c.dueDate) })));
    if (c.issue && c.issue.byId === me) return panel(t('Clear or return'), why(t('You issued this cheque, so someone else must record its clearing or return.')));
    const rt = rateOn(today());
    return panel(t('Due date reached — clear or return'), `${rt ? `<div class="note" style="margin-top:10px">${t('The rate of {d} ({id}) will be saved with the cheque.', { d: fd(rt.date), id: rt.id })}</div>` : `<div class="warnbox" style="margin-top:10px">${ic('alert')}<span>${t("Enter today's exchange rate first: it is saved with the cheque.")}</span></div>`}
      <div class="fg" style="margin-top:14px"><label class="lbl" for="c_rs">${t('Return reason (only if returned)')}</label><input class="in" id="c_rs" placeholder="${t('e.g. insufficient funds, signature mismatch')}"></div>`,
      `<button class="btn btn-r" onclick="act('close',{id:'${c.id}',status:'Returned',reason:val('c_rs')},'${js(t('Marked as returned'))}')">${t('Returned')}</button><button class="btn btn-g" onclick="act('close',{id:'${c.id}',status:'Cleared'},'${js(t('Marked as cleared'))}')">${t('Cleared')}</button>`);
  }
  if (c.status === 'Returned') {
    if (!can.settle()) return panel(t('Returned'), why(t('Finance or the CFO settle returned cheques.')));
    return panel(t('Settle the returned cheque'), `<div class="fgrid"><div class="fg"><label class="lbl" for="s_m">${t('How was it settled?')} <span class="req">*</span></label><select class="in" id="s_m">${['Replacement cheque', 'Transfer', 'Obligation cancelled'].map(m => `<option value="${m}">${t(m)}</option>`).join('')}</select></div>
      <div class="fg"><label class="lbl" for="s_n">${t('Note')} <span class="req">*</span></label><input class="in" id="s_n" placeholder="${t('e.g. new cheque or transfer reference')}"></div></div>`,
      `<button class="btn btn-g" onclick="act('solve',{id:'${c.id}',method:val('s_m'),note:val('s_n')},'${js(t('Returned cheque settled'))}')">${t('Mark as settled')}</button>`);
  }
  return '';
}
function rejectChq(id) {
  const rs = val('a_rs');
  if (rs.length < 2) { toast(t('Enter the rejection reason.')); const e = document.getElementById('a_rs'); if (e) { e.classList.add('err'); e.focus(); } return; }
  confirmBox(t('Reject request'), t('Reject {id}? The requester will see your reason.', { id }), t('Reject'), () => act('reject', { id, reason: rs }, t('Rejected')), true);
}
function issueChq(id) {
  const acc = +val('i_acc'), no = val('i_no'), dt = dval('i_dt');
  if (!no) { toast(t('Enter the cheque number (digits only).')); return; }
  if (!dt) { toast(t('Enter the cheque date.')); return; }
  act('issue', { id, accountId: acc, no, date: dt }, t('Cheque issued'));
}
