#!/usr/bin/env python3
"""Fetch and process sprint stats from Jira for PLATFORM (team "Delta").

Usage: python sprint_stats_platform.py --out <file> [--sprint-ids 9024,9023]

PLATFORM differs from MAIN:
  - single team (no team field populated)
  - estimates in man-days via a custom 'Estimate [MD]' field (FIELD_MD), not Story Points
  - native Jira time tracking (timeoriginalestimate / timespent) is the second
    estimation axis with low coverage
  - sprint names follow 'PL_N: dd.mm-dd.mm.yyyy' (or older 'PL N ...')

I/O edges as in sprint_stats_main.py (stdlib urllib, token on stdin, one
JSON file at --out).
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta

from _common import detect_phase, jira_get, progress as emit_progress, write_out

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# ── PLATFORM-specific configuration ────────────────────────────────────────────

BOARD_ID = '2'              # the platform team's scrum board
PROJECT = 'PLAT'
FIELD_MD = 'customfield_10100'   # Estimate [MD]
FIELD_EPIC = 'customfield_10001'  # Epic Link

ISSUE_FIELDS = (
    'summary,status,assignee,issuetype,priority,parent,'
    f'{FIELD_MD},{FIELD_EPIC},timeoriginalestimate,timespent'
)

DONE_STATUSES = {'Done', 'Closed', 'Resolved'}
WIP_STATUSES = {'In Progress', 'Code Review', 'QA', 'In Testing'}
CANCELLED_STATUSES = {'Cancelled', 'Canceled', 'Rejected', "Won't Do"}
BUG_TYPES = {'Bug', 'Production bug'}

# Strict numeric naming — extracts sprint number from 'PL_8' or 'Delta Sprint 12'.
SPRINT_NUM_RE = re.compile(r'^(?:PL_|Delta\s+Sprint\s+)(\d+)\b', re.IGNORECASE)
# Loose match — accepts 'PL_<n>', 'PL <date-range>', and 'Delta Sprint <n>'.
SPRINT_LOOSE_RE = re.compile(r'^PL[\s_]|^Delta\s+Sprint\b', re.IGNORECASE)

# Default scope: every sprint that ended in YEAR_FILTER or later - tighter
# than a board's full history, but loose enough to include date-named
# sprints (PL 9-..., PL 12.12.2025-...) at the start of the year.
YEAR_FILTER = 2026

# ── Args ─────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(description='Fetch PLATFORM sprint stats from Jira')
parser.add_argument('--sprint-ids', dest='sprint_ids', type=str, default=None,
                    help='Comma-separated Jira sprint IDs to refresh (default: all 2026)')
parser.add_argument('--out', dest='out', type=str, default=None,
                    help='Where to write the team-sprint shaped result (required to run main())')
if __name__ == '__main__':
    args = parser.parse_args()
else:
    # Importing this module (discover_sprints.py) must never require --out -
    # only main() (never called on the import path) needs it.
    args = parser.parse_args([])

SELECTED_SPRINT_IDS = (
    set(int(x) for x in args.sprint_ids.split(',') if x.strip())
    if args.sprint_ids else None
)

# ── Sprint discovery ─────────────────────────────────────────────────────────

def short_label(name):
    """Display label for a sprint name.

    'PL_8: 17.04-08.05.2026' → 'PL_8'
    'PL 9-23.01.2026'        → 'PL 9-23.01'  (no proper number, keep dates)
    """
    if not name:
        return ''
    m = SPRINT_NUM_RE.match(name)
    if m:
        return f'PL_{m.group(1)}'
    # Trim trailing year if present, leave the rest readable
    return name.replace('.2026', '').replace('.2025', '').strip()


def discover_sprints(include_future=False):
    """Return all PL-prefixed sprints from board, sorted by startDate desc.

    Filters to YEAR_FILTER (sprints whose endDate is in YEAR_FILTER or later).
    Sprints with strict 'PL_<n>' naming get sprint_n=<n>; date-only names get
    synthetic decreasing numbers (PL_2 → 2, sprint before it → 1, then 0, ...)
    so the trend chart still has a stable order key.
    """
    print('Fetching the sprint list from the PLATFORM board...', flush=True)
    sprints = []
    start = 0
    while True:
        data = jira_get(f'/rest/agile/1.0/board/{BOARD_ID}/sprint',
                        {'startAt': start, 'maxResults': 50})
        batch = data.get('values', [])
        sprints.extend(batch)
        if data.get('isLast', True) or not batch:
            break
        start += len(batch)

    matched = []
    for s in sprints:
        name = s.get('name', '')
        if not SPRINT_LOOSE_RE.match(name):
            continue
        state = s.get('state', '')
        if state == 'future' and not include_future:
            continue
        end_date = (s.get('endDate') or '')[:10]
        if end_date and end_date < f'{YEAR_FILTER}-01-01':
            continue
        m = SPRINT_NUM_RE.match(name)
        explicit_n = int(m.group(1)) if m else None
        matched.append({
            'id': s['id'],
            'name': name,
            'label': short_label(name),
            'sprint_n_explicit': explicit_n,
            'sprint_n': explicit_n,  # may be filled in below
            'state': state,
            'startDate': s.get('startDate', ''),
            'endDate': s.get('endDate', ''),
            'completeDate': s.get('completeDate', ''),
            'goal': s.get('goal', ''),
        })

    # Sort chronologically (oldest first) for synthetic numbering, then reverse
    # the result so caller gets newest first.
    matched.sort(key=lambda x: x.get('startDate', ''))

    # Assign synthetic sprint_n to date-only sprints by counting backwards from
    # the lowest explicit number (e.g. PL_2 → 2; the sprint before it → 1; the
    # one before that → 0). If there is NO explicit number anywhere, just use
    # 0-based sequence.
    explicit_nums = [s['sprint_n_explicit'] for s in matched if s['sprint_n_explicit'] is not None]
    unexplicit = [s for s in matched if s['sprint_n_explicit'] is None]
    if explicit_nums:
        # Assume the un-numbered, date-only sprints come BEFORE the smallest
        # explicit one chronologically. Assign sequential numbers so oldest gets
        # the smallest (e.g. PL_2 is min explicit → unexplicit get 0, 1, ...).
        start_synth = min(explicit_nums) - len(unexplicit)
        for i, sp in enumerate(unexplicit):  # already oldest-first
            sp['sprint_n'] = start_synth + i
    else:
        for i, sp in enumerate(matched):
            sp['sprint_n'] = i

    matched.reverse()  # newest first
    print(f'  Found {len(matched)} PL-* sprints from {YEAR_FILTER}+ (newest first).', flush=True)
    return matched


# ── Issue fetching ───────────────────────────────────────────────────────────

def fetch_sprint_issues(sprint_id):
    """Return all issues in a sprint with the fields + changelogs we need.

    `expand=changelog` is required for committed_md / burndown reconstruction —
    it lets us rewind Sprint and Status field history to compute the scope at
    sprint start and the daily MD-remaining series.
    """
    issues = []
    start = 0
    while True:
        data = jira_get(f'/rest/agile/1.0/sprint/{sprint_id}/issue', {
            'startAt': start, 'maxResults': 100, 'fields': ISSUE_FIELDS,
            'expand': 'changelog',
        })
        batch = data.get('issues', [])
        issues.extend(batch)
        total = data.get('total', 0)
        if start + len(batch) >= total or not batch:
            break
        start += len(batch)
    return issues


def fetch_epic_summaries(epic_keys):
    """Return dict epic_key -> summary for given keys (one batched JQL)."""
    if not epic_keys:
        return {}
    keys = list(epic_keys)
    out = {}
    BATCH = 50
    for i in range(0, len(keys), BATCH):
        slice_ = keys[i:i + BATCH]
        jql = 'key in (' + ','.join(slice_) + ')'
        data = jira_get('/rest/api/2/search', {
            'jql': jql, 'fields': 'summary', 'maxResults': BATCH,
        })
        for it in data.get('issues', []):
            out[it['key']] = it.get('fields', {}).get('summary', '')
    return out


def fetch_worklogs(issue_key):
    """Return list of worklog dicts {author, hours, date} for the issue.

    Jira Server returns all worklogs in one response by default. We still
    paginate defensively for safety on Cloud-style instances.
    """
    out = []
    start = 0
    while True:
        data = jira_get(f'/rest/api/2/issue/{issue_key}/worklog', {
            'startAt': start, 'maxResults': 1000,
        })
        for w in data.get('worklogs', []):
            author = (w.get('author') or {}).get('displayName') or '(unassigned)'
            seconds = w.get('timeSpentSeconds') or 0
            started = (w.get('started') or '')[:10]  # YYYY-MM-DD
            out.append({'author': author, 'hours': seconds / 3600, 'date': started})
        total = data.get('total', len(out))
        if start + len(data.get('worklogs', [])) >= total:
            break
        start += len(data.get('worklogs', []))
        if not data.get('worklogs'):
            break
    return out


# ── Changelog-based reconstruction (committed_md + burndown) ─────────────────

FINAL_STATUSES = DONE_STATUSES | CANCELLED_STATUSES


def _parse_iso_date(s):
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def _parse_iso_datetime(s):
    if not s:
        return None
    s = s.strip()
    for fmt in ('%Y-%m-%dT%H:%M:%S.%f%z', '%Y-%m-%dT%H:%M:%S%z',
                '%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S'):
        try:
            return datetime.strptime(s.rstrip('Z'), fmt)
        except ValueError:
            continue
    return None


def _business_days(start_d, end_d):
    out = []
    d = start_d
    while d <= end_d:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def _changelog_items(issue):
    """Yield (datetime, field_lower, from_string, to_string) for each item."""
    for entry in (issue.get('changelog') or {}).get('histories', []) or []:
        when = _parse_iso_datetime(entry.get('created', ''))
        if not when:
            continue
        for item in entry.get('items', []) or []:
            yield when, (item.get('field') or '').lower(), item.get('fromString'), item.get('toString')


def is_added_after_start(issue, sprint_name, sprint_start_d):
    """True if this sprint was added to the issue after sprint_start_d + 1 day.

    Mirrors MAIN logic — anything added during day 0 or 1 still counts as
    initial scope (PMs often stage tickets right at kickoff).
    """
    if not sprint_start_d:
        return False
    cutoff = sprint_start_d + timedelta(days=1)
    name_lc = (sprint_name or '').lower()
    for when, field, _from, to in _changelog_items(issue):
        if field != 'sprint':
            continue
        if not to or name_lc not in to.lower():
            continue
        if when.date() >= cutoff:
            return True
    return False


def reconstruct_in_sprint(issue, sprint_name, target_d):
    """True if issue belonged to this sprint at end of target_d.

    Walks the Sprint changelog backwards from current state ("currently in this
    sprint, since we received it from /sprint/{id}/issue").
    """
    name_lc = (sprint_name or '').lower()
    in_sprint = True  # currently in sprint
    events = sorted(
        ((w, f, fs, ts) for (w, f, fs, ts) in _changelog_items(issue) if f == 'sprint'),
        key=lambda x: x[0], reverse=True,
    )
    for when, _f, from_s, to_s in events:
        if when.date() <= target_d:
            break
        # Rewind: at point in past, state was the "from" side.
        from_lc = (from_s or '').lower()
        in_sprint = name_lc in from_lc
    return in_sprint


def reconstruct_is_final(issue, target_d):
    """True if the issue was Done/Cancelled at end of target_d."""
    cur_status = (issue.get('fields', {}).get('status') or {}).get('name', '')
    is_final = cur_status in FINAL_STATUSES
    events = sorted(
        ((w, f, fs, ts) for (w, f, fs, ts) in _changelog_items(issue) if f == 'status'),
        key=lambda x: x[0], reverse=True,
    )
    for when, _f, from_s, _to_s in events:
        if when.date() <= target_d:
            break
        is_final = (from_s or '') in FINAL_STATUSES
    return is_final


def compute_burndown(issues, sprint_name, sprint_start_d, sprint_end_d):
    """Daily MD-remaining series over business days inside [start, end].

    Stops at today for active sprints (no projection). Issues missing an MD
    estimate count as 0 — same behaviour as the rest of this script.
    """
    if not sprint_start_d or not sprint_end_d:
        return []
    today = datetime.today().date()
    series = []
    for idx, day in enumerate(_business_days(sprint_start_d, sprint_end_d)):
        if day > today:
            break
        remaining = 0.0
        for it in issues:
            md = it.get('fields', {}).get(FIELD_MD)
            if md is None:
                continue
            if not reconstruct_in_sprint(it, sprint_name, day):
                continue
            if reconstruct_is_final(it, day):
                continue
            remaining += md
        series.append({
            'day_n': idx,
            'date': str(day),
            'remaining_md': round(remaining, 1),
        })
    return series


# ── Aggregation ──────────────────────────────────────────────────────────────

def bucket(status_name):
    if status_name in DONE_STATUSES:
        return 'done'
    if status_name in WIP_STATUSES:
        return 'wip'
    if status_name in CANCELLED_STATUSES:
        return 'cancelled'
    return 'todo'


def aggregate(sprint_meta, issues, epic_summaries, worklogs_by_key, parent_epic):
    """Aggregate sprint data.

    worklogs_by_key: dict issue_key -> list of {author, hours, date} from full
    issue worklog history. We filter per sprint by date range here.
    """
    sprint_start = (sprint_meta.get('startDate') or '')[:10]
    sprint_end = (sprint_meta.get('endDate') or '')[:10]
    sprint_start_d = _parse_iso_date(sprint_start)
    sprint_end_d = _parse_iso_date(sprint_end)
    sprint_name = sprint_meta.get('name', '')

    summary = {
        'issues': {'total': 0, 'done': 0, 'wip': 0, 'todo': 0, 'cancelled': 0},
        'md': {'total': 0.0, 'done': 0.0, 'wip': 0.0, 'todo': 0.0, 'cancelled': 0.0,
               'coverage': 0, 'coverage_pct': 0},
        'committed_md': 0.0,
        'added_md': 0.0,
        'time': {'orig_h': 0.0, 'spent_h': 0.0, 'spent_orig_ratio': 0.0,
                 'untracked_spent_h': 0.0, 'untracked_spent_pct': 0,
                 'no_estimate_spent_h': 0.0, 'no_estimate_spent_pct': 0},
        'hygiene': {'unassigned': 0, 'no_md': 0, 'no_orig_estimate': 0, 'no_epic': 0},
        'bugs': {'count': 0, 'md': 0.0, 'spent_h': 0.0,
                 'pct_of_issues': 0, 'pct_of_spent': 0},
        'by_priority': {},
        'by_type': {},
    }

    persons = defaultdict(lambda: {
        'name': '', 'count': 0, 'done': 0, 'wip': 0, 'todo': 0, 'cancelled': 0,
        'md': 0.0, 'done_md': 0.0, 'h_spent': 0.0, 'h_orig': 0.0,
    })
    epics = defaultdict(lambda: {
        'count': 0, 'done': 0, 'md': 0.0, 'spent_h': 0.0,
    })
    issues_out = []  # per-issue summary with sprint-scoped contributors

    for it in issues:
        f = it['fields']
        status = f['status']['name']
        itype_obj = f['issuetype']
        itype = itype_obj['name']
        is_subtask = bool(itype_obj.get('subtask'))
        parent_obj = f.get('parent') or {}
        parent_key = parent_obj.get('key') if parent_obj else None
        b = bucket(status)
        md = f.get(FIELD_MD)
        orig_h = (f.get('timeoriginalestimate') or 0) / 3600
        spent_h = (f.get('timespent') or 0) / 3600
        epic = f.get(FIELD_EPIC)
        # Subtasks inherit Epic Link from their parent (Epic Link sits on the
        # parent task in standard Jira, never on the subtask itself).
        if not epic and is_subtask and parent_key and parent_key in parent_epic:
            epic = parent_epic[parent_key].get('epic')
        priority = (f.get('priority') or {}).get('name', '-')
        assignee = (f.get('assignee') or {}).get('displayName')

        summary['issues']['total'] += 1
        summary['issues'][b] += 1
        summary['by_type'][itype] = summary['by_type'].get(itype, 0) + 1
        summary['by_priority'][priority] = summary['by_priority'].get(priority, 0) + 1

        if md is not None:
            summary['md']['total'] += md
            summary['md'][b] += md
            summary['md']['coverage'] += 1
            # Split into committed (initial scope) vs added scope using the
            # Sprint changelog. Issues removed during the sprint are not in
            # this list (the agile API returns current scope only) — same
            # caveat as MAIN sprint_stats.
            if is_added_after_start(it, sprint_name, sprint_start_d):
                summary['added_md'] += md
            else:
                summary['committed_md'] += md
        else:
            summary['hygiene']['no_md'] += 1
        if orig_h == 0:
            summary['hygiene']['no_orig_estimate'] += 1
            summary['time']['untracked_spent_h'] += spent_h
            if md is None:
                summary['time']['no_estimate_spent_h'] += spent_h
        if not assignee:
            summary['hygiene']['unassigned'] += 1
        if not epic:
            summary['hygiene']['no_epic'] += 1
        summary['time']['orig_h'] += orig_h
        summary['time']['spent_h'] += spent_h

        if itype in BUG_TYPES:
            summary['bugs']['count'] += 1
            summary['bugs']['md'] += md or 0
            summary['bugs']['spent_h'] += spent_h

        akey = assignee or '(unassigned)'
        p = persons[akey]
        p['name'] = akey
        p['count'] += 1
        p[b] += 1
        if md:
            p['md'] += md
            if b == 'done':
                p['done_md'] += md
        p['h_spent'] += spent_h
        p['h_orig'] += orig_h

        if epic:
            e = epics[epic]
            e['count'] += 1
            if md:
                e['md'] += md
            e['spent_h'] += spent_h
            if b == 'done':
                e['done'] += 1

        # Sprint-scoped worklog roll-up per issue
        contributors_by_author = defaultdict(float)
        sprint_spent_h = 0.0
        for w in worklogs_by_key.get(it['key'], []):
            d = w.get('date') or ''
            if not d:
                continue
            if sprint_start and d < sprint_start:
                continue
            if sprint_end and d > sprint_end:
                continue
            contributors_by_author[w['author']] += w['hours']
            sprint_spent_h += w['hours']
        contributors = [{'name': n, 'hours': round(h, 2)}
                        for n, h in sorted(contributors_by_author.items(),
                                           key=lambda x: -x[1])]
        issues_out.append({
            'key': it['key'],
            'summary': f.get('summary', ''),
            'status': status,
            'status_bucket': b,
            'type': itype,
            'is_subtask': is_subtask,
            'parent_key': parent_key,
            'priority': priority,
            'assignee': assignee,
            'epic': epic,
            'epic_summary': epic_summaries.get(epic, '') if epic else '',
            'md': md if md is not None else None,
            'orig_h': round(orig_h, 2),
            'total_spent_h': round(spent_h, 2),
            'spent_in_sprint_h': round(sprint_spent_h, 2),
            'contributors': contributors,
        })

    # Derived
    total = summary['issues']['total']
    if total:
        summary['md']['coverage_pct'] = round(100 * summary['md']['coverage'] / total)
        summary['bugs']['pct_of_issues'] = round(100 * summary['bugs']['count'] / total)
    if summary['time']['orig_h']:
        summary['time']['spent_orig_ratio'] = round(
            summary['time']['spent_h'] / summary['time']['orig_h'], 2)
    if summary['time']['spent_h']:
        summary['time']['untracked_spent_pct'] = round(
            100 * summary['time']['untracked_spent_h'] / summary['time']['spent_h'])
        summary['time']['no_estimate_spent_pct'] = round(
            100 * summary['time']['no_estimate_spent_h'] / summary['time']['spent_h'])
        summary['bugs']['pct_of_spent'] = round(
            100 * summary['bugs']['spent_h'] / summary['time']['spent_h'])

    # Round MD numbers + spent/orig hours for cleaner JSON
    def r(d, keys, n=1):
        for k in keys:
            d[k] = round(d[k], n)
    r(summary['md'], ['total', 'done', 'wip', 'todo', 'cancelled'], 1)
    r(summary['time'], ['orig_h', 'spent_h', 'untracked_spent_h', 'no_estimate_spent_h'], 1)
    summary['committed_md'] = round(summary['committed_md'], 1)
    summary['added_md'] = round(summary['added_md'], 1)
    summary['bugs']['md'] = round(summary['bugs']['md'], 1)
    summary['bugs']['spent_h'] = round(summary['bugs']['spent_h'], 1)

    persons_list = sorted(persons.values(), key=lambda x: -x['h_spent'])
    for p in persons_list:
        p['md'] = round(p['md'], 1)
        p['done_md'] = round(p['done_md'], 1)
        p['h_spent'] = round(p['h_spent'], 1)
        p['h_orig'] = round(p['h_orig'], 1)

    epics_list = []
    for ek, e in epics.items():
        epics_list.append({
            'key': ek,
            'summary': epic_summaries.get(ek, ''),
            'count': e['count'],
            'done': e['done'],
            'md': round(e['md'], 1),
            'spent_h': round(e['spent_h'], 1),
        })
    epics_list.sort(key=lambda x: -x['spent_h'])

    issues_out.sort(key=lambda x: -x['spent_in_sprint_h'])

    # Sprint-scoped totals derived from worklogs (true per-sprint, not lifetime).
    sprint_spent_total_h = round(sum(i['spent_in_sprint_h'] for i in issues_out), 1)
    sprint_untracked_h = round(sum(
        i['spent_in_sprint_h'] for i in issues_out if i['orig_h'] == 0
    ), 1)
    sprint_no_estimate_h = round(sum(
        i['spent_in_sprint_h'] for i in issues_out
        if i['orig_h'] == 0 and i['md'] is None
    ), 1)
    sprint_bugs_h = round(sum(
        i['spent_in_sprint_h'] for i in issues_out if i['type'] in BUG_TYPES
    ), 1)
    pct_int = lambda n, d: round(100 * n / d) if d else 0  # noqa: E731
    summary['sprint_scoped'] = {
        'spent_h': sprint_spent_total_h,
        'spent_orig_ratio': round(sprint_spent_total_h / summary['time']['orig_h'], 2)
            if summary['time']['orig_h'] else 0,
        'untracked_spent_h': sprint_untracked_h,
        'untracked_spent_pct': pct_int(sprint_untracked_h, sprint_spent_total_h),
        'no_estimate_spent_h': sprint_no_estimate_h,
        'no_estimate_spent_pct': pct_int(sprint_no_estimate_h, sprint_spent_total_h),
        'bugs_spent_h': sprint_bugs_h,
        'bugs_spent_pct': pct_int(sprint_bugs_h, sprint_spent_total_h),
    }

    burndown = compute_burndown(issues, sprint_name, sprint_start_d, sprint_end_d)

    return {
        'sprint_id': sprint_meta['id'],
        'sprint_n': sprint_meta['sprint_n'],
        'name': sprint_meta['name'],
        'state': sprint_meta['state'],
        'start': sprint_start,
        'end': sprint_end,
        'goal': sprint_meta.get('goal', ''),
        'summary': summary,
        'persons': persons_list,
        'epics': epics_list[:10],  # cap top 10
        'burndown': burndown,
        'issues': issues_out,
    }


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    emit_progress(1, 4, 'Fetching the PLATFORM sprint list from the board...')
    sprints = discover_sprints()
    if not sprints:
        print('No PL-* sprints on the board for the given year.', file=sys.stderr)
        sys.exit(1)

    if SELECTED_SPRINT_IDS:
        selected = [s for s in sprints if s['id'] in SELECTED_SPRINT_IDS]
        if not selected:
            print(f'No sprints match --sprint-ids={sorted(SELECTED_SPRINT_IDS)}', file=sys.stderr)
            sys.exit(1)
    else:
        selected = sprints  # all 2026
    print('Will process:', flush=True)
    for s in selected:
        print(f"  - {s['name']!r} ({s['state']}) start={s.get('startDate', '-')[:10]} end={s.get('endDate', '-')[:10]}", flush=True)

    emit_progress(2, 4, f'Fetching issues for {len(selected)} sprints...')
    # Fetch issues for each sprint in parallel
    all_issues = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        future_to_sid = {pool.submit(fetch_sprint_issues, s['id']): s['id'] for s in selected}
        for fut in as_completed(future_to_sid):
            sid = future_to_sid[fut]
            try:
                all_issues[sid] = fut.result()
                print(f'  sprint {sid}: fetched {len(all_issues[sid])} issues', flush=True)
            except Exception as e:
                print(f'  sprint {sid}: error - {e}', file=sys.stderr)
                all_issues[sid] = []

    # Collect all epic keys for summary lookup. Subtasks have no epic of their
    # own — Epic Link lives on their parent — so we must look up parents first
    # to know which epics to fetch.
    parent_keys = set()
    for issues in all_issues.values():
        for it in issues:
            it_type = it['fields'].get('issuetype') or {}
            if it_type.get('subtask') and it['fields'].get('parent'):
                parent_keys.add(it['fields']['parent']['key'])
    parent_epic = {}  # parent_key -> {epic, summary, type}
    if parent_keys:
        print(f'Fetching parent epics ({len(parent_keys)} subtask parents)...', flush=True)
        BATCH = 50
        keys_list = list(parent_keys)
        for i in range(0, len(keys_list), BATCH):
            chunk = keys_list[i:i + BATCH]
            jql = 'key in (' + ','.join(chunk) + ')'
            data = jira_get('/rest/api/2/search', {
                'jql': jql, 'fields': f'summary,issuetype,{FIELD_EPIC}',
                'maxResults': BATCH,
            })
            for it in data.get('issues', []):
                f = it.get('fields', {})
                parent_epic[it['key']] = {
                    'epic': f.get(FIELD_EPIC),
                    'summary': f.get('summary', ''),
                    'type': (f.get('issuetype') or {}).get('name', ''),
                }

    epic_keys = set()
    for issues in all_issues.values():
        for it in issues:
            ek = it['fields'].get(FIELD_EPIC)
            if ek:
                epic_keys.add(ek)
                continue
            # Subtask without own epic — inherit from parent if available.
            parent = (it['fields'].get('parent') or {})
            pk = parent.get('key')
            if pk and pk in parent_epic and parent_epic[pk]['epic']:
                epic_keys.add(parent_epic[pk]['epic'])
    print(f'Fetching epic names ({len(epic_keys)})...', flush=True)
    epic_summaries = fetch_epic_summaries(epic_keys)

    # Collect unique issue keys with worklog activity (timespent > 0).
    # Issues with timespent==0 have no worklogs; skip them to save API calls.
    keys_with_worklog = set()
    for issues in all_issues.values():
        for it in issues:
            if (it['fields'].get('timespent') or 0) > 0:
                keys_with_worklog.add(it['key'])
    print(f'Fetching worklogs for {len(keys_with_worklog)} unique issues (parallel)...', flush=True)
    worklogs_by_key = {}
    done_count = 0
    with ThreadPoolExecutor(max_workers=10) as pool:
        future_to_key = {pool.submit(fetch_worklogs, k): k for k in keys_with_worklog}
        for fut in as_completed(future_to_key):
            k = future_to_key[fut]
            try:
                worklogs_by_key[k] = fut.result()
            except Exception as e:
                print(f'  worklog {k}: error - {e}', file=sys.stderr)
                worklogs_by_key[k] = []
            done_count += 1
            if done_count % 50 == 0:
                print(f'  worklogs: {done_count}/{len(keys_with_worklog)}', flush=True)
    print(f'  worklogs: {done_count}/{len(keys_with_worklog)} done', flush=True)

    emit_progress(3, 4, 'Aggregating sprint data...')
    sprint_payloads = []
    for s in selected:
        agg = aggregate(s, all_issues.get(s['id'], []), epic_summaries, worklogs_by_key, parent_epic)
        sprint_payloads.append(agg)

    # Board-wide active sprint: search the FULL discovered list (not just the
    # selected slice), so a --sprint-ids run over an older sprint still
    # reports the real current active one.
    board_active_id = None
    for s in sprints:
        if s.get('state') == 'active':
            board_active_id = s['id']
            break
    if board_active_id is None:
        for sp in sprint_payloads:
            if sp.get('state') == 'active':
                board_active_id = sp['sprint_id']
                break

    # No merge, no shards, no monolith here - Node's server/store.js owns
    # sprint-stats/ and merges this run's sprints into it by (src, sprint_n).
    # This script's only job is to shape THIS run's result as team-sprint.
    emit_progress(4, 4, 'Writing the result...')

    sprints_for_out = []
    for s in sprint_payloads:
        summary = s['summary']
        md = summary['md']
        phase = detect_phase(s.get('state', ''), s.get('start', ''))
        completion_pct = round(100 * md['done'] / md['total']) if md['total'] > 0 else 0
        team_sprint = {
            'src': 'platform',
            'team': 'Delta',
            'unit': 'MD',
            'sprint_n': s['sprint_n'],
            'sprint_id': s['sprint_id'],
            'sprint_name': s['name'],
            'state': s['state'],
            'phase': phase,
            'start': s['start'],
            'end': s['end'],
            'goal': s.get('goal', ''),
            'summary': {
                'committed': summary['committed_md'],
                'done': md['done'],
                'wip': md['wip'],
                'todo': md['todo'],
                'dropped': md['cancelled'],
                'added': summary['added_md'],
                'total_issues': summary['issues']['total'],
                'completion_pct': completion_pct,
            },
            'persons': [
                {
                    'name': p['name'],
                    'count': p['count'],
                    'done': p['done'],
                    'wip': p['wip'],
                    'todo': p['todo'],
                    'dropped': p['cancelled'],
                    'estimate': p['md'],
                    'estimate_done': p['done_md'],
                    'spent_h': p['h_spent'],
                    'orig_h': p['h_orig'],
                }
                for p in s['persons']
            ],
            'issues': [
                {
                    'key': i['key'],
                    'summary': i['summary'],
                    'type': i['type'],
                    'assignee': i['assignee'],
                    'status_bucket': 'dropped' if i['status_bucket'] == 'cancelled' else i['status_bucket'],
                    'status_label': i['status'],
                    'estimate': i['md'],
                    'spent_h': i['spent_in_sprint_h'],
                }
                for i in s['issues']
            ],
            'burndown': [
                {'day_n': b['day_n'], 'date': b['date'], 'remaining': b['remaining_md']}
                for b in s['burndown']
            ],
            # Blocks the view never shows, carried unchanged so the ETL never
            # discards data a future view might want.
            'extra': {
                'time': summary.get('time'),
                'hygiene': summary.get('hygiene'),
                'bugs': summary.get('bugs'),
                'by_priority': summary.get('by_priority'),
                'by_type': summary.get('by_type'),
                'sprint_scoped': summary.get('sprint_scoped'),
                'epics': s.get('epics'),
            },
        }
        sprints_for_out.append({'sprint_n': s['sprint_n'], 'phase': phase, 'teams': [team_sprint]})

    board = {
        'board_id': BOARD_ID,
        'project': PROJECT,
        'active_sprint_id': board_active_id,
        'year_filter': YEAR_FILTER,
        'generated_at': datetime.now().isoformat(timespec='seconds'),
    }

    if not args.out:
        print('Error: --out is missing.', file=sys.stderr)
        sys.exit(2)
    write_out(args.out, {'src': 'platform', 'board': board, 'sprints': sprints_for_out})

    print(f'\nDone. Written: {args.out}')
    print(f'Sprints: {len(sprints_for_out)} | Active sprint: {board_active_id}')


if __name__ == '__main__':
    main()
