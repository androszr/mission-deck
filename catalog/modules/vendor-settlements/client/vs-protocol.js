// vendor-settlements/client/vs-protocol.js
// "Protocol generator" - the three-step wizard (Settlement -> Vendor ->
// People) that ends in a .docx download or a print page.
//
// All state lives on ctx.ui (created per render by index.js); this file holds
// none. index.js forwards the clicks / changes of the generator section here
// through handleProtClick / handleProtChange (both return true when handled).

import {
  escHtml, fmtMoney, AREA_LABELS, fmtMonthLabel, vendorNameMatches,
  distributeAmountToPersons, getPersonsForStep3, resolvePersonDisplayName, teamMemberNames,
} from './vs-lib.js';
import { openVendorModal, upsertVendor } from './vs-modals.js';

const STEPS = ['Settlement', 'Vendor', 'People'];
const DEPS_MSG = 'The generator needs the docx and mammoth packages. Run `npm ci --omit=dev` in the modules/vendor-settlements directory.';

export function freshProtState() {
  return {
    assignmentId: '', area: '', month: '', company: '',
    protocolNumber: '', protocolDate: '',
    mode: 'persons',
    selectedPersons: new Map(),
    customAmount: 0,
  };
}

function assignmentsOf(ctx) {
  return (ctx.data.summary && ctx.data.summary.assignments) || [];
}

function vendorOf(ctx, company) {
  return ((ctx.data.vendorInfo && ctx.data.vendorInfo.vendors) || [])
    .find(v => vendorNameMatches(v.name, company)) || null;
}

// -- Step markup ----------------------------------------------------------------

function stepIndicatorHtml(active) {
  const pills = STEPS.map((label, i) => {
    const n = i + 1;
    if (n < active) {
      return `<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm vsprot-step done" data-vsprot-goto="${n}">${n}. ${label}</button>`;
    }
    return `<span class="vsprot-step${n === active ? ' active' : ''}">${n}. ${label}</span>`;
  }).join('');
  return `<div class="vsprot-step-indicator">${pills}</div>`;
}

function step1Html(ctx) {
  const st = ctx.ui.prot;
  const opts = '<option value="">-- choose a settlement --</option>' + assignmentsOf(ctx).map(a => {
    const areaLabel = AREA_LABELS[a.area] || a.area;
    const monthLabel = a.period_from ? fmtMonthLabel(a.period_from.slice(0, 7)) : '--';
    const label = `${escHtml(a.vendor)} · ${escHtml(areaLabel)} · ${escHtml(monthLabel)} · ${escHtml(a.title || '')}`;
    return `<option value="${escHtml(a.id)}"${st.assignmentId === a.id ? ' selected' : ''}>${label}</option>`;
  }).join('');
  return `<div class="vsprot-numer-row">
      <div class="ds-input-wrap">
        <label class="ds-label" for="vsprot-assignment-select">Settlement</label>
        <select id="vsprot-assignment-select" class="ds-input">${opts}</select>
      </div>
      <div class="ds-input-wrap">
        <label class="ds-label" for="vsprot-date">Protocol date</label>
        <input type="date" id="vsprot-date" class="ds-input" value="${escHtml(st.protocolDate || '')}">
      </div>
    </div>
    <div class="vsprot-nav">
      <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" id="vsprot-next-1">Next &rarr;</button>
    </div>`;
}

function step2Html(ctx) {
  const v = vendorOf(ctx, ctx.ui.prot.company);
  const field = (id, label, key, ph) => `<div class="ds-input-wrap">
        <label class="ds-label" for="vsprot-vnd-${id}">${label}</label>
        <input type="text" id="vsprot-vnd-${id}" class="ds-input" placeholder="${ph}" value="${escHtml((v && v[key]) || '')}">
      </div>`;
  return `<div class="vsprot-vendor-form">
      ${field('fullname', 'Full company name', 'full_name', 'e.g. Acme Ltd')}
      ${field('address', 'Address', 'address', 'e.g. 1 Example Street, 00-000 Springfield')}
      ${field('taxid', 'Tax ID', 'tax_id', 'e.g. 0000000000')}
      ${field('registry', 'Registry number', 'registry_no', 'e.g. 0000000001')}
    </div>
    <div class="vsprot-nav">
      <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" id="vsprot-next-2">Next &rarr;</button>
      <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="vsprot-vnd-save">Save vendor details</button>
      <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" id="vsprot-back-2">&larr; Back</button>
    </div>`;
}

