// demo/cursor.mjs
// The autopilot's mouse: an SVG arrow on a fixed, pointer-events-free layer
// above the stage. It glides to an element, hovers it (the `demo-hover` class
// stands in for :hover, which an inert shell never gets), clicks with a
// ripple, and the engine then applies the click's effect. During a replay
// (`ctx.animate === false`) it jumps straight to the end position.
//
// The cursor never rests outside the stage: after a camera move, a scroll or a
// surface change the engine calls settle(), which re-anchors the arrow on the
// last element it pointed at (where that element is NOW, after the camera
// transform) or, when that element is gone or off-stage, on a neutral point.
// "Inside the stage" excludes the caption pill (demo/safe-area.mjs): a target
// under the pill is scrolled clear of it, and the arrow never rests there.

import { underPill, pillHomeRect, overlaps } from './safe-area.mjs';

const HOVER = 'demo-hover';
const PRESSED = 'demo-pressed';

function _ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * The tooltip text the cursor bubble shows for `el`: its `title`, else its
 * `data-tip` - but only when the real stylesheet does not already draw that
 * data-tip as a `::after` bubble (two tooltips would stack).
 * @param {Element} el
 * @returns {string}
 */
function _tipOf(el) {
  // Blank text never opens a bubble (an empty box reads as a broken hover).
  const title = (el.getAttribute('title') || '').trim();
  if (title) return title;
  const tip = (el.getAttribute('data-tip') || '').trim();
  if (!tip) return '';
  const after = getComputedStyle(el, '::after').content;
  return after && after !== 'none' && after !== 'normal' ? '' : tip;
}

/**
 * @param {HTMLElement} layer the #demo-cursor-layer element
 * @param {HTMLElement} [stage] #demo-stage - the box the cursor must stay in
 * @returns {object} cursor API
 */
