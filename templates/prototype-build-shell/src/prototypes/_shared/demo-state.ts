// Demo-state contract shared by every prototype in the build shell.
//
// A prototype exports `demoStates: DemoStateDef[]` and reads the active one
// with `useDemoState(demoStates, defaultId)`. The viewer (BreakpointViewer)
// owns the URL: picking a scenario replaces `?state=<id>` and dispatches a
// synthetic popstate, which this hook listens to.
//
// A team may replace this file with its own copy under
// <team data>/prototypes/_shared/demo-state.ts - the build copies that folder
// over this one before every preview and publish.

import { useEffect, useState } from 'react'

export interface DemoStateDef {
  /** ASCII kebab-case; round-trips through the `?state=` URL param. */
  id: string
  /** Human label shown in the viewer's picker. */
  label: string
  /** Optional caption that clusters items in the picker. */
  group?: string
}

const DEMO_STATE_PARAM = 'state'

function readState(states: DemoStateDef[], fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const raw = new URLSearchParams(window.location.search).get(DEMO_STATE_PARAM)
  return raw && states.some((s) => s.id === raw) ? raw : fallback
}

/**
 * The active demo state id: `?state=` when it names a declared state, else
 * `defaultId`. Re-reads the URL on popstate (the viewer's picker).
 */
export function useDemoState(states: DemoStateDef[], defaultId: string): string {
  const [state, setState] = useState(() => readState(states, defaultId))
  useEffect(() => {
    const onPop = () => setState(readState(states, defaultId))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [states, defaultId])
  return state
}
