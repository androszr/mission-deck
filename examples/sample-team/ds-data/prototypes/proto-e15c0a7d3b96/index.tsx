// Operations briefing - DEMO example prototype (a self-playing presentation).
//
// A briefing is a prototype too: same contract, same viewer, same publish
// path. It is how a change is explained to shift leads and operations
// managers who will never open the clickable prototypes themselves.
//
// How it is built (docs/05-demo-briefings.md):
//   - content.json holds chapters and steps (card, agenda, why, compare,
//     screen, phone, faq, summary) and the guide's caption for each step -
//     the caption IS the narration script (subtitles = what is spoken);
//   - `screen` / `phone` steps show REAL frames of the clickable prototypes,
//     recorded by harness/record.mjs (Playwright walks a demo state and
//     screenshots after every action) and written into content.json by
//     harness/build-content.mjs together with the camera, cursor and event
//     tracks;
//   - narration: browser speech synthesis reads the caption (optional); the
//     original setup pre-generates TTS audio per step instead and times each
//     step by the clip length;
//   - a step that stands still (browsing, paused, reduced motion) shows its
//     KEY FRAME (`keyframe`, default the last frame) - never frame 0, which is
//     usually the state BEFORE the action the step is about.
//
// Address: #/<chapter id>/<step number>. Keys: arrows, Space (play/pause),
// C (captions), M (narration on/off).

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import './styles.css';
import content from './content.json';
import { useDemoState, hasDemoStateParam, type DemoStateDef } from '../_shared/demo-state';
import { track } from '../_shared/analytics';
import { DSBadge, DSButton, DSCard, DSIcon, DSIconButton, type IconName } from '../../ds';

const PROTOTYPE_ID = 'proto-e15c0a7d3b96';

export const breakpoints = [375, 768, 1280, 1536, 1920];

export const demoStates: DemoStateDef[] = [
  { id: 'start', label: 'Start screen', group: 'Start' },
  { id: 'resume', label: 'Start screen - resume in chapter 3', group: 'Start' },
  { id: 'card', label: 'Title card (chapter 1)', group: 'Step types' },
  { id: 'agenda', label: 'Agenda', group: 'Step types' },
  { id: 'why', label: 'Why + what the shift gains', group: 'Step types' },
  { id: 'compare', label: 'Today vs after', group: 'Step types' },
  { id: 'screen', label: 'Desktop screen with camera and cursor (key frame)', group: 'Step types' },
  { id: 'phone', label: 'Phone screen (key frame)', group: 'Step types' },
  { id: 'faq', label: 'Questions', group: 'Step types' },
  { id: 'summary', label: 'Summary', group: 'Step types' },
  { id: 'no-captions', label: 'Screen step with captions off', group: 'Player' },
];

// ---- content model ----------------------------------------------------------

type Pose = 'wave' | 'point' | 'think' | 'cheer';
type StepType = 'card' | 'agenda' | 'why' | 'compare' | 'screen' | 'phone' | 'faq' | 'summary';

interface Frame {
  file: string;
  ms: number;
  transition?: number;
}
interface Motion {
  camera: Array<{ ms: number; x: number; y: number; zoom: number }>;
  cursor: Array<{ ms: number; x: number; y: number }>;
  events: Array<{ ms: number; type: 'click' | 'key'; label?: string }>;
}
interface Step {
  id: string;
  type: StepType;
  pose?: Pose;
  caption: string;
  source?: string;
  heading?: string;
  paragraphs?: Array<{ text: string; source?: string }>;
  benefitsHeading?: string;
  benefits?: Array<{ icon: string; title: string; text: string; source?: string }>;
  before?: { title: string; points: string[] };
  after?: { title: string; points: string[] };
  items?: Array<{ q?: string; a?: string; icon?: string; title?: string; text?: string }>;
  frames?: Frame[];
  motion?: Motion;
  keyframe?: number;
}
interface Chapter {
  id: string;
  title: string;
  steps: Step[];
}

