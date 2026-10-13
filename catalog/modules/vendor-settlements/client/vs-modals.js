// vendor-settlements/client/vs-modals.js
// The four modals of the view: "Items", "Mark as accepted", "Vendor details",
// "Refresh and status". Every overlay is a ds-modal-overlay opened with
// openDsModal and tracked in ctx.overlays so the view cleanup can remove it.
//
// No module-level state: `ctx` (created by index.js on every render) carries
// the loaded data, the API helpers and the DS modal namespace.

import {
  escHtml, fmtMoney, fmtH, fmtMonthLabel, AREA_LABELS,
  vendorNameMatches, getEpicTotalsForVendor, getCostsForArea, computeAvailableOnPo,
  getOrdersForVendor, canonicalVendor,
} from './vs-lib.js';

// -- Overlay plumbing ----------------------------------------------------------

export function closeOverlay(ctx, el) {
  if (!el) return;
  if (ctx.dsModal) {
    ctx.dsModal.closeDsModal(el);
  } else {
    el.classList.remove('open');
    el.hidden = true;
  }
  el.remove();
  ctx.overlays = ctx.overlays.filter(o => o !== el);
}

/**
 * Appends a hidden ds-modal-overlay to <body>. `primary` = { id, label } adds
 * the primary action first in the footer, `cancelLabel` the tertiary close
 * button after it; neither = a lone secondary "Close".
 */
export function buildOverlay(ctx, opts) {
  const old = document.getElementById(opts.id);
  if (old) closeOverlay(ctx, old);
  const el = document.createElement('div');
  el.className = 'ds-modal-overlay';
  el.id = opts.id;
  el.hidden = true;
  const sizeCls = opts.size ? ' ds-modal--' + opts.size : '';
  let footer;
  if (opts.primary) {
    footer = `<div class="ds-modal-footer">
      <button type="button" class="ds-btn ds-btn--primary" id="${opts.primary.id}">${escHtml(opts.primary.label)}</button>
      <button type="button" class="ds-btn ds-btn--tertiary" data-ov-close>${escHtml(opts.cancelLabel || 'Cancel')}</button>
    </div>`;
  } else {
    footer = `<div class="ds-modal-footer">
      <button type="button" class="ds-btn ds-btn--secondary" data-ov-close>Close</button>
    </div>`;
  }
  el.innerHTML = `<div class="ds-modal${sizeCls}" role="dialog" aria-modal="true" aria-labelledby="${opts.id}-title">
    <div class="ds-modal-header">
      <span class="ds-modal-title" id="${opts.id}-title">${opts.titleHtml || escHtml(opts.title || '')}</span>
      <button type="button" class="ds-modal-close" data-ov-close aria-label="Close">&times;</button>
    </div>
    <div class="ds-modal-body">${opts.bodyHtml}</div>
    ${footer}
  </div>`;
  document.body.appendChild(el);
  ctx.overlays.push(el);
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-ov-close]')) closeOverlay(ctx, el);
  });
  return el;
}

export function showOverlay(ctx, el, trigger) {
  if (ctx.dsModal) {
    ctx.dsModal.openDsModal(el, { trigger });
  } else {
    el.hidden = false;
    el.classList.add('open');
  }
}

const EMPTY_P = '<p class="vs-modal-empty">No items.</p>';

/** A link to the issue in the tracker when JIRA_BASE_URL is configured, else the bare key. */
export function issueLinkHtml(ctx, key) {
  const base = ctx && ctx.data && ctx.data.jiraBrowseUrl;
  return base
    ? `<a class="vs-jira-link" href="${escHtml(base)}${encodeURIComponent(key)}" target="_blank" rel="noopener">${escHtml(key)}</a>`
    : escHtml(key);
}

// -- Items -------------------------------------------------------------------------

