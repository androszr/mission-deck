"""I/O edge for the prod-bugs ETL - stdlib only (no requests, no dotenv, no .env).

Jira helpers for the prod-bugs ETL, with three edges:
  - jira_get uses urllib.request (JiraHttpError / JiraConnectionError stand in
    for requests' exceptions)
  - load_handoff: the Jira token arrives as ONE JSON line on stdin, never in
    argv or in the environment, and is never logged
  - atomic_write_json: one fixed serialization,
    because more than one writer may share the same remote and the encrypted mirror is
    deterministic in content - a different serialization is a "changed file"
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
    """Carries the HTTP status (stands in for requests.exceptions.HTTPError)."""

    def __init__(self, status_code, message=''):
        super().__init__(message or f'HTTP {status_code}')
        self.status_code = status_code


class JiraConnectionError(Exception):
    """Timeout, DNS, TLS, ... (stands in for requests.exceptions.RequestException)."""


def load_handoff():
    """Reads ONE JSON line from stdin: {token, jira_url, verify_ssl}.

    Cached after the first call. Called lazily (never at import time), so a
    test can import this module without touching stdin. Never printed.
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
    if not isinstance(data, dict):
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
    backoff retry on transient 5xx and connection errors."""
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
            last_exc = JiraHttpError(e.code, str(e))
            # Only transient server errors are worth another try; a 4xx
            # (bad JQL, bad token) answers the same way every time.
            if e.code in RETRY_STATUSES and attempt < retries - 1:
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


def jira_search(jql, fields, batch=100):
    """Paginated /rest/api/2/search returning all matching issues."""
    issues = []
    start = 0
    while True:
        data = jira_get('/rest/api/2/search', {
            'jql': jql,
            'fields': fields,
            'maxResults': batch,
            'startAt': start,
        })
        issues.extend(data.get('issues', []))
        start += len(data.get('issues', []))
        if start >= data.get('total', 0) or not data.get('issues'):
            break
    return issues


def progress(step, total, msg):
    """Emits one @@PROGRESS: line on STDOUT, flushed. The Node side reads both
    streams through the same line splitter."""
    pct = round(step / total * 100) if total > 0 else 0
    payload = json.dumps({'step': step, 'total': total, 'pct': pct, 'msg': msg}, ensure_ascii=False)
    print(f'@@PROGRESS:{payload}', flush=True)


def atomic_write_json(fp, data):
    """Write JSON atomically: tmpfile + os.replace (never write in place).

    Fixed serialization: indent=2,
    ensure_ascii=False, trailing newline. Do NOT change any of it.
    """
    tmp_fp = fp + '.tmp'
    with open(tmp_fp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
    os.replace(tmp_fp, fp)
