// locations/client/locations-lib.js
// Pure functions for the Locations view - no browser document, no fetch, so
// tests/test_locations_lib.mjs can import this file directly in plain Node.

/** Escapes a value for safe insertion into HTML text content. */
export function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Thousands-separated integer ("16,574"). */
export function fmtInt(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('en-US');
}

/** Status text -> a ds-badge modifier. */
export function statusBadgeClass(status) {
  if (!status) return 'ds-badge--gray';
  const s = String(status).toLowerCase();
  if (s === 'open' || s === 'active') return 'ds-badge--green';
  if (s.startsWith('closed')) return 'ds-badge--red';
  if (s.includes('construction') || s.includes('planned')) return 'ds-badge--yellow';
  return 'ds-badge--gray';
}

/** "Street, Postal code City" - parts that are empty are left out. */
export function addressLine(loc) {
  if (!loc) return '';
  const cityPart = [loc.postal_code, loc.city].filter(Boolean).join(' ');
  return [loc.street, cityPart].filter(Boolean).join(', ');
}

/**
 * Query string for GET /directory. Empty filters are left out.
 * @param {{q?: string, status?: string, region?: string, group?: string}} filters
 */
export function buildDirectoryQuery(filters, offset, limit) {
  const params = new URLSearchParams();
  const f = filters || {};
  if (f.q && f.q.trim()) params.set('q', f.q.trim());
  if (f.status) params.set('status', f.status);
  if (f.region) params.set('region', f.region);
  if (f.group) params.set('group', f.group);
  params.set('offset', String(offset || 0));
  params.set('limit', String(limit || 60));
  return params.toString();
}

/** A map link for a coordinate pair, or '' when either is missing or invalid. */
export function mapsUrl(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (lat === null || lng === null || lat === '' || lng === '' || !Number.isFinite(la) || !Number.isFinite(ln)) return '';
  if (Math.abs(la) > 90 || Math.abs(ln) > 180 || (la === 0 && ln === 0)) return '';
  return 'https://www.openstreetmap.org/?mlat=' + la + '&mlon=' + ln + '#map=17/' + la + '/' + ln;
}

/** 'YYYY-MM-DD...' -> 'YYYY-MM-DD', anything else passes through trimmed. */
export function formatDate(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  const text = String(raw).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}

/**
 * The full card's sections: [{ title, rows: [{ label, value }] }]. Rows with
 * an empty value are left out, and a section with no rows is dropped.
 */
export function fullCardSections(loc) {
  if (!loc) return [];
  const row = (label, value) => ({ label, value: value === null || value === undefined ? '' : String(value) });
  const sections = [
    {
      title: 'Location',
      rows: [
        row('Code', loc.code),
        row('Name', loc.name),
        row('Status', loc.status),
        row('Opened', formatDate(loc.opened_at)),
        row('Sales area', loc.sales_area_m2 !== null && loc.sales_area_m2 !== undefined ? loc.sales_area_m2 + ' m2' : ''),
        row('Groups', (loc.groups || []).join(', ')),
      ],
    },
    {
      title: 'Address',
      rows: [
        row('Street', loc.street),
        row('Postal code', loc.postal_code),
        row('City', loc.city),
        row('Region', loc.region),
        row('Area', loc.area),
        row('District', loc.district),
      ],
    },
    {
      title: 'People and contact',
      rows: [
        row('Operator', loc.operator),
        row('Manager', loc.manager),
        row('Partner', loc.partner),
        row('Phone', loc.phone),
        row('Email', loc.email),
      ],
    },
  ];
  return sections
    .map((s) => ({ title: s.title, rows: s.rows.filter((r) => r.value !== '') }))
    .filter((s) => s.rows.length > 0);
}

/** Error code from GET /location -> a sentence a person reads. */
export function locationErrorMessage(status, json) {
  const code = json && json.error;
  if (code === 'bad-code') return 'Invalid location code.';
  if (code === 'directory-missing') return 'The locations directory is not in the team data yet.';
  if (code === 'location-not-found') return 'This location was not found.';
  return (json && json.message) || ('The server answered ' + status + '.');
}

/** Error answer from POST /import -> a sentence a person reads. */
export function importErrorMessage(status, json) {
  const code = json && json.error;
  if (code === 'missing-columns') return 'Required columns are missing: ' + ((json.missing || []).join(', ') || '?') + '.';
  if (code === 'header-not-found') return 'No header row with a "Code" column was found in the first 10 rows.';
  if (code === 'no-rows') return 'The file has no location rows.';
  if (code === 'bad-file-name') return 'Choose a .xlsx or .csv file.';
  if (code === 'too-large') return 'The file is too large.';
  if (code === 'busy') return 'Another import is already running.';
  if (code === 'repo-missing') return 'The team data repository is not on this computer.';
  return (json && json.message) || ('The server answered ' + status + '.');
}
