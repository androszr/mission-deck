"""Shared I/O edge for the Sprint Stats ETL - stdlib only, no pip, no dotenv.

Three I/O edges:
  - jira_get: urllib.request instead of `requests` (JiraHttpError /
    JiraConnectionError replace requests.exceptions.HTTPError / RequestException)
  - load_handoff: the Jira token arrives as ONE JSON line on stdin, never in
    argv or in the child's environment (never logged either)
  - write_out: the ETL never touches the data repository itself - it writes
    one plain file at the path Node hands it (--out), tmp + os.replace
"""

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

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
    """Reads ONE JSON line from stdin: {token, jira_url, verify_ssl}.

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
    backoff retry on transient 5xx and connection errors - same shape as the
    a `requests`-based jira_get, minus the dependency.
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


# Vendor tags some Jira instances put in front of a contractor's display
# name ("EXT Sam Rivera"); adjust to your organisation.
PREFIXES_TO_STRIP = ('EXT ', 'VND ', 'CTR ')


def strip_prefix(name, *, default=None, prefixes=PREFIXES_TO_STRIP):
    """Strip leading contractor prefixes recursively.

    "EXT VND Sam" -> "Sam" (both prefixes removed regardless of order).
    Returns `default` for falsy input.
    """
    if not name:
        return default
    while True:
        for p in prefixes:
            if name.startswith(p):
                name = name[len(p):]
                break
        else:
            return name


def detect_phase(state, start_date_str, today=None):
    """Sprint phase from (state, start) - shared by both ETL scripts:
    closed -> END, not active -> START, active and at most two days in ->
    START, later -> MID.
    """
    if state == 'closed':
        return 'END'
    if state != 'active':
        return 'START'
    if not start_date_str:
        return 'MID'
    try:
        start = _parse_date_only(start_date_str)
    except Exception:
        start = None
    if start is None:
        return 'MID'
    from datetime import date
    today_d = today if today is not None else date.today()
    days_in = (today_d - start).days
    return 'START' if days_in <= 2 else 'MID'


def _parse_date_only(date_str):
    from datetime import datetime as _dt
    s = str(date_str)[:10]
    return _dt.strptime(s, '%Y-%m-%d').date()


def write_out(path, payload):
    """Writes the ETL's --out file: tmp + os.replace, never a partial file
    on a crash mid-write.
    """
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp = path + '.tmp.' + str(os.getpid())
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
