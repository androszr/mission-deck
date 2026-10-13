"""Shared I/O edge for the QA Tests ETL - stdlib only, no pip, no dotenv.

Three edges:
  - jira_get: urllib.request instead of `requests` (JiraHttpError /
    JiraConnectionError replace requests.exceptions.HTTPError / RequestException)
  - load_handoff: the Jira token arrives as ONE JSON line on stdin, never in
    argv or in the child's environment (never logged either)
  - write_out / atomic_write_shard / _update_shard_index: the ETL writes shards
    to jira/qa-automation/ via tmp + os.replace, keeping existing readers
    working unchanged; install_sigterm_handler removes a tmp file that
    a SIGTERM from Node catches mid-write.
"""

import json
import os
import re
import signal
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

try:
    import fcntl as _fcntl
    _HAS_FCNTL = True
except ImportError:
    _HAS_FCNTL = False

DEFAULT_JIRA_URL = 'https://jira.example.com'
RETRY_STATUSES = (500, 502, 503, 504)

_handoff = None


class JiraHttpError(Exception):
    """Replaces requests.exceptions.HTTPError - carries the HTTP status."""

    def __init__(self, status_code, message=''):
        super().__init__(message or f'HTTP {status_code}')
        self.status_code = status_code


class JiraConnectionError(Exception):
    """Replaces requests.exceptions.RequestException (timeout, DNS, TLS, ...)."""


def load_handoff():
    """Reads ONE JSON line from stdin: {token, jira_url, verify_ssl, project}.

    Cached after the first call - a script may call this many times through
    jira_get, but stdin only ever carries one line. Never printed, never
    written to a log line.
    """
    global _handoff
    if _handoff is not None:
        return _handoff
    try:
        line = sys.stdin.readline()
    except Exception:
        line = ''
    try:
        data = json.loads(line) if line and line.strip() else {}
    except (ValueError, TypeError):
        data = {}
    _handoff = {
        'token': data.get('token') or '',
        'jira_url': (data.get('jira_url') or DEFAULT_JIRA_URL).rstrip('/'),
        'verify_ssl': data.get('verify_ssl', True) is not False,
        'project': data.get('project') or 'QA',
    }
    return _handoff


def _ssl_context(verify_ssl):
    ctx = ssl.create_default_context()
    if not verify_ssl:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def jira_get(path, params=None, retries=3):
    """GET against the Jira instance from the stdin handoff, with a short
    backoff retry on transient 5xx and connection errors - same shape as a
    `requests`-based client, minus the dependency.
    """
    handoff = load_handoff()
    url = handoff['jira_url'] + path
    if params:
        url = url + '?' + urllib.parse.urlencode(params)
    ctx = _ssl_context(handoff['verify_ssl'])

    last_exc = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={
            'Authorization': 'Bearer ' + handoff['token'],
            'Accept': 'application/json',
        })
        try:
            with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
                body = resp.read().decode('utf-8')
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            if e.code in RETRY_STATUSES and attempt < retries - 1:
                time.sleep(1 + attempt * 2)
                continue
            last_exc = JiraHttpError(e.code, str(e))
            if attempt < retries - 1:
                time.sleep(1 + attempt * 2)
                continue
            raise last_exc
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_exc = JiraConnectionError(str(e))
            if attempt < retries - 1:
                time.sleep(1 + attempt * 2)
                continue
            raise last_exc
    if last_exc:
        raise last_exc
    return {}


def progress(step, total, msg):
    """Emits one @@PROGRESS: line on STDOUT, flushed - the Node side reads
    both stdout and stderr through the same line splitter, so which stream
    this lands on is a free choice; stdout keeps the two scripts symmetrical
    with their own regular print() calls.
    """
    pct = round(step / total * 100) if total > 0 else 0
    payload = json.dumps({'step': step, 'total': total, 'pct': pct, 'msg': msg}, ensure_ascii=False)
    print(f'@@PROGRESS:{payload}', flush=True)


# -- Tmp-file hygiene ---------------------------------------------------------
# Node stops a run with SIGTERM (refresh-job.js _killTree: cancel, timeout).
# Python's default SIGTERM action ends the process at once, with no except or
# finally running, so a mkstemp file caught mid-write would stay behind in
# jira/qa-automation/ and travel to the team on the next push. Every tmp path
# is tracked from the moment it exists until it is renamed or removed, and the
# SIGTERM handler removes whatever is still tracked before exiting.

_live_tmp_paths = set()

EXIT_SIGTERM = 128 + 15
EXIT_DATA_MISSING = 3

_JUNK_ENTRIES = frozenset(('.gitignore', '.DS_Store'))


def _discard_tmp(tmp):
    """Removes a tracked tmp file (a no-op once it was renamed away)."""
    _live_tmp_paths.discard(tmp)
    try:
        os.unlink(tmp)
    except OSError:
        pass


def cleanup_tmp_files():
    """Removes every tmp file this process created and has not renamed yet."""
    for tmp in list(_live_tmp_paths):
        _discard_tmp(tmp)


