// modules/usage-analytics/client/lib/format.js
// Pure formatting helpers - no document/window, importable in bare Node.

export function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function fmtInt(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

/** Milliseconds -> "2 min 05 s" / "45 s" / "1 h 02 min"; "—" when missing. */
export function fmtDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min ' + String(s % 60).padStart(2, '0') + ' s';
  const h = Math.floor(m / 60);
  return h + ' h ' + String(m % 60).padStart(2, '0') + ' min';
}

/** 'YYYY-MM-DD' -> 'D.MM.YYYY'. */
export function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '—';
  return Number(m[3]) + '.' + m[2] + '.' + m[1];
}

/** 'YYYY-MM-DD' -> 'D.MM' (short, for axes and the period label). */
export function fmtDayShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '—';
  return Number(m[3]) + '.' + m[2];
}

/** 'YYYY-MM-DD HH:MM:SS' -> 'D.MM.YYYY HH:MM'. */
export function fmtStamp(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(s || ''));
  if (!m) return '—';
  return fmtDay(m[1]) + ' ' + m[2];
}

/** ISO instant -> local 'D.MM.YYYY HH:MM'. */
export function fmtLocal(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return d.getDate() + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear()
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

export function initialsOf(name) {
  const parts = String(name || '').replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0][0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

/** Short label for a version hash: first 7 chars or "—". */
export function fmtHash(h) {
  return h ? String(h).slice(0, 7) : '—';
}
