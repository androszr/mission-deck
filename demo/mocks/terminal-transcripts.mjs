// demo/mocks/terminal-transcripts.mjs
// Terminal transcripts the scenario replays line by line. A transcript is
// DATA: an array of { role, text } lines in the shape the `terminal` action
// takes (roles: cmd, out, ok, warn, err, dim, claude, user, tool, assistant).
// Log lines are copied from what the real scripts print, so the demo shows
// the terminal a person actually sees - the demo itself runs none of it.

/** Where the starter package is unpacked: a plain local folder, never a synced one. */
export const STARTER_DIR = '~/Projects/mission-deck';

/**
 * `npm start` in the unpacked starter: npm's own echo, then server.js boot
 * lines. A fresh starter has no modules yet, so no `[modules] loaded:` line.
 */
export const NPM_START = [
  { role: 'cmd', cwd: STARTER_DIR, text: 'npm start' },
  { role: 'dim', text: '' },
  { role: 'dim', text: '> mission-deck@1.0.0 start' },
  { role: 'dim', text: '> node scripts/kill-port.js && node server.js' },
  { role: 'dim', text: '' },
  { role: 'ok', text: 'Mission Deck -> http://localhost:3001' },
];

/**
 * Unpacking the starter zip downloaded from the team's document library
 * (nobody clones: the zip is a `git archive`, no .git inside). macOS unzip
 * output, shortened; the top folder is mission-deck, the name VS Code shows.
 */
export const UNZIP_STARTER = [
  { role: 'cmd', cwd: '~', text: 'mkdir -p ~/Projects && cd ~/Projects && unzip ~/Downloads/mission-deck-starter.zip' },
  { role: 'out', text: 'Archive:  /Users/you/Downloads/mission-deck-starter.zip' },
  { role: 'out', text: '   creating: mission-deck/' },
  { role: 'out', text: '  inflating: mission-deck/package.json' },
  { role: 'out', text: '  inflating: mission-deck/server.js' },
  { role: 'out', text: '   creating: mission-deck/docs/guides/' },
  { role: 'dim', text: '  ...' },
  { role: 'cmd', cwd: '~/Projects', text: 'ls' },
  { role: 'ok', text: 'mission-deck' },
];

/** `npm install` with the default profile (.npmrc omit=dev). */
export const NPM_INSTALL = [
  { role: 'cmd', cwd: STARTER_DIR, text: 'npm install' },
  { role: 'out', text: 'added 4 packages, and audited 5 packages in 3s' },
  { role: 'ok', text: 'found 0 vulnerabilities' },
];

export const TRANSCRIPTS = { NPM_START, UNZIP_STARTER, NPM_INSTALL };