def _on_sigterm(_signum, _frame):
    cleanup_tmp_files()
    try:
        sys.stdout.flush()
    except Exception:
        pass
    # os._exit, not SystemExit: the Jira fetch runs in a ThreadPoolExecutor and
    # a SystemExit would wait for every in-flight request before exiting.
    os._exit(EXIT_SIGTERM)


def install_sigterm_handler():
    """Makes SIGTERM remove the tracked tmp files before the process exits."""
    try:
        signal.signal(signal.SIGTERM, _on_sigterm)
    except (ValueError, OSError, AttributeError):
        pass  # not the main thread, or a platform without SIGTERM


def _tracked_mkstemp(directory):
    fd, tmp = tempfile.mkstemp(dir=directory, suffix='.tmp')
    _live_tmp_paths.add(tmp)
    return fd, tmp


def _write_json_atomic(directory, target, payload):
    """tmp + os.replace inside `directory`; the tmp never outlives the call."""
    fd, tmp = _tracked_mkstemp(directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, target)
    finally:
        # After a successful os.replace the tmp name is gone and this only
        # untracks it; on any failure (KeyboardInterrupt included) it removes it.
        _discard_tmp(tmp)


def data_root_populated(root):
    """True when the team data plaintext root exists and holds real files.

    The evening clear-plaintext wipes that tree; a refresh that started before
    the wipe must not write into (or recreate) it afterwards.
    """
    try:
        entries = os.listdir(root)
    except OSError:
        return False
    return any(e not in _JUNK_ENTRIES for e in entries)


def _ensure_dir_no_parents(directory):
    """Creates `directory` itself, never its missing parents: a vanished data
    tree must fail the write, not be rebuilt by it."""
    if not os.path.isdir(directory):
        os.mkdir(directory)


def write_out(path, payload):
    """Writes the ETL's --out file: tmp + os.replace, never a partial file
    on a crash mid-write.
    """
    directory = os.path.dirname(path) or '.'
    _ensure_dir_no_parents(directory)
    _write_json_atomic(directory, path, payload)


def safe_shard_key(name):
    """Return filesystem-safe shard key for a module name."""
    return re.sub(r'[^A-Za-z0-9_-]', '_', (name or '').strip().lower())


def atomic_write_shard(shard_dir, key, payload, *, prefix='module-'):
    """Write a single shard file atomically via a tmp file + os.replace.

    Shard filename: <prefix><key>.json inside shard_dir.
    """
    _ensure_dir_no_parents(shard_dir)
    filepath = os.path.join(shard_dir, f'{prefix}{key}.json')
    _write_json_atomic(shard_dir, filepath, payload)


def _update_shard_index(shard_dir, *, keys_present, meta_overrides, compute_sprint_range=True):
    """Update (or create) index.json inside shard_dir under an exclusive file lock.

    keys_present      -- list/sequence of string shard keys currently in the directory.
    meta_overrides    -- dict merged into index.json['meta'] on top of any existing
                         meta; schema_version, shard_count, last_updated are always
                         set by this function (callers may NOT override them).
    compute_sprint_range -- when True (default), compute sprint_range from int(key).
                         Pass False for non-integer keys (modules, teams, persons) to
                         avoid ValueError on int() conversion.

    On-disk format:
        { "meta": { ...all fields including aggregates... }, "keys": [...] }
    """
    _ensure_dir_no_parents(shard_dir)
    index_path = os.path.join(shard_dir, 'index.json')
    lock_path = index_path + '.lock'

    # Normalise keys to strings for consistent JSON representation.
    str_keys = sorted(str(k) for k in keys_present)

    sprint_range = None
    if compute_sprint_range:
        int_keys = sorted(int(k) for k in str_keys)
        sprint_range = {
            'from': int_keys[0] if int_keys else 0,
            'to': int_keys[-1] if int_keys else 0,
        }
        # Caller-supplied sprint_range wins (it may already reflect merged_sprints).
        caller_range = meta_overrides.get('sprint_range')
        if caller_range:
            sprint_range = caller_range

    lf = open(lock_path, 'w')
    try:
        if _HAS_FCNTL:
            _fcntl.flock(lf, _fcntl.LOCK_EX)
        try:
            with open(index_path, encoding='utf-8') as fh:
                existing = json.load(fh)
        except (FileNotFoundError, json.JSONDecodeError):
            existing = {'meta': {}, 'keys': []}

        existing_meta = existing.get('meta', {})
        new_meta = {
            **existing_meta,
            **meta_overrides,
            'schema_version': 1,
            'shard_count': len(str_keys),
            'last_updated': datetime.now(tz=timezone.utc).isoformat(timespec='seconds'),
        }
        if compute_sprint_range and sprint_range is not None:
            new_meta['sprint_range'] = sprint_range

        index_payload = {'meta': new_meta, 'keys': str_keys}

        _write_json_atomic(shard_dir, index_path, index_payload)
    finally:
        lf.close()  # closing releases fcntl lock automatically
