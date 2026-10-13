#!/usr/bin/env python3
"""Fetch and process sprint stats from Jira for MAIN (Atlas, Borealis, Comet).

Usage: python sprint_stats_main.py --out <file> [--sprints 16,17] [--from N]

Discovery, phase detection, changelog-based burndown reconstruction and the
rapid board report for closed sprints. I/O edges: stdlib urllib
(scripts/_common.py), the Jira token arrives on stdin, and the result is one
team-sprint shaped JSON file at --out - server/store.js on the Node side owns
sprint-stats/, this script never touches the data repository itself.

Sprints on the board are expected to be named "<Team> Sprint <N>".
"""

import argparse
import re
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

from _common import JiraConnectionError, JiraHttpError, jira_get, progress as emit_progress, strip_prefix, write_out

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# ── Configuration - adjust to your Jira board ─────────────────────────────────

BOARD_ID = '1'
PROJECT = 'APP'
TEAMS = ['Atlas', 'Borealis', 'Comet']
FIELD_SP = 'customfield_10008'

ISSUE_FIELDS = f'summary,status,issuetype,{FIELD_SP},assignee'
EXCLUDED_TYPES = 'Sub-task, "Bug sub-task"'
BATCH = 50

SPRINT_RE = re.compile(r'^(.+?)\s+Sprint\s+(\d+)$', re.IGNORECASE)
CANCELLED_NAMES = {'cancelled', 'canceled', 'rejected', "won't do"}

# Status label -> the closed status_bucket vocabulary of the team-sprint
# shape (server/normalize.js STATUS_BUCKET_IDS).
STATUS_BUCKET = {'Done': 'done', 'WIP': 'wip', 'Todo': 'todo', 'Spillover': 'dropped'}

# ── Args ─────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(description='Fetch sprint stats from Jira (MAIN)')
parser.add_argument('--from', dest='sprint_from', type=int, default=1,
                    help='Start from sprint number (default: 1)')
parser.add_argument('--sprints', dest='sprints', type=str, default=None,
                    help='Comma-separated sprint numbers to process (e.g. 6,7)')
parser.add_argument('--out', dest='out', type=str, default=None,
                    help='Where to write the team-sprint shaped result (required to run main())')
if __name__ == '__main__':
    args = parser.parse_args()
else:
    # Importing this module (discover_sprints.py) must never require --out -
    # only main() (never called on the import path) needs it.
    args = parser.parse_args([])

SPRINT_START_N = args.sprint_from
SELECTED_SPRINTS = set(int(x) for x in args.sprints.split(',')) if args.sprints else None

# ── Sprint discovery ─────────────────────────────────────────────────────────


def discover_all_sprints():
    """Fetch ALL sprints from the board and organize by team + number.

    Returns (sprint_map, board_active_sprint_n) where:
      sprint_map: dict sprint_n -> {team_name -> sprint_meta_dict}
      board_active_sprint_n: highest n across all teams with state == 'active',
                             computed from the FULL board (not only from SPRINT_START_N)
    """
    print('Fetching the sprint list from the board...', flush=True)
    all_sprints = []
    start = 0
    while True:
        data = jira_get(f'/rest/agile/1.0/board/{BOARD_ID}/sprint', {
            'startAt': start, 'maxResults': 50,
        })
        batch = data.get('values', [])
        all_sprints.extend(batch)
        if data.get('isLast', True) or not batch:
            break
        start += len(batch)

    print(f'  Found {len(all_sprints)} sprints on the board', flush=True)

    # Organize: sprint_n -> {team -> meta}
    sprint_map = defaultdict(dict)
    board_active_n = None
    for s in all_sprints:
        m = SPRINT_RE.match(s.get('name', ''))
        if not m:
            continue
        team_name = m.group(1).strip()
        sprint_n = int(m.group(2))

        if team_name not in TEAMS:
            continue

        # Track board-wide active sprint independently of SPRINT_START_N so
        # that --merge runs preserve a correct active_sprint_n even when the
        # processed slice does not include the active one.
        if s.get('state') == 'active':
            if board_active_n is None or sprint_n > board_active_n:
                board_active_n = sprint_n

        if sprint_n < SPRINT_START_N:
            continue
        if s.get('state') == 'future':
            continue

        sprint_map[sprint_n][team_name] = {
            'id': s['id'],
            'name': s.get('name', ''),
            'state': s.get('state', ''),
            'startDate': s.get('startDate', ''),
            'endDate': s.get('endDate', ''),
            'completeDate': s.get('completeDate', ''),
            'goal': s.get('goal', ''),
        }

    return dict(sprint_map), board_active_n


