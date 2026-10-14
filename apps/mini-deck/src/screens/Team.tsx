import { EmptyState, Screen } from './Screen';
import type { TeamData } from './types';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function TeamView({ data }: { data: TeamData }) {
  if (data.members.length === 0) return <EmptyState title="No team members" />;
  return (
    <ul className="md-list">
      {data.members.map((m) => (
        <li key={m.name} className="md-card md-person">
          {m.avatar ? (
            <img className="md-avatar md-avatar--img" src={`${import.meta.env.BASE_URL}${m.avatar}`} alt="" width={40} height={40} />
          ) : (
            <span className="md-avatar" aria-hidden="true">
              {initials(m.name)}
            </span>
          )}
          <div>
            <strong>{m.name}</strong>
            <p className="md-muted">
              {m.role}, {m.squad}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TeamScreen({ onData }: { onData?: (g: string | null | undefined) => void }) {
  return <Screen<TeamData> name="team" title="Team" onData={onData} render={(d) => <TeamView data={d} />} />;
}
