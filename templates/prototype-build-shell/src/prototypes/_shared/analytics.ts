/**
 * Analytics contract shared by every prototype.
 *
 *   - `track(event, props)` sends one event through the optional global
 *     `window.analytics`. The viewer installs a local in-memory recorder; a
 *     host that has a product-analytics SDK may install its own. Optional
 *     chained, so a prototype never breaks without it.
 *   - Every screen, step and window carries `data-track-screen="Area > Screen"`
 *     on its root. A click heatmap groups clicks by the nearest ancestor with
 *     that attribute; a click without one lands in "unknown screen".
 *   - Floating layers (modal, sheet) render outside the screen's DOM subtree,
 *     so they carry their own name (`trackScreen` prop of the DS layer).
 */
declare global {
  interface Window {
    analytics?: { track: (event: string, props?: Record<string, unknown>) => void }
  }
}

export function track(event: string, props?: Record<string, unknown>): void {
  window.analytics?.track(event, props)
}

export const SCREEN_ATTR = 'data-track-screen'
