// Neutral application frame: the chrome every new prototype starts inside.
// Brand, brand icon, persona and menu are props (defaults below), so a team
// rebrands it from the prototype, not by editing this file. Desktop = top bar + collapsible left rail;
// phone = top bar + four bottom tabs. Prototypes never rebuild this chrome -
// they render their screen as children and pass the active nav id.
//
// The frame names the screen for analytics from `activeNav` unless an
// ancestor or the prototype itself already set `data-track-screen`.

import type { ReactNode } from 'react';
import { DSAvatar, DSIcon, DSIconButton, type IconName } from '../ds';
import './AppFrame.css';

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
}

export const DEFAULT_NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'work', label: 'Work', icon: 'list' },
  { id: 'people', label: 'People', icon: 'users' },
  { id: 'reports', label: 'Reports', icon: 'gauge' },
];

export interface Persona {
  name: string;
  role: string;
}

export const DEFAULT_PERSONA: Persona = { name: 'Alex Morgan', role: 'Team member' };
export const DEFAULT_BRAND = 'Prototype';
export const DEFAULT_BRAND_ICON: IconName = 'bolt';

export function AppFrame({
  activeNav,
  onNavigate,
  nav = DEFAULT_NAV,
  brand = DEFAULT_BRAND,
  brandIcon = DEFAULT_BRAND_ICON,
  persona = DEFAULT_PERSONA,
  railCollapsed = false,
  onRailToggle,
  title,
  notifications = 3,
  children,
}: {
  activeNav: string;
  onNavigate: (id: string) => void;
  nav?: NavItem[];
  brand?: string;
  brandIcon?: IconName;
  persona?: Persona;
  railCollapsed?: boolean;
  onRailToggle?: (collapsed: boolean) => void;
  title?: string;
  notifications?: number;
  children: ReactNode;
}) {
  const active = nav.find((n) => n.id === activeNav);
  return (
    <div className="af-root" data-track-screen={active ? `Frame > ${active.label}` : undefined}>
      <header className="af-top">
        <DSIconButton icon="menu" label={railCollapsed ? 'Expand menu' : 'Collapse menu'} variant="inverse" onClick={() => onRailToggle?.(!railCollapsed)} />
        <div className="af-brand">
          <span className="af-brand__mark" aria-hidden>
            <DSIcon name={brandIcon} size={18} />
          </span>
          <span className="af-brand__name">{brand}</span>
        </div>
        {title && <div className="af-top__title">{title}</div>}
        <div className="af-top__spacer" />
        <DSIconButton icon="bell" label="Notifications" variant="inverse" badge={notifications} />
        <div className="af-user">
          <DSAvatar name={persona.name} size={30} tone="info" />
          <span className="af-user__text">
            <span className="af-user__name">{persona.name}</span>
            <span className="af-user__role">{persona.role}</span>
          </span>
        </div>
      </header>
      <div className="af-body">
        <nav className={`af-rail${railCollapsed ? ' af-rail--collapsed' : ''}`} aria-label="Main menu">
          {nav.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`af-rail__item${n.id === activeNav ? ' af-rail__item--active' : ''}`}
              aria-current={n.id === activeNav ? 'page' : undefined}
              title={n.label}
              onClick={() => onNavigate(n.id)}
            >
              <DSIcon name={n.icon} />
              <span className="af-rail__label">{n.label}</span>
            </button>
          ))}
        </nav>
        <main className="af-main">{children}</main>
      </div>
    </div>
  );
}

export interface TabItem {
  id: string;
  label: string;
  icon: IconName;
  badge?: number;
}

/** Phone chrome: compact top bar + bottom tab bar. */
export function PhoneFrame({
  brandIcon = DEFAULT_BRAND_ICON,
  title,
  activeTab,
  tabs,
  onTab,
  onBack,
  banner,
  children,
}: {
  brandIcon?: IconName;
  title: string;
  activeTab: string;
  tabs: TabItem[];
  onTab: (id: string) => void;
  onBack?: () => void;
  banner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="pf-root">
      <header className="pf-top">
        {onBack ? <DSIconButton icon="chevron-left" label="Back" variant="inverse" onClick={onBack} /> : <span className="pf-top__mark" aria-hidden><DSIcon name={brandIcon} size={18} /></span>}
        <div className="pf-top__title">{title}</div>
        <DSIconButton icon="bell" label="Notifications" variant="inverse" />
      </header>
      {banner}
      <main className="pf-main">{children}</main>
      <nav className="pf-tabs" aria-label="Tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`pf-tabs__tab${t.id === activeTab ? ' pf-tabs__tab--active' : ''}`}
            aria-current={t.id === activeTab ? 'page' : undefined}
            onClick={() => onTab(t.id)}
          >
            <span className="pf-tabs__icon">
              <DSIcon name={t.icon} size={22} />
              {t.badge ? <span className="pf-tabs__badge">{t.badge}</span> : null}
            </span>
            <span className="pf-tabs__label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/** What a page outside the prototype's scope shows. */
export function NotInPrototype({ label }: { label: string }) {
  return (
    <div className="af-nip" data-track-screen={`Frame > ${label} (out of scope)`}>
      <span className="af-nip__icon">
        <DSIcon name="info" size={24} />
      </span>
      <div className="af-nip__title">This page is not part of the prototype</div>
      <div className="af-nip__text">&ldquo;{label}&rdquo; exists in the product menu, but this prototype only covers the screens it is testing.</div>
    </div>
  );
}
