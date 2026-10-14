import type { ReactNode } from 'react';
import { Icon } from '../ds';
import type { Breakpoint } from '../lib/breakpoints';
import type { RouteId } from '../lib/hashRoute';
import type { ThemePref } from '../lib/theme';
import { Nav } from './Nav';
import { NAV } from './navItems';
import { StaleBanner } from './StaleBanner';

interface ShellProps {
  breakpoint: Breakpoint;
  route: RouteId;
  generatedAt: string | null | undefined;
  now: number;
  themePref: ThemePref;
  onTheme: () => void;
  children: ReactNode;
}

/** The nav is mounted as a side rail on desktop and a bottom bar otherwise: one tree, chosen in code. */
export function Shell({ breakpoint, route, generatedAt, now, themePref, onTheme, children }: ShellProps) {
  const desktop = breakpoint === 'desktop';
  const title = NAV.find((n) => n.id === route)?.label ?? 'Mini Deck';
  return (
    <div className={`md-shell md-${breakpoint}`}>
      {desktop ? <Nav active={route} variant="side" /> : null}
      <div className="md-main">
        <header className="md-header">
          <h1>{title}</h1>
          <button type="button" className="md-icon-btn" onClick={onTheme} aria-label={`Theme: ${themePref}. Tap to change.`}>
            <Icon name={`theme-${themePref}`} />
          </button>
        </header>
        <StaleBanner generatedAt={generatedAt} now={now} />
        <main className="md-content">{children}</main>
      </div>
      {desktop ? null : <Nav active={route} variant="bottom" />}
    </div>
  );
}