function itemsBody(ctx, a) {
  const data = ctx.data;
  const from = a.period_from ? a.period_from.slice(0, 7) : '';
  const selected = new Set(a.items || []);

  if (a.mode === 'custom') {
    return '<p class="vs-modal-empty">Custom mode &mdash; no cost items.</p>';
  }

  if (a.mode === 'epics') {
    const entries = Array.from(getEpicTotalsForVendor(a.area, a.vendor, from, from, data).entries())
      .filter(([key]) => selected.has(key));
    if (entries.length === 0) return EMPTY_P;
    const totalHours = entries.reduce((s, [, d]) => s + d.hours, 0);
    const totalAmount = entries.reduce((s, [, d]) => s + d.amount, 0);
    const rows = entries.map(([key, d]) => `<tr>
        <td class="vs-nowrap">${issueLinkHtml(ctx, key)}</td>
        <td>${escHtml(d.name)}</td>
        <td class="right">${fmtH(d.hours)}</td>
        <td class="right">${fmtMoney(d.amount)}</td>
      </tr>`).join('');
    return `<div class="ds-table-wrap"><table class="ds-table">
      <thead><tr><th>Epic</th><th>Name</th><th class="right">Hours</th><th class="right">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="vs-total-row"><td colspan="2">Total</td><td class="right">${fmtH(totalHours)}</td><td class="right">${fmtMoney(totalAmount)}</td></tr></tfoot>
    </table></div>`;
  }

  // Persons: read the costs directly, without the finance filter - this is a
  // read-only view of items that were already saved.
  const costsData = getCostsForArea(a.area, data);
  const raw = new Map();
  for (const p of ((costsData && costsData.persons && costsData.persons[from]) || [])) {
    if (selected.has(p.name)) raw.set(p.name, { hours: p.hours || 0, amount: p.total_cost || 0 });
  }
  const entries = Array.from(raw.entries());
  if (entries.length === 0) return EMPTY_P;
  const totalHours = entries.reduce((s, [, d]) => s + d.hours, 0);
  const totalAmount = entries.reduce((s, [, d]) => s + d.amount, 0);
  const rows = entries.map(([name, d]) => `<tr>
      <td>${escHtml(name)}</td><td class="right">${fmtH(d.hours)}</td><td class="right">${fmtMoney(d.amount)}</td>
    </tr>`).join('');
  return `<div class="ds-table-wrap"><table class="ds-table">
    <thead><tr><th>Person</th><th class="right">Hours</th><th class="right">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="vs-total-row"><td>Total</td><td class="right">${fmtH(totalHours)}</td><td class="right">${fmtMoney(totalAmount)}</td></tr></tfoot>
  </table></div>`;
}

export function openItemsModal(ctx, a, trigger) {
  const periodLabel = a.period_from ? fmtMonthLabel(a.period_from.slice(0, 7)) : '--';
  const el = buildOverlay(ctx, {
    id: 'vs-items-modal',
    size: 'xl',
    title: `Items — ${a.vendor} | ${periodLabel}`,
    bodyHtml: itemsBody(ctx, a),
  });
  showOverlay(ctx, el, trigger);
}

// -- Mark as accepted ----------------------------------------------------------------

