export type StaleState = 'fresh' | 'stale' | 'unknown';

export interface Staleness {
  state: StaleState;
  ageHours: number | null;
}

export const STALE_AFTER_HOURS = 24;

export function staleness(
  generatedAt: string | null | undefined,
  now: number,
  thresholdHours: number = STALE_AFTER_HOURS,
): Staleness {
  const at = generatedAt ? Date.parse(generatedAt) : NaN;
  if (Number.isNaN(at)) return { state: 'unknown', ageHours: null };
  const ageHours = Math.max(0, (now - at) / 3_600_000);
  return { state: ageHours > thresholdHours ? 'stale' : 'fresh', ageHours };
}

/** "3 hours", "2 days": a short English age for the banner. */
export function describeAge(ageHours: number): string {
  if (ageHours < 1) return 'less than an hour';
  if (ageHours < 48) {
    const h = Math.floor(ageHours);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  return `${Math.floor(ageHours / 24)} days`;
}
