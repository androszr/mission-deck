'use strict';
// modules/meeting-transcripts/server/pipeline.js
// One job: uploaded recording -> audio (+ one frame per 10 s of a video) ->
// names from the Teams tiles (frames.js) -> 300 s chunks -> Gemini STT (inline
// audio, 4 in parallel) -> gap retry -> merge -> speaker unification ->
// active-speaker correction from the frames -> directory names ->
// summary on a meeting-notes template -> ONE JSON file in
// user-data/transcripts/. The work directory is removed in `finally` on every
// exit path; the output is written tmp + rename.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const media = require('./media');
const gemini = require('./gemini');
const report = require('./report');
const frames = require('./frames');

const CHUNK_CONCURRENCY = 4;
const STT_MAX_TOKENS = 65536;
const SPEAKER_MAX_TOKENS = 8192;
const SUMMARY_MAX_TOKENS = 32768;
const REPORT_MAX_TOKENS = 32768;

function outputDir(rootDir) {
  return path.join(rootDir, 'user-data', 'transcripts');
}

function reportTemplatePath(rootDir) {
  return path.join(rootDir, 'templates', 'meeting-report.template.html');
}

function _writeAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

/** One text-only call: the structured content of the HTML report. */
async function generateReportContent(doc, model, signal) {
  return gemini.generateJson({
    model, signal, schema: report.REPORT_SCHEMA, maxOutputTokens: REPORT_MAX_TOKENS,
    parts: [{ text: report.buildReportPrompt({
      transcriptTxt: doc.transcript_txt || '', summaryMd: (doc.summary && doc.summary.summary_md) || '',
      speakers: (doc.participants || []).map((x) => x.name), sourceFile: doc.source_file || '',
    }) }],
  });
}

/**
 * Write <name>.html next to <name>.json from doc (doc.report may be null -
 * the renderer falls back to the summary). Returns the HTML file name.
 */
function writeReportHtml(rootDir, jsonName, doc) {
  const tpl = fs.readFileSync(reportTemplatePath(rootDir), 'utf8');
  const htmlName = lib.reportFileName(jsonName);
  _writeAtomic(path.join(outputDir(rootDir), htmlName), report.renderReport(tpl, doc, { jsonName }));
  return htmlName;
}

/**
 * (Re)build the report for an existing transcript file: ask Gemini for the
 * report content when the document has none (or `force`), render the HTML,
 * store `report` + `report_file` back into the JSON.
 */
async function buildReportForFile(rootDir, jsonName, { model, force } = {}) {
  const file = path.join(outputDir(rootDir), jsonName);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!doc.report || force) doc.report = await generateReportContent(doc, model || (await gemini.currentModel()).model);
  doc.report_file = writeReportHtml(rootDir, jsonName, doc);
  _writeAtomic(file, JSON.stringify(doc, null, 2) + '\n');
  return doc.report_file;
}

function readTemplates(rootDir) {
  const dir = path.join(rootDir, 'templates', 'meeting-notes');
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.template.md')).sort(); } catch { names = []; }
  return names.map((f) => ({
    name: f.replace(/\.template\.md$/, ''),
    body: fs.readFileSync(path.join(dir, f), 'utf8'),
  }));
}

async function _stt(file, prompt, model, signal) {
  const data = fs.readFileSync(file).toString('base64');
  const res = await gemini.generateJson({
    model, signal, schema: lib.STT_SCHEMA, maxOutputTokens: STT_MAX_TOKENS,
    parts: [{ inlineData: { mimeType: 'audio/mpeg', data } }, { text: prompt }],
  });
  return Array.isArray(res.segments) ? res.segments : [];
}

/** Run `fn` over items with at most `limit` in flight; results in input order. */
async function _pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * @param {object} p
 * @param {string} p.uploadPath recording on disk
 * @param {string} p.workDir    scratch dir, removed at the end
 * @param {string} p.sourceName original file name
 * @param {number} p.sourceBytes
 * @param {string[]} p.participants
 * @param {string} p.model
 * @param {string} p.rootDir
 * @param {(percent:number, step:string) => void} p.progress
 * @param {(text:string) => void} p.log
 * @param {AbortSignal} p.signal
 */
