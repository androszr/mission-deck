import { useCallback, useEffect, useState } from 'react';
import { breakpointFor } from './lib/breakpoints';
import { startClock } from './lib/clock';
import { parseHash } from './lib/hashRoute';
import { THEME_KEY, nextPref, normalizePref, resolveTheme, type ThemePref } from './lib/theme';
import { BugsScreen } from './screens/Bugs';
import { OnCallScreen } from './screens/OnCall';
import { SprintsScreen } from './screens/Sprints';
import { TeamScreen } from './screens/Team';
import { Shell } from './shell/Shell';

function useHashRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

function useBreakpoint() {
  const [bp, setBp] = useState(() => breakpointFor(window.innerWidth));
  useEffect(() => {
    const on = () => setBp(breakpointFor(window.innerWidth));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return bp;
}

function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => normalizePref(window.localStorage.getItem(THEME_KEY)));
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const theme = resolveTheme(pref, systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const cycle = useCallback(() => {
    const next = nextPref(pref);
    window.localStorage.setItem(THEME_KEY, next);
    setPref(next);
  }, [pref]);
  return { pref, cycle };
}

export function App() {
  const route = useHashRoute();
  const breakpoint = useBreakpoint();
  const { pref, cycle } = useTheme();
  const [generatedAt, setGeneratedAt] = useState<string | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const onData = useCallback((g: string | null | undefined) => setGeneratedAt(g), []);

  useEffect(() => {
    return startClock({
      now: Date.now,
      onTick: setNow,
      doc: document,
      setIntervalFn: (fn, ms) => window.setInterval(fn, ms),
      clearIntervalFn: (id) => window.clearInterval(id as number),
    });
  }, []);
  useEffect(() => {
    setNow(Date.now());
  }, [route]);

  let screen;
  if (route === 'bugs') screen = <BugsScreen key="bugs" onData={onData} />;
  else if (route === 'on-call') screen = <OnCallScreen key="on-call" onData={onData} />;
  else if (route === 'team') screen = <TeamScreen key="team" onData={onData} />;
  else screen = <SprintsScreen key="sprints" onData={onData} />;

  return (
    <Shell breakpoint={breakpoint} route={route} generatedAt={generatedAt} now={now} themePref={pref} onTheme={cycle}>
      {screen}
    </Shell>
  );
}