export function openAcceptModal(ctx, a, trigger) {
  if (!a || a.accepted_at) return;
  const po = a.po_number || '';
  const available = computeAvailableOnPo(po, a.id, ctx.data);
  const statusHtml = available === null
    ? '<div class="ds-callout ds-callout--info"><div>This order is not in the order pool (purchase-orders.json).</div></div>'
    : `<div class="ds-callout ds-callout--info"><div class="vs-accept-status">
        <div>Left on the order after this settlement: <strong>${escHtml(fmtMoney(available - (Number(a.amount) || 0)))}</strong></div>
      </div></div>`;

  const el = buildOverlay(ctx, {
    id: 'vs-accept-modal',
    titleHtml: `Mark as accepted &mdash; <code>${escHtml(po)}</code>`,
    primary: { id: 'vs-accept-submit', label: 'Mark as accepted' },
    bodyHtml: `${statusHtml}
      <p class="vs-accept-desc">Accept the order in your procurement system by hand, then mark it here.</p>
      <div class="ds-input-wrap">
        <label class="ds-label" for="vs-accept-amount-input">Accepted amount (from the settlement)</label>
        <input class="ds-input" id="vs-accept-amount-input" type="text" readonly value="${escHtml(typeof a.amount === 'number' ? a.amount.toFixed(2) : '')}">
      </div>
      <div class="ds-callout ds-callout--danger" id="vs-accept-error" hidden></div>`,
  });
  const errorEl = el.querySelector('#vs-accept-error');
  const submit = el.querySelector('#vs-accept-submit');

  submit.addEventListener('click', async () => {
    submit.disabled = true;
    errorEl.hidden = true;
    let res;
    try {
      res = await ctx.api('POST', '/summary/mark-accepted', { id: a.id, accepted_at: new Date().toISOString() });
    } catch (err) {
      submit.disabled = false;
      throw err;
    }
    if (!ctx.live()) return;
    if (res.ok) {
      closeOverlay(ctx, el);
      ctx.toast('success', 'Marked as accepted', po);
      await ctx.afterWrite();
      return;
    }
    submit.disabled = false;
    if (res.data && res.data.error === 'already-accepted') {
      errorEl.innerHTML = '<div>Already marked as accepted &mdash; refresh the view. <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-vs-accept-refresh>Refresh</button></div>';
      errorEl.hidden = false;
      errorEl.querySelector('[data-vs-accept-refresh]').addEventListener('click', async () => {
        closeOverlay(ctx, el);
        await ctx.afterWrite();
      });
      return;
    }
    errorEl.textContent = ctx.errMsg(res);
    errorEl.hidden = false;
  });
  showOverlay(ctx, el, trigger);
}

// -- Vendor details ---------------------------------------------------------------------

function vendorFieldHtml(prefix, label, field, placeholder) {
  return `<div class="ds-input-wrap">
      <label class="ds-label" for="${prefix}-${field}">${label}</label>
      <input type="text" id="${prefix}-${field}" class="ds-input" placeholder="${placeholder}">
    </div>`;
}

function vendorOptions(ctx, preselect) {
  const data = ctx.data;
  const fromAssignments = ((data.summary && data.summary.assignments) || []).map(a => a.vendor).filter(Boolean);
  const fromVendorInfo = ((data.vendorInfo && data.vendorInfo.vendors) || []).map(v => v.name);
  const fromOrders = getOrdersForVendor(data.purchaseOrders, null).map(c => c.vendor_name).filter(Boolean);
  const seen = new Map();
  for (const v of new Set([...fromAssignments, ...fromVendorInfo, ...fromOrders])) {
    const canon = canonicalVendor(v, data);
    if (!seen.has(canon.toLowerCase())) seen.set(canon.toLowerCase(), canon);
  }
  const canonPre = preselect ? canonicalVendor(preselect, data) : '';
  return '<option value="">-- choose a vendor --</option>' + [...seen.values()].sort()
    .map(v => `<option value="${escHtml(v)}"${v === canonPre ? ' selected' : ''}>${escHtml(v)}</option>`).join('');
}

/** Upserts the saved vendor into the loaded data (by permissive name match). */
export function upsertVendor(ctx, vendor) {
  if (!vendor) return;
  if (!ctx.data.vendorInfo || !Array.isArray(ctx.data.vendorInfo.vendors)) {
    ctx.data.vendorInfo = { vendors: [vendor] };
    return;
  }
  const existing = ctx.data.vendorInfo.vendors.find(v => vendorNameMatches(v.name, vendor.name));
  if (existing) Object.assign(existing, vendor);
  else ctx.data.vendorInfo.vendors.push(vendor);
}

