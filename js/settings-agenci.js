// ── Mission Deck — js/settings-agenci.js ──────────────────────────────────
// Renders the "Agents" tab in #view-settings: one card per agent, grouped by the
// pipeline they belong to, each with its portrait, description, current model,
// a model picker and a link that opens the agent brief in a modal.
// Exports: renderAgenciSection()
// Called from js/settings.js renderSettingsView() — fire-and-forget (not awaited).

import { showToast } from './toast.js';
import { openDocModal } from './doc-modal.js';

// ── Allowlist ─────────────────────────────────────────────────────────────────
const MODEL_ALLOWLIST = [
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-6',
  'claude-sonnet-5-5',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-fable-5-1',
  'claude-haiku-5-5',
  'claude-haiku-4-5',
];

const MODEL_LABELS = {
  'claude-opus-5-5':   'Opus 5.5',
  'claude-opus-5':     'Opus 5',
  'claude-opus-4-8':   'Opus 4.8',
  'claude-opus-4-6':   'Opus 4.6',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-sonnet-5':   'Sonnet 5',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-fable-5-1':  'Fable 5.1',
  'claude-haiku-5-5':  'Haiku 5.5',
  'claude-haiku-4-5':  'Haiku 4.5',
};

// ── Display descriptions (short, human-friendly) ─────────────────────────────
const AGENT_DESCRIPTIONS = {
  'idea-planner': 'Plan architect. Writes a structured implementation plan into plans/ from the repo map and the interview.',
  'idea-implementer': 'Fast path: delivers a small plan end-to-end (index.html, js/, styles.css, server.js, tests/) in one agent.',
  'backend-implementer': 'Split path, backend slice: server.js, scripts/ and API tests. Hands over the endpoint contract to the frontend.',
  'frontend-implementer': 'Split path, frontend slice: index.html, js/, styles.css per the plan and the backend contract.',
  'qa-automation-implementer': 'Split path, test slice: tests/test_*.mjs and tests/test_api_*.js. Never touches production code.',
  'engineering-lead-reviewer': 'Lead review after the split path: layer consistency (URL, JSON shape, view registration). Only small glue fixes.',
  'playwright-specialist': 'Visual UI verification in a real browser; light/dark screenshots.',
  'ac-verifier': 'Blind acceptance-criteria verifier. Reads the plan + diff and grades PASS/FAIL per criterion.',
  'cockpit-guardian': 'Mission Deck conventions guardian. Checks the rules the linter does not know (DS, sidebar, sync).',
  'code-quality-auditor': 'Code quality review of a diff. Looks for simplifications, duplication and performance problems.',
  'security-auditor': 'Security review of a diff: token leaks, path traversal, injection, XSS.',
  'qa-automation-auditor': 'Review of test coverage and test quality. Mode: the whole repo or just the diff.',
  'bug-auditor': 'Post-implementation bug scanner. Categorizes FUNC/REQ/UX, computes a score, decides SHIP/ITERATE.',
  'commit-message-writer': 'Analyzes the diff and proposes a Conventional Commits message.',
  'mini-planner': 'Plans a change in a mini app (Vite + React + TypeScript) from the project context file.',
  'mini-implementer': 'Delivers a mini plan end-to-end in the project source folder; the gates are the project build and lint.',
  'mini-verifier': 'Blind verification of mini acceptance criteria on disk plus a mobile-view protection check.',
  'mini-bug-auditor': 'Bug scan after a mini implementation. Reviews the render at three breakpoints; SHIP/ITERATE.',
  'proto-ds-guardian': 'Design System guardian for prototypes. Linter plus a semantic comparison with the Figma catalog.',
  'meeting-summarizer': 'Summarizes a meeting transcript: picks a template from templates/meeting-notes and fills it in.',
  'researcher': 'Gathers product evidence from documents, data and code; returns an evidence table and a list of opportunities.',
  'reviewer': 'Adversarial reviewer of research material: evidence quality, quote accuracy, coverage gaps.',
};