function step3Html() {
  return `<div class="ds-callout ds-callout--warning" id="vsprot-costs-warning" hidden></div>
    <div class="ds-callout ds-callout--warning" id="vsprot-deps-warning" hidden><div>${DEPS_MSG}</div></div>
    <div class="ds-table-wrap">
      <table class="ds-table vsprot-persons-table" id="vsprot-persons-table">
        <thead>
          <tr>
            <th class="vsprot-col-chk"><span class="vs-sr-only">Select</span></th>
            <th>Person</th>
            <th class="right">Hours</th>
            <th class="right">MD</th>
            <th class="right">Rate</th>
            <th class="right">Amount</th>
          </tr>
        </thead>
        <tbody id="vsprot-persons-tbody"></tbody>
      </table>
    </div>
    <div class="vsprot-nav">
      <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" id="vsprot-generate">Generate .docx</button>
      <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="vsprot-generate-pdf">Generate PDF</button>
      <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" id="vsprot-back-3">&larr; Back</button>
    </div>`;
}

// -- Persons table ---------------------------------------------------------------------

function emptyRow(text) {
  return `<tr><td colspan="6" class="vsprot-empty-cell">${text}</td></tr>`;
}

function renderStep3(ctx) {
  const st = ctx.ui.prot;
  const tbody = document.getElementById('vsprot-persons-tbody');
  const warningEl = document.getElementById('vsprot-costs-warning');
  if (!tbody) return;

  const deps = (ctx.status && ctx.status.deps) || {};
  const depsEl = document.getElementById('vsprot-deps-warning');
  const docxOk = !!deps.docx;
  const pdfOk = !!(deps.docx && deps.mammoth);
  if (depsEl) depsEl.hidden = docxOk && pdfOk;
  const genBtn = document.getElementById('vsprot-generate');
  const pdfBtn = document.getElementById('vsprot-generate-pdf');
  if (genBtn) genBtn.disabled = !docxOk;
  if (pdfBtn) pdfBtn.disabled = !pdfOk;

  if (!st.area || !st.company || !st.month) {
    tbody.innerHTML = emptyRow('Choose a settlement in step 1.');
    return;
  }
  const rawPersons = getPersonsForStep3(st.area, st.company, st.month, ctx.data);
  if (rawPersons === null) {
    if (warningEl) { warningEl.textContent = 'No cost data for area ' + (AREA_LABELS[st.area] || st.area) + '.'; warningEl.hidden = false; }
    tbody.innerHTML = '';
    return;
  }
  if (warningEl) warningEl.hidden = true;
  if (rawPersons.length === 0) {
    tbody.innerHTML = emptyRow(`No people for "${escHtml(st.company)}" in ${escHtml(st.month)}.`);
    return;
  }

  let persons;
  if (st.mode === 'custom' && st.customAmount) {
    persons = distributeAmountToPersons(rawPersons, st.customAmount).map(p => {
      const rate = Number(p.daily_rate || 0);
      const md = rate > 0 ? Number((p.amount / rate).toFixed(2)) : 0;
      return { ...p, hours: Number((md * 8).toFixed(2)), md };
    });
  } else {
    persons = rawPersons.map(p => ({
      ...p,
      amount: p.total_cost || (Number(p.hours || 0) / 8 * Number(p.daily_rate || 0)),
    }));
  }
  ctx.ui.protPersons = persons;

  const toSelected = (p) => ({
    name: p.name,
    hours: Number(p.hours || 0),
    md: Number(p.md || (p.hours || 0) / 8 || 0),
    daily_rate: Number(p.daily_rate || 0),
    amount: Number(p.amount || 0),
  });
  if (st.selectedPersons.size === 0) {
    for (const p of persons) st.selectedPersons.set(p.name, toSelected(p));
  } else {
    for (const p of persons) {
      if (st.selectedPersons.has(p.name)) st.selectedPersons.get(p.name).amount = Number(p.amount || 0);
    }
  }

  const memberNames = teamMemberNames(ctx.data);
  tbody.innerHTML = persons.map(p => {
    const isSelected = st.selectedPersons.has(p.name);
    const amount = isSelected ? st.selectedPersons.get(p.name).amount : Number(p.amount || 0);
    // The same name resolution the server applies to the document; data-name
    // stays the raw costs name (identity).
    const displayName = resolvePersonDisplayName(p.name, memberNames);
    const hours = Number(p.hours || 0);
    const md = Number(p.md || hours / 8);
    return `<tr>
      <td><input type="checkbox" class="vsprot-person-chk" data-name="${escHtml(p.name)}" aria-label="Select: ${escHtml(displayName)}"${isSelected ? ' checked' : ''}></td>
      <td>${escHtml(displayName)}</td>
      <td class="right">${hours.toFixed(2)}h</td>
      <td class="right">${md.toFixed(2)}</td>
      <td class="right">${fmtMoney(p.daily_rate || 0)}</td>
      <td class="right">${fmtMoney(amount)}</td>
    </tr>`;
  }).join('');
}

