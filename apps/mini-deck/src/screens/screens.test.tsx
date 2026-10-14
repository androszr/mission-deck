import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BugsView } from './Bugs';
import { OnCallView } from './OnCall';
import { SprintsView } from './Sprints';
import { TeamView } from './Team';
import type { BugsData, OnCallData, SprintsData, TeamData } from './types';

const text = (html: string) => html.replace(/<!-- -->/g, '');

function load<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(__dirname, `../../public/data/${name}.json`), 'utf8')) as T;
}

describe('screens render their baked JSON', () => {
  it('Sprints', () => {
    const data = load<SprintsData>('sprints');
    const html = text(renderToString(<SprintsView data={data} />));
    expect(html).toContain('Atlas');
    expect(html).toContain('Falcon');
    expect(html).toContain('29 of 34 points');
  });
  it('Prod bugs', () => {
    const data = load<BugsData>('bugs');
    const html = text(renderToString(<BugsView data={data} />));
    expect(html).toContain('BUG-105');
    expect(html).toContain('critical');
  });
  it('On-call', () => {
    const html = text(renderToString(<OnCallView data={load<OnCallData>('on-call')} />));
    expect(html).toContain('Primary: Ada Lindqvist');
  });
  it('Team', () => {
    const html = text(renderToString(<TeamView data={load<TeamData>('team')} />));
    expect(html).toContain('Wren Ashby');
    expect(html).toContain('avatars/wren-ashby.svg');
    expect(html).not.toContain('>WA<');
  });
  it('Team falls back to initials when a member has no avatar', () => {
    const html = renderToString(<TeamView data={{ generatedAt: '', members: [{ name: 'Wren Ashby', role: 'QA', squad: 'Falcon' }] }} />);
    expect(html).toContain('>WA<');
  });
  it('shows Pip when a list is empty', () => {
    const html = renderToString(<TeamView data={{ generatedAt: '', members: [] }} />);
    expect(html).toContain('pip-sleeping.svg');
    expect(html).toContain('No team members');
  });
});
