export type RouteId = 'sprints' | 'bugs' | 'on-call' | 'team';

export const ROUTES: readonly RouteId[] = ['sprints', 'bugs', 'on-call', 'team'];
export const DEFAULT_ROUTE: RouteId = 'sprints';

/** Parse `#/bugs` (or `#bugs`, or an empty string) into a known route id. */
export function parseHash(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return (ROUTES as readonly string[]).includes(id) ? (id as RouteId) : DEFAULT_ROUTE;
}

export function toHash(route: RouteId): string {
  return `#/${route}`;
}
