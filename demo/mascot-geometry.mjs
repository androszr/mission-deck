// demo/mascot-geometry.mjs
// Where Pip actually stands inside each pose's SVG canvas. Every pose ships
// on the same 128x128 canvas (assets/mascot/pip-<pose>.svg); `vb` is the
// file's viewBox, `box` the figure's bounding box in the same units, measured
// once from the files (including the badge, sparks or confetti a pose adds).
// tests/test_demo_scenario.mjs checks `vb` against the files so a redrawn pose
// cannot drift silently.
// The narrator frame is sized to `box` and the <img> is offset inside it, so
// every pose renders at the same figure height, aligned to the text baseline.

export const MASCOT_GEOMETRY = {
  'celebrating': { vb: [0, 0, 128, 128], box: [7.5, 0, 113, 127] },
  'error': { vb: [0, 0, 128, 128], box: [9.5, 6, 109, 121] },
  'idle': { vb: [0, 0, 128, 128], box: [9.5, 6.5, 109, 120.5] },
  'sleeping': { vb: [0, 0, 128, 128], box: [9.5, 0, 117.5, 127] },
  'success': { vb: [0, 0, 128, 128], box: [9.5, 6.5, 109, 120.5] },
  'thinking': { vb: [0, 0, 128, 128], box: [9.5, 2, 114.5, 125] },
  'wave': { vb: [0, 0, 128, 128], box: [9.5, 6.5, 118.5, 120.5] },
  'working': { vb: [0, 0, 128, 128], box: [9.5, 6.5, 109, 120.5] },
};

/**
 * Poses whose figure is out of sight for part of the animation. Pip never
 * leaves the frame, so the list is empty; it stays exported because the
 * scenario validator and the summary tiles still ask the question.
 */
export const MASCOT_HIDDEN_POSES = [];