# ── Phase detection ──────────────────────────────────────────────────────────


def parse_date(date_str):
    """Parse Jira date string to date object. Returns None on failure."""
    if not date_str:
        return None
    for fmt in ('%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d'):
        try:
            return datetime.strptime(date_str[:26].rstrip('Z'), fmt).date()
        except ValueError:
            continue
    try:
        return datetime.strptime(date_str[:10], '%Y-%m-%d').date()
    except ValueError:
        return None


def detect_phase(sprint_meta):
    """Detect sprint phase from any team's metadata.

    Returns 'END', 'MID', or 'START'.
    """
    # Take first team's metadata
    meta = next(iter(sprint_meta.values()))
    state = meta.get('state', '')

    if state == 'closed':
        return 'END'

    if state == 'active':
        start = parse_date(meta.get('startDate', ''))
        today = datetime.today().date()
        if start:
            days_in = (today - start).days
            if days_in <= 2:
                return 'START'
        return 'MID'

    return 'START'


# ── Issue fetching ───────────────────────────────────────────────────────────


def fetch_issues_for_sprint(sprint_name):
    """Fetch all issues for a sprint with changelogs.

    Deduplicated by key — sorting by a mutable field can yield the same
    issue twice at a page boundary.
    """
    issues = []
    seen_keys = set()
    start = 0
    jql = (
        f'project = {PROJECT} AND sprint = "{sprint_name}" '
        f'AND issuetype NOT IN ({EXCLUDED_TYPES}) '
        f'ORDER BY key ASC'
    )
    while True:
        data = jira_get('/rest/api/2/search', {
            'jql': jql,
            'fields': ISSUE_FIELDS,
            'expand': 'changelog',
            'maxResults': BATCH,
            'startAt': start,
        })
        batch = data.get('issues', [])
        for i in batch:
            k = i.get('key')
            if k and k not in seen_keys:
                seen_keys.add(k)
                issues.append(i)
        total = data.get('total', 0)
        start += len(batch)
        if start >= total or not batch:
            break
    return issues


def fetch_worklogs(issue_key):
    """Fetch all worklogs for an issue."""
    try:
        data = jira_get(f'/rest/api/2/issue/{issue_key}/worklog')
        return data.get('worklogs', [])
    except Exception as e:
        print(f'  Warn: worklogs {issue_key}: {e}', file=sys.stderr)
        return []


def fetch_issue_changelog(issue_key):
    """Fetch normalized changelog entries for a single issue.

    Used for rapid-board-sourced issues (sprint report API omits
    changelog). Returns list of {created, field, from_string, to_string}
    entries, matching the envelope shape built by normalize_issue.
    """
    try:
        data = jira_get(f'/rest/api/2/issue/{issue_key}', {'expand': 'changelog'})
    except Exception as e:
        print(f'  Warn: changelog {issue_key}: {e}', file=sys.stderr)
        return []
    out = []
    for entry in (data.get('changelog') or {}).get('histories', []) or []:
        created = entry.get('created', '')
        for item in entry.get('items', []) or []:
            out.append({
                'created': created,
                'field': item.get('field', ''),
                'from_string': item.get('fromString'),
                'to_string': item.get('toString'),
            })
    return out


def fetch_punted_issues(sprint_id):
    """Fetch issues removed from sprint (spillover) via sprint report API."""
    try:
        data = jira_get('/rest/greenhopper/1.0/rapid/charts/sprintreport', {
            'rapidViewId': BOARD_ID,
            'sprintId': sprint_id,
        })
        return data.get('contents', {}).get('puntedIssues', [])
    except Exception as e:
        print(f'  Warn: punted issues: {e}', file=sys.stderr)
        return []


def fetch_sprint_report(sprint_id):
    """Fetch full sprint report contents from Jira rapid board API.

    Returns dict with completedIssues / issuesNotCompletedInCurrentSprint /
    puntedIssues / issueKeysAddedDuringSprint, or None on failure.
    """
    try:
        data = jira_get('/rest/greenhopper/1.0/rapid/charts/sprintreport', {
            'rapidViewId': BOARD_ID,
            'sprintId': sprint_id,
        })
        return data.get('contents') or {}
    except Exception as e:
        print(f'  Warn: sprint report: {e}', file=sys.stderr)
        return None


