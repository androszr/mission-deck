import type { IconName } from '../ds';
import type { RouteId } from '../lib/hashRoute';

export const NAV: readonly { id: RouteId; label: string; icon: IconName }[] = [
  { id: 'sprints', label: 'Sprints', icon: 'sprints' },
  { id: 'bugs', label: 'Prod bugs', icon: 'bugs' },
  { id: 'on-call', label: 'On-call', icon: 'on-call' },
  { id: 'team', label: 'Team', icon: 'team' },
];
