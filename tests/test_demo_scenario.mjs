// tests/test_demo_scenario.mjs
// Integrity of the demo scenario (demo/scenario.mjs) against its contract
// (demo/scenario-schema.mjs) and the mock registry (demo/mocks/index.mjs).
// All three are DOM-free, so they import straight into node.
// Run: node --test tests/test_demo_scenario.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import scenario from '../demo/scenario.mjs';
import {
  CHAPTER_ORDER, ACTION_TYPES, MASCOT_POSES, validateScenario, navigatePath, allPages, parseDemoHash,
  validateTracks, resolveTrack, demoHash,
} from '../demo/scenario-schema.mjs';
import { MASCOT_GEOMETRY, MASCOT_HIDDEN_POSES } from '../demo/mascot-geometry.mjs';
import { MOCKS, LABELS, renderMock } from '../demo/mocks/index.mjs';
import { CHAPTERS } from '../demo/chapter-cards.mjs';
import { TRACKS, TRACK_META, DEFAULT_TRACK } from '../demo/tracks.mjs';
import { STEP_MS, DEFAULT_STEP_MS, stepMs, estimateStepMs } from '../demo/step-durations.mjs';
import { markdownToHtml, previewLabel } from '../demo/surfaces/markdown.mjs';
import { DURATIONS } from '../demo/durations.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = path.join(ROOT, 'demo');
const MOCK_IDS = Object.keys(MOCKS);

/** Every file under demo/, recursively. */
function demoFiles(dir = DEMO) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? demoFiles(p) : [p];
  });
}

/** Wrap one action into a minimal valid scenario, for negative cases. */
function withAction(action, stepExtra = {}) {
  return {
    ending: { title: 'The end', subtitle: 'Thank you.', mascot: 'celebrating' },
    chapters: CHAPTER_ORDER.map((id) => ({
      id,
      title: 'Chapter',
      subtitle: 'Chapter subtitle.',
      mascot: 'wave',
      steps: [{
        id: id + '-krok',
        caption: 'I do **something** important.',
        mascot: 'success',
        ...(id === 'start' ? stepExtra : {}),
        actions: [{ type: 'narrate', title: 'T', body: 'B' }, ...(id === 'start' && action ? [action] : [])],
      }],
    })),
  };
}

// Polish words (with and without diacritics) that must never reach visible copy:
// the demo speaks English. Any word carrying a Polish-only letter counts too.
const NON_ENGLISH = ['wlacz', 'bedzie', 'sciezka', 'moze', 'zrodlo', 'zrodla', 'wyslij', 'wyslac', 'pobrac', 'dzien',
  'nastepny', 'kazdy', 'blad', 'wlasny', 'wspolny', 'zespolu', 'jezeli', 'wiecej', 'zrobic',
  'jest', 'oraz', 'albo', 'tylko', 'teraz', 'klikam', 'gotowe', 'zamknij', 'anuluj', 'pobierz', 'dane', 'pliki',
  'przez', 'dla', 'nie', 'sie', 'czy', 'ktory', 'ktora', 'ktore', 'otworz', 'zapisz', 'ustawienia'];
const POLISH_LETTER = /[ąćęłńóśźż]/;

/**
 * The Polish words found in one piece of visible copy. Identifiers are
 * not prose: text inside <code>...</code> and slug/path tokens (an all-ASCII
 * token joined by '-', '/', '.' or '_', e.g. `day-cycle`,
 * `feedback/zgloszenie.md`) are skipped; every other word is checked.
 * @param {string} text plain text or HTML
 * @returns {string[]}
 */
function polishWords(text) {
  const plain = String(text)
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase();
  const prose = plain.split(/\s+/).filter((tok) => !/^[\x21-\x7e]*[a-z0-9][-/._][a-z0-9][\x21-\x7e]*$/.test(tok));
  const words = prose.join(' ').split(/[^a-zÀ-ſ]+/);
  return [...new Set(words.filter((w) => w && (NON_ENGLISH.includes(w) || POLISH_LETTER.test(w))))];
}

