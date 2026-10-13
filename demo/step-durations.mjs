// demo/step-durations.mjs
// How long each step of the autopilot is EXPECTED to take, in ms - only the
// speed of the step progress bar on the bottom bar (demo/main.mjs). The bar
// never claims "ready" from this number: the real signal is the engine's
// busy flag (html[data-demo-busy] / [data-demo-ready]); the bar fills to 95%
// over the expected time and waits there until the step has settled.
//
// STEP_MS is GENERATED from a timed keyboard walk of the full track
// (1440x900, light theme, key press to settled step), keyed by step id and
// matched by the step's caption - never by its index, so a rewritten or
// reordered step gets no stale number. Values rounded to 100 ms (at least
// 500: an instant step still gets a visible fill), keys sorted.
// Re-measure and regenerate after a chapter changes noticeably; only the
// region between the generated markers is rewritten.
//
// A step missing from the table (new or rewritten since the walk) falls back
// to estimateStepMs(): a linear model of its actions fitted on the same walk
// (median error ~15%). Pure and DOM-free: node tests import it.

// generated:start
export const STEP_MS = {
  'aktualizacja-baner': 7400,
  'aktualizacja-brudne-drzewo': 4200,
  'aktualizacja-restart': 3700,
  'aktualizacja-sprawdz': 3500,
  'aktualizacja-stash': 6800,
  'aktualizacja-stash-pigulka': 5600,
  'aktualizacja-vpn': 4700,
  'aktualizacja-vpn-klient': 5800,
  'aktualizacja-zielono': 4600,
  'analityka-agregacja': 6100,
  'analityka-ai': 9800,
  'analityka-odswiez': 12000,
  'analityka-opinie': 2300,
  'analityka-uzytkownik': 5000,
  'analityka-wejscie': 6300,
  'analityka-wyniki': 4000,
  'czas-pracy-brak': 7000,
  'czas-pracy-filtr': 4500,
  'czas-pracy-gotowe': 6600,
  'czas-pracy-komorka': 2800,
  'czas-pracy-pobierz': 9300,
  'czas-pracy-polecenie': 10100,
  'czas-pracy-pytanie': 9400,
  'czas-pracy-wyczysc': 5000,
  'czas-pracy-wynik': 1700,
  'design-ikony-kopiuj': 2800,
  'design-ikony-szukaj': 6700,
  'design-ilustracje': 4900,
  'design-katalog': 6500,
  'design-komponent': 3600,
  'design-koniec': 4000,
  'design-mascot': 6500,
  'dyzury-i-urlopy-dy-dzis': 3700,
  'dyzury-i-urlopy-dy-sync': 8200,
  'dyzury-i-urlopy-dy-tydzien': 7000,
  'dyzury-i-urlopy-koniec': 2800,
  'dyzury-i-urlopy-polecenie': 12400,
  'dyzury-i-urlopy-ur-filtr': 8800,
  'dyzury-i-urlopy-ur-kto': 4200,
  'dyzury-i-urlopy-ur-pobierz': 8700,
  'dyzury-i-urlopy-ur-pobrane': 6500,
  'dyzury-i-urlopy-ur-sso': 9200,
  'instrukcje-checklista': 15900,
  'instrukcje-instalacja': 8600,
  'instrukcje-katalog': 4700,
  'instrukcje-kreator': 9400,
  'instrukcje-pulapki': 8700,
  'instrukcje-skille': 8100,
  'instrukcje-szkolenie': 17700,
  'instrukcje-uruchomienie': 10100,
  'jira-confluence-bez-opisu': 9500,
  'jira-confluence-kontrola': 10200,
  'jira-confluence-moje-zadania': 14400,
  'jira-confluence-nowe': 12900,
  'jira-confluence-pola': 8200,
  'jira-confluence-strona': 12800,
  'jira-confluence-szkic': 9200,
  'jira-confluence-tak': 7600,
  'katalog-gotowe': 9600,
  'katalog-instalacja': 3100,
  'katalog-ostrzezenie': 3200,
  'katalog-przeglad': 7400,
  'klucze-dla-zespolu-dostep': 5100,
  'klucze-dla-zespolu-formularz': 5400,
  'klucze-dla-zespolu-gotowe': 2400,
  'klucze-dla-zespolu-kolekcja': 5400,
  'klucze-dla-zespolu-kopiuj-klucz': 4400,
  'klucze-dla-zespolu-odszyfrowanie': 4500,
  'klucze-dla-zespolu-ola-kolekcja': 5300,
  'klucze-dla-zespolu-ola-send': 4700,
  'klucze-dla-zespolu-ola-wkleja': 5100,
  'klucze-dla-zespolu-otworz': 4800,
  'klucze-dla-zespolu-repozytoria': 5400,
  'klucze-dla-zespolu-send': 12400,
  'klucze-dla-zespolu-tworzenie': 4000,
  'klucze-dla-zespolu-zapis': 4100,
  'koniec-i-start-dnia-noc': 1600,
  'koniec-i-start-dnia-odszyfruj': 4800,
  'koniec-i-start-dnia-podsumowanie': 1300,
  'koniec-i-start-dnia-praca': 2800,
  'koniec-i-start-dnia-rano': 3200,
  'koniec-i-start-dnia-sprzatanie': 2600,
  'koniec-i-start-dnia-wieczor': 4500,
  'koniec-i-start-dnia-wyslij': 5300,
  'koniec-i-start-dnia-zamknij': 2300,
  'mini-build': 9000,
  'mini-deploy': 16600,
  'mini-dodaj': 5900,
  'mini-dostepy': 3800,
  'mini-moduly': 7400,
  'mini-notka': 800,
  'mini-opublikowane': 5000,
  'mini-polecenie': 8700,
  'mini-synchronizuj': 9900,
  'mini-vscode': 8300,
  'mini-zbudowane': 6700,
  'mini-zbuduj-polecenie': 10200,
  'nowy-modul-budowa': 24400,
  'nowy-modul-dane': 26300,
  'nowy-modul-gotowe': 4100,
  'nowy-modul-plan': 14900,
  'nowy-modul-poprawka-wlasciciel': 9700,
  'nowy-modul-poprawka-zespol': 14100,
  'nowy-modul-prosba': 6900,
  'nowy-modul-przeglad': 14300,
  'nowy-modul-skan': 10200,
  'nowy-modul-strona': 7300,
  'nowy-modul-weryfikacja': 13400,
  'nowy-modul-wywiad': 9600,
  'onb-bitwarden-haslo': 8500,
  'onb-bitwarden-okno': 3700,
  'onb-dane': 5200,
  'onb-dane-gotowe': 2500,
  'onb-klucze-nowy': 2700,
  'onb-koniec': 3100,
  'onb-otworz': 3200,
  'onb-repozytorium': 2100,
  'onb-sejf-kolekcja': 4400,
  'onb-sejf-logowanie': 12900,
  'onb-srodowisko': 4200,
  'onb-vpn-brak': 6500,
  'onb-vpn-laczenie': 9600,
  'onb-vpn-polaczono': 5600,
  'podsumowanie-koniec': 500,
  'podsumowanie-plansza': 9300,
  'publikacja-formularz': 10300,
  'publikacja-mr': 5600,
  'publikacja-przeglad': 3600,
  'publikacja-wiersz': 5900,
  'publikacja-wysylka': 5400,
  'roadmapa-eksport': 3200,
  'roadmapa-gantt': 6400,
  'roadmapa-kanban': 4400,
  'roadmapa-os-czasu': 7000,
  'roadmapa-polecenie': 10500,
  'roadmapa-tabela': 8700,
  'skille-i-agenci-ado-mini': 6100,
  'skille-i-agenci-ado-proto': 6800,
  'skille-i-agenci-agenci': 4200,
  'skille-i-agenci-confluence-odczyt': 9500,
  'skille-i-agenci-confluence-zapis': 9100,
  'skille-i-agenci-fazy': 5500,
  'skille-i-agenci-jira': 12000,
  'skille-i-agenci-model': 5100,
  'skille-i-agenci-skille': 3100,
  'skille-i-agenci-zgloszenie': 4000,
  'spotkania-akceptacja': 6600,
  'spotkania-anonimizacja': 2800,
  'spotkania-cli': 10200,
  'spotkania-notatka': 8700,
  'spotkania-plik': 5000,
  'spotkania-polecenie': 7800,
  'spotkania-szablon': 4900,
  'sprinty-agenda': 7600,
  'sprinty-odswiez': 10600,
  'sprinty-odswiezone': 4900,
  'sprinty-polecenie': 10400,
  'sprinty-poprzedni': 5500,
  'sprinty-pytanie': 7800,
  'sprinty-review': 7300,
  'sprinty-status': 3100,
  'sprinty-trend': 8700,
  'start-dashboard': 3300,
  'start-folder': 4100,
  'start-instalacja': 3200,
  'start-pobierz': 7500,
  'start-rozpakuj': 9000,
  'start-serwer': 1400,
  'synchronizacja-gitlab': 500,
  'synchronizacja-jan': 6400,
  'synchronizacja-jawne': 1100,
  'synchronizacja-kolega': 3200,
  'synchronizacja-otworz': 4800,
  'synchronizacja-pobierz': 5900,
  'synchronizacja-szyfr': 3200,
  'synchronizacja-wyslij': 7300,
  'szkolenie-etap-2': 13100,
  'szkolenie-logowanie': 11200,
  'szkolenie-mural': 16000,
  'szkolenie-otworz': 5800,
  'szkolenie-terminal-blad': 4700,
  'szkolenie-terminal-poprawka': 13600,
  'ustawienia-gotowe': 5100,
  'ustawienia-instalacja': 3900,
  'ustawienia-klucze': 5800,
  'ustawienia-narzedzia': 6700,
  'ustawienia-odblokuj': 2800,
  'ustawienia-system': 6500,
  'uzycie-filtr': 6100,
  'uzycie-gotowe': 5100,
  'uzycie-otworz': 6100,
  'uzycie-pobierz': 6700,
  'uzycie-sync': 2400,
  'zespol-dodaj': 20200,
  'zespol-gotowe': 7900,
  'zespol-polecenie': 9900,
  'zespol-profil': 4400,
  'zespol-szukaj': 4900,
  'zespol-zdjecie': 6600,
  'zgloszenia-description': 17400,
  'zgloszenia-idea': 18800,
  'zgloszenia-kopiuj': 15800,
  'zgloszenia-mr': 7000,
  'zgloszenia-przycisk': 9500,
  'zgloszenia-screenshot': 4600,
  'zgloszenia-wyslij': 5200,
};
// generated:end

