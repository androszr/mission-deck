// vendor-settlements/client/vs-lib.js
// Browser-free helpers of the view.
//
// No module-level data: the host re-imports client/index.js after a data sync
// but sibling files stay cached, so every function takes the loaded data as an
// explicit argument `data`:
//   data = {
//     costs:          { atlas, borealis, comet, delta }  costs objects (or null)
//     protocolsAll    GET /protocols-all payload
//     purchaseOrders  [{ po_number, vendor, title, amount, area? }]
//     summary         { meta, assignments }
//     vendorInfo      { meta, vendors }
//     teamMembers     canonical "First Last" names from the team directory
//   }

// -- Formatting ----------------------------------------------------------

// The currency label shown next to amounts. Change it to your own.
export const CURRENCY = 'EUR';

export function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  if (n !== Math.floor(n)) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + CURRENCY;
  }
  return Math.round(n).toLocaleString('en-US') + ' ' + CURRENCY;
}

export function fmtH(h) { return Math.round(h) + 'h'; }

export function pad2(n) { return n < 10 ? '0' + n : '' + n; }

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Example areas (teams) - rename to your own; the server keeps the same list.
export const AREAS = ['atlas', 'borealis', 'comet', 'delta'];
export const AREA_LABELS = { atlas: 'Atlas', borealis: 'Borealis', comet: 'Comet', delta: 'Delta' };

