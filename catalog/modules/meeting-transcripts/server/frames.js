'use strict';
// modules/meeting-transcripts/server/frames.js
// Who is speaking, read off the Teams picture:
//   participantsFromFrames   names under the video tiles -> the STT prompt,
//                            so every chunk uses the same canonical speaker ids
//   activeSpeakerTimeline    who has the active-speaker border on frames
//                            sampled inside long segments
//   applyVisualCorrections   majority vote overrides the STT id
//   matchMember /
//   canonicalName            truncated tile labels ("EXT Morgan A...")
//                            -> full team-directory names
// Frames are 1 per 10 s, extracted by media.extractFrames into the job's
// work directory and deleted with it - nothing here keeps a frame.

const fs = require('fs');
const path = require('path');
const gemini = require('./gemini');

const FRAME_INTERVAL_SEC = 10;
const VISUAL_BATCH = 10;
const VISUAL_CONCURRENCY = 3;
const MIN_SEGMENT_SEC = 8;
const LONG_SEGMENT_SEC = 30;
const MAX_FRAME_BYTES = 800 * 1024;
const PROBE_SECONDS = [30, 120, 240];
const PROBE_FRACTIONS = [0.33, 0.66];

const PARTICIPANTS_SCHEMA = {
  type: 'OBJECT',
  properties: { names: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['names'],
};

const TIMELINE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    frames: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { ts: { type: 'STRING' }, speaker: { type: 'STRING' } },
        required: ['ts', 'speaker'],
      },
    },
  },
  required: ['frames'],
};

const TILES_PROMPT = 'This is a screenshot of Microsoft Teams during a video call. '
  + 'List ONLY the names of people who have a participant tile - '
  + 'a rectangle with a camera picture or a round avatar (photo or initials), '
  + 'with a text label under it (e.g. "EXT Morgan Alex", "Rivera Sam CTR"). '
  + 'When a screen is shared the tiles are small and stacked in a column at the side or a strip at the bottom - include them too. '
  + 'Do NOT include names from: the participant panel on the left/right, '
  + '"X joined/left" notifications, the chat, the header bar or the shared screen. '
  + 'Return the names exactly as they are displayed under the tiles. '
  + 'If this is not a Teams meeting view or there are no tiles, return an empty list.';

const ACTIVE_PROMPT = 'On every Microsoft Teams frame, point out who has the active-speaker indicator - '
  + 'a coloured/bright frame or outline around that person\'s tile or round avatar. '
  + 'The frame appears on the tile of the person who is speaking at that moment. '
  + 'Return the name exactly as it is displayed in the Teams label under the tile, '
  + 'and in the ts field - the timestamp given before the frame. '
  + 'If nobody has the frame or it cannot be determined, return an empty speaker for that frame.';

// -- names -----------------------------------------------------------------------

