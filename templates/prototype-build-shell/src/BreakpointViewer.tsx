import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import './BreakpointViewer.css'

// Six breakpoint presets — mirrors the cockpit standalone viewer
// (js/prototypy.js:1258, _PROTO_BREAKPOINTS). Kept in sync by convention;
// the deploy pipeline's server-side default (server.js
// PROTO_DEPLOY_DEFAULT_BREAKPOINTS) uses the same six numbers.
const PRESETS = [375, 768, 960, 1280, 1536, 1920]
const BREAKPOINT_STORAGE_KEY = 'protoBreakpoint'
const MOBILE_QUERY = '(max-width: 768px)'

// Minimal, LOCAL mirror of prototypes/_shared/demo-state.ts's DemoStateDef.
// Deliberately not imported from that path: the viewer must not depend on a
// prototype-side module.
export interface DemoStateDef {
  /** ASCII kebab-case; round-trips through the `?state=` URL param. */
  id: string
  /** Human label shown in this picker. */
  label: string
  /** Optional caption that clusters items in the picker (e.g. 'Basics'). */
  group?: string
}

const DEMO_STATE_PARAM = 'state'

/** Current `?state=` value, or null when absent. Read-only — never writes. */
function readDemoStateFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get(DEMO_STATE_PARAM)
}

// Same contract as prototypes/_shared/demo-state.ts's useDemoState: the
// VIEWER owns the URL. Selecting a scenario replaces `?state=` and then
// dispatches a SYNTHETIC popstate so the mounted prototype's own
// useDemoState() re-reads the URL and resets its state on the new scenario.
// `replaceState` (not `pushState`): every demo-state pick becoming a
// Back-button stop is not what "state" means for this control.
function writeDemoStateToUrl(id: string): void {
  const url = new URL(window.location.href)
  url.searchParams.set(DEMO_STATE_PARAM, id)
  window.history.replaceState(window.history.state, '', url.toString())
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** First-appearance-order groups, for the `<optgroup>` layout in the picker. */
function groupDemoStates(states: DemoStateDef[]): Array<{ group: string | null; items: DemoStateDef[] }> {
  const groups: Array<{ group: string | null; items: DemoStateDef[] }> = []
  const indexByGroup = new Map<string | null, number>()
  for (const s of states) {
    const key = s.group ?? null
    let idx = indexByGroup.get(key)
    if (idx === undefined) {
      idx = groups.length
      indexByGroup.set(key, idx)
      groups.push({ group: key, items: [] })
    }
    groups[idx].items.push(s)
  }
  return groups
}

const MOBILE_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="7" y="2" width="10" height="20" rx="2" />
    <path d="M11 18h2" />
  </svg>
)

const DESKTOP_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
)

// Largest preset that fits `winWidth`; falls back to the narrowest preset
// when the window is smaller than every preset (mirrors
// js/prototypy.js:_autoProtoBreakpoint).
function autoBreakpoint(winWidth: number, allowed: number[] = PRESETS): number {
  const pool = allowed.length ? allowed : PRESETS
  let best = pool[0]
  for (const bp of pool) {
    if (bp <= winWidth) best = bp
  }
  return best
}

// Reads the persisted preset. No legacy `protoViewport` migration here
// (different origin app, no legacy key to migrate) — an absent/invalid
// stored value auto-fits to the current window width instead of defaulting
// to the narrowest preset. Mirrors js/prototypy.js:_loadProtoBreakpoint
// minus the legacy-migration branch.
function loadInitialBreakpoint(): number {
  try {
    const raw = window.localStorage.getItem(BREAKPOINT_STORAGE_KEY)
    if (raw !== null) {
      const n = parseInt(raw, 10)
      if (PRESETS.includes(n)) return n
      if (Number.isFinite(n) && n >= PRESETS[0] && n <= PRESETS[PRESETS.length - 1]) {
        return PRESETS.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a))
      }
    }
  } catch {
    /* private mode / storage unavailable */
  }
  return autoBreakpoint(window.innerWidth)
}

function persistBreakpoint(bp: number) {
  try {
    window.localStorage.setItem(BREAKPOINT_STORAGE_KEY, String(bp))
  } catch {
    /* private mode / storage unavailable */
  }
}

const TOOLBAR_POS_KEY = 'protoToolbarPos'

function loadToolbarPos(): { left: number; top: number } | null {
  try {
    const raw = window.localStorage.getItem(TOOLBAR_POS_KEY)
    if (raw) {
      const { left, top } = JSON.parse(raw)
      if (typeof left === 'number' && typeof top === 'number') return { left, top }
    }
  } catch { /* */ }
  return null
}

function persistToolbarPos(left: number, top: number) {
  try {
    window.localStorage.setItem(TOOLBAR_POS_KEY, JSON.stringify({ left, top }))
  } catch { /* */ }
}

