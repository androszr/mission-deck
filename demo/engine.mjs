// demo/engine.mjs
// The step player. A position is (chapter, step) and the state shown there is
// ALWAYS rebuilt the same way: reset every surface, apply the chapter's
// `setup`, replay steps 0..N-1 instantly, then play step N (animated when the
// presenter moved forward, instant when they moved back). "Back" is a replay,
// never an undo, so it is deterministic by construction.
//
// A key pressed while a step is still animating cancels it (every pending
// sleep / frame rejects with DemoCancelled) and renders the same step again
// instantly - "finish the current step now".
//
// Tracks (demo/tracks.mjs): the engine plays one track at a time - a subset
// of the scenario's chapters and steps. Positions stay FULL-scenario indexes,
// so the replay before a step still runs every earlier step of its chapter
// (also the ones the track skips) and the state is the same as in the full
// version; only next / prev, the title cards, the counters and the hash move
// within the track.
//
// Action handlers: generic document ones live here; surfaces contribute theirs
// through `handlers`; a later chapter can add a new type with
// registerAction() without touching this file.
//
// While a step plays, <html data-demo-busy="1">; "0" once it has settled (a
// walker or a screen recorder can wait on it). data-demo-ready is its mirror
// ("1" = the step on screen has finished, time for the next key) and gates
// the ready look of the step progress bar (demo/main.mjs): the bar can never
// say "Next" while the step still plays. A render cancelled by the next one
// does not settle - only the render still on screen flips the flags back.

import { navigatePath, allPages, resolveTrack, demoHash } from './scenario-schema.mjs';
import { TRACKS, DEFAULT_TRACK, setActiveTrack } from './tracks.mjs';
import { renderMock } from './mocks/index.mjs';
import { syncLogRow, esc } from './mocks/common.mjs';
import { appendLines } from './surfaces/term.mjs';
import { showPreview, toastRegionOn, clearOverlays } from './surfaces/overlay.mjs';
import { pillHomeRect, pillTopRect, overlaps, setPillTop } from './safe-area.mjs';
import { stepMs } from './step-durations.mjs';

export class DemoCancelled extends Error {
  constructor() { super('demo-cancelled'); this.name = 'DemoCancelled'; }
}

function _newToken() {
  const pending = new Set();
  const token = {
    cancelled: false,
    wait(ms) {
      return new Promise((resolve, reject) => {
        if (token.cancelled) { reject(new DemoCancelled()); return; }
        const entry = { reject };
        entry.t = setTimeout(() => { pending.delete(entry); resolve(); }, ms);
        pending.add(entry);
      });
    },
    frame() {
      return new Promise((resolve, reject) => {
        if (token.cancelled) { reject(new DemoCancelled()); return; }
        const entry = { reject };
        entry.raf = requestAnimationFrame((now) => { pending.delete(entry); resolve(now); });
        pending.add(entry);
      });
    },
    cancel() {
      token.cancelled = true;
      for (const e of pending) {
        if (e.t) clearTimeout(e.t);
        if (e.raf) cancelAnimationFrame(e.raf);
        e.reject(new DemoCancelled());
      }
      pending.clear();
    },
  };
  return token;
}

const BADGE_TONE_RE = /\bds-badge--(green|gray|grey|blue|red|yellow|orange)\b/g;

/** A progress `bar` that is a fill element also gets an inline width. */
const FILL_SELECTOR = '.ds-progress-fill, .ips-bar-fill, [data-demo-fill]';

/** How long a `hover` action rests on its target by default. */
const HOVER_MS = 1100;

function _setBusy(on) {
  document.documentElement.dataset.demoBusy = on ? '1' : '0';
  document.documentElement.dataset.demoReady = on ? '0' : '1';
}

/**
 * @param {object} opts
 * @param {object} opts.scenario
 * @param {HTMLElement} opts.stage #demo-stage (holds every surface)
 * @param {{ cockpit: object, vscode: object }} opts.surfaces
 * @param {object} opts.cursor createCursor() result
 * @param {(layout: string, mock?: string, animate?: boolean, props?: object) => void} opts.setLayout
 * @param {(info: object) => void} opts.onRender called before a step plays
 * @param {(err: Error) => void} opts.onError
 * @param {(info: object) => void} [opts.onSettled] called once the step (or card) on screen has settled
 * @param {object} opts.camera createCamera() result
 * @param {{ show: Function, hide: Function }} opts.cards title-card painter (main.mjs)
 */
