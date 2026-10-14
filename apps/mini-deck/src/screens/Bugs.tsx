import { EmptyState, Screen } from './Screen';
import type { BugsData } from './types';

export function BugsView({ data }: { data: BugsData }) {
  if (data.bugs.length === 0) return <EmptyState title="No open bugs" />;
  return (
    <ul className="md-list">
      {data.bugs.map((b) => (
        <li key={b.id} className="md-card">
          <div className="md-row">
            <span className={`md-badge md-sev-${b.severity}`}>{b.severity}</span>
            <span className="md-muted">{b.id}</span>
          </div>
          <p className="md-goal">{b.title}</p>
          <div className="md-row md-muted">
            <span>{b.squad}</span>
            <span>
              {b.status}, {b.openDays} day{b.openDays === 1 ? '' : 's'} open
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function BugsScreen({ onData }: { onData?: (g: string | null | undefined) => void }) {
  return <Screen<BugsData> name="bugs" title="Prod bugs" onData={onData} render={(d) => <BugsView data={d} />} />;
}
