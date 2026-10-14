import { describe, expect, it } from 'vitest';
import { breakpointFor } from './breakpoints';

describe('breakpoints', () => {
  it('maps widths', () => {
    expect(breakpointFor(390)).toBe('phone');
    expect(breakpointFor(767)).toBe('phone');
    expect(breakpointFor(768)).toBe('tablet');
    expect(breakpointFor(1023)).toBe('tablet');
    expect(breakpointFor(1024)).toBe('desktop');
  });
});