// People in the costs data carry a short vendor code in front of their name
// ("ACM Morgan Alex"); this maps a vendor to the codes that identify it.
// Example vendors - replace with your own.
export const VENDOR_NAME_PREFIXES = {
  'Acme Ltd': ['ACM'],
  'Globex': ['GLX'],
  'Initech': ['INI'],
};

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function fmtMonthLabel(yyyyMm) {
  const [y, m] = String(yyyyMm).split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function lastDayOf(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function getMonthsInRange(from, to) {
  if (!from || !to) return [];
  const months = [];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

// -- Names -------------------------------------------------------------------

const PREFIX = new Set(Object.values(VENDOR_NAME_PREFIXES).flat().map((p) => p.toLowerCase()));
const SUFFIX = new Set(['ctr']);

export function asciiLower(s) {
  if (!s) return '';
  return s
    .replace(/\u0142/g, 'l')
    .replace(/\u0141/g, 'L')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

export function nameTokens(s) {
  const cleaned = asciiLower(s).replace(/[^\w\s]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter(t => t.length >= 2);
  while (tokens.length && PREFIX.has(tokens[0])) tokens.shift();
  while (tokens.length && SUFFIX.has(tokens[tokens.length - 1])) tokens.pop();
  return new Set(tokens);
}

export function stripNameAffixes(raw) {
  let out = String(raw || '').trim();
  out = out.replace(/\s*\[[^\]]*\]\s*$/, '');
  out = out.replace(/\s+CTR$/, '');
  while (/^[A-Z0-9]{2,4}\s+\S/.test(out)) out = out.replace(/^[A-Z0-9]{2,4}\s+/, '');
  return out.trim();
}

/** Display form of a costs-data person name (never an identity key). */
export function resolvePersonDisplayName(raw, memberNames) {
  const name = String(raw || '');
  if (!name) return name;
  const pt = nameTokens(name);
  const matches = [];
  if (pt.size > 0) {
    for (const m of (memberNames || [])) {
      const mt = nameTokens(m);
      if (!mt.size) continue;
      if ([...mt].every(t => pt.has(t)) || [...pt].every(t => mt.has(t))) matches.push(m);
    }
  }
  return matches.length === 1 ? matches[0] : stripNameAffixes(name);
}

// -- Vendors -----------------------------------------------------------------

/** Permissive vendor comparison: case/space-insensitive, bidirectional prefix. */
export function vendorNameMatches(dataName, dropdownName) {
  if (!dataName || !dropdownName) return false;
  const a = String(dataName).toLowerCase().replace(/\s+/g, '');
  const b = String(dropdownName).toLowerCase().replace(/\s+/g, '');
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export function getCanonicalVendorNames(data) {
  const set = new Set(Object.keys(VENDOR_NAME_PREFIXES));
  for (const v of ((data && data.vendorInfo && data.vendorInfo.vendors) || [])) {
    if (v && v.name) set.add(v.name);
  }
  return Array.from(set);
}

export function canonicalVendor(rawName, data) {
  if (!rawName) return rawName;
  for (const c of getCanonicalVendorNames(data)) {
    if (vendorNameMatches(rawName, c)) return c;
  }
  return rawName;
}

export function vendorPrefixes(vendor) {
  if (VENDOR_NAME_PREFIXES[vendor]) return VENDOR_NAME_PREFIXES[vendor];
  const key = Object.keys(VENDOR_NAME_PREFIXES).find(k => k.toLowerCase() === (vendor || '').toLowerCase());
  return key ? VENDOR_NAME_PREFIXES[key] : [];
}

export function matchesVendor(name, prefixes) {
  // No prefix rule: a person with no company tag cannot be attributed by name.
  if (!prefixes || prefixes.length === 0) return false;
  const up = (name || '').toUpperCase();
  return prefixes.some(pfx => up.startsWith(pfx.toUpperCase()));
}

// -- Purchase orders (the order pool) --------------------------------------

/** One row per po_number, optionally narrowed to a vendor (null = all). */
export function getOrdersForVendor(purchaseOrders, vendor) {
  const byPo = new Map();
  for (const o of (purchaseOrders || [])) {
    if (!o || !o.po_number) continue;
    const vendorName = String(o.vendor || '').trim();
    if (vendor && !vendorNameMatches(vendorName, vendor)) continue;
    const existing = byPo.get(o.po_number);
    if (existing) {
      existing.order_amount += Number(o.amount) || 0;
    } else {
      byPo.set(o.po_number, {
        po_number: o.po_number,
        order_amount: Number(o.amount) || 0,
        title: o.title || '',
        vendor_name: vendorName,
        area: o.area || null,
      });
    }
  }
  return [...byPo.values()];
}

/** po_number -> area, from the order pool. */
export function buildAreaByPo(purchaseOrders) {
  const map = {};
  for (const o of (purchaseOrders || [])) {
    if (o && o.po_number && o.area && !map[o.po_number]) map[o.po_number] = o.area;
  }
  return map;
}

/**
 * The order groups offered in the form: order amount, what was already
 * settled through protocols (all areas - the balance of an order is global)
 * and what other settlements already assigned, and what is left.
 */
export function buildPoGroups(vendor, editId, data) {
  const groups = {};
  for (const c of getOrdersForVendor(data && data.purchaseOrders, vendor || null)) {
    groups[c.po_number] = {
      po_number: c.po_number,
      title: c.title,
      area: c.area,
      order_amount: c.order_amount,
      settled_amount: 0,
      assigned_amount: 0,
      protocols: [],
    };
  }
  const allProtocols = (data && data.protocolsAll && data.protocolsAll.protocols) || [];
  for (const p of allProtocols) {
    if (groups[p.po_number]) {
      groups[p.po_number].settled_amount += Number(p.amount) || 0;
      groups[p.po_number].protocols.push(p);
    }
  }
  const liveProtocolIds = new Set(allProtocols.map(p => p.id));
  for (const a of ((data && data.summary && data.summary.assignments) || [])) {
    if (a.id === editId) continue;
    if (a.protocol_id && liveProtocolIds.has(a.protocol_id)) continue;
    if (groups[a.po_number]) groups[a.po_number].assigned_amount += Number(a.amount) || 0;
  }
  return Object.values(groups).map(g => ({
    ...g,
    available: g.order_amount - g.settled_amount - g.assigned_amount,
  })).sort((a, b) => b.available - a.available);
}

/** What is left on one order, excluding the settlement being edited. null = order unknown. */
export function computeAvailableOnPo(poNumber, currentAssignmentId, data) {
  const orders = getOrdersForVendor(data && data.purchaseOrders, null).filter(c => c.po_number === poNumber);
  if (orders.length === 0) return null;
  const pool = orders.reduce((s, c) => s + c.order_amount, 0);
  const allProtocols = (data && data.protocolsAll && data.protocolsAll.protocols) || [];
  const settled = allProtocols.filter(p => p.po_number === poNumber).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const liveProtocolIds = new Set(allProtocols.map(p => p.id));
  const assigned = ((data && data.summary && data.summary.assignments) || [])
    .filter(a => a.po_number === poNumber && a.id !== currentAssignmentId
      && !(a.protocol_id && liveProtocolIds.has(a.protocol_id)))
    .reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  return pool - settled - assigned;
}

// -- Costs access ------------------------------------------------------------

export function getCostsForArea(area, data) {
  const c = (data && data.costs) || {};
  return c[area] || null;
}

export function getMonthsForArea(area, data) {
  const costsData = getCostsForArea(area, data);
  if (!costsData || !costsData.persons) return [];
  return Object.keys(costsData.persons).filter(k => /^\d{4}-\d{2}$/.test(k)).sort().reverse();
}

/**
 * Months of the "Period (month)" picker: data months plus every month of the
 * current year plus the edited settlement's month. Newest first.
 */
export function buildPeriodMonthOptions(dataMonths, currentMonth, today) {
  const months = new Set(dataMonths || []);
  const year = (today || new Date()).getFullYear();
  for (let m = 1; m <= 12; m++) months.add(`${year}-${pad2(m)}`);
  if (currentMonth) months.add(currentMonth);
  return [...months].sort().reverse();
}

export function getVendorsForArea(area, data) {
  const all = data && data.protocolsAll;
  const names = new Set();
  for (const p of ((all && all.protocols) || []).filter(x => x.area === area)) {
    if (p.vendor) names.add(p.vendor);
  }
  return Array.from(names).sort();
}

function* iterIssues(costsData) {
  for (const a of (costsData.areas || [])) {
    for (const sub of (a.subareas || [])) yield* (sub.issues || []);
  }
  for (const ep of (costsData.epics || [])) yield* (ep.issues || []);
}

// -- Item totals (per epic / per person) ------------------------------------

export function getEpicTotalsForVendor(area, vendor, from, to, data) {
  const costsData = getCostsForArea(area, data);
  if (!costsData) return new Map();
  const months = getMonthsInRange(from, to);
  const prefixes = vendorPrefixes(vendor);
  const raw = new Map();

  for (const issue of iterIssues(costsData)) {
    if (!issue.epic_key) continue;
    for (const person of (issue.persons || [])) {
      if (!matchesVendor(person.name, prefixes)) continue;
      let ph = 0, pa = 0;
      for (const m of months) {
        pa += (person.monthly && person.monthly[m]) || 0;
        ph += (person.hours_monthly && person.hours_monthly[m]) || 0;
      }
      if (pa === 0 && ph === 0) continue;
      if (!raw.has(issue.epic_key)) {
        raw.set(issue.epic_key, { name: issue.epic_name || issue.epic_key, hours: 0, amount: 0, personsMap: {} });
      }
      const entry = raw.get(issue.epic_key);
      entry.hours += ph;
      entry.amount += pa;
      if (!entry.personsMap[person.name]) entry.personsMap[person.name] = { name: person.name, hours: 0, amount: 0 };
      entry.personsMap[person.name].hours += ph;
      entry.personsMap[person.name].amount += pa;
    }
  }

  const result = new Map();
  for (const [key, entry] of raw) {
    result.set(key, {
      name: entry.name,
      hours: entry.hours,
      amount: entry.amount,
      persons: Object.values(entry.personsMap).sort((a, b) => b.amount - a.amount),
    });
  }
  return result;
}

export function getPersonTotalsForVendor(area, vendor, from, to, data) {
  const costsData = getCostsForArea(area, data);
  if (!costsData) return new Map();
  const months = getMonthsInRange(from, to);
  const prefixes = vendorPrefixes(vendor);
  const result = new Map();

  for (const m of months) {
    for (const p of ((costsData.persons && costsData.persons[m]) || [])) {
      const vendorMatch = p.company ? vendorNameMatches(p.company, vendor) : matchesVendor(p.name, prefixes);
      if (!vendorMatch) continue;
      if (!p.total_cost && !p.hours) continue;
      if (!result.has(p.name)) result.set(p.name, { hours: 0, amount: 0, epicsMap: {} });
      const entry = result.get(p.name);
      entry.hours += p.hours || 0;
      entry.amount += p.total_cost || 0;
    }
  }

  for (const issue of iterIssues(costsData)) {
    if (!issue.epic_key) continue;
    for (const person of (issue.persons || [])) {
      if (!result.has(person.name)) continue;
      let ph = 0, pa = 0;
      for (const m of months) {
        pa += (person.monthly && person.monthly[m]) || 0;
        ph += (person.hours_monthly && person.hours_monthly[m]) || 0;
      }
      if (pa === 0 && ph === 0) continue;
      const entry = result.get(person.name);
      if (!entry.epicsMap[issue.epic_key]) {
        entry.epicsMap[issue.epic_key] = { key: issue.epic_key, name: issue.epic_name || issue.epic_key, hours: 0, amount: 0 };
      }
      entry.epicsMap[issue.epic_key].hours += ph;
      entry.epicsMap[issue.epic_key].amount += pa;
    }
  }

  const final = new Map();
  for (const [name, entry] of result) {
    final.set(name, {
      hours: entry.hours,
      amount: entry.amount,
      epics: Object.values(entry.epicsMap).sort((a, b) => b.amount - a.amount),
    });
  }
  return final;
}

export function sumCostsForSelection(area, vendor, mode, items, from, to, data) {
  const costsData = getCostsForArea(area, data);
  if (!costsData) return 0;
  const months = getMonthsInRange(from, to);
  const itemSet = new Set(items);
  const prefixes = vendorPrefixes(vendor);
  let total = 0;

  if (mode === 'epics') {
    for (const issue of iterIssues(costsData)) {
      if (!itemSet.has(issue.epic_key)) continue;
      for (const person of (issue.persons || [])) {
        if (!matchesVendor(person.name, prefixes)) continue;
        for (const m of months) {
          if (person.monthly && person.monthly[m]) total += person.monthly[m];
        }
      }
    }
  } else {
    for (const m of months) {
      for (const p of ((costsData.persons && costsData.persons[m]) || [])) {
        if (itemSet.has(p.name)) total += p.total_cost || 0;
      }
    }
  }
  return total;
}

// -- Protocol generator -----------------------------------------------------

/** Split customAmount over persons by total_cost (equally when all are 0). */
export function distributeAmountToPersons(persons, customAmount) {
  if (!Array.isArray(persons) || persons.length === 0 || !customAmount) return [];
  const totalCost = persons.reduce((s, p) => s + Number(p.total_cost || 0), 0);
  if (totalCost > 0) {
    return persons.map(p => ({ ...p, amount: Number(((Number(p.total_cost) / totalCost) * customAmount).toFixed(2)) }));
  }
  const equal = Number((customAmount / persons.length).toFixed(2));
  return persons.map(p => ({ ...p, amount: equal }));
}

/** null = no costs for the area; else the persons of the company in that month. */
export function getPersonsForStep3(area, company, month, data) {
  const costsData = getCostsForArea(area, data);
  if (!costsData || !costsData.persons) return null;
  return (costsData.persons[month] || []).filter(p => vendorNameMatches(p.company, company));
}

/** Canonical team member names for display-name resolution. */
export function teamMemberNames(data) {
  const members = data && data.teamMembers;
  return Array.isArray(members) ? members.filter(m => typeof m === 'string' && m) : [];
}

// -- Amount parsing ----------------------------------------------------------

/**
 * Parse a typed amount: "1 234,56", "1.234,56", "1,234.56", "1234.56", "-500",
 * with spaces / nbsp as thousands separators and an optional currency suffix.
 * Returns a finite number, or null for an empty string and for anything that
 * is not clearly an amount (never a guess).
 */
export function parseAmountInput(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/[\s\u00a0\u202f]/g, '').replace(/\u2212/g, '-');
  s = s.replace(/(eur|usd|gbp|pln)$/i, '');
  if (!s) return null;
  let sign = 1;
  if (s[0] === '-' || s[0] === '+') {
    if (s[0] === '-') sign = -1;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/^\d/.test(s) || /[.,]$/.test(s)) return null;
  const commas = (s.match(/,/g) || []).length;
  const dots = (s.match(/\./g) || []).length;
  let intPart;
  let frac = '';
  if (commas && dots) {
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const thou = dec === ',' ? '.' : ',';
    const decCount = dec === ',' ? commas : dots;
    if (decCount !== 1) return null;
    const idx = s.lastIndexOf(dec);
    intPart = s.slice(0, idx);
    frac = s.slice(idx + 1);
    if (!new RegExp('^\\d{1,3}(\\' + thou + '\\d{3})+$').test(intPart)) return null;
    intPart = intPart.split(thou).join('');
  } else if (commas || dots) {
    const sep = commas ? ',' : '.';
    const count = commas || dots;
    if (count === 1) {
      const idx = s.indexOf(sep);
      intPart = s.slice(0, idx);
      frac = s.slice(idx + 1);
    } else if (sep === '.' && /^\d{1,3}(\.\d{3})+$/.test(s)) {
      intPart = s.split('.').join('');
    } else if (sep === ',' && /^\d{1,3}(,\d{3})+$/.test(s)) {
      intPart = s.split(',').join('');
    } else {
      return null;
    }
  } else {
    intPart = s;
  }
  if (!/^\d+$/.test(intPart) || (frac && !/^\d+$/.test(frac))) return null;
  const n = Number(intPart + (frac ? '.' + frac : ''));
  return Number.isFinite(n) ? sign * n : null;
}