const C = content as unknown as {
  title: string;
  subtitle: string;
  kicker: string;
  framesDate: string;
  guide: string;
  minDurations: Record<StepType, number>;
  sources: Record<string, string>;
  chapters: Chapter[];
};

interface FlatStep {
  chapter: Chapter;
  chapterIndex: number;
  step: Step;
  numberInChapter: number;
  flatIndex: number;
}

const FLAT: FlatStep[] = C.chapters.flatMap((chapter, chapterIndex) =>
  chapter.steps.map((step, i) => ({ chapter, chapterIndex, step, numberInChapter: i + 1, flatIndex: 0 })),
).map((f, i) => ({ ...f, flatIndex: i }));

const FRAME_URLS = import.meta.glob('./assets/frames/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

function frameUrl(file: string): string | undefined {
  return FRAME_URLS[`./assets/frames/${file}`];
}

function framesTotal(step: Step): number {
  return (step.frames ?? []).reduce((s, f) => s + f.ms, 0);
}

function plainCaption(text: string): string {
  return text.replace(/\*\*/g, '');
}

/** Reading time of a caption (about 2.6 words per second) plus a pause. */
function readingMs(text: string): number {
  const words = plainCaption(text).split(/\s+/).filter(Boolean).length;
  return Math.round((words / 2.6) * 1000) + 900;
}

function stepDuration(step: Step): number {
  return Math.max(C.minDurations[step.type] ?? 6000, framesTotal(step) + 400, readingMs(step.caption));
}

// ---- address: #/<chapter>/<n> ----------------------------------------------

function parseHash(raw: string): number {
  const [chapterId, n] = raw.replace(/^#\/?/, '').split('/');
  const hit = FLAT.find((f) => f.chapter.id === chapterId && f.numberInChapter === Number(n));
  return hit ? hit.flatIndex : 0;
}

function hashFor(index: number): string {
  const f = FLAT[index];
  return `#/${f.chapter.id}/${f.numberInChapter}`;
}

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // storage blocked - the preference just does not survive a reload
  }
}

const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window;

// ---- component --------------------------------------------------------------

// Where a demo state starts the player. The player below is keyed on the demo
// state, so a new state remounts it with these values as its initial state
// (no effect that sets state). No ?state= in the address = a plain first load:
// the step comes from the address, the captions from the saved preference.
interface PlayerStart {
  index: number | null; // null = read the address
  started: boolean;
  captions: boolean | null; // null = the saved preference
  resumeIndex: number;
}

function stepIndex(stepId: string): number {
  return Math.max(0, FLAT.findIndex((f) => f.step.id === stepId));
}

function firstOfType(t: StepType): number {
  return Math.max(0, FLAT.findIndex((f) => f.step.type === t));
}

function playerStartFor(demoState: string): PlayerStart {
  const fromAddress = parseHash(window.location.hash);
  if (!hasDemoStateParam()) return { index: null, started: false, captions: null, resumeIndex: fromAddress };
  switch (demoState) {
    case 'resume':
      return { index: stepIndex('console-list'), started: false, captions: true, resumeIndex: stepIndex('console-list') };
    case 'card':
      return { index: 0, started: true, captions: true, resumeIndex: fromAddress };
    case 'agenda':
    case 'why':
    case 'compare':
    case 'screen':
    case 'phone':
    case 'faq':
    case 'summary':
      return { index: firstOfType(demoState), started: true, captions: true, resumeIndex: fromAddress };
    case 'no-captions':
      return { index: stepIndex('console-assign'), started: true, captions: false, resumeIndex: fromAddress };
    case 'start':
    default:
      return { index: 0, started: false, captions: true, resumeIndex: 0 };
  }
}

export default function OpsBriefing() {
  const demoState = useDemoState(demoStates, 'start');
  return <Player key={demoState} demoState={demoState} />;
}

