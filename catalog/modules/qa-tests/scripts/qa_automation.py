#!/usr/bin/env python3
"""Fetch QA automation metrics from Jira.

  - Uses _common.jira_get (urllib, no `requests`) and load_handoff (stdin token).
  - Writes shards to the --out directory via atomic_write_shard + _update_shard_index.
  - No .env / dotenv dependency; the token comes from the stdin handoff only.
  - Progress via _common.progress (@@PROGRESS: lines on stdout).

Usage: python scripts/qa_automation.py --out <shard_dir>
The shard_dir is jira/qa-automation/ inside the team data plaintext tree.
Node passes the token on stdin as a JSON line:
{"token":..., "jira_url":..., "verify_ssl":..., "project":...}
"""

import argparse
import sys
from collections import Counter, OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import re
import os

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

from _common import (
    EXIT_DATA_MISSING,
    atomic_write_shard,
    data_root_populated,
    install_sigterm_handler,
    jira_get,
    load_handoff,
    progress,
    safe_shard_key,
    _update_shard_index,
)

# -- Configuration ------------------------------------------------------------
# Adjust the saved filter names and custom field ids to your Jira instance.

BATCH = 100

FILTERS = OrderedDict([
    ('all_test_cases', 'QA All test cases'),
    ('catalog', 'QA Test cases - Catalog'),
    ('orders', 'QA Test cases - Orders'),
    ('stock', 'QA Test cases - Stock levels'),
    ('deliveries', 'QA Test cases - Deliveries'),
    ('checkout', 'QA Test cases - Checkout'),
    ('labels', 'QA Test cases - Labels'),
    ('warehouse', 'QA All test cases - Warehouse'),
    ('auto_bugs', 'QA Bugs found by automated tests'),
])

MODULE_LABELS = OrderedDict([
    ('orders', 'Orders'),
    ('checkout', 'Checkout'),
    ('warehouse', 'Warehouse'),
    ('catalog', 'Catalog'),
    ('stock', 'Stock levels'),
    ('deliveries', 'Deliveries'),
    ('labels', 'Labels'),
])

# Warehouse - an aggregate of sub-areas, has no test runs of its own.
WAREHOUSE_SUBMODULES = ('catalog', 'stock', 'deliveries', 'labels')

# Numeric custom fields, all in minutes.
FIELD_MANUAL_EFFORT = 'customfield_10101'
FIELD_AUTO_EXEC = 'customfield_10102'
FIELD_SAVINGS = 'customfield_10103'

STATUSES = [
    'Automated', 'Test', 'Open', 'In Progress',
    'New', 'Blocked', 'Closed', 'Cancelled',
]

EXCLUDED_STATUSES = {'Closed', 'Cancelled'}

TEST_RUN_WINDOW_DAYS = 7

TSTRUN_MODULE_MAP = {
    'orders': 'orders',
    'catalog': 'catalog',
    'stock levels': 'stock',
    'stock': 'stock',
    'checkout': 'checkout',
    'deliveries': 'deliveries',
    'labels': 'labels',
    'warehouse': 'warehouse',
}

TSTRUN_SUMMARY_RE = re.compile(
    r'^\[AUTO\]\s*-\s*Daily regression\s*-\s*'
    r'(?P<module>[^-]+?)\s*-\s*\d{2}\.\d{2}\.\d{4}',
    re.IGNORECASE,
)

BUG_TEST_REF_RE = re.compile(
    r'test[a-z]*\s+auto(?:mated)?\s*:?\s*([A-Z]+-\d+)',
    re.IGNORECASE,
)


def _project():
    return (load_handoff().get('project') or 'QA').strip() or 'QA'


def _test_key_re():
    return re.compile(r'\b' + re.escape(_project()) + r'-\d+\b')


# -- Jira helpers -------------------------------------------------------------

def _int_field(val):
    return int(val) if val is not None else None


