export type Breakpoint = 'phone' | 'tablet' | 'desktop';

export const TABLET_MIN = 768;
export const DESKTOP_MIN = 1024;

export function breakpointFor(width: number): Breakpoint {
  if (width >= DESKTOP_MIN) return 'desktop';
  if (width >= TABLET_MIN) return 'tablet';
  return 'phone';
}
