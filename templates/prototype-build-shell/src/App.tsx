import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react'
import { BreakpointViewer, type DemoStateDef } from './BreakpointViewer'
import { LandingPage, type Claims } from './LandingPage'
import { PrototypePlaceholder } from './PrototypePlaceholder'
import { PROTOTYPE_CODES } from './prototype-codes'
import { PROTOTYPE_COMPONENTS } from './prototypes/registry'

const KNOWN_SLUGS = new Set(Object.values(PROTOTYPE_CODES))

// The registry's `load` type only promises `{ default }` (what React.lazy
// needs), but the resolved module namespace is the SAME object the
// prototype's own index.tsx exports from — so it also carries `demoStates`
// when the prototype declares it (contract: prototypes/_shared/demo-state.ts).
interface ProtoModuleNamespace {
  default: ComponentType
  demoStates?: DemoStateDef[]
}

// Registry is static per build (regenerated + rebuilt on every deploy), so
// every lazy component is created once at module load — never inside a
// render function (avoids the react-hooks/static-components diagnostic and
// is more correct than a runtime memoization cache). The underlying
// import() promise is memoized lazily, PER SLUG, on first access: eagerly
// calling every entry's `load()` here would start downloading and
// evaluating every deployed prototype's chunk at app boot regardless of
// which one the URL actually names, defeating the whole point of
// React.lazy's code splitting on a shell that can host many prototypes.
const LAZY_COMPONENTS: Record<string, ReturnType<typeof lazy>> = {}
const MODULE_PROMISES: Record<string, Promise<ProtoModuleNamespace>> = {}
function loadProtoModule(slug: string): Promise<ProtoModuleNamespace> {
  // A native dynamic import() is memoized by the module loader itself, so a
  // second call here (for demoStates, from DeployedPrototype's effect below)
  // resolves to the exact same namespace object react-lazy renders from —
  // never a second module evaluation.
  if (!MODULE_PROMISES[slug]) {
    MODULE_PROMISES[slug] = PROTOTYPE_COMPONENTS[slug].load() as Promise<ProtoModuleNamespace>
  }
  return MODULE_PROMISES[slug]
}
for (const slug of Object.keys(PROTOTYPE_COMPONENTS)) {
  LAZY_COMPONENTS[slug] = lazy(() => loadProtoModule(slug))
}

function resolveSlug(): string | null {
  const path = window.location.pathname.replace(/^\/|\/$/g, '')
  return path && KNOWN_SLUGS.has(path) ? path : null
}

interface DeployedPrototypeProps {
  slug: string
}

function DeployedPrototype({ slug }: DeployedPrototypeProps) {
  const entry = PROTOTYPE_COMPONENTS[slug]
  const LazyProto = LAZY_COMPONENTS[slug]
  // demoStates is read from the SAME module namespace `entry.load()` already
  // resolves for React.lazy — a plain-object export, not a component, so it
  // cannot come through Suspense. Read it once the module settles and hand
  // it to BreakpointViewer for the "Demo states" picker; a prototype with no
  // export (undefined) leaves the picker absent, never a broken one.
  const [demoStates, setDemoStates] = useState<DemoStateDef[] | undefined>(undefined)
  useEffect(() => {
    if (!entry) return undefined
    let cancelled = false
    loadProtoModule(slug)
      .then((mod) => {
        if (!cancelled && Array.isArray(mod.demoStates) && mod.demoStates.length > 0) {
          setDemoStates(mod.demoStates)
        }
      })
      .catch(() => { /* React.lazy's own Suspense boundary reports the load failure */ })
    return () => { cancelled = true }
  }, [slug, entry])

  if (!entry || !LazyProto) return <PrototypePlaceholder slug={slug} />
  return (
    <BreakpointViewer breakpoints={entry.breakpoints} demoStates={demoStates}>
      <Suspense fallback={null}><LazyProto /></Suspense>
    </BreakpointViewer>
  )
}

export function App() {
  const [claims, setClaims] = useState<Claims | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/auth/me')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setClaims)
      .catch(() => setError('Failed to load session claims.'))
  }, [])

  const slug = resolveSlug()
  if (slug) {
    return <DeployedPrototype slug={slug} />
  }
  return <LandingPage claims={claims} error={error} />
}