def fetch_filter_statuses(filter_key, filter_name):
    jql = f'filter = "{filter_name}"'
    counts = Counter()
    tests = []
    start = 0
    while True:
        data = jira_get('/rest/api/2/search', {
            'jql': jql,
            'fields': 'status,summary,updated,created,timeoriginalestimate,labels,'
                      + ','.join((FIELD_MANUAL_EFFORT, FIELD_AUTO_EXEC, FIELD_SAVINGS)),
            'maxResults': BATCH,
            'startAt': start,
        })
        for issue in data.get('issues', []):
            status_name = issue['fields']['status']['name']
            counts[status_name] += 1
            tests.append({
                'key': issue['key'],
                'summary': issue['fields'].get('summary') or '',
                'status': status_name,
                'updated': issue['fields'].get('updated'),
                'created': issue['fields'].get('created'),
                'estimate_seconds': issue['fields'].get('timeoriginalestimate'),
                'labels': issue['fields'].get('labels') or [],
                'manual_effort_min': _int_field(issue['fields'].get(FIELD_MANUAL_EFFORT)),
                'auto_exec_min': _int_field(issue['fields'].get(FIELD_AUTO_EXEC)),
                'savings_min': _int_field(issue['fields'].get(FIELD_SAVINGS)),
            })
        batch_size = len(data.get('issues', []))
        start += batch_size
        if start >= data.get('total', 0) or batch_size == 0:
            break

    statuses = {s: counts.get(s, 0) for s in STATUSES}
    total = sum(statuses.values())
    return filter_key, {'statuses': statuses, 'total': total, 'tests': tests}


def build_estimates(all_tc_tests):
    """Estimates computed from the manual effort field (FIELD_MANUAL_EFFORT)."""
    active = [t for t in all_tc_tests if t['status'] not in EXCLUDED_STATUSES]

    def agg(items):
        with_est = [t for t in items if (t.get('manual_effort_min') or 0) > 0]
        total_min = sum(t['manual_effort_min'] for t in with_est)
        return {
            'count': len(with_est),
            'minutes': total_min,
            'hours': round(total_min / 60, 1),
            'md': round(total_min / 480, 1),
        }

    automated = [t for t in active if t['status'] == 'Automated']
    return {'automated': agg(automated), 'all': agg(active)}


def fetch_test_runs(window_days=TEST_RUN_WINDOW_DAYS):
    """Fetch [AUTO] daily regression Test Runs from last N days."""
    jql = (f'project = {_project()} AND issuetype = "Test Run" '
           f'AND summary ~ "\\\\[AUTO\\\\]" AND updated >= -{window_days}d '
           f'ORDER BY created DESC')
    runs = []
    start = 0
    raw_total = 0
    while True:
        data = jira_get('/rest/api/2/search', {
            'jql': jql,
            'fields': 'summary,description,created',
            'maxResults': BATCH,
            'startAt': start,
        })
        raw_total = data.get('total', 0)
        for issue in data.get('issues', []):
            summary = issue['fields'].get('summary') or ''
            m = TSTRUN_SUMMARY_RE.match(summary)
            if not m:
                continue
            module_label = m.group('module').strip().lower()
            module_key = TSTRUN_MODULE_MAP.get(module_label)
            if not module_key:
                continue
            description = issue['fields'].get('description') or ''
            test_keys = sorted(set(_test_key_re().findall(description)))
            runs.append({
                'run_key': issue['key'],
                'module_key': module_key,
                'created': issue['fields'].get('created'),
                'summary': summary,
                'test_count': len(test_keys),
                'test_keys': test_keys,
            })
        batch_size = len(data.get('issues', []))
        start += batch_size
        if start >= raw_total or batch_size == 0:
            break
    return runs, raw_total


def fetch_bug_descriptions(bug_keys):
    """Fetch descriptions for a list of bug issue keys."""
    if not bug_keys:
        return {}
    result = {}
    for i in range(0, len(bug_keys), 50):
        chunk = bug_keys[i:i + 50]
        jql = f'key in ({",".join(chunk)})'
        start = 0
        while True:
            data = jira_get('/rest/api/2/search', {
                'jql': jql, 'fields': 'description',
                'maxResults': BATCH, 'startAt': start,
            })
            for issue in data.get('issues', []):
                result[issue['key']] = issue['fields'].get('description') or ''
            batch_size = len(data.get('issues', []))
            start += batch_size
            if start >= data.get('total', 0) or batch_size == 0:
                break
    return result


