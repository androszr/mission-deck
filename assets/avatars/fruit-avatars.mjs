// assets/avatars/fruit-avatars.mjs
//
// Made-up people get made-up faces: every avatar of the sample team, of
// Mini Deck's demo data and of the demo walkthrough is a fruit with a face, never initials in a circle
// and never a photo of somebody real. Twelve fruits on eight soft
// backgrounds; fruitAvatarSvg(i) is a pure function of the index, so the
// generators that call it stay deterministic. fruitFaceFor(name) picks by a
// hash of the name, so one person keeps one fruit across every demo chapter.
//
// ONE copy: the demo imports it directly, scripts/_fruit-avatars.js
// re-exports it for the Node generators.
//
// The SVG is square and fills its whole box: every place that shows an
// avatar already clips it to a circle.

export const BACKGROUNDS = ['#fde8d7', '#e2f2e6', '#e4ecfb', '#f8e3ee', '#fff3cc', '#e9e4f8', '#dff3f3', '#f3ead9'];

const INK = '#3b2a20';

function face(cx, cy, scale, ink) {
  const s = scale || 1;
  const col = ink || INK;
  const ex = 7 * s;
  const er = 3.2 * s;
  return '<circle cx="' + (cx - ex) + '" cy="' + cy + '" r="' + er + '" fill="' + col + '"/>'
    + '<circle cx="' + (cx + ex) + '" cy="' + cy + '" r="' + er + '" fill="' + col + '"/>'
    + '<circle cx="' + (cx - ex - 5 * s) + '" cy="' + (cy + 6 * s) + '" r="' + (3.4 * s) + '" fill="#ff8a8a" opacity="0.45"/>'
    + '<circle cx="' + (cx + ex + 5 * s) + '" cy="' + (cy + 6 * s) + '" r="' + (3.4 * s) + '" fill="#ff8a8a" opacity="0.45"/>'
    + '<path d="M' + (cx - 5 * s) + ' ' + (cy + 6 * s) + ' Q' + cx + ' ' + (cy + 11 * s) + ' ' + (cx + 5 * s) + ' ' + (cy + 6 * s)
    + '" fill="none" stroke="' + col + '" stroke-width="' + (2.4 * s) + '" stroke-linecap="round"/>';
}

const leaf = (d, fill) => '<path d="' + d + '" fill="' + (fill || '#4caf50') + '"/>';
const stem = (d) => '<path d="' + d + '" fill="none" stroke="#6d4c33" stroke-width="3.5" stroke-linecap="round"/>';

