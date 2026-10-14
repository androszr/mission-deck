// demo/main.mjs
// Boot of the presentation page: load the real shell, build both surfaces,
// the cursor and the engine, then wire the ONLY controls the presenter has -
// Enter / Space / ArrowRight (next, or finish the step now), ArrowLeft (back),
// the chapter list ("Spis tresci"), the presentation / tutorial switch and
// the track switch ("Wersja": short or full, demo/tracks.mjs). The track
// lives only in the hash (`#short:<chapter>/<n>`, no prefix = full).
// The scene itself is inert and covered by a click-swallowing shield.
// A thin step progress bar on the top edge of the bottom bar tells the
// presenter when the step has finished and Enter is due (_createStepProgress).
//
// Nothing here writes storage: the demo shares an origin with the real app.

import scenario from './scenario.mjs';
import { parseDemoHash } from './scenario-schema.mjs';
import { TRACKS, DEFAULT_TRACK, TRACK_META } from './tracks.mjs';
import { DURATIONS } from './durations.mjs';
import { loadShellTemplate, prepareDocument, applyRailState, paintShellError } from './shell-loader.mjs';
import { createCursor } from './cursor.mjs';
import { createEngine } from './engine.mjs';
import { createCamera } from './camera.mjs';
import { MASCOT_GEOMETRY } from './mascot-geometry.mjs';
import { createCockpitSurface } from './surfaces/cockpit.mjs';
import { createVscodeSurface } from './surfaces/vscode.mjs';
import { renderMock } from './mocks/index.mjs';
import { installHoverMirror } from './hover-mirror.mjs';

const NEXT_KEYS = new Set(['Enter', ' ', 'ArrowRight', 'PageDown']);
const PREV_KEYS = new Set(['ArrowLeft', 'PageUp']);

const $ = (id) => document.getElementById(id);

function _setMode(mode) {
  $('demo-app').dataset.mode = mode;
  document.querySelectorAll('[data-demo-mode]').forEach((b) => {
    const on = b.dataset.demoMode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function _paintTrackSwitch(track) {
  document.querySelectorAll('[data-demo-track]').forEach((b) => {
    const on = b.dataset.demoTrack === track;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function _togglePopover(id, btnId, force) {
  const pop = $(id);
  const open = force !== undefined ? force : pop.hidden;
  pop.hidden = !open;
  $(btnId).setAttribute('aria-expanded', String(open));
  if (open) {
    const other = id === 'demo-toc' ? ['demo-help', 'demo-help-btn'] : ['demo-toc', 'demo-toc-btn'];
    _togglePopover(other[0], other[1], false);
  }
}

/** `**word**` -> a DS-accent <strong>; everything else stays plain text. */
function _paintCaption(el, text) {
  el.replaceChildren();
  String(text || '').split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (!part) return;
    if (part.startsWith('**') && part.endsWith('**')) {
      const k = document.createElement('strong');
      k.className = 'demo-caption-key';
      k.textContent = part.slice(2, -2);
      el.appendChild(k);
    } else {
      el.appendChild(document.createTextNode(part));
    }
  });
}

/**
 * Pixels per pose unit (Pip's figure is 16 units tall in every pose) and the
 * largest box a frame may take - a pose with big props shrinks to fit.
 */
const MASCOT_SCALE = {
  pill: { k: 3, maxW: 104, maxH: 56 },
  narr: { k: 3, maxW: 104, maxH: 56 },
  card: { k: 10, maxW: 340, maxH: 200 },
};

/**
 * Put a Pip pose into a frame, as <img> (the poses are animated SVGs and are
 * never inlined). The <img> keeps the file's own aspect ratio (its viewBox)
 * and is offset so the figure's box (demo/mascot-geometry.mjs) fills the frame:
 * the same Pip height in every pose. A new pose crossfades over the old one.
 */
function _setMascot(frame, pose, animate) {
  const cur = frame.querySelector('.demo-mascot-pose:not(.demo-mascot-leaving)');
  if (cur && cur.dataset.pose === pose) return;
  const geo = MASCOT_GEOMETRY[pose];
  const size = MASCOT_SCALE[frame.dataset.mascotSize] || MASCOT_SCALE.pill;
  const wrap = document.createElement('span');
  wrap.className = 'demo-mascot-pose';
  wrap.dataset.pose = pose;
  const img = document.createElement('img');
  img.src = '/assets/mascot/pip-' + pose + '.svg';
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  if (geo) {
    const [vx, vy, vw, vh] = geo.vb;
    const [bx, by, bw, bh] = geo.box;
    const k = Math.min(size.k, size.maxW / bw, size.maxH / bh);
    wrap.style.width = Math.round(bw * k) + 'px';
    wrap.style.height = Math.round(bh * k) + 'px';
    img.style.width = Math.round(vw * k) + 'px';
    img.style.height = Math.round(vh * k) + 'px';
    img.style.marginLeft = Math.round((vx - bx) * k) + 'px';
    img.style.marginTop = Math.round((vy - by) * k) + 'px';
  }
  wrap.appendChild(img);
  if (!animate || !cur) {
    frame.replaceChildren(wrap);
    return;
  }
  wrap.classList.add('demo-mascot-entering');
  frame.appendChild(wrap);
  cur.classList.add('demo-mascot-leaving');
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.remove('demo-mascot-entering')));
  setTimeout(() => cur.remove(), 400);
}

/** Title cards: chapter start and the closing card. */
function _createCards() {
  const el = $('demo-card');
  let gen = 0;
  return {
    show(model, animate) {
      gen += 1;
      const isEnd = model.kind === 'end';
      const src = isEnd ? model.ending : model.chapter;
      _setMascot($('demo-card-mascot'), src.mascot, false);
      $('demo-card-kicker').textContent = isEnd
        ? 'End of the demo'
        : (model.index === 0 ? `A demo in ${model.count} chapters` : `Chapter ${model.index + 1} of ${model.count}`);
      $('demo-card-title').textContent = src.title;
      $('demo-card-subtitle').textContent = src.subtitle;
      el.querySelector('.demo-card-hint').textContent = isEnd
        ? 'The left arrow goes back to the last step.'
        : 'Press Enter to start.';
      document.body.dataset.card = '1';
      el.hidden = false;
      if (animate && !el.classList.contains('demo-card--visible')) {
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('demo-card--visible')));
        return;
      }
      // Opaque in this very frame: a chapter card covers the stage BEFORE the
      // engine rebuilds it underneath, so no transition (also none from a
      // half-faded card that was still leaving).
      el.style.transition = 'none';
      el.classList.add('demo-card--visible');
      void el.offsetWidth;
      el.style.transition = '';
    },
    hide(animate) {
      const mine = ++gen;
      delete document.body.dataset.card;
      el.classList.remove('demo-card--visible');
      if (!animate) { el.hidden = true; return; }
      setTimeout(() => { if (gen === mine) el.hidden = true; }, 520);
    },
  };
}