/** Fallback for a step with nothing to estimate from. */
export const DEFAULT_STEP_MS = 8000;
const MIN_MS = 1500;
const MAX_MS = 40000;

/** Weights of the fitted model (ms per unit). */
const W = {
  base: 1700, pointer: 850, char: 50, line: 240, show: 100, surface: 700, other: 150, camera: 800,
};

/**
 * Estimate a step's autopilot time from its actions.
 * @param {{ camera?: unknown, actions?: object[] }} step
 * @returns {number} positive integer ms
 */
export function estimateStepMs(step) {
  const actions = step && Array.isArray(step.actions) ? step.actions : null;
  if (!actions || !actions.some((a) => a && a.type !== 'narrate')) return DEFAULT_STEP_MS;
  let ms = W.base + (step.camera !== undefined ? W.camera : 0);
  const visit = (a) => {
    if (!a || typeof a !== 'object') return;
    const len = (s) => (typeof s === 'string' ? s.length : 0);
    switch (a.type) {
      case 'click': ms += W.pointer; break;
      case 'hover': ms += W.pointer + (Number.isFinite(a.ms) ? a.ms : 1100); break;
      case 'type': ms += W.pointer + W.char * len(a.text); break;
      case 'navigate': ms += 1.5 * W.pointer; break;
      case 'ask':
        ms += 2 * W.pointer + W.char * len(a.text);
        (Array.isArray(a.then) ? a.then : []).forEach(visit);
        break;
      case 'terminal': ms += W.line * (Array.isArray(a.lines) ? a.lines.length : 0); break;
      case 'progress': ms += W.other + W.line * (Array.isArray(a.lines) ? a.lines.length : 0); break;
      case 'show': case 'modal': case 'toast': case 'badge': case 'preview': ms += W.show; break;
      case 'wait': ms += Number.isFinite(a.ms) ? a.ms : 0; break;
      case 'surface': ms += W.surface; break;
      case 'camera': case 'scroll': ms += W.camera; break;
      case 'editor': ms += W.char * Math.min(400, len(a.text)) / 4; break;
      case 'narrate': break;
      default: ms += W.other;
    }
  };
  actions.forEach(visit);
  return Math.round(Math.min(MAX_MS, Math.max(MIN_MS, ms)) / 100) * 100;
}

/**
 * Expected time of one step: the measured value when the walk knew the step,
 * else the estimate.
 * @param {{ id?: string }} step
 * @returns {number} positive integer ms
 */
export function stepMs(step) {
  const id = step && step.id;
  if (typeof id === 'string' && Object.prototype.hasOwnProperty.call(STEP_MS, id)) return STEP_MS[id];
  return estimateStepMs(step);
}
