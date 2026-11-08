// Local recorder for prototype analytics. Every `track()` event and every click
// inside the canvas is kept in memory only, so the viewer can show a per-screen
// click count - the same grouping a click heatmap uses (nearest
// `data-track-screen` ancestor). Nothing leaves the browser tab.

export interface RecordedEvent {
  /** Increasing number, unique within the tab: the row key in the Analytics menu. */
  seq: number;
  at: number;
  event: string;
  props?: Record<string, unknown>;
}

const events: RecordedEvent[] = [];
let nextSeq = 0;
const clicksByScreen = new Map<string, number>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function installRecorder(): () => void {
  const previous = window.analytics;
  window.analytics = {
    track(event, props) {
      previous?.track?.(event, props);
      events.push({ seq: nextSeq++, at: Date.now(), event, props });
      if (events.length > 200) events.shift();
      emit();
    },
  };
  const onClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target?.closest('[data-proto-canvas]')) return;
    const marked = target.closest('[data-track-screen]');
    const name = marked?.getAttribute('data-track-screen') || 'unknown screen';
    clicksByScreen.set(name, (clicksByScreen.get(name) ?? 0) + 1);
    emit();
  };
  document.addEventListener('click', onClick, true);
  return () => {
    document.removeEventListener('click', onClick, true);
    if (previous) window.analytics = previous;
    else delete window.analytics;
  };
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function snapshot() {
  return {
    events: events.slice(-12).reverse(),
    total: events.length,
    screens: [...clicksByScreen.entries()].sort((a, b) => b[1] - a[1]),
  };
}

export function resetRecorder() {
  events.length = 0;
  clicksByScreen.clear();
  emit();
}
