// ── Mission Deck — js/settings-uzytkownicy.js ─────────────────────────────
// Renders the "Users" tab in #view-settings: the team directory as a card
// grid with a search box, an add/edit form and a photo upload.
// Exports: renderUzytkownicySection()
// Called from js/settings.js renderSettingsView() — fire-and-forget (not awaited).
//
// The data is the same `team/team-members.json` plus `team/avatars/` that
// `node scripts/build-team-directory.js` writes and js/team-directory.js reads.
// Saving here therefore changes exactly the files the rest of the app resolves
// avatars from - there is no second copy of the roster.

import { escHtml, normalizeSearch, initials } from './utils.js';
import { showToast } from './toast.js';
import { openDsModal, closeDsModal } from './ds-modal.js';
import { loadTeamDirectory, AVATARS_BASE } from './team-directory.js';

const AVATAR_MAX_BYTES = 3 * 1024 * 1024;
const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp';
/** Same glyph the Keys tab uses for its copy chips. */
const UZY_COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

/** Last fetched roster. Re-fetched after every write, never patched in place. */
let _members = [];
let _teams = [];
let _query = '';

// ── Data ──────────────────────────────────────────────────────────────────────

async function _fetchMembers() {
  try {
    const r = await fetch('/api/team/members', { cache: 'no-store' });
    if (!r.ok) return false;
    const data = await r.json();
    _members = Array.isArray(data.members) ? data.members : [];
    _teams = Array.isArray(data.teams) ? data.teams : [];
    return true;
  } catch (_e) { return false; }
}

/**
 * POST helper. Returns the parsed payload plus `ok`, never throws.
 * @param {string} url @param {object} payload
 * @returns {Promise<{ok: boolean, data: object}>}
 */
async function _post(url, payload) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok && data.status === 'ok', data };
  } catch (_e) {
    return { ok: false, data: { message: 'The server is not responding.' } };
  }
}

// ── View helpers ──────────────────────────────────────────────────────────────

function _fullName(m) {
  return [m.first_name, m.last_name].filter(Boolean).join(' ').trim();
}

/** The rows the search box leaves visible. Diacritic- and case-insensitive. */
function _filtered() {
  const q = normalizeSearch(_query).trim();
  if (!q) return _members;
  return _members.filter(m => {
    const haystack = normalizeSearch([_fullName(m), m.role, m.team, m.email].filter(Boolean).join(' '));
    return q.split(/\s+/).every(part => haystack.includes(part));
  });
}

function _avatarHtml(m) {
  const name = _fullName(m) || 'no name';
  if (m.avatar) {
    return `<img class="uzy-card__avatar" src="${escHtml(AVATARS_BASE + encodeURIComponent(m.avatar))}" alt="" aria-hidden="true" loading="lazy">`;
  }
  return `<span class="uzy-card__avatar uzy-card__avatar--initials" aria-hidden="true">${escHtml(initials(name))}</span>`;
}

/**
 * One e-mail row: the address on its own line under the team badge, so it gets
 * the full card width and is never truncated, plus a copy button.
 * @param {string} email @returns {string}
 */
function _mailRowHtml(email) {
  if (!email) return '';
  return `<div class="uzy-card__mail-row">
      <a class="uzy-card__mail" href="mailto:${escHtml(email)}">${escHtml(email)}</a>
      <button type="button" class="sett-token-copy-btn" data-uzy-copy="${escHtml(email)}" aria-label="Copy address ${escHtml(email)}">${UZY_COPY_ICON}</button>
    </div>`;
}

function _cardHtml(m) {
  const name = _fullName(m) || 'No name';
  return `<div class="ds-card uzy-card" data-uzy-id="${escHtml(m.id)}">
    <div class="uzy-card__top">
      ${_avatarHtml(m)}
      <div class="uzy-card__body">
        <span class="uzy-card__name">${escHtml(name)}</span>
        <span class="uzy-card__role">${escHtml(m.role || 'no role')}</span>
        ${m.team ? `<div class="uzy-card__meta"><span class="ds-badge ds-badge--gray">${escHtml(m.team)}</span></div>` : ''}
      </div>
      <div class="uzy-card__actions">
        <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-uzy-edit="${escHtml(m.id)}">Edit</button>
      </div>
    </div>
    ${_mailRowHtml(m.email)}
  </div>`;
}

// ── Render ────────────────────────────────────────────────────────────────────