describe('demo scenario', () => {
  it('validates with no problems against the mock registry', () => {
    assert.deepEqual(validateScenario(scenario, { mocks: MOCK_IDS }), []);
  });

  it('has every chapter of CHAPTER_ORDER, in order, each with a title card', () => {
    assert.deepEqual(scenario.chapters.map((c) => c.id), CHAPTER_ORDER);
    for (const ch of scenario.chapters) {
      assert.ok(ch.title && ch.subtitle, ch.id);
      assert.ok(MASCOT_POSES.includes(ch.mascot), ch.id + ': ' + ch.mascot);
    }
    assert.ok(scenario.ending && MASCOT_POSES.includes(scenario.ending.mascot));
  });

  it('every step has a caption and a Pip pose, and Pip poses exist as files with known geometry', () => {
    for (const ch of scenario.chapters) {
      for (const step of ch.steps) {
        assert.ok(typeof step.caption === 'string' && step.caption.trim(), step.id + ' bez caption');
        assert.ok(MASCOT_POSES.includes(step.mascot), step.id + ': ' + step.mascot);
      }
    }
    for (const pose of MASCOT_POSES) {
      const file = path.join(ROOT, 'assets', 'mascot', 'pip-' + pose + '.svg');
      assert.ok(fs.existsSync(file), 'brak pliku ' + pose);
      const vb = /viewBox="([^"]+)"/.exec(fs.readFileSync(file, 'utf8'))[1].split(/\s+/).map(Number);
      assert.deepEqual(MASCOT_GEOMETRY[pose] && MASCOT_GEOMETRY[pose].vb, vb, 'viewBox ' + pose);
    }
    const all = new Set(scenario.chapters.flatMap((c) => [c.mascot, ...c.steps.map((st) => st.mascot)]));
    for (const pose of all) assert.ok(MASCOT_POSES.includes(pose), pose);
  });

  it('never puts a vanishing Pip in the caption pill or on a summary tile', () => {
    for (const pose of MASCOT_HIDDEN_POSES) assert.ok(MASCOT_POSES.includes(pose), pose);
    const board = renderMock('podsumowanie-board', {});
    assert.match(board, /--podsumowanie-cols:\d+/);
    for (const ch of scenario.chapters) {
      if (ch.id === 'summary') continue;
      const tile = renderMock('podsumowanie-tile', { id: ch.id });
      for (const pose of MASCOT_HIDDEN_POSES) assert.ok(!tile.includes('/' + pose + '.svg'), ch.id + ': ' + pose);
    }
  });

  it('rejects a Pip pose that hides the figure in a step caption (the pill would show an empty box)', () => {
    for (const pose of MASCOT_HIDDEN_POSES) {
      assert.ok(validateScenario(withAction(null, { mascot: pose })).some((p) => p.includes('hides Pip')), pose);
    }
    for (const ch of scenario.chapters) {
      for (const step of ch.steps) assert.ok(!MASCOT_HIDDEN_POSES.includes(step.mascot), step.id + ': ' + step.mascot);
    }
  });

  it('no title card (CHAPTERS, the ending) uses a pose that hides the figure or does not exist', () => {
    for (const [id, c] of Object.entries(CHAPTERS)) assert.ok(!MASCOT_HIDDEN_POSES.includes(c.mascot), id + ': ' + c.mascot);
    assert.ok(!MASCOT_HIDDEN_POSES.includes(scenario.ending.mascot));
    const bad = withAction(null);
    bad.chapters[0].mascot = 'not-a-pose';
    assert.ok(validateScenario(bad).some((p) => p.includes('MASCOT_POSES')));
  });

  it('validates the prompt directory of a cmd line and the explorer empty / reset forms', () => {
    const cmd = (extra) => ({ type: 'terminal', lines: [{ role: 'cmd', text: 'git clone x', ...extra }] });
    assert.deepEqual(validateScenario(withAction(cmd({ cwd: '~' }))), []);
    assert.ok(validateScenario(withAction({ type: 'terminal', lines: [{ role: 'out', text: 'x', cwd: '~' }] })).some((p) => p.includes('cwd')));
    assert.ok(validateScenario(withAction(cmd({ cwd: '' }))).some((p) => p.includes('cwd')));
    assert.deepEqual(validateScenario(withAction({ type: 'explorer', empty: true })), []);
    assert.deepEqual(validateScenario(withAction({ type: 'explorer', reset: true })), []);
    assert.ok(validateScenario(withAction({ type: 'explorer' })).some((p) => p.includes('explorer without')));
  });

  it('every chapter after onboarding starts with the vault unlocked, except the ones that lock or unlock it', () => {
    // Chapters whose story is the vault itself may start locked; the rest find
    // it open (onboarding unlocked it; a server restart does not lock it).
    const MAY_START_LOCKED = new Set(['start', 'onboarding', 'day-cycle', 'updates']);
    const OWNED = ['settings', 'team-keys', 'academy', 'new-module', 'publishing', 'catalog',
      'using-a-module', 'design', 'sync', 'meetings', 'time-tracking'];
    for (const id of OWNED) {
      assert.ok(!MAY_START_LOCKED.has(id));
      const ch = scenario.chapters.find((c) => c.id === id);
      const open = (ch.setup || []).some((a) => a.type === 'show' && a.mock === 'topbar-bw' && a.props && a.props.unlocked === true);
      assert.ok(open, id + ': setup bez otwartego sejfu');
    }
  });

  it('"Time logging" shows one dataset in every chapter: same people and teams', () => {
    const a = renderMock('uzycie-modulu-body', {});
    const b = renderMock('czas-pracy-body', {});
    const names = (html) => [...html.matchAll(/class="(?:tlc|czas-pracy)-name-text">([^<]+)</g)].map((m) => m[1]).sort();
    assert.ok(names(a).length > 5);
    assert.deepEqual(names(a), names(b));
    const teams = (html) => [...html.matchAll(/class="ds-segment[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1]);
    assert.deepEqual(teams(a), teams(b));
  });

  it('rejects a step without caption, an unknown Pip pose and a bad camera', () => {
    assert.deepEqual(validateScenario(withAction(null)), []);
    assert.ok(validateScenario(withAction(null, { caption: '' })).some((p) => p.includes('no caption')));
    assert.ok(validateScenario(withAction(null, { mascot: 'mascot-cemetery' })).some((p) => p.includes('mascot outside')));
    assert.ok(validateScenario(withAction(null, { camera: { zoom: 2 } })).some((p) => p.includes('camera')));
    assert.ok(validateScenario(withAction(null, { camera: { target: '#x', zoom: 9 } })).some((p) => p.includes('zoom')));
    assert.deepEqual(validateScenario(withAction({ type: 'camera', full: true }, { camera: { target: '#x', zoom: 1.5 } })), []);
  });

  it('keeps step ids unique across the whole file', () => {
    const ids = scenario.chapters.flatMap((c) => c.steps.map((s) => s.id));
    assert.equal(new Set(ids).size, ids.length);
  });

  it('every mock renders a string under node', () => {
    for (const id of MOCK_IDS) assert.equal(typeof renderMock(id, {}), 'string', id);
  });

  it('rejects a click or type without target, an unknown type and a navigate with no road', () => {
    assert.ok(validateScenario(withAction({ type: 'click' })).some((p) => p.includes('click without target')));
    assert.ok(validateScenario(withAction({ type: 'type', text: 'x' })).some((p) => p.includes('type without target')));
    assert.ok(validateScenario(withAction({ type: 'teleport' })).some((p) => p.includes('unknown action type')));
    assert.ok(validateScenario(withAction({ type: 'navigate', view: 'no-such-id' })).some((p) => p.includes('navigate without a known')));
    assert.ok(validateScenario(withAction({ type: 'navigate', view: 'dashboard', tab: 'keys' })).length > 0);
    assert.ok(validateScenario(withAction({ type: 'show', mock: 'brak-makiety', target: '#x' }), { mocks: MOCK_IDS })
      .some((p) => p.includes('unknown mock')));
  });

  it('validates ask nesting: text plus a non-empty then of valid actions, no ask inside ask', () => {
    const ok = { type: 'ask', text: 'show me the settings', then: [{ type: 'navigate', view: 'settings', tab: 'keys' }, { type: 'click', target: '#x' }] };
    assert.deepEqual(validateScenario(withAction(ok)), []);
    assert.ok(validateScenario(withAction({ type: 'ask', text: 'x', then: [] })).some((p) => p.includes('ask without then')));
    assert.ok(validateScenario(withAction({ type: 'ask', text: 'x', then: [{ type: 'click' }] })).some((p) => p.includes('click without target')));
    assert.ok(validateScenario(withAction({ type: 'ask', text: 'x', then: [{ type: 'ask', text: 'y', then: [{ type: 'wait', ms: 1 }] }] }))
      .some((p) => p.includes('nested ask')));
  });

  it('every action in the file has a known type and every step narrates', () => {
    for (const ch of scenario.chapters) {
      for (const step of ch.steps) {
        assert.ok(step.actions.some((a) => a.type === 'narrate'), step.id);
        for (const a of step.actions) assert.ok(ACTION_TYPES.includes(a.type), step.id + ': ' + a.type);
      }
    }
  });

  it('expands navigate into visible clicks: rail, hub flyout, settings tab', () => {
    const pages = allPages(scenario);
    assert.deepEqual(navigatePath({ view: 'onboarding-wizard' }, pages).map((o) => o.effect.kind), ['view']);
    assert.deepEqual(navigatePath({ view: 'settings', tab: 'tools' }, pages).map((o) => o.effect.kind), ['view', 'tab']);
    const hub = navigatePath({ view: 'prototypy' }, pages);
    assert.deepEqual(hub.map((o) => o.effect.kind), ['hub', 'view']);
    assert.match(hub[0].click, /data-view="assets"/);
    assert.match(hub[1].click, /data-flyout-view="prototypy"/);
    assert.equal(navigatePath({ view: 'team' }, pages), null, 'a hub is not a view');
  });

  it('parses the hash and falls back to the first step', () => {
    assert.deepEqual(parseDemoHash('#onboarding/2', scenario), { chapter: CHAPTER_ORDER.indexOf('onboarding'), step: 2, valid: true, track: 'full' });
    assert.equal(parseDemoHash('#onboarding/999', scenario).valid, false);
    assert.equal(parseDemoHash('#nic', scenario).chapter, 0);
  });

  it('visible copy is English (no Polish words)', () => {
    const texts = [...LABELS];
    for (const ch of scenario.chapters) {
      texts.push(ch.title, ch.subtitle);
      for (const step of ch.steps) {
        texts.push(step.caption.replace(/\*\*/g, ''));
        for (const a of step.actions) {
          if (a.type === 'narrate') texts.push(a.title, a.body);
          if (a.type === 'toast') texts.push(a.title, a.desc || '');
        }
      }
    }
    for (const id of MOCK_IDS) texts.push(renderMock(id, {}));
    for (const t of texts) {
      const found = polishWords(t);
      assert.deepEqual(found, [], `${found.join(', ')} in: ${String(t).replace(/<[^>]+>/g, ' ').slice(0, 80)}`);
    }
  });

  it('the Polish-word check skips <code> and slugs, never prose', () => {
    assert.deepEqual(polishWords('The list of people in zespolu Borealis.'), ['zespolu']);
    assert.deepEqual(polishWords('<p>The <code>koniec-i-start-dnia</code> chapter <code>Zespół</code> shows teams.</p>'), []);
    assert.deepEqual(polishWords('The chapter koniec-i-start-dnia and the file feedback/zgloszenie.md'), []);
    assert.deepEqual(polishWords('<code>x</code> and then moze so'), ['moze']);
    assert.deepEqual(polishWords('Click Wyślij to send.'), ['wyślij']);
    assert.deepEqual(polishWords('Click Send to send it.'), []);
  });

  it('validates hover, tool verbs, editor mode and surface props', () => {
    assert.deepEqual(validateScenario(withAction({ type: 'hover', target: '#x', ms: 500 })), []);
    assert.ok(validateScenario(withAction({ type: 'hover' })).some((p) => p.includes('hover without target')));
    assert.ok(validateScenario(withAction({ type: 'hover', target: '#x', ms: -1 })).some((p) => p.includes('hover.ms')));
    const tool = (extra) => ({ type: 'terminal', lines: [{ role: 'tool', text: 'js/app.js', ...extra }] });
    assert.deepEqual(validateScenario(withAction(tool({ verb: 'Edit' }))), []);
    assert.ok(validateScenario(withAction(tool({ verb: 'Edytuj' }))).some((p) => p.includes('verb')));
    assert.ok(validateScenario(withAction({ type: 'terminal', lines: [{ role: 'out', text: 'x', verb: 'Read' }] })).some((p) => p.includes('verb')));
    assert.deepEqual(validateScenario(withAction({ type: 'editor', file: 'a.js', text: 'x', mode: 'replace' })), []);
    assert.ok(validateScenario(withAction({ type: 'editor', file: 'a.js', text: 'x', mode: 'nadpisz' })).some((p) => p.includes('editor.mode')));
    assert.deepEqual(validateScenario(withAction({ type: 'surface', show: 'screen', mock: 'vpn-client-screen', props: { state: 'connected' } }), { mocks: MOCK_IDS }), []);
    assert.ok(validateScenario(withAction({ type: 'surface', show: 'cockpit', props: { a: 1 } })).some((p) => p.includes('surface.props')));
    assert.ok(validateScenario(withAction({ type: 'surface', show: 'screen', mock: 'vpn-client-screen', props: 'x' }), { mocks: MOCK_IDS }).some((p) => p.includes('surface.props')));
  });

  it('module pages start hidden and reach a flyout only through a chapter flyout action', () => {
    for (const page of scenario.pages) assert.equal(page.initial, false, page.view + ' must have initial: false');
    const leaky = withAction(null);
    leaky.pages = [{ hub: 'apps', view: 'mini-test', label: 'Mini test' }];
    assert.ok(validateScenario(leaky).some((p) => p.includes('initial: false')));
    const page = { hub: 'apps', view: 'mini-test', label: 'Mini test', initial: false };
    const noFlyout = withAction({ type: 'navigate', view: 'mini-test' });
    noFlyout.pages = [page];
    assert.ok(validateScenario(noFlyout).some((p) => p.includes('without an earlier flyout')));
    const withFlyout = withAction({ type: 'navigate', view: 'mini-test' });
    withFlyout.pages = [page];
    withFlyout.chapters[CHAPTER_ORDER.indexOf('start')].setup = [{ type: 'flyout', view: 'mini-test' }];
    assert.deepEqual(validateScenario(withFlyout), []);
    const inAsk = withAction({ type: 'ask', text: 'open it', then: [{ type: 'navigate', view: 'mini-test' }] });
    inAsk.pages = [page];
    assert.ok(validateScenario(inAsk).some((p) => p.includes('without an earlier flyout')));
  });

  it('uses fictitious people only: no company address, no vendor sign-in names, no team names', () => {
    const files = demoFiles().filter((f) => /\.(mjs|js|html|css)$/.test(f));
    const teamFile = path.join(ROOT, 'data-sub-repositories', 'ds-data', 'team', 'team-members.json');
    let names = [];
    if (fs.existsSync(teamFile)) {
      const raw = JSON.parse(fs.readFileSync(teamFile, 'utf8'));
      const list = Array.isArray(raw) ? raw : (raw.team_members || []);
      names = list.map((m) => [m.first_name || '', m.last_name || ''].join(' ').trim())
        .filter((n) => n.includes(' '));
    }
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const mails = src.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi) || [];
      for (const m of mails) assert.ok(/@(?:[\w-]+\.)*example\.(?:com|org|net|test)$|@demo$/.test(m) || /\.(?:js|mjs|css|svg|png)$/.test(m), f + ' carries a non-example email address: ' + m);
      assert.ok(!/\bentra\b|azure ad|office 365/i.test(src), f + ' names a sign-in vendor');
      for (const n of names) assert.ok(!src.includes(n), f + ' carries a surname from the team directory: ' + n);
    }
  });
});

