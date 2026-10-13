'use strict';
// modules/meeting-transcripts/server/media.js
// ffmpeg / ffprobe through execFile: no shell, an argument array built from
// server-side paths only, a timeout on every call. This module deliberately
// runs a child process (like `locations` does for its SSO worker) - see README.
// `windowsHide` comes from scripts/_cp.js, which patches child_process for the
// whole server; nothing here is detached.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const FFMPEG_TIMEOUT_MS = 20 * 60 * 1000;
const EXTRA_DIRS = process.platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];

function _which(bin) {
  const exe = process.platform === 'win32' ? bin + '.exe' : bin;
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean).concat(EXTRA_DIRS);
  for (const d of dirs) {
    const p = path.join(d, exe);
    try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return null;
}

function findTools() {
  const ffmpeg = _which('ffmpeg');
  const ffprobe = _which('ffprobe');
  return ffmpeg && ffprobe ? { ffmpeg, ffprobe } : null;
}

function _run(bin, args, timeout = FFMPEG_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const tail = String(stderr || '').trim().split('\n').slice(-2).join(' ').slice(-200);
        const e = new Error('ffmpeg: ' + (err.killed ? 'timed out' : (tail || err.message)));
        e.code = 'ffmpeg';
        return reject(e);
      }
      resolve(String(stdout || ''));
    });
  });
}

async function probeDuration(tools, file) {
  const out = await _run(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', file], 60000);
  const d = parseFloat(out.trim());
  return Number.isFinite(d) ? d : 0;
}

/** Mono 16 kHz 48 kbps MP3 - from an audio or a video source alike. */
function extractAudio(tools, src, dst) {
  return _run(tools.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', src, '-vn',
    '-acodec', 'libmp3lame', '-b:a', '48k', '-ar', '16000', '-ac', '1', dst]);
}

/** Cut into <dir>/chunk_000.mp3 ... (stream copy, cuts on frame boundaries). */
async function splitAudio(tools, src, dir, chunkSec) {
  await _run(tools.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', src, '-f', 'segment',
    '-segment_time', String(chunkSec), '-c', 'copy', path.join(dir, 'chunk_%03d.mp3')]);
  return fs.readdirSync(dir).filter((f) => /^chunk_\d{3}\.mp3$/.test(f)).sort().map((f) => path.join(dir, f));
}

function cutSlice(tools, src, start, dur, dst) {
  return _run(tools.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-ss', String(start), '-t', String(dur),
    '-i', src, '-c', 'copy', dst], 120000);
}

/** Does the file carry a video stream (a Teams recording) or only audio? */
async function hasVideo(tools, src) {
  try {
    const out = await _run(tools.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0', src], 60000);
    return out.trim().startsWith('video');
  } catch {
    return false;
  }
}

/**
 * One JPEG every `everySec` seconds, at most 1280 px wide, as
 * <dir>/frame_00001.jpg ... (frame N shows t = (N-1) * everySec).
 */
async function extractFrames(tools, src, dir, everySec) {
  fs.mkdirSync(dir, { recursive: true });
  await _run(tools.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', src, '-an',
    '-vf', 'fps=1/' + everySec + ',scale=\'min(1280,iw)\':-2', '-q:v', '5', path.join(dir, 'frame_%05d.jpg')]);
}

module.exports = { findTools, probeDuration, extractAudio, splitAudio, cutSlice, hasVideo, extractFrames };
