import { Icon } from '../ds';
import { toHash, type RouteId } from '../lib/hashRoute';
import { NAV } from './navItems';

interface NavProps {
  active: RouteId;
  variant: 'bottom' | 'side';
}

/** One nav component; the shell mounts it as the bottom bar or the side rail. */
export function Nav({ active, variant }: NavProps) {
  return (
    <nav className={`md-nav md-nav-${variant}`} aria-label="Screens">
      {NAV.map((n) => (
        <a key={n.id} href={toHash(n.id)} className="md-nav-item" aria-current={n.id === active ? 'page' : undefined}>
          <Icon name={n.icon} />
          <span>{n.label}</span>
        </a>
      ))}
    </nav>
  );
}