/** Time the title card needs to fade in (opacity 0.5 s, hint rises at 0.6 s for 0.7 s). */
const CARD_FADE_MS = 1300;
/** How fast the bar closes the gap to 100% once the step has settled. */
const SETTLE_MS = 220;
/** The bar waits at this share of the width until the engine says the step is done. */
const RUNNING_CAP = 0.95;

/**
 * Step progress bar (#demo-progress on the bottom bar). While a step plays it
 * fills to RUNNING_CAP over the step's EXPECTED time (info.expectedMs, demo/
 * step-durations.mjs) - a pure CSS transition, no timer. Only the engine's
 * settle (onSettled, the same moment data-demo-busy turns "0") completes it
 * and switches #demo-app[data-progress] to "ready"; the CSS additionally
 * requires html[data-demo-ready="1"], so the ready look can never show while
 * a step still runs. A skipped step (instant render) jumps to done; a title
 * card turns ready after its fade-in; the closing card is "end" (no hint).
 */
function _createStepProgress() {
  const app = $('demo-app');
  const fill = $('demo-progress-fill');
  let readyTimer = 0;

  function _to(scale, ms) {
    fill.style.setProperty('--demo-step-ms', Math.max(0, Math.round(ms)) + 'ms');
    fill.style.transform = 'scaleX(' + scale + ')';
  }

  function _reset() {
    fill.style.transition = 'none';
    _to(0, 0);
    void fill.offsetWidth;
    fill.style.transition = '';
  }

  return {
    /** Before a step (or card) plays: called from onRender. */
    start(info) {
      clearTimeout(readyTimer);
      if (info.card) {
        _reset();
        app.dataset.progress = 'idle';
        return;
      }
      app.dataset.progress = 'running';
      // An instant render (skip, back, switch, reduced motion) keeps the bar
      // where it is; settle() completes it a moment later.
      if (!info.animate) return;
      _reset();
      _to(RUNNING_CAP, info.expectedMs);
    },
    /** The step (or card) on screen has settled: the engine's busy is "0". */
    settle(info) {
      clearTimeout(readyTimer);
      const done = () => {
        _to(1, info.reducedMotion ? 0 : SETTLE_MS);
        app.dataset.progress = info.card === 'end' ? 'end' : 'ready';
      };
      if (info.card === 'chapter' && !info.reducedMotion) readyTimer = setTimeout(done, CARD_FADE_MS);
      else done();
    },
    destroy() { clearTimeout(readyTimer); },
  };
}

