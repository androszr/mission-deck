// demo/tracks.mjs
// The versions ("tracks") of the presentation, as DATA. A track is a SUBSET of
// the full scenario - a list of chapters and, inside each, step ids. It carries
// no content of its own (no captions, mocks or narration): the engine plays
// exactly the steps of demo/scenario.mjs, only fewer of them. `null` = every
// chapter and every step.
//
// Step ids, never indexes: a chapter rewrite that renames or drops a step makes
// validateTracks() (demo/scenario-schema.mjs, tests/test_demo_scenario.mjs)
// name the stale id instead of silently pointing at another step. At runtime an
// unknown id is skipped quietly - the test is the loud signal, not the page.
//
// Hash: `#<chapter>/<n>` is the full track (unchanged); `#<track>:<chapter>/<n>`
// plays another track, `n` counted WITHIN that track's steps of the chapter;
// a bare `#<track>` opens the track's first step. See parseDemoHash().
//
// Pure and DOM-free: node tests import it.

/** The default track: the one a hash without a track prefix plays. */
export const DEFAULT_TRACK = 'full';

/** Display order of the switch and user-facing labels (the bottom bar, Settings > Demo). */
export const TRACK_META = {
  short: { label: 'Short' },
  full: { label: 'Full' },
};

/**
 * PROVISIONAL short list (2026-10-04): built from the step ids that existed
 * that day; chapters still being rewritten (nowy-modul, agenci-new-idea, ...)
 * will change their ids and the coordinator finalizes the list. The agent
 * relay is told inside the rewritten nowy-modul chapter.
 */
export const TRACKS = {
  full: null,
  short: [
    { chapter: 'guides', steps: ['instrukcje-katalog', 'instrukcje-checklista'] },
    { chapter: 'start', steps: ['start-pobierz', 'start-rozpakuj', 'start-serwer', 'start-dashboard'] },
    {
      chapter: 'onboarding',
      steps: ['onb-vpn-laczenie', 'onb-vpn-polaczono', 'onb-sejf-kolekcja', 'onb-sejf-dopisz', 'onb-bitwarden-haslo', 'onb-dane',],
    },
    // Academy: the stage path of Academy, then a step that lands at once (the Mural).
    { chapter: 'academy', steps: ['szkolenie-otworz', 'szkolenie-mural'] },
    {
      chapter: 'new-module',
      steps: ['nowy-modul-prosba', 'nowy-modul-wywiad', 'nowy-modul-plan', 'nowy-modul-budowa',
        'nowy-modul-strona', 'nowy-modul-poprawka-zespol', 'nowy-modul-dane'],
    },
    { chapter: 'publishing', steps: ['publikacja-formularz', 'publikacja-wysylka', 'publikacja-mr'] },
    { chapter: 'catalog', steps: ['katalog-ostrzezenie', 'katalog-instalacja', 'katalog-gotowe'] },
    { chapter: 'sync', steps: ['synchronizacja-szyfr', 'synchronizacja-wyslij', 'synchronizacja-pobierz'] },
    { chapter: 'meetings', steps: ['spotkania-polecenie', 'spotkania-anonimizacja', 'spotkania-notatka'] },
    {
      chapter: 'jira-confluence',
      steps: ['jira-confluence-moje-zadania', 'jira-confluence-strona', 'jira-confluence-szkic', 'jira-confluence-tak'],
    },
    // Feedback: the question mark on the top bar, then Send - branch, commit and MR.
    { chapter: 'feedback', steps: ['zgloszenia-przycisk', 'zgloszenia-wyslij'] },
    {
      chapter: 'day-cycle',
      steps: ['koniec-i-start-dnia-wieczor', 'koniec-i-start-dnia-podsumowanie', 'koniec-i-start-dnia-rano', 'koniec-i-start-dnia-praca'],
    },
    { chapter: 'summary', steps: ['podsumowanie-plansza', 'podsumowanie-koniec'] },
  ],
};

// ── The active track, for painters that adapt to it (e.g. the summary
// board). Set by the engine; node-safe; null = every chapter (full track).
let _active = { id: DEFAULT_TRACK, chapters: null };

/** Called by the engine whenever the track changes. */
export function setActiveTrack(id, chapterIds) {
  _active = { id, chapters: chapterIds ? chapterIds.slice() : null };
}

/** The active track id ('full' unless the engine switched). */
export function activeTrackId() { return _active.id; }

/** The active track's chapter ids, in order; null when every chapter plays. */
export function activeTrackChapterIds() { return _active.chapters ? _active.chapters.slice() : null; }
