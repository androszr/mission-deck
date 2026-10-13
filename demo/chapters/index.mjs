// demo/chapters/index.mjs
// Bodies of the chapters after `onboarding`, one file each (written in parallel).

import Settings from './settings.mjs';
import Academy from './academy.mjs';
import NowyModul from './new-module.mjs';
import Publikacja from './publishing.mjs';
import Katalog from './catalog.mjs';
import UzycieModulu from './using-a-module.mjs';
import Design from './design.mjs';
import Synchronizacja from './sync.mjs';
import Spotkania from './meetings.mjs';
import CzasPracy from './time-tracking.mjs';
import Roadmap from './roadmap.mjs';
import Team from './team.mjs';
import Sprinty from './sprints.mjs';
import SkilleIAgenci from './skills-and-agents.mjs';
import Aktualizacja from './updates.mjs';
import Summary from './summary.mjs';
import KluczeDlaZespolu from './team-keys.mjs';
import KoniecIStartDnia from './day-cycle.mjs';
import DyzuryIUrlopy from './on-call-and-time-off.mjs';
import JiraConfluence from './jira-confluence.mjs';
import Instrukcje from './guides.mjs';
import Feedback from './feedback.mjs';

/** Chapter id -> body ({ setup?, steps, pages? }) or null for a placeholder. */
export const CHAPTER_BODIES = {
  'settings': Settings,
  'academy': Academy,
  'new-module': NowyModul,
  'publishing': Publikacja,
  'catalog': Katalog,
  'using-a-module': UzycieModulu,
  'design': Design,
  'sync': Synchronizacja,
  'meetings': Spotkania,
  'time-tracking': CzasPracy,
  'roadmap': Roadmap,
  'team': Team,
  'sprints': Sprinty,
  'skills-and-agents': SkilleIAgenci,
  'updates': Aktualizacja,
  'summary': Summary,
  'team-keys': KluczeDlaZespolu,
  'day-cycle': KoniecIStartDnia,
  'on-call-and-time-off': DyzuryIUrlopy,
  'jira-confluence': JiraConfluence,
  'guides': Instrukcje,
  'feedback': Feedback,
};
