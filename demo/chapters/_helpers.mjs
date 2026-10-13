// demo/chapters/_helpers.mjs
// Shared builders for chapter files. A chapter file default-exports either
// null (still a placeholder) or { setup?, steps, pages? } - the title card
// fields (id, title, subtitle, mascot) come from CHAPTERS in demo/scenario.mjs.

/** One narrate action; `command` adds the "Copy command" button. */
export const narrate = (title, body, command) => (command ? { type: 'narrate', title, body, command } : { type: 'narrate', title, body });

/**
 * The vault as every chapter after `onboarding` finds it: unlocked (the
 * onboarding unlocked it, and a server restart does not lock it again). Put
 * into a chapter's `setup`, so the top-bar pill is green from the first frame.
 */
export const VAULT_OPEN = { type: 'show', mock: 'topbar-bw', target: '#topbar-bw-root', props: { unlocked: true } };

/** The demo's one "today" (a Sunday): every "now" timestamp in the chapters uses it. */
export const DEMO_TODAY = '04.10.2026';

/**
 * The anonymization step, painted the same way in every chapter that hands
 * data to Claude: a deterministic local script runs BEFORE the model reads a
 * word. The repository has no such script, so the lines name the step, never
 * a file path or a command.
 * @param {string} intro what goes through it ("the transcript goes through anonymization, ...")
 * @param {string} result the counter ("214 fields replaced - ...")
 * @returns {Array<{ role: string, text: string }>}
 */
export const anonymize = (intro, result) => [
  { role: 'dim', text: 'Anonymization step (local script): ' + intro },
  { role: 'ok', text: 'Anonymization step (local script): ' + result },
];