export function createCursor(layer, stage) {
  const arrow = document.createElement('div');
  arrow.id = 'demo-cursor';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">'
    + '<path class="demo-cursor-shape" d="M4 2.5 L4 19.5 L8.6 15.3 L11.7 22 L14.6 20.7 L11.6 14.1 L17.8 14.1 Z"/></svg>';
  const tip = document.createElement('div');
  tip.className = 'demo-cursor-tip';
  tip.hidden = true;
  layer.append(arrow, tip);

  let x = Math.round(window.innerWidth - 30);
  let y = Math.round(window.innerHeight * 0.38);
  let hovered = null;

  function _paint() {
    arrow.style.transform = `translate(${x}px, ${y}px)`;
    tip.style.transform = `translate(${_tipX()}px, ${y + 26}px)`;
    arrow.dataset.x = String(x);
    arrow.dataset.y = String(y);
  }
  /**
   * Left edge of the tooltip: right of the arrow, or flipped to its left when
   * it would run past the stage's right edge (a chip at the right end of the
   * top bar, under a zoomed camera) - a bubble must never be cut off.
   */
  function _tipX() {
    const at = x + 18;
    if (tip.hidden) return at;
    const right = (stage || document.documentElement).getBoundingClientRect().right - 8;
    const w = tip.offsetWidth;
    return at + w > right ? Math.max(8, x - 8 - w) : at;
  }

  _paint();

  /**
   * Where on `el` the arrow points: its centre, nudged into small controls. A
   * big pane (a terminal, an editor, a whole card) is aimed at its inner top
   * right corner - its middle is the text the audience is reading.
   */
  function _pointOf(el) {
    const r = el.getBoundingClientRect();
    if (r.width > 480 && r.height > 220) return { x: Math.round(r.right - 44), y: Math.round(r.top + 36) };
    return { x: Math.round(r.left + Math.min(r.width / 2, 60)), y: Math.round(r.top + r.height / 2) };
  }

  /** True when `el` (a small control: its box; a big pane: its aim point) sits under the caption pill. */
  function _covered(el) {
    const r = el.getBoundingClientRect();
    if (r.height > 160 || r.width > 600) {
      const p = _pointOf(el);
      return underPill(p.x, p.y);
    }
    return overlaps(r, pillHomeRect());
  }

  function _stageBox() {
    const r = (stage || document.documentElement).getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height, width: r.width, height: r.height };
  }

  function _inStage(p, margin = 4) {
    const b = _stageBox();
    return p.x >= b.left + margin && p.x <= b.right - margin && p.y >= b.top + margin && p.y <= b.bottom - margin
      && !underPill(p.x, p.y);
  }

  /**
   * A resting point off the content: the stage's right margin, a little above
   * the middle - clear of the caption pill, the toasts (bottom right) and the
   * text a page lays out from the left.
   */
  function _neutral() {
    const b = _stageBox();
    return { x: Math.round(b.right - 30), y: Math.round(b.top + b.height * 0.38) };
  }

  function _unhover() {
    if (hovered) hovered.classList.remove(HOVER, PRESSED);
    hovered = null;
    tip.hidden = true;
  }

  async function _glide(to, ctx) {
    if (!ctx.animate) { x = to.x; y = to.y; _paint(); return; }
    const fromX = x;
    const fromY = y;
    const dist = Math.hypot(to.x - fromX, to.y - fromY);
    if (dist < 1) return;
    const duration = Math.max(380, Math.min(750, dist * 0.7));
    const start = performance.now();
    for (;;) {
      const now = await ctx.frame();
      const t = Math.min(1, (now - start) / duration);
      const k = _ease(t);
      x = Math.round(fromX + (to.x - fromX) * k);
      y = Math.round(fromY + (to.y - fromY) * k);
      _paint();
      if (t >= 1) break;
    }
  }

  return {
    /**
     * Glide to `el`. Throws the engine's cancel error if the step is cut short.
     * A target already painted inside the stage is never scrolled: under a
     * zoomed camera a scroll would move it out from under the camera's aim.
     * One that is not gets centred in its scroller first (centre, not
     * 'nearest' - a nearest edge can sit under the stage's clipped border).
     */
    async moveTo(el, ctx) {
      let to = _pointOf(el);
      if (!_inStage(to, 8) || _covered(el)) {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        to = _pointOf(el);
      }
      await _glide(to, ctx);
    },

    /** True when `el` is (still) under the caption pill's home position. */
    covered(el) { return !!el && el.isConnected && el.getClientRects().length > 0 && _covered(el); },

    /**
     * Hover state plus the element's tooltip (`title`, or a `data-tip` the
     * stylesheet does not draw itself) as a bubble. The bubble is part of the
     * end state, so a replay that stops on a hover shows it too.
     */
    async hover(el, ctx) {
      _unhover();
      hovered = el;
      el.classList.add(HOVER);
      const text = _tipOf(el);
      if (text) {
        tip.textContent = text;
        // Over VS Code (or a terminal) the bubble is VS Code's hover widget.
        tip.classList.toggle('demo-cursor-tip--vsc', !!el.closest('#demo-vscode, .demo-term'));
        // The bubble lives outside the camera: grow it with the zoom (capped),
        // so it reads at the same size as the zoomed scene it labels.
        const zoom = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        tip.style.setProperty('--demo-tip-zoom', String(Math.min(1.8, Math.max(1, zoom || 1))));
        tip.hidden = false;
        _paint();
      }
      // Dwell long enough to read any tooltip - the bubble, or a data-tip the
      // stylesheet draws itself while .demo-hover is on.
      await ctx.sleep(text || el.hasAttribute('data-tip') ? 650 : 240);
    },

    /** The click itself: a ripple and a short press. No browser event is fired. */
    async click(el, ctx) {
      if (ctx.animate) {
        const ripple = document.createElement('span');
        ripple.className = 'demo-cursor-ripple';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        layer.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
        el.classList.add(PRESSED);
        arrow.classList.add('demo-cursor--down');
        await ctx.sleep(140);
        arrow.classList.remove('demo-cursor--down');
        el.classList.remove(PRESSED);
        await ctx.sleep(120);
      }
      _unhover();
    },

    /** Drop the hover state and its bubble (end of a hover action). */
    unhover() { _unhover(); },

    /**
     * Re-anchor after the view moved under the cursor: back onto `el` when it
     * is still painted inside the stage, else onto a neutral point.
     * @param {Element|null} el
     * @param {{ animate: boolean, frame: Function }} ctx
     */
    async settle(el, ctx) {
      let to = null;
      // An element now under an open modal is not something to rest on.
      const modal = stage && stage.querySelector('.ds-modal-overlay.open:not([hidden])');
      if (el && modal && !modal.contains(el)) el = null;
      if (el && el.isConnected && el.getClientRects().length > 0) {
        const p = _pointOf(el);
        if (_inStage(p)) to = p;
      }
      // Nothing to rest on: the neutral point, off the content - never
      // wherever the last glide happened to end (often a line of body text).
      if (!to) to = _neutral();
      await _glide(to, ctx);
    },

    /** True when the point the cursor would aim at on `el` is painted inside the stage. */
    sees(el) {
      return el.getClientRects().length > 0 && _inStage(_pointOf(el), 8) && !_covered(el);
    },

    /** True when the arrow's tip is inside the stage box. */
    inStage() { return _inStage({ x, y }, 0); },

    get position() { return { x, y }; },

    /** Instant placement (replay end state, layout change). */
    placeAt(el) {
      if (!el || !el.isConnected) return;
      const p = _pointOf(el);
      x = p.x;
      y = p.y;
      _paint();
    },

    reset() {
      _unhover();
      layer.querySelectorAll('.demo-cursor-ripple').forEach((r) => r.remove());
      arrow.classList.remove('demo-cursor--down');
    },

    destroy() {
      _unhover();
      arrow.remove();
      tip.remove();
    },
  };
}