// ── Avatars ───────────────────────────────────────────────────────────────────
// Crew callsigns, the same casting as the skill banners. Files live in
// assets/agents/ (committed with the app, not in the data repo). One face may
// carry several roles when an agent plays the same part in another pipeline.
// A missing file is not an error: the <img> error handler swaps in the initial
// of the callsign (or of the agent name when there is no entry).
const AGENT_AVATARS = {
  'idea-planner':              { img: '/assets/agents/overwatch.svg', character: 'Overwatch' },
  'idea-implementer':          { img: '/assets/agents/cipher.svg', character: 'Cipher' },
  'backend-implementer':       { img: '/assets/agents/vex.svg', character: 'Vex' },
  'frontend-implementer':      { img: '/assets/agents/mira.svg', character: 'Mira' },
  'qa-automation-implementer': { img: '/assets/agents/watch.svg', character: 'Watch' },
  'engineering-lead-reviewer': { img: '/assets/agents/nyx.svg', character: 'Nyx' },
  'cockpit-guardian':          { img: '/assets/agents/quiet.svg', character: 'Quiet' },
  'ac-verifier':               { img: '/assets/agents/ledger.svg', character: 'Ledger' },
  'playwright-specialist':     { img: '/assets/agents/proxy.svg', character: 'Proxy' },
  'qa-automation-auditor':     { img: '/assets/agents/watch.svg', character: 'Watch' },
  'bug-auditor':               { img: '/assets/agents/hex.svg', character: 'Hex' },
  'commit-message-writer':     { img: '/assets/agents/relay.svg', character: 'Relay' },
  'code-quality-auditor':      { img: '/assets/agents/canon.svg', character: 'Canon' },
  'security-auditor':          { img: '/assets/agents/forge.svg', character: 'Forge' },
  // Mini pipeline - the same crew, a different app.
  'mini-planner':              { img: '/assets/agents/overwatch.svg', character: 'Overwatch' },
  'mini-implementer':          { img: '/assets/agents/cipher.svg', character: 'Cipher' },
  'mini-verifier':             { img: '/assets/agents/ledger.svg', character: 'Ledger' },
  'mini-bug-auditor':          { img: '/assets/agents/hex.svg', character: 'Hex' },
  // Prototypes, meetings, research.
  'proto-ds-guardian':         { img: '/assets/agents/quiet.svg', character: 'Quiet' },
  'meeting-summarizer':        { img: '/assets/agents/canon.svg', character: 'Canon' },
  'researcher':                { img: '/assets/agents/vex.svg', character: 'Vex' },
  'reviewer':                  { img: '/assets/agents/nyx.svg', character: 'Nyx' },
};

// ── Where each agent runs ─────────────────────────────────────────────────────
// The skill and the phase that spawns the agent, rendered as a chip on the card
// so the roster reads as a pipeline and not as an alphabetical list. `when`
// marks a conditional spawn; the chip then carries the tertiary variant.
const AGENT_PHASE = {
  'idea-planner':              { skill: 'new-idea', phase: '4' },
  'idea-implementer':          { skill: 'new-idea', phase: '6', note: 'fast path' },
  'backend-implementer':       { skill: 'new-idea', phase: '6a', note: 'split path' },
  'frontend-implementer':      { skill: 'new-idea', phase: '6b', note: 'split path' },
  'qa-automation-implementer': { skill: 'new-idea', phase: '6c', note: 'split path', when: true },
  'engineering-lead-reviewer': { skill: 'new-idea', phase: '6d', note: 'split path', when: true },
  'cockpit-guardian':          { skill: 'new-idea', phase: '6e', when: true },
  'ac-verifier':               { skill: 'new-idea', phase: '6f' },
  'playwright-specialist':     { skill: 'new-idea', phase: '6g', when: true },
  'bug-auditor':               { skill: 'new-idea', phase: '6.7', when: true },
  'code-quality-auditor':      { skill: 'pre-ship-audit', phase: '2' },
  'security-auditor':          { skill: 'pre-ship-audit', phase: '2' },
  'qa-automation-auditor':     { skill: 'qa-audit', phase: '2' },
  'commit-message-writer':     { skill: 'commit-message', phase: '' },
  'mini-planner':              { skill: 'mini', phase: '4' },
  'mini-implementer':          { skill: 'mini', phase: '6' },
  'mini-verifier':             { skill: 'mini', phase: '6f' },
  'mini-bug-auditor':          { skill: 'mini', phase: '6.7', when: true },
  'proto-ds-guardian':         { skill: 'prototype', phase: '6e' },
  'meeting-summarizer':        { skill: 'summarize-meeting', phase: '' },
  'researcher':                { skill: 'manual', phase: '' },
  'reviewer':                  { skill: 'manual', phase: '' },
};

