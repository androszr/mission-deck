// demo/mocks/ch-summary.mjs
// Painters for chapter `summary`: pure (props) => htmlString, DS classes only.
// The closing board: one ds-card tile per chapter with that chapter's
// signature Pip pose, painted on a full-screen surface. Order from
// CHAPTER_ORDER, title and pose from demo/chapter-cards.mjs (never from
// demo/scenario.mjs, which imports the chapter files).

import { esc } from './common.mjs';
import { CHAPTER_ORDER } from '../scenario-schema.mjs';
import { MASCOT_GEOMETRY, MASCOT_HIDDEN_POSES } from '../mascot-geometry.mjs';
import { CHAPTERS } from '../chapter-cards.mjs';
import { activeTrackChapterIds } from '../tracks.mjs';

/** The chapters the board shows, in presentation order (every one but itself). */
export const PODSUMOWANIE_IDS = CHAPTER_ORDER.filter((id) => id !== 'summary' && CHAPTERS[id]);

/**
 * Pip cropped to his figure, the way demo/main.mjs frames the narrator: the
 * poses sit on a padded canvas, so the <img> is offset inside a clipping box.
 */
function _mascot(pose) {
  const src = '/assets/mascot/pip-' + esc(pose) + '.svg';
  const geo = MASCOT_GEOMETRY[pose];
  if (!geo) return '<span class="podsumowanie-tile-mascot"><img src="' + src + '" alt="" aria-hidden="true"></span>';
  const [vx, vy, vw, vh] = geo.vb;
  const [bx, by, bw, bh] = geo.box;
  const k = Math.min(100 / bw, 46 / bh);
  const px = (v) => Math.round(v * k) + 'px';
  return '<span class="podsumowanie-tile-mascot" style="width:' + px(bw) + ';height:' + px(bh) + '">'
    + '<img src="' + src + '" alt="" aria-hidden="true" style="width:' + px(vw) + ';height:' + px(vh)
    + ';margin-left:' + px(vx - bx) + ';margin-top:' + px(vy - by) + '"></span>';
}

/** The chapters of the ACTIVE track (Short or Full), in order; the board counts and numbers within it. */
function _shown() {
  const track = activeTrackChapterIds();
  return track ? track.filter((id) => id !== 'summary' && CHAPTERS[id]) : PODSUMOWANIE_IDS;
}

function _tile(id) {
  const shown = _shown();
  if (!shown.includes(id)) return '';
  const card = CHAPTERS[id] || { title: id, mascot: 'success' };
  const title = card.title;
  // A tile must show the figure: a pose that hides it gives way to
  // the chapter's second pose.
  const pose = MASCOT_HIDDEN_POSES.includes(card.mascot) && card.pose ? card.pose : card.mascot;
  const n = shown.indexOf(id) + 1;
  return '<div class="ds-card podsumowanie-tile" id="podsumowanie-tile-' + esc(id) + '">'
    + _mascot(pose)
    + '<span class="podsumowanie-tile-num">' + n + '</span>'
    + '<span class="podsumowanie-tile-title">' + esc(title) + '</span></div>';
}

/** "1 chapter", "33 chapters". */
function _chapters(n) {
  return n + (n === 1 ? ' chapter' : ' chapters');
}

function _board() {
  const shown = _shown();
  return '<div class="podsumowanie-board">'
    + '<div class="podsumowanie-head"><div class="podsumowanie-wordmark">Mission Deck</div>'
    + '<h1 class="podsumowanie-title">How we work with Mission Deck</h1>'
    + '<p class="podsumowanie-sub">' + _chapters(shown.length) + ' — from the first start to your own modules.</p></div>'
    + '<div class="podsumowanie-grid" id="podsumowanie-grid" style="--podsumowanie-cols:' + Math.ceil(shown.length / 3) + '"></div>'
    + '<div class="podsumowanie-closing" id="podsumowanie-closing" hidden>'
    + '<p class="podsumowanie-closing-line">One place for team data, modules, prototypes and skills — with Claude Code at hand at every step.</p>'
    + '<p class="podsumowanie-thanks">Thank you for coming with me all the way!</p></div>'
    + '</div>';
}

export const MOCKS = {
  /** The closing board, empty grid (surface: 'screen'). */
  'podsumowanie-board': () => _board(),
  /** One chapter tile. props: { id } */
  'podsumowanie-tile': ({ id = 'start' } = {}) => _tile(id),
};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'How we work with Mission Deck', 'chapter', 'chapters', '— from the first start to your own modules.',
  'One place for team data, modules, prototypes and skills — with Claude Code at hand at every step.',
  'Thank you for coming with me all the way!',
  ...PODSUMOWANIE_IDS.map((id) => CHAPTERS[id].title),
];