interface FrameKind {
  kind: 'none' | 'phone' | 'placeholder' | 'mobile'
  width: number | null
}

// Resolves the frame kind AND the canvas width for the CURRENT preset,
// honoring declared breakpoints. `width` is always the EXACT selected
// preset in px — never derived from the actual window/viewport size. A
// preset wider than the real window is a deliberate overflow: .bv-canvas
// scrolls to it instead of the canvas silently shrinking to "whatever
// fits", which was the bug (a 768px+ desktop preset used to measure at the
// window's full width, so choosing 960 vs 1920 rendered identically at a
// narrow browser width — the preset button was not proof of the pixel
// width actually laid out).
//
// Undeclared 375 shows the placeholder (no canvas mounted at all — mounted
// but hidden, see .bv-frame--placeholder). Undeclared desktop presets are
// unreachable in practice (the segment button is `disabled`), but still
// resolve to a real width defensively rather than to null.
function resolveFrameKind(bp: number, declared: number[]): FrameKind {
  if (!declared.includes(bp)) {
    if (bp <= 375) return { kind: 'placeholder', width: null }
    return { kind: 'none', width: bp }
  }
  return { kind: bp <= 375 ? 'phone' : 'none', width: bp }
}

interface BreakpointViewerProps {
  breakpoints: number[]
  children: ReactNode
  /** From the mounted prototype's own `demoStates` export; absent = no picker. */
  demoStates?: DemoStateDef[]
}