function Player({ demoState }: { demoState: string }) {
  const [start] = useState(() => playerStartFor(demoState));
  const [index, setIndex] = useState(() => start.index ?? parseHash(window.location.hash));
  const [started, setStarted] = useState(start.started);
  const [playing, setPlaying] = useState(false);
  const [narration, setNarration] = useState(() => readPref('briefing.narration', true));
  const [captions, setCaptions] = useState(() => start.captions ?? readPref('briefing.captions', true));
  const [runId, setRunId] = useState(0);
  const resumeIndex = start.resumeIndex;

  const goTo = useCallback((i: number) => {
    const next = Math.max(0, Math.min(FLAT.length - 1, i));
    window.history.replaceState(null, '', window.location.pathname + window.location.search + hashFor(next));
    setIndex(next);
    setRunId((r) => r + 1);
  }, []);

  useEffect(() => {
    // A demo state writes its step into the address so a reload lands on it.
    if (start.index !== null) window.history.replaceState(null, '', window.location.pathname + window.location.search + hashFor(start.index));
    const onHash = () => setIndex(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [start]);

  const current = FLAT[index];
  const step = current.step;

  // Playback: the step advances when its time is up AND the narration ended.
  // Both flags carry the run they belong to: a flag left over from the
  // previous step must never advance the next one (that skipped a step).
  const narrating = playing && narration && speechAvailable;
  const runKey = `${index}:${runId}:${playing ? 1 : 0}:${narrating ? 1 : 0}`;
  const [spokenKey, setSpokenKey] = useState<string | null>(null);
  const [timeUpKey, setTimeUpKey] = useState<string | null>(null);
  const spoken = spokenKey === runKey;
  const timeUp = timeUpKey === runKey;

  useEffect(() => {
    if (!playing) return;
    const need = narrating ? Math.max(C.minDurations[step.type] ?? 4000, framesTotal(step) + 400) : stepDuration(step);
    const t = window.setTimeout(() => setTimeUpKey(runKey), need);
    // Safety net: a speech engine that never fires `end` must not stall the show.
    const fallback = window.setTimeout(() => setSpokenKey(runKey), stepDuration(step) * 2);
    if (narrating) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(plainCaption(step.caption));
      u.lang = 'en-GB';
      u.rate = 1.02;
      u.onend = () => setSpokenKey(runKey);
      u.onerror = () => setSpokenKey(runKey);
      window.speechSynthesis.speak(u);
    }
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(fallback);
      if (speechAvailable) window.speechSynthesis.cancel();
    };
  }, [runKey, playing, narrating, step]);

  useEffect(() => {
    if (!playing || !timeUp || (narrating && !spoken)) return undefined;
    // Advanced from a timer callback, not from the effect body, so the step
    // change is an external event and not a cascading render.
    const id = window.setTimeout(() => {
      if (index >= FLAT.length - 1) {
        setPlaying(false);
        track('Briefing Finished', { prototype: PROTOTYPE_ID });
        return;
      }
      goTo(index + 1);
    }, 0);
    return () => window.clearTimeout(id);
  }, [playing, timeUp, spoken, narrating, index, goTo]);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      track(p ? 'Briefing Paused' : 'Briefing Played', { prototype: PROTOTYPE_ID, step: FLAT[index].step.id });
      return !p;
    });
    setRunId((r) => r + 1);
  }, [index]);

  const toggleCaptions = useCallback(() => {
    setCaptions((c) => {
      writePref('briefing.captions', !c);
      return !c;
    });
  }, []);

  const toggleNarration = useCallback(() => {
    setNarration((n) => {
      writePref('briefing.narration', !n);
      return !n;
    });
    setRunId((r) => r + 1);
  }, []);

  useEffect(() => {
    if (!started) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') goTo(index + 1);
      else if (e.key === 'ArrowLeft') goTo(index - 1);
      else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'c' || e.key === 'C') toggleCaptions();
      else if (e.key === 'm' || e.key === 'M') toggleNarration();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started, index, goTo, togglePlay, toggleCaptions, toggleNarration]);

  const begin = (withNarration: boolean, from: number) => {
    track('Briefing Started', { prototype: PROTOTYPE_ID, narration: withNarration, from: FLAT[from].step.id });
    setNarration(withNarration);
    writePref('briefing.narration', withNarration);
    setStarted(true);
    setPlaying(withNarration);
    goTo(from);
  };

  const screenName = `Briefing > ${current.chapter.title} > ${step.type}`;

  return (
    <div className={`brf-root brf-root--${step.type}`} data-track-screen={started ? screenName : 'Briefing > Start screen'}>
      <header className="brf-head">
        <span className="brf-head__kicker">{C.kicker}</span>
        <span className="brf-head__chapter">
          {current.chapterIndex + 1}. {current.chapter.title}
        </span>
        {(step.type === 'screen' || step.type === 'phone') && <DSBadge tone="info">Prototype - recorded {C.framesDate}</DSBadge>}
      </header>

      <div className="brf-stage">
        <StepView key={`${index}-${runId}`} flat={current} playing={playing} onJump={goTo} />
      </div>

      <div className={`brf-caption${captions ? '' : ' brf-caption--hidden'}`} aria-live="polite">
        <GuideCharacter pose={step.pose ?? 'point'} talking={narrating && !spoken} size={step.type === 'card' ? 0 : 56} />
        {captions && <RichText text={step.caption} className="brf-caption__text" />}
      </div>

      <div className="brf-controls">
        <DSIconButton icon="chevron-left" label="Previous step" onClick={() => goTo(index - 1)} />
        <DSIconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} onClick={togglePlay} variant="secondary" />
        <DSIconButton icon="chevron-right" label="Next step" onClick={() => goTo(index + 1)} />
        <BriefingProgress index={index} onJump={goTo} />
        <DSIconButton icon="captions" label={captions ? 'Hide captions (C)' : 'Show captions (C)'} pressed={captions} onClick={toggleCaptions} />
        {speechAvailable && <DSIconButton icon={narration ? 'volume-on' : 'volume-off'} label={narration ? 'Narration off (M)' : 'Narration on (M)'} pressed={narration} onClick={toggleNarration} />}
      </div>

      {!started && (
        <div className="brf-start" data-track-screen="Briefing > Start screen">
          <div className="brf-start__card">
            <GuideCharacter pose="wave" talking={false} size={120} />
            <div className="brf-start__kicker">{C.kicker}</div>
            <h1 className="brf-start__title">{C.title}</h1>
            <p className="brf-start__sub">{C.subtitle}</p>
            <div className="brf-start__actions">
              {resumeIndex > 0 ? (
                <>
                  <DSButton size="large" icon="play" onClick={() => begin(true, resumeIndex)}>
                    Continue with narration - chapter {FLAT[resumeIndex].chapterIndex + 1}
                  </DSButton>
                  <DSButton size="large" variant="secondary" onClick={() => begin(true, 0)}>
                    Start from the beginning
                  </DSButton>
                </>
              ) : (
                <>
                  <DSButton size="large" icon="play" onClick={() => begin(true, 0)}>
                    Start with narration
                  </DSButton>
                  <DSButton size="large" variant="secondary" onClick={() => begin(false, 0)}>
                    Browse without sound
                  </DSButton>
                </>
              )}
            </div>
            <div className="brf-start__hint">
              About {Math.round(FLAT.reduce((s, f) => s + stepDuration(f.step), 0) / 60000)} minutes - arrows to move - Space to pause - C captions - M narration
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- step renderers ---------------------------------------------------------

function StepView({ flat, playing, onJump }: { flat: FlatStep; playing: boolean; onJump: (i: number) => void }) {
  const { step, chapter, chapterIndex } = flat;
  switch (step.type) {
    case 'card':
      return (
        <div className="brf-card" data-track-screen={`Briefing > ${chapter.title} > card`}>
          <GuideCharacter pose={step.pose ?? 'wave'} talking={false} size={150} />
          <div className="brf-card__text">
            <div className="brf-card__number">{chapterIndex === 0 ? C.kicker : `Chapter ${chapterIndex + 1}`}</div>
            <h1 className="brf-card__title">{chapter.title}</h1>
          </div>
        </div>
      );
    case 'agenda':
      return (
        <div className="brf-pad">
          <h2 className="brf-h2">In this briefing</h2>
          <div className="brf-agenda">
            {C.chapters.slice(1).map((ch, i) => (
              <DSCard key={ch.id} padding="medium" onClick={() => onJump(FLAT.findIndex((f) => f.chapter.id === ch.id))} ariaLabel={`Go to ${ch.title}`}>
                <div className="brf-agenda__item">
                  <span className="brf-agenda__num">{i + 2}</span>
                  <span className="brf-agenda__title">{ch.title}</span>
                  <DSIcon name="chevron-right" />
                </div>
              </DSCard>
            ))}
          </div>
        </div>
      );
    case 'why':
      return (
        <div className="brf-pad brf-why">
          <section>
            <h2 className="brf-h2">{step.heading}</h2>
            <ul className="brf-why__list">
              {step.paragraphs?.map((p) => (
                <li key={p.text}>
                  {p.text}
                  {p.source && <span className="brf-source">{C.sources[p.source]}</span>}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="brf-h2">{step.benefitsHeading}</h2>
            <div className="brf-benefits">
              {step.benefits?.map((b) => (
                <DSCard key={b.title} padding="medium">
                  <div className="brf-benefit">
                    <span className="brf-benefit__icon">
                      <DSIcon name={b.icon as IconName} />
                    </span>
                    <div>
                      <div className="brf-benefit__title">{b.title}</div>
                      <div className="brf-benefit__text">{b.text}</div>
                    </div>
                  </div>
                </DSCard>
              ))}
            </div>
          </section>
        </div>
      );
    case 'compare':
      return (
        <div className="brf-pad brf-compare">
          {[step.before, step.after].map((side, i) =>
            side ? (
              <DSCard key={side.title} padding="large">
                <div className={`brf-compare__side${i === 1 ? ' brf-compare__side--after' : ''}`}>
                  <div className="brf-compare__title">
                    <DSIcon name={i === 1 ? 'check-circle' : 'clock'} /> {side.title}
                  </div>
                  <ul>
                    {side.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              </DSCard>
            ) : null,
          )}
        </div>
      );
    case 'screen':
    case 'phone':
      return <ScreenStage step={step} playing={playing} phone={step.type === 'phone'} />;
    case 'faq':
      return (
        <div className="brf-pad brf-faq">
          {step.items?.map((it) => (
            <DSCard key={it.q} padding="medium">
              <div className="brf-faq__q">{it.q}</div>
              <div className="brf-faq__a">{it.a}</div>
            </DSCard>
          ))}
        </div>
      );
    case 'summary':
      return (
        <div className="brf-pad">
          <div className="brf-summary">
            {step.items?.map((it) => (
              <div key={it.title} className="brf-summary__item">
                <span className="brf-summary__icon">
                  <DSIcon name={(it.icon ?? 'check') as IconName} size={28} />
                </span>
                <div className="brf-summary__title">{it.title}</div>
                <div className="brf-summary__text">{it.text}</div>
              </div>
            ))}
          </div>
        </div>
      );
    default:
      return null;
  }
}

// ---- recorded screens: frames + camera + cursor + events --------------------

function useClock(running: boolean): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!running) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setT(now - start);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  return t;
}

function interpolate<T extends { ms: number }>(points: T[], t: number, keys: Array<keyof T>): Record<string, number> | null {
  if (!points.length) return null;
  if (t <= points[0].ms) return Object.fromEntries(keys.map((k) => [k, points[0][k] as number]));
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (t <= b.ms) {
      const p = (t - a.ms) / Math.max(1, b.ms - a.ms);
      const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2; // ease in-out
      return Object.fromEntries(keys.map((k) => [k, (a[k] as number) + ((b[k] as number) - (a[k] as number)) * e]));
    }
  }
  const last = points[points.length - 1];
  return Object.fromEntries(keys.map((k) => [k, last[k] as number]));
}

function ScreenStage({ step, playing, phone }: { step: Step; playing: boolean; phone: boolean }) {
  const frames = useMemo(() => step.frames ?? [], [step.frames]);
  const total = framesTotal(step);
  const clock = useClock(playing && frames.length > 1);
  const keyIndex = Math.min(frames.length - 1, Math.max(0, step.keyframe ?? frames.length - 1));
  const keyTime = frames.slice(0, keyIndex).reduce((s, f) => s + f.ms, 0) + Math.min(frames[keyIndex]?.ms ?? 0, 600);
  const t = playing && clock > 0 ? Math.min(clock, total) : keyTime;

  let frameIndex = 0;
  let acc = 0;
  for (let i = 0; i < frames.length; i += 1) {
    if (t >= acc) frameIndex = i;
    acc += frames[i].ms;
  }

  if (frames.length === 0) {
    return (
      <div className="brf-pad">
        <div className="brf-missing">
          <DSIcon name="camera" size={28} />
          <div>
            Frames for <code>{step.id}</code> are not recorded yet. Run <code>npm run record</code> and <code>npm run frames</code>.
          </div>
        </div>
      </div>
    );
  }

  const cam = interpolate(step.motion?.camera ?? [], t, ['x', 'y', 'zoom']) ?? { x: 0.5, y: 0.5, zoom: 1 };
  const cur = interpolate(step.motion?.cursor ?? [], t, ['x', 'y']);
  const recent = (step.motion?.events ?? []).filter((e) => t >= e.ms && t - e.ms < 900);
  const shot = (
    <ScreenShot
      frames={frames}
      frameIndex={frameIndex}
      cam={cam as { x: number; y: number; zoom: number }}
      cursor={cur as { x: number; y: number } | null}
      events={recent}
      label={`Recorded screen of ${step.source ?? 'the prototype'}`}
    />
  );
  return <div className={`brf-screen${phone ? ' brf-screen--phone' : ''}`}>{phone ? <PhoneBezel>{shot}</PhoneBezel> : shot}</div>;
}

/* CUSTOM - registered in spec.json customElements: recorded frames with a camera, a cursor and click/key markers. */
function ScreenShot({
  frames,
  frameIndex,
  cam,
  cursor,
  events,
  label,
}: {
  frames: Frame[];
  frameIndex: number;
  cam: { x: number; y: number; zoom: number };
  cursor: { x: number; y: number } | null;
  events: Motion['events'];
  label: string;
}) {
  const z = Math.max(1, cam.zoom);
  // Keep the zoomed frame inside the viewport: the visible window is 1/z wide.
  const cx = Math.min(1 - 0.5 / z, Math.max(0.5 / z, cam.x));
  const cy = Math.min(1 - 0.5 / z, Math.max(0.5 / z, cam.y));
  const style = { transform: `translate(${(0.5 - cx) * z * 100}%, ${(0.5 - cy) * z * 100}%) scale(${z})` };
  const click = events.find((e) => e.type === 'click');
  const key = events.find((e) => e.type === 'key');
  return (
    <div className="brf-shot" role="img" aria-label={label}>
      <div className="brf-shot__camera" style={style}>
        {frames.map((f, i) => (
          <img
            key={f.file}
            src={frameUrl(f.file)}
            alt=""
            className={`brf-shot__frame${i === frameIndex ? ' brf-shot__frame--on' : ''}`}
            style={{ transitionDuration: `${f.transition ?? 120}ms` }}
            draggable={false}
          />
        ))}
        {cursor && (
          <span className="brf-shot__cursor" style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}>
            {click && <span className="brf-shot__ripple" />}
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <path d="M5 3l14 8-6 1.6L10 19z" className="brf-shot__arrow" />
            </svg>
          </span>
        )}
      </div>
      {key?.label && <span className="brf-shot__key">{key.label}</span>}
    </div>
  );
}

/* CUSTOM - registered in spec.json customElements: a neutral phone outline around a recorded phone frame. */
function PhoneBezel({ children }: { children: ReactNode }) {
  return (
    <div className="brf-phone">
      <span className="brf-phone__notch" aria-hidden />
      <div className="brf-phone__screen">{children}</div>
    </div>
  );
}

// ---- guide, progress, rich text ---------------------------------------------

/* CUSTOM - registered in spec.json customElements: the briefing guide "Vane" (drawn for this kit). */
function GuideCharacter({ pose, talking, size }: { pose: Pose; talking: boolean; size: number }) {
  if (size <= 0) return null;
  const armL = pose === 'cheer' ? 'M24 52 L12 34' : pose === 'wave' ? 'M24 52 L14 58' : 'M24 52 L16 62';
  const armR = pose === 'wave' || pose === 'cheer' ? 'M72 52 L86 34' : pose === 'point' ? 'M72 52 L90 50' : 'M72 52 L64 44';
  const mouth = pose === 'think' ? 'M42 60 L54 60' : 'M40 58 Q48 66 56 58';
  return (
    <svg className={`brf-guide${talking ? ' brf-guide--talking' : ''}`} width={size} height={size} viewBox="0 0 96 96" role="img" aria-label={`${C.guide}, the briefing guide`}>
      <g className="brf-guide__rotor">
        <path d="M48 14 L46 2 L50 2 Z M48 14 L59 20 L57 23 Z M48 14 L37 20 L39 23 Z" className="brf-guide__blade" />
        <circle cx="48" cy="14" r="3" className="brf-guide__hub" />
      </g>
      <path d="M48 17 L48 26" className="brf-guide__line" />
      <rect x="22" y="26" width="52" height="46" rx="18" className="brf-guide__body" />
      <circle cx="39" cy="46" r="4" className="brf-guide__eye" />
      <circle cx="57" cy="46" r="4" className="brf-guide__eye" />
      {pose === 'think' && <path d="M34 38 L43 36" className="brf-guide__line" />}
      <path d={mouth} className="brf-guide__line" fill="none" />
      <path d={armL} className="brf-guide__line" />
      <path d={armR} className="brf-guide__line" />
      <path d="M38 72 L36 86 M58 72 L60 86" className="brf-guide__line" />
    </svg>
  );
}

/* CUSTOM - registered in spec.json customElements: one segment per chapter, one dot per step; the dots are jump targets. */
function BriefingProgress({ index, onJump }: { index: number; onJump: (i: number) => void }) {
  return (
    <div className="brf-progress" aria-label="Briefing progress">
      {C.chapters.map((ch) => {
        const steps = FLAT.filter((f) => f.chapter.id === ch.id);
        const active = steps.some((f) => f.flatIndex === index);
        return (
          <div key={ch.id} className={`brf-progress__chapter${active ? ' brf-progress__chapter--active' : ''}`} title={ch.title}>
            {steps.map((f) => (
              <button
                key={f.step.id}
                type="button"
                className={`brf-progress__dot${f.flatIndex === index ? ' brf-progress__dot--on' : f.flatIndex < index ? ' brf-progress__dot--done' : ''}`}
                aria-label={`${ch.title}, step ${f.numberInChapter}`}
                aria-current={f.flatIndex === index ? 'step' : undefined}
                onClick={() => onJump(f.flatIndex)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function RichText({ text, className }: { text: string; className?: string }) {
  const parts = text.split('**');
  return <p className={className}>{parts.map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}</p>;
}
