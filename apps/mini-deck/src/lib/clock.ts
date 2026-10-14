export const TICK_MS = 60_000;

interface VisibilityTarget {
  visibilityState: string;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

interface ClockDeps {
  now: () => number;
  onTick: (now: number) => void;
  doc: VisibilityTarget;
  setIntervalFn: (fn: () => void, ms: number) => unknown;
  clearIntervalFn: (id: unknown) => void;
  intervalMs?: number;
}

/** Re-reads the clock every minute and whenever the page becomes visible. Returns a stop function. */
export function startClock(d: ClockDeps): () => void {
  const tick = () => d.onTick(d.now());
  const onVisible = () => {
    if (d.doc.visibilityState === 'visible') tick();
  };
  d.doc.addEventListener('visibilitychange', onVisible);
  const id = d.setIntervalFn(tick, d.intervalMs ?? TICK_MS);
  return () => {
    d.doc.removeEventListener('visibilitychange', onVisible);
    d.clearIntervalFn(id);
  };
}
