// Technician app - MOBILE example prototype.
//
// Question this prototype tests with technicians: does a safety checklist that
// GATES the start of work feel like help or like paperwork, and can a job be
// closed on site in under two minutes (parts, notes, photo, turbine back
// online)? The job the dispatcher assigned in the desktop prototype
// (proto-7f3a91c0d2e4, WO-1042) arrives here as "New".
//
// Phone only (375). Screens: Today, Job, Safety check, Work, Complete (sheet),
// Done. Hash routes: #/today, #/job/<id>, #/job/<id>/safety, #/job/<id>/work,
// #/done/<id>. Other tabs show the out-of-scope page.

import { useEffect, useState } from 'react';
import './styles.css';
import data from './data.json';
import { useDemoState, hasDemoStateParam, type DemoStateDef } from '../_shared/demo-state';
import { track } from '../_shared/analytics';
import { NotInPrototype, PhoneFrame, type TabItem } from '../../components';
import {
  DSBadge,
  DSBottomSheet,
  DSButton,
  DSCallout,
  DSCard,
  DSCheckbox,
  DSCounter,
  DSEmpty,
  DSIcon,
  DSInput,
  DSProgress,
  type Tone,
} from '../../ds';

const PROTOTYPE_ID = 'proto-2b8e64f1a9c7';

export const breakpoints = [375];

export const demoStates: DemoStateDef[] = [
  { id: 'today', label: 'Today - new critical job on top', group: 'Today' },
  { id: 'offline', label: 'Today - offline banner', group: 'Today' },
  { id: 'empty-day', label: 'Today - no jobs', group: 'Today' },
  { id: 'job', label: 'Job detail (WO-1042)', group: 'Job' },
  { id: 'safety', label: 'Safety check - nothing ticked', group: 'Safety check' },
  { id: 'safety-partial', label: 'Safety check - 3 of 5 ticked', group: 'Safety check' },
  { id: 'safety-done', label: 'Safety check - all ticked', group: 'Safety check' },
  { id: 'work', label: 'Work - tasks, parts, notes', group: 'Work' },
  { id: 'work-filled', label: 'Work - everything filled in', group: 'Work' },
  { id: 'complete-sheet', label: 'Complete job - confirmation sheet', group: 'Close the job' },
  { id: 'done', label: 'Job closed', group: 'Close the job' },
];

type Priority = 'critical' | 'high' | 'medium' | 'low';
interface Job {
  id: string;
  turbine: string;
  site: string;
  title: string;
  priority: Priority;
  window: string;
  distanceKm: number;
  estimateH: number;
  isNew: boolean;
  dispatcherNote: string;
  facts: Array<{ label: string; value: string }>;
  tasks: string[];
  parts: Array<{ id: string; name: string }>;
}

const JOBS = data.jobs as Job[];
const SAFETY = data.safety;
const PRIORITY: Record<Priority, { label: string; tone: Tone }> = {
  critical: { label: 'Critical', tone: 'danger' },
  high: { label: 'High', tone: 'warning' },
  medium: { label: 'Medium', tone: 'info' },
  low: { label: 'Low', tone: 'neutral' },
};

const TABS: TabItem[] = [
  { id: 'today', label: 'Today', icon: 'list', badge: 1 },
  { id: 'map', label: 'Map', icon: 'map-pin' },
  { id: 'messages', label: 'Messages', icon: 'message' },
  { id: 'profile', label: 'Profile', icon: 'user' },
];

// ---- routing ----------------------------------------------------------------

type Screen = 'today' | 'job' | 'safety' | 'work' | 'done' | 'map' | 'messages' | 'profile';
interface Route {
  screen: Screen;
  jobId: string | null;
}

function parseHash(raw: string): Route {
  const p = raw.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 'job' && p[1]) {
    const sub = p[2] === 'safety' ? 'safety' : p[2] === 'work' ? 'work' : 'job';
    return { screen: sub, jobId: p[1] };
  }
  if (p[0] === 'done' && p[1]) return { screen: 'done', jobId: p[1] };
  if (p[0] === 'map' || p[0] === 'messages' || p[0] === 'profile') return { screen: p[0] as Screen, jobId: null };
  return { screen: 'today', jobId: null };
}

