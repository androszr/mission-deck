import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Shell } from './Shell';
import { StaleBanner } from './StaleBanner';

const base = { route: 'bugs' as const, generatedAt: undefined as string | null | undefined, now: 0, themePref: 'system' as const, onTheme: () => {} };

describe('shell', () => {
  it('phone: bottom nav with four screens, no side rail', () => {
    const html = renderToString(<Shell {...base} breakpoint="phone">x</Shell>);
    expect(html).toContain('md-nav-bottom');
    expect(html).not.toContain('md-nav-side');
    for (const h of ['#/sprints', '#/bugs', '#/on-call', '#/team']) expect(html).toContain(`href="${h}"`);
    expect(html).toContain('aria-current="page"');
  });
  it('desktop: side nav only, one nav tree', () => {
    const html = renderToString(<Shell {...base} breakpoint="desktop">x</Shell>);
    expect(html).toContain('md-nav-side');
    expect(html).not.toContain('md-nav-bottom');
    expect(html.match(/<nav/g)).toHaveLength(1);
  });
  it('stale banner shows only for stale data', () => {
    const now = Date.parse('2026-10-10T00:00:00Z');
    expect(renderToString(<StaleBanner generatedAt="2026-10-01T00:00:00Z" now={now} />).replace(/<!-- -->/g, '')).toContain("9 days old");
    expect(renderToString(<StaleBanner generatedAt="2026-10-09T23:00:00Z" now={now} />)).toBe('');
  });
  it('data loaded without a stamp says the age is unknown; loading says nothing', () => {
    expect(renderToString(<StaleBanner generatedAt={null} now={0} />)).toContain('cannot tell how old');
    expect(renderToString(<StaleBanner generatedAt={undefined} now={0} />)).toBe('');
  });
  it('the theme button has a distinct icon per preference', () => {
    const icons = (['light', 'dark', 'system'] as const).map((p) =>
      renderToString(<Shell {...base} breakpoint="phone" themePref={p}>x</Shell>).match(/<button.*?<\/button>/)?.[0]);
    expect(new Set(icons).size).toBe(3);
  });
});