def _rapid_sp(raw):
    for stat_key in ('currentEstimateStatistic', 'estimateStatistic'):
        stat = raw.get(stat_key) or {}
        val = (stat.get('statFieldValue') or {}).get('value')
        if val is not None:
            try:
                return max(0.0, float(val))
            except (ValueError, TypeError):
                pass
    return 0.0


def _rapid_assignee(raw):
    a = raw.get('assignee') or raw.get('assigneeName')
    if isinstance(a, dict):
        name = a.get('displayName') or a.get('name', '')
        return {'displayName': name, 'display_name': name}
    if isinstance(a, str) and a:
        return {'displayName': a, 'display_name': a}
    return None


def _normalize_rapid_issue(raw, status_name, status_category, removed, added_keys):
    """Build an envelope-compatible issue from a rapid sprint-report item."""
    return {
        'key': raw.get('key', '?'),
        'summary': raw.get('summary', ''),
        'status': {'name': status_name, 'category': status_category},
        'issuetype': {'name': raw.get('typeName', 'Task')},
        FIELD_SP: _rapid_sp(raw),
        'assignee': _rapid_assignee(raw),
        'changelogs': [],
        'worklogs': [],
        'removed_from_sprint': removed,
        '_rapid_added': raw.get('key') in added_keys,
        '_from_rapid': True,
    }


def fetch_team_data_from_rapid(sprint_meta):
    """Build a team's issue list from the rapid sprint report (closed sprints).

    Augments with worklogs and changelogs — rapid report omits both, and
    the burndown reconstruction walks the changelog back in time.
    Returns list of envelope-format issues, or None if the report could
    not be fetched.
    """
    report = fetch_sprint_report(sprint_meta['id'])
    if not report:
        return None

    added_keys = set(report.get('issueKeysAddedDuringSprint') or {})
    issues = []
    for raw in report.get('completedIssues') or []:
        issues.append(_normalize_rapid_issue(raw, 'Closed', 'Done', False, added_keys))
    for raw in report.get('issuesNotCompletedInCurrentSprint') or []:
        # Rapid only tells us "not completed" — we do not know WIP vs Todo
        # without status detail. Use the raw status if provided, else Todo.
        status_raw = raw.get('status') or {}
        s_name = status_raw.get('name', 'Otwarte') if isinstance(status_raw, dict) else 'Otwarte'
        # Closed sprint: anything left in it is "not completed in sprint".
        # Map the current status best-effort to Todo/WIP category.
        category = 'To Do'
        issues.append(_normalize_rapid_issue(raw, s_name, category, False, added_keys))
    for raw in report.get('puntedIssues') or []:
        issues.append(_normalize_rapid_issue(raw, 'Spillover', 'Done', True, added_keys))

    # Attach worklogs and changelogs per issue, in parallel.
    # Worklogs feed person-days; changelogs feed the burndown's historical
    # reconstruction (SP / status / sprint-membership over time).
    def _fetch_all(key):
        return key, fetch_worklogs(key), fetch_issue_changelog(key)

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(_fetch_all, i['key']): i for i in issues}
        for future in as_completed(futures):
            issue = futures[future]
            _, worklogs, changelogs = future.result()
            for wl in worklogs or []:
                author = wl.get('author') or {}
                issue['worklogs'].append({
                    'started': wl.get('started', ''),
                    'timeSpentSeconds': wl.get('timeSpentSeconds', 0),
                    'author': {
                        'displayName': author.get('displayName') or author.get('name', ''),
                        'display_name': author.get('displayName') or author.get('name', ''),
                    },
                })
            issue['changelogs'] = changelogs or []

    return issues


def normalize_issue(raw, worklogs):
    """Flatten a Jira REST issue into envelope format."""
    f = raw['fields']

    def person(field):
        if not field:
            return None
        return {
            'displayName': field.get('displayName') or field.get('name', ''),
            'display_name': field.get('displayName') or field.get('name', ''),
            'name': field.get('name', ''),
        }

    sp = f.get(FIELD_SP)
    if isinstance(sp, dict):
        sp = sp.get('value')

    status_raw = f.get('status') or {}
    status = {
        'name': status_raw.get('name', ''),
        'category': (status_raw.get('statusCategory') or {}).get('name', ''),
    }

    issuetype_raw = f.get('issuetype') or {}

    changelogs = []
    for entry in raw.get('changelog', {}).get('histories', []):
        for item in entry.get('items', []):
            changelogs.append({
                'created': entry.get('created', ''),
                'field': item.get('field', ''),
                'from_string': item.get('fromString'),
                'to_string': item.get('toString'),
            })

    normalized_worklogs = []
    for wl in worklogs:
        author = wl.get('author') or {}
        normalized_worklogs.append({
            'started': wl.get('started', ''),
            'timeSpentSeconds': wl.get('timeSpentSeconds', 0),
            'author': {
                'displayName': author.get('displayName') or author.get('name', ''),
                'display_name': author.get('displayName') or author.get('name', ''),
            },
        })

    return {
        'key': raw['key'],
        'summary': f.get('summary', ''),
        'status': status,
        'issuetype': {'name': issuetype_raw.get('name', '')},
        FIELD_SP: sp,
        'assignee': person(f.get('assignee')),
        'changelogs': changelogs,
        'worklogs': normalized_worklogs,
    }


