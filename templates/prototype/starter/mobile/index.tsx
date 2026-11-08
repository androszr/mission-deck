// Mission Deck - prototype STARTER, kind: mobile (index.tsx)
//
// POST /api/prototypes (kind: mobile) copies this file to
// data-sub-repositories/ds-data/prototypes/<id>/ and substitutes
// {{PROTO_NAME_JSON}} (through JSON.stringify) and {{PROTO_ID}}. Search for
// "CUSTOMIZE" to fit the starter to the scope of the accepted plan.
//
// What is here: the phone frame (compact top bar and bottom tabs, from
// ../../components), two tabs reached through the address hash (#/home,
// #/list), a bottom sheet and demo states for the home tab (ready, empty,
// loading, error, sheet open). Building blocks come from ../../ds.
//
// Contract:
//   - default export: a React 18 component without props,
//   - export const breakpoints: number[] (a phone prototype lists 375),
//   - export const demoStates: DemoStateDef[] read through useDemoState from
//     ../_shared/demo-state (the viewer owns `?state=`; never write it),
//   - every screen root and every DS layer carries a name for analytics:
//     data-track-screen="Area > Screen" / trackScreen="Area > Layer",
//   - meaningful actions call track('Event Name', { prototype: PROTOTYPE_ID }),
//   - imports only: react, ./styles.css, ../_shared/*, ../../ds, ../../components
//     (plus the libraries listed in scripts/_proto-imports.js),
//   - colours only through tokens, layout through `@container proto`.

import { useEffect, useState } from 'react';
import './styles.css';
import { useDemoState, type DemoStateDef } from '../_shared/demo-state';
import { track } from '../_shared/analytics';
import { PhoneFrame, type TabItem } from '../../components';
import { DSBottomSheet, DSButton, DSCallout, DSCard, DSEmpty, DSLoader } from '../../ds';

// Name from the registry and id - literals substituted by the server.
const PROTOTYPE_NAME = {{PROTO_NAME_JSON}};
const PROTOTYPE_ID = '{{PROTO_ID}}';

// CUSTOMIZE: a phone prototype lays out for 375.
export const breakpoints = [375];

// CUSTOMIZE: demo states - one row per screen / state to review. `id` is
// ASCII kebab-case. The FIRST entry is the base state (defaultId).
export const demoStates: DemoStateDef[] = [
  { id: 'home', label: 'Home', group: 'Home' },
  { id: 'home-empty', label: 'Home - no data', group: 'Home' },
  { id: 'home-loading', label: 'Home - loading', group: 'Home' },
  { id: 'home-error', label: 'Home - error', group: 'Home' },
  { id: 'home-sheet', label: 'Home - sheet open', group: 'Home' },
  { id: 'list', label: 'List tab', group: 'List' },
];

// CUSTOMIZE: the tabs of the product being prototyped.
const TABS: TabItem[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'list', label: 'List', icon: 'list' },
];

type LoadState = 'ready' | 'empty' | 'loading' | 'error';

// Address: #/<tab id>. A screen can be opened by address and a reload stays on it.
function tabFromHash(raw: string): string {
  const id = raw.replace(/^#\/?/, '').split('/')[0];
  return TABS.some((t) => t.id === id) ? id : 'home';
}

// What each demo state starts from. The page below is keyed on the demo state,
// so a new state remounts it with these values (no effect that sets state).
function startFor(demoState: string): { tab: string | null; load: LoadState; sheet: boolean } {
  switch (demoState) {
    case 'home-empty':
      return { tab: 'home', load: 'empty', sheet: false };
    case 'home-loading':
      return { tab: 'home', load: 'loading', sheet: false };
    case 'home-error':
      return { tab: 'home', load: 'error', sheet: false };
    case 'home-sheet':
      return { tab: 'home', load: 'ready', sheet: true };
    case 'list':
      return { tab: 'list', load: 'ready', sheet: false };
    case 'home':
    default:
      return { tab: null, load: 'ready', sheet: false }; // null keeps the address (a deep link)
  }
}

export default function StarterPrototype() {
  const demoState = useDemoState(demoStates, 'home');
  return <Page key={demoState} demoState={demoState} />;
}

function Page({ demoState }: { demoState: string }) {
  const [start] = useState(() => startFor(demoState));
  const [tab, setTab] = useState(() => start.tab ?? tabFromHash(window.location.hash));
  const [sheet, setSheet] = useState(start.sheet);

  useEffect(() => {
    if (start.tab) window.history.replaceState(null, '', window.location.pathname + window.location.search + '#/' + start.tab);
    const onHash = () => setTab(tabFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [start]);

  // Each screen starts at the top - a phone keeps the old scroll otherwise.
  useEffect(() => {
    document.querySelector('.pf-main')?.scrollTo({ top: 0 });
  }, [tab]);

  const title = tab === 'list' ? 'List' : PROTOTYPE_NAME;

  return (
    <div className="proto-starter" data-proto-id={PROTOTYPE_ID}>
      <PhoneFrame
        title={title}
        activeTab={tab}
        tabs={TABS}
        onTab={(id) => {
          track('Tab Selected', { prototype: PROTOTYPE_ID, tab: id });
          window.location.hash = '/' + id;
        }}
      >
        {tab === 'list' ? <ListTab /> : <HomeTab load={start.load} onOpenSheet={() => setSheet(true)} />}
      </PhoneFrame>
      <DSBottomSheet
        open={sheet}
        title="Sheet title"
        onClose={() => setSheet(false)}
        trackScreen="Starter > Sheet"
        footer={
          <DSButton fullWidth onClick={() => { track('Sheet Confirmed', { prototype: PROTOTYPE_ID }); setSheet(false); }}>
            Confirm
          </DSButton>
        }
      >
        <p className="proto-starter-hint">Room for a confirmation or a short form.</p>
      </DSBottomSheet>
    </div>
  );
}

// CUSTOMIZE: replace the home tab with the real first screen.
function HomeTab({ load, onOpenSheet }: { load: LoadState; onOpenSheet: () => void }) {
  let body;
  if (load === 'loading') {
    body = <DSLoader label="Loading..." />;
  } else if (load === 'empty') {
    body = <DSEmpty icon="list" title="Nothing here yet" description="This is how the screen looks without data." />;
  } else if (load === 'error') {
    body = (
      <DSCallout variant="danger" title="Something went wrong">
        The data could not be loaded. Pick another demo state to continue.
      </DSCallout>
    );
  } else {
    body = (
      <DSCard>
        <p className="proto-starter-hint">Room for the prototype&apos;s content.</p>
        <DSButton fullWidth onClick={() => { track('Sheet Opened', { prototype: PROTOTYPE_ID }); onOpenSheet(); }}>
          Open the sheet
        </DSButton>
      </DSCard>
    );
  }
  return (
    <section className="proto-starter-page" data-track-screen="Starter > Home">
      {body}
    </section>
  );
}

// CUSTOMIZE: a second tab, to show that screens are reached by address.
function ListTab() {
  return (
    <section className="proto-starter-page" data-track-screen="Starter > List">
      <DSCard>
        <p className="proto-starter-hint">A second tab. Open it from the tab bar or with #/list in the address.</p>
      </DSCard>
    </section>
  );
}
