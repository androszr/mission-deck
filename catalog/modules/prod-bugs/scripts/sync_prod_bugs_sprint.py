#!/usr/bin/env python3
"""
sync_prod_bugs_sprint.py - Jira -> per-sprint production bug metrics.

For three areas per sprint:
  - orders          (PROD bugs of APP_PROJECT carrying ORDERS_LABEL)
  - otherModules    (PROD bugs of APP_PROJECT without that label)
  - platform        (issues of PLATFORM_PROJECT under the PLATFORM_EPIC epic)
it computes bugs (open at end of sprint), bugFixTime, resolvedCount,
createdCount plus the openBugs / resolvedBugs lists.

Output: <data-dir>/prod-bugs-sprint-<n>.json, written HERE (not by Node) with
one fixed serialization - a different byte layout of the same data is a
"changed file" on every refresh.

Manifest: only the key availableProdBugsSprints of <data-dir>/manifest.json is
touched (other tools may own the other keys). Shards are written BEFORE the
manifest and the list comes from a directory scan, so the manifest never names
a sprint without a file.

Token: ONE JSON line on stdin ({token, jira_url, verify_ssl}); nothing else
is read from the environment.

Usage:
  sync_prod_bugs_sprint.py auto --data-dir D --cache-dir C [--force | --force-current]
  sync_prod_bugs_sprint.py 12 --data-dir D --cache-dir C
  sync_prod_bugs_sprint.py 1-12 --data-dir D --cache-dir C
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _common import JiraHttpError, atomic_write_json, jira_get, jira_search, progress  # noqa: E402

# -- Config -------------------------------------------------------------------

# Adjust the values below to your Jira instance. They are VALUES COMPARED
# WITH JIRA: a label or issue type spelled differently silently returns a
# different set of issues.

# Statuses excluded from "open at end of sprint" (for unresolved bugs).
EXCLUDED_STATUSES = {'Cancelled', 'Test'}

# Project whose PROD-labelled bugs feed the "orders" and "otherModules" areas.
APP_PROJECT = 'APP'
ORDERS_LABEL = 'Orders'
BUG_ISSUE_TYPE = 'Bug'

# Project and epic that scope the "platform" area.
PLATFORM_PROJECT = 'PLAT'
PLATFORM_EPIC = 'PLAT-100'

# Max lookback for JQL - bugs older than this are unlikely to still be open.
LOOKBACK_DAYS = 730

FIELDS = 'summary,labels,created,resolutiondate,status,resolution,priority'

# Board used to find sprint dates / the active sprint.
SPRINT_RE = re.compile(r'^(.+?)\s+Sprint\s+(\d+)$', re.IGNORECASE)
DEFAULT_BOARD_ID = '1'
DEFAULT_TEAMS = ('Atlas', 'Borealis')

# -- Jira board helpers ---------------------------------------------------------


def _fetch_all_board_sprints(board_id):
    """All sprints of a board (paginated)."""
    all_sprints = []
    start = 0
    while True:
        data = jira_get(f'/rest/agile/1.0/board/{board_id}/sprint', {
            'startAt': start, 'maxResults': 50,
        })
        vals = data.get('values', [])
        all_sprints.extend(vals)
        if data.get('isLast', True) or not vals:
            break
        start += len(vals)
    return all_sprints


def _find_sprint_on_board(board_id, target_name):
    """One sprint by exact name on a board."""
    start = 0
    while True:
        data = jira_get(f'/rest/agile/1.0/board/{board_id}/sprint', {
            'startAt': start, 'maxResults': 50,
        })
        for s in data.get('values', []):
            if s.get('name', '').strip() == target_name:
                return s
        if data.get('isLast', True) or not data.get('values'):
            break
        start += len(data['values'])
    return None


def find_board_sprint(sprint_n, board_id=DEFAULT_BOARD_ID, teams=DEFAULT_TEAMS):
    """Canonical (startDate, endDate) of sprint N: min start / max end across
    '{Team} Sprint {N}'. Returns dates or None."""
    start_dates, end_dates = [], []
    for team in teams:
        found = _find_sprint_on_board(board_id, f'{team} Sprint {sprint_n}')
        if not found:
            continue
        sd = (found.get('startDate') or '')[:10]
        ed = (found.get('completeDate') or found.get('endDate') or '')[:10]
        if sd:
            start_dates.append(datetime.strptime(sd, '%Y-%m-%d').date())
        if ed:
            end_dates.append(datetime.strptime(ed, '%Y-%m-%d').date())
    if not start_dates or not end_dates:
        return None
    return min(start_dates), max(end_dates)


def find_active_sprint_number(board_id=DEFAULT_BOARD_ID, teams=DEFAULT_TEAMS):
    """Highest sprint number whose date range contains today; falls back to
    the highest sprint in state 'active'."""
    today = datetime.now().date()
    best_n = None
    best_active_n = None
    for s in _fetch_all_board_sprints(board_id):
        m = SPRINT_RE.match(s.get('name', '').strip())
        if not m:
            continue
        team_name, n_str = m.group(1), m.group(2)
        if team_name not in teams:
            continue
        n = int(n_str)
        sd = (s.get('startDate') or '')[:10]
        ed = (s.get('endDate') or '')[:10]
        if sd and ed:
            try:
                start = datetime.strptime(sd, '%Y-%m-%d').date()
                end = datetime.strptime(ed, '%Y-%m-%d').date()
                if start <= today <= end:
                    if best_n is None or n > best_n:
                        best_n = n
            except ValueError:
                pass
        if s.get('state') == 'active':
            if best_active_n is None or n > best_active_n:
                best_active_n = n
    return best_n or best_active_n

# -- Helpers ------------------------------------------------------------------


def parse_jira_date(s):
    """Jira datetime string -> date, or None."""
    if not s:
        return None
    return datetime.strptime(s[:10], '%Y-%m-%d').date()


def categorize_app(labels):
    """'orders' when ORDERS_LABEL is present, else 'otherModules'."""
    return 'orders' if ORDERS_LABEL in (labels or []) else 'otherModules'


def _safe_jira_search(jql, fields):
    """jira_search that logs and swallows a JQL HTTP error (a deleted epic, a
    renamed issue type) instead of crashing the whole run."""
    try:
        return jira_search(jql, fields)
    except JiraHttpError as e:
        print(f'  WARNING: JQL returned an error ({e}). Query: {jql}', file=sys.stderr, flush=True)
        return []


def load_sprint_bounds(data_dir, sprint_num):
    """sprint-{N}.json meta.startDate/endDate, falling back to the Jira board.
    Returns (start, end) dates or None."""
    fp = os.path.join(data_dir, f'sprint-{sprint_num}.json')
    if os.path.isfile(fp):
        try:
            with open(fp, encoding='utf-8') as f:
                data = json.load(f)
            meta = data.get('meta', {})
            start_s = meta.get('startDate')
            end_s = meta.get('endDate')
            if start_s and end_s:
                return (datetime.strptime(start_s, '%Y-%m-%d').date(),
                        datetime.strptime(end_s, '%Y-%m-%d').date())
        except (OSError, json.JSONDecodeError, ValueError):
            pass
    result = find_board_sprint(sprint_num)
    if result:
        print(f'  Sprint {sprint_num}: dates from the Jira board (no sprint-{sprint_num}.json)', file=sys.stderr, flush=True)
    return result


def parse_sprint_spec(spec):
    """'auto' (active sprint -> 1..N), a single number, or a range 'a-b'."""
    if spec == 'auto':
        active = find_active_sprint_number()
        if active is None:
            print('ERROR: no active sprint found on the Jira board', file=sys.stderr)
            sys.exit(1)
        print(f'  Auto-discovered active sprint: {active}', flush=True)
        return sorted(range(1, active + 1))
    if '-' in spec:
        a, b = spec.split('-', 1)
        return sorted(range(int(a), int(b) + 1))
    return [int(spec)]

# -- Metric calculation ----------------------------------------------------------


def calc_area_metrics(issues, start_date, end_date):
    """bugs / bugFixTime / resolvedCount / createdCount for one area's pool.

    issues: dicts with 'key', 'created' (date), 'resolved' (date|None), 'status'.
    """
    # Open at end of sprint: created <= end AND not resolved by end. An
    # unresolved bug in an excluded status (current status as proxy) is out.
    open_at_end = []
    for b in issues:
        if b['resolved'] is not None and b['resolved'] <= end_date:
            continue
        if b['resolved'] is None and b['status'] in EXCLUDED_STATUSES:
            continue
        open_at_end.append(b)

    resolved_in_sprint = [
        b for b in issues
        if b['resolved'] is not None and start_date <= b['resolved'] <= end_date
    ]
    created_in_sprint = [b for b in issues if start_date <= b['created'] <= end_date]

    fix_times = [(b['resolved'] - b['created']).days for b in resolved_in_sprint]
    avg_fix = round(sum(fix_times) / len(fix_times), 1) if fix_times else None

    return {
        'bugs': len(open_at_end),
        'bugFixTime': avg_fix,
        'resolvedCount': len(resolved_in_sprint),
        'createdCount': len(created_in_sprint),
        'openBugs': [
            {'key': b['key'], 'summary': b.get('summary', ''), 'status': b['status'],
             'priority': b.get('priority'), 'created': str(b['created'])}
            for b in open_at_end
        ],
        'resolvedBugs': [
            {'key': b['key'], 'summary': b.get('summary', ''), 'status': b['status'],
             'priority': b.get('priority'), 'created': str(b['created']),
             'resolved': str(b['resolved']),
             'fixDays': (b['resolved'] - b['created']).days}
            for b in resolved_in_sprint
        ],
    }


def _issue_row(iss):
    f = iss['fields']
    prio = f.get('priority')
    return {
        'key': iss['key'],
        'summary': f.get('summary', ''),
        'created': parse_jira_date(f.get('created')),
        'resolved': parse_jira_date(f.get('resolutiondate')),
        'status': f['status']['name'],
        'priority': prio['name'] if prio else None,
    }


def fetch_and_calc_sprint(sprint_num, start_date, end_date):
    """Fetch the app and platform PROD bugs from Jira and compute one sprint."""
    lower_bound = start_date - timedelta(days=LOOKBACK_DAYS)

    app_jql = (
        f'project = {APP_PROJECT} AND issuetype = "{BUG_ISSUE_TYPE}" AND labels = PROD '
        f'AND created >= "{lower_bound}" AND created <= "{end_date}" '
        f'ORDER BY created ASC'
    )
    platform_jql = (
        f'project = {PLATFORM_PROJECT} AND "Epic Link" = {PLATFORM_EPIC} '
        f'AND created >= "{lower_bound}" AND created <= "{end_date}" '
        f'ORDER BY created ASC'
    )

    print(f'  Fetching {APP_PROJECT} PROD bugs (created {lower_bound}..{end_date})...', flush=True)
    app_raw = _safe_jira_search(app_jql, FIELDS)
    print(f'  Found {len(app_raw)} {APP_PROJECT} issues', flush=True)

    print(f'  Fetching {PLATFORM_PROJECT} bugs under epic {PLATFORM_EPIC}...', flush=True)
    platform_raw = _safe_jira_search(platform_jql, FIELDS)
    print(f'  Found {len(platform_raw)} {PLATFORM_PROJECT} issues', flush=True)

    issues_by_area = {'orders': [], 'otherModules': [], 'platform': []}
    for iss in app_raw:
        issues_by_area[categorize_app(iss['fields'].get('labels', []))].append(_issue_row(iss))
    for iss in platform_raw:
        issues_by_area['platform'].append(_issue_row(iss))

    areas = {
        area_key: calc_area_metrics(pool, start_date, end_date)
        for area_key, pool in issues_by_area.items()
    }

    return {
        'sprint': sprint_num,
        'sprintName': f'Sprint {sprint_num}',
        'dateRange': {'startDate': str(start_date), 'endDate': str(end_date)},
        'dateRangeDisplay': f'{start_date.strftime("%d.%m")}-{end_date.strftime("%d.%m")}',
        'fetchedAt': datetime.now().isoformat(timespec='seconds'),
        'areas': areas,
    }

# -- Per-sprint processing / manifest ------------------------------------------


def process_sprint(sprint_num, data_dir, cache_dir, force):
    bounds = load_sprint_bounds(data_dir, sprint_num)
    if bounds is None:
        print(
            f'  WARNING: no sprint-{sprint_num}.json or no startDate/endDate - skipping',
            file=sys.stderr, flush=True,
        )
        return None
    start_date, end_date = bounds

    os.makedirs(cache_dir, exist_ok=True)
    cache_fp = os.path.join(cache_dir, f'sprint-{sprint_num}-{start_date.year}.json')

    if os.path.isfile(cache_fp) and not force:
        print(f'  Cache hit -> {cache_fp}', flush=True)
        with open(cache_fp, encoding='utf-8') as f:
            result = json.load(f)
    else:
        result = fetch_and_calc_sprint(sprint_num, start_date, end_date)
        atomic_write_json(cache_fp, result)
        print(f'  Cache -> {cache_fp}', flush=True)

    out_fp = os.path.join(data_dir, f'prod-bugs-sprint-{sprint_num}.json')
    os.makedirs(data_dir, exist_ok=True)
    atomic_write_json(out_fp, result)
    print(f'  Saved -> {out_fp}', flush=True)
    return result


def scan_prod_bugs_sprints(data_dir):
    """Sprint numbers that have a shard on disk, ascending."""
    pat = re.compile(r'^prod-bugs-sprint-(\d+)\.json$')
    nums = []
    if os.path.isdir(data_dir):
        for name in os.listdir(data_dir):
            m = pat.match(name)
            if m:
                nums.append(int(m.group(1)))
    return sorted(nums)


def update_manifest_prod_bugs(data_dir):
    """Set ONLY availableProdBugsSprints in manifest.json (read-modify-write).

    Every other key and the key order stay as they were; nothing is written
    when the value is unchanged; a missing manifest is created holding this
    key alone. Serialization: indent=2, ensure_ascii=False, NO trailing newline.
    """
    manifest_path = os.path.join(data_dir, 'manifest.json')
    available = scan_prod_bugs_sprints(data_dir)

    prev = {}
    if os.path.isfile(manifest_path):
        with open(manifest_path, encoding='utf-8') as f:
            prev = json.load(f)
        if not isinstance(prev, dict):
            prev = {}

    if prev.get('availableProdBugsSprints') == available:
        return False

    prev['availableProdBugsSprints'] = available
    os.makedirs(data_dir, exist_ok=True)
    tmp_fp = manifest_path + '.tmp'
    with open(tmp_fp, 'w', encoding='utf-8') as f:
        json.dump(prev, f, ensure_ascii=False, indent=2)
    os.replace(tmp_fp, manifest_path)
    print(f'  manifest.json: availableProdBugsSprints = {available}', file=sys.stderr, flush=True)
    return True

# -- Main ------------------------------------------------------------------------


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

    parser = argparse.ArgumentParser(
        description='Sync per-sprint production bug metrics from Jira',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument('sprints', help='"auto", a sprint number or a range (e.g. 1-12)')
    parser.add_argument('--data-dir', required=True, help='directory the shards are written into')
    parser.add_argument('--cache-dir', required=True, help='directory of the per-sprint ETL cache')
    parser.add_argument('--force', action='store_true', help='re-fetch every sprint in range')
    parser.add_argument('--force-current', action='store_true',
                        help='re-fetch only the newest sprint in range (the rest from cache)')
    args = parser.parse_args()

    sprint_nums = parse_sprint_spec(args.sprints)
    total = len(sprint_nums)
    latest_in_range = sprint_nums[-1] if sprint_nums else None

    print(flush=True)
    print(f'Prod Bugs (per sprint) - sprints {sprint_nums[0]}-{sprint_nums[-1]}' if total else 'Prod Bugs - no sprints', flush=True)
    print('-' * 60, flush=True)

    processed = 0
    for idx, n in enumerate(sprint_nums, 1):
        progress(idx - 1, total, f'Sprint {n}')
        print(f'\nSprint {n}:', flush=True)
        force_this = args.force or (args.force_current and n == latest_in_range)
        if process_sprint(n, args.data_dir, args.cache_dir, force_this) is not None:
            processed += 1

    # Shards first, manifest last - and the manifest list comes from a scan.
    update_manifest_prod_bugs(args.data_dir)

    progress(total, total, 'Done')
    print(f'\nFinished: {processed}/{total} sprints processed.', flush=True)


if __name__ == '__main__':
    main()
