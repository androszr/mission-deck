// demo/mocks/index.mjs
// The one mock registry. A scenario names a mock by id (`show.mock`,
// `modal.open`, `surface.mock`, `pages[].mock`); the engine looks it up here.
// A new chapter registers its painters by adding one file and one spread
// below - the engine never changes for it.

import { esc } from './common.mjs';
import * as shell from './shell.mjs';
import * as onboarding from './onboarding.mjs';
import * as chStart from './ch-start.mjs';
import * as chZgloszenia from './ch-feedback.mjs';
import * as chInstrukcje from './ch-guides.mjs';
import * as chJiraConfluence from './ch-jira-confluence.mjs';
import * as chDyzuryIUrlopy from './ch-on-call-and-time-off.mjs';
import * as chKoniecIStartDnia from './ch-day-cycle.mjs';
import * as chKluczeDlaZespolu from './ch-team-keys.mjs';
import * as chUstawienia from './ch-settings.mjs';
import * as chSzkolenie from './ch-academy.mjs';
import * as chNowyModul from './ch-new-module.mjs';
import * as chPublikacja from './ch-publishing.mjs';
import * as chKatalog from './ch-catalog.mjs';
import * as chUzycieModulu from './ch-using-a-module.mjs';
import * as chDesign from './ch-design.mjs';
import * as chSynchronizacja from './ch-sync.mjs';
import * as chSpotkania from './ch-meetings.mjs';
import * as chCzasPracy from './ch-time-tracking.mjs';
import * as chRoadmapa from './ch-roadmap.mjs';
import * as chZespol from './ch-team.mjs';
import * as chSprinty from './ch-sprints.mjs';
import * as chSkilleIAgenci from './ch-skills-and-agents.mjs';
import * as chAktualizacja from './ch-updates.mjs';
import * as chPodsumowanie from './ch-summary.mjs';

const GENERIC = {
  /** Plain escaped text - for a title, a counter or a status line. */
  text: ({ text = '' } = {}) => esc(text),
  /** Empty - clears a container. */
  empty: () => '',
};

export const MOCKS = {
  ...GENERIC,
  ...shell.MOCKS,
  ...onboarding.MOCKS,
  ...chStart.MOCKS,
  ...chZgloszenia.MOCKS,
  ...chInstrukcje.MOCKS,
  ...chJiraConfluence.MOCKS,
  ...chDyzuryIUrlopy.MOCKS,
  ...chKoniecIStartDnia.MOCKS,
  ...chKluczeDlaZespolu.MOCKS,
  ...chUstawienia.MOCKS,
  ...chSzkolenie.MOCKS,
  ...chNowyModul.MOCKS,
  ...chPublikacja.MOCKS,
  ...chKatalog.MOCKS,
  ...chUzycieModulu.MOCKS,
  ...chDesign.MOCKS,
  ...chSynchronizacja.MOCKS,
  ...chSpotkania.MOCKS,
  ...chCzasPracy.MOCKS,
  ...chRoadmapa.MOCKS,
  ...chZespol.MOCKS,
  ...chSprinty.MOCKS,
  ...chSkilleIAgenci.MOCKS,
  ...chAktualizacja.MOCKS,
  ...chPodsumowanie.MOCKS,
};

/** Every visible label the mocks paint, for the copy gate in tests. */
export const LABELS = [
  ...shell.LABELS,
  ...onboarding.LABELS,
  ...chStart.LABELS,
  ...chZgloszenia.LABELS,
  ...chInstrukcje.LABELS,
  ...chJiraConfluence.LABELS,
  ...chDyzuryIUrlopy.LABELS,
  ...chKoniecIStartDnia.LABELS,
  ...chKluczeDlaZespolu.LABELS,
  ...chUstawienia.LABELS,
  ...chSzkolenie.LABELS,
  ...chNowyModul.LABELS,
  ...chPublikacja.LABELS,
  ...chKatalog.LABELS,
  ...chUzycieModulu.LABELS,
  ...chDesign.LABELS,
  ...chSynchronizacja.LABELS,
  ...chSpotkania.LABELS,
  ...chCzasPracy.LABELS,
  ...chRoadmapa.LABELS,
  ...chZespol.LABELS,
  ...chSprinty.LABELS,
  ...chSkilleIAgenci.LABELS,
  ...chAktualizacja.LABELS,
  ...chPodsumowanie.LABELS,
];

/**
 * Paint one mock. Unknown id throws: a scenario that names a missing mock is
 * a bug validateScenario() should have caught, never a blank box.
 * @param {string} id
 * @param {object} [props]
 * @returns {string}
 */
export function renderMock(id, props) {
  const fn = MOCKS[id];
  if (typeof fn !== 'function') throw new Error('Nieznana makieta: ' + id);
  return fn(props || {});
}