// -- Wizard navigation -----------------------------------------------------------------------

function goToStep(ctx, n) {
  ctx.ui.protStep = n;
  const contentEl = document.getElementById('vsprot-step-content');
  if (!contentEl) return;
  if (n === 1) contentEl.innerHTML = stepIndicatorHtml(1) + step1Html(ctx);
  else if (n === 2) contentEl.innerHTML = stepIndicatorHtml(2) + step2Html(ctx);
  else {
    contentEl.innerHTML = stepIndicatorHtml(3) + step3Html();
    renderStep3(ctx);
  }
}

export function renderProtocolGenSection(ctx) {
  const section = document.getElementById('vsprot-section');
  if (!section) return;
  if (assignmentsOf(ctx).length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  if (ctx.ui.protStep === 1 || ctx.ui.protDataChanged) {
    ctx.ui.protDataChanged = false;
    goToStep(ctx, 1);
  }
}

function onAssignmentChange(ctx) {
  const st = ctx.ui.prot;
  const sel = document.getElementById('vsprot-assignment-select');
  st.assignmentId = sel ? sel.value : '';
  st.selectedPersons = new Map();
  st.customAmount = 0;
  if (!st.assignmentId) {
    Object.assign(st, { area: '', month: '', company: '', protocolNumber: '', mode: 'persons' });
    return;
  }
  const a = assignmentsOf(ctx).find(x => x.id === st.assignmentId);
  if (!a) return;
  st.area = a.area;
  st.month = a.period_from ? a.period_from.slice(0, 7) : '';
  st.company = a.vendor;
  st.protocolNumber = a.title || '';
  st.mode = a.mode || 'persons';
  st.customAmount = a.mode === 'custom' ? (a.amount || 0) : 0;
  const dateEl = document.getElementById('vsprot-date');
  if (dateEl && !dateEl.value) {
    const t = new Date();
    const pad = n => (n < 10 ? '0' + n : '' + n);
    dateEl.value = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
    st.protocolDate = dateEl.value;
  }
}

// -- Actions ---------------------------------------------------------------------------------------

async function onSaveVendor(ctx) {
  const st = ctx.ui.prot;
  if (!st.company) { ctx.toast('warning', 'Choose a settlement in step 1'); return; }
  const val = (id) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  };
  const fullname = val('vsprot-vnd-fullname');
  if (!fullname) { ctx.toast('warning', 'The full company name is required'); return; }
  const btn = document.getElementById('vsprot-vnd-save');
  if (btn) btn.disabled = true;
  let res;
  try {
    res = await ctx.api('POST', '/vendor-info/add', {
      name: st.company, full_name: fullname,
      address: val('vsprot-vnd-address'), tax_id: val('vsprot-vnd-taxid'), registry_no: val('vsprot-vnd-registry'),
    });
  } finally {
    if (btn && ctx.live()) btn.disabled = false;
  }
  if (!ctx.live()) return;
  if (!res.ok) {
    ctx.toast('danger', 'Could not save the vendor details', ctx.errMsg(res));
    return;
  }
  upsertVendor(ctx, res.data.vendor);
  ctx.toast('success', 'Vendor details saved');
}

function buildPayload(ctx) {
  const st = ctx.ui.prot;
  const a = assignmentsOf(ctx).find(x => x.id === st.assignmentId);
  return {
    company: st.company,
    month: st.month,
    persons: [...st.selectedPersons.values()],
    po_name: a ? (a.po_name || '') : '',
    po_number: a ? (a.po_number || '') : '',
    protocol_number: st.protocolNumber,
    protocol_date: st.protocolDate,
    vendor: vendorOf(ctx, st.company),
  };
}

function precheck(ctx, needPersons) {
  const st = ctx.ui.prot;
  if (!st.assignmentId) { ctx.toast('warning', 'Choose a settlement in step 1'); return false; }
  if (!st.protocolNumber) { ctx.toast('warning', 'Enter the protocol number'); return false; }
  if (!st.protocolDate) { ctx.toast('warning', 'Enter the protocol date'); return false; }
  if (needPersons && st.selectedPersons.size === 0) { ctx.toast('warning', 'No people selected'); return false; }
  return true;
}

async function failMessage(ctx, resp) {
  let msg = 'HTTP ' + resp.status;
  try {
    const j = await resp.json();
    msg = ctx.errMsg({ status: resp.status, data: j });
  } catch { /* not JSON */ }
  return msg;
}

