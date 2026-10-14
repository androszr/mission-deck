import { describe, expect, it } from 'vitest';
import { describeAge, staleness } from './staleness';

const NOW = Date.parse('2026-10-10T12:00:00Z');

describe('staleness', () => {
  it('is fresh inside the threshold', () => {
    expect(staleness('2026-10-10T06:00:00Z', NOW)).toEqual({ state: 'fresh', ageHours: 6 });
  });
  it('is stale past the threshold', () => {
    expect(staleness('2026-10-08T12:00:00Z', NOW).state).toBe('stale');
  });
  it('honours a custom threshold', () => {
    expect(staleness('2026-10-10T06:00:00Z', NOW, 4).state).toBe('stale');
  });
  it('is unknown without a usable date', () => {
    expect(staleness(undefined, NOW).state).toBe('unknown');
    expect(staleness('garbage', NOW).ageHours).toBeNull();
  });
  it('never goes negative for a future stamp', () => {
    expect(staleness('2026-10-11T12:00:00Z', NOW).ageHours).toBe(0);
  });
  it('describes ages', () => {
    expect(describeAge(0.2)).toBe('less than an hour');
    expect(describeAge(1)).toBe('1 hour');
    expect(describeAge(30)).toBe('30 hours');
    expect(describeAge(96)).toBe('4 days');
  });
});
