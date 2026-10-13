'use strict';
// modules/meeting-transcripts/server/lib.js
// PURE helpers of the transcription pipeline - no I/O, no network, no child
// process - so tests/test_meeting_transcripts_lib.mjs can pin every rule.
//
// Every chunk / gap / offset / clip rule here was learned on real
// recordings: ffmpeg `-c copy` segmenting overshoots the
// chunk length, Gemini returns inverted timestamps and timestamps past the end
// of the audio, and a single call stops transcribing long before the end of a
// dense fragment. Do not drop a rule without a recording that proves it moot.

const CHUNK_SEC = 300;
const GAP_RETRY_SEC = 30;
const MAX_GAP_SLICE_SEC = 240;
const GAP_PAD_SEC = 3;
const EOF_TOLERANCE_SEC = 5;

const MAX_PARTICIPANTS = 20;
const MAX_PARTICIPANT_LEN = 80;

const STT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    segments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          speaker_id: { type: 'STRING' },
          start: { type: 'NUMBER' },
          end: { type: 'NUMBER' },
          text: { type: 'STRING' },
        },
        required: ['speaker_id', 'start', 'end', 'text'],
      },
    },
  },
  required: ['segments'],
};

const SPEAKER_MAP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    map: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          chunk: { type: 'INTEGER' },
          local_id: { type: 'STRING' },
          global_id: { type: 'STRING' },
        },
        required: ['chunk', 'local_id', 'global_id'],
      },
    },
  },
  required: ['map'],
};

const SUMMARY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    chosen_template: { type: 'STRING' },
    template_reason: { type: 'STRING' },
    title: { type: 'STRING' },
    brief: { type: 'STRING' },
    summary_md: { type: 'STRING' },
  },
  required: ['chosen_template', 'template_reason', 'title', 'brief', 'summary_md'],
};

/** Comma list from the page -> clean, de-duplicated, capped name list. */
function parseParticipants(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const out = [];
  for (const part of raw.split(/[,;\n]/)) {
    const name = part.replace(/\s+/g, ' ').trim().slice(0, MAX_PARTICIPANT_LEN);
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= MAX_PARTICIPANTS) break;
  }
  return out;
}

/** The STT prompt. The transcript stays in the language spoken in the recording. */
function buildSttPrompt(participants) {
  let p = 'Transcribe the recording verbatim, in the language spoken in it. '
    + 'Return a JSON object with the schema {segments:[{speaker_id,start,end,text}]}. '
    + 'Each segment is a continuous utterance of one speaker (one or a few sentences). ';
  if (participants && participants.length) {
    p += 'Diarization: the known meeting participants are: '
      + participants.map((n) => '"' + n + '"').join(', ') + '. '
      + 'Use these exact names as speaker_id. '
      + 'If a speaker matches none of the participants, use "Person_1", "Person_2" and so on. ';
  } else {
    p += 'Diarization: if you hear the speaker\'s name in the recording, use it as speaker_id. '
      + 'Otherwise use "Person_1", "Person_2" and so on. ';
  }
  p += 'Keep the same speaker_id consistently through the whole recording - the same person = the same id. '
    + 'start and end are times in seconds from the beginning of this audio fragment. '
    + 'IMPORTANT: transcribe the WHOLE audio file to the very end - do not stop halfway.';
  return p;
}

/**
 * Internal gaps (> gapSec) and the trailing gap of one NON-last chunk, as
 * retry slices of at most sliceSec, padded by GAP_PAD_SEC and clamped to
 * [0, chunkLen]. Slices shorter than 5 s are dropped.
 * @returns {{start:number, end:number}[]} local seconds
 */
