// Mission Deck - prototype STARTER, kind: briefing (index.tsx)
//
// POST /api/prototypes (kind: briefing) copies this file, content.json and
// recording.json to data-sub-repositories/ds-data/prototypes/<id>/ and
// substitutes {{PROTO_NAME_JSON}} and {{PROTO_ID}} in this file. Search for
// "CUSTOMIZE" to fit the starter to the story of the accepted plan.
//
// A briefing is a self-playing presentation: it explains a change to people
// who will never open the clickable prototypes. The story lives in
// content.json (chapters and steps; the caption of a step IS the narration
// script). This starter plays three step types: card, agenda and summary.
// Steps that show recorded pictures of the real prototypes (type `screen` /
// `phone`) are written in recording.json and recorded with
// scripts/proto-record.mjs - see the /briefing skill and the example
// briefing in the sample data.
//
// Address: #/<chapter id>/<step number>. Keys: arrows, Space (play/pause),
// C (captions), M (narration on/off).
//
// Contract: as every prototype - default export, `breakpoints`, `demoStates`
// read through useDemoState, imports only from react, ./styles.css,
// ./*.json, ../_shared/*, ../../ds, tokens only, `@container proto` only.

import { useCallback, useEffect, useState } from 'react';
import './styles.css';
import content from './content.json';
import { useDemoState, hasDemoStateParam, type DemoStateDef } from '../_shared/demo-state';
import { track } from '../_shared/analytics';
import { DSButton, DSCard, DSIcon, DSIconButton, DSProgress, type IconName } from '../../ds';

// Name from the registry and id - literals substituted by the server.
const PROTOTYPE_NAME = {{PROTO_NAME_JSON}};
const PROTOTYPE_ID = '{{PROTO_ID}}';

// CUSTOMIZE: the widths the briefing really lays out for.
export const breakpoints = [375, 768, 1280, 1536, 1920];

// CUSTOMIZE: demo states - one row per step type to review.
export const demoStates: DemoStateDef[] = [
  { id: 'start', label: 'Start screen', group: 'Start' },
  { id: 'card', label: 'Title card', group: 'Step types' },
  { id: 'agenda', label: 'Agenda', group: 'Step types' },
  { id: 'summary', label: 'Summary', group: 'Step types' },
  { id: 'no-captions', label: 'Summary with captions off', group: 'Player' },
];

// ---- content model ----------------------------------------------------------

type StepType = 'card' | 'agenda' | 'summary';

interface Step {
  id: string;
  type: StepType;
  caption: string;
  heading?: string;
  items?: Array<{ icon: string; title: string; text: string }>;
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
  minDurations: Record<StepType, number>;
  chapters: Chapter[];
};

interface FlatStep {
  chapter: Chapter;
  chapterIndex: number;
  step: Step;
  numberInChapter: number;
  flatIndex: number;
}

const FLAT: FlatStep[] = C.chapters
  .flatMap((chapter, chapterIndex) => chapter.steps.map((step, i) => ({ chapter, chapterIndex, step, numberInChapter: i + 1, flatIndex: 0 })))
  .map((f, i) => ({ ...f, flatIndex: i }));

function plainCaption(text: string): string {
  return text.replace(/\*\*/g, '');
}

/** Reading time of a caption (about 2.6 words per second) plus a pause. */
function readingMs(text: string): number {
  const words = plainCaption(text).split(/\s+/).filter(Boolean).length;
  return Math.round((words / 2.6) * 1000) + 900;
}

