"""Shared Microsoft session seed (one file for every SSO module on this machine).

Each SSO module keeps its own Playwright storage_state. This helper keeps ONE
extra file, the seed (data/sso-shared/microsoft-session.json under the
app root, gitignored with the rest of data/), holding the union of the
cookies of every successful login or keepalive. A module that has to log in
first tries a headless context loaded from the seed: the Microsoft cookies in
it (ESTSAUTHPERSISTENT and friends) let the sign-in pass without a window.
Only when that fails does the module open a visible window.

Cookie values never leave the files: nothing here prints, logs or returns
them. Each SSO module keeps its own copy of this file - modules do not import
from each other.
"""

import json
import os
import time
from pathlib import Path


def merge_states(base, add, now=None):
    """Union of two storage_state dicts by (name, domain, path); `add` wins.

    Expired cookies (expires > 0 and in the past) are dropped. Origins
    (localStorage) are not carried - only cookies matter for SSO.
    """
    now = time.time() if now is None else now
    merged = {}
    for state in (base or {}, add or {}):
        for c in state.get("cookies") or []:
            if not isinstance(c, dict) or "name" not in c or "domain" not in c:
                continue
            exp = c.get("expires", -1)
            if isinstance(exp, (int, float)) and exp > 0 and exp < now:
                continue
            merged[(c["name"], c["domain"], c.get("path", "/"))] = c
    return {"cookies": list(merged.values()), "origins": []}


def seed_exists(seed_path):
    return bool(seed_path) and Path(seed_path).is_file()


def merge_into_seed(state, seed_path):
    """Merge one storage_state dict into the seed file (tmp + rename, mode 600).

    Best-effort: a failure here must never fail the login or the probe.
    """
    if not seed_path:
        return False
    try:
        seed_path = Path(seed_path)
        base = {}
        if seed_path.is_file():
            try:
                base = json.loads(seed_path.read_text("utf-8"))
            except Exception:  # noqa: BLE001 - a corrupt seed is rebuilt from scratch
                base = {}
        merged = merge_states(base, state)
        seed_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(seed_path.parent, 0o700)
        except OSError:
            pass
        tmp = seed_path.with_name(seed_path.name + f".{os.getpid()}.tmp")
        tmp.write_text(json.dumps(merged), "utf-8")
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, seed_path)
        return True
    except Exception:  # noqa: BLE001
        return False


def merge_file_into_seed(session_file, seed_path):
    try:
        state = json.loads(Path(session_file).read_text("utf-8"))
    except Exception:  # noqa: BLE001
        return False
    return merge_into_seed(state, seed_path)