/**
 * The chapter list: only the active track's chapters, numbered within it,
 * each with its estimated presentation time (demo/durations.mjs); the header
 * carries the track's total (the sum of its chapters).
 */
function _paintToc(chapters, currentId, track) {
  const list = $('demo-toc-list');
  const mins = DURATIONS[track] || {};
  list.replaceChildren();
  let total = 0;
  chapters.forEach((ch, i) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'ds-btn ds-btn--tertiary ds-btn--sm';
    a.href = ch.hash;
    a.textContent = (i + 1) + '. ' + ch.title;
    if (mins[ch.id]) {
      total += mins[ch.id];
      const t = document.createElement('span');
      t.className = 'demo-toc-time';
      t.textContent = '· ~' + mins[ch.id] + ' min';
      a.appendChild(t);
    }
    if (ch.id === currentId) a.setAttribute('aria-current', 'true');
    li.appendChild(a);
    list.appendChild(li);
  });
  const label = (TRACK_META[track] || {}).label || '';
  $('demo-toc-total').textContent = total ? label + ' · ~' + total + ' min' : label;
}

async function boot() {
  prepareDocument();
  // The real shell's :hover rules answer to the cursor's .demo-hover class.
  installHoverMirror().catch(() => { /* no mirror - the demo/*.css hover rules still apply */ });
  const stage = $('demo-stage');
  const cockpitRoot = $('demo-cockpit');
  const screenRoot = $('demo-screen');

  let template;
  try {
    template = await loadShellTemplate();
  } catch (err) {
    paintShellError(cockpitRoot, err);
    return;
  }

  const cockpit = createCockpitSurface({ root: cockpitRoot, template, scenario });
  const vscode = createVscodeSurface({ root: $('demo-vscode') });
  const cursor = createCursor($('demo-cursor-layer'), stage);
  const camera = createCamera(stage, $('demo-camera'));
  const cards = _createCards();
  const progress = _createStepProgress();
  let hotspotEl = null;

  function setLayout(layout, mock, animate, props) {
    const changed = stage.dataset.layout !== layout;
    stage.dataset.layout = layout;
    if (changed && animate) {
      // A short dissolve between surfaces; replay and skip stay a hard cut.
      const cam = $('demo-camera');
      cam.classList.remove('demo-camera--cut');
      void cam.offsetWidth;
      cam.classList.add('demo-camera--cut');
    }
    if (layout === 'screen') screenRoot.innerHTML = renderMock(mock, props);
    // Half a screen cannot carry a 300px rail: the split view collapses it,
    // both classes and the html marker together.
    applyRailState(cockpitRoot, layout === 'split');
  }

  function onRender(info) {
    if (hotspotEl) { hotspotEl.classList.remove('demo-hotspot'); hotspotEl = null; }
    progress.start(info);
    $('demo-bar-chapter').textContent = `Chapter ${info.chapterIndex + 1} of ${info.chapterCount} · ${info.chapter.title}`;
    $('demo-bar-step').textContent = info.card === 'chapter' ? 'Title card'
      : info.card === 'end' ? 'End of the demo'
        : `Step ${info.stepIndex + 1} of ${info.stepCount}` + (info.narration ? ' — ' + info.narration.title : '');
    const caption = $('demo-caption');
    if (!info.card) {
      _paintCaption($('demo-caption-text'), info.caption);
      _setMascot($('demo-caption-mascot'), info.mascot, info.animate);
      _setMascot($('demo-narr-mascot'), info.mascot, info.animate);
      caption.hidden = false;
      if (info.animate) {
        // Replay the pill animation: fade in, Pip bounces once.
        caption.classList.remove('demo-caption--enter');
        void caption.offsetWidth;
        caption.classList.add('demo-caption--enter');
      }
    }
    const n = info.narration;
    $('demo-narr-chapter').textContent = info.chapter.title;
    $('demo-narr-title').textContent = n ? n.title : '';
    $('demo-narr-body').textContent = n ? n.body : '';
    $('demo-narr-command').hidden = !(n && n.command);
    $('demo-narr-command-text').textContent = (n && n.command) || '';
    _paintToc(engine.trackChapters(), info.chapter.id, info.track);
    _paintTrackSwitch(info.track);
  }

  function onError(err) {
    console.error('[demo]', err);
  }

  const engine = createEngine({
    scenario, stage, surfaces: { cockpit, vscode }, cursor, camera, cards, setLayout, onRender, onError,
    onSettled: (info) => progress.settle(info),
  });

  async function afterStep() {
    if ($('demo-app').dataset.mode !== 'instruktaz' || engine.busy) return;
    const sel = engine.nextTargetSelector();
    const el = sel ? stage.querySelector(sel) : null;
    if (el) { el.classList.add('demo-hotspot'); hotspotEl = el; }
  }

  async function go(fn) {
    await fn();
    afterStep();
  }

  // ── Keyboard: capture phase, so a focused chrome button never also gets a native click.
  engine.addListener(window, 'keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tocOpen = !$('demo-toc').hidden;
    if (e.key === 'Escape') {
      _togglePopover('demo-toc', 'demo-toc-btn', false);
      _togglePopover('demo-help', 'demo-help-btn', false);
      return;
    }
    if (tocOpen && (e.key === 'Enter' || e.key === ' ') && $('demo-toc').contains(e.target)) return;
    // Enter / Space on a focused switch or link (Tab reaches it) operates it, not the show.
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('[data-demo-track], [data-demo-mode], a[href]')) return;
    if (e.key === '?') { e.preventDefault(); _togglePopover('demo-help', 'demo-help-btn'); return; }
    if (NEXT_KEYS.has(e.key)) { e.preventDefault(); e.stopPropagation(); go(engine.next); }
    else if (PREV_KEYS.has(e.key)) { e.preventDefault(); e.stopPropagation(); go(engine.prev); }
  }, true);

  // A mouse click leaves no focus on chrome buttons, so Space keeps meaning "next".
  engine.addListener(document, 'click', (e) => {
    const btn = e.target.closest('button, a');
    if (btn && !btn.closest('#demo-toc')) btn.blur();
  });

  // Hash: the chapter list and the Settings links name a chapter's first step
  // (`#<chapter>/0`, `#short:<chapter>/0`) or a bare track (`#short`).
  engine.addListener(window, 'hashchange', () => {
    const p = parseDemoHash(location.hash, scenario, TRACKS, DEFAULT_TRACK);
    _togglePopover('demo-toc', 'demo-toc-btn', false);
    const cur = engine.position;
    if (p.track !== engine.track || p.chapter !== cur.chapter || p.step !== cur.step) {
      engine.setTrack(p.track);
      go(() => engine.render(p.chapter, p.step, true));
    }
  });

  // Track switch: a version switch starts that version from its beginning -
  // the opening title card ("A demo in N chapters", the card of chapter 1),
  // exactly like a fresh load or a `#short` / `#full` hash. Rendering the
  // first position animated is what puts the card up; Enter then plays its
  // first step. render() writes the hash with replaceState, so no hashchange
  // follows.
  document.querySelectorAll('[data-demo-track]').forEach((b) => {
    engine.addListener(b, 'click', () => {
      const id = b.dataset.demoTrack;
      if (id === engine.track) return;
      engine.setTrack(id);
      const to = engine.firstPosition;
      go(() => engine.render(to.chapter, to.step, true));
    });
  });

  document.querySelectorAll('[data-demo-mode]').forEach((b) => {
    engine.addListener(b, 'click', () => {
      _setMode(b.dataset.demoMode);
      // The stage changed width: re-place the current step (camera, cursor) instantly.
      if (!engine.card) {
        const pos = engine.position;
        go(() => engine.render(pos.chapter, pos.step, false));
      }
    });
  });
  engine.addListener($('demo-toc-btn'), 'click', () => _togglePopover('demo-toc', 'demo-toc-btn'));
  engine.addListener($('demo-help-btn'), 'click', () => _togglePopover('demo-help', 'demo-help-btn'));
  engine.addListener($('demo-narr-copy'), 'click', () => {
    const text = $('demo-narr-command-text').textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => { /* clipboard refused - the text stays visible */ });
  });
  // A projector switch or a dragged window moves every absolute position the
  // camera and the cursor hold: re-render the current step instantly once the
  // resize settles (title and end cards have nothing positioned).
  let resizeTimer = 0;
  engine.addListener(window, 'resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (engine.card) return;
      const pos = engine.position;
      go(() => engine.render(pos.chapter, pos.step, false));
    }, 200);
  });
  // A page kept in the back-forward cache must come back alive: destroy only
  // when the page is really going away.
  engine.addListener(window, 'pagehide', (e) => { if (!e.persisted) { progress.destroy(); engine.destroy(); } });

  const start = parseDemoHash(location.hash, scenario, TRACKS, DEFAULT_TRACK);
  engine.setTrack(start.track);
  go(() => engine.render(start.chapter, start.step, true));
}

boot();