// ── Agent grouping ────────────────────────────────────────────────────────────
// Mirrors .claude/agents/ — an agent missing from every group still renders,
// under an "Other" group appended by _renderContent().
const GROUPS = [
  {
    label: 'Planning',
    hint: '/new-idea -> plan for review',
    agents: ['idea-planner'],
  },
  {
    label: 'Implementation',
    hint: '/new-idea -> code on a branch',
    agents: ['idea-implementer', 'backend-implementer', 'frontend-implementer', 'qa-automation-implementer', 'engineering-lead-reviewer', 'playwright-specialist'],
  },
  {
    label: 'Review',
    hint: '/new-idea + /pre-ship-audit -> verdict',
    agents: ['ac-verifier', 'cockpit-guardian', 'code-quality-auditor', 'security-auditor'],
  },
  {
    label: 'QA',
    hint: '/qa-audit + bug scan -> report',
    agents: ['qa-automation-auditor', 'bug-auditor'],
  },
  {
    label: 'Mini',
    hint: '/mini -> Vite + React apps',
    agents: ['mini-planner', 'mini-implementer', 'mini-verifier', 'mini-bug-auditor'],
  },
  {
    label: 'Prototypes',
    hint: '/prototype -> mockups in the data repo',
    agents: ['proto-ds-guardian'],
  },
  {
    label: 'Documents and research',
    hint: '/summarize-meeting + research -> documents',
    agents: ['meeting-summarizer', 'researcher', 'reviewer'],
  },
  {
    label: 'Other',
    hint: '',
    agents: ['commit-message-writer'],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function _buildSelectOptions(currentModel) {
  const inAllowlist = MODEL_ALLOWLIST.includes(currentModel);
  let html = '';
  // If current model is NOT in the allowlist, show a neutral placeholder so
  // the select does not silently misrepresent state (e.g. bare "haiku").
  if (!inAllowlist) {
    html += `<option value="" disabled selected>${_esc(currentModel)} (default)</option>`;
  }
  for (const m of MODEL_ALLOWLIST) {
    const sel = inAllowlist && m === currentModel ? ' selected' : '';
    html += `<option value="${m}"${sel}>${_esc(MODEL_LABELS[m])}</option>`;
  }
  return html;
}

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _truncate(s, maxLen) {
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '...' : s;
}

function _renderPhase(name) {
  const p = AGENT_PHASE[name];
  if (!p) return '';
  const variant = p.when ? 'ds-badge--gray' : 'ds-badge--brand';
  const label = p.phase ? `phase ${_esc(p.phase)}` : 'on demand';
  const title = `/${_esc(p.skill)}${p.phase ? ' phase ' + _esc(p.phase) : ''}${p.note ? ' - ' + _esc(p.note) : ''}${p.when ? ' (conditional)' : ''}`;
  return `<span class="sett-agent-phase" title="${title}">
      <span class="ds-badge ds-badge--sm ${variant}">${label}</span>
      <span class="sett-agent-phase-skill">/${_esc(p.skill)}</span>
    </span>`;
}

function _renderAvatar(name) {
  const av = AGENT_AVATARS[name];
  const initial = _esc(((av && av.character) || name || '?').charAt(0).toUpperCase());
  if (!av) {
    return `<span class="sett-agent-avatar sett-agent-avatar--initial" aria-hidden="true">${initial}</span>`;
  }
  return `<img class="sett-agent-avatar" src="${_esc(av.img)}" alt="" loading="lazy" data-avatar-initial="${initial}">`;
}

// Replaces a broken avatar <img> with the initial-letter fallback. Attached in
// the capture phase because "error" does not bubble.
function _onAvatarError(e) {
  const img = e.target;
  if (!img || img.tagName !== 'IMG' || !img.classList.contains('sett-agent-avatar')) return;
  const span = document.createElement('span');
  span.className = 'sett-agent-avatar sett-agent-avatar--initial';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = img.dataset.avatarInitial || '?';
  img.replaceWith(span);
}

function _renderCard(name, allAgents, prefs) {
  const a = allAgents.find(x => x.name === name);
  if (!a) return '';
  const av = AGENT_AVATARS[name];
  const overridden = Object.prototype.hasOwnProperty.call(prefs.models || {}, name);
  const effectiveModel = overridden ? prefs.models[name] : a.model;
  const desc = AGENT_DESCRIPTIONS[name] || _truncate(a.description, 200);

  return `
    <article class="ds-card sett-agent-card" data-agent="${_esc(name)}">
      <div class="sett-agent-head">
        ${_renderAvatar(name)}
        <div class="sett-agent-id">
          <strong class="sett-agent-name">${_esc(name)}</strong>
          ${av ? `<span class="sett-agent-character">${_esc(av.character)}</span>` : ''}
        </div>
        ${_renderPhase(name)}
      </div>
      <p class="sett-agent-desc" title="${_esc(a.description ?? '')}">${_esc(desc)}</p>
      <div class="sett-agent-model">
        <span class="ds-badge ds-badge--gray" data-badge-for="${_esc(name)}">${_esc(effectiveModel)}</span>
        <span class="sett-agent-overridden"${overridden ? '' : ' hidden'}>overridden</span>
      </div>
      ${a.modelFallbacks ? `<div class="sett-agent-fallbacks">${_esc(a.modelFallbacks)}</div>` : ''}
      <label class="sett-agent-field">
        <span class="sett-agent-field-label">Change model</span>
        <select class="ds-input" data-agent-select="${_esc(name)}" data-current="${_esc(effectiveModel)}" aria-label="Agent model ${_esc(name)}">
          ${_buildSelectOptions(effectiveModel)}
        </select>
      </label>
      <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm sett-agent-brief-btn" data-agent-brief="${_esc(name)}">
        View the agent brief
      </button>
    </article>`;
}

function _renderContent(agents, prefs) {
  const grouped = new Set(GROUPS.flatMap(g => g.agents));
  const inne = agents.map(a => a.name).filter(n => !grouped.has(n));

  const allGroups = [
    ...GROUPS,
    ...(inne.length ? [{ label: 'Other', hint: 'agents outside the known groups', agents: inne }] : []),
  ];

  const hasOverrides = prefs.models && Object.keys(prefs.models).length > 0;

  let html = '';
  if (hasOverrides) {
    html += `<div class="sett-agent-reset-bar">
      <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="sett-agenci-reset-btn">Restore defaults</button>
      <span class="sett-agent-reset-hint">Removes every override and restores the models from the repository.</span>
    </div>`;
  }
  for (const group of allGroups) {
    const visible = group.agents.filter(name => agents.some(a => a.name === name));
    if (!visible.length) continue;
    html += `<section class="sett-agent-group">
      <h3 class="sett-agent-group-heading">
        <span class="sett-agent-group-name">${_esc(group.label)}</span>
        ${group.hint ? `<span class="sett-agent-group-hint">${_esc(group.hint)}</span>` : ''}
        <span class="sett-agent-group-count">${visible.length}</span>
      </h3>
      <div class="sett-agent-grid">${visible.map(n => _renderCard(n, agents, prefs)).join('')}</div>
    </section>`;
  }
  return html;
}

// ── Agent brief modal ─────────────────────────────────────────────────────────

function _openBrief(name) {
  openDocModal({
    title: name,
    files: [],
    load: async () => {
      const res = await fetch(`/api/agents/read?name=${encodeURIComponent(name)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load the agent file.');
      return data;
    },
  });
}

// ── POST handler (shared, delegated from a container) ────────────────────────

async function _handleSelectChange(e) {
  const sel = e.target.closest('[data-agent-select]');
  if (!sel) return;

  const agentName = sel.dataset.agentSelect;
  const newModel = sel.value;
  if (!newModel) return; // placeholder selected — no-op

  const prevModel = sel.dataset.current;
  // For out-of-allowlist models the placeholder option has value="" — revert to that.
  const prevSelectValue = MODEL_ALLOWLIST.includes(prevModel) ? prevModel : '';
  sel.disabled = true;
  try {
    const res = await fetch('/api/agent-model-preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: agentName, model: newModel }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast('danger', 'Saving the model failed', data.error ?? 'Unknown server error');
      sel.value = prevSelectValue;
      // Dispatch change so ds-select syncs its visible trigger label.
      sel.dispatchEvent(new Event('change'));
      return;
    }
    // Success: update the badge in place + track the new current value
    const card = sel.closest('.sett-agent-card');
    const badge = card?.querySelector(`[data-badge-for="${CSS.escape(agentName)}"]`);
    if (badge) badge.textContent = newModel;
    const marker = card?.querySelector('.sett-agent-overridden');
    if (marker) marker.hidden = false;
    sel.dataset.current = newModel;
    showToast('success', 'Model saved', `${agentName} -> ${MODEL_LABELS[newModel] ?? newModel}`);
  } catch (err) {
    showToast('danger', 'Saving the model failed', err.message);
    sel.value = prevSelectValue;
    // Dispatch change so ds-select syncs its visible trigger label.
    sel.dispatchEvent(new Event('change'));
  } finally {
    sel.disabled = false;
  }
}

function _handleClick(e) {
  const briefBtn = e.target.closest('[data-agent-brief]');
  if (briefBtn) {
    _openBrief(briefBtn.dataset.agentBrief);
  }
}

// ── Public export ─────────────────────────────────────────────────────────────

export async function renderAgenciSection() {
  const slot = document.getElementById('settings-agenci-section');
  if (!slot) return;

  // No loading sentence here: the slot already holds a skeleton (first
  // paint, from index.html) or the previous roster (a repaint). Either is a
  // better placeholder than a line of text at a different height.

  try {
    const t = Date.now();
    const [agentsRes, prefsRes] = await Promise.all([
      fetch(`/api/agents/list?t=${t}`),
      fetch(`/api/agent-model-preferences?t=${t}`),
    ]);

    if (!agentsRes.ok) throw new Error(`/api/agents/list: ${agentsRes.status}`);
    const agentsData = await agentsRes.json();
    const agents = agentsData.agents ?? [];

    // Prefs endpoint is best-effort (missing prefs file returns empty object gracefully)
    const prefs = prefsRes.ok ? await prefsRes.json() : { models: {} };

    // Replace slot contents with a single inner container.
    // The listeners are attached to this inner element, so replacing innerHTML
    // on re-render creates a fresh listener-free container each time.
    const inner = document.createElement('div');
    inner.className = 'sett-agenci-inner';
    inner.innerHTML = _renderContent(agents, prefs);
    slot.innerHTML = '';
    slot.appendChild(inner);

    inner.addEventListener('change', _handleSelectChange);
    inner.addEventListener('click', _handleClick);
    inner.addEventListener('error', _onAvatarError, true);

    const resetBtn = inner.querySelector('#sett-agenci-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        resetBtn.disabled = true;
        try {
          const res = await fetch('/api/agent-model-preferences', { method: 'DELETE' });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showToast('danger', 'Reset failed', data.error ?? 'Unknown error');
            return;
          }
          showToast('success', 'Defaults restored', 'Every override removed.');
          await renderAgenciSection();
        } catch (err) {
          showToast('danger', 'Reset failed', err.message);
        } finally {
          resetBtn.disabled = false;
        }
      });
    }
  } catch (err) {
    slot.innerHTML = `<div class="ds-callout ds-callout--danger"><div>Could not load the agent list: ${_esc(err.message)}</div></div>`;
  }
}
