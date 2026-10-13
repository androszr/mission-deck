// demo/camera.mjs
// The "camera" of the presentation: #demo-camera wraps every surface and is
// moved with one CSS transform (scale + translate, origin top-left). A step
// zooms onto the area its action happens in - the rail, a modal, a terminal,
// a table - and back out to the full view.
//
// The cursor reads getBoundingClientRect() of its targets, which already
// includes this transform, so the engine only has to wait for the camera to
// settle (`set` resolves after the transition) before the cursor moves.
//
// Three framing rules on top of "zoom onto the target":
//  - the target is centred in the band ABOVE the caption pill
//    (demo/safe-area.mjs), never behind it;
//  - a modal (.ds-modal) is framed whole: the zoom is capped so its header
//    and its footer buttons both stay on stage; a terminal keeps its full
//    width on stage (its long lines wrap inside it) and, when taller than
//    the view, is framed on its newest line;
//  - the view never starts halfway through a fixed side column (the cockpit
//    rail, the VS Code activity bar + explorer) when the target lies to the
//    right of it: a sliver of rail at the left edge reads as a glitch.

import { usableHeight } from './safe-area.mjs';

/**
 * Side columns a view must not start inside of (the target being right of
 * them), as [element giving the left edge, element giving the right edge].
 */
const SIDE_COLUMNS = [
  ['#demo-cockpit #sidebar', '#demo-cockpit #sidebar'],
  ['#demo-vscode .vsc-activity', '#demo-vscode .vsc-explorer'],
];

const DURATION_MS = 750;
const EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';

/**
 * @param {HTMLElement} stage the clipping viewport (#demo-stage)
 * @param {HTMLElement} cam the transformed layer (#demo-camera)
 */
export function createCamera(stage, cam) {
  let s = 1;
  let tx = 0;
  let ty = 0;

  function _apply(animate) {
    cam.style.transition = animate ? `transform ${DURATION_MS}ms ${EASE}` : 'none';
    cam.style.transform = s === 1 && tx === 0 && ty === 0 ? '' : `translate(${tx}px, ${ty}px) scale(${s})`;
    cam.dataset.zoomed = s === 1 ? '0' : '1';
  }

  /**
   * The right edge (camera-local) of a side column the view would start
   * inside of, when the target lies to the right of that column; else null.
   * @param {number} nx candidate x offset
   * @param {number} z zoom
   * @param {number} lx target's left edge, camera-local
   * @returns {number|null}
   */
  function _columnEdge(nx, z, lx) {
    if (z === 1) return null;
    const box = stage.getBoundingClientRect();
    for (const [leftSel, rightSel] of SIDE_COLUMNS) {
      const a = cam.querySelector(leftSel);
      const b = cam.querySelector(rightSel);
      if (!a || !b || a.getClientRects().length === 0 || b.getClientRects().length === 0) continue;
      const left = (a.getBoundingClientRect().left - box.left - tx) / s;
      const right = (b.getBoundingClientRect().right - box.left - tx) / s;
      const viewLeft = -nx / z;
      if (lx >= right - 2 && viewLeft > left + 1 && viewLeft < right - 1) return right;
    }
    return null;
  }

  return {
    get zoom() { return s; },

    reset() { s = 1; tx = 0; ty = 0; _apply(false); },

    /**
     * Point the camera. `spec` is 'full' or { target: selector, zoom?: number }.
     * @param {string|object} spec
     * @param {{ animate: boolean, sleep: Function }} ctx
     */
    async set(spec, ctx) {
      const box = stage.getBoundingClientRect();
      if (spec === 'full' || !spec || !spec.target) {
        if (s === 1 && tx === 0 && ty === 0) return;
        s = 1; tx = 0; ty = 0;
      } else {
        const el = cam.querySelector(spec.target);
        if (!el) throw new Error('Demo: the camera could not find ' + spec.target);
        const r = el.getBoundingClientRect();
        // Back to camera-local coordinates (undo the CURRENT transform). The
        // size is the layout size (offsetWidth/Height): a modal that is still
        // running its opening scale animation would otherwise measure small.
        const lw = el.offsetWidth || r.width / s;
        const lh = el.offsetHeight || r.height / s;
        const lx = (r.left + r.width / 2 - box.left - tx) / s - lw / 2;
        const ly = (r.top + r.height / 2 - box.top - ty) / s - lh / 2;
        const availH = usableHeight(box);
        let z = Math.max(1, Math.min(spec.zoom || 1.5, 3));
        // A modal is framed whole: header, body and the footer buttons. It
        // floats over the rail, so the side-column rule below does not apply.
        const isModal = el.matches('.ds-modal, .ds-modal-overlay');
        if (isModal) {
          z = Math.max(1, Math.min(z, (box.width - 48) / lw, (availH - 32) / lh));
        }
        // A terminal is read line by line: its full width stays on stage, so
        // a long line wraps where the audience can see it, never past the edge.
        if (el.matches('.demo-term, #claude-terminal-panel')) z = Math.max(1, Math.min(z, box.width / lw));
        // A full-height terminal (the VS Code terminal editor tab) is taller
        // than the zoomed view: frame its NEWEST line, not its first one.
        const lastLine = el.matches('.demo-term') ? el.lastElementChild : null;
        const lastBottom = lastLine && lastLine.getClientRects().length
          ? (lastLine.getBoundingClientRect().bottom - box.top - ty) / s : null;
        const frame = (zz) => {
          let fx = box.width / 2 - (lx + lw / 2) * zz;
          let fy = availH / 2 - (ly + lh / 2) * zz;
          // A target bigger than the zoomed view is read from its start, not its middle.
          if (lw * zz > box.width) fx = 24 - lx * zz;
          if (lh * zz > availH) {
            fy = 24 - ly * zz;
            // ...except a terminal whose lines reach past the view: its newest
            // line sits just above the caption band, older ones scroll away.
            if (lastBottom !== null) fy = Math.min(fy, availH - 16 - Math.min(lastBottom, ly + lh) * zz);
          }
          // Never show empty space past an edge of the scene.
          fx = Math.min(0, Math.max(box.width - box.width * zz, fx));
          fy = Math.min(0, Math.max(box.height - box.height * zz, fy));
          return [fx, fy];
        };
        let [nx, ny] = frame(z);
        const edge = isModal ? null : _columnEdge(nx, z, lx);
        if (edge !== null) {
          // Start the view at the column's right edge; if the rest of the
          // scene is then narrower than the view, zoom in just enough to fill it.
          const fill = box.width / (box.width - edge);
          if (z < fill && fill <= 3) {
            z = fill;
            ny = frame(z)[1];
          }
          nx = Math.min(0, Math.max(box.width - box.width * z, -edge * z));
        }
        s = z; tx = Math.round(nx); ty = Math.round(ny);
      }
      _apply(ctx.animate);
      if (ctx.animate) await ctx.sleep(DURATION_MS + 40);
    },
  };
}
