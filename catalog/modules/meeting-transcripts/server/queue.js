'use strict';
// modules/meeting-transcripts/server/queue.js
// The persistent job queue: data/modules/meeting-transcripts/queue.json.
// One item per recording, whatever brought it (an upload or the OneDrive
// scan). Statuses:
//   queued      waiting for the worker
//   processing  the worker runs it now (reset to queued at boot - a crash
//               or a restart mid-job must not strand an item)
//   done        transcript written (resultName); `published` once it went
//               to the Meeting Archive
//   failed      last attempt failed; the next scheduled cycle retries it
//               while attempts < MAX_ATTEMPTS, "Retry" any time
// The recording itself waits in inbox/<item.input> and is removed once the
// item is done or removed. Writes are synchronous tmp + rename, so the file
// is always whole.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HISTORY_KEEP = 300;
const ITEM_ID_RE = /^[a-f0-9]{16}$/;
const INPUT_RE = /^[A-Za-z0-9_.{}-]{1,120}$/;

function isValidItemId(id) { return typeof id === 'string' && ITEM_ID_RE.test(id); }
function isValidInput(name) { return typeof name === 'string' && INPUT_RE.test(name) && !name.includes('..'); }

/**
 * @param {string} file queue.json
 * @param {() => Date} [now]
 */
function createQueue(file, now = () => new Date()) {
  let items = [];
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    items = Array.isArray(j.items) ? j.items : [];
  } catch { items = []; }

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2));
    fs.renameSync(tmp, file);
  }

  function prune() {
    const finished = items.filter((i) => i.status === 'done');
    if (finished.length <= HISTORY_KEEP) return;
    const drop = new Set(finished
      .sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)))
      .slice(0, finished.length - HISTORY_KEEP).map((i) => i.id));
    items = items.filter((i) => !drop.has(i.id));
  }

  return {
    list: () => items.map((i) => ({ ...i })),
    get: (id) => { const i = items.find((x) => x.id === id); return i ? { ...i } : null; },
    findBy: (pred) => { const i = items.find(pred); return i ? { ...i } : null; },
    /** @param {object} fields origin, sourceName, sourceBytes, input, recordedAt, participants, folderId, folderLabel, uniqueId */
    add(fields) {
      const item = {
        id: crypto.randomBytes(8).toString('hex'),
        origin: fields.origin,
        sourceName: String(fields.sourceName || '').slice(0, 300),
        sourceBytes: Number(fields.sourceBytes) || 0,
        input: fields.input,
        recordedAt: fields.recordedAt || null,
        participants: Array.isArray(fields.participants) ? fields.participants : [],
        folderId: fields.folderId || null,
        folderLabel: fields.folderLabel || null,
        uniqueId: fields.uniqueId || null,
        status: 'queued',
        attempts: 0,
        error: null,
        message: null,
        resultName: null,
        warnings: [],
        published: null,
        publishError: null,
        createdAt: now().toISOString(),
        startedAt: null,
        finishedAt: null,
      };
      items.push(item);
      save();
      return { ...item };
    },
    update(id, patch) {
      const i = items.find((x) => x.id === id);
      if (!i) return null;
      Object.assign(i, patch);
      prune();
      save();
      return { ...i };
    },
    remove(id) {
      const before = items.length;
      items = items.filter((x) => x.id !== id);
      if (items.length !== before) save();
      return items.length !== before;
    },
    next: () => { const i = items.find((x) => x.status === 'queued'); return i ? { ...i } : null; },
    /** Boot: nothing is running yet, so a 'processing' item was interrupted. */
    resetInterrupted() {
      let n = 0;
      for (const i of items) {
        if (i.status === 'processing') { i.status = 'queued'; i.message = 'Interrupted by a restart - requeued.'; n++; }
      }
      if (n) save();
      return n;
    },
  };
}

module.exports = { createQueue, isValidItemId, isValidInput, HISTORY_KEEP };