def normalize_punted_issue(punted_raw):
    """Normalize a puntedIssue from sprint report into envelope format."""
    sp = None
    for stat_key in ('currentEstimateStatistic', 'estimateStatistic'):
        stat = punted_raw.get(stat_key) or {}
        val = (stat.get('statFieldValue') or {}).get('value')
        if val is not None:
            try:
                sp = float(val)
            except (ValueError, TypeError):
                pass
            break

    assignee_raw = punted_raw.get('assignee') or punted_raw.get('assigneeName')
    assignee = None
    if isinstance(assignee_raw, dict):
        name = assignee_raw.get('displayName') or assignee_raw.get('name', '')
        assignee = {'displayName': name, 'display_name': name}
    elif isinstance(assignee_raw, str):
        assignee = {'displayName': assignee_raw, 'display_name': assignee_raw}

    return {
        'key': punted_raw.get('key', '?'),
        'summary': punted_raw.get('summary', ''),
        'status': {'name': 'Spillover', 'category': 'Done'},
        'issuetype': {'name': punted_raw.get('typeName', 'Task')},
        FIELD_SP: sp,
        'assignee': assignee,
        'changelogs': [],
        'worklogs': [],
        'removed_from_sprint': True,
    }


# ── Classification helpers ───────────────────────────────────────────────────


def get_sp(issue):
    v = issue.get(FIELD_SP)
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return int(v) if v > 0 else 0
    if isinstance(v, dict):
        val = v.get('value', 0)
        return int(val) if val and val > 0 else 0
    try:
        return int(float(str(v)))
    except (ValueError, TypeError):
        return 0


def get_assignee(issue):
    a = issue.get('assignee')
    if not a:
        return None
    if isinstance(a, str):
        return strip_prefix(a)
    name = a.get('displayName') or a.get('display_name')
    return strip_prefix(name) if name else None


def get_assignee_at_sprint_start(issue, sprint_start_date):
    """Returns the assignee at sprint start by rewinding post-start reassignments."""
    if not sprint_start_date:
        return get_assignee(issue)

    post_start_changes = []
    for cl in issue.get('changelogs', []):
        if cl.get('field', '').lower() != 'assignee':
            continue
        cl_date = parse_date(cl.get('created', ''))
        if cl_date and cl_date > sprint_start_date:
            post_start_changes.append((cl_date, cl))

    if post_start_changes:
        post_start_changes.sort(key=lambda x: x[0])
        from_name = post_start_changes[0][1].get('from_string')
        return strip_prefix(from_name) if from_name else None

    return get_assignee(issue)


def classify_status(issue):
    """Returns one of: Done, Spillover, WIP, Todo."""
    status = issue.get('status') or {}
    name = status.get('name', '').lower()
    category = status.get('category', '').lower()

    if name in CANCELLED_NAMES:
        return 'Spillover'
    if category == 'done':
        return 'Done'
    if 'in progress' in category:
        return 'WIP'
    return 'Todo'


def is_added_scope(issue, sprint_name, sprint_start_date):
    """Issue is added scope if sprint was added to it after (sprint_start + 1 day)."""
    # Rapid-board-sourced issues carry an explicit flag (no changelog data).
    if '_rapid_added' in issue:
        return bool(issue['_rapid_added'])
    if not sprint_start_date:
        return False
    cutoff = sprint_start_date + timedelta(days=1)
    sprint_name_lower = sprint_name.lower()

    for cl in issue.get('changelogs', []):
        if cl.get('field', '').lower() != 'sprint':
            continue
        to_str = (cl.get('to_string') or '').lower()
        if sprint_name_lower not in to_str:
            continue
        created_date = parse_date(cl.get('created', ''))
        if created_date and created_date >= cutoff:
            return True
    return False