function hashFor(r: Route): string {
  if (r.screen === 'job') return `#/job/${r.jobId}`;
  if (r.screen === 'safety' || r.screen === 'work') return `#/job/${r.jobId}/${r.screen}`;
  if (r.screen === 'done') return `#/done/${r.jobId}`;
  return `#/${r.screen}`;
}

const SCREEN_NAME: Record<Screen, string> = {
  today: 'Technician app > Today',
  job: 'Technician app > Job detail',
  safety: 'Technician app > Safety check',
  work: 'Technician app > Work',
  done: 'Technician app > Job closed',
  map: 'Technician app > Map (out of scope)',
  messages: 'Technician app > Messages (out of scope)',
  profile: 'Technician app > Profile (out of scope)',
};

// ---- component --------------------------------------------------------------

// One scenario = the interaction state a demo state starts from; everything
// not named is the baseline. The app below is keyed on the demo state, so a
// new state remounts it with these values as its initial state (no effect
// that sets state).
interface Scenario {
  route: Route | null; // null keeps the address as it is (a deep link on first load)
  checked: string[];
  tasksDone: number[];
  parts: Record<string, number>;
  notes: string;
  photos: number;
  sheet: boolean;
  offline: boolean;
  jobs: Job[];
}

const FILLED_WORK = {
  tasksDone: [0, 1, 2, 3],
  parts: { 'seal-kit': 1 },
  notes: 'Seal on pitch cylinder B leaking. Replaced seal kit, calibrated, 15 min test run without fault.',
  photos: 2,
};

function scenarioFor(demoState: string): Scenario {
  const today: Route = { screen: 'today', jobId: null };
  const at = (screen: Screen): Route => ({ screen, jobId: 'WO-1042' });
  const base: Scenario = { route: today, checked: [], tasksDone: [], parts: {}, notes: '', photos: 0, sheet: false, offline: false, jobs: JOBS };
  switch (demoState) {
    case 'offline':
      return { ...base, offline: true };
    case 'empty-day':
      return { ...base, jobs: [] };
    case 'job':
      return { ...base, route: at('job') };
    case 'safety':
      return { ...base, route: at('safety') };
    case 'safety-partial':
      return { ...base, route: at('safety'), checked: ['wind', 'loto', 'rescue'] };
    case 'safety-done':
      return { ...base, route: at('safety'), checked: SAFETY.map((s) => s.id) };
    case 'work':
      return { ...base, route: at('work'), tasksDone: [0] };
    case 'work-filled':
      return { ...base, route: at('work'), ...FILLED_WORK };
    case 'complete-sheet':
      return { ...base, route: at('work'), ...FILLED_WORK, sheet: true };
    case 'done':
      return { ...base, route: at('done'), ...FILLED_WORK };
    case 'today':
    default:
      // A plain first load keeps a deep link (#/job/WO-1042); an explicit ?state=today resets to Today.
      return hasDemoStateParam() ? base : { ...base, route: null };
  }
}

export default function TechnicianApp() {
  const demoState = useDemoState(demoStates, 'today');
  return <App key={demoState} demoState={demoState} />;
}

