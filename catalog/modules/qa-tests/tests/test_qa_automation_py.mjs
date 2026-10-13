// modules/qa-tests/tests/test_qa_automation_py.mjs
// (c) Python-driven: a simulated fetch failure must cause qa_automation.py to
// exit non-zero and write nothing to the output directory. Skipped when Python
// is not available on the host.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS_DIR = path.join(DIR, 'scripts');

// Probe for a usable Python interpreter (same candidates as refresh-job.js).
function findPython() {
  const candidates = process.platform === 'win32'
    ? [['py', ['-3']], ['python', []]]
    : [['python3', []], ['python', []]];
  for (const [cmd, baseArgs] of candidates) {
    let r;
    try {
      r = spawnSync(cmd, [...baseArgs, '--version'], { encoding: 'utf8', timeout: 5000, shell: false });
    } catch {
      r = null;
    }
    if (r && !r.error && r.status === 0) return cmd;
  }
  return null;
}

const PYTHON = findPython();

// A minimal _common.py that causes every jira_get call to raise JiraConnectionError.
// atomic_write_shard and _update_shard_index are real implementations so the test
// can detect whether any file was actually written despite the failure.
const MOCK_COMMON_SRC = `\
import json
import os
import re
import sys
import tempfile


class JiraConnectionError(Exception):
    pass


class JiraHttpError(Exception):
    def __init__(self, status_code, message=''):
        super().__init__(message)
        self.status_code = status_code


_handoff = None


def load_handoff():
    global _handoff
    if _handoff is not None:
        return _handoff
    line = ''
    try:
        line = sys.stdin.readline()
    except Exception:
        pass
    data = {}
    try:
        data = json.loads(line) if line and line.strip() else {}
    except Exception:
        pass
    _handoff = {
        'token': data.get('token', 'dummy'),
        'jira_url': 'http://localhost:1',
        'verify_ssl': False,
    }
    return _handoff


def jira_get(path, params=None, retries=1):
    raise JiraConnectionError('Simulated network failure in test')


def progress(step, total, msg):
    pct = round(step / total * 100) if total > 0 else 0
    print(f'@@PROGRESS:{json.dumps({"step": step, "total": total, "pct": pct, "msg": msg})}',
          flush=True)


EXIT_DATA_MISSING = 3


def install_sigterm_handler():
    pass


def data_root_populated(root):
    return True


def safe_shard_key(name):
    return re.sub(r'[^A-Za-z0-9_-]', '_', (name or '').strip().lower())


def atomic_write_shard(shard_dir, key, payload, *, prefix='module-'):
    os.makedirs(shard_dir, exist_ok=True)
    filepath = os.path.join(shard_dir, f'{prefix}{key}.json')
    fd, tmp = tempfile.mkstemp(dir=shard_dir, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, filepath)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _update_shard_index(shard_dir, *, keys_present, meta_overrides,
                        compute_sprint_range=True):
    os.makedirs(shard_dir, exist_ok=True)
    index_path = os.path.join(shard_dir, 'index.json')
    fd, tmp = tempfile.mkstemp(dir=shard_dir, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(
                {'meta': meta_overrides, 'keys': sorted(str(k) for k in keys_present)},
                f, ensure_ascii=False,
            )
        os.replace(tmp, index_path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
`;

test(
  '(c) fetch failure: qa_automation.py exits non-zero and writes nothing to out dir',
  { skip: !PYTHON ? 'python3 not available on this host' : false },
  () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-fail-test-'));
    try {
      const scriptDir = path.join(tmpBase, 'scripts');
      const outDir = path.join(tmpBase, 'out');
      fs.mkdirSync(scriptDir, { recursive: true });
      fs.mkdirSync(outDir, { recursive: true });

      // Place the mock _common.py in the same directory as the script so
      // Python finds it first (script dir is sys.path[0]).
      fs.writeFileSync(path.join(scriptDir, '_common.py'), MOCK_COMMON_SRC, 'utf8');

      // Copy qa_automation.py alongside the mock so imports resolve correctly.
      fs.copyFileSync(
        path.join(SCRIPTS_DIR, 'qa_automation.py'),
        path.join(scriptDir, 'qa_automation.py'),
      );

      const handoff = JSON.stringify({
        token: 'dummy',
        jira_url: 'http://localhost:1',
        verify_ssl: false,
      }) + '\n';

      const result = spawnSync(PYTHON, ['-B', '-u', 'qa_automation.py', '--out', outDir], {
        cwd: scriptDir,
        input: handoff,
        encoding: 'utf8',
        timeout: 60_000,
        shell: false,
        env: {
          PATH: process.env.PATH || '',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
          LANG: 'C.UTF-8',
        },
      });

      // The script must exit non-zero when any fetch fails.
      assert.notStrictEqual(
        result.status, 0,
        'qa_automation.py must exit non-zero on fetch failure (got code ' +
        result.status + ')\nstdout: ' + result.stdout + '\nstderr: ' + result.stderr,
      );

      // No shard or index files must be written to the out directory.
      const written = fs.readdirSync(outDir).filter((f) => f !== '.' && f !== '..');
      assert.deepStrictEqual(
        written, [],
        'No files must be written to the out dir on failure; found: ' + written.join(', '),
      );
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  },
);