def compute_person_days(issues, sprint_start_date, sprint_end_date):
    """Returns dict: person -> count of days with >=1h logged in sprint window."""
    person_day_sec = defaultdict(lambda: defaultdict(int))

    for issue in issues:
        for wl in issue.get('worklogs', []):
            started = wl.get('started', '')
            if not started:
                continue
            wl_date = parse_date(started)
            if not wl_date:
                continue
            if sprint_start_date and wl_date < sprint_start_date:
                continue
            if sprint_end_date and wl_date > sprint_end_date:
                continue

            author = wl.get('author') or {}
            person = author.get('displayName') or author.get('display_name', '')
            person = strip_prefix(person) or person

            secs = wl.get('timeSpentSeconds', 0)
            person_day_sec[person][str(wl_date)] += secs

    return {
        person: sum(1 for s in days.values() if s >= 3600)
        for person, days in person_day_sec.items()
    }


def completion_pct(done, committed):
    if not committed:
        return 0
    return round(done / committed * 100)


# ── Burndown reconstruction ──────────────────────────────────────────────────

DONE_NAMES_LOWER = {
    'done', 'closed', 'resolved', 'finished', 'completed',
}


def parse_datetime_tz(date_str):
    """Parse Jira datetime with timezone offset. Returns naive-local or tz-aware datetime."""
    if not date_str:
        return None
    for fmt in ('%Y-%m-%dT%H:%M:%S.%f%z', '%Y-%m-%dT%H:%M:%S%z'):
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    for fmt in ('%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S'):
        try:
            return datetime.strptime(date_str.rstrip('Z'), fmt)
        except ValueError:
            continue
    return None


def business_days_between(start_date, end_date):
    """List of Mon-Fri dates in [start, end] inclusive."""
    days = []
    d = start_date
    while d <= end_date:
        if d.weekday() < 5:
            days.append(d)
        d += timedelta(days=1)
    return days


def _parse_sp_from_changelog(val):
    if val is None or val == '':
        return 0
    try:
        v = float(str(val).replace(',', '.'))
        return int(v) if v > 0 else 0
    except (ValueError, TypeError):
        return 0


def _is_done_or_cancelled(name):
    n = (name or '').strip().lower()
    return n in DONE_NAMES_LOWER or n in CANCELLED_NAMES


def reconstruct_issue_state(issue, target_date, sprint_name):
    """Returns (sp, is_done_or_cancelled, in_sprint) at end of target_date.

    Rewinds changelog entries that happened after target_date back to
    recover historical state from the current state.
    """
    sp = get_sp(issue)
    status_cat = classify_status(issue)
    is_final = status_cat in ('Done', 'Spillover')
    in_sprint = not issue.get('removed_from_sprint', False)

    sprint_name_lower = sprint_name.lower()

    events = []
    for cl in issue.get('changelogs', []):
        cl_dt = parse_datetime_tz(cl.get('created', ''))
        if cl_dt and cl_dt.date() > target_date:
            events.append((cl_dt, cl))
    events.sort(key=lambda x: x[0], reverse=True)

    for _, cl in events:
        field = (cl.get('field') or '').lower()
        if field in ('story points', 'customfield_10008'):
            sp = _parse_sp_from_changelog(cl.get('from_string'))
        elif field == 'status':
            is_final = _is_done_or_cancelled(cl.get('from_string'))
        elif field == 'sprint':
            from_list = (cl.get('from_string') or '').lower()
            in_sprint = sprint_name_lower in from_list

    return sp, is_final, in_sprint


def compute_burndown(issues, sprint_start_date, sprint_end_date, sprint_name):
    """Daily SP-remaining series over business days of the sprint window.

    For active sprints the series stops at today (no projection into the future).
    Punted issues (removed_from_sprint=True) are skipped — removal date is unknown.
    """
    if not sprint_start_date or not sprint_end_date:
        return []

    series = []
    today = datetime.today().date()
    days = business_days_between(sprint_start_date, sprint_end_date)

    for idx, day in enumerate(days):
        if day > today:
            break
        remaining = 0
        for issue in issues:
            if issue.get('removed_from_sprint'):
                continue
            sp, is_final, in_sprint = reconstruct_issue_state(issue, day, sprint_name)
            if in_sprint and not is_final:
                remaining += sp
        series.append({
            'day_n': idx,
            'date': str(day),
            'remaining_sp': remaining,
        })

    return series


# ── Process a team's issues ─────────────────────────────────────────────────