function findGaps(segments, chunkLen = CHUNK_SEC, opts = {}) {
  const gapSec = opts.gapSec || GAP_RETRY_SEC;
  const sliceSec = opts.sliceSec || MAX_GAP_SLICE_SEC;
  const sorted = [...(segments || [])].sort((a, b) => Number(a.start) - Number(b.start));
  const gaps = [];
  let prevEnd = 0;
  for (const s of sorted) {
    const st = Number(s.start) || 0;
    if (st - prevEnd > gapSec) gaps.push([prevEnd, st]);
    prevEnd = Math.max(prevEnd, Number(s.end) || 0);
  }
  if (prevEnd < chunkLen - gapSec) gaps.push([prevEnd, chunkLen]);

  const slices = [];
  for (const [gStart, gEnd] of gaps) {
    for (let cur = gStart; cur < gEnd; cur += sliceSec) {
      const subEnd = Math.min(gEnd, cur + sliceSec);
      const start = Math.max(0, cur - GAP_PAD_SEC);
      const end = Math.min(chunkLen, subEnd + GAP_PAD_SEC);
      if (end - start >= 5) slices.push({ start, end });
    }
  }
  return slices;
}

/**
 * Replace a chunk's segments inside a retried slice with the slice's own
 * (already shifted to chunk-local time) segments. The slice is padded by 3 s
 * on both sides, so it re-hears the edges of the neighbouring segments: a new
 * segment overlapping a kept one by more than half of its own length is that
 * neighbour again and is dropped (otherwise it would be duplicated).
 */
function spliceGapSegments(chunkSegs, slice, sliceSegs) {
  const kept = (chunkSegs || []).filter((s) => !(Number(s.start) >= slice.start - 1
    && Number(s.end) <= slice.end + 1));
  const fresh = (sliceSegs || []).filter((n) => {
    const ns = Number(n.start); const ne = Number(n.end);
    const len = Math.max(0.01, ne - ns);
    return !kept.some((k) => (Math.min(ne, Number(k.end)) - Math.max(ns, Number(k.start))) > len / 2);
  });
  return [...kept, ...fresh].sort((a, b) => Number(a.start) - Number(b.start));
}

/**
 * A retry slice can only contribute what lies inside it (a guard: Gemini's
 * timestamps are not trustworthy). The duplicates seen on 2026-10-09 did NOT
 * come from here - see dedupeRepeats for their real cause. A slice can only
 * contribute what lies inside it:
 * segments (already shifted to chunk time) starting outside
 * [slice.start - 1, slice.end + 1] are dropped, ends are clipped to the slice.
 * @returns {{kept: object[], dropped: object[]}}
 */
function clampToSlice(sliceSegs, slice) {
  const kept = [];
  const dropped = [];
  for (const sg of sliceSegs || []) {
    const st = Number(sg.start);
    const en = Number(sg.end);
    if (!Number.isFinite(st) || !Number.isFinite(en) || st < slice.start - 1 || st >= slice.end + 1 || en <= st) {
      dropped.push(sg);
      continue;
    }
    kept.push(en > slice.end ? { ...sg, end: slice.end } : sg);
  }
  return { kept, dropped };
}

const DEDUPE_WINDOW_SEC = 240;
const DEDUPE_MIN_CONTENT = 4;
const DEDUPE_BIGRAMS = 0.5;
const DEDUPE_CONTENT = 0.7;
// Fillers and function words: shared by any two sentences, so they must not
// count as evidence that two segments say the same thing.
const STOPWORDS_EN = 'the and but not for yes no so like what that this these those then than '
  + 'you your yours he she they them their his her its our ours we are was were been being will would '
  + 'have has had can could should just still already only also with from into onto about over '
  + 'there here when where which who whom why how all any some one too very much more most '
  + 'okay ok right well yeah mhm uh um hmm erm sort kind like know mean basically actually really now '
  + 'let lets get got going gonna wanna do does did is it to of on in at by as or if be me my mine i a an';

function _words(text) {
  return String(text || '').toLowerCase().replace(/\u0142/g, 'l').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !/^y+$/.test(w) && !/^e+$/.test(w));
}

const STOPWORDS = new Set(_words(STOPWORDS_EN));


