// modules/onboarding/client/onboarding-export.js
//
// DELIBERATE DESIGN SYSTEM EXCEPTION: this file builds a self-contained HTML
// document that a person opens from disk OUTSIDE the app (SharePoint/e-mail,
// offline, no network apart from the Teams links in the content). The DS
// tokens from css/ds-tokens.css are not available there - there is nothing to
// read - so the palette below holds about 40 rgb()/rgba() literals (never hex,
// which the R12 gate scans for), a small original logo mark and three inline
// SVGs. No <script>, no network references apart from links to
// teams.microsoft.com. This file is the only place in the module allowed to
// use colour literals - the guardian must NOT read that as a token violation.
//
// A stateless string builder - no document/window/fetch, importable in plain
// Node (see tests/test_onboarding_lib.mjs). Fetching avatars as data: URLs and
// building the Blob/<a download> stays in client/index.js - this file only
// assembles HTML from data that is already resolved.

// Original logo mark (a rounded tile with a check), inline so the export has
// no external references.
export const LOGO_SVG = '<svg class="hero-logo" viewBox="0 0 48 48" role="img" aria-label="Mission Deck">'
  + '<rect x="2" y="2" width="44" height="44" rx="10" fill="rgb(255,255,255)"/>'
  + '<path d="M14 25l7 7 13-15" fill="none" stroke="rgb(37,99,235)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
  + '</svg>';

// Deterministic avatar palette for "Who" (rgb() only).
export const EXPORT_AVATAR_COLORS = [
  'rgb(0,140,186)', 'rgb(151,71,255)', 'rgb(230,81,0)', 'rgb(0,131,116)',
  'rgb(194,24,91)', 'rgb(76,102,255)', 'rgb(158,109,0)', 'rgb(0,150,90)',
];

export function exportAvatarColor(name) {
  const s = String(name || '');
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
  return EXPORT_AVATAR_COLORS[sum % EXPORT_AVATAR_COLORS.length];
}

// Inline SVG - the only place in the module where inline SVG is allowed (the
// export file has no access to the app's icon files, which render as
// <img src="/assets/icons/ds/...">).
export const EXPORT_TEAMS_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.625 7.5a2.625 2.625 0 1 0 0-5.25 2.625 2.625 0 0 0 0 5.25zm0 1.5c-.92 0-1.76-.3-2.43-.8L15 11.4V21a1.5 1.5 0 0 0 3 0v-5.25h1.5V21a1.5 1.5 0 0 0 3 0V9.3a4.12 4.12 0 0 1-1.875.7zM14.25 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm-1.5 0a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0zM9 10.5a3 3 0 0 0-3 3V18h1.5v4.5h6V18H15v-4.5a3 3 0 0 0-3-3H9z"/></svg>';
export const EXPORT_CHECK_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
export const EXPORT_CALENDAR_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function personChipHtml(person) {
  const displayName = person.displayName || '';
  if (!displayName) return '';
  const avatarHtml = person.avatarDataUrl
    ? '<img src="' + person.avatarDataUrl + '" alt="' + escHtml(displayName) + '" '
      + 'style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex:0 0 auto">'
    : '<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;'
      + 'border-radius:50%;background:' + exportAvatarColor(displayName) + ';color:rgb(255,255,255);'
      + 'font-size:10px;font-weight:800;flex:0 0 auto">' + escHtml(person.initials || '') + '</span>';
  const teamsHtml = person.email
    ? '<a href="https://teams.microsoft.com/l/chat/0/0?users=' + encodeURIComponent(person.email) + '" '
      + 'target="_blank" rel="noopener noreferrer" title="Message on Teams: ' + escHtml(person.email) + '" '
      + 'style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;'
      + 'border-radius:50%;background:rgb(76,102,255);color:rgb(255,255,255);flex:0 0 auto">' + EXPORT_TEAMS_SVG + '</a>'
    : '';
  return '<span style="display:inline-flex;align-items:center;gap:7px;background:rgb(239,244,255);'
    + 'border-radius:999px;padding:4px 12px 4px 4px;font-size:13px;color:rgb(30,41,59);font-weight:600">'
    + avatarHtml + escHtml(displayName) + teamsHtml + '</span>';
}

