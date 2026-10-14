import { describe, expect, it } from 'vitest';
import { parseHash, toHash } from './hashRoute';

describe('hashRoute', () => {
  it('parses known routes', () => {
    expect(parseHash('#/bugs')).toBe('bugs');
    expect(parseHash('#/on-call')).toBe('on-call');
    expect(parseHash('#team')).toBe('team');
    expect(parseHash('#/sprints?x=1')).toBe('sprints');
  });
  it('falls back to sprints', () => {
    expect(parseHash('')).toBe('sprints');
    expect(parseHash('#/nope')).toBe('sprints');
  });
  it('round-trips', () => {
    expect(parseHash(toHash('on-call'))).toBe('on-call');
    expect(toHash('team')).toBe('#/team');
  });
});
