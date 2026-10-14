import { describeAge, staleness } from '../lib/staleness';

export function StaleBanner({ generatedAt, now }: { generatedAt: string | null | undefined; now: number }) {
  const s = staleness(generatedAt, now);
  if (s.state === 'fresh' || generatedAt === undefined /* still loading */) return null;
  const text =
    s.state === 'unknown'
      ? 'We cannot tell how old this data is.'
      : `This data is ${describeAge(s.ageHours ?? 0)} old.`;
  return (
    <div className="md-banner" role="alert">
      {text}
    </div>
  );
}
