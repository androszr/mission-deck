// demo/safe-area.mjs
// The caption pill (Prezentacja mode) floats over the bottom centre of the
// stage. Whatever the autopilot points at, frames with the camera or types
// into must stay clear of it. This module answers ONE question for the
// cursor, the camera and the engine: where the pill sits in its home
// position (bottom centre), whether or not it is currently flipped to the top.
// In Instruktaz mode the pill is display:none and there is no safe area.

/** Gap kept between a target and the pill, in px. */
export const PILL_MARGIN = 10;

/** Height reserved for the pill at the stage bottom, in px (the same 112px demo.css pads with). */
export const PILL_BAND = 112;

/** The caption's distance from the stage bottom (css: bottom: var(--space-24)). */
const PILL_BOTTOM = 24;

/**
 * The pill's rect in its HOME position (bottom centre of the stage), in
 * viewport coordinates, grown by PILL_MARGIN; null when there is no pill.
 * @returns {{ left: number, top: number, right: number, bottom: number }|null}
 */
export function pillHomeRect() {
  const cap = document.getElementById('demo-caption');
  const stage = document.getElementById('demo-stage');
  if (!cap || !stage || cap.hidden || document.body.dataset.card === '1') return null;
  const w = cap.offsetWidth;
  const h = cap.offsetHeight;
  if (!w || !h) return null;
  const s = stage.getBoundingClientRect();
  const left = s.left + s.width / 2 - w / 2;
  const top = s.bottom - PILL_BOTTOM - h;
  return { left: left - PILL_MARGIN, top: top - PILL_MARGIN, right: left + w + PILL_MARGIN, bottom: s.bottom };
}

/**
 * The pill's rect when flipped to the top (css .demo-caption--top: 44px top
 * bar + 12px), grown by PILL_MARGIN; null when there is no pill.
 * @returns {{ left: number, top: number, right: number, bottom: number }|null}
 */
export function pillTopRect() {
  const home = pillHomeRect();
  if (!home) return null;
  const s = document.getElementById('demo-stage').getBoundingClientRect();
  const h = home.bottom - home.top - PILL_BOTTOM - PILL_MARGIN;
  const top = s.top + 56;
  return { left: home.left, top: top - PILL_MARGIN, right: home.right, bottom: top + h + PILL_MARGIN };
}

/**
 * Height of the stage area above the pill band (Prezentacja), relative to
 * the stage top: everything a camera frames should sit inside it. The full
 * stage height in Instruktaz mode, which has no pill.
 * @param {DOMRect} stageBox
 * @returns {number}
 */
export function usableHeight(stageBox) {
  // A fixed band, not the live pill: during the silent replay of earlier
  // steps the caption is not painted yet, and the camera must frame the
  // same way then as when the step plays.
  const app = document.getElementById('demo-app');
  return app && app.dataset.mode === 'prezentacja' ? Math.max(200, stageBox.height - PILL_BAND) : stageBox.height;
}

/** True when two rects overlap. */
export function overlaps(a, b) {
  return !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** True when point (x, y) is under the pill's home position. */
export function underPill(x, y) {
  const p = pillHomeRect();
  return !!p && x >= p.left && x <= p.right && y >= p.top && y <= p.bottom;
}

/**
 * Move the pill to the top of the stage (on) or back home (off). The engine
 * flips it only when something the step needs on screen cannot move out from
 * under it, and resets it on every render.
 * @param {boolean} on
 */
export function setPillTop(on) {
  const cap = document.getElementById('demo-caption');
  if (cap) cap.classList.toggle('demo-caption--top', !!on);
}
