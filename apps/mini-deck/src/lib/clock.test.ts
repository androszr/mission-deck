import { describe, expect, it } from 'vitest';
import { startClock } from './clock';
import { staleness } from './staleness';

function fakes() {
  let t = Date.parse('2026-10-10T00:00:00Z');
  const handlers: Array<() => void> = [];
  let interval: (() => void) | null = null;
  let cleared = false;
  const doc = {
    visibilityState: 'visible',
    addEventListener: (_t: 'visibilitychange', fn: () => void) => void handlers.push(fn),
    removeEventListener: (_t: 'visibilitychange', fn: () => void) => void handlers.splice(handlers.indexOf(fn), 1),
  };
  return {
    doc, handlers,
    advance: (ms: number) => { t += ms; },
    now: () => t,
    setIntervalFn: (fn: () => void) => { interval = fn; return 1; },
    clearIntervalFn: () => { cleared = true; },
    fire: () => interval?.(),
    wasCleared: () => cleared,
  };
}

describe('clock', () => {
  it('flips the banner state once the threshold passes', () => {
    const f = fakes();
    const seen: string[] = [];
    const stamp = '2026-10-09T12:00:00Z';
    const stop = startClock({ ...f, onTick: (n) => seen.push(staleness(stamp, n).state) });
    f.advance(60_000);
    f.fire();
    f.advance(13 * 3_600_000);
    f.fire();
    expect(seen).toEqual(['fresh', 'stale']);
    stop();
  });
  it('ticks when the page becomes visible, not when hidden', () => {
    const f = fakes();
    let n = 0;
    startClock({ ...f, onTick: () => { n += 1; } });
    f.doc.visibilityState = 'hidden';
    f.handlers[0]();
    expect(n).toBe(0);
    f.doc.visibilityState = 'visible';
    f.handlers[0]();
    expect(n).toBe(1);
  });
  it('cleans up', () => {
    const f = fakes();
    const stop = startClock({ ...f, onTick: () => {} });
    stop();
    expect(f.handlers).toHaveLength(0);
    expect(f.wasCleared()).toBe(true);
  });
});