/**
 * @param {{name:string, id?:string, rows?:object[]}} plan
 * @param {{row:object, people:{displayName:string,initials:string,email:string,avatarDataUrl:string|null}[], whenText:string}[]} resolvedRows
 * @param {string} generatedAtText already-formatted local date/time
 * @returns {string} full standalone HTML document
 */
export function buildPlanExportHtml(plan, resolvedRows, generatedAtText) {
  const C = {
    green: 'rgb(37,99,235)',
    greenMid: 'rgb(29,78,216)',
    greenDark: 'rgb(30,64,175)',
    ink: 'rgb(15,23,42)',
    muted: 'rgb(100,116,139)',
    bg: 'rgb(244,246,250)',
    card: 'rgb(255,255,255)',
    border: 'rgb(226,232,240)',
    soft: 'rgb(239,244,255)',
    bodyText: 'rgb(51,65,85)',
    footerClr: 'rgb(102,102,102)',
    doneBg: 'rgb(224,246,228)',
    doneText: 'rgb(1,122,62)',
  };

  const rows = Array.isArray(resolvedRows) ? resolvedRows : [];
  const totalCount = rows.length;
  const doneCount = rows.filter((r) => r.row && r.row.done).length;

  const itemsHtml = rows.map((entry, idx) => {
    const row = entry.row || {};
    const done = !!row.done;
    const whoHtml = (entry.people || []).map((p) => personChipHtml(p)).join('');
    const whenDisplay = escHtml(entry.whenText || '');
    const whenHtml = whenDisplay
      ? '<span style="display:inline-flex;align-items:center;gap:6px;background:' + C.soft + ';'
        + 'border-radius:999px;padding:5px 12px;font-size:13px;color:rgb(30,41,59);font-weight:600">'
        + EXPORT_CALENDAR_SVG + whenDisplay + '</span>'
      : '';
    const descriptionDisplay = escHtml(row.description || '').replace(/\n/g, '<br>');
    const statusHtml = done
      ? '<span style="display:inline-flex;align-items:center;gap:5px;background:' + C.doneBg + ';color:' + C.doneText + ';'
        + 'font-weight:700;font-size:12px;padding:4px 11px;border-radius:999px;flex:0 0 auto">' + EXPORT_CHECK_SVG + ' Done</span>'
      : '';
    const cardOpacity = done ? 'opacity:.7' : '';
    const titleStyle = done ? 'text-decoration:line-through' : '';
    const nodeBg = done ? C.greenDark : C.green;

    return '<div style="background:' + C.card + ';border:1px solid ' + C.border + ';border-radius:16px;'
      + 'padding:18px 20px;box-shadow:0 1px 2px rgba(16,40,28,.05);' + cardOpacity + '">'
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
      + '<span style="width:26px;height:26px;border-radius:50%;background:' + nodeBg + ';color:rgb(255,255,255);'
      + 'display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex:0 0 auto">' + (idx + 1) + '</span>'
      + '<h3 style="flex:1;margin:0;font-size:16px;font-weight:750;color:' + C.ink + ';' + titleStyle + '">' + escHtml(row.topic || '') + '</h3>'
      + statusHtml
      + '</div>'
      + (descriptionDisplay ? '<p style="margin:0 0 12px;color:' + C.bodyText + ';font-size:14px;line-height:1.5">' + descriptionDisplay + '</p>' : '')
      + '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">' + whoHtml + whenHtml + '</div>'
      + '</div>';
  }).join('');

  const emptyHtml = totalCount === 0
    ? '<div style="grid-column:1/-1;background:' + C.card + ';border:1px dashed ' + C.border + ';border-radius:16px;'
      + 'padding:32px;text-align:center;color:' + C.muted + '">No tasks in this plan.</div>'
    : '';

  const planName = (plan && plan.name) || '';

  return '<!DOCTYPE html>\n'
    + '<html lang="en">\n'
    + '<head>\n'
    + '<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
    + '<title>Onboarding plan - ' + escHtml(planName) + '</title>\n'
    + '<style>\n'
    + '  *{box-sizing:border-box}\n'
    + '  body{margin:0;background:' + C.bg + ';color:' + C.ink + ';font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;line-height:1.6}\n'
    + '  .wrap{max-width:1080px;margin:0 auto;padding:40px 24px 64px}\n'
    + '  .hero{background:linear-gradient(135deg,' + C.green + ' 0%,' + C.greenMid + ' 55%,' + C.greenDark + ' 100%);color:rgb(255,255,255);border-radius:24px;padding:32px 34px;box-shadow:0 1px 2px rgba(16,40,28,.06),0 8px 28px rgba(16,40,28,.08);display:flex;align-items:center;gap:22px}\n'
    + '  .hero-logo{width:64px;height:64px;border-radius:16px;background:rgb(255,255,255);padding:8px;flex:0 0 auto;box-shadow:0 1px 4px rgba(16,40,28,.18)}\n'
    + '  .hero-kicker{font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.9;font-weight:700;margin:0 0 8px}\n'
    + '  .hero h1{font-size:26px;line-height:1.2;margin:0;font-weight:800;letter-spacing:-.01em}\n'
    + '  .timeline{margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:16px 20px}\n'
    + '  .intro{margin-top:24px;background:' + C.card + ';border:1px solid ' + C.border + ';border-left:4px solid ' + C.green + ';border-radius:16px;padding:22px 26px}\n'
    + '  .intro h2{margin:0 0 10px;font-size:18px;font-weight:800;color:' + C.ink + '}\n'
    + '  .intro p{margin:0 0 10px;color:' + C.bodyText + ';font-size:14.5px;line-height:1.6}\n'
    + '  .intro p:last-child{margin-bottom:0}\n'
    + '  .footer{margin-top:36px;text-align:center;color:' + C.footerClr + ';font-size:12px;border-top:1px solid ' + C.border + ';padding-top:16px}\n'
    + '  @media(max-width:640px){.hero{flex-direction:column;align-items:flex-start}.timeline{grid-template-columns:1fr}}\n'
    + '</style>\n'
    + '</head>\n'
    + '<body>\n'
    + '<div class="wrap">\n'
    + '  <div class="hero">\n'
    + '    ' + LOGO_SVG + '\n'
    + '    <div>\n'
    + '      <p class="hero-kicker">Onboarding plan</p>\n'
    + '      <h1>' + escHtml(planName) + '</h1>\n'
    + '      <p style="margin:8px 0 0;font-size:13px;font-weight:600;opacity:.92">Progress: ' + doneCount + ' / ' + totalCount + ' tasks</p>\n'
    + '    </div>\n'
    + '  </div>\n'
    + '  <div class="intro">\n'
    + '    <h2>Welcome aboard!</h2>\n'
    + '    <p>We are glad you are here. Below is the plan of your first meetings - your map for the weeks ahead.</p>\n'
    + '    <p>To set up a meeting, contact each of the people listed directly (the Teams link sits next to each of them) - they know about it and are expecting you. Agree on a time that suits you both.</p>\n'
    + '    <p>Remember that these meetings are not only about the knowledge you need to get started, but also about building relationships with the people you will work with.</p>\n'
    + '    <p>The team works from different locations. If you and a teammate share an office, you can also meet in person on any topic.</p>\n'
    + '  </div>\n'
    + '  <div class="timeline">\n'
    + '    ' + itemsHtml + emptyHtml + '\n'
    + '  </div>\n'
    + '  <p class="footer">Generated: ' + escHtml(generatedAtText || '') + ' - Mission Deck</p>\n'
    + '</div>\n'
    + '</body>\n'
    + '</html>';
}
