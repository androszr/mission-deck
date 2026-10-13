// demo/chapters/summary.mjs
// Chapter `summary`: the closing board. Every earlier chapter lands as a
// ds-card tile with its signature Pip, one after another, then one closing
// sentence and thanks. The global ending card follows this chapter.

import { narrate } from './_helpers.mjs';
import { PODSUMOWANIE_IDS } from '../mocks/ch-summary.mjs';

export default {
  steps: [
    {
      id: 'podsumowanie-plansza',
      caption: 'I gather everything on one **board** — every chapter is a piece of everyday work.',
      mascot: 'celebrating',
      camera: 'full',
      actions: [
        narrate('Everything on one board', 'From the starter pack, through the vault, the training and your own module, to reports, the roadmap, sprints and Claude skills — this is what working with Mission Deck looks like from start to finish.'),
        { type: 'surface', show: 'screen', mock: 'podsumowanie-board' },
        ...PODSUMOWANIE_IDS.map((id) => ({ type: 'show', mock: 'podsumowanie-tile', target: '#podsumowanie-grid', mode: 'append', props: { id } })),
        { type: 'wait', ms: 600 },
      ],
    },
    {
      id: 'podsumowanie-koniec',
      caption: 'That is all for today — **thank you**, and see you in Mission Deck!',
      mascot: 'success',
      camera: 'full',
      actions: [
        narrate('To finish', 'Mission Deck is one place for team data, modules, prototypes and skills, with Claude Code at hand. Every chapter of this demo can be opened again from the table of contents or from Settings > Demo.'),
        { type: 'hide', target: '#podsumowanie-closing', hidden: false },
      ],
    },
  ],
};
