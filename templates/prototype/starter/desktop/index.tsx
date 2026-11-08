// Mission Deck - prototype STARTER, kind: desktop (index.tsx)
//
// POST /api/prototypes (kind: desktop, the default) copies this file to
// data-sub-repositories/ds-data/prototypes/<id>/ and substitutes
// {{PROTO_NAME_JSON}} (through JSON.stringify) and {{PROTO_ID}}. Search for
// "CUSTOMIZE" to fit the starter to the scope of the accepted plan.
//
// What is here: the neutral application frame (top bar and side menu, from
// ../../components), two screens reached through the address hash
// (#/overview, #/work), and demo states for the overview (ready, empty,
// loading, error). Building blocks (buttons, cards, inputs, tables, dialogs,
// icons) come from ../../ds.
//
// Contract:
//   - default export: a React 18 component without props,
//   - export const breakpoints: number[],
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
import { AppFrame, NotInPrototype, type NavItem } from '../../components';
import { DSButton, DSCallout, DSCard, DSEmpty, DSLoader } from '../../ds';

// Name from the registry and id - literals substituted by the server.
const PROTOTYPE_NAME = {{PROTO_NAME_JSON}};
const PROTOTYPE_ID = '{{PROTO_ID}}';

// CUSTOMIZE: the widths the prototype really lays out for.
export const breakpoints = [1280, 1536, 1920];

// CUSTOMIZE: demo states - one row per screen / state to review. `id` is
// ASCII kebab-case. The FIRST entry is the base state (defaultId).
export const demoStates: DemoStateDef[] = [
  { id: 'overview', label: 'Overview', group: 'Overview' },
  { id: 'overview-empty', label: 'Overview - no data', group: 'Overview' },
  { id: 'overview-loading', label: 'Overview - loading', group: 'Overview' },
  { id: 'overview-error', label: 'Overview - error', group: 'Overview' },
  { id: 'work', label: 'Work screen', group: 'Work' },
];

// CUSTOMIZE: the menu of the product being prototyped.
const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'work', label: 'Work', icon: 'list' },
  { id: 'people', label: 'People', icon: 'users' },
];

type LoadState = 'ready' | 'empty' | 'loading' | 'error';

// Address: #/<nav id>. A screen can be opened by address and a reload stays on it.
function navFromHash(raw: string): string {
  const id = raw.replace(/^#\/?/, '').split('/')[0];
  return NAV.some((n) => n.id === id) ? id : 'overview';
}

// What each demo state starts from. The page below is keyed on the demo state,
// so a new state remounts it with these values (no effect that sets state).
function startFor(demoState: string): { nav: string | null; load: LoadState } {
  switch (demoState) {
    case 'overview-empty':
      return { nav: 'overview', load: 'empty' };
    case 'overview-loading':
      return { nav: 'overview', load: 'loading' };
    case 'overview-error':
      return { nav: 'overview', load: 'error' };
    case 'work':
      return { nav: 'work', load: 'ready' };
    case 'overview':
    default:
      return { nav: null, load: 'ready' }; // null keeps the address (a deep link)
  }
}

export default function StarterPrototype() {
  const demoState = useDemoState(demoStates, 'overview');
  return <Page key={demoState} demoState={demoState} />;
}

function Page({ demoState }: { demoState: string }) {
  const [start] = useState(() => startFor(demoState));
  const [nav, setNav] = useState(() => start.nav ?? navFromHash(window.location.hash));
  const [railCollapsed, setRailCollapsed] = useState(false);

  useEffect(() => {
    if (start.nav) window.history.replaceState(null, '', window.location.pathname + window.location.search + '#/' + start.nav);
    const onHash = () => setNav(navFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [start]);

  const onNavigate = (id: string) => {
    track('Nav Selected', { prototype: PROTOTYPE_ID, target: id });
    window.location.hash = '/' + id;
  };

  let content;
  if (nav === 'overview') content = <Overview load={start.load} />;
  else if (nav === 'work') content = <Work />;
  else content = <NotInPrototype label={NAV.find((n) => n.id === nav)?.label ?? nav} />;

  return (
    <div className="proto-starter" data-proto-id={PROTOTYPE_ID}>
      <AppFrame
        activeNav={nav}
        onNavigate={onNavigate}
        nav={NAV}
        brand={PROTOTYPE_NAME}
        railCollapsed={railCollapsed}
        onRailToggle={setRailCollapsed}
      >
        {content}
      </AppFrame>
    </div>
  );
}

// CUSTOMIZE: replace the overview with the real first screen.
function Overview({ load }: { load: LoadState }) {
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
        <DSButton icon="plus" onClick={() => track('Start Clicked', { prototype: PROTOTYPE_ID })}>
          Primary action
        </DSButton>
      </DSCard>
    );
  }
  return (
    <section className="proto-starter-page" data-track-screen="Starter > Overview">
      <h1 className="proto-starter-title">Overview</h1>
      {body}
    </section>
  );
}

// CUSTOMIZE: a second screen, to show that screens are reached by address.
function Work() {
  return (
    <section className="proto-starter-page" data-track-screen="Starter > Work">
      <h1 className="proto-starter-title">Work</h1>
      <DSCard>
        <p className="proto-starter-hint">A second screen. Open it from the menu or with #/work in the address.</p>
      </DSCard>
    </section>
  );
}
