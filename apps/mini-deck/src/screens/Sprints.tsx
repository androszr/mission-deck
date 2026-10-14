import { EmptyState, Screen } from './Screen';
import type { SprintsData } from './types';

export function SprintsView({ data }: { data: SprintsData }) {
  if (data.sprints.length === 0) return <EmptyState title="No sprints" />;
  return (
    <ul className="md-list">
      {data.sprints.map((s) => {
        const pct = s.committed > 0 ? Math.round((s.done / s.committed) * 100) : 0;
        return (
          <li key={s.id} className="md-card">
            <div className="md-row">
              <strong>{s.squad}</strong>
              <span className="md-muted">{s.name}</span>
            </div>
            <p className="md-goal">{s.goal}</p>
            <progress className="md-progress" value={pct} max={100} aria-label={`${s.squad} progress`} />
            <div className="md-row md-muted">
              <span>
                {s.done} of {s.committed} points
              </span>
              <span>{pct}%</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function SprintsScreen({ onData }: { onData?: (g: string | null | undefined) => void }) {
  return <Screen<SprintsData> name="sprints" title="Sprints" onData={onData} render={(d) => <SprintsView data={d} />} />;
}