/** Lower case, no diacritics (l-stroke folded by hand), single spaces. */
function normalize(s) {
  return String(s || '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Team directory entries as {id, name}. Accepts both the split shape
 * (first_name/last_name) and a single name field.
 * @param {string|null} file team/team-members.json
 * @returns {{id: string|null, name: string}[]}
 */
function loadMembers(file) {
  if (!file) return [];
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(j) ? j : (j.team_members || j.members || []);
    return list.map((m) => ({
      id: m.id || null,
      name: String(m.name || [m.first_name, m.last_name].filter(Boolean).join(' ')).trim(),
      first: String(m.first_name || '').trim(),
      last: String(m.last_name || '').trim(),
      email: String(m.email || '').toLowerCase(),
    })).filter((m) => m.name);
  } catch {
    return [];
  }
}

/**
 * The team member a (Teams) name belongs to, or null.
 * Strategies, in order: exact; every part of the label is a
 * part of the member ("EXT Lee Jordan" -> "Jordan Lee", organisation prefixes
 * are single short tokens and drop out); every member part is in the label;
 * all significant (>= 4) parts match; a lone surname (>= 5) or its truncated
 * prefix matches the member's LAST name. A lone first name never matches - it
 * is not unique.
 * @param {string} name
 * @param {{id: string|null, name: string}[]} members
 */
// Organisation markers a directory may put in display names: "EXT Morgan Alex",
// "Rivera Sam CTR". A label that carries one is written SURNAME FIRST.
const ORG_TOKENS = new Set(['ext', 'ctr', 'b2b', 'vnd']);

function _lastOf(m) { return normalize(m.last || String(m.name).split(' ').slice(-1)[0]); }
function _firstOf(m) { return normalize(m.first || String(m.name).split(' ')[0]); }

/**
 * Surname-first rule for labels with an organisation marker: the first
 * remaining token is the (possibly truncated, >= 3 letters) surname, the
 * second one the first name. "EXT Morg" -> Alex Morgan, "EXT Riv" -> Sam
 * Rivera. Among several hits the first name decides, then a label prefers
 * mailboxes that start with its marker ("ext." for EXT); still several -> no
 * match.
 */
function orgLabelMatch(norm, members) {
  const tokens = norm.split(' ').filter(Boolean);
  const org = tokens.filter((t) => ORG_TOKENS.has(t));
  if (!org.length) return null;
  const core = tokens.filter((t) => !ORG_TOKENS.has(t));
  if (!core.length || core[0].length < 3) return null;
  let hits = members.filter((m) => _lastOf(m).startsWith(core[0]));
  if (hits.length > 1 && core[1]) {
    const byFirst = hits.filter((m) => _firstOf(m).startsWith(core[1]));
    if (byFirst.length) hits = byFirst;
  }
  if (hits.length > 1) {
    const marked = hits.filter((m) => m.email && org.some((o) => m.email.startsWith(o + '.')));
    if (marked.length) hits = marked;
  }
  return hits.length === 1 ? hits[0] : null;
}

function matchMember(name, members) {
  const norm = normalize(String(name || '').replace(/(\.\.\.|…|\.\.)$/, ''));
  if (!norm || norm.length < 3 || !members.length) return null;
  const byOrg = orgLabelMatch(norm, members);
  if (byOrg) return byOrg;
  const parts = norm.split(' ').filter((p) => p.length > 2);
  if (!parts.length) return null;
  const withParts = members.map((m) => ({ m, mp: normalize(m.name).split(' ') }));
  for (const { m } of withParts) {
    if (normalize(m.name) === norm) return m;
  }
  if (parts.length >= 2) {
    for (const { m, mp } of withParts) if (parts.every((p) => mp.includes(p))) return m;
    for (const { m, mp } of withParts) if (mp.length >= 2 && mp.every((p) => parts.includes(p))) return m;
    const sig = parts.filter((p) => p.length >= 4);
    if (sig.length >= 2) for (const { m, mp } of withParts) if (sig.every((p) => mp.includes(p))) return m;
    // "Morgan A" / "EXT Rivera S": one long token is the surname.
    const longOnes = parts.filter((p) => p.length >= 5);
    if (longOnes.length === 1) return surnameMatch(longOnes[0], withParts);
    return null;
  }
  return parts[0].length >= 5 ? surnameMatch(parts[0], withParts) : null;
}

function surnameMatch(token, withParts) {
  const hits = withParts.filter(({ mp }) => mp.length && (mp[mp.length - 1] === token || mp[mp.length - 1].startsWith(token)));
  return hits.length === 1 ? hits[0].m : null; // two people with that surname: not unique
}

/** Full directory name when the label matches somebody, else the cleaned label. */
/**
 * Manual assignment from the module settings ({label, name}): a label whose
 * normalised form starts with the alias label (or the other way round, for
 * a label Teams cut shorter than the alias) takes the alias name.
 */
function aliasFor(label, aliases) {
  const n = _coreKey(label);
  for (const a of aliases || []) {
    const k = _coreKey(a && a.label);
    if (k.length >= 3 && n.length >= 3 && (n.startsWith(k) || k.startsWith(n))) return String(a.name).trim();
  }
  return null;
}

function canonicalName(name, members, aliases) {
  const clean = stripEllipsis(String(name || '').trim());
  const target = aliasFor(clean, aliases) || clean;
  const m = matchMember(target, members);
  return m ? m.name : target;
}

function stripEllipsis(s) {
  return String(s || '').replace(/\s*(\.\.\.|…|\.\.)$/, '').trim();
}

/**
 * Merge tile labels seen on several frames: ellipsis stripped, labels shorter
 * than 5 chars dropped, the same 5-char prefix is the same person and the
 * longest version wins.
 * @param {string[]} best current list (mutated copy returned)
 * @param {string[]} raw labels from one frame
 * @returns {string[]}
 */
/** Label without organisation markers, for comparing truncated variants. */
function _coreKey(label) {
  return normalize(label).split(' ').filter((t) => t && !ORG_TOKENS.has(t)).join(' ');
}

function mergeTileNames(best, raw) {
  const out = best.slice();
  for (const r of raw || []) {
    const clean = stripEllipsis(r);
    const key = _coreKey(clean);
    if (key.length < 3) continue;
    // "EXT Morg" and "EXT Morgan Alex" are one person: one core is a prefix of the other.
    const i = out.findIndex((x) => { const k = _coreKey(x); return k.startsWith(key) || key.startsWith(k); });
    if (i < 0) out.push(clean);
    else if (clean.length > out[i].length) out[i] = clean;
  }
  return out;
}

// -- frame files -------------------------------------------------------------------

/**
 * Frames written by ffmpeg as frame_00001.jpg (1-based, one per interval) ->
 * [{ts, file}] sorted. The first frame is t=0.
 * @param {string} dir
 */
function listFrames(dir, interval = FRAME_INTERVAL_SEC) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => /^frame_\d{5}\.jpg$/.test(f)).sort(); } catch { return []; }
  return names.map((f) => ({ ts: (parseInt(f.slice(6, 11), 10) - 1) * interval, file: path.join(dir, f) }));
}