def process_team(team_name, sprint_name, sprint_start_str, sprint_end_str,
                 issues, phase):
    """Classify issues, compute summaries and per-person breakdown.

    Returns (team_summary_dict, person_list, team_issues_list).
    """
    sprint_start_date = parse_date(sprint_start_str)
    sprint_end_date = parse_date(sprint_end_str)

    committed_sp = 0
    done_sp = wip_sp = todo_sp = spillover_sp = added_scope_sp = 0
    total_issues = 0

    for issue in issues:
        sp = get_sp(issue)
        removed = issue.get('removed_from_sprint', False)

        if removed:
            spillover_sp += sp
            total_issues += 1
            continue

        status = classify_status(issue)
        added = is_added_scope(issue, sprint_name, sprint_start_date)

        # committed = full sprint scope at this moment (initial + added, minus
        # punted) — aligns with Jira rapid board's "Committed" definition.
        # added_scope_sp is kept as an informational sub-breakdown.
        committed_sp += sp
        if added:
            added_scope_sp += sp

        if status == 'Done':
            done_sp += sp
        elif status == 'Spillover':
            spillover_sp += sp
        elif status == 'WIP':
            wip_sp += sp
        else:
            todo_sp += sp

        total_issues += 1

    # Per-person breakdown
    person_days = compute_person_days(issues, sprint_start_date, sprint_end_date)

    # Jira changelogs may store from_string as a username/email instead of
    # display name. Build a lookup to normalize those back to display names.
    user_to_display = {}
    for issue in issues:
        a = issue.get('assignee') or {}
        uname = a.get('name', '')
        dname = a.get('displayName') or a.get('display_name', '')
        if uname and dname and uname != dname:
            user_to_display[uname] = strip_prefix(dname) or dname

    person_issues_map = defaultdict(list)
    for issue in issues:
        key = get_assignee_at_sprint_start(issue, sprint_start_date) or '(unassigned)'
        key = user_to_display.get(key, key)
        person_issues_map[key].append(issue)

    persons = []
    for person, p_issues in sorted(person_issues_map.items()):
        # committed = full scope (initial + added) at sprint level; aligned
        # with Jira rapid. p_added below is an informational sub-bucket.
        p_committed = sum(
            get_sp(i) for i in p_issues
            if not i.get('removed_from_sprint')
        )
        p_done = sum(
            get_sp(i) for i in p_issues
            if not i.get('removed_from_sprint') and classify_status(i) == 'Done'
        )
        p_wip = sum(
            get_sp(i) for i in p_issues
            if not i.get('removed_from_sprint') and classify_status(i) == 'WIP'
        )
        p_todo = sum(
            get_sp(i) for i in p_issues
            if not i.get('removed_from_sprint') and classify_status(i) == 'Todo'
        )
        if phase == 'END':
            p_spillover = sum(
                get_sp(i) for i in p_issues
                if i.get('removed_from_sprint')
                or classify_status(i) in ('Spillover', 'Todo', 'WIP')
            )
        else:
            p_spillover = sum(
                get_sp(i) for i in p_issues
                if i.get('removed_from_sprint') or classify_status(i) == 'Spillover'
            )
        p_added = sum(
            get_sp(i) for i in p_issues
            if is_added_scope(i, sprint_name, sprint_start_date)
        )
        p_days = person_days.get(person, 0)

        persons.append({
            'name': person,
            'committed': p_committed,
            'done': p_done,
            'wip': p_wip,
            'todo': p_todo,
            'spillover': p_spillover,
            'added': p_added,
            'days_with_work': p_days,
            'completion_pct': completion_pct(p_done, p_committed),
        })

    # Build flat team-level issue list
    team_issues = []
    for issue in issues:
        i_sp = get_sp(issue)
        i_removed = issue.get('removed_from_sprint', False)
        if i_removed:
            i_status = 'Spillover'
        else:
            i_status = classify_status(issue)
        assignee = issue.get('assignee') or {}
        team_issues.append({
            'key': issue.get('key', ''),
            'summary': issue.get('summary', ''),
            'sp': i_sp,
            'status': i_status,
            'type': (issue.get('issuetype') or {}).get('name', ''),
            'assignee': assignee.get('displayName') or assignee.get('display_name', ''),
        })

    summary = {
        'committed_sp': committed_sp,
        'done_sp': done_sp,
        'wip_sp': wip_sp,
        'todo_sp': todo_sp,
        'spillover_sp': spillover_sp,
        'added_scope_sp': added_scope_sp,
        'total_issues': total_issues,
        'completion_pct': completion_pct(done_sp, committed_sp),
    }

    burndown = compute_burndown(issues, sprint_start_date, sprint_end_date, sprint_name)

    return summary, persons, team_issues, burndown


