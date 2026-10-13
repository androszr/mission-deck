// Mission Deck - prototype STARTER (index.tsx)
//
// POST /api/prototypes copies this file (the only starter) to
// data-sub-repositories/ds-data/prototypes/<id>/ and substitutes
// {{PROTO_NAME_JSON}} (through JSON.stringify) and {{PROTO_ID}}. Search for
// "CUSTOMIZE" to fit the starter to the scope of the accepted plan.
//
// What is here: ONE empty screen for the prototype's content, with demo
// states (ready, empty, loading, error). No frame, no design-system package:
// the prototype styles itself with the build shell's tokens.
//
// Contract:
//   - default export: a React 18 component without props,
//   - export const breakpoints: number[],
//   - export const demoStates: DemoStateDef[] read through useDemoState
//     from ../_shared/demo-state (the viewer owns `?state=`),
//   - imports only: react, ./styles.css, ../_shared/* (plus the libraries
//     listed in scripts/_proto-imports.js),
//   - colours only through tokens, layout through `@container proto`.

import './styles.css';
import { useDemoState, type DemoStateDef } from '../_shared/demo-state';

// Name from the registry and id - literals substituted by the server.
const PROTOTYPE_NAME = {{PROTO_NAME_JSON}};
const PROTOTYPE_ID = '{{PROTO_ID}}';

// CUSTOMIZE: the widths the prototype really lays out for.
export const breakpoints = [375, 768, 960, 1280, 1536, 1920];

// CUSTOMIZE: demo states - one row per screen / state to review. `id` is
// ASCII kebab-case. The FIRST entry is the base state (defaultId).
export const demoStates: DemoStateDef[] = [
  { id: 'screen', label: 'Prototype screen', group: 'Prototype screen' },
  { id: 'screen-empty', label: 'Prototype screen - no data', group: 'Prototype screen' },
  { id: 'screen-loading', label: 'Prototype screen - loading', group: 'Prototype screen' },
  { id: 'screen-error', label: 'Prototype screen - error', group: 'Prototype screen' },
];

export default function StarterPrototype() {
  const state = useDemoState(demoStates, 'screen');

  // CUSTOMIZE: replace each branch with the real screen for that state.
  let content;
  if (state === 'screen-loading') {
    content = <p className="proto-starter-hint" role="status">Loading...</p>;
  } else if (state === 'screen-empty') {
    content = (
      <>
        <h1 className="proto-starter-title">Nothing here yet</h1>
        <p className="proto-starter-hint">This is how the screen looks without data.</p>
      </>
    );
  } else if (state === 'screen-error') {
    content = (
      <div className="proto-starter-error" role="alert">
        <h1 className="proto-starter-title">Something went wrong</h1>
        <p className="proto-starter-hint">The data could not be loaded. Pick another demo state to continue.</p>
      </div>
    );
  } else {
    content = (
      <>
        <h1 className="proto-starter-title">{PROTOTYPE_NAME}</h1>
        <p className="proto-starter-hint">Room for the prototype&apos;s content.</p>
      </>
    );
  }

  return (
    <main className="proto-starter" data-proto-id={PROTOTYPE_ID}>
      <div className="proto-starter-slot">{content}</div>
    </main>
  );
}