function _paintGrid() {
  const grid = document.getElementById('settings-uzytkownicy-grid');
  const countEl = document.getElementById('settings-uzytkownicy-count');
  if (!grid) return;

  const rows = _filtered();
  if (countEl) {
    countEl.textContent = _query
      ? `${rows.length} z ${_members.length}`
      : `${_members.length} ${_members.length === 1 ? 'person' : 'people'}`;
  }

  if (_members.length === 0) {
    grid.innerHTML = '<div class="ds-callout ds-callout--info"><div>The directory is empty. Add the first person with the <strong>Add person</strong> button or import a list with <code>node scripts/build-team-directory.js</code>.</div></div>';
    return;
  }
  if (rows.length === 0) {
    grid.innerHTML = `<div class="ds-callout ds-callout--info"><div>Nobody found for <strong>${escHtml(_query)}</strong>.</div></div>`;
    return;
  }
  grid.innerHTML = rows.map(_cardHtml).join('');
  grid.querySelectorAll('[data-uzy-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const member = _members.find(m => m.id === btn.dataset.uzyEdit);
      if (member) _openMemberModal(member);
    });
  });
  grid.querySelectorAll('[data-uzy-copy]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      navigator.clipboard.writeText(btn.dataset.uzyCopy).then(() => {
        btn.classList.add('sett-token-copy-btn--ok');
        setTimeout(() => btn.classList.remove('sett-token-copy-btn--ok'), 1200);
        showToast('info', 'Email address copied');
      }).catch(() => showToast('warning', 'Could not copy'));
    });
  });
}

async function _reload() {
  await _fetchMembers();
  // The shared resolver caches the roster too; refresh it so the top bar and
  // every other consumer see the same edit without a page reload.
  loadTeamDirectory(true).catch(() => { /* empty directory is fine */ });
  _paintGrid();
}

// ── Add / edit modal ──────────────────────────────────────────────────────────

/**
 * One form for both cases: a member object edits, `null` creates.
 * @param {object|null} member
 */