function _content(words) {
  return words.filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function _bigrams(words) {
  const out = [];
  for (let i = 0; i + 1 < words.length; i++) out.push(words[i] + ' ' + words[i + 1]);
  return out;
}

/** Share of the smaller bag found in the larger one. */
function _containment(a, b) {
  if (!a.length || !b.length) return 0;
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  const bag = new Map();
  for (const w of big) bag.set(w, (bag.get(w) || 0) + 1);
  let hit = 0;
  for (const w of small) { const n = bag.get(w) || 0; if (n) { hit += 1; bag.set(w, n - 1); } }
  return hit / small.length;
}

/** Same speech twice: the same content words AND mostly the same word order. */
function _isRepeat(A, B) {
  if (A.c.length < DEDUPE_MIN_CONTENT || B.c.length < DEDUPE_MIN_CONTENT) return false;
  return _containment(A.c, B.c) >= DEDUPE_CONTENT && _containment(A.b, B.b) >= DEDUPE_BIGRAMS;
}

/**
 * Root cause (diagnosed 2026-10-09 on two refinement meetings): Gemini places
 * part of a 5-minute chunk's speech too early (~40 s), which leaves a false
 * "gap" where that speech really is. The gap retry then transcribes that
 * audio again, correctly, and the meeting
 * holds the same lines twice. The gap retry stays (it does recover speech a
 * chunk truly skipped), so the repeat is removed after the merge.
 *
 * The same speech transcribed twice (a gap retry or a chunk seam) shows up as
 * a second copy of a run of segments within a few minutes. A segment of 5+
 * words whose text matches an earlier-or-later one within 240 s by 75%+ is a
 * repeat; of the two, the copy from a gap retry (`gap` set) goes, otherwise
 * the later one. Short segments ("Mhm", "Sorry?") lying inside a removed
 * run of the same copy go with it.
 * @param {object[]} segments merged, chunk-absolute, sorted by start
 * @returns {{segments: object[], removed: object[]}}
 */
function dedupeRepeats(segments) {
  const segs = (segments || []).map((sg, i) => {
    const w = _words(sg.text);
    return { sg, i, w, c: _content(w), b: _bigrams(w) };
  });
  const drop = new Set();
  const pairs = [];
  for (let a = 0; a < segs.length; a++) {
    const A = segs[a];
    if (drop.has(A.i)) continue;
    for (let b = a + 1; b < segs.length; b++) {
      const B = segs[b];
      if (Number(B.sg.start) - Number(A.sg.start) > DEDUPE_WINDOW_SEC) break;
      if (drop.has(B.i) || !_isRepeat(A, B)) continue;
      const [loser, kept] = A.sg.gap && !B.sg.gap ? [A, B] : [B, A];
      drop.add(loser.i);
      pairs.push({ removed: loser.sg, kept: kept.sg });
      if (loser === A) break;
    }
  }
  // Short lines between two removed segments of one run go too.
  const long = (x) => x.c.length >= DEDUPE_MIN_CONTENT;
  const sorted = segs.slice().sort((x, y) => Number(x.sg.start) - Number(y.sg.start));
  for (let k = 1; k < sorted.length - 1; k++) {
    const cur = sorted[k];
    if (drop.has(cur.i) || long(cur)) continue;
    let prev = k - 1; while (prev >= 0 && !long(sorted[prev])) prev--;
    let next = k + 1; while (next < sorted.length && !long(sorted[next])) next++;
    if (prev >= 0 && next < sorted.length && drop.has(sorted[prev].i) && drop.has(sorted[next].i)
      && (sorted[prev].sg.gap || null) === (cur.sg.gap || null)) drop.add(cur.i);
  }
  return {
    segments: segs.filter((x) => !drop.has(x.i)).map((x) => x.sg),
    removed: segs.filter((x) => drop.has(x.i)).map((x) => x.sg),
    pairs,
  };
}

/**
 * Merge per-chunk segments into one timeline.
 * chunks: [{ ok: boolean, segments: [...] }] in chunk order (local times).
 * - a failed chunk contributes nothing
 * - inverted segments (end <= start) are dropped
 * - a segment starting at/after the chunk window is dropped, its end clipped
 * - the last chunk's window is (duration - offset + 5 s)
 * - final clip: nothing starts at/after duration + 5 s
 */
function mergeChunkSegments(chunks, { chunkSec = CHUNK_SEC, duration }) {
  const out = [];
  const lastIdx = chunks.length - 1;
  chunks.forEach((c, idx) => {
    if (!c || !c.ok) return;
    const offset = idx * chunkSec;
    const limit = idx === lastIdx ? (duration - offset + EOF_TOLERANCE_SEC) : chunkSec;
    for (const s of c.segments || []) {
      const st = Number(s.start);
      const en = Number(s.end);
      if (!Number.isFinite(st) || !Number.isFinite(en) || en <= st) continue;
      if (st >= limit) continue;
      out.push({
        chunk: idx,
        speaker_id: String(s.speaker_id || '').trim(),
        start: round2(st + offset),
        end: round2(Math.min(en, limit) + offset),
        text: String(s.text || '').trim(),
        gap: s.gap || null,
      });
    }
  });
  out.sort((a, b) => a.start - b.start);
  const hardLimit = duration + EOF_TOLERANCE_SEC;
  return out.filter((s) => s.start < hardLimit).map((s) => (s.end > hardLimit ? { ...s, end: round2(hardLimit) } : s));
}

function round2(n) { return Math.round(n * 100) / 100; }

/** Per chunk: every local speaker id with its first `n` utterances. */
function speakerSamples(segments, n = 3) {
  const byKey = new Map();
  for (const s of segments) {
    const key = s.chunk + '\u0000' + s.speaker_id;
    if (!byKey.has(key)) byKey.set(key, { chunk: s.chunk, local_id: s.speaker_id, samples: [] });
    const e = byKey.get(key);
    if (e.samples.length < n) e.samples.push(s.text.slice(0, 200));
  }
  return [...byKey.values()];
}

function buildSpeakerMapPrompt(samples, participants) {
  return 'Below are the speaker ids of consecutive 5-minute fragments of one meeting recording. '
    + 'Each fragment was transcribed separately, so the same id (e.g. "Person_1") in two fragments '
    + 'may mean different people, and one person may have different ids. '
    + 'Based on what is said, the names mentioned in the conversation and the context, assign every (chunk, local_id) '
    + 'one global person id (global_id), consistent across the whole recording. '
    + (participants.length ? 'Known participants: ' + participants.join(', ') + '. When one fits, use exactly these names. ' : '')
    + 'When you do not know the name, use "Person_1", "Person_2" and so on. Return an entry for EVERY pair in the list.\n\n'
    + JSON.stringify(samples, null, 1);
}

/** Apply { chunk, local_id, global_id }[]; returns null when the map does not cover every pair. */
function applySpeakerMap(segments, map) {
  const lookup = new Map();
  for (const m of map || []) {
    const g = String(m.global_id || '').trim();
    if (g) lookup.set(Number(m.chunk) + '\u0000' + String(m.local_id), g);
  }
  const out = [];
  for (const s of segments) {
    const g = lookup.get(s.chunk + '\u0000' + s.speaker_id);
    if (!g) return null;
    out.push({ ...s, speaker_id: g });
  }
  return out;
}

/** Fallback when unification failed: keep chunks apart instead of merging labels silently. */
function prefixSpeakers(segments) {
  const chunks = new Set(segments.map((s) => s.chunk));
  if (chunks.size <= 1) return segments.map((s) => ({ ...s }));
  return segments.map((s) => ({ ...s, speaker_id: 's' + (s.chunk + 1) + '_' + s.speaker_id }));
}

function fmtTs(sec) {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

/** "[00:01:05] Alex: text" lines, consecutive turns of one speaker kept apart. */
function buildTranscriptTxt(segments) {
  return segments.map((s) => '[' + fmtTs(s.start) + '] ' + (s.speaker_id || 'Person ?') + ': ' + s.text).join('\n');
}

function uniqueSpeakers(segments) {
  const out = [];
  for (const s of segments) if (s.speaker_id && !out.includes(s.speaker_id)) out.push(s.speaker_id);
  return out;
}

/** templates: [{ name, body }] */
function buildSummaryPrompt({ transcriptTxt, templates, sourceFile, speakers }) {
  const tpl = templates.map((t) => '### TEMPLATE: ' + t.name + '\n' + t.body).join('\n\n');
  return 'You are a product assistant. Below is the transcript of a meeting recording (' + sourceFile + ').\n\n'
    + 'Task:\n'
    + '1. Pick the best-fitting note template from the templates below (chosen_template = its name).\n'
    + '2. Explain the choice in 1-2 sentences (template_reason).\n'
    + '3. Give the meeting a short title (title) and write a 2-3 sentence brief (brief).\n'
    + '4. Write a FULL summary in Markdown (summary_md) following the structure of the chosen template: '
    + 'every topic, decision, doubt and to-do item with the people responsible. Do not shorten. '
    + 'Skip the template\'s YAML frontmatter.\n'
    + (speakers.length ? 'Participants (use ONLY these names): ' + speakers.join(', ') + '.\n' : '')
    + 'Write in the language of the meeting.\n\n'
    + 'TEMPLATES:\n' + tpl + '\n\n'
    + 'TRANSCRIPT:\n' + transcriptTxt;
}

/** ASCII slug, diacritics folded, max 60 chars. */
function slugify(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '');
  const folded = base.replace(/[łŁ]/g, (c) => (c === 'ł' ? 'l' : 'L'))
    .normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const slug = folded.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return slug || 'recording';
}

/** YYYY-MM-DD-HHmmss in Europe/Warsaw. */
function warsawStamp(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const hh = parts.hour === '24' ? '00' : parts.hour;
  return parts.year + '-' + parts.month + '-' + parts.day + '-' + hh + parts.minute + parts.second;
}

function outputFileName(date, sourceName) {
  return warsawStamp(date) + '-' + slugify(sourceName) + '.json';
}

const OUTPUT_NAME_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}-[a-z0-9-]{1,60}\.json$/;
function isValidOutputName(name) { return typeof name === 'string' && OUTPUT_NAME_RE.test(name); }
/** The HTML report sits next to its JSON under the same stem. */
function reportFileName(jsonName) { return String(jsonName).replace(/\.json$/, '.html'); }

