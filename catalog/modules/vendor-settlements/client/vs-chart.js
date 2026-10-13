// vendor-settlements/client/vs-chart.js
// "Costs vs accepted" per-vendor bar chart.
//
// The compute functions are pure: they take the loaded `data` (see vs-lib.js
// for its shape). UI state (area, month, hidden vendors) lives in the closure
// of initSettlementsChart(), never at module level - the host re-imports the
// view after a data sync while this sibling file stays cached.

import {
  VENDOR_NAME_PREFIXES, fmtMonthLabel, escHtml,
  vendorNameMatches, getCanonicalVendorNames, canonicalVendor,
  getCostsForArea, matchesVendor,
} from './vs-lib.js';

// -- Pure computation --------------------------------------------------------

/** Default month: the previous one until the 10th, then the current one. */
export function defaultMonth() {
  const d = new Date();
  const day = d.getDate();
  let y, m;
  if (day < 10) {
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    y = prev.getFullYear();
    m = prev.getMonth() + 1;
  } else {
    y = d.getFullYear();
    m = d.getMonth() + 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Distinct, canonicalised vendor names offered for an area. */
export function collectVendors(area, data) {
  const costsData = getCostsForArea(area, data);
  const names = new Set(getCanonicalVendorNames(data));
  // A company spelled differently in the costs data collapses into its
  // canonical name instead of adding a bar.
  if (costsData && costsData.persons) {
    for (const entries of Object.values(costsData.persons)) {
      for (const p of (entries || [])) {
        if (p.company) names.add(canonicalVendor(p.company, data));
      }
    }
  }
  for (const o of ((data && data.purchaseOrders) || [])) {
    if (o && o.vendor) names.add(canonicalVendor(String(o.vendor), data));
  }
  return Array.from(names).sort();
}

/** [{ vendor, costs, accepted }] for one area and month. */
export function computeBarsForMonth(area, month, data) {
  const costsData = getCostsForArea(area, data);
  const vendors = collectVendors(area, data);
  const personsForMonth = (costsData && costsData.persons && costsData.persons[month]) || [];

  // Accepted: the protocols of the month per vendor; an area without a
  // protocols file of its own (comet) uses its settlements instead.
  const acceptedByVendor = {};
  if (area === 'comet') {
    const assignments = (data && data.summary && data.summary.assignments) || [];
    for (const a of assignments) {
      if (a.area === 'comet' && a.period_from && a.period_from.slice(0, 7) === month && a.vendor) {
        const key = canonicalVendor(a.vendor, data);
        acceptedByVendor[key] = (acceptedByVendor[key] || 0) + (Number(a.amount) || 0);
      }
    }
  } else {
    const allProtocols = (data && data.protocolsAll && data.protocolsAll.protocols) || [];
    for (const p of allProtocols) {
      if (p.area === area && p.settlement_month === month && p.vendor) {
        const key = canonicalVendor(p.vendor, data);
        acceptedByVendor[key] = (acceptedByVendor[key] || 0) + (Number(p.amount) || 0);
      }
    }
  }

  return vendors.map(vendor => {
    const prefixes = VENDOR_NAME_PREFIXES[vendor] || [];
    let costs = 0;
    for (const p of personsForMonth) {
      const matchByCompany = p.company && vendorNameMatches(p.company, vendor);
      const matchByPrefix = !p.company && matchesVendor(p.name, prefixes);
      if (matchByCompany || matchByPrefix) costs += p.total_cost || 0;
    }
    return { vendor, costs, accepted: acceptedByVendor[vendor] || 0 };
  });
}

// -- SVG ----------------------------------------------------------------------

function escSvgText(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtShort(val) {
  if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return (val / 1000).toFixed(0) + 'k';
  return val.toFixed(0);
}

/** Two bars per vendor; `containerW` is the pixel width of the chart box. */
export function renderChartSvg(bars, containerW) {
  if (!bars || bars.length === 0) return '';

  const padLeft = 60;
  const padRight = 20;
  const padTop = 64;
  const padBottom = 64;
  const chartH = 220;
  const barW = 30;
  const gap = 6;

  const width = containerW > 100 ? containerW : 800;
  const availableW = width - padLeft - padRight;
  const groupW = Math.max(70, Math.floor(availableW / bars.length));

  const maxVal = bars.reduce((mx, b) => Math.max(mx, b.costs, b.accepted), 0);
  const effectiveMax = maxVal > 0 ? maxVal : 1;

  const totalW = padLeft + bars.length * groupW + padRight;
  const totalH = padTop + chartH + padBottom;
  const barHeight = (val) => Math.round((val / effectiveMax) * chartH);

  let paths = '';
  for (let i = 0; i < bars.length; i++) {
    const { vendor, costs, accepted } = bars[i];
    const gx = padLeft + i * groupW;
    const kH = barHeight(costs);
    const kY = padTop + chartH - kH;
    const pH = barHeight(accepted);
    const pY = padTop + chartH - pH;
    const pX = gx + barW + gap;
    const kVal = costs.toFixed(2);
    const pVal = accepted.toFixed(2);

    paths += `<g data-vendor="${escHtml(vendor)}" data-type="costs">`;
    paths += `<rect class="vs-chart-bar-costs" x="${gx}" y="${kY}" width="${barW}" height="${kH}" rx="2"/>`;
    if (costs > 0) {
      paths += `<text class="vs-chart-label" x="${gx + barW / 2}" y="${kY - 22}" text-anchor="middle" font-size="10">${fmtShort(costs)}</text>`;
      paths += `<foreignObject x="${gx + barW / 2 - 10}" y="${kY - 20}" width="20" height="18">`;
      paths += `<button xmlns="http://www.w3.org/1999/xhtml" type="button" class="ds-icon-btn ds-icon-btn--sm vs-chart-copy-btn" data-value="${kVal}" title="Copy the costs amount" aria-label="Copy the costs amount">&#x29C9;</button>`;
      paths += '</foreignObject>';
    }
    paths += '</g>';

    paths += `<g data-vendor="${escHtml(vendor)}" data-type="accepted">`;
    paths += `<rect class="vs-chart-bar-accepted" x="${pX}" y="${pY}" width="${barW}" height="${pH}" rx="2"/>`;
    if (accepted > 0) {
      paths += `<text class="vs-chart-label" x="${pX + barW / 2}" y="${pY - 22}" text-anchor="middle" font-size="10">${fmtShort(accepted)}</text>`;
      paths += `<foreignObject x="${pX + barW / 2 - 10}" y="${pY - 20}" width="20" height="18">`;
      paths += `<button xmlns="http://www.w3.org/1999/xhtml" type="button" class="ds-icon-btn ds-icon-btn--sm vs-chart-copy-btn" data-value="${pVal}" title="Copy the accepted amount" aria-label="Copy the accepted amount">&#x29C9;</button>`;
      paths += '</foreignObject>';
    }
    paths += '</g>';

    const labelX = gx + barW + gap / 2;
    const labelY = padTop + chartH + 18;
    const rotate = bars.length > 8 ? `rotate(-25, ${labelX}, ${labelY})` : '';
    paths += `<text class="vs-chart-label" x="${labelX}" y="${labelY}" text-anchor="${bars.length > 8 ? 'end' : 'middle'}" font-size="10" transform="${rotate}">${escSvgText(vendor)}</text>`;

    if (i < bars.length - 1) {
      const lx = gx + groupW - 4;
      paths += `<line class="vs-chart-sep" x1="${lx}" y1="${padTop}" x2="${lx}" y2="${padTop + chartH}"/>`;
    }
  }

  const baseY = padTop + chartH;
  paths += `<line class="vs-chart-axis" x1="${padLeft - 8}" y1="${baseY}" x2="${totalW - padRight}" y2="${baseY}"/>`;
  paths += `<line class="vs-chart-axis" x1="${padLeft - 8}" y1="${padTop}" x2="${padLeft - 8}" y2="${baseY}"/>`;

  const lgY = 8;
  const lgX = padLeft;
  paths += `<rect x="${lgX}" y="${lgY}" width="12" height="10" rx="2" class="vs-chart-bar-costs"/>`;
  paths += `<text class="vs-chart-label" x="${lgX + 16}" y="${lgY + 9}" font-size="10">Costs</text>`;
  paths += `<rect x="${lgX + 70}" y="${lgY}" width="12" height="10" rx="2" class="vs-chart-bar-accepted"/>`;
  paths += `<text class="vs-chart-label" x="${lgX + 86}" y="${lgY + 9}" font-size="10">Accepted</text>`;

  return `<svg class="vs-chart-svg" viewBox="0 0 ${totalW} ${totalH}" width="100%" preserveAspectRatio="xMinYMid meet">${paths}</svg>`;
}

// -- UI (state in the closure) ---------------------------------------------------

/**
 * @param {object} opts
 * @param {() => object} opts.getData      accessor of the loaded data (vs-lib shape)
 * @param {() => string} [opts.getModalArea]
 * @param {(area: string) => void} opts.setModalArea  switches the form below
 * @param {(variant: string, title: string, desc?: string) => void} opts.showToast
 * @returns {{ render: Function, syncArea: Function, destroy: Function }}
 */
export function initSettlementsChart(opts) {
  const { getData, getModalArea, setModalArea, showToast } = opts;
  const st = {
    area: (getModalArea && getModalArea()) || 'atlas',
    month: defaultMonth(),
    hiddenVendors: new Set(),
  };
  const teardown = [];
  const listen = (target, type, fn) => {
    if (!target) return;
    target.addEventListener(type, fn);
    teardown.push(() => target.removeEventListener(type, fn));
  };

  function renderToolbar() {
    const data = getData();
    const costsData = getCostsForArea(st.area, data);

    const periodSel = document.getElementById('vs-chart-period');
    if (periodSel) {
      const months = costsData && costsData.persons
        ? Object.keys(costsData.persons).filter(k => /^\d{4}-\d{2}$/.test(k)).sort().reverse()
        : [];
      periodSel.innerHTML = months.map(m => (
        `<option value="${m}"${m === st.month ? ' selected' : ''}>${escHtml(fmtMonthLabel(m))}</option>`
      )).join('');
      if (months.length > 0) {
        if (months.includes(st.month)) {
          periodSel.value = st.month;
        } else {
          // The default month is not in the data: first available month.
          st.month = months[0];
          periodSel.value = months[0];
        }
      }
    }

    document.querySelectorAll('#vs-chart-section .vs-chart-area-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.area === st.area);
    });

    const vendorMenu = document.getElementById('vs-chart-vendor-menu');
    if (vendorMenu) {
      vendorMenu.innerHTML = collectVendors(st.area, data).map(v => {
        const checked = !st.hiddenVendors.has(v);
        return `<label class="vs-chart-vendor-item"><input type="checkbox" data-vendor="${escHtml(v)}"${checked ? ' checked' : ''}> ${escHtml(v)}</label>`;
      }).join('');
    }
  }

  function render() {
    const chartRoot = document.getElementById('vs-chart-root');
    const chartEmpty = document.getElementById('vs-chart-empty');
    if (!chartRoot) return;
    renderToolbar();

    if (!st.month) {
      chartRoot.innerHTML = '';
      if (chartEmpty) { chartEmpty.hidden = false; chartEmpty.textContent = 'Choose a month.'; }
      return;
    }

    const bars = computeBarsForMonth(st.area, st.month, getData())
      .filter(b => !st.hiddenVendors.has(b.vendor))
      .filter(b => b.costs > 0 || b.accepted > 0);

    if (bars.length === 0) {
      chartRoot.innerHTML = '';
      if (chartEmpty) {
        chartEmpty.hidden = false;
        chartEmpty.textContent = 'No data for the chosen month and area.';
      }
      return;
    }
    if (chartEmpty) chartEmpty.hidden = true;
    chartRoot.innerHTML = renderChartSvg(bars, chartRoot.clientWidth);
  }

  /** The form below changed its area: follow it without calling it back. */
  function syncArea(area) {
    if (st.area === area) return;
    st.area = area;
    st.hiddenVendors = new Set();
    render();
  }

  const section = document.getElementById('vs-chart-section');
  listen(section, 'click', (e) => {
    const areaBtn = e.target.closest('.vs-chart-area-btn');
    if (areaBtn) {
      st.area = areaBtn.dataset.area;
      st.hiddenVendors = new Set();
      if (setModalArea) setModalArea(st.area);
      render();
      return;
    }
    const copyBtn = e.target.closest('.vs-chart-copy-btn');
    if (copyBtn) {
      e.stopPropagation();
      navigator.clipboard.writeText(copyBtn.dataset.value).then(
        () => showToast('success', 'Amount copied'),
        () => showToast('warning', 'Could not copy'),
      );
      return;
    }
    const toggle = e.target.closest('#vs-chart-vendor-toggle');
    const menu = document.getElementById('vs-chart-vendor-menu');
    if (toggle && menu) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      toggle.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
    }
  });
  listen(section, 'change', (e) => {
    if (e.target.id === 'vs-chart-period') {
      st.month = e.target.value;
      render();
      return;
    }
    const chk = e.target.closest('#vs-chart-vendor-menu input[type="checkbox"]');
    if (chk) {
      if (chk.checked) st.hiddenVendors.delete(chk.dataset.vendor);
      else st.hiddenVendors.add(chk.dataset.vendor);
      render();
    }
  });
  // Click outside closes the vendor menu.
  listen(document, 'click', (e) => {
    const menu = document.getElementById('vs-chart-vendor-menu');
    const toggle = document.getElementById('vs-chart-vendor-toggle');
    if (menu && toggle && !toggle.contains(e.target) && !menu.contains(e.target)) menu.hidden = true;
  });

  render();

  // The section is hidden at init time (clientWidth 0): re-render once it has
  // a real width.
  const rootEl = document.getElementById('vs-chart-root');
  if (rootEl && typeof ResizeObserver !== 'undefined') {
    let prevW = 0;
    const ro = new ResizeObserver(entries => {
      const w = Math.round((entries[0] && entries[0].contentRect.width) || 0);
      if (w > 0 && w !== prevW) {
        prevW = w;
        render();
      }
    });
    ro.observe(rootEl);
    teardown.push(() => ro.disconnect());
  }

  return {
    render,
    syncArea,
    destroy() {
      while (teardown.length) teardown.pop()();
    },
  };
}