function App({ demoState }: { demoState: string }) {
  const [start] = useState(() => scenarioFor(demoState));
  const [route, setRoute] = useState<Route>(() => start.route ?? parseHash(window.location.hash));
  const [checked, setChecked] = useState<string[]>(start.checked);
  const [tasksDone, setTasksDone] = useState<number[]>(start.tasksDone);
  const [parts, setParts] = useState<Record<string, number>>(start.parts);
  const [notes, setNotes] = useState(start.notes);
  const [photos, setPhotos] = useState(start.photos);
  const [backOnline, setBackOnline] = useState(true);
  const [sheet, setSheet] = useState(start.sheet);
  const offline = start.offline;
  const jobs = start.jobs;

  useEffect(() => {
    // A scenario writes its screen into the address so a reload lands on it.
    if (start.route) window.history.replaceState(null, '', window.location.pathname + window.location.search + hashFor(start.route));
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [start]);

  // Each screen starts at the top - a phone keeps the old scroll otherwise.
  useEffect(() => {
    document.querySelector('.pf-main')?.scrollTo({ top: 0 });
  }, [route.screen, route.jobId]);

  const navigate = (r: Route) => {
    window.location.hash = hashFor(r).slice(1);
  };

  const job = jobs.find((j) => j.id === route.jobId) ?? null;
  const activeTab = route.screen === 'map' || route.screen === 'messages' || route.screen === 'profile' ? route.screen : 'today';

  let title = `Today, ${data.today}`;
  let onBack: (() => void) | undefined;
  let body;

  if (route.screen === 'today') {
    body = <TodayScreen jobs={jobs} offline={offline} onOpen={(id) => {
      track('Job Opened', { prototype: PROTOTYPE_ID, job: id });
      navigate({ screen: 'job', jobId: id });
    }} />;
  } else if ((route.screen === 'job' || route.screen === 'safety' || route.screen === 'work' || route.screen === 'done') && job) {
    title = job.id;
    onBack = () => navigate(route.screen === 'job' || route.screen === 'done' ? { screen: 'today', jobId: null } : { screen: 'job', jobId: job.id });
    if (route.screen === 'job') {
      body = <JobScreen job={job} onStart={() => {
        track('Safety Check Opened', { prototype: PROTOTYPE_ID, job: job.id });
        navigate({ screen: 'safety', jobId: job.id });
      }} />;
    } else if (route.screen === 'safety') {
      title = 'Safety check';
      body = (
        <SafetyScreen
          checked={checked}
          onToggle={(id, on) => {
            track('Safety Item Toggled', { prototype: PROTOTYPE_ID, item: id, on });
            setChecked((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));
          }}
          onStart={() => {
            track('Work Started', { prototype: PROTOTYPE_ID, job: job.id });
            navigate({ screen: 'work', jobId: job.id });
          }}
        />
      );
    } else if (route.screen === 'work') {
      title = `Working - ${job.turbine}`;
      body = (
        <WorkScreen
          job={job}
          tasksDone={tasksDone}
          onTask={(i) => setTasksDone((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))}
          parts={parts}
          onPart={(id, n) => setParts((prev) => ({ ...prev, [id]: n }))}
          notes={notes}
          onNotes={setNotes}
          photos={photos}
          onPhoto={() => {
            track('Photo Added', { prototype: PROTOTYPE_ID, job: job.id });
            setPhotos((n) => n + 1);
          }}
          onComplete={() => {
            track('Complete Sheet Opened', { prototype: PROTOTYPE_ID, job: job.id });
            setSheet(true);
          }}
        />
      );
    } else {
      title = 'Job closed';
      body = <DoneScreen job={job} next={jobs.find((j) => j.id !== job.id) ?? null} onNext={(id) => navigate({ screen: 'job', jobId: id })} />;
    }
  } else {
    title = TABS.find((t) => t.id === route.screen)?.label ?? 'Today';
    body = <NotInPrototype label={title} />;
  }

  return (
    <div className="tch-root" data-track-screen={SCREEN_NAME[route.screen]}>
      <PhoneFrame
        brandIcon="turbine"
        title={title}
        activeTab={activeTab}
        tabs={TABS}
        onTab={(id) => {
          track('Tab Selected', { prototype: PROTOTYPE_ID, tab: id });
          navigate({ screen: id as Screen, jobId: null });
        }}
        onBack={onBack}
        banner={
          offline ? (
            <div className="tch-offline" role="status">
              <DSIcon name="wifi-off" size={16} /> Offline - changes are saved on the phone and sent later.
            </div>
          ) : null
        }
      >
        {body}
      </PhoneFrame>
      <DSBottomSheet
        open={sheet && job !== null}
        title="Close this job?"
        onClose={() => setSheet(false)}
        trackScreen="Technician app > Close job sheet"
        footer={
          <>
            <DSButton
              fullWidth
              size="large"
              icon="check"
              onClick={() => {
                track('Job Closed', { prototype: PROTOTYPE_ID, job: job?.id, backOnline });
                setSheet(false);
                if (job) navigate({ screen: 'done', jobId: job.id });
              }}
            >
              Close job and send report
            </DSButton>
            <DSButton fullWidth variant="ghost" onClick={() => setSheet(false)}>
              Keep working
            </DSButton>
          </>
        }
      >
        {job && (
          <div className="tch-sheet">
            <SummaryRow icon="check" label="Tasks" value={`${tasksDone.length} of ${job.tasks.length}`} />
            <SummaryRow icon="package" label="Parts used" value={String(Object.values(parts).reduce((s, n) => s + n, 0))} />
            <SummaryRow icon="camera" label="Photos" value={String(photos)} />
            <SummaryRow icon="clock" label="Time on site" value="2 h 40 min" />
            <DSCheckbox checked={backOnline} onChange={setBackOnline} label="Turbine is back online" description="Dispatch sees it as producing again right away." />
          </div>
        )}
      </DSBottomSheet>
    </div>
  );
}

// ---- screens ----------------------------------------------------------------

function TodayScreen({ jobs, offline, onOpen }: { jobs: Job[]; offline: boolean; onOpen: (id: string) => void }) {
  const hours = jobs.reduce((s, j) => s + j.estimateH, 0);
  if (jobs.length === 0) {
    return (
      <div className="tch-pad">
        <DSEmpty icon="calendar" title="No jobs for today" description="Dispatch has not assigned anything yet. New jobs appear here with a sound." />
      </div>
    );
  }
  return (
    <div className="tch-pad tch-stack">
      <div className="tch-summary">
        <div>
          <div className="tch-summary__value">{jobs.length} jobs</div>
          <div className="tch-muted">about {hours} h - all at {jobs[0].site}</div>
        </div>
        <DSBadge tone={offline ? 'warning' : 'success'} dot>
          {offline ? 'Offline' : 'Synced'}
        </DSBadge>
      </div>
      {jobs.map((j) => (
        <DSCard key={j.id} padding="medium" onClick={() => onOpen(j.id)} selected={j.isNew} ariaLabel={`Open job ${j.id}`}>
          <div className="tch-job">
            <div className="tch-job__top">
              <DSBadge tone={PRIORITY[j.priority].tone} dot>
                {PRIORITY[j.priority].label}
              </DSBadge>
              {j.isNew && <DSBadge tone="accent">New from dispatch</DSBadge>}
              <span className="tch-job__time">{j.window}</span>
            </div>
            <div className="tch-job__title">{j.title}</div>
            <div className="tch-job__meta">
              <span>
                <DSIcon name="turbine" size={16} /> {j.turbine}
              </span>
              <span>
                <DSIcon name="route" size={16} /> {j.distanceKm} km
              </span>
              <span>
                <DSIcon name="clock" size={16} /> {j.estimateH} h
              </span>
            </div>
          </div>
        </DSCard>
      ))}
    </div>
  );
}

function JobScreen({ job, onStart }: { job: Job; onStart: () => void }) {
  return (
    <div className="tch-pad tch-stack">
      <div className="tch-stack tch-stack--tight">
        <div className="tch-row">
          <DSBadge tone={PRIORITY[job.priority].tone} dot>
            {PRIORITY[job.priority].label}
          </DSBadge>
          <span className="tch-muted">{job.window}</span>
        </div>
        <h1 className="tch-h1">{job.title}</h1>
        <div className="tch-muted">
          {job.turbine} - {job.site} - {job.distanceKm} km
        </div>
      </div>
      {job.facts.length > 0 && (
        <div className="tch-facts">
          {job.facts.map((f) => (
            <div key={f.label} className="tch-fact">
              <div className="tch-fact__value">{f.value}</div>
              <div className="tch-fact__label">{f.label}</div>
            </div>
          ))}
        </div>
      )}
      {job.dispatcherNote && (
        <DSCallout variant="info" title="Note from dispatch">
          {job.dispatcherNote}
        </DSCallout>
      )}
      {job.tasks.length > 0 && (
        <DSCard padding="medium">
          <div className="tch-section-title">Tasks</div>
          <ol className="tch-tasks-preview">
            {job.tasks.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </DSCard>
      )}
      <div className="tch-actions">
        <DSButton variant="secondary" icon="route" fullWidth>
          Navigate
        </DSButton>
        <DSButton icon="shield" fullWidth onClick={onStart}>
          Start safety check
        </DSButton>
      </div>
    </div>
  );
}

function SafetyScreen({ checked, onToggle, onStart }: { checked: string[]; onToggle: (id: string, on: boolean) => void; onStart: () => void }) {
  const all = checked.length === SAFETY.length;
  return (
    <div className="tch-pad tch-stack">
      <div className="tch-stack tch-stack--tight">
        <h1 className="tch-h1">Before you climb</h1>
        <div className="tch-muted">Work starts when all five are confirmed. This is logged with the job.</div>
      </div>
      <div className="tch-progress">
        <DSProgress value={checked.length} max={SAFETY.length} tone={all ? 'success' : 'accent'} label="Safety check progress" />
        <span className="tch-progress__label">
          {checked.length} / {SAFETY.length}
        </span>
      </div>
      <div className="tch-stack tch-stack--tight">
        {SAFETY.map((s) => (
          <DSCheckbox key={s.id} checked={checked.includes(s.id)} onChange={(on) => onToggle(s.id, on)} label={s.label} description={s.description} />
        ))}
      </div>
      {all ? (
        <DSCallout variant="success" title="All confirmed">
          Have a safe climb.
        </DSCallout>
      ) : null}
      <div className="tch-sticky">
        <DSButton fullWidth size="large" icon="wrench" disabled={!all} onClick={onStart}>
          {all ? 'Start work' : `Confirm ${SAFETY.length - checked.length} more to start`}
        </DSButton>
      </div>
    </div>
  );
}

function WorkScreen(props: {
  job: Job;
  tasksDone: number[];
  onTask: (i: number) => void;
  parts: Record<string, number>;
  onPart: (id: string, n: number) => void;
  notes: string;
  onNotes: (v: string) => void;
  photos: number;
  onPhoto: () => void;
  onComplete: () => void;
}) {
  const { job, tasksDone, parts, photos } = props;
  return (
    <div className="tch-pad tch-stack">
      <section className="tch-stack tch-stack--tight">
        <div className="tch-section-title">
          Tasks - {tasksDone.length} of {job.tasks.length}
        </div>
        {job.tasks.map((t, i) => (
          <DSCheckbox key={t} checked={tasksDone.includes(i)} onChange={() => props.onTask(i)} label={t} />
        ))}
      </section>
      <section className="tch-stack tch-stack--tight">
        <div className="tch-section-title">Parts used</div>
        {job.parts.map((p) => (
          <DSCard key={p.id} padding="small">
            <div className="tch-part">
              <span className="tch-part__name">{p.name}</span>
              <DSCounter value={parts[p.id] ?? 0} onChange={(n) => props.onPart(p.id, n)} label={p.name} max={9} />
            </div>
          </DSCard>
        ))}
      </section>
      <section className="tch-stack tch-stack--tight">
        <div className="tch-section-title">Photos</div>
        <div className="tch-photos">
          {Array.from({ length: photos }, (_, i) => (
            <span key={i} className="tch-photo" aria-label={`Photo ${i + 1}`} role="img">
              <DSIcon name="camera" size={20} />
              <span>Photo {i + 1}</span>
            </span>
          ))}
          <DSButton variant="secondary" icon="camera" onClick={props.onPhoto}>
            Add photo
          </DSButton>
        </div>
      </section>
      <DSInput label="What did you find and do?" value={props.notes} onChange={props.onNotes} multiline rows={3} placeholder="Short note for dispatch and the next technician" />
      <div className="tch-sticky">
        <DSButton fullWidth size="large" icon="check-circle" disabled={tasksDone.length < job.tasks.length} onClick={props.onComplete}>
          {tasksDone.length < job.tasks.length ? `${job.tasks.length - tasksDone.length} tasks left` : 'Complete job'}
        </DSButton>
      </div>
    </div>
  );
}

function DoneScreen({ job, next, onNext }: { job: Job; next: Job | null; onNext: (id: string) => void }) {
  return (
    <div className="tch-pad tch-done">
      <span className="tch-done__icon">
        <DSIcon name="check-circle" size={36} />
      </span>
      <h1 className="tch-h1">{job.id} closed</h1>
      <div className="tch-muted tch-center">Report sent. Dispatch sees {job.turbine} as producing again.</div>
      {next && (
        <DSCard padding="medium" onClick={() => onNext(next.id)} ariaLabel={`Open next job ${next.id}`}>
          <div className="tch-next">
            <div>
              <div className="tch-muted">Next - {next.window}</div>
              <div className="tch-job__title">{next.title}</div>
            </div>
            <DSIcon name="chevron-right" />
          </div>
        </DSCard>
      )}
    </div>
  );
}

function SummaryRow({ icon, label, value }: { icon: 'check' | 'package' | 'camera' | 'clock'; label: string; value: string }) {
  return (
    <div className="tch-sum-row">
      <DSIcon name={icon} size={18} />
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