// Each fruit draws its body and returns where its face goes.
export const FRUITS = [
  {
    id: 'apple',
    body: '<path d="M48 30 C36 22 18 28 18 50 C18 70 32 84 42 84 C45 84 46 82 48 82 C50 82 51 84 54 84 C64 84 78 70 78 50 C78 28 60 22 48 30 Z" fill="#e5483f"/>'
      + '<path d="M28 44 C30 36 36 33 40 33" fill="none" stroke="#ff8f86" stroke-width="4" stroke-linecap="round"/>'
      + stem('M48 31 C48 24 50 18 53 14') + leaf('M52 22 C58 12 70 12 72 16 C66 24 58 25 52 22 Z'),
    face: [48, 56, 1],
  },
  {
    id: 'orange',
    body: '<circle cx="48" cy="54" r="30" fill="#f7942e"/>'
      + '<circle cx="38" cy="42" r="2" fill="#ffc07a"/><circle cx="60" cy="40" r="2" fill="#ffc07a"/><circle cx="66" cy="62" r="2" fill="#ffc07a"/>'
      + leaf('M48 25 C52 14 64 12 68 15 C64 24 55 27 48 25 Z'),
    face: [48, 56, 1],
  },
  {
    id: 'pear',
    body: '<path d="M48 22 C40 22 38 32 38 40 C38 46 24 54 24 66 C24 80 36 86 48 86 C60 86 72 80 72 66 C72 54 58 46 58 40 C58 32 56 22 48 22 Z" fill="#a8cf45"/>'
      + stem('M48 23 C48 18 49 14 51 11') + leaf('M50 18 C56 10 66 11 67 14 C62 20 55 21 50 18 Z'),
    face: [48, 64, 1],
  },
  {
    id: 'lemon',
    body: '<path d="M14 54 C14 40 30 28 48 28 C66 28 82 40 82 54 C82 68 66 80 48 80 C30 80 14 68 14 54 Z" fill="#ffd93b"/>'
      + '<path d="M10 54 L16 50 L16 58 Z" fill="#f2c200"/><path d="M86 54 L80 50 L80 58 Z" fill="#f2c200"/>'
      + leaf('M48 29 C52 20 62 18 66 21 C62 28 55 30 48 29 Z'),
    face: [48, 54, 1],
  },
  {
    id: 'strawberry',
    body: '<path d="M20 40 C20 30 34 28 48 32 C62 28 76 30 76 40 C76 60 60 84 48 86 C36 84 20 60 20 40 Z" fill="#e8384f"/>'
      + '<g fill="#ffe08a"><ellipse cx="32" cy="46" rx="1.6" ry="2.4"/><ellipse cx="64" cy="46" rx="1.6" ry="2.4"/><ellipse cx="38" cy="70" rx="1.6" ry="2.4"/><ellipse cx="58" cy="70" rx="1.6" ry="2.4"/><ellipse cx="48" cy="78" rx="1.6" ry="2.4"/><ellipse cx="28" cy="58" rx="1.6" ry="2.4"/><ellipse cx="68" cy="58" rx="1.6" ry="2.4"/></g>'
      + '<path d="M28 34 L36 24 L42 32 L48 20 L54 32 L60 24 L68 34 C60 38 36 38 28 34 Z" fill="#3fa34d"/>',
    face: [48, 52, 1],
  },
  {
    id: 'cherry',
    body: stem('M34 52 C38 34 50 20 62 14') + stem('M66 58 C66 40 64 26 62 14') + leaf('M60 16 C66 8 78 10 80 13 C74 20 66 20 60 16 Z')
      + '<circle cx="66" cy="66" r="15" fill="#b3122e"/>'
      + '<circle cx="36" cy="62" r="22" fill="#d01c3a"/><path d="M24 54 C26 48 30 46 34 45" fill="none" stroke="#ff7b8e" stroke-width="3.5" stroke-linecap="round"/>',
    face: [36, 63, 0.85],
  },
  {
    id: 'watermelon',
    body: '<circle cx="48" cy="54" r="31" fill="#2e8b3e"/>'
      + '<path d="M48 23 C40 38 40 70 48 85 M34 27 C26 42 26 66 34 81 M62 27 C70 42 70 66 62 81" fill="none" stroke="#1f6b2c" stroke-width="5" stroke-linecap="round"/>'
      + '<circle cx="48" cy="56" r="17" fill="#7cc576"/>',
    face: [48, 55, 1],
  },
  {
    id: 'peach',
    body: '<path d="M48 30 C30 24 16 38 18 56 C20 74 34 84 48 84 C62 84 76 74 78 56 C80 38 66 24 48 30 Z" fill="#ffab7a"/>'
      + '<path d="M48 31 C42 44 42 64 46 80" fill="none" stroke="#f28a5b" stroke-width="3" stroke-linecap="round"/>'
      + leaf('M48 30 C44 18 34 14 30 17 C34 26 42 30 48 30 Z', '#5cb85c'),
    face: [56, 58, 0.9],
  },
  {
    id: 'kiwi',
    body: '<circle cx="48" cy="54" r="31" fill="#8a6a3f"/><circle cx="48" cy="54" r="26" fill="#9fd24b"/>'
      + '<circle cx="48" cy="54" r="9" fill="#f2f7c9"/>'
      + '<g fill="#2d2416"><ellipse cx="48" cy="38" rx="1.4" ry="2.4"/><ellipse cx="34" cy="46" rx="2.4" ry="1.4"/><ellipse cx="62" cy="46" rx="2.4" ry="1.4"/><ellipse cx="34" cy="66" rx="2.4" ry="1.4"/><ellipse cx="62" cy="66" rx="2.4" ry="1.4"/><ellipse cx="48" cy="72" rx="1.4" ry="2.4"/></g>',
    face: [48, 52, 0.75],
  },
  {
    id: 'plum',
    body: '<path d="M48 26 C30 26 18 40 18 56 C18 74 32 86 48 86 C64 86 78 74 78 56 C78 40 66 26 48 26 Z" fill="#7b3fa0"/>'
      + '<path d="M50 28 C46 44 46 66 50 84" fill="none" stroke="#5f2c80" stroke-width="3" stroke-linecap="round"/>'
      + '<path d="M28 46 C30 40 34 36 38 35" fill="none" stroke="#b07ad1" stroke-width="3.5" stroke-linecap="round"/>'
      + stem('M48 27 C48 20 50 16 53 13'),
    face: [40, 58, 0.9, '#fbeaff'],
  },
  {
    id: 'pineapple',
    body: '<path d="M40 30 L34 10 L44 22 L48 6 L52 22 L62 10 L56 30 Z" fill="#3fa34d"/>'
      + '<ellipse cx="48" cy="60" rx="24" ry="28" fill="#f8c23a"/>'
      + '<path d="M28 46 L60 86 M36 36 L70 76 M68 46 L36 86 M60 36 L26 76" fill="none" stroke="#dd9a1e" stroke-width="2.4" stroke-linecap="round"/>'
      + '<ellipse cx="48" cy="62" rx="15" ry="11" fill="#f8c23a"/>',
    face: [48, 59, 0.9],
  },
  {
    id: 'avocado',
    body: '<path d="M48 14 C38 14 34 28 30 40 C22 52 20 62 22 70 C26 82 36 88 48 88 C60 88 70 82 74 70 C76 62 74 52 66 40 C62 28 58 14 48 14 Z" fill="#3d6b2c"/>'
      + '<path d="M48 20 C41 20 38 32 35 42 C28 53 27 62 28 69 C31 79 39 83 48 83 C57 83 65 79 68 69 C69 62 68 53 61 42 C58 32 55 20 48 20 Z" fill="#cde58a"/>'
      + '<circle cx="48" cy="66" r="11" fill="#9a6a3a"/>',
    face: [48, 45, 0.8],
  },
];