def extract_test_ref(description):
    """Extract first test case key from 'Test auto: XYZ-123' pattern."""
    if not description:
        return None
    m = BUG_TEST_REF_RE.search(description)
    return m.group(1) if m else None


def build_run_stats(runs):
    """Aggregate per-module and per-test-case run counts."""
    by_module = {}
    per_test = {}
    for run in runs:
        mk = run['module_key']
        if mk not in by_module:
            by_module[mk] = {'runs': 0, 'executions': 0, 'last_run_at': None, 'last_run_key': None}
        by_module[mk]['runs'] += 1
        by_module[mk]['executions'] += run['test_count']
        if not by_module[mk]['last_run_at'] or run['created'] > by_module[mk]['last_run_at']:
            by_module[mk]['last_run_at'] = run['created']
            by_module[mk]['last_run_key'] = run['run_key']

        for tk in run['test_keys']:
            if tk not in per_test:
                per_test[tk] = {'runs': 0, 'last_run_at': None, 'last_run_key': None}
            per_test[tk]['runs'] += 1
            if not per_test[tk]['last_run_at'] or run['created'] > per_test[tk]['last_run_at']:
                per_test[tk]['last_run_at'] = run['created']
                per_test[tk]['last_run_key'] = run['run_key']

    total_runs = sum(m['runs'] for m in by_module.values())
    total_executions = sum(m['executions'] for m in by_module.values())
    return {
        'meta': {'window_days': TEST_RUN_WINDOW_DAYS, 'prefix': '[AUTO]'},
        'total_runs': total_runs,
        'total_executions': total_executions,
        'by_module': by_module,
        'per_test': per_test,
    }


def calc_coverage(statuses, total):
    excluded = sum(statuses.get(s, 0) for s in EXCLUDED_STATUSES)
    active_total = total - excluded
    automated = statuses.get('Automated', 0)
    if active_total <= 0:
        return 0, 0, 0
    pct = round(automated / active_total * 100, 2)
    return active_total, automated, pct