async function runJob(p) {
  const tools = media.findTools();
  if (!tools) return { ok: false, error: 'no-ffmpeg', message: 'ffmpeg is not installed on this computer.' };
  const { workDir, signal } = p;
  const aborted = () => signal && signal.aborted;
  try {
    fs.mkdirSync(workDir, { recursive: true });
    p.progress(2, 'Extracting audio (and video frames)...');
    const audio = path.join(workDir, 'audio.mp3');
    const frameDir = path.join(workDir, 'frames');
    const video = await media.hasVideo(tools, p.uploadPath);
    const warnings = [];
    let frameList = [];
    // allSettled, not all: a failed audio extraction must not return (and remove
    // workDir in `finally`) while the frames ffmpeg still writes into it.
    const [audioRes] = await Promise.allSettled([
      media.extractAudio(tools, p.uploadPath, audio),
      video ? media.extractFrames(tools, p.uploadPath, frameDir, frames.FRAME_INTERVAL_SEC).then(() => {
        frameList = frames.listFrames(frameDir);
      }).catch((e) => {
        warnings.push('frames-failed');
        p.log('Video frames: failed (' + (e && e.message ? e.message : e) + ') - speakers from audio only.');
      }) : null,
    ]);
    if (audioRes.status === 'rejected') throw audioRes.reason;
    const duration = await media.probeDuration(tools, audio);
    if (!duration) return { ok: false, error: 'no-audio', message: 'The recording has no audio track.' };
    p.log('Recording length: ' + lib.fmtTs(duration) + (video ? ', frames: ' + frameList.length : ', no video') + '.');

    const members = frames.loadMembers(p.teamFile || null);
    const aliases = Array.isArray(p.aliases) ? p.aliases : [];
    let participants = (p.participants || []).map((n) => frames.canonicalName(n, members, aliases));
    if (frameList.length) {
      p.progress(6, 'Recognising participants from the Teams tiles...');
      let fromTiles = [];
      try {
        fromTiles = await frames.participantsFromFrames({
          frames: frameList, duration, model: p.model, signal, members, aliases, log: p.log,
        });
      } catch (e) {
        if (e && e.code === 'no-token') throw e;
        warnings.push('tile-names-failed');
        p.log('Participants from tiles: ' + (e && e.message ? e.message : e) + '.');
      }
      p.log('Participants from tiles: ' + (fromTiles.length ? fromTiles.join(', ') : 'none (not a Teams view, or nobody has a tile)') + '.');
      for (const n of fromTiles) if (!participants.includes(n)) participants.push(n);
    }

    p.progress(10, 'Splitting into fragments...');
    const chunkDir = path.join(workDir, 'chunks');
    fs.mkdirSync(chunkDir, { recursive: true });
    const chunkFiles = await media.splitAudio(tools, audio, chunkDir, lib.CHUNK_SEC);
    if (!chunkFiles.length) return { ok: false, error: 'no-audio', message: 'Could not split the audio.' };
    const n = chunkFiles.length;
    p.log('Fragments: ' + n + ' (' + (lib.CHUNK_SEC / 60) + ' min each), model: ' + p.model + '.');

    const prompt = lib.buildSttPrompt(participants);
    let done = 0;
    p.progress(15, 'Transcription 0/' + n + '...');
    const chunks = await _pool(chunkFiles, CHUNK_CONCURRENCY, async (file, idx) => {
      if (aborted()) return { ok: false, segments: [] };
      try {
        let segments;
        try {
          segments = await _stt(file, prompt, p.model, signal);
        } catch (first) {
          // Every chunk gets one more try: an
          // empty or cut answer is usually a one-off, and a lost chunk is 5
          // minutes missing from the meeting.
          if ((first && first.code === 'no-token') || aborted()) throw first;
          p.log('Fragment ' + (idx + 1) + '/' + n + ': retrying (' + (first && first.message ? first.message : first) + ').');
          segments = await _stt(file, prompt, p.model, signal);
        }
        done += 1;
        p.log('Fragment ' + (idx + 1) + '/' + n + ': OK (' + segments.length + ' segments)');
        p.progress(15 + Math.round((done / n) * 55), 'Transcription ' + done + '/' + n + '...');
        return { ok: true, segments };
      } catch (e) {
        if (e && e.code === 'no-token') throw e;
        done += 1;
        p.log('Fragment ' + (idx + 1) + '/' + n + ': ERROR - ' + (e && e.message ? e.message : e));
        return { ok: false, segments: [] };
      }
    });
    if (aborted()) return { ok: false, error: 'aborted', message: 'Cancelled.' };
    if (!chunks.some((c) => c.ok)) {
      return { ok: false, error: 'stt-failed', message: 'No fragment was transcribed. Details in the log.' };
    }

    // Gap retry - every non-last chunk with a gap > 30 s gets the gap re-sent.
    p.progress(70, 'Filling gaps in the transcript...');
    for (let idx = 0; idx < n - 1; idx++) {
      const c = chunks[idx];
      if (!c.ok || !c.segments.length) continue;
      for (const slice of lib.findGaps(c.segments, lib.CHUNK_SEC)) {
        if (aborted()) break;
        const sliceFile = path.join(chunkDir, 'gap_' + idx + '_' + Math.round(slice.start) + '.mp3');
        try {
          await media.cutSlice(tools, chunkFiles[idx], slice.start, slice.end - slice.start, sliceFile);
          const raw = await _stt(sliceFile, prompt, p.model, signal);
          const tag = idx + ':' + Math.round(slice.start);
          const shifted = raw.map((s) => ({
            ...s, start: Number(s.start) + slice.start, end: Number(s.end) + slice.start, gap: tag,
          }));
          const { kept: segs, dropped } = lib.clampToSlice(shifted, slice);
          if (dropped.length) {
            const lo = Math.min(...raw.map((s) => Number(s.start) || 0));
            const hi = Math.max(...raw.map((s) => Number(s.end) || 0));
            p.log('Fragment ' + (idx + 1) + ': gap ' + Math.round(slice.start) + '-' + Math.round(slice.end)
              + ' s - dropped ' + dropped.length + ' segments timed outside the slice (Gemini gave ' + lo.toFixed(0) + '-' + hi.toFixed(0)
              + ' s for a ' + (slice.end - slice.start).toFixed(0) + ' s slice).');
          }
          if (segs.length) {
            c.segments = lib.spliceGapSegments(c.segments, slice, segs);
            p.log('Fragment ' + (idx + 1) + ': filled the gap ' + Math.round(slice.start) + '-' + Math.round(slice.end) + ' s (+' + segs.length + ').');
          }
        } catch (e) {
          p.log('Fragment ' + (idx + 1) + ': gap at ' + Math.round(slice.start) + ' s not filled (' + (e && e.message ? e.message : e) + ').');
        }
      }
    }

    chunks.forEach((c, idx) => {
      if (!c.ok) warnings.push('chunk-failed:' + lib.fmtTs(idx * lib.CHUNK_SEC) + '-' + lib.fmtTs(Math.min(duration, (idx + 1) * lib.CHUNK_SEC)));
    });
    let segments = lib.mergeChunkSegments(chunks, { chunkSec: lib.CHUNK_SEC, duration });
    const dd = lib.dedupeRepeats(segments);
    if (dd.removed.length) {
      segments = dd.segments;
      warnings.push('duplicates-removed:' + dd.removed.length);
      p.log('Removed ' + dd.removed.length + ' repeated utterances (e.g. ' + lib.fmtTs(dd.removed[0].start) + ' "'
        + String(dd.removed[0].text).slice(0, 60) + '"' + (dd.removed.some((r) => r.gap) ? ', from gap filling' : '') + ').');
    }

    // Speakers: each chunk labelled its own speakers - unify them, or keep chunks apart.
    const okChunks = chunks.filter((c) => c.ok).length;
    if (okChunks > 1 && segments.length) {
      p.progress(75, 'Unifying speakers across fragments...');
      let unified = null;
      try {
        const res = await gemini.generateJson({
          model: p.model, signal, schema: lib.SPEAKER_MAP_SCHEMA, maxOutputTokens: SPEAKER_MAX_TOKENS,
          parts: [{ text: lib.buildSpeakerMapPrompt(lib.speakerSamples(segments), participants) }],
        });
        unified = lib.applySpeakerMap(segments, res.map);
      } catch (e) {
        p.log('Speaker unification failed: ' + (e && e.message ? e.message : e));
      }
      if (unified) {
        segments = unified;
      } else {
        segments = lib.prefixSpeakers(segments);
        warnings.push('speakers-not-unified');
        p.log('Speakers labelled with the fragment number (s1_, s2_ ...) because they could not be unified.');
      }
    }
    if (aborted()) return { ok: false, error: 'aborted', message: 'Cancelled.' };

    // Who really spoke: the Teams active-speaker border, majority per segment.
    if (frameList.length && segments.length) {
      p.progress(77, 'Matching speakers to the Teams picture...');
      try {
        const timeline = await frames.activeSpeakerTimeline({
          frames: frameList, segments, chunkSec: lib.CHUNK_SEC, model: p.model, signal, members, aliases, log: p.log,
        });
        const fixed = frames.applyVisualCorrections(segments, timeline);
        segments = fixed.segments;
        p.log('Speaker from the picture: recognised on ' + [...timeline.values()].filter(Boolean).length + ' frames, corrected ' + fixed.corrections + ' utterances.');
      } catch (e) {
        if (e && e.code === 'no-token') throw e;
        warnings.push('visual-speakers-failed');
        p.log('Matching speakers to the picture failed: ' + (e && e.message ? e.message : e) + '.');
      }
    }
    segments = frames.canonicalizeSpeakers(segments, members, aliases);
    if (aborted()) return { ok: false, error: 'aborted', message: 'Cancelled.' };

    p.progress(80, 'Meeting summary (choosing a template)...');
    const templates = readTemplates(p.rootDir);
    let summary = null;
    try {
      summary = await gemini.generateJson({
        model: p.model, signal, schema: lib.SUMMARY_SCHEMA, maxOutputTokens: SUMMARY_MAX_TOKENS,
        parts: [{ text: lib.buildSummaryPrompt({
          transcriptTxt: lib.buildTranscriptTxt(segments), templates,
          sourceFile: p.sourceName, speakers: lib.uniqueSpeakers(segments),
        }) }],
      });
      p.log('Template: ' + (summary.chosen_template || '-') + '.');
    } catch (e) {
      warnings.push('summary-failed');
      p.log('Summary failed: ' + (e && e.message ? e.message : e) + ' - saving the transcript only.');
    }

    const now = new Date();
    const doc = lib.buildOutputDoc({
      sourceFile: p.sourceName, sourceBytes: p.sourceBytes, recordedAt: p.recordedAt || null,
      processedAt: now.toISOString(), durationSec: duration, model: p.model, warnings, summary, segments,
    });
    // Directory id per speaker, so the Meeting Archive shows the right face.
    doc.participants = doc.participants.map((x) => {
      const m = frames.matchMember(x.name, members);
      return m && m.id ? { ...x, member_id: m.id } : x;
    });
    doc.speakers_from_video = frameList.length > 0;

    p.progress(88, 'HTML report...');
    try {
      doc.report = await generateReportContent(doc, p.model, signal);
    } catch (e) {
      warnings.push('report-content-failed');
      p.log('HTML report content failed: ' + (e && e.message ? e.message : e) + ' - the report will be built from the summary alone.');
    }

    p.progress(95, 'Saving files...');
    const dir = outputDir(p.rootDir);
    fs.mkdirSync(dir, { recursive: true });
    let name = lib.outputFileName(now, p.sourceName);
    if (fs.existsSync(path.join(dir, name))) name = name.replace(/\.json$/, '-' + process.hrtime.bigint().toString(36).slice(-4) + '.json').replace(/[^a-z0-9.-]/g, '');
    try {
      doc.report_file = writeReportHtml(p.rootDir, name, doc);
      p.log('HTML report: ' + doc.report_file + '.');
    } catch (e) {
      warnings.push('report-html-failed');
      p.log('Saving the HTML report failed: ' + (e && e.message ? e.message : e) + '.');
    }
    _writeAtomic(path.join(dir, name), JSON.stringify(doc, null, 2) + '\n');
    p.progress(100, 'Done');
    return { ok: true, name, report: doc.report_file, title: doc.title, status: doc.status, warnings, segments: doc.segments.length };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

module.exports = { runJob, outputDir, readTemplates, buildReportForFile, writeReportHtml, CHUNK_CONCURRENCY };