describe('demo tracks (demo/tracks.mjs)', () => {
  it('every track validates against the scenario: known ids, CHAPTER_ORDER, no duplicates', () => {
    // A failure here names the stale ids: a chapter rewrite renamed a step the
    // short list still points at - update demo/tracks.mjs, never this test.
    assert.deepEqual(validateTracks(TRACKS, scenario), []);
  });

  it('the default track is the full scenario: every chapter, every step, in order', () => {
    assert.equal(DEFAULT_TRACK, 'full');
    assert.equal(TRACKS.full, null);
    const plan = resolveTrack(TRACKS.full, scenario);
    assert.deepEqual(plan.map((p) => p.id), CHAPTER_ORDER);
    plan.forEach((p) => assert.deepEqual(p.steps, scenario.chapters[p.ci].steps.map((_s, i) => i)));
  });

  it('the short track has 45-75 steps and every track has a label', () => {
    const n = TRACKS.short.reduce((sum, e) => sum + e.steps.length, 0);
    assert.ok(n >= 45 && n <= 75, `short: ${n} steps`);
    const resolved = resolveTrack(TRACKS.short, scenario).reduce((sum, p) => sum + p.steps.length, 0);
    assert.equal(resolved, n, 'every step of the short list exists in the scenario');
    for (const id of Object.keys(TRACKS)) assert.ok(TRACK_META[id] && TRACK_META[id].label, id);
  });

  it('validateTracks names unknown ids, wrong chapters, order and duplicates', () => {
    const [a, b] = [scenario.chapters[1], scenario.chapters[2]];
    const bad = (def) => validateTracks({ t: def }, scenario).join(' | ');
    assert.match(bad([{ chapter: 'missing', steps: ['x'] }]), /unknown chapter "missing"/);
    assert.match(bad([{ chapter: a.id, steps: ['no-such-step'] }]), /unknown step "no-such-step"/);
    assert.match(bad([{ chapter: a.id, steps: [b.steps[0].id] }]), /belongs to chapter/);
    assert.match(bad([{ chapter: b.id, steps: [b.steps[0].id] }, { chapter: a.id, steps: [a.steps[0].id] }]), /out of CHAPTER_ORDER order/);
    assert.match(bad([{ chapter: a.id, steps: [a.steps[1].id, a.steps[0].id] }]), /out of the step order/);
    assert.match(bad([{ chapter: a.id, steps: [a.steps[0].id, a.steps[0].id] }]), /repeated/);
    assert.match(bad([{ chapter: a.id, steps: [a.steps[0].id] }, { chapter: a.id, steps: [a.steps[1].id] }]), /repeated/);
    assert.match(bad([{ chapter: a.id, steps: [] }]), /without steps/);
    assert.match(bad([]), /non-empty list/);
    assert.deepEqual(validateTracks({ t: [{ chapter: a.id, steps: [a.steps[0].id] }] }, scenario), []);
  });

  it('resolveTrack skips unknown ids quietly (the page never throws on a stale list)', () => {
    const a = scenario.chapters[1];
    const plan = resolveTrack([{ chapter: 'missing', steps: ['x'] }, { chapter: a.id, steps: ['missing', a.steps[0].id] }], scenario);
    assert.deepEqual(plan, [{ ci: 1, id: a.id, steps: [0] }]);
  });

  it('parses track hashes: prefix, track-relative step, bare track, fallback to the track start', () => {
    const tracks = { full: null, t: [{ chapter: 'onboarding', steps: [scenario.chapters[2].steps[1].id, scenario.chapters[2].steps[3].id] }] };
    const on = CHAPTER_ORDER.indexOf('onboarding');
    assert.deepEqual(parseDemoHash('#t:onboarding/1', scenario, tracks), { chapter: on, step: 3, valid: true, track: 't' });
    assert.deepEqual(parseDemoHash('#t', scenario, tracks), { chapter: on, step: 1, valid: false, track: 't' });
    assert.deepEqual(parseDemoHash('#t:start/0', scenario, tracks), { chapter: on, step: 1, valid: false, track: 't' });
    assert.equal(parseDemoHash('#unknown:onboarding/0', scenario, tracks).track, 'full');
    assert.deepEqual(parseDemoHash('#full', scenario, tracks), { chapter: 0, step: 0, valid: false, track: 'full' });
    assert.equal(demoHash('full', 'onboarding', 2), '#onboarding/2');
    assert.equal(demoHash('short', 'onboarding', 2), '#short:onboarding/2');
  });
});