# -- Main ---------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True, help='Output shard directory (jira/qa-automation/)')
    args = parser.parse_args()
    out_dir = args.out
    install_sigterm_handler()

    # Load handoff from stdin (token + jira_url + verify_ssl).
    load_handoff()

    total_tasks = len(FILTERS) + 1  # +1 for test runs
    done = 0

    progress(0, total_tasks, 'Fetching data from Jira...')
    print(f'Parallel fetch: {len(FILTERS)} filters + test runs ({TEST_RUN_WINDOW_DAYS}d)', flush=True)

    raw_filters = {}
    run_stats = None
    failed_tasks = []

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {}
        for key, name in FILTERS.items():
            futures[pool.submit(fetch_filter_statuses, key, name)] = ('filter', key)
        futures[pool.submit(fetch_test_runs)] = ('runs', 'test_runs_7d')

        for future in as_completed(futures):
            kind, ident = futures[future]
            done += 1
            try:
                if kind == 'filter':
                    fkey, fdata = future.result()
                    raw_filters[fkey] = fdata
                    auto = fdata['statuses'].get('Automated', 0)
                    msg = f'Filter {fkey}: {auto}/{fdata["total"]} automated'
                    progress(done, total_tasks, msg)
                    print(f'  [{done}/{total_tasks}] {msg}', flush=True)
                elif kind == 'runs':
                    runs, raw_total = future.result()
                    run_stats = build_run_stats(runs)
                    msg = (f'Test runs ({TEST_RUN_WINDOW_DAYS}d): {run_stats["total_runs"]} runs, '
                           f'{run_stats["total_executions"]} executions (raw total: {raw_total})')
                    progress(done, total_tasks, msg)
                    print(f'  [{done}/{total_tasks}] {msg}', flush=True)
            except Exception as e:
                print(f'  ERROR [{ident}]: {e}', file=sys.stderr, flush=True)
                progress(done, total_tasks, f'Error: {ident}')
                failed_tasks.append(ident)

    # Abort before writing anything if any fetch failed.
    if failed_tasks:
        print(
            f'ERROR: fetch failed for: {", ".join(str(t) for t in failed_tasks)}. '
            'Writing nothing so the last good data is not overwritten.',
            file=sys.stderr, flush=True,
        )
        sys.exit(1)

    # Abort if any required module ended up without data.
    missing_modules = [k for k in MODULE_LABELS if k not in raw_filters]
    if missing_modules:
        print(
            f'ERROR: missing data for areas: {", ".join(missing_modules)}. '
            'Writing nothing.',
            file=sys.stderr, flush=True,
        )
        sys.exit(1)

    # -- Build modules list ---------------------------------------------------

    print('Building the area list...', flush=True)
    modules = []
    run_per_test = (run_stats or {}).get('per_test', {})
    run_by_module = (run_stats or {}).get('by_module', {})

    # Aggregate warehouse runs from its sub-areas.
    ngm_runs = sum(run_by_module.get(k, {}).get('runs', 0) for k in WAREHOUSE_SUBMODULES)
    ngm_exec = sum(run_by_module.get(k, {}).get('executions', 0) for k in WAREHOUSE_SUBMODULES)
    ngm_last = max(
        ((run_by_module[k]['last_run_at'], run_by_module[k]['last_run_key'])
         for k in WAREHOUSE_SUBMODULES
         if run_by_module.get(k, {}).get('last_run_at')),
        default=(None, None),
    )
    run_by_module['warehouse'] = {
        'runs': ngm_runs,
        'executions': ngm_exec,
        'last_run_at': ngm_last[0],
        'last_run_key': ngm_last[1],
    }

    for key, label in MODULE_LABELS.items():
        fdata = raw_filters.get(key)
        if not fdata:
            continue
        active_total, automated, coverage_pct = calc_coverage(fdata['statuses'], fdata['total'])
        active_tests = [t for t in fdata.get('tests', []) if t['status'] not in EXCLUDED_STATUSES]
        for t in active_tests:
            rt = run_per_test.get(t['key'])
            t['runs_7d'] = rt['runs'] if rt else 0
            t['last_run_at'] = rt['last_run_at'] if rt else None
            t['last_run_key'] = rt['last_run_key'] if rt else None
        mod_runs = run_by_module.get(key, {})
        pracochlonnosc_total = sum((t.get('manual_effort_min') or 0) for t in active_tests)
        auto_exec_total = sum((t.get('auto_exec_min') or 0) for t in active_tests)
        oszczednosc_total = sum((t.get('savings_min') or 0) for t in active_tests)
        modules.append({
            'key': key,
            'label': label,
            'total': fdata['total'],
            'active_total': active_total,
            'automated': automated,
            'coverage_pct': coverage_pct,
            'statuses': fdata['statuses'],
            'tests': active_tests,
            'runs_7d': mod_runs.get('runs', 0),
            'executions_7d': mod_runs.get('executions', 0),
            'last_run_at': mod_runs.get('last_run_at'),
            'last_run_key': mod_runs.get('last_run_key'),
            'manual_effort_min_total': pracochlonnosc_total,
            'auto_exec_min_total': auto_exec_total,
            'savings_min_total': oszczednosc_total,
        })
        print(f'  {label}: {automated}/{active_total} ({coverage_pct}%) - '
              f'{mod_runs.get("runs", 0)} runs, {mod_runs.get("executions", 0)} executions (7d)', flush=True)

    # -- Aggregate ------------------------------------------------------------

    all_tc = raw_filters.get('all_test_cases', {'statuses': {}, 'total': 0})
    agg_active, agg_auto, agg_pct = calc_coverage(all_tc['statuses'], all_tc['total'])
    print(f'Aggregate (all_test_cases): {agg_auto}/{agg_active} ({agg_pct}%)', flush=True)

    # -- Bugs found -----------------------------------------------------------

    bugs = raw_filters.get('auto_bugs', {'statuses': {}, 'total': 0, 'tests': []})
    bugs_closed = bugs['statuses'].get('Closed', 0)
    bugs_cancelled = bugs['statuses'].get('Cancelled', 0)

    bug_keys = [b['key'] for b in bugs.get('tests', [])]
    print(f'Fetching descriptions of {len(bug_keys)} bugs...', flush=True)
    bug_descriptions = fetch_bug_descriptions(bug_keys)
    bugs_list = [
        {
            'key': b['key'],
            'summary': b['summary'],
            'status': b['status'],
            'labels': b.get('labels', []),
            'updated': b.get('updated'),
            'test_ref': extract_test_ref(bug_descriptions.get(b['key'], '')),
        }
        for b in bugs.get('tests', [])
    ]
    bugs_with_ref = sum(1 for b in bugs_list if b['test_ref'])
    print(f'Bugs: {bugs["total"]} total ({bugs_closed} closed, {bugs_cancelled} cancelled), '
          f'{bugs_with_ref} with a "Test auto:" reference', flush=True)

    # -- Build aggregates -----------------------------------------------------

    generated_at = datetime.now().astimezone().isoformat()
    aggregate = {
        'total': all_tc['total'],
        'active_total': agg_active,
        'automated': agg_auto,
        'coverage_pct': agg_pct,
    }
    bugs_found = {
        'total': bugs['total'],
        'closed': bugs_closed,
        'cancelled': bugs_cancelled,
        'list': bugs_list,
    }
    estimates = build_estimates(all_tc.get('tests', []))
    test_runs_summary = {
        'meta': (run_stats or {}).get('meta', {'window_days': TEST_RUN_WINDOW_DAYS, 'prefix': '[AUTO]'}),
        'total_runs': (run_stats or {}).get('total_runs', 0),
        'total_executions': (run_stats or {}).get('total_executions', 0),
    } if run_stats else None

    # -- Shard write ----------------------------------------------------------

    # The run takes up to 20 minutes and the evening clear-plaintext may have
    # wiped the team data tree meanwhile. out_dir is <root>/jira/qa-automation;
    # write only while <root> still holds the decrypted data, and never rebuild
    # it (a recreated half-tree would read as deletions on the next push).
    data_root = os.path.dirname(os.path.dirname(os.path.abspath(out_dir)))
    if not data_root_populated(data_root):
        print('ERROR: the team data directory vanished during the refresh '
              '- nothing was written.', file=sys.stderr, flush=True)
        sys.exit(EXIT_DATA_MISSING)
    jira_dir = os.path.dirname(os.path.abspath(out_dir))
    if not os.path.isdir(jira_dir):
        os.mkdir(jira_dir)
    if not os.path.isdir(out_dir):
        os.mkdir(out_dir)
    shard_to_module = {}
    for mod_entry in modules:
        mod_key = mod_entry.get('key', '')
        if not mod_key:
            continue
        shard_key = safe_shard_key(mod_key)
        shard_to_module[shard_key] = mod_key
        atomic_write_shard(out_dir, shard_key, mod_entry, prefix='module-')

    _update_shard_index(
        out_dir,
        keys_present=sorted(shard_to_module.keys()),
        meta_overrides={
            'generated_at': generated_at,
            'shard_to_module': shard_to_module,
            'aggregates': {
                'aggregate': aggregate,
                'bugs_found': bugs_found,
                'estimates': estimates,
                'test_runs': test_runs_summary,
            },
        },
        compute_sprint_range=False,
    )

    # Remove the legacy monolith file if present (shards are the source of
    # truth; SHARD_DUAL_WRITE=1 re-enables it for debugging).
    monolith = os.path.join(os.path.dirname(out_dir), 'qa-automation.json')
    if os.environ.get('SHARD_DUAL_WRITE', '0') != '1' and os.path.exists(monolith):
        os.remove(monolith)

    print(f'Saved: {out_dir} ({len(shard_to_module)} shards)', flush=True)
    progress(total_tasks, total_tasks, 'Done')


if __name__ == '__main__':
    main()
