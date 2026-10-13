#!/usr/bin/env python3
"""Active-sprint discovery for both Jira boards - GET /discover on the Node
side. Imports discover_all_sprints (MAIN) / discover_sprints (PLATFORM) from
the ETL scripts themselves (both parse argv through `parser.parse_args([])`
at import time when not run as __main__), so the two lists can never drift
from what a real refresh would fetch.

Usage: python discover_sprints.py --board main|platform

Every print() the imported discovery functions make is redirected to
stderr for the duration of the call - stdout carries ONLY the final JSON
line.
"""

import argparse
import contextlib
import json
import sys

import sprint_stats_main
import sprint_stats_platform


def _main_payload():
    sprint_map, board_active_n = sprint_stats_main.discover_all_sprints()
    active_ns = sorted({
        sprint_n for sprint_n, teams in sprint_map.items()
        if any((meta or {}).get('state') == 'active' for meta in teams.values())
    })
    return {
        'active_sprint_n': board_active_n,
        'active': active_ns,
        'sprints': sorted(sprint_map.keys()),
    }


def _platform_payload():
    sprints = sprint_stats_platform.discover_sprints(include_future=True)
    active_ids = sorted(s['id'] for s in sprints if s.get('state') == 'active')
    active_id = active_ids[-1] if active_ids else None
    return {
        'active_sprint_id': active_id,
        'active': active_ids,
        'sprints': [s['id'] for s in sprints],
    }


def main():
    parser = argparse.ArgumentParser(description='Active sprints on one board')
    parser.add_argument('--board', choices=['main', 'platform'], required=True)
    args = parser.parse_args()

    with contextlib.redirect_stdout(sys.stderr):
        payload = _main_payload() if args.board == 'main' else _platform_payload()

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == '__main__':
    main()