describe('demo step durations (demo/step-durations.mjs)', () => {
  const isPosInt = (v) => Number.isInteger(v) && v > 0;

  it('every scenario step has an expected time: a STEP_MS entry or the estimate, a positive integer', () => {
    for (const ch of scenario.chapters) {
      for (const step of ch.steps) {
        const ms = stepMs(step);
        assert.ok(isPosInt(ms), `${step.id}: ${ms}`);
        if (Object.prototype.hasOwnProperty.call(STEP_MS, step.id)) assert.equal(ms, STEP_MS[step.id]);
        else assert.equal(ms, estimateStepMs(step));
      }
    }
  });

  it('STEP_MS holds positive integers under ASCII kebab-case ids, keys sorted', () => {
    const keys = Object.keys(STEP_MS);
    assert.ok(keys.length > 0);
    assert.deepEqual(keys, [...keys].sort());
    for (const k of keys) {
      assert.match(k, /^[a-z0-9]+(-[a-z0-9]+)*$/);
      assert.ok(isPosInt(STEP_MS[k]), `${k}: ${STEP_MS[k]}`);
    }
  });

  it('the fallback estimates an unknown step from its actions and defaults a bare one', () => {
    assert.equal(stepMs({ id: 'no-such-step-id', actions: [{ type: 'narrate', title: 't', body: 'b' }] }), DEFAULT_STEP_MS);
    assert.equal(stepMs(null), DEFAULT_STEP_MS);
    const short = stepMs({ id: 'x-1', actions: [{ type: 'click', target: '#a' }] });
    const long = stepMs({ id: 'x-2', actions: [{ type: 'click', target: '#a' }, { type: 'wait', ms: 5000 }, { type: 'terminal', lines: [{ role: 'out', text: 'a' }, { role: 'out', text: 'b' }] }] });
    assert.ok(isPosInt(short) && isPosInt(long) && long > short, `${short} < ${long}`);
    assert.ok(isPosInt(DEFAULT_STEP_MS));
  });
});

