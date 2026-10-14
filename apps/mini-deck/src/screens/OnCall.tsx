import { EmptyState, Screen } from './Screen';
import type { OnCallData } from './types';

export function OnCallView({ data }: { data: OnCallData }) {
  if (data.rotations.length === 0) return <EmptyState title="No rotations" />;
  return (
    <ul className="md-list">
      {data.rotations.map((r) => (
        <li key={r.squad} className="md-card">
          <div className="md-row">
            <strong>{r.squad}</strong>
            <span className="md-muted">
              {r.from} to {r.to}
            </span>
          </div>
          <p className="md-goal">Primary: {r.primary}</p>
          <p className="md-muted">Secondary: {r.secondary}</p>
        </li>
      ))}
    </ul>
  );
}

export function OnCallScreen({ onData }: { onData?: (g: string | null | undefined) => void }) {
  return <Screen<OnCallData> name="on-call" title="On-call" onData={onData} render={(d) => <OnCallView data={d} />} />;
}