export function BreakpointViewer({ breakpoints, children, demoStates }: BreakpointViewerProps) {
  const declared = useMemo(
    () => (Array.isArray(breakpoints) && breakpoints.length ? breakpoints : PRESETS.slice()),
    [breakpoints],
  )

  const [bp, setBp] = useState(loadInitialBreakpoint)
  const [winWidth, setWinWidth] = useState(() => window.innerWidth)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)

  const toolbarRef = useRef<HTMLDivElement | null>(null)

  // URL state is independent of the asynchronously loaded scenario metadata.
  const [demoStateId, setDemoStateId] = useState(() => readDemoStateFromUrl() || '')
  const selectedDemoStateId = demoStates?.some((state) => state.id === demoStateId)
    ? demoStateId
    : demoStates?.[0]?.id || ''

  useEffect(() => {
    const onPop = () => setDemoStateId(readDemoStateFromUrl() || '')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const handleDemoStateChange = (id: string) => {
    setDemoStateId(id)
    writeDemoStateToUrl(id)
  }

  // Debounced resize auto-switch: on every (debounced) resize, snap to the
  // largest preset that fits the new window width. A manual click sticks
  // only until the next resize (mirrors
  // js/prototypy.js:_registerBreakpointResizeListener).
  useEffect(() => {
    const initial = autoBreakpoint(window.innerWidth, declared)
    // Deferred to avoid synchronous setState in effect body
    queueMicrotask(() => {
      setBp((prev) => {
        if (declared.includes(prev)) return prev
        persistBreakpoint(initial)
        return initial
      })
    })
  }, [declared])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onResize = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const w = window.innerWidth
        setWinWidth(w)
        const nextBp = autoBreakpoint(w, declared)
        setBp((prev) => {
          if (nextBp === prev) return prev
          persistBreakpoint(nextBp)
          return nextBp
        })
      }, 150)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (timer) clearTimeout(timer)
    }
  }, [declared])

  // Mobile media-query tracking — drives the "no toolbar, no frame" mode.
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  // Restore persisted toolbar position on mount.
  useEffect(() => {
    const el = toolbarRef.current
    if (!el) return
    const saved = loadToolbarPos()
    if (saved) {
      const maxX = window.innerWidth - el.offsetWidth
      const maxY = window.innerHeight - el.offsetHeight
      const left = Math.max(0, Math.min(saved.left, maxX))
      const top = Math.max(0, Math.min(saved.top, maxY))
      el.style.left = `${left}px`
      el.style.top = `${top}px`
      el.style.right = 'auto'
    }
  }, [])

  // Draggable toolbar — pointer/touch handlers ported from
  // js/prototypy.js:_makeToolbarDraggable. Ignores clicks on the segment
  // buttons themselves (drag starts only from empty pill chrome).
  useEffect(() => {
    const el = toolbarRef.current
    if (!el) return

    let startX = 0
    let startY = 0
    let elX = 0
    let elY = 0
    let dragging = false

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging) return
      const point = 'touches' in e ? e.touches[0] : e
      const cx = point.clientX
      const cy = point.clientY
      let nx = elX + (cx - startX)
      let ny = elY + (cy - startY)
      const maxX = window.innerWidth - el.offsetWidth
      const maxY = window.innerHeight - el.offsetHeight
      nx = Math.max(0, Math.min(nx, maxX))
      ny = Math.max(0, Math.min(ny, maxY))
      el.style.left = `${nx}px`
      el.style.top = `${ny}px`
      el.style.right = 'auto'
    }
    const onUp = () => {
      if (dragging) {
        const rect = el.getBoundingClientRect()
        persistToolbarPos(rect.left, rect.top)
      }
      dragging = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onUp)
    }
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('button, select, option')) return
      dragging = true
      const point = 'touches' in e ? e.touches[0] : e
      const cx = point.clientX
      const cy = point.clientY
      const rect = el.getBoundingClientRect()
      startX = cx
      startY = cy
      elX = rect.left
      elY = rect.top
      el.style.left = `${rect.left}px`
      el.style.top = `${rect.top}px`
      el.style.right = 'auto'
      e.preventDefault()
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.addEventListener('touchmove', onMove, { passive: false })
      document.addEventListener('touchend', onUp)
    }

    el.addEventListener('mousedown', onDown)
    el.addEventListener('touchstart', onDown, { passive: false })
    return () => {
      el.removeEventListener('mousedown', onDown)
      el.removeEventListener('touchstart', onDown)
      onUp()
    }
  }, [])

  const handleSelect = (nextBp: number) => {
    if (nextBp === bp) return
    setBp(nextBp)
    persistBreakpoint(nextBp)
  }

  const frame: FrameKind = isMobile
    ? { kind: 'mobile', width: null }
    : resolveFrameKind(bp, declared)

  const cqStyle: { width: string; display?: 'none' } = {
    width: frame.width ? `${frame.width}px` : '100%',
  }
  if (frame.kind === 'placeholder') {
    cqStyle.display = 'none'
  }

  const demoStateGroups = demoStates && demoStates.length > 0 ? groupDemoStates(demoStates) : null

  return (
    <div className="bv-root">
      {!isMobile && (
        <div className="bv-toolbar" ref={toolbarRef}>
          <div className="bv-drag-handle" aria-hidden="true">
            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
              <circle cx="2" cy="2" r="1.5" /><circle cx="8" cy="2" r="1.5" />
              <circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" />
              <circle cx="2" cy="14" r="1.5" /><circle cx="8" cy="14" r="1.5" />
            </svg>
          </div>
          <div className="bv-segmented">
            {PRESETS.map((preset, i) => {
              const active = preset === bp
              const available = declared.includes(preset)
              const oversized = preset > winWidth
              const last = PRESETS.length - 1
              const mobileOnly = declared.length === 1 && declared[0] <= 375
              const disabledTitle = mobileOnly
                ? 'This prototype exists only in a mobile version'
                : `Width ${preset}px — in preparation`
              return (
                <button
                  key={preset}
                  type="button"
                  className={`bv-segment${active ? ' active' : ''}${!available ? ' bv-segment--disabled' : ''}${oversized && !active && available ? ' bv-segment--oversized' : ''}`}
                  aria-pressed={active}
                  disabled={!available}
                  title={available ? undefined : disabledTitle}
                  onClick={() => available && handleSelect(preset)}
                >
                  {i === 0 ? MOBILE_ICON : i === last && preset >= 1920 ? DESKTOP_ICON : null}
                  <span>{preset}</span>
                </button>
              )
            })}
          </div>
          {demoStateGroups && (
            <select
              className="bv-state-select"
              aria-label="Demo states"
              value={selectedDemoStateId}
              onChange={(e) => handleDemoStateChange(e.target.value)}
            >
              {demoStateGroups.map((g) => {
                const options = g.items.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))
                return g.group
                  ? <optgroup key={g.group} label={g.group}>{options}</optgroup>
                  : options
              })}
            </select>
          )}
        </div>
      )}

      <div className={`bv-canvas${isMobile ? ' bv-canvas--mobile' : ''}`}>
        <div className={`bv-frame bv-frame--${frame.kind}`}>
          {/* Lid wrapper — shrink-wraps the cq-root so the phone bezel /
              MacBook lid always align to the active preset width. Always
              present (styled as a no-op by bv-frame--none/placeholder) so
              the cq-root's position in the tree never changes. */}
          <div className="bv-lid">
            <div className="bv-frame-chrome-phone" aria-hidden="true">
              <div className="bv-phone-notch" />
            </div>
            <div className="proto-cq-root" style={cqStyle}>
              {children}
            </div>
            {!isMobile && frame.kind === 'placeholder' && (
              <div className="bv-placeholder">
                <div className="bv-placeholder-icon">
                  {bp <= 375 ? MOBILE_ICON : DESKTOP_ICON}
                </div>
                <div className="bv-placeholder-label">{`Width ${bp}px — in preparation`}</div>
                <div className="bv-placeholder-desc">
                  This view of the prototype has not been built yet. It will appear here in a later iteration.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