describe('demo paste and Markdown preview rules (demo/scenario-schema.mjs)', () => {
  const has = (problems, frag) => problems.some((p) => p.includes(frag));

  it('paste must be a non-empty part of text, on type and on user/cmd terminal lines only', () => {
    assert.deepEqual(validateScenario(withAction({ type: 'type', target: '#x', text: 'ab https://x.y', paste: 'https://x.y' })), []);
    assert.deepEqual(validateScenario(withAction({ type: 'type', target: '#x', text: 'a b', paste: ['a', 'b'] })), []);
    assert.ok(has(validateScenario(withAction({ type: 'type', target: '#x', text: 'abc', paste: 'zzz' })), 'paste must'));
    assert.ok(has(validateScenario(withAction({ type: 'type', target: '#x', text: 'abc', paste: [] })), 'paste must'));
    assert.ok(has(validateScenario(withAction({ type: 'type', target: '#x', text: 'abc', paste: [''] })), 'paste must'));
    assert.deepEqual(validateScenario(withAction({ type: 'terminal', lines: [{ role: 'user', text: 'go x', paste: 'x' }] })), []);
    assert.deepEqual(validateScenario(withAction({ type: 'terminal', lines: [{ role: 'cmd', text: 'go x', paste: 'x' }] })), []);
    assert.ok(has(validateScenario(withAction({ type: 'terminal', lines: [{ role: 'tool', text: 'go x', paste: 'x' }] })), 'paste only'));
  });

  it('editor group is only term and only for a .md file; close needs only the file', () => {
    assert.deepEqual(validateScenario(withAction({ type: 'editor', file: 'plans/a.md', text: '# A', group: 'term' })), []);
    assert.deepEqual(validateScenario(withAction({ type: 'editor', file: 'plans/a.md', group: 'term', close: true })), []);
    assert.ok(has(validateScenario(withAction({ type: 'editor', file: 'a.js', text: 'x', group: 'term' })), 'only for a .md file'));
    assert.ok(has(validateScenario(withAction({ type: 'editor', file: 'a.md', text: 'x', group: 'files' })), "only be 'term'"));
    assert.ok(has(validateScenario(withAction({ type: 'editor', file: 'a.md' })), 'editor needs'));
  });
});