function nearest(frames, ts) {
  let best = frames[0];
  for (const f of frames) if (Math.abs(f.ts - ts) < Math.abs(best.ts - ts)) best = f;
  return best;
}

/**
 * Timestamps whose frames are worth a look: the midpoint of every segment of at least
 * 8 s, start and end of segments of 30 s and more, and every chunk seam.
 * @param {{start: number, end: number}[]} segments
 * @param {number[]} available sorted frame timestamps
 * @param {number} chunkSec
 * @returns {number[]} sorted, unique
 */
function selectFrameTimestamps(segments, available, chunkSec) {
  if (!segments.length || !available.length) return [];
  const avail = available.slice().sort((a, b) => a - b);
  const near = (ts) => avail.reduce((b, x) => (Math.abs(x - ts) < Math.abs(b - ts) ? x : b), avail[0]);
  const need = new Set();
  for (const s of segments) {
    const dur = Number(s.end) - Number(s.start);
    if (!(dur >= MIN_SEGMENT_SEC)) continue;
    need.add(near((Number(s.start) + Number(s.end)) / 2));
    if (dur >= LONG_SEGMENT_SEC) { need.add(near(Number(s.start))); need.add(near(Number(s.end))); }
  }
  const max = avail[avail.length - 1];
  for (let k = 1; k * chunkSec <= max + FRAME_INTERVAL_SEC; k++) need.add(near(k * chunkSec));
  return [...need].sort((a, b) => a - b);
}

/**
 * Majority vote of the active-speaker timeline over each segment of at least
 * 8 s; overrides the STT speaker only when more than half of the frames inside
 * the segment agree on somebody else.
 * @param {object[]} segments
 * @param {Map<number, string>} timeline ts -> speaker
 * @returns {{segments: object[], corrections: number}}
 */
function applyVisualCorrections(segments, timeline, interval = FRAME_INTERVAL_SEC) {
  if (!timeline.size) return { segments, corrections: 0 };
  let corrections = 0;
  const out = segments.map((s) => {
    const start = Number(s.start);
    const end = Number(s.end);
    if (!(end - start >= MIN_SEGMENT_SEC)) return s;
    const votes = new Map();
    for (const [ts, who] of timeline) {
      if (who && ts < end && ts + interval > start) votes.set(who, (votes.get(who) || 0) + 1);
    }
    let total = 0; let winner = null; let top = 0;
    for (const [who, n] of votes) { total += n; if (n > top) { top = n; winner = who; } }
    if (!winner || winner === s.speaker_id || top <= total / 2) return s;
    corrections += 1;
    return { ...s, speaker_id: winner };
  });
  return { segments: out, corrections };
}

// -- Gemini calls ---------------------------------------------------------------------

function imagePart(file) {
  const buf = fs.readFileSync(file);
  if (buf.length > MAX_FRAME_BYTES) return null;
  return { inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } };
}

function fmtTs(sec) {
  const t = Math.max(0, Math.round(sec));
  const p = (n) => String(n).padStart(2, '0');
  return p(Math.floor(t / 3600)) + ':' + p(Math.floor((t % 3600) / 60)) + ':' + p(t % 60);
}

/**
 * Names under the video tiles, read from a few frames (start of the meeting
 * and two later points for late joiners), resolved to directory names.
 * @returns {Promise<string[]>}
 */