/** The beat before and after a pasted chunk lands (demo `paste`, Cmd+V / Ctrl+V). */
const PASTE_PAUSE_MS = 280;

export function createEngine({ scenario, stage, surfaces, cursor, camera, cards, setLayout, onRender, onError, onSettled = () => {} }) {
  const pages = allPages(scenario);
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { cockpit, vscode } = surfaces;

  let ci = 0;
  let si = 0;
  let trackId = DEFAULT_TRACK;
  let plan = resolveTrack(null, scenario);
  let token = null;
  let running = null;
  let layout = 'cockpit';
  let lastPointed = null;
  let focused = null;
  let cardMode = null; // null | 'chapter' | 'end'
  // The view moved under the cursor (camera, scroll, surface) since it last
  // pointed at something: the step ends by re-anchoring it (cursor.settle).
  let viewMoved = false;
  // Only the step on screen moves the pill; the silent replay before it does not.
  let guardOn = false;
  const screenRoot = stage.querySelector('#demo-screen');
  const listeners = [];
  setTrack(DEFAULT_TRACK);

  function resolve(sel) {
    const el = stage.querySelector(sel);
    if (!el) throw new Error('Demo: element not found ' + sel);
    return el;
  }

  /** Root of the surface on screen: overlays (preview, toasts) open there. */
  function activeRoot() {
    if (layout === 'vscode') return vscode.el;
    if (layout === 'screen' && screenRoot) return screenRoot;
    return cockpit.el;
  }

  function makeCtx(tk, animate, replay) {
    const ctx = {
      animate,
      replay,
      sleep: (ms) => (animate ? tk.wait(ms) : Promise.resolve()),
      frame: () => tk.frame(),
      resolve,
      /** Glide, hover, click - the autopilot's whole gesture. */
      async point(el, { hover = true, click = true } = {}) {
        if (!el) throw new Error('Demo: no target for the cursor');
        if (focused && focused !== el) { focused.classList.remove('demo-focus'); focused = null; }
        // A zoomed camera aimed elsewhere would send the cursor off the stage:
        // pull back to the full view first, then go.
        if (camera.zoom !== 1 && !cursor.sees(el)) await camera.set('full', ctx);
        await cursor.moveTo(el, ctx);
        viewMoved = false;
        if (hover) await cursor.hover(el, ctx);
        if (click) await cursor.click(el, ctx);
        lastPointed = el;
      },
      /**
       * Type into a field, the editor or a terminal line, one character per
       * tick. Every substring listed in `paste` (a link copied from a browser)
       * lands in one frame after a short pause, the way a Cmd+V / Ctrl+V does.
       */
      async type(el, text, { speed = 45, mask = false, paste = [] } = {}) {
        const field = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
        const shown = (s) => (mask && !(field && el.type === 'password') ? '•'.repeat(s.length) : s);
        const write = (s) => { if (field) el.value = shown(s); else el.textContent = shown(s); };
        const chunks = (Array.isArray(paste) ? paste : [paste]).filter((p) => typeof p === 'string' && p.length > 0);
        if (animate) {
          for (let i = 1; i <= text.length; i += 1) {
            const p = chunks.find((c) => text.startsWith(c, i - 1));
            if (p) {
              await tk.wait(PASTE_PAUSE_MS);
              i += p.length - 1;
              write(text.slice(0, i));
              await tk.wait(PASTE_PAUSE_MS);
              continue;
            }
            write(text.slice(0, i));
            await tk.wait(speed);
          }
        }
        write(text);
      },
    };
    return ctx;
  }

  /** The visible road of one navigate: only the clicks whose effect is not already true. */
  function _pendingOps(a) {
    const st = cockpit.state;
    const sameView = st.view === a.view;
    return (navigatePath(a, pages) || []).filter((op) => (op.effect.kind === 'tab'
      ? !(st.view === 'settings' && st.tab === op.effect.tab && sameView)
      : !sameView));
  }

  async function _navigate(a, ctx) {
    for (const op of _pendingOps(a)) {
      if (op.effect.kind === 'tab' && cockpit.state.tab === op.effect.tab) continue;
      await ctx.point(resolve(op.click));
      cockpit.applyEffect(op.effect);
      await ctx.sleep(op.effect.kind === 'hub' ? 380 : 320);
    }
  }

  const handlers = {
    async click(a, ctx) { await ctx.point(resolve(a.target)); },

    /** Glide and hover - tooltip bubble, no click. The hover ends with the action. */
    async hover(a, ctx) {
      await ctx.point(resolve(a.target), { click: false });
      await ctx.sleep(a.ms === undefined ? HOVER_MS : a.ms);
      cursor.unhover();
    },

    async type(a, ctx) {
      const el = resolve(a.target);
      await ctx.point(el);
      el.classList.add('demo-focus');
      focused = el;
      await ctx.type(el, a.text, { mask: !!a.mask, paste: a.paste || [] });
    },

    async show(a, ctx) {
      const el = resolve(a.target);
      const html = renderMock(a.mock, a.props);
      const mode = a.mode || 'replace';
      if (mode === 'replace') el.innerHTML = html;
      else if (mode === 'append') el.insertAdjacentHTML('beforeend', html);
      else if (mode === 'prepend') el.insertAdjacentHTML('afterbegin', html);
      else if (mode === 'outer') el.outerHTML = html;
      await ctx.sleep(220);
    },

    hide(a) { resolve(a.target).hidden = a.hidden !== false; },

    async badge(a, ctx) {
      const el = resolve(a.target);
      el.className = el.className.replace(BADGE_TONE_RE, '').trim() + ' ds-badge--' + a.tone;
      el.textContent = a.text;
      await ctx.sleep(200);
    },

    async progress(a, ctx) {
      if (a.label !== undefined) resolve(a.labelTarget).textContent = a.label;
      if (a.pct !== undefined) {
        const bar = resolve(a.bar);
        bar.style.setProperty('--ips-pct', a.pct + '%');
        if (bar.matches(FILL_SELECTOR)) bar.style.width = a.pct + '%';
      }
      if (a.lines) {
        const box = resolve(a.target);
        for (const line of a.lines) {
          const html = (a.format || 'sync') === 'sync'
            ? syncLogRow(line)
            : `<div class="demo-log-line demo-log-line--${esc(line.status || 'ok')}">${esc(line.step)}${line.detail ? ' — ' + esc(line.detail) : ''}</div>`;
          box.insertAdjacentHTML('beforeend', html);
          box.scrollTop = box.scrollHeight;
          await ctx.sleep(420);
        }
      } else {
        await ctx.sleep(300);
      }
    },

    async scroll(a, ctx) {
      const el = resolve(a.target);
      el.scrollIntoView({ block: 'center', behavior: ctx.animate ? 'smooth' : 'instant' });
      viewMoved = true;
      if (!ctx.animate) return;
      // Wait for the smooth scroll to land (its length depends on the
      // distance): the next pointer move must aim at the final position.
      let last = null;
      let still = 0;
      const t0 = performance.now();
      while (still < 4 && performance.now() - t0 < 1500) {
        await ctx.frame();
        const top = Math.round(el.getBoundingClientRect().top);
        still = top === last ? still + 1 : 0;
        last = top;
      }
      await ctx.sleep(120);
    },

    wait(a, ctx) { return ctx.sleep(a.ms); },

    narrate() { /* painted by onRender before the step plays */ },

    camera(a, ctx) {
      viewMoved = true;
      return camera.set(a.full === true ? 'full' : a, ctx);
    },

    async surface(a, ctx) {
      layout = a.show;
      viewMoved = true;
      setLayout(a.show, a.mock, ctx.animate, a.props);
      await ctx.sleep(380);
    },

    navigate: _navigate,

    async ask(a, ctx) {
      const on = a.on || (layout === 'cockpit' ? 'cockpit' : 'vscode');
      let host;
      if (on === 'cockpit') {
        if (!cockpit.state.terminalOpen) await ctx.point(resolve('#demo-topbar-term-btn'));
        host = await cockpit.openTerminal(ctx);
      } else {
        host = vscode.terminalEl();
      }
      await ctx.point(host, { hover: false });
      await appendLines(host, [{ role: 'user', text: a.text }], ctx);
      for (const t of a.then) await runAction(t, ctx);
    },

    terminal(a, ctx) {
      return a.on === 'cockpit' ? cockpit.handlers.terminal(a, ctx) : vscode.handlers.terminal(a, ctx);
    },
    toast(a, ctx) {
      // Every demo toast goes to a region on the stage itself, OUTSIDE the
      // camera: a toast inside the camera layer would float mid-stage as soon
      // as the camera zooms. Bottom right by default (above the caption
      // pill); top right while a modal is open or the control just clicked
      // sits in the bottom right corner, so it never covers the modal's
      // footer buttons or the thing the step is about.
      const top = _modalOpen() || _bottomRightBusy();
      return cockpit.handlers.toast(a, ctx, toastRegionOn(stage, { top }));
    },
    modal: (a, ctx) => cockpit.handlers.modal(a, ctx),
    async preview(a, ctx) {
      // A preview is a focus device for the whole scene: pull back to the
      // full view first, so the pane (top right of the surface) is on stage.
      if (!a.close && camera.zoom !== 1) {
        viewMoved = true;
        await camera.set('full', ctx);
      }
      await showPreview(activeRoot(), stage, a, ctx);
    },
    flyout: (a, ctx) => cockpit.handlers.flyout(a, ctx),
    editor: (a, ctx) => vscode.handlers.editor(a, ctx),
    explorer: (a, ctx) => vscode.handlers.explorer(a, ctx),
  };

  /** True when a DS modal is open on the surface on screen. */
  function _modalOpen() {
    return !!activeRoot().querySelector('.ds-modal-overlay.open:not([hidden])');
  }

  /** True when the last clicked control sits where a bottom-right toast would land. */
  function _bottomRightBusy() {
    if (!lastPointed || !lastPointed.isConnected) return false;
    const s = stage.getBoundingClientRect();
    const zone = { left: s.right - 420, top: s.bottom - 200, right: s.right, bottom: s.bottom };
    return overlaps(lastPointed.getBoundingClientRect(), zone);
  }

  /**
   * Keep what the step needs on screen clear of the caption pill: when the
   * last pointed control, the focused field or an open modal's footer still
   * sits under the pill's home position (it could not be scrolled away - a
   * rail item, a footer at the end of the page), the pill moves to the top of
   * the stage for the rest of the step. Big panes (a terminal, a whole card)
   * do not count: their bottom always reaches the pill band.
   */
  function _guardPill() {
    const home = pillHomeRect();
    if (!home) return;
    const small = (el) => {
      if (!el || !el.isConnected || el.getClientRects().length === 0) return null;
      const r = el.getBoundingClientRect();
      return r.height <= 160 && r.width <= 600 ? r : null;
    };
    const root = activeRoot();
    const modal = root.querySelector('.ds-modal-overlay.open:not([hidden])');
    // Under an open modal only the modal itself matters.
    const mine = (el) => (modal && el && !modal.contains(el) ? null : el);
    const rects = [small(mine(lastPointed)), small(mine(focused))].filter(Boolean);
    // An open modal's title and its footer buttons must both stay readable.
    root.querySelectorAll('.ds-modal-overlay.open:not([hidden]) .ds-modal-header, .ds-modal-overlay.open:not([hidden]) .ds-modal-footer')
      .forEach((el) => { if (el.getClientRects().length) rects.push(el.getBoundingClientRect()); });
    const hits = (pill) => rects.filter((r) => overlaps(r, pill)).length;
    const atBottom = hits(home);
    if (atBottom === 0) return;
    // Flip only when the top edge covers less than the bottom one does.
    if (hits(pillTopRect()) < atBottom) setPillTop(true);
  }

  async function runAction(a, ctx) {
    const fn = handlers[a.type];
    if (!fn) throw new Error('Demo: no handler for action ' + a.type);
    await fn(a, ctx);
    if (guardOn) _guardPill();
  }

  function _narrationOf(step) {
    const acts = step.actions.filter((x) => x.type === 'narrate');
    return acts.length ? acts[acts.length - 1] : null;
  }

  /** Index in `plan` of the entry of full chapter index c (-1 = not in the track). */
  function _entryAt(c) { return plan.findIndex((p) => p.ci === c); }

  /** The track's chapters, for the chapter list: { id, title, index, hash }. */
  function trackChapters() {
    return plan.map((p, i) => ({ id: p.id, title: scenario.chapters[p.ci].title, index: i, hash: demoHash(trackId, p.id, 0, DEFAULT_TRACK) }));
  }

  /**
   * Snap a full-scenario position into the track: a chapter outside it goes to
   * the track's first step; a step outside it to the next track step of the
   * chapter (or its last one).
   */
  function _snap(c, s) {
    const e = _entryAt(c);
    if (e < 0) return plan.length ? { c: plan[0].ci, s: plan[0].steps[0] } : { c, s };
    const steps = plan[e].steps;
    if (steps.includes(s)) return { c, s };
    const after = steps.find((x) => x > s);
    return { c, s: after !== undefined ? after : steps[steps.length - 1] };
  }

  function _info(animate = false) {
    const ch = scenario.chapters[ci];
    const step = ch.steps[si];
    const e = Math.max(0, _entryAt(ci));
    const steps = plan.length ? plan[e].steps : [si];
    return {
      chapterIndex: e,
      chapterCount: plan.length,
      chapter: ch,
      stepIndex: Math.max(0, steps.indexOf(si)),
      stepCount: steps.length,
      fullChapterIndex: ci,
      fullStepIndex: si,
      track: trackId,
      step,
      narration: _narrationOf(step),
      caption: step.caption,
      mascot: step.mascot,
      card: cardMode,
      animate: animate && !reducedMotion,
      reducedMotion,
      /** Expected autopilot time of the step (demo/step-durations.mjs): the progress bar's speed only. */
      expectedMs: stepMs(step),
    };
  }

  /**
   * Apply one step: its camera first, then its actions in order. When the view
   * moved after the last pointer action (or the cursor is outside the stage),
   * the cursor ends re-anchored inside the stage - never off-screen.
   */
  async function _playStep(step, ctx) {
    viewMoved = false;
    if (step.camera !== undefined) {
      viewMoved = true;
      await camera.set(step.camera, ctx);
    }
    for (const a of step.actions) await runAction(a, ctx);
    if (viewMoved || !cursor.inStage()) await cursor.settle(viewMoved ? lastPointed : null, ctx);
    viewMoved = false;
  }

  /**
   * Show (chapter, step). Reset, setup, instant replay of the earlier steps,
   * then the step itself. Entering a chapter forward (`animate` at step 0)
   * stops on its title card first; the next key plays step 0.
   * @param {number} chapterIndex
   * @param {number} stepIndex
   * @param {boolean} animate
   * @param {{ skipCard?: boolean }} [opts]
   */
  async function render(chapterIndex, stepIndex, animate, opts = {}) {
    if (token) token.cancel();
    if (running) { try { await running; } catch (_e) { /* settled */ } }
    const pos = _snap(chapterIndex, stepIndex);
    ci = pos.c;
    si = pos.s;
    const tk = _newToken();
    token = tk;
    const ch = scenario.chapters[ci];
    const entry = Math.max(0, _entryAt(ci));
    const trackSteps = plan.length ? plan[entry].steps : [si];
    // The title card opens a chapter: at the TRACK's first step of it.
    const withCard = animate && si === trackSteps[0] && !opts.skipCard;
    history.replaceState(null, '', demoHash(trackId, ch.id, Math.max(0, trackSteps.indexOf(si)), DEFAULT_TRACK));
    _setBusy(true);
    // The title card is the FIRST thing painted: opaque, synchronously, before
    // the reset and the replay below touch any surface - no frame of the new
    // chapter's page may show before it. The chapter is then built under it.
    if (withCard) {
      cardMode = 'chapter';
      cards.show({ kind: 'chapter', chapter: ch, index: entry, count: plan.length }, false);
    }

    running = (async () => {
      cockpit.reset();
      vscode.reset();
      if (screenRoot) screenRoot.replaceChildren();
      clearOverlays(stage);
      cursor.reset();
      camera.reset();
      setPillTop(false);
      guardOn = false;
      layout = 'cockpit';
      setLayout('cockpit');
      lastPointed = null;
      focused = null;
      viewMoved = false;
      const quiet = makeCtx(tk, false, true);
      for (const a of ch.setup || []) await runAction(a, quiet);
      for (let k = 0; k < si; k += 1) await _playStep(ch.steps[k], quiet);
      // End of the replayed steps: no hover left over, the cursor where the
      // last pointer action left it (or inside the stage if that is gone).
      cursor.unhover();
      if (lastPointed) await cursor.settle(lastPointed, quiet);
      if (withCard) {
        onRender(_info());
        return;
      }
      if (cardMode) { cardMode = null; cards.hide(animate && !reducedMotion); }
      onRender(_info(animate));
      guardOn = true;
      await _playStep(ch.steps[si], makeCtx(tk, animate && !reducedMotion, !animate));
      _guardPill();
    })();

    try {
      await running;
    } catch (err) {
      if (!(err instanceof DemoCancelled)) onError(err);
    } finally {
      if (token === tk) running = null;
      // A render cancelled by the next one never settles: the next one owns the flags.
      if (token === tk && !tk.cancelled) {
        _setBusy(false);
        onSettled(_info());
      }
    }
  }

  function _isBusy() { return running !== null; }

  /** The track position after (dir 1) or before (dir -1) the current one; null at an end. */
  function _neighbour(dir) {
    const e = _entryAt(ci);
    if (e < 0) return null;
    const steps = plan[e].steps;
    const k = steps.indexOf(si) + dir;
    if (k >= 0 && k < steps.length) return { c: ci, s: steps[k], same: true };
    const ne = plan[e + dir];
    if (!ne) return null;
    return { c: ne.ci, s: dir > 0 ? ne.steps[0] : ne.steps[ne.steps.length - 1], same: false };
  }

  async function next() {
    if (cardMode === 'chapter') { await render(ci, si, true, { skipCard: true }); return; }
    if (cardMode === 'end') return;
    if (_isBusy()) { await render(ci, si, false); return; }
    const n = _neighbour(1);
    if (n) await render(n.c, n.s, true);
    else {
      cardMode = 'end';
      cards.show({ kind: 'end', ending: scenario.ending }, !reducedMotion);
      onRender(_info());
      _setBusy(false);
      onSettled(_info());
    }
  }

  async function prev() {
    if (cardMode === 'end') { await render(ci, si, false); return; }
    if (cardMode === 'chapter') {
      const e = _entryAt(ci);
      const pe = plan[e - 1];
      if (pe) await render(pe.ci, pe.steps[pe.steps.length - 1], false);
      return;
    }
    const p = _neighbour(-1);
    if (p) await render(p.c, p.s, false);
    else await render(ci, si, false);
  }

  /**
   * Switch the track. Only the plan changes here; the caller re-renders (the
   * current position is snapped into the new track by render()).
   * @param {string} id a key of TRACKS; unknown = the default track
   */
  function setTrack(id) {
    trackId = Object.prototype.hasOwnProperty.call(TRACKS, id) ? id : DEFAULT_TRACK;
    plan = resolveTrack(TRACKS[trackId], scenario);
    const ids = plan.map((p) => p.id);
    setActiveTrack(trackId, TRACKS[trackId] === null ? null : ids);
    document.documentElement.dataset.demoActiveTrack = trackId;
    document.documentElement.dataset.demoTrackChapters = ids.join(' ');
  }

  /** First element the NEXT step will point at, for the Instruktaz-mode hotspot. */
  function nextTargetSelector() {
    if (cardMode) return null;
    // Only when the next TRACK step is the very next step of the chapter: a
    // skipped step in between would change the screen before it plays, and a
    // step in another chapter starts behind a title card.
    const n = _neighbour(1);
    if (!n || !n.same || n.s !== si + 1) return null;
    const step = scenario.chapters[ci].steps[n.s];
    for (const a of step.actions) {
      if (a.target && (a.type === 'click' || a.type === 'type' || a.type === 'hover')) return a.target;
      if (a.type === 'navigate') {
        const op = _pendingOps(a)[0];
        return op ? op.click : null;
      }
      if (a.type === 'ask') return a.on === 'vscode' ? null : '#demo-topbar-term-btn';
    }
    return null;
  }

  return {
    render,
    next,
    prev,
    get position() { return { chapter: ci, step: si }; },
    get track() { return trackId; },
    setTrack,
    trackChapters,
    /** True when the full-scenario chapter index c is part of the active track. */
    hasChapter(c) { return _entryAt(c) >= 0; },
    /** First track step of the track's first chapter, as full indexes. */
    get firstPosition() { return plan.length ? { chapter: plan[0].ci, step: plan[0].steps[0] } : { chapter: 0, step: 0 }; },
    get busy() { return _isBusy(); },
    get card() { return cardMode; },
    nextTargetSelector,
    /** Add or replace an action handler: fn(action, ctx). */
    registerAction(type, fn) { handlers[type] = fn; },
    addListener(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      listeners.push([target, type, fn, opts]);
    },
    destroy() {
      if (token) token.cancel();
      for (const [t, type, fn, opts] of listeners) t.removeEventListener(type, fn, opts);
      listeners.length = 0;
      cockpit.destroy();
      cursor.destroy();
    },
  };
}