function _openMemberModal(member) {
  const editing = Boolean(member && member.id);
  const m = member || { id: '', first_name: '', last_name: '', role: '', team: '', email: '', avatar: '' };
  const listId = 'uzy-team-options';

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.innerHTML = `
    <div class="ds-modal ds-modal--md">
      <div class="ds-modal-header">
        <span class="ds-modal-title">${editing ? 'Edit person' : 'New person'}</span>
        <button type="button" class="ds-modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body">
        <div class="uzy-form-photo">
          <span class="uzy-form-photo__preview" id="uzy-photo-preview">${_avatarHtml(m)}</span>
          <div class="uzy-form-photo__actions">
            <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="uzy-photo-btn"${editing ? '' : ' disabled'}>Upload photo</button>
            <input type="file" id="uzy-photo-input" accept="${ACCEPTED_TYPES}" hidden>
            <p class="sett-field-hint">${editing
              ? 'PNG, JPG or WEBP, up to 3 MB. The server names the file.'
              : 'Save the person first — you can upload the photo once the entry exists.'}</p>
          </div>
        </div>
        <div class="sett-field-row sett-field-row--stacked">
          <label for="uzy-first">First name</label>
          <input type="text" class="ds-input" id="uzy-first" autocomplete="off" value="${escHtml(m.first_name)}">
        </div>
        <div class="sett-field-row sett-field-row--stacked">
          <label for="uzy-last">Last name</label>
          <input type="text" class="ds-input" id="uzy-last" autocomplete="off" value="${escHtml(m.last_name)}">
        </div>
        <div class="sett-field-row sett-field-row--stacked">
          <label for="uzy-role">Role</label>
          <input type="text" class="ds-input" id="uzy-role" autocomplete="off" value="${escHtml(m.role)}">
        </div>
        <div class="sett-field-row sett-field-row--stacked">
          <label for="uzy-team">Team</label>
          <input type="text" class="ds-input" id="uzy-team" autocomplete="off" list="${listId}" value="${escHtml(m.team)}">
          <datalist id="${listId}">${_teams.map(t => `<option value="${escHtml(t)}"></option>`).join('')}</datalist>
        </div>
        <div class="sett-field-row sett-field-row--stacked">
          <label for="uzy-email">E-mail</label>
          <input type="email" class="ds-input" id="uzy-email" autocomplete="off" value="${escHtml(m.email)}">
        </div>
      </div>
      <div class="ds-modal-footer">
        ${editing ? '<button type="button" class="ds-btn ds-btn--danger ds-btn--sm" data-uzy-delete>Remove person</button>' : ''}
        <span class="uzy-modal-spacer"></span>
        <button type="button" class="ds-btn ds-btn--secondary" data-uzy-cancel>Cancel</button>
        <button type="button" class="ds-btn ds-btn--primary" data-uzy-save>Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  openDsModal(overlay);

  const close = () => { closeDsModal(overlay); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector('.ds-modal-close').addEventListener('click', close);
  overlay.querySelector('[data-uzy-cancel]').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Photo upload. Only for an existing record: the file name is derived from the
  // person on the server, so there has to BE a person first.
  if (editing) {
    const input = overlay.querySelector('#uzy-photo-input');
    overlay.querySelector('#uzy-photo-btn').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > AVATAR_MAX_BYTES) {
        showToast('warning', 'Photo too large', 'The maximum size is 3 MB.');
        input.value = '';
        return;
      }
      const btn = overlay.querySelector('#uzy-photo-btn');
      btn.disabled = true;
      btn.textContent = 'Uploading...';
      const base64 = await _fileToBase64(file);
      const { ok, data } = await _post('/api/team/avatar', { id: m.id, data: base64 });
      btn.disabled = false;
      btn.textContent = 'Upload photo';
      input.value = '';
      if (!ok) {
        showToast('error', 'Could not upload the photo', data.message || 'Try again.');
        return;
      }
      // Cache-busted: the file name is stable per person, so the browser would
      // otherwise keep showing the previous photo.
      const preview = overlay.querySelector('#uzy-photo-preview');
      preview.innerHTML = `<img class="uzy-card__avatar" src="${escHtml(AVATARS_BASE + encodeURIComponent(data.avatar))}?t=${Date.now()}" alt="" aria-hidden="true">`;
      showToast('success', 'Photo saved', _fullName(m) || 'Entry updated.');
      _reload();
    });
  }

  overlay.querySelector('[data-uzy-save]').addEventListener('click', async function () {
    const payload = {
      id: m.id || undefined,
      first_name: overlay.querySelector('#uzy-first').value.trim(),
      last_name: overlay.querySelector('#uzy-last').value.trim(),
      role: overlay.querySelector('#uzy-role').value.trim(),
      team: overlay.querySelector('#uzy-team').value.trim(),
      email: overlay.querySelector('#uzy-email').value.trim(),
    };
    if (!payload.first_name && !payload.last_name) {
      showToast('warning', 'Complete the form', 'Enter a first or last name.');
      return;
    }
    this.disabled = true;
    this.textContent = 'Saving...';
    const { ok, data } = await _post('/api/team/member', payload);
    this.disabled = false;
    this.textContent = 'Save';
    if (!ok) {
      showToast('error', 'Could not save', data.message || 'Try again.');
      return;
    }
    await _reload();
    if (editing) {
      showToast('success', 'Saved', 'The changes reach the team with the next sync.');
      close();
    } else {
      // Straight into the same record so the photo can be added right away.
      close();
      const created = _members.find(x => x.id === data.member.id);
      if (created) _openMemberModal(created);
    }
  });

  const delBtn = overlay.querySelector('[data-uzy-delete]');
  if (delBtn) {
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Remove ${_fullName(m) || 'this person'} from the directory? The photo will be deleted too.`)) return;
      const { ok, data } = await _post('/api/team/member/delete', { id: m.id });
      if (!ok) {
        showToast('error', 'Could not remove', data.message || 'Try again.');
        return;
      }
      close();
      await _reload();
      showToast('success', 'Removed', 'The person is gone from the team directory.');
    });
  }
}

/** Reads a File into a bare base64 string (no data: prefix). */
function _fileToBase64(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Paint the Users tab. Idempotent: the search box and the add button are
 * wired once, the grid is repainted on every call.
 * @returns {Promise<void>}
 */
export async function renderUzytkownicySection() {
  const host = document.getElementById('settings-uzytkownicy-section');
  if (!host) return;

  const search = document.getElementById('settings-uzytkownicy-search');
  if (search && !search.dataset.wired) {
    search.dataset.wired = '1';
    search.addEventListener('input', () => { _query = search.value; _paintGrid(); });
  }
  const addBtn = document.getElementById('settings-uzytkownicy-add');
  if (addBtn && !addBtn.dataset.wired) {
    addBtn.dataset.wired = '1';
    addBtn.addEventListener('click', () => _openMemberModal(null));
  }

  await _reload();
}
