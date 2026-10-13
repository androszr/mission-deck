// ── Mission Deck — js/settings-skille.js ──────────────────────────────────
// Renders the "Skills" tab in #view-settings: one card per skill, grouped by what
// the skill is for. Everything on a card except the grouping, the kind chip and
// the output line is derived server-side from the skill files themselves
// (GET /api/skills/list), so a card cannot drift from the skill it describes.
// Exports: renderSkilleSection()
// Called from js/settings.js renderSettingsView() — fire-and-forget (not awaited).

import { openDocModal } from './doc-modal.js';
import { GROUPS, SKILL_KIND, SKILL_OUTPUT } from './settings-skille-groups.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A SKILL.md description is written for the model: what the skill does, then the
// phrases that trigger it. The trigger half is noise on a card, so it is dropped.
const TRIGGER_SENTENCE_RE = /^(use (it )?when)/i;

function _summary(description) {
  const text = String(description || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'No description in the SKILL.md header.';
  const kept = text.split(/(?<=\.)\s+/).filter(x => !TRIGGER_SENTENCE_RE.test(x.trim()));
  let out = (kept.length ? kept : [text]).slice(0, 2).join(' ');
  if (out.length > 220) out = out.slice(0, 219).replace(/\s+\S*$/, '') + '...';
  return out;
}

function _counter(kind, items, label) {
  if (!items.length) return '';
  return `<button type="button" class="sett-skill-counter" data-counter="${kind}" aria-expanded="false">
      <strong>${items.length}</strong> ${_esc(label)}
    </button>`;
}

function _counterList(kind, items) {
  if (!items.length) return '';
  return `<ul class="sett-skill-counter-list" data-counter-list="${kind}" hidden>${
    items.map(i => `<li>${_esc(i)}</li>`).join('')
  }</ul>`;
}

function _renderSkillCard(skill) {
  const kind = SKILL_KIND[skill.name] || 'skill';
  const output = SKILL_OUTPUT[skill.name];
  const phases = skill.phases || [];
  const agents = skill.agents || [];
  const commands = skill.commands || [];
  const children = skill.children || [];

  const counters = [
    _counter('phases', phases, phases.length === 1 ? 'phase' : 'phases'),
    _counter('agents', agents, agents.length === 1 ? 'agent' : 'agents'),
    _counter('commands', commands, commands.length === 1 ? 'command' : 'commands'),
    _counter('children', children.map(c => c.name), 'sub-skills'),
  ].filter(Boolean).join('');

  const lists = [
    _counterList('phases', phases.map(p => 'Phase ' + p)),
    _counterList('agents', agents),
    _counterList('commands', commands.map(c => (c.includes('/') ? c : 'scripts/' + c))),
    _counterList('children', children.map(c => c.name)),
  ].filter(Boolean).join('');

  return `
    <article class="ds-card sett-skill-card" data-skill="${_esc(skill.name)}">
      <div class="sett-skill-head">
        <code class="sett-skill-trigger">/${_esc(skill.name)}</code>
        <span class="ds-badge ds-badge--sm ds-badge--gray sett-skill-kind">${_esc(kind)}</span>
      </div>
      <p class="sett-skill-desc">${_esc(_summary(skill.description))}</p>
      ${counters ? `<div class="sett-skill-counters">${counters}</div>${lists}` : ''}
      ${output ? `<p class="sett-skill-output"><span aria-hidden="true">-&gt;</span> ${_esc(output)}</p>` : ''}
      <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm sett-skill-open" data-skill-open="${_esc(skill.name)}">
        View the instructions
      </button>
    </article>`;
}

function _group(label, hint, count, cardsHtml) {
  return `<section class="sett-skill-group">
      <h3 class="sett-skill-group-heading">
        <span class="sett-skill-group-name">${_esc(label)}</span>
        <span class="sett-skill-group-count">${count}</span>
        ${hint ? `<span class="sett-skill-group-hint">${_esc(hint)}</span>` : ''}
      </h3>
      <div class="sett-skill-grid">${cardsHtml}</div>
    </section>`;
}

function _renderContent(skills) {
  const byName = new Map(skills.map(s => [s.name, s]));
  const grouped = new Set(GROUPS.flatMap(g => g.skills));
  const inne = skills.filter(s => !grouped.has(s.name));

  let html = '';
  for (const group of GROUPS) {
    const visible = group.skills.map(n => byName.get(n)).filter(Boolean);
    if (!visible.length) continue;
    html += _group(group.label, group.hint, visible.length, visible.map(_renderSkillCard).join(''));
  }
  if (inne.length) {
    html += _group('Other', 'skills outside the known groups', inne.length, inne.map(_renderSkillCard).join(''));
  }
  return html;
}

// ── Document loaders ──────────────────────────────────────────────────────────

async function _fetchDoc(query) {
  const res = await fetch('/api/skills/read?' + query);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not load the document.');
  return data;
}

function _openSkill(skill) {
  // A skill with sub-skills (gitnexus) puts them in the same switcher: its own
  // documents first, then one tab per sub-skill loading that sub-skill's SKILL.md.
  // The tab id carries the skill to read, so one loader serves both cases.
  const own = (skill.docs || []).map(d => ({ file: skill.name + '::' + d.file, label: d.label }));
  const children = (skill.children || []).map(c => ({
    file: c.name + '::SKILL.md',
    label: c.name.replace(new RegExp('^' + skill.name + '-'), ''),
  }));
  const files = [...own, ...children];
  openDocModal({
    title: skill.group ? skill.name : '/' + skill.name,
    files,
    load: (tab) => {
      const [name, file] = String(tab || files[0].file).split('::');
      return _fetchDoc(`skill=${encodeURIComponent(name)}&file=${encodeURIComponent(file || 'SKILL.md')}`);
    },
  });
}

// ── Public export ─────────────────────────────────────────────────────────────

export async function renderSkilleSection() {
  const slot = document.getElementById('settings-skille-section');
  if (!slot) return;

  // Same rule as the Agents slot: never blank a slot that already holds a
  // skeleton or the previous cards.

  try {
    const res = await fetch(`/api/skills/list?t=${Date.now()}`);
    if (!res.ok) throw new Error(`/api/skills/list: ${res.status}`);
    const data = await res.json();
    const skills = data.skills ?? [];

    const inner = document.createElement('div');
    inner.className = 'sett-skille-inner';
    inner.innerHTML = _renderContent(skills);
    slot.innerHTML = '';
    slot.appendChild(inner);

    inner.addEventListener('click', (e) => {
      const counter = e.target.closest('[data-counter]');
      if (counter) {
        const card = counter.closest('.sett-skill-card');
        const list = card?.querySelector(`[data-counter-list="${counter.dataset.counter}"]`);
        if (!list) return;
        const open = list.hidden;
        for (const l of card.querySelectorAll('[data-counter-list]')) l.hidden = true;
        for (const c of card.querySelectorAll('[data-counter]')) c.setAttribute('aria-expanded', 'false');
        list.hidden = !open;
        counter.setAttribute('aria-expanded', String(open));
        return;
      }
      const openSkill = e.target.closest('[data-skill-open]');
      if (openSkill) {
        const skill = skills.find(s => s.name === openSkill.dataset.skillOpen);
        if (skill) _openSkill(skill);
        return;
      }
    });
  } catch (err) {
    slot.innerHTML = `<div class="ds-callout ds-callout--danger"><div>Could not load the skill list: ${_esc(err.message)}</div></div>`;
  }
}