export function openVendorModal(ctx, preselect, trigger) {
  const FIELDS = [
    ['fullname', 'Full company name', 'e.g. Acme Ltd'],
    ['address', 'Address', 'e.g. 1 Example Street, 00-000 Springfield'],
    ['taxid', 'Tax ID', 'e.g. 0000000000'],
    ['registry', 'Registry number', 'e.g. 0000000001'],
  ];
  const fields = (prefix) => FIELDS.map(([f, label, ph]) => vendorFieldHtml(prefix, label, f, ph)).join('');
  const el = buildOverlay(ctx, {
    id: 'vsprot-vendor-modal',
    size: 'md',
    title: 'Vendor details',
    primary: { id: 'vsprot-vnd-modal-save', label: 'Save details' },
    bodyHtml: `<div class="vs-vendor-modal-body">
      <div class="ds-input-wrap">
        <label class="ds-label" for="vsprot-vnd-modal-select">Vendor</label>
        <select id="vsprot-vnd-modal-select" class="ds-input">${vendorOptions(ctx, preselect)}</select>
      </div>
      <div class="vsprot-vendor-form">${fields('vsprot-vnd-modal')}</div>
      <div>
        <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="vsprot-vnd-modal-add-toggle" aria-expanded="false">+ Add a new vendor</button>
        <div id="vsprot-vnd-modal-new-form" class="vs-vendor-new" hidden>
          <p class="vs-vendor-new-title">New vendor</p>
          ${vendorFieldHtml('vsprot-vnd-new', 'Short name (key)', 'name', 'e.g. Acme')}
          ${fields('vsprot-vnd-new')}
          <div class="vs-vendor-new-actions">
            <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" id="vsprot-vnd-new-save">Save the new vendor</button>
            <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" id="vsprot-vnd-new-cancel">Cancel</button>
          </div>
        </div>
      </div>
    </div>`,
  });

  const $ = (id) => el.querySelector('#' + id);
  const val = (id) => ($(id) ? $(id).value.trim() : '');
  const select = $('vsprot-vnd-modal-select');
  const newForm = $('vsprot-vnd-modal-new-form');
  const addToggle = $('vsprot-vnd-modal-add-toggle');

  function fillForm() {
    const name = select.value;
    const vendor = ((ctx.data.vendorInfo && ctx.data.vendorInfo.vendors) || [])
      .find(v => vendorNameMatches(v.name, name)) || null;
    $('vsprot-vnd-modal-fullname').value = (vendor && vendor.full_name) || '';
    $('vsprot-vnd-modal-address').value = (vendor && vendor.address) || '';
    $('vsprot-vnd-modal-taxid').value = (vendor && vendor.tax_id) || '';
    $('vsprot-vnd-modal-registry').value = (vendor && vendor.registry_no) || '';
  }
  function resetNew() {
    newForm.hidden = true;
    addToggle.textContent = '+ Add a new vendor';
    addToggle.setAttribute('aria-expanded', 'false');
    ['name', 'fullname', 'address', 'taxid', 'registry'].forEach(f => { $('vsprot-vnd-new-' + f).value = ''; });
  }
  async function save(name, prefix, btn, okTitle) {
    btn.disabled = true;
    let res;
    try {
      res = await ctx.api('POST', '/vendor-info/add', {
        name,
        full_name: val(prefix + '-fullname'),
        address: val(prefix + '-address'),
        tax_id: val(prefix + '-taxid'),
        registry_no: val(prefix + '-registry'),
      });
    } finally {
      if (ctx.live()) btn.disabled = false;
    }
    if (!ctx.live()) return false;
    if (!res.ok) {
      ctx.toast('danger', 'Could not save the vendor details', ctx.errMsg(res));
      return false;
    }
    upsertVendor(ctx, res.data.vendor);
    ctx.toast('success', okTitle);
    return true;
  }

  select.addEventListener('change', fillForm);
  addToggle.addEventListener('click', () => {
    newForm.hidden = !newForm.hidden;
    addToggle.textContent = newForm.hidden ? '+ Add a new vendor' : '- Cancel adding';
    addToggle.setAttribute('aria-expanded', newForm.hidden ? 'false' : 'true');
  });
  $('vsprot-vnd-new-cancel').addEventListener('click', resetNew);

  $('vsprot-vnd-modal-save').addEventListener('click', async () => {
    const name = select.value;
    if (!name) { ctx.toast('warning', 'Choose a vendor'); return; }
    if (!val('vsprot-vnd-modal-fullname')) { ctx.toast('warning', 'The full company name is required'); return; }
    const ok = await save(name, 'vsprot-vnd-modal', $('vsprot-vnd-modal-save'), 'Vendor details saved');
    if (ok) closeOverlay(ctx, el);
  });

  $('vsprot-vnd-new-save').addEventListener('click', async () => {
    const name = val('vsprot-vnd-new-name');
    if (!name) { ctx.toast('warning', 'The short name is required'); return; }
    if (!val('vsprot-vnd-new-fullname')) { ctx.toast('warning', 'The full company name is required'); return; }
    const ok = await save(name, 'vsprot-vnd-new', $('vsprot-vnd-new-save'), 'Vendor added: ' + name);
    if (!ok) return;
    resetNew();
    select.innerHTML = vendorOptions(ctx, name);
    fillForm();
    ctx.populateVendorSelect();
  });

  fillForm();
  showOverlay(ctx, el, trigger);
}

