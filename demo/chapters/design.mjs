// demo/chapters/design.mjs
// Chapter `design`: the core hub "Design" - the Design System page (tokens
// read from css/ds-tokens.css, then the components tab), the icon catalog (a
// search, then "Copy SVG"), the illustrations and the mascot gallery, where
// the narrator meets himself.
//
// "Copy SVG" flips its own label to "Copied!" - there is no toast.

import { narrate, VAULT_OPEN } from './_helpers.mjs';

export default {
  setup: [
    // The four sections are not lifted from /index.html; appending them here
    // lets the flyout click activate the real header + subtitle at once.
    { type: 'show', mock: 'design-sections', target: 'main.main', mode: 'append' },
    VAULT_OPEN,
  ],
  steps: [
    {
      id: 'design-katalog',
      caption: 'I open the **Design System** - every token the screens are painted with.',
      mascot: 'wave',
      actions: [
        narrate('The Design hub', 'The "Design" hub on the rail collects everything screens are built from: tokens, components, icons, illustrations and the mascot. It all ships with the repository - nothing to download.'),
        { type: 'navigate', view: 'assets-design-system' },
        { type: 'camera', target: '#assets-design-system-root .asv-toolbar', zoom: 1.4 },
        { type: 'wait', ms: 600 },
        { type: 'camera', target: '#design-token-brand', zoom: 1.8 },
      ],
    },
    {
      id: 'design-komponent',
      caption: 'I switch to **Components** - buttons, badges and callouts drawn with those tokens.',
      mascot: 'working',
      actions: [
        narrate('Components', 'The second tab shows the DS components themselves. A prototype or a module uses the same classes, so it looks like the rest of the app without a single colour of its own.'),
        { type: 'click', target: '#design-tab-components' },
        { type: 'show', mock: 'design-ds-root', target: '#assets-design-system-root', props: { tab: 'components' } },
        { type: 'camera', target: '#design-comp-buttons', zoom: 1.6 },
      ],
    },
    {
      id: 'design-ikony-szukaj',
      caption: 'I search the icons for **calendar** - five matches.',
      mascot: 'thinking',
      camera: 'full',
      actions: [
        narrate('Icons', 'The "Icons" page lists every icon the app and its modules use. The search matches the icon name and slug, so "calendar" narrows the set to the calendar icons.', '24-ic-calendar'),
        { type: 'navigate', view: 'assets-icons' },
        { type: 'type', target: '#assets-icons-search', text: 'calendar' },
        { type: 'show', mock: 'design-icons-root', target: '#assets-icons-root', props: { query: 'calendar' } },
        { type: 'camera', target: '#assets-icons-root .asv-toolbar', zoom: 1.25 },
      ],
    },
    {
      id: 'design-ikony-kopiuj',
      caption: 'I copy the **SVG** source - ready to paste into a prototype.',
      mascot: 'success',
      actions: [
        narrate('Copy SVG', 'The button under an icon copies its SVG source to the clipboard and briefly reads "Copied!". In a prototype the icon is referenced by its file name.', '24-ic-calendar'),
        { type: 'camera', target: '#design-icon-calendar', zoom: 2 },
        { type: 'click', target: '#design-icon-calendar .asv-copy-btn' },
        { type: 'show', mock: 'design-copy-done', target: '#design-icon-calendar .asv-copy-btn' },
        { type: 'wait', ms: 700 },
      ],
    },
    {
      id: 'design-ilustracje',
      caption: 'I browse the **illustrations** - empty states and welcome screens.',
      mascot: 'celebrating',
      camera: 'full',
      actions: [
        narrate('Illustrations', 'Illustrations work like icons: preview, search and copy the SVG source. They fill empty states, modals and onboarding.'),
        { type: 'navigate', view: 'assets-illustrations' },
        { type: 'camera', target: '#design-ill-working', zoom: 1.3 },
      ],
    },
    {
      id: 'design-mascot',
      caption: 'And this is the **mascot** gallery - I get to meet myself!',
      mascot: 'wave',
      camera: 'full',
      actions: [
        narrate('Mascot', 'The "Mascot" page shows every pose of Pip with the name an empty state passes to use it. We look for the happy ones.'),
        { type: 'navigate', view: 'assets-mascot' },
        { type: 'type', target: '#assets-mascot-search', text: 'happy' },
        { type: 'show', mock: 'design-mascot-root', target: '#assets-mascot-root', props: { query: 'happy' } },
        { type: 'camera', target: '#assets-mascot-grid', zoom: 1.8 },
      ],
    },
    {
      id: 'design-koniec',
      caption: 'One **shared** look - prototypes, modules and Mission Deck all take it from here.',
      mascot: 'success',
      actions: [
        narrate('One look for everything', 'Tokens, components, icons and illustrations in this hub are the single source of the look: prototypes, modules and Mission Deck itself use the same files.'),
        { type: 'camera', target: '#design-mascot-focus', zoom: 2.2 },
        { type: 'wait', ms: 900 },
        { type: 'camera', full: true },
        // The closing frame: the whole gallery again, not two cards.
        { type: 'type', target: '#assets-mascot-search', text: '' },
        { type: 'show', mock: 'design-mascot-root', target: '#assets-mascot-root', props: { query: '' } },
      ],
    },
  ],
};
