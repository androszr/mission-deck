export interface Baked {
  generatedAt: string;
}
export interface Sprint {
  id: string;
  name: string;
  squad: string;
  start: string;
  end: string;
  committed: number;
  done: number;
  goal: string;
}
export interface SprintsData extends Baked {
  sprints: Sprint[];
}
export interface Bug {
  id: string;
  title: string;
  squad: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: string;
  openDays: number;
}
export interface BugsData extends Baked {
  bugs: Bug[];
}
export interface Rotation {
  squad: string;
  primary: string;
  secondary: string;
  from: string;
  to: string;
}
export interface OnCallData extends Baked {
  rotations: Rotation[];
}
export interface Member {
  name: string;
  role: string;
  squad: string;
  /** Path under the app's base URL to a fruit avatar; initials when absent. */
  avatar?: string;
}
export interface TeamData extends Baked {
  members: Member[];
}
