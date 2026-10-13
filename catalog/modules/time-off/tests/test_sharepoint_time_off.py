"""Pytest for the pure/IO parts of scripts/sharepoint_time_off.py.

Run manually (not part of `npm test`):
    python3 -m pytest catalog/modules/time-off/tests/ -q

No Playwright browser is needed: the script imports playwright.sync_api
lazily inside main()/download_xlsx()/... , never at module load time, so
importing the module here never touches a browser.
"""

import importlib.util
import json
import sys
from datetime import datetime
from pathlib import Path

import openpyxl
import pytest

sys.dont_write_bytecode = True  # keep __pycache__ out of the module directory

HERE = Path(__file__).resolve().parent
SCRIPT_PATH = HERE.parent / "scripts" / "sharepoint_time_off.py"
FIXTURES_DIR = HERE / "fixtures"


def _load_module():
    spec = importlib.util.spec_from_file_location("sharepoint_time_off", str(SCRIPT_PATH))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sp = _load_module()

HEADERS = [
    "Id",
    "Start time",
    "Completion time",
    "Email",
    "Name",
    "Full name",
    "First day off",
    "Last day off",
]


def _build_xlsx(path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ws.append(HEADERS)
    ws.append([
        1,
        datetime(2026, 9, 1, 10, 0),
        datetime(2026, 9, 1, 10, 5),
        "casey.novak@example.com",
        "Time-off form",
        "Alex Morgan",
        datetime(2026, 9, 8),
        datetime(2026, 9, 19),
    ])
    ws.append([
        2,
        datetime(2026, 10, 2, 9, 0),
        datetime(2026, 10, 2, 9, 3),
        "sam.rivera@example.com",
        "Time-off form",
        "Sam Rivera",
        datetime(2026, 10, 5),
        datetime(2026, 10, 9),
    ])
    ws.append([
        3,
        datetime(2026, 11, 1, 8, 0),
        None,
        "incomplete@example.com",
        "Time-off form",
        "Incomplete Person",
        None,
        None,
    ])
    wb.save(str(path))


@pytest.fixture()
def xlsx_path(tmp_path):
    path = tmp_path / "time-off.xlsx"
    _build_xlsx(path)
    return path


def test_xlsx_to_records_returns_iso_dates(xlsx_path):
    records = sp.xlsx_to_records(xlsx_path)
    assert len(records) == 3
    assert records[0]["Full name"] == "Alex Morgan"
    assert records[0]["First day off"] == datetime(2026, 9, 8).isoformat()
    assert records[0]["Last day off"] == datetime(2026, 9, 19).isoformat()
    assert records[2]["First day off"] is None


def test_records_to_shards_slugs_by_person_not_submitter(xlsx_path):
    records = sp.xlsx_to_records(xlsx_path)
    shards, skipped = sp.records_to_shards(records)

    assert "alex-morgan" in shards
    assert "casey-novak" not in shards
    assert skipped == 1

    entry = shards["alex-morgan"]["entries"][0]
    assert entry["submittedBy"] == "casey.novak@example.com"
    assert entry["dateFrom"] == "2026-09-08"
    assert entry["dateTo"] == "2026-09-19"


def test_write_shards_second_run_is_a_noop_when_unchanged(tmp_path, xlsx_path):
    records = sp.xlsx_to_records(xlsx_path)
    shards, skipped = sp.records_to_shards(records)
    dest = tmp_path / "time-off"

    first = sp.write_shards(dest, shards, "2026-09-06T10:00:00+00:00", None, skipped)
    assert first["changed"] == 2
    person_file = dest / "people" / "alex-morgan.json"
    assert person_file.exists()
    mtime_after_first = person_file.stat().st_mtime

    index_after_first = json.loads((dest / "index.json").read_text(encoding="utf-8"))
    assert "alex-morgan" in index_after_first["persons"]
    assert index_after_first["persons"]["alex-morgan"]["last_changed"] == "2026-09-06T10:00:00+00:00"

    second = sp.write_shards(dest, shards, "2026-09-06T11:00:00+00:00", None, skipped)
    assert second["changed"] == 0
    assert person_file.stat().st_mtime == mtime_after_first


def test_write_shards_removes_person_missing_from_new_run(tmp_path, xlsx_path):
    records = sp.xlsx_to_records(xlsx_path)
    shards, skipped = sp.records_to_shards(records)
    dest = tmp_path / "time-off"

    sp.write_shards(dest, shards, "2026-09-06T10:00:00+00:00", None, skipped)
    assert (dest / "people" / "sam-rivera.json").exists()

    shards_without_sam = {k: v for k, v in shards.items() if k != "sam-rivera"}
    result = sp.write_shards(dest, shards_without_sam, "2026-09-06T12:00:00+00:00", None, skipped)

    assert result["removed"] == 1
    assert not (dest / "people" / "sam-rivera.json").exists()
    assert (dest / "people" / "alex-morgan.json").exists()


def test_slugify_matches_shared_fixture_cases():
    cases = json.loads((FIXTURES_DIR / "slug-cases.json").read_text(encoding="utf-8"))
    for value, expected in cases:
        assert sp.slugify(value) == expected, f"slugify({value!r}) == {sp.slugify(value)!r}, expected {expected!r}"


def test_write_shards_refuses_to_wipe_when_new_run_is_empty(tmp_path, xlsx_path):
    """An empty or broken download must never delete the team's history."""
    sp = _load_module()
    dest = tmp_path / "time-off"
    shards = sp.records_to_shards(sp.xlsx_to_records(xlsx_path))[0]
    sp.write_shards(dest, shards, "2026-09-06T10:00:00+00:00", None, 0)
    before = sorted(p.name for p in (dest / "people").glob("*.json"))
    assert before

    with pytest.raises(RuntimeError):
        sp.write_shards(dest, {}, "2026-09-06T12:00:00+00:00", None, 0)

    after = sorted(p.name for p in (dest / "people").glob("*.json"))
    assert after == before


def test_write_shards_refuses_when_more_than_half_of_people_vanish(tmp_path):
    """Losing most known people is a broken sheet, not a real change."""
    sp = _load_module()
    dest = tmp_path / "time-off"

    def shard(name):
        return {"name": name, "slug": sp.slugify(name), "entries": [
            {"dateFrom": "2026-09-01", "dateTo": "2026-09-02", "submittedAt": None, "submittedBy": None},
        ]}

    names = ["Alex Morgan", "Sam Rivera", "Jordan Lee", "Taylor Kim", "Casey Novak"]
    full = {sp.slugify(n): shard(n) for n in names}
    sp.write_shards(dest, full, "2026-09-06T10:00:00+00:00", None, 0)

    two_left = {k: full[k] for k in list(full)[:2]}
    with pytest.raises(RuntimeError):
        sp.write_shards(dest, two_left, "2026-09-06T11:00:00+00:00", None, 0)
    assert len(list((dest / "people").glob("*.json"))) == 5

    # Losing a minority is a real change and still goes through.
    four_left = {k: full[k] for k in list(full)[:4]}
    result = sp.write_shards(dest, four_left, "2026-09-06T12:00:00+00:00", None, 0)
    assert result["removed"] == 1