async function participantsFromFrames({ frames, duration, model, signal, members, aliases, log }) {
  if (!frames.length) return [];
  const wanted = [...PROBE_SECONDS, ...PROBE_FRACTIONS.map((f) => f * duration)];
  const picks = [...new Map(wanted.map((ts) => { const f = nearest(frames, ts); return [f.ts, f]; })).values()];
  const results = await Promise.all(picks.map(async (f) => {
    try {
      const img = imagePart(f.file);
      if (!img) return [];
      const r = await gemini.generateJson({
        model, signal, schema: PARTICIPANTS_SCHEMA, maxOutputTokens: 1024, thinkingLevel: 'low',
        parts: [img, { text: TILES_PROMPT }],
      });
      return Array.isArray(r.names) ? r.names.map(String) : [];
    } catch (e) {
      if (e && e.code === 'no-token') throw e;
      log('Frame ' + fmtTs(f.ts) + ': could not read the tiles (' + (e && e.message ? e.message : e) + ').');
      return null;
    }
  }));
  if (results.every((r) => r === null)) {
    const e = new Error('no frame could be read');
    e.code = 'tiles-failed';
    throw e;
  }
  let names = [];
  for (const r of results) names = mergeTileNames(names, r || []);
  const out = [];
  for (const n of names) {
    const full = canonicalName(n, members, aliases);
    if (!out.includes(full)) out.push(full);
  }
  return out;
}

/**
 * Active speaker per sampled frame, batches of 10 frames per call.
 * @returns {Promise<Map<number, string>>} ts -> directory (or label) name
 */
async function activeSpeakerTimeline({ frames, segments, chunkSec, model, signal, members, aliases, log }) {
  const byTs = new Map(frames.map((f) => [f.ts, f]));
  const picked = selectFrameTimestamps(segments, [...byTs.keys()], chunkSec).map((ts) => byTs.get(ts));
  const batches = [];
  for (let i = 0; i < picked.length; i += VISUAL_BATCH) batches.push(picked.slice(i, i + VISUAL_BATCH));
  log('Speaker from the picture: ' + picked.length + ' frames of ' + frames.length + ', ' + batches.length + ' requests.');
  const timeline = new Map();
  let next = 0;
  let failed = 0;
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      const parts = [];
      const order = [];
      for (const f of batch) {
        const img = imagePart(f.file);
        if (!img) continue;
        parts.push({ text: '[Frame ' + fmtTs(f.ts) + ']' }, img);
        order.push(f.ts);
      }
      if (!order.length) continue;
      parts.push({ text: ACTIVE_PROMPT });
      try {
        const r = await gemini.generateJson({
          model, signal, schema: TIMELINE_SCHEMA, maxOutputTokens: 2048, thinkingLevel: 'low', parts,
        });
        // Match each answer to its frame by the ts label we sent; the position
        // is only a fallback - a skipped frame must not shift every later
        // speaker onto the wrong timestamp.
        const byLabel = new Map(order.map((ts) => [fmtTs(ts), ts]));
        (r.frames || []).forEach((fr, i) => {
          const who = String((fr && fr.speaker) || '').trim();
          const label = String((fr && fr.ts) || '').replace(/[[\]]/g, '').replace(/^Frame\s+/i, '').trim();
          const ts = byLabel.has(label) ? byLabel.get(label) : order[i];
          if (!who || ts === undefined) return;
          timeline.set(ts, canonicalName(who, members, aliases));
        });
      } catch (e) {
        if (e && e.code === 'no-token') throw e;
        failed += 1;
        log('Speaker from the picture: a frame batch failed (' + (e && e.message ? e.message : e) + ').');
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(VISUAL_CONCURRENCY, batches.length) }, worker));
  if (batches.length && failed === batches.length) {
    const e = new Error('no frame batch could be read');
    e.code = 'timeline-failed';
    throw e;
  }
  return timeline;
}

/** Every speaker id mapped to its directory name when it matches somebody. */
function canonicalizeSpeakers(segments, members, aliases) {
  if (!members.length && !(aliases && aliases.length)) return segments;
  const cache = new Map();
  return segments.map((s) => {
    if (!cache.has(s.speaker_id)) cache.set(s.speaker_id, canonicalName(s.speaker_id, members, aliases));
    const name = cache.get(s.speaker_id);
    return name && name !== s.speaker_id ? { ...s, speaker_id: name } : s;
  });
}

module.exports = {
  FRAME_INTERVAL_SEC, ORG_TOKENS, normalize, loadMembers, matchMember, aliasFor, canonicalName, mergeTileNames, listFrames,
  selectFrameTimestamps, applyVisualCorrections, participantsFromFrames, activeSpeakerTimeline, canonicalizeSpeakers,
};