describe('demo Markdown preview (demo/surfaces/markdown.mjs)', () => {
  it('escapes every text, inline markup included', () => {
    const html = markdownToHtml('a <b>x</b> & "q" `<i>`');
    assert.ok(!html.includes('<b>') && !html.includes('<i>'), html);
    assert.ok(html.includes('&lt;b&gt;') && html.includes('&amp;') && html.includes('&quot;'), html);
    assert.ok(html.includes('<code>&lt;i&gt;</code>'), html);
  });

  it('hides a YAML frontmatter, also one closed by a line with trailing spaces', () => {
    assert.equal(markdownToHtml('---\nid: x\n---\n# T'), '<h1>T</h1>');
    assert.equal(markdownToHtml('---\nid: x\n---  \n# T'), '<h1>T</h1>');
  });

  it('renders headings, inline styles, links without href and rules', () => {
    assert.equal(markdownToHtml('## H'), '<h2>H</h2>');
    assert.equal(markdownToHtml('**b** *i* [t](http://x)'), '<p><strong>b</strong> <em>i</em> <a>t</a></p>');
    assert.equal(markdownToHtml('a\n\n---\n\nb'), '<p>a</p><hr><p>b</p>');
  });

  it('renders lists, switching between ordered and bullet, and task items', () => {
    assert.equal(markdownToHtml('1. a\n2. b\n- c'), '<ol><li>a</li><li>b</li></ol><ul><li>c</li></ul>');
    assert.equal(markdownToHtml('- [ ] a\n- [x] b'),
      '<ul><li class="vsc-md-task"><input type="checkbox" disabled> a</li><li class="vsc-md-task"><input type="checkbox" disabled checked> b</li></ul>');
  });

  it('renders tables, block quotes and fenced code', () => {
    assert.equal(markdownToHtml('| A | B |\n|---|---|\n| 1 | 2 |'),
      '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
    assert.equal(markdownToHtml('> a\n> b'), '<blockquote><p>a b</p></blockquote>');
    assert.equal(markdownToHtml('```js\nif (a < b) {}\n```'), '<pre><code>if (a &lt; b) {}</code></pre>');
  });

  it('labels a preview tab with the bare file name', () => {
    assert.equal(previewLabel('plans/2026/plan.md'), 'Preview plan.md');
    assert.equal(previewLabel('README.md'), 'Preview README.md');
  });
});

describe('demo durations copy in Settings > Demo (index.html)', () => {
  it('the static Short / Full totals equal the sum of demo/durations.mjs per track', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const line = /<p[^>]*data-demo-durations[^>]*>([^<]*)<\/p>/.exec(html);
    assert.ok(line, 'no [data-demo-durations] line in index.html');
    const total = (track) => Object.values(DURATIONS[track]).reduce((a, b) => a + b, 0);
    const m = /Short approx\. (\d+) min · Full approx\. (\d+) min/.exec(line[1]);
    assert.ok(m, line[1]);
    assert.equal(Number(m[1]), total('short'), 'Short');
    assert.equal(Number(m[2]), total('full'), 'Full');
  });
});