/**
 * One fruit avatar. `index` picks the fruit (cycling through all twelve
 * before any repeats) and the background, so neighbours never look alike.
 * @param {number} index
 * @param {string} label accessible name, e.g. the person's full name
 * @returns {string} an SVG document, newline-terminated
 */
export function fruitAvatarSvg(index, label) {
  const i = Math.abs(Math.trunc(Number(index) || 0));
  const fruit = FRUITS[i % FRUITS.length];
  const bg = BACKGROUNDS[(i * 3 + Math.floor(i / FRUITS.length)) % BACKGROUNDS.length];
  const safe = String(label || fruit.id).replace(/[&<>"]/g, '');
  const [fx, fy, fs, ink] = fruit.face;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="' + safe + '">'
    + '<rect width="96" height="96" fill="' + bg + '"/>'
    + fruit.body + face(fx, fy, fs, ink)
    + '</svg>\n';
}

/** FNV-1a over the name: a stable index for a person the data gives no number. */
function nameIndex(name) {
  let h = 0x811c9dc5;
  for (const ch of String(name || '')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % (FRUITS.length * BACKGROUNDS.length);
}

/**
 * The fruit avatar of a named person, as inline SVG markup for an avatar slot.
 * @param {string} name
 * @returns {string}
 */
export function fruitFaceFor(name) {
  return fruitAvatarSvg(nameIndex(name), name).trim();
}
