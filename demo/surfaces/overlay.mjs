// demo/surfaces/overlay.mjs
// Overlays that are not tied to the cockpit surface: the file preview pane
// (with the dimmed, blurred scene behind it) opens on whichever surface is on
// screen - each surface is the containing block of its position:fixed
// children, so the pane lays out inside that surface's box - and a toast
// region on the stage itself, outside the camera, for toasts the shell's own
// #ds-toast-region cannot show (another surface on screen, a zoomed camera).

/** Every overlay class this module paints - cleared on each render reset. */
export const OVERLAY_SELECTOR = '.demo-preview, .demo-dim, .demo-toast-region';

/**
 * Remove every preview, dim layer and demo toast region under `root`.
 * @param {HTMLElement} root
 */
export function clearOverlays(root) {
  root.querySelectorAll(OVERLAY_SELECTOR).forEach((el) => el.remove());
}

/**
 * Open (or repaint) the preview pane on `host`, or close it everywhere under
 * `stage` when `a.close` is set.
 * @param {HTMLElement} host the active surface root
 * @param {HTMLElement} stage #demo-stage
 * @param {{ title?: string, lines?: string[], kind?: string, close?: boolean }} a
 * @param {{ sleep: Function }} ctx
 */
export function showPreview(host, stage, a, ctx) {
  if (a.close) {
    stage.querySelectorAll('.demo-preview, .demo-dim').forEach((el) => el.remove());
    return ctx.sleep(200);
  }
  if (!host.querySelector(':scope > .demo-dim')) {
    // Focus: the rest of the scene goes soft and dark while a file is previewed.
    const dimEl = document.createElement('div');
    dimEl.className = 'demo-dim';
    host.appendChild(dimEl);
  }
  let pane = host.querySelector(':scope > .demo-preview');
  if (!pane) {
    pane = document.createElement('aside');
    pane.className = 'ds-card demo-preview';
    host.appendChild(pane);
  }
  pane.innerHTML = '<div class="ds-card-header"><span class="ds-card-title"></span>'
    + '<span class="ds-badge ds-badge--gray">File preview</span></div>'
    + '<div class="ds-card-body"><pre class="demo-preview-body"></pre></div>';
  pane.querySelector('.ds-card-title').textContent = a.title;
  pane.querySelector('.demo-preview-body').textContent = a.lines.join('\n');
  pane.dataset.kind = a.kind || 'log';
  pane.hidden = false;
  return ctx.sleep(300);
}

/**
 * A demo toast region directly under `host` (the stage), created on first use
 * and removed by clearOverlays on every render reset. `top` puts it in the top
 * right corner, under the top bar - used while a modal is open, so a toast
 * never lands on the modal's footer buttons.
 * @param {HTMLElement} host
 * @param {{ top?: boolean }} [opts]
 * @returns {HTMLElement}
 */
export function toastRegionOn(host, { top = false } = {}) {
  const cls = top ? 'demo-toast-region demo-toast-region--top' : 'demo-toast-region';
  let region = host.querySelector(top ? ':scope > .demo-toast-region--top' : ':scope > .demo-toast-region:not(.demo-toast-region--top)');
  if (!region) {
    region = document.createElement('div');
    region.className = cls;
    region.setAttribute('aria-live', 'polite');
    host.appendChild(region);
  }
  return region;
}