async function onGeneratePdf(ctx) {
  if (!precheck(ctx, false)) return;
  // Open the window synchronously, inside the click: after an await a popup
  // blocker would refuse it.
  const win = window.open('', '_blank');
  if (!win) {
    ctx.toast('warning', 'Pop-up blocked', 'Allow pop-up windows for this page');
    return;
  }
  const btn = document.getElementById('vsprot-generate-pdf');
  if (btn) btn.disabled = true;
  try {
    const resp = await ctx.rawFetch('POST', '/protocols/generate?format=pdf&project=' + encodeURIComponent(ctx.ui.prot.area), buildPayload(ctx));
    if (!resp.ok) {
      win.close();
      ctx.toast('danger', 'Could not generate the PDF', await failMessage(ctx, resp));
      return;
    }
    const html = await resp.text();
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    // The page's own inline print call may be blocked by the host CSP.
    setTimeout(() => { try { win.print(); } catch { /* window closed */ } }, 300);
  } catch (e) {
    win.close();
    ctx.toast('danger', 'Could not generate the PDF', (e && e.message) || '');
  } finally {
    if (btn && ctx.live()) btn.disabled = !(((ctx.status || {}).deps || {}).docx && ((ctx.status || {}).deps || {}).mammoth);
  }
}

async function onGenerate(ctx) {
  if (!precheck(ctx, true)) return;
  const st = ctx.ui.prot;
  const btn = document.getElementById('vsprot-generate');
  if (btn) btn.disabled = true;
  try {
    const resp = await ctx.rawFetch('POST', '/protocols/generate?project=' + encodeURIComponent(st.area), buildPayload(ctx));
    if (!resp.ok) {
      ctx.toast('danger', 'Could not generate the protocol', await failMessage(ctx, resp));
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cd = resp.headers.get('content-disposition') || '';
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="([^"]+)"/.exec(cd);
    let name = `${st.company}-protocol-${st.month}.docx`;
    if (m) { try { name = decodeURIComponent(m[1]); } catch { name = m[1]; } }
    a.download = name;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    ctx.toast('success', 'Protocol generated', name);
  } catch (e) {
    ctx.toast('danger', 'Could not generate', (e && e.message) || '');
  } finally {
    if (btn && ctx.live()) btn.disabled = !(((ctx.status || {}).deps || {}).docx);
  }
}

// -- Event entry points (called from index.js) ---------------------------------------------------------

export function handleProtClick(ctx, e) {
  const t = e.target;
  const st = ctx.ui.prot;
  const goto = t.closest('[data-vsprot-goto]');
  if (goto) { goToStep(ctx, Number(goto.dataset.vsprotGoto)); return true; }
  const btn = t.closest('button');
  if (!btn || !btn.id) return false;
  switch (btn.id) {
    case 'vsprot-next-1': {
      const dateEl = document.getElementById('vsprot-date');
      st.protocolDate = (dateEl && dateEl.value) || st.protocolDate;
      if (!st.assignmentId) { ctx.toast('warning', 'Choose a settlement'); return true; }
      if (!st.protocolDate) { ctx.toast('warning', 'Enter the protocol date'); return true; }
      goToStep(ctx, 2);
      return true;
    }
    case 'vsprot-back-2': goToStep(ctx, 1); return true;
    case 'vsprot-next-2': goToStep(ctx, 3); return true;
    case 'vsprot-back-3': goToStep(ctx, 2); return true;
    case 'vsprot-vnd-save': onSaveVendor(ctx); return true;
    case 'vsprot-generate': onGenerate(ctx); return true;
    case 'vsprot-generate-pdf': onGeneratePdf(ctx); return true;
    case 'vsprot-open-vendor-modal': openVendorModal(ctx, st.company || '', btn); return true;
    default: return false;
  }
}

export function handleProtChange(ctx, e) {
  const t = e.target;
  const st = ctx.ui.prot;
  if (t.id === 'vsprot-assignment-select') { onAssignmentChange(ctx); return true; }
  if (t.id === 'vsprot-date') { st.protocolDate = t.value || ''; return true; }
  if (t.classList && t.classList.contains('vsprot-person-chk')) {
    const name = t.dataset.name;
    if (t.checked) {
      const p = (ctx.ui.protPersons || []).find(pp => pp.name === name);
      if (p) {
        st.selectedPersons.set(name, {
          name,
          hours: Number(p.hours || 0),
          md: Number(p.md || (p.hours || 0) / 8 || 0),
          daily_rate: Number(p.daily_rate || 0),
          amount: Number(p.amount || 0),
        });
      }
    } else {
      st.selectedPersons.delete(name);
    }
    return true;
  }
  return false;
}
