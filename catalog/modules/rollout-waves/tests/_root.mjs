// rollout-waves/tests/_root.mjs
// Finds the Mission Deck root (the directory holding server.js and js/)
// by walking up from this file, so the tests run both from an installed
// copy (modules/<id>/tests) and from the catalog (catalog/modules/<id>/tests).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function findAppRoot(start = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'server.js')) && fs.existsSync(path.join(dir, 'js'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Mission Deck root (server.js + js/) not found above ' + start);
}

export const APP_ROOT = findAppRoot();