# ── Fetch team data ──────────────────────────────────────────────────────────


def fetch_team_data(team_name, sprint_meta):
    """Fetch issues + worklogs for one team's sprint. Returns normalized issues list.

    Closed sprints use Jira's rapid board sprint report (authoritative frozen
    snapshot). Active/future sprints use JQL+changelog (current state).
    """
    sprint_name = sprint_meta['name']
    sprint_id = sprint_meta['id']

    if sprint_meta.get('state') == 'closed':
        rapid_issues = fetch_team_data_from_rapid(sprint_meta)
        if rapid_issues is not None:
            return rapid_issues
        print(f'  [{team_name}] rapid report unavailable - falling back to JQL', flush=True)

    raw_issues = fetch_issues_for_sprint(sprint_name)

    # Fetch worklogs in parallel
    worklogs_map = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(fetch_worklogs, i['key']): i['key'] for i in raw_issues}
        for future in as_completed(futures):
            key = futures[future]
            worklogs_map[key] = future.result()

    normalized = [normalize_issue(i, worklogs_map.get(i['key'], [])) for i in raw_issues]

    # Fetch punted issues (spillover)
    punted_raw = fetch_punted_issues(sprint_id)
    punted = [normalize_punted_issue(p) for p in punted_raw]
    normalized.extend(punted)

    return normalized


# ── Main orchestration ───────────────────────────────────────────────────────