function stepDuration(step: Step): number {
  return Math.max(C.minDurations[step.type] ?? 6000, readingMs(step.caption));
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
// state, so a new state remounts it with these values (no effect that sets
// state). No ?state= in the address = a plain first load.
interface PlayerStart {
  index: number | null; // null = read the address
  started: boolean;
  captions: boolean | null; // null = the saved preference
}

function firstOfType(t: StepType): number {
  return Math.max(0, FLAT.findIndex((f) => f.step.type === t));
}

function playerStartFor(demoState: string): PlayerStart {
  if (!hasDemoStateParam()) return { index: null, started: false, captions: null };
  switch (demoState) {
    case 'card':
    case 'agenda':
    case 'summary':
      return { index: firstOfType(demoState), started: true, captions: true };
    case 'no-captions':
      return { index: firstOfType('summary'), started: true, captions: false };
    case 'start':
    default:
      return { index: 0, started: false, captions: true };
  }
}

export default function Briefing() {
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
  // Both flags carry the run they belong to, so a flag left over from the
  // previous step never advances the next one.
  const narrating = playing && narration && speechAvailable;
  const runKey = `${index}:${runId}:${playing ? 1 : 0}:${narrating ? 1 : 0}`;
  const [spokenKey, setSpokenKey] = useState<string | null>(null);
  const [timeUpKey, setTimeUpKey] = useState<string | null>(null);
  const spoken = spokenKey === runKey;
  const timeUp = timeUpKey === runKey;

  useEffect(() => {
    if (!playing) return undefined;
    const need = narrating ? C.minDurations[step.type] ?? 4000 : stepDuration(step);
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
    // Advanced from a timer callback, not from the effect body.
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
    setPlaying((p) => !p);
    setRunId((r) => r + 1);
  }, []);

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
    if (!started) return undefined;
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

  const begin = (withNarration: boolean) => {
    track('Briefing Started', { prototype: PROTOTYPE_ID, narration: withNarration });
    setNarration(withNarration);
    writePref('briefing.narration', withNarration);
    setStarted(true);
    setPlaying(withNarration);
    goTo(0);
  };

  const screenName = `Briefing > ${current.chapter.title} > ${step.type}`;

  return (
    <div className={`brf-root brf-root--${step.type}`} data-track-screen={started ? screenName : 'Briefing > Start screen'} data-proto-id={PROTOTYPE_ID}>
      <header className="brf-head">
        <span className="brf-head__kicker">{C.kicker}</span>
        <span className="brf-head__chapter">
          {current.chapterIndex + 1}. {current.chapter.title}
        </span>
      </header>

      <div className="brf-stage">
        <StepView key={`${index}-${runId}`} flat={current} onJump={goTo} />
      </div>

      <div className={`brf-caption${captions ? '' : ' brf-caption--hidden'}`} aria-live="polite">
        <span className="brf-caption__mark">
          <DSIcon name="message" size={22} />
        </span>
        {captions && <RichText text={step.caption} className="brf-caption__text" />}
      </div>

      <div className="brf-controls">
        <DSIconButton icon="chevron-left" label="Previous step" onClick={() => goTo(index - 1)} />
        <DSIconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} onClick={togglePlay} variant="secondary" />
        <DSIconButton icon="chevron-right" label="Next step" onClick={() => goTo(index + 1)} />
        <div className="brf-progress-wrap">
          <DSProgress value={index + 1} max={FLAT.length} label="Briefing progress" />
        </div>
        <DSIconButton icon="captions" label={captions ? 'Hide captions (C)' : 'Show captions (C)'} pressed={captions} onClick={toggleCaptions} />
        {speechAvailable && (
          <DSIconButton icon={narration ? 'volume-on' : 'volume-off'} label={narration ? 'Narration off (M)' : 'Narration on (M)'} pressed={narration} onClick={toggleNarration} />
        )}
      </div>

      {!started && (
        <div className="brf-start" data-track-screen="Briefing > Start screen">
          <div className="brf-start__card">
            <div className="brf-start__kicker">{C.kicker}</div>
            <h1 className="brf-start__title">{PROTOTYPE_NAME}</h1>
            <p className="brf-start__sub">{C.subtitle}</p>
            <div className="brf-start__actions">
              <DSButton size="large" icon="play" onClick={() => begin(true)}>
                Start with narration
              </DSButton>
              <DSButton size="large" variant="secondary" onClick={() => begin(false)}>
                Browse without sound
              </DSButton>
            </div>
            <div className="brf-start__hint">
              About {Math.max(1, Math.round(FLAT.reduce((s, f) => s + stepDuration(f.step), 0) / 60000))} minutes - arrows to move - Space to pause - C captions - M narration
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- step renderers ---------------------------------------------------------

// CUSTOMIZE: add a step type here and in content.json (and StepType above).
function StepView({ flat, onJump }: { flat: FlatStep; onJump: (i: number) => void }) {
  const { step, chapter, chapterIndex } = flat;
  switch (step.type) {
    case 'card':
      return (
        <div className="brf-card" data-track-screen={`Briefing > ${chapter.title} > card`}>
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
    case 'summary':
    default:
      return (
        <div className="brf-pad">
          <h2 className="brf-h2">{step.heading}</h2>
          <div className="brf-summary">
            {step.items?.map((it) => (
              <DSCard key={it.title} padding="medium">
                <div className="brf-benefit">
                  <span className="brf-benefit__icon">
                    <DSIcon name={it.icon as IconName} />
                  </span>
                  <div>
                    <div className="brf-benefit__title">{it.title}</div>
                    <div className="brf-benefit__text">{it.text}</div>
                  </div>
                </div>
              </DSCard>
            ))}
          </div>
        </div>
      );
  }
}

/** Renders **bold** spans of a caption. */
function RichText({ text, className }: { text: string; className?: string }) {
  const parts = text.split('**');
  return <p className={className}>{parts.map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}</p>;
}