const UPLOAD_ID_RE = /^[a-f0-9]{24}$/;
function isValidUploadId(id) { return typeof id === 'string' && UPLOAD_ID_RE.test(id); }

const ALLOWED_EXTS = ['.mp3', '.m4a', '.wav', '.ogg', '.webm', '.mp4', '.mov', '.mkv', '.aac', '.flac'];
function allowedExtension(name) {
  const m = /\.[^.]+$/.exec(String(name || '').toLowerCase());
  return m && ALLOWED_EXTS.includes(m[0]) ? m[0] : null;
}

/** The one output document. `segments` keeps that key: scripts/extract-transcript.js reads it. */
function buildOutputDoc({ sourceFile, sourceBytes, recordedAt, processedAt, durationSec, model, warnings, summary, segments, report, reportFile }) {
  const clean = segments.map((s) => ({ speaker_id: s.speaker_id, start: s.start, end: s.end, text: s.text }));
  const speakers = uniqueSpeakers(clean);
  return {
    schemaVersion: 1,
    source_file: sourceFile,
    source_bytes: sourceBytes,
    recorded_at: recordedAt || null,
    processed_at: processedAt,
    duration_sec: round2(durationSec),
    model,
    status: warnings.some((w) => w.startsWith('chunk-failed')) ? 'partial' : 'ok',
    warnings,
    title: (summary && summary.title) || '',
    brief: (summary && summary.brief) || '',
    participants: speakers.map((n) => ({ name: n, speaker_id: n })),
    segments: clean,
    transcript_txt: buildTranscriptTxt(clean),
    summary: {
      chosen_template: (summary && summary.chosen_template) || '',
      template_reason: (summary && summary.template_reason) || '',
      summary_md: (summary && summary.summary_md) || '',
    },
    report: report || null,
    report_file: reportFile || null,
  };
}

module.exports = {
  clampToSlice, dedupeRepeats,
  CHUNK_SEC, STT_SCHEMA, SPEAKER_MAP_SCHEMA, SUMMARY_SCHEMA, ALLOWED_EXTS,
  parseParticipants, buildSttPrompt, findGaps, spliceGapSegments, mergeChunkSegments,
  speakerSamples, buildSpeakerMapPrompt, applySpeakerMap, prefixSpeakers,
  buildTranscriptTxt, uniqueSpeakers, buildSummaryPrompt, fmtTs,
  slugify, warsawStamp, outputFileName, isValidOutputName, reportFileName, isValidUploadId, allowedExtension,
  buildOutputDoc,
};