def main():
    emit_progress(1, 3, 'Fetching the sprint list from the board...')
    sprint_map, board_active_n = discover_all_sprints()

    if not sprint_map:
        print('Error: no sprints found on the board.', file=sys.stderr)
        sys.exit(1)

    # Filter to selected sprints if --sprints given
    if SELECTED_SPRINTS:
        sprint_map = {n: v for n, v in sprint_map.items() if n in SELECTED_SPRINTS}
        if not sprint_map:
            print(f'Error: none of the selected sprints ({SELECTED_SPRINTS}) was found on the board.',
                  file=sys.stderr)
            sys.exit(1)

    sprint_numbers = sorted(sprint_map.keys())
    print(f'\nSprints to process: {sprint_numbers}', flush=True)

    # Calculate total steps for progress: 1 (discover) + team_fetches + 1 (save)
    team_fetch_count = sum(
        sum(1 for t in TEAMS if t in sprint_map[n]) for n in sprint_numbers
    )
    total_steps = 1 + team_fetch_count + 1
    current_step = 1

    active_sprint_n = None
    sprints_output = []

    for sprint_n in sprint_numbers:
        teams_meta = sprint_map[sprint_n]
        phase = detect_phase(teams_meta)

        # Track active sprint
        first_meta = next(iter(teams_meta.values()))
        if first_meta.get('state') == 'active':
            active_sprint_n = sprint_n

        print(f'\n--- Sprint {sprint_n} ({phase}) ---', flush=True)

        teams_data = []
        for team_name in TEAMS:
            if team_name not in teams_meta:
                print(f'  [{team_name}] no sprint - skipping', flush=True)
                continue

            meta = teams_meta[team_name]
            current_step += 1
            emit_progress(current_step, total_steps, f'Sprint {sprint_n} - {team_name}: fetching issues...')
            print(f'  [{team_name}] Fetching {meta["name"]}...', flush=True)

            # Isolate transient Jira errors per-team so one bad sprint does
            # not abort a 20-sprint global refresh. Older sprints occasionally
            # return 500 from /rest/api/2/search.
            try:
                issues = fetch_team_data(team_name, meta)
            except JiraHttpError as e:
                print(f'  [{team_name}] HTTP ERROR {e.status_code} - skipping {meta["name"]}', flush=True)
                continue
            except JiraConnectionError as e:
                print(f'  [{team_name}] Connection error - skipping {meta["name"]}: {e}', flush=True)
                continue
            print(f'  [{team_name}] {len(issues)} issues', flush=True)

            sprint_end = meta.get('completeDate') or meta.get('endDate', '')

            summary, persons, team_issues, burndown = process_team(
                team_name, meta['name'],
                meta.get('startDate', ''), sprint_end,
                issues, phase,
            )

            teams_data.append({
                'team': team_name,
                'sprint_id': meta.get('id'),
                'sprint_name': meta['name'],
                'sprint_start': meta.get('startDate', ''),
                'sprint_end': sprint_end,
                'state': meta.get('state', ''),
                'goal': meta.get('goal', ''),
                'summary': summary,
                'persons': persons,
                'issues': team_issues,
                'burndown': burndown,
            })

        # Compute cross-team totals
        totals = {
            'committed_sp': sum(t['summary']['committed_sp'] for t in teams_data),
            'done_sp': sum(t['summary']['done_sp'] for t in teams_data),
            'wip_sp': sum(t['summary']['wip_sp'] for t in teams_data),
            'todo_sp': sum(t['summary']['todo_sp'] for t in teams_data),
            'spillover_sp': sum(t['summary']['spillover_sp'] for t in teams_data),
            'added_scope_sp': sum(t['summary']['added_scope_sp'] for t in teams_data),
            'total_issues': sum(t['summary']['total_issues'] for t in teams_data),
        }
        total_committed = totals['committed_sp']
        total_done = totals['done_sp']
        totals['completion_pct'] = completion_pct(total_done, total_committed)

        sprints_output.append({
            'sprint_n': sprint_n,
            'phase': phase,
            'teams': teams_data,
            'totals': totals,
        })

        print(
            f'  SUMA: committed={totals["committed_sp"]} done={totals["done_sp"]} '
            f'spillover={totals["spillover_sp"]} completion={totals["completion_pct"]}%',
            flush=True,
        )

    # No merge, no shards, no monolith here - Node's server/store.js owns
    # sprint-stats/ and merges this run's sprints into it by (src, sprint_n).
    # This script's only job is to shape THIS run's result as team-sprint.
    emit_progress(total_steps, total_steps, 'Writing the result...')

    # Board-wide active sprint, not the slice's own - so a --sprints run over
    # an older sprint does not report "no active sprint".
    effective_active_n = board_active_n if board_active_n is not None else active_sprint_n

    sprints_for_out = []
    for s in sprints_output:
        team_sprints = []
        for t in s['teams']:
            summary = t['summary']
            team_sprints.append({
                'src': 'main',
                'team': t['team'],
                'unit': 'SP',
                'sprint_n': s['sprint_n'],
                'sprint_id': t['sprint_id'],
                'sprint_name': t['sprint_name'],
                'state': t['state'],
                'phase': s['phase'],
                'start': t['sprint_start'],
                'end': t['sprint_end'],
                'goal': t.get('goal', ''),
                'summary': {
                    'committed': summary['committed_sp'],
                    'done': summary['done_sp'],
                    'wip': summary['wip_sp'],
                    'todo': summary['todo_sp'],
                    'dropped': summary['spillover_sp'],
                    'added': summary['added_scope_sp'],
                    'total_issues': summary['total_issues'],
                    'completion_pct': summary['completion_pct'],
                },
                'persons': [
                    {
                        'name': p['name'],
                        'committed': p['committed'],
                        'done': p['done'],
                        'wip': p['wip'],
                        'todo': p['todo'],
                        'dropped': p['spillover'],
                        'added': p['added'],
                        'completion_pct': p['completion_pct'],
                        'days_with_work': p['days_with_work'],
                    }
                    for p in t['persons']
                ],
                'issues': [
                    {
                        'key': i['key'],
                        'summary': i['summary'],
                        'type': i['type'],
                        'assignee': i['assignee'],
                        'status_bucket': STATUS_BUCKET.get(i['status'], 'todo'),
                        'status_label': i['status'],
                        'estimate': i['sp'],
                        'spent_h': None,
                    }
                    for i in t['issues']
                ],
                'burndown': [
                    {'day_n': b['day_n'], 'date': b['date'], 'remaining': b['remaining_sp']}
                    for b in t['burndown']
                ],
                'extra': {},
            })
        sprints_for_out.append({'sprint_n': s['sprint_n'], 'phase': s['phase'], 'teams': team_sprints})

    board = {
        'board_id': BOARD_ID,
        'project': PROJECT,
        'teams': TEAMS,
        'active_sprint_n': effective_active_n,
        'generated_at': datetime.now().isoformat(timespec='seconds'),
    }

    if not args.out:
        print('Error: --out is missing.', file=sys.stderr)
        sys.exit(2)
    write_out(args.out, {'src': 'main', 'board': board, 'sprints': sprints_for_out})

    print(f'\nDone. Written: {args.out}')
    print(f'Sprints: {len(sprints_for_out)} | Active sprint: {effective_active_n}')


if __name__ == '__main__':
    main()
