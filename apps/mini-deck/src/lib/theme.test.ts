import { describe, expect, it } from 'vitest';
import { applyStoredTheme, nextPref, normalizePref, resolveTheme } from './theme';

describe('theme', () => {
  it('resolves system by the OS setting', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
  it('explicit choices win', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('cycles light, dark, system', () => {
    expect(nextPref('light')).toBe('dark');
    expect(nextPref('dark')).toBe('system');
    expect(nextPref('system')).toBe('light');
  });
  it('tolerates junk from storage', () => {
    expect(normalizePref('purple')).toBe('system');
    expect(normalizePref(null)).toBe('system');
    expect(normalizePref('dark')).toBe('dark');
  });
  it('applies the stored theme to the root before render', () => {
    const root = { dataset: {} as Record<string, string | undefined> };
    expect(applyStoredTheme({ getItem: () => 'dark' }, false, root)).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
    applyStoredTheme({ getItem: () => null }, true, root);
    expect(root.dataset.theme).toBe('dark');
  });
  it('survives storage that throws', () => {
    const root = { dataset: {} as Record<string, string | undefined> };
    applyStoredTheme({ getItem: () => { throw new Error('denied'); } }, false, root);
    expect(root.dataset.theme).toBe('light');
  });
});