// -- Refresh and status ------------------------------------------------------------------------

const SOURCE_LABELS = {
  shards: 'monthly cost files',
  monolith: 'one cost file',
};

function fmtTs(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return null; }
}

function statusRowsHtml(st, area) {
  if (!st) return '<div class="ds-callout ds-callout--warning"><div>Could not read the costs status.</div></div>';
  const c = (st.costs && st.costs[area]) || {};
  const source = SOURCE_LABELS[c.source] || 'no cost data';
  return `<div class="ds-callout ds-callout--info"><div class="vs-rm-status-callout">
      <div class="vs-rm-status-row"><span>Area:</span><strong>${escHtml(AREA_LABELS[area] || area)}</strong></div>
      <div class="vs-rm-status-row"><span>Source:</span><strong>${escHtml(source)}</strong></div>
      <div class="vs-rm-status-row"><span>Generated:</span><strong>${fmtTs(c.generatedAt) || '—'}</strong></div>
    </div></div>`;
}

export async function openRefreshModal(ctx, trigger) {
  const area = ctx.getModalArea();
  const el = buildOverlay(ctx, {
    id: 'vs-refresh-modal',
    title: 'Refresh and status',
    bodyHtml: `<div class="vs-rm-row">
        <div class="vs-rm-row-text">
          <strong>Refresh the view</strong>
          <span>Reads the current data from disk without recomputing costs.</span>
        </div>
        <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="vs-rm-refresh-view">Refresh</button>
      </div>
      <div class="ds-callout ds-callout--info"><div>Costs (hours and rates) are produced outside this view, as files under vendor-settlements/costs/ in the team data. If the age below is too old, export them again.</div></div>
      <div id="vs-rm-status" class="vs-rm-status"></div>`,
  });
  const statusEl = el.querySelector('#vs-rm-status');
  statusEl.innerHTML = statusRowsHtml(ctx.status, area);

  el.querySelector('#vs-rm-refresh-view').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await ctx.reloadAll();
    } finally {
      if (ctx.live()) btn.disabled = false;
    }
    if (!ctx.live()) return;
    statusEl.innerHTML = statusRowsHtml(ctx.status, ctx.getModalArea());
  });
  showOverlay(ctx, el, trigger);

  // Status is cheap and may have changed since the view painted.
  const r = await ctx.api('GET', '/status');
  if (ctx.live() && r.ok && statusEl.isConnected) {
    ctx.status = r.data;
    statusEl.innerHTML = statusRowsHtml(r.data, area);
  }
}
