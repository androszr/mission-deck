"""figma_reference.py -- structured Figma design reference extractor.

Port of sf-test's scripts/figma_reference.py (same output layout and
behaviour), adapted to this repository:

  * Python standard library only (urllib; no pip packages, no dotenv);
  * the Figma token NEVER comes from the environment or from .env. The server
    (server.js, handleFigmaReferenceStream) keeps it in its heap and writes it
    to this process as ONE JSON line on STDIN (`--token-stdin`,
    {"figmaToken": "..."}) - `ps eww` shows a child's environment to anyone on
    the account, a run can last minutes. Without the flag there is no token
    and the script refuses (except in `--fixture` mode, which is offline);
  * progress goes to STDOUT as `@@PROGRESS:{json}` (the convention the
    server's Python runner parses), everything else to stderr;
  * token-map.md / colors.md map each hex to the app's design tokens,
    resolved against css/ds-tokens.css and the prototype build shell's
    templates/prototype-build-shell/src/tokens.css.

Given a Figma URL (or file key + node id), extracts a COMPLETE structured
design reference for one page/section into user-data/figma-reference/<id>/:

  frames.json          machine-readable manifest (frames, sizes, sections)
  index.md             frame inventory table + file map
  section-<slug>.md    per Figma section: layout tree + text table + instances
  typography.md        aggregated typography scale across all frames
  colors.md            aggregated color palette + DS token candidates
  components.md        component-instance inventory across all frames
  layout.md            structural container stats (sizes, gaps, paddings)
  token-map.md         hex -> DS token mapping (NO-MATCH marked)
  hygiene.json         deterministic Figma-file consistency findings (5 rules,
                       see check_figma_hygiene()) -- also rendered as the
                       "## Figma hygiene" section in index.md
  screenshots/<id>.png frame renders (scale 2 by default)
  dev-mode/            placeholder dir, filled by the /figma-ref MCP loop

Usage:
  python3 scripts/figma_reference.py --token-stdin --file <FILE_KEY> --node-id 96560:26612 --out-id proto-foo [--scale 1|2] [--no-images] [--overwrite]
  python3 scripts/figma_reference.py --fixture scope.json --out-id proto-foo     (offline, no token, no images)

USER_DATA_DIR (env, optional) relocates the output root; default <project>/user-data.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import socket
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, OrderedDict
from urllib.parse import parse_qs, urlparse

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(_SCRIPT_DIR)


def _resolve_user_data_dir() -> str:
    raw = os.environ.get("USER_DATA_DIR", "").strip()
    if raw:
        return os.path.abspath(os.path.expanduser(raw))
    return os.path.join(PROJECT_ROOT, "user-data")


USER_DATA_DIR = _resolve_user_data_dir()
FIGMA_API = "https://api.figma.com/v1"

# Delays between retries on 429: wait these many seconds before attempt 2, 3, 4.
_RETRY_DELAYS = (15, 30, 60)
# Wait up to this many seconds when Figma sends a Retry-After header.
_RETRY_AFTER_MAX = 300
# Retry-After above this (1 h) is a soft ban: abort instead of sleeping.
_RETRY_AFTER_ABORT = 3600


class RequestError(Exception):
    """Network / HTTP failure (the urllib twin of requests.RequestException)."""


class _Resp:
    """Minimal response object: status_code, headers, content, json()."""

    def __init__(self, status: int, headers, content: bytes, url: str = ""):
        self.status_code = status
        self.headers = headers
        self.content = content
        self.url = url

    @property
    def ok(self) -> bool:
        return self.status_code < 400

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RequestError(f"HTTP {self.status_code} for {self.url.split('?')[0]}")

    def json(self):
        return json.loads(self.content.decode("utf-8"))


def _http_get(url: str, headers: dict | None = None, params: dict | None = None, timeout: int = 60) -> _Resp:
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - https only, fixed hosts
            return _Resp(r.status, r.headers, r.read(), url)
    except urllib.error.HTTPError as exc:
        body = b""
        try:
            body = exc.read()
        except OSError:
            pass
        return _Resp(exc.code, exc.headers, body, url)
    except (urllib.error.URLError, socket.timeout, TimeoutError, OSError) as exc:
        raise RequestError(str(exc)) from exc


def _figma_get(url: str, token: str, params: dict | None = None, timeout: int = 60) -> _Resp:
    """GET a Figma API URL with automatic retry on 429 (rate limit).

    Respects Retry-After (capped at _RETRY_AFTER_MAX); otherwise exponential
    backoff (15 s -> 30 s -> 60 s). Retry-After above _RETRY_AFTER_ABORT raises
    immediately - waiting hours is pointless.
    """
    resp = None
    for attempt, delay in enumerate((*_RETRY_DELAYS, None), start=1):
        resp = _http_get(url, headers={"X-Figma-Token": token}, params=params, timeout=timeout)
        if resp.status_code != 429:
            return resp
        if delay is None:
            resp.raise_for_status()  # exhausted retries
        raw_after = resp.headers.get("Retry-After")
        try:
            suggested = int(raw_after) if raw_after is not None else delay
        except (ValueError, TypeError):
            suggested = delay
        if suggested > _RETRY_AFTER_ABORT:
            sys.stderr.write(
                f"[figma-reference] Figma rate limit - Retry-After: {suggested}s "
                f"(soft ban, over {_RETRY_AFTER_ABORT}s). Wait a while and try again.\n"
            )
            resp.raise_for_status()
        wait = min(suggested, _RETRY_AFTER_MAX)
        sys.stderr.write(f"[figma-reference] 429 rate limit (proba {attempt}) - czekam {wait}s...\n")
        sys.stderr.flush()
        time.sleep(wait)
    return resp  # unreachable


def _sanitize(name: str) -> str:
    """Replace non-alphanumeric chars with '-', collapse repeats, trim."""
    s = re.sub(r"[^A-Za-z0-9_-]", "-", str(name))
    s = re.sub(r"-{2,}", "-", s)
    s = s.strip("-")
    return s or "unnamed"


def _deduplicate_names(names: list[str]) -> list[str]:
    """Append -2, -3, ... to duplicate names within a list."""
    seen: dict[str, int] = {}
    result = []
    for n in names:
        if n not in seen:
            seen[n] = 0
            result.append(n)
        else:
            seen[n] += 1
            result.append(f"{n}-{seen[n] + 1}")
    return result


def _atomic_write_bytes_iter(filepath: str, chunks, mode: str, encoding: str | None = None) -> None:
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(filepath), suffix=".tmp")
    try:
        with os.fdopen(fd, mode, encoding=encoding) as f:
            for chunk in chunks:
                f.write(chunk)
        os.replace(tmp, filepath)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _atomic_write(filepath: str, data) -> None:
    """Write JSON atomically via tmpfile + os.replace."""
    _atomic_write_bytes_iter(filepath, [json.dumps(data, ensure_ascii=False, indent=2)], "w", "utf-8")


def _atomic_write_text(filepath: str, text: str) -> None:
    _atomic_write_bytes_iter(filepath, [text], "w", "utf-8")


def _atomic_write_binary(filepath: str, content_iter) -> None:
    _atomic_write_bytes_iter(filepath, content_iter, "wb")


def progress(step, total, msg):
    """@@PROGRESS on STDOUT (sync_proto_analytics.py convention)."""
    pct = round(step / total * 100) if total > 0 else 0
    print(
        "@@PROGRESS:" + json.dumps({"step": step, "total": total, "pct": pct, "msg": msg}, ensure_ascii=False),
        flush=True,
    )


EXPORTABLE_TYPES = {"FRAME", "COMPONENT", "COMPONENT_SET"}
TREE_TYPES = {"FRAME", "INSTANCE", "COMPONENT", "COMPONENT_SET", "GROUP", "SECTION"}
SKIP_TYPES = {"VECTOR", "BOOLEAN_OPERATION", "LINE", "ELLIPSE", "RECTANGLE", "STAR", "REGULAR_POLYGON", "SLICE"}
MAX_TREE_LINES = 500
MAX_TREE_DEPTH = 9
MAX_TEXT_LEN = 60
EMDASH = "\u2014"

# Static semantic-role map for a common product type scale.
_TYPE_ROLES = {
    (40, 600): "H1 - page title",
    (32, 600): "H2 - large heading / KPI value",
    (24, 600): "H3 - section heading",
    (18, 600): "H5 - small heading",
    (16, 600): "P1 DemiBold - bold body",
    (16, 500): "P1 Medium - emphasized body / button label",
    (16, 400): "P1 Regular - body text",
    (14, 600): "P2 DemiBold - secondary bold",
    (14, 500): "P2 Medium - secondary emphasized",
    (14, 400): "P2 Regular - secondary body / caption",
    (12, 500): "P3 Caps Medium - table header / badge label",
    (12, 400): "P3 Regular - small caption",
    (10, 500): "P4 Caps Medium - micro label",
}


# ---------------------------------------------------------------------------
# Input resolution
# ---------------------------------------------------------------------------


def parse_figma_url(url: str) -> tuple[str, str]:
    """Extract (file_key, node_id) from a figma.com design/file URL."""
    parsed = urlparse(url)
    m = re.search(r"/(?:design|file|proto|board)/([A-Za-z0-9]+)", parsed.path or "")
    file_key = m.group(1) if m else ""
    qs = parse_qs(parsed.query or "")
    node_id = (qs.get("node-id") or [""])[0].replace("-", ":")
    return file_key, node_id


def read_token_from_stdin() -> str:
    """The Figma token arrives as ONE JSON line on stdin ({"figmaToken": ...}).

    Never from the environment or .env: the server keeps it in its heap.
    Returns '' on anything unparsable.
    """
    try:
        data = json.loads(sys.stdin.readline() or "{}")
    except ValueError:
        return ""
    if not isinstance(data, dict):
        return ""
    return str(data.get("figmaToken") or "").strip()


def fetch_image_urls_resilient(file_key: str, node_ids: list[str], scale: int, token: str) -> dict:
    """GET /v1/images in SMALL batches with long timeouts and per-batch fail-open.

    Figma renders PNGs synchronously inside this call \u2014 at scale 2 a 50-frame
    batch routinely exceeds 60s. Use batches of 15, a 180s read timeout, one
    retry per batch, and tolerate a failed batch (its ids map to None) so the
    reference bundle still completes without some screenshots.
    """
    merged: dict = {}
    batch_size = 15
    batches = [node_ids[i : i + batch_size] for i in range(0, len(node_ids), batch_size)]
    url = f"{FIGMA_API}/images/{file_key}"
    for idx, batch in enumerate(batches):
        if idx > 0:
            time.sleep(7.0)
        params = {"ids": ",".join(batch), "format": "png", "scale": str(scale)}
        got = None
        for attempt in (1, 2):
            try:
                resp = _figma_get(url, token, params=params, timeout=180)
                resp.raise_for_status()
                got = (resp.json() or {}).get("images") or {}
                break
            except RequestError as exc:
                print(
                    f"[figma-reference] images batch {idx + 1}/{len(batches)} proba {attempt} nieudana: {exc}",
                    file=sys.stderr,
                )
                if attempt == 1:
                    time.sleep(15)
        if got is None:
            got = {nid: None for nid in batch}
        merged.update(got)
    return merged


def load_fixture(path: str) -> tuple[str, str, dict]:
    """Offline scope for tests: {fileName, lastModified, scope} or a bare node."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f) or {}
    if "scope" in data:
        return data.get("fileName") or "", data.get("lastModified") or "", data["scope"] or {}
    return "fixture", "", data


def reference_complete(out_dir: str, file_key: str, node_id: str, scale: int, no_images: bool) -> str:
    """lastModified of an existing, COMPLETE reference for exactly this scope, else "".

    Complete = frames.json for the same fileKey/nodeId/scale and (unless no_images)
    every PNG it lists on disk. The manifest is written before the images, so an
    interrupted export has a manifest but missing PNGs - that is not complete.
    """
    try:
        with open(os.path.join(out_dir, "frames.json"), encoding="utf-8") as f:
            prev = json.load(f) or {}
    except (OSError, ValueError):
        return ""
    if prev.get("fileKey") != file_key or (prev.get("nodeId") or "") != node_id or prev.get("scale") != scale:
        return ""
    if not no_images:
        for sec in prev.get("sections") or []:
            for fr in sec.get("frames") or []:
                if not os.path.isfile(os.path.join(out_dir, fr.get("png") or "")):
                    return ""
    return prev.get("lastModified") or ""


def reference_up_to_date(out_dir: str, file_key: str, node_id: str, scale: int, no_images: bool, token: str) -> bool:
    """True when the complete local reference matches the file's current lastModified."""
    have = reference_complete(out_dir, file_key, node_id, scale, no_images)
    if not have:
        return False
    try:
        resp = _figma_get(f"{FIGMA_API}/files/{file_key}", token, params={"depth": 1}, timeout=60)
        resp.raise_for_status()
        current = (resp.json() or {}).get("lastModified") or ""
    except (RequestError, ValueError) as exc:
        print(f"[figma-reference] lastModified check failed ({exc}) - full export", file=sys.stderr)
        return False
    return bool(current) and current == have


def fetch_scope(file_key: str, node_id: str, token: str) -> tuple[str, str, dict]:
    """Fetch the target scope. Returns (file_name, last_modified, scope_node).

    scope_node is the CANVAS / SECTION / FRAME the node id points at, or the
    whole document (type DOCUMENT) when node_id is empty.
    """
    if node_id:
        url = f"{FIGMA_API}/files/{file_key}/nodes"
        resp = _figma_get(url, token, params={"ids": node_id}, timeout=120)
        resp.raise_for_status()
        data = resp.json() or {}
        nodes = data.get("nodes") or {}
        entry = nodes.get(node_id) or {}
        doc = entry.get("document")
        if not doc:
            raise SystemExit(f"[figma-reference] node {node_id} not found in file {file_key}")
        return data.get("name") or "", data.get("lastModified") or "", doc
    url = f"{FIGMA_API}/files/{file_key}"
    resp = _figma_get(url, token, timeout=180)
    resp.raise_for_status()
    data = resp.json() or {}
    return data.get("name") or "", data.get("lastModified") or "", data.get("document") or {}


# ---------------------------------------------------------------------------
# Section / frame collection
# ---------------------------------------------------------------------------


def _bbox(node: dict) -> tuple[float, float]:
    bb = node.get("absoluteBoundingBox") or {}
    return bb.get("width") or 0, bb.get("height") or 0


def collect_sections(scope: dict) -> list[dict]:
    """Group top-level frames by Figma SECTION.

    Returns [{name, id, frames: [node, ...]}]; frames outside any section go
    into a trailing 'Standalone frames' group. Nested sections become their own
    groups. Frame order follows canvas order.
    """
    sections: list[dict] = []
    standalone: list[dict] = []

    def _walk_container(node: dict, into: list[dict]) -> None:
        for child in node.get("children") or []:
            ctype = child.get("type")
            if ctype == "SECTION":
                sec = {"name": child.get("name") or "Section", "id": child.get("id") or "", "frames": []}
                sections.append(sec)
                _walk_container(child, sec["frames"])
            elif ctype in EXPORTABLE_TYPES or ctype == "INSTANCE":
                # Top-level INSTANCE nodes on the canvas are designed screen
                # states (modal overlays, toasts) - include them as frames.
                into.append(child)
            elif ctype == "GROUP":
                _walk_container(child, into)

    stype = scope.get("type")
    if stype == "SECTION":
        sec = {"name": scope.get("name") or "Section", "id": scope.get("id") or "", "frames": []}
        sections.append(sec)
        _walk_container(scope, sec["frames"])
    elif stype in EXPORTABLE_TYPES:
        standalone.append(scope)
    elif stype == "DOCUMENT":
        for page in scope.get("children") or []:
            _walk_container(page, standalone)
    else:  # CANVAS
        _walk_container(scope, standalone)

    if standalone:
        sections.append({"name": "Standalone frames", "id": "", "frames": standalone})
    return [s for s in sections if s["frames"]]


# ---------------------------------------------------------------------------
# Style helpers
# ---------------------------------------------------------------------------


def _to_hex(color: dict) -> str:
    r = round((color.get("r") or 0) * 255)
    g = round((color.get("g") or 0) * 255)
    b = round((color.get("b") or 0) * 255)
    return f"#{r:02x}{g:02x}{b:02x}"


def _solid_paint_hex(paints: list | None) -> str:
    """First visible SOLID paint -> '#rrggbb' or '#rrggbb (NN%)'. '' if none."""
    for paint in paints or []:
        if paint.get("visible") is False:
            continue
        if paint.get("type") != "SOLID":
            continue
        color = paint.get("color") or {}
        hexval = _to_hex(color)
        alpha = paint.get("opacity", 1)
        ca = color.get("a", 1)
        eff = (alpha if alpha is not None else 1) * (ca if ca is not None else 1)
        if eff < 0.999:
            return f"{hexval} ({round(eff * 100)}%)"
        return hexval
    return ""


def _pad_str(node: dict) -> str:
    t = node.get("paddingTop") or 0
    r = node.get("paddingRight") or 0
    b = node.get("paddingBottom") or 0
    left = node.get("paddingLeft") or 0
    if not any((t, r, b, left)):
        return ""
    vals = [_fmt_num(v) for v in (t, r, b, left)]
    if len(set(vals)) == 1:
        return f"pad={vals[0]}"
    if vals[0] == vals[2] and vals[1] == vals[3]:
        return f"pad={vals[0]}/{vals[1]}"
    return f"pad={vals[0]}/{vals[1]}/{vals[2]}/{vals[3]} (t/r/b/l)"


def _fmt_num(v) -> str:
    if v is None:
        return "0"
    f = float(v)
    return str(int(f)) if f == int(f) else f"{f:g}"


def _border_str(node: dict) -> str:
    stroke = _solid_paint_hex(node.get("strokes"))
    if not stroke:
        return ""
    isw = node.get("individualStrokeWeights")
    if isw:
        parts = []
        for side, suffix in (("top", "t"), ("right", "r"), ("bottom", "b"), ("left", "l")):
            if (isw.get(side) or 0) > 0:
                parts.append(f"border-{suffix}={stroke}")
        return " ".join(parts)
    if (node.get("strokeWeight") or 0) > 0:
        return f"border={stroke}"
    return ""


def _radius_str(node: dict) -> str:
    r = node.get("cornerRadius")
    if r:
        return f"r={_fmt_num(r)}"
    radii = node.get("rectangleCornerRadii")
    if radii and any(radii):
        return "r=" + "/".join(_fmt_num(x) for x in radii)
    return ""


def _node_decor(node: dict) -> str:
    """Layout decorations for a tree line: gap, pad, bg, radius, border."""
    parts = []
    gap = node.get("itemSpacing")
    if gap:
        parts.append(f"gap={_fmt_num(gap)}")
    pad = _pad_str(node)
    if pad:
        parts.append(pad)
    bg = _solid_paint_hex(node.get("fills"))
    if bg:
        parts.append(f"bg={bg}")
    rad = _radius_str(node)
    if rad:
        parts.append(rad)
    border = _border_str(node)
    if border:
        parts.append(border)
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Frame walkers
# ---------------------------------------------------------------------------


def build_tree_lines(frame: dict) -> list[str]:
    """Render the auto-layout / instance tree of one frame (golden format)."""
    lines: list[str] = []
    truncated = [0]

    def _visit(node: dict, depth: int) -> None:
        ntype = node.get("type")
        if ntype == "TEXT" or ntype in SKIP_TYPES:
            return
        if ntype in TREE_TYPES:
            if len(lines) >= MAX_TREE_LINES or depth > MAX_TREE_DEPTH:
                truncated[0] += 1
                return
            w, h = _bbox(node)
            layout = node.get("layoutMode") or ""
            dir_tag = {"HORIZONTAL": "H ", "VERTICAL": "V "}.get(layout, "")
            inst = " [inst]" if ntype == "INSTANCE" else ""
            decor = _node_decor(node)
            line = f"{'  ' * depth}- {node.get('name') or ntype}{inst}: {dir_tag}{_fmt_num(w)}x{_fmt_num(h)}"
            if decor:
                line += f" {decor}"
            lines.append(line)
            for child in node.get("children") or []:
                _visit(child, depth + 1)
        else:
            for child in node.get("children") or []:
                _visit(child, depth)

    _visit(frame, 0)
    if truncated[0]:
        lines.append(f"... (truncated: {truncated[0]} more nodes)")
    return lines


def _short_path(ancestors: list[str]) -> str:
    return " / ".join(ancestors[-4:])


def collect_texts(frame: dict) -> list[dict]:
    """All TEXT nodes: {size, weight, lh, ls, text, color, path}."""
    out: list[dict] = []

    def _visit(node: dict, ancestors: list[str]) -> None:
        if node.get("type") == "TEXT":
            style = node.get("style") or {}
            out.append(
                {
                    "size": round(style.get("fontSize") or 0),
                    "weight": round(style.get("fontWeight") or 400),
                    "lh": round(style.get("lineHeightPx") or 0),
                    "ls": round(style.get("letterSpacing") or 0, 2),
                    "text": (node.get("characters") or "").replace("\n", " \u23ce "),
                    "color": _solid_paint_hex(node.get("fills")),
                    "path": _short_path(ancestors),
                }
            )
            return
        name = node.get("name") or ""
        for child in node.get("children") or []:
            _visit(child, ancestors + [name] if name else ancestors)

    for child in frame.get("children") or []:
        _visit(child, [])
    return out


def _props_str(node: dict) -> str:
    props = node.get("componentProperties") or {}
    if not props:
        return ""
    parts = []
    for key in sorted(props):
        raw = props[key]
        val = raw.get("value") if isinstance(raw, dict) else raw
        clean_key = key.split("#")[0]
        parts.append(f"{clean_key}={val}")
    return ", ".join(parts)


def collect_instances(frame: dict) -> list[dict]:
    """All INSTANCE nodes: {id, name, props, size, w, h, pad, gap}.

    'id'/'w'/'h'/'pad'/'gap' are ADDITIVE fields on top of the original
    {name, props, size} shape -- render_section_md() (and every other reader
    that pre-dates this plan) only ever reads 'name'/'props'/'size' and keeps
    working unchanged. 'pad' is read straight off the INSTANCE node's own
    auto-layout fields: {"top", "right", "bottom", "left"} in px (0 when the
    node has no padding). 'gap' is the node's own itemSpacing in px (0 when
    absent). Both are numeric (float/int from the Figma REST payload), NOT
    the catalog's CSS-shorthand strings -- see normalize_css_padding() /
    normalize_css_gap() in the "Figma hygiene" section below for the
    string<->numeric bridge used by check_figma_hygiene's catalog-vs-instance
    rule.
    """
    out: list[dict] = []

    def _visit(node: dict) -> None:
        if node.get("type") == "INSTANCE":
            w, h = _bbox(node)
            out.append(
                {
                    "id": node.get("id") or "",
                    "name": node.get("name") or "",
                    "props": _props_str(node),
                    "size": f"{_fmt_num(w)}x{_fmt_num(h)}",
                    "w": w,
                    "h": h,
                    "pad": {
                        "top": node.get("paddingTop") or 0,
                        "right": node.get("paddingRight") or 0,
                        "bottom": node.get("paddingBottom") or 0,
                        "left": node.get("paddingLeft") or 0,
                    },
                    "gap": node.get("itemSpacing") or 0,
                }
            )
        for child in node.get("children") or []:
            _visit(child)

    _visit(frame)
    return out


def collect_colors(frame: dict, agg: dict) -> None:
    """Aggregate color usage into agg: hex -> {kinds Counter, contexts Counter}."""

    def _add(hexval: str, kind: str, ctx: str) -> None:
        if not hexval:
            return
        entry = agg.setdefault(hexval, {"kinds": Counter(), "contexts": Counter()})
        entry["kinds"][kind] += 1
        if ctx:
            entry["contexts"][ctx] += 1

    def _visit(node: dict, ancestors: list[str]) -> None:
        ntype = node.get("type")
        name = node.get("name") or ""
        ctx = _short_path(ancestors[-2:] + [name]) if name else _short_path(ancestors)
        if ntype == "TEXT":
            _add(_solid_paint_hex(node.get("fills")), "text", _short_path(ancestors))
        elif ntype in SKIP_TYPES:
            _add(_solid_paint_hex(node.get("fills")), "icon/vector", _short_path(ancestors))
        else:
            _add(_solid_paint_hex(node.get("fills")), "fill", ctx)
        _add(_solid_paint_hex(node.get("strokes")), "border", ctx)
        for child in node.get("children") or []:
            _visit(child, ancestors + [name] if name else ancestors)

    _visit(frame, [])


def collect_containers(frame: dict, agg: dict) -> None:
    """Aggregate structural container stats: name -> sizes/gaps/pads Counters."""

    def _visit(node: dict) -> None:
        ntype = node.get("type")
        if ntype in TREE_TYPES and ntype != "SECTION":
            name = node.get("name") or ntype
            w, h = _bbox(node)
            entry = agg.setdefault(name, {"count": 0, "sizes": Counter(), "gaps": Counter(), "pads": Counter()})
            entry["count"] += 1
            entry["sizes"][f"{_fmt_num(w)}x{_fmt_num(h)}"] += 1
            gap = node.get("itemSpacing")
            if gap:
                entry["gaps"][_fmt_num(gap)] += 1
            pad = _pad_str(node)
            if pad:
                entry["pads"][pad.replace("pad=", "")] += 1
        for child in node.get("children") or []:
            _visit(child)

    _visit(frame)


# ---------------------------------------------------------------------------
# Figma hygiene -- deterministic design-file consistency checks (D2b/D2c)
#
# Five rules, all operating on data already collected in main() (frame_meta,
# texts_by_frame, sections) plus a caller-supplied "resolved" slice of the DS
# catalog (catalog_variants) -- NEVER touching the network, a token, or the
# 76 MB shard directories directly. Catalog access is split into three
# layers so check_figma_hygiene() itself stays a pure function over plain
# dicts/lists (trivially fixture-able in tests, no disk, no monkeypatching):
#
#   1. load_catalog_component_index(catalog_root=None)
#        I/O. Reads ONLY the two SLIM indexes
#        docs/design-system/figma-components-{web,mobile}.json (~180 KB +
#        ~104 KB) and returns {component_name: {"platform", "shard"}} where
#        "shard" is the shard's path relative to docs/design-system/ (e.g.
#        "figma-components-web/sidebar.json"). Mobile is indexed first, then
#        web (same "mobile wins on name collision" convention as
#        check_proto_ds.py's suspect-registration check), so an entry present
#        on both platforms resolves to its mobile shard.
#
#   2. resolve_catalog_variants(names, index, catalog_root=None)
#        I/O, lazy + cached by shard path (module-level _SHARD_CACHE). For
#        each name in `names` that IS present in `index`, opens ONLY that
#        one shard file (never os.listdir()'s the shard directory), finds
#        the top-level component entry whose own "name" matches, and returns
#        that entry's `render.children` list verbatim (each child already
#        shaped like the catalog file: {"name": "expand=off, variant=x",
#        "css": {"padding": "0px 8.0px", "gap": "2.0px", ...}, ...}). A name
#        with no index entry, or a shard that fails to parse, maps to [] --
#        never raises. Returns {component_name: [variant_dict, ...]}.
#
#   3. check_figma_hygiene(sections, frame_meta, texts_by_frame, catalog_variants)
#        PURE -- no disk, no network, no token. `catalog_variants` is exactly
#        the dict returned by resolve_catalog_variants() above, OR (this is
#        the fixture injection point for tests) any hand-built dict of the
#        same shape, e.g.:
#            {"uni / badge": [{"name": "size=big", "css": {"padding": "0px 8.0px", "gap": "0px"}}]}
#        No disk access happens inside check_figma_hygiene() itself.
#
# Parameter shapes for check_figma_hygiene(sections, frame_meta,
# texts_by_frame, catalog_variants) -- these are exactly main()'s own local
# variables, passed straight through (see step 2 "Walk frames" in main()):
#
#   sections: list[dict], the SAME list produced by collect_sections() (each
#       dict already carries the raw Figma node tree, unmodified):
#         [{"name": str, "id": str, "frames": [<frame_node>, ...], "file": str}, ...]
#       <frame_node> is a raw Figma node dict for one top-level frame: at
#       least {"id": str, "name": str, "children": [<node>, ...],
#       "absoluteBoundingBox": {"width": float, "height": float}, ...}. Rule
#       (c) below is the only rule reading <frame_node>["children"] directly
#       (to see UN-collected direct children like a stray 375px tab-bar);
#       every other rule reads frame_meta / texts_by_frame instead.
#
#   frame_meta: dict[frame_id] -> {"w": str, "h": str, "instances": [...], ...}
#       exactly main()'s per-frame accumulator (see step 2 loop) at the point
#       right after `collect_instances()` has populated "instances" for every
#       frame. Only "instances" is read by these rules; each item in that
#       list has the shape collect_instances() now returns: {"id", "name",
#       "props", "size", "w", "h", "pad": {"top","right","bottom","left"},
#       "gap"} (see collect_instances() docstring above).
#
#   texts_by_frame: dict[frame_id] -> [collect_texts() row, ...] -- exactly
#       main()'s own texts_by_frame accumulator. Each row: {"size": int,
#       "weight": int, "lh": int, "ls": float, "text": str, "color": str,
#       "path": str} (collect_texts()'s return shape, unmodified).
#
#   catalog_variants: dict[instance_name] -> [variant_dict, ...] as described
#       under resolve_catalog_variants() above. An empty dict (or None) is
#       valid -- rule (a) then finds no match for any instance and silently
#       contributes zero findings (fail-open, matches the "hygiene must never
#       break the run" footgun).
#
# Return shape (all 5 rules): list of
#   {"rule": str, "severity": "warn" | "info", "frameId": str, "frameName": str,
#    "section": str, "detail": str, "suggestion": str}
# `rule` is one of: catalog-vs-instance, duplicate-frame-name,
# frame-name-vs-content, child-outside-breakpoint, duplicate-instance,
# text-mentions-missing-button (frame-name-vs-content is a sibling of
# duplicate-frame-name, both produced by rule group (b) in the plan; it is
# the only rule emitted with severity "info" -- see the note at its
# emission site).
# ---------------------------------------------------------------------------

_CATALOG_INDEX_FILES = (
    ("mobile", "figma-components-mobile.json"),
    ("web", "figma-components-web.json"),
)

# Module-level cache: shard relative path -> parsed shard dict (or None on
# failure). Shared across calls within one process so a name appearing on
# many frames only pays the shard-parse cost once.
_SHARD_CACHE: dict[str, dict | None] = {}


def load_catalog_component_index(catalog_root: str | None = None) -> dict:
    """Build {component_name: {"platform", "shard"}} from the SLIM indexes.

    Reads ONLY docs/design-system/figma-components-{web,mobile}.json (both
    well under 200 KB). NEVER lists or reads the 52 MB web + 24 MB mobile
    shard directories -- callers resolve individual shards lazily via
    resolve_catalog_variants(), only for names actually seen in the design
    file being extracted.
    """
    root = catalog_root or PROJECT_ROOT
    index: dict[str, dict] = {}
    for platform, slim_name in _CATALOG_INDEX_FILES:
        slim_path = os.path.join(root, "docs", "design-system", slim_name)
        if not os.path.isfile(slim_path):
            continue
        try:
            with open(slim_path, encoding="utf-8") as f:
                slim = json.load(f)
        except (OSError, ValueError):
            continue
        pages = slim.get("pages") or []
        components_by_page = slim.get("components_by_page") or {}
        shard_by_page = {p.get("page"): p.get("shard") for p in pages if p.get("page") and p.get("shard")}
        for page_name, entries in components_by_page.items():
            shard = shard_by_page.get(page_name)
            if not shard:
                continue
            for entry in entries or []:
                name = entry.get("name")
                if not name or name in index:
                    continue
                index[name] = {"platform": platform, "shard": shard}
    return index


def _load_shard(shard_rel: str, catalog_root: str) -> dict | None:
    """Lazily load + cache ONE shard file by its relative path."""
    if shard_rel in _SHARD_CACHE:
        return _SHARD_CACHE[shard_rel]
    path = os.path.join(catalog_root, "docs", "design-system", shard_rel)
    data = None
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = None
    _SHARD_CACHE[shard_rel] = data
    return data


def resolve_catalog_variants(names, index: dict, catalog_root: str | None = None) -> dict:
    """For each name in `names` present in `index`, return its shard's
    top-level component render.children[] (the variant list). See the
    module-section docstring above for the exact shape."""
    root = catalog_root or PROJECT_ROOT
    resolved: dict[str, list] = {}
    for name in names:
        entry = index.get(name)
        if not entry:
            continue
        shard = _load_shard(entry["shard"], root)
        if not shard:
            resolved[name] = []
            continue
        variants: list = []
        for comp in shard.get("components") or []:
            if comp.get("name") == name:
                variants = ((comp.get("render") or {}).get("children")) or []
                break
        resolved[name] = variants
    return resolved


def _parse_kv_pairs(text: str) -> dict:
    """'key=value, key=value' -> {"key": "value", ...}. '' -> {}.

    Shared parser for BOTH sides of the catalog-vs-instance comparison: an
    instance's componentProperties (_props_str() output) and a catalog
    variant's own `name` field (e.g. "expand=off, variant=owner").
    """
    result: dict[str, str] = {}
    if not text:
        return result
    for part in text.split(","):
        part = part.strip()
        if not part or "=" not in part:
            continue
        key, val = part.split("=", 1)
        result[key.strip()] = val.strip()
    return result


def _kv_matches(a: dict, b: dict) -> bool:
    """True when every key common to both dicts agrees, AND at least one key
    is shared (an empty intersection can never claim a match)."""
    common = set(a) & set(b)
    if not common:
        return False
    return all(a[k] == b[k] for k in common)


_CSS_LENGTH_RE = re.compile(r"[-\d.]+")


def _parse_css_length_px(token: str) -> float:
    """'24.0px' -> 24.0. Tolerant of a missing/odd unit; '' -> 0.0."""
    m = _CSS_LENGTH_RE.match((token or "").strip())
    return float(m.group(0)) if m else 0.0


def normalize_css_padding(padding_css: str | None) -> tuple[float, float, float, float]:
    """CSS padding shorthand (catalog's `css.padding` string) -> (top, right,
    bottom, left) in px, per the standard 1/2/3/4-value shorthand rules.
    None / '' -> (0.0, 0.0, 0.0, 0.0)."""
    if not padding_css:
        return (0.0, 0.0, 0.0, 0.0)
    parts = [p for p in padding_css.strip().split() if p]
    vals = [_parse_css_length_px(p) for p in parts]
    if len(vals) == 1:
        t = r = b = leftv = vals[0]
    elif len(vals) == 2:
        t = b = vals[0]
        r = leftv = vals[1]
    elif len(vals) == 3:
        t, r, b = vals
        leftv = r
    elif len(vals) >= 4:
        t, r, b, leftv = vals[0], vals[1], vals[2], vals[3]
    else:
        t = r = b = leftv = 0.0
    return (t, r, b, leftv)


def normalize_css_gap(gap_css: str | None) -> float:
    """CSS gap shorthand (catalog's `css.gap` string, e.g. '2.0px') -> float
    px. Only the first length token is used (row-gap; this catalog's
    auto-layout export never emits a two-value row/column gap shorthand).
    None / '' -> 0.0."""
    if not gap_css:
        return 0.0
    parts = [p for p in gap_css.strip().split() if p]
    return _parse_css_length_px(parts[0]) if parts else 0.0


def _instance_pad_tuple(instance: dict) -> tuple[float, float, float, float]:
    """collect_instances()'s numeric 'pad' dict -> (top, right, bottom, left)."""
    pad = instance.get("pad") or {}
    return (
        float(pad.get("top") or 0),
        float(pad.get("right") or 0),
        float(pad.get("bottom") or 0),
        float(pad.get("left") or 0),
    )


def padding_matches(css_padding: str | None, instance_pad: tuple, tolerance: float = 0.5) -> bool:
    """True when the catalog CSS padding shorthand and the instance's numeric
    (top, right, bottom, left) tuple agree within `tolerance` px per side."""
    ct, cr, cb, cl = normalize_css_padding(css_padding)
    it, ir, ib, il = instance_pad
    return abs(ct - it) <= tolerance and abs(cr - ir) <= tolerance and abs(cb - ib) <= tolerance and abs(cl - il) <= tolerance


def gap_matches(css_gap: str | None, instance_gap, tolerance: float = 0.5) -> bool:
    """True when the catalog CSS gap shorthand and the instance's numeric gap
    agree within `tolerance` px."""
    return abs(normalize_css_gap(css_gap) - float(instance_gap or 0)) <= tolerance


def _check_catalog_vs_instance(sections: list, frame_meta: dict, catalog_variants: dict) -> list:
    """Rule (a): instance padding/gap disagrees with its matched catalog variant."""
    findings = []
    for sec in sections:
        for frame in sec["frames"]:
            fid = frame["id"]
            meta = frame_meta.get(fid) or {}
            for inst in meta.get("instances") or []:
                variants = catalog_variants.get(inst["name"])
                if not variants:
                    continue
                inst_kv = _parse_kv_pairs(inst.get("props") or "")
                if not inst_kv:
                    continue
                variant = None
                for v in variants:
                    if _kv_matches(inst_kv, _parse_kv_pairs(v.get("name") or "")):
                        variant = v
                        break
                if variant is None:
                    continue
                css = variant.get("css") or {}
                inst_pad = _instance_pad_tuple(inst)
                inst_gap = inst.get("gap") or 0
                pad_ok = padding_matches(css.get("padding"), inst_pad)
                gap_ok = gap_matches(css.get("gap"), inst_gap)
                if pad_ok and gap_ok:
                    continue
                parts = []
                if not pad_ok:
                    parts.append(
                        f"padding catalog={normalize_css_padding(css.get('padding'))} vs instance={inst_pad}"
                    )
                if not gap_ok:
                    parts.append(f"gap catalog={normalize_css_gap(css.get('gap'))} vs instance={inst_gap}")
                findings.append(
                    {
                        "rule": "catalog-vs-instance",
                        "severity": "warn",
                        "frameId": fid,
                        "frameName": frame.get("name") or "Frame",
                        "section": sec["name"],
                        "detail": f"instance '{inst['name']}' ({inst.get('props') or EMDASH}): " + "; ".join(parts),
                        "suggestion": "compare with variant '" + (variant.get("name") or "") + "' in the DS catalog",
                    }
                )
    return findings


def _check_frame_naming(sections: list, texts_by_frame: dict) -> list:
    """Rule (b): duplicate-frame-name + frame-name-vs-content."""
    findings = []
    for sec in sections:
        by_name: dict[str, list] = {}
        for frame in sec["frames"]:
            by_name.setdefault(frame.get("name") or "Frame", []).append(frame)

        for name, frames in by_name.items():
            if len(frames) < 2:
                continue
            text_sets = {
                f["id"]: frozenset(
                    t["text"].strip() for t in texts_by_frame.get(f["id"], []) if t["text"].strip()
                )
                for f in frames
            }
            reference_id = frames[0]["id"]
            reference_set = text_sets[reference_id]
            for f in frames[1:]:
                if text_sets[f["id"]] != reference_set:
                    findings.append(
                        {
                            "rule": "duplicate-frame-name",
                            "severity": "warn",
                            "frameId": f["id"],
                            "frameName": name,
                            "section": sec["name"],
                            "detail": (
                                f"frame '{name}' ({f['id']}) has different content than frame '{name}' "
                                f"({reference_id}) with the same name"
                            ),
                            "suggestion": "give each distinct frame state an unambiguous name",
                        }
                    )

        for frame in sec["frames"]:
            fid = frame["id"]
            texts = texts_by_frame.get(fid) or []
            if not texts:
                continue
            max_size = max(t["size"] for t in texts)
            top_texts = [t["text"] for t in texts if t["size"] == max_size]
            fname = (frame.get("name") or "Frame").strip().lower()
            if fname and not any(fname in (t or "").lower() for t in top_texts):
                findings.append(
                    {
                        "rule": "frame-name-vs-content",
                        # info, not warn: on real files frame names are state
                        # descriptions ("... - empty state - loading"), so this
                        # fires on almost every frame; kept for completeness.
                        "severity": "info",
                        "frameId": fid,
                        "frameName": frame.get("name") or "Frame",
                        "section": sec["name"],
                        "detail": (
                            f"frame name '{frame.get('name')}' does not appear in any of its largest "
                            "texts: " + "; ".join(_trim(t, 40) for t in top_texts if t)
                        ),
                        "suggestion": "rename the frame to match its heading or add a heading",
                    }
                )
    return findings


_BREAKPOINT_CHILD_NAME_RE = re.compile(r"bar|nav|tab-bar|bottom", re.IGNORECASE)
_BREAKPOINT_WIDTH_RATIO = 0.7  # child significantly narrower than its own frame


def _check_child_outside_breakpoint(sections: list) -> list:
    """Rule (c): a direct child named like a bar/nav left over from a
    narrower breakpoint (e.g. a 375px tab-bar inside a 768px frame)."""
    findings = []
    for sec in sections:
        for frame in sec["frames"]:
            fw, _fh = _bbox(frame)
            if not fw:
                continue
            for child in frame.get("children") or []:
                name = child.get("name") or ""
                if not _BREAKPOINT_CHILD_NAME_RE.search(name):
                    continue
                cw, _ch = _bbox(child)
                if not cw or cw >= fw * _BREAKPOINT_WIDTH_RATIO:
                    continue
                findings.append(
                    {
                        "rule": "child-outside-breakpoint",
                        "severity": "warn",
                        "frameId": frame.get("id") or "",
                        "frameName": frame.get("name") or "Frame",
                        "section": sec["name"],
                        "detail": (
                            f"child '{name}' is {_fmt_num(cw)} wide in a frame "
                            f"{_fmt_num(fw)} wide -- an element left over from a previous breakpoint"
                        ),
                        "suggestion": "resize or remove the element that does not fit the current breakpoint",
                    }
                )
    return findings


_DUPLICATE_SINGLETON_NAME_RE = re.compile(r"icon-button|tooltip|information", re.IGNORECASE)


def _check_duplicate_instance(sections: list, frame_meta: dict) -> list:
    """Rule (d): the same (name, props) instance appears >1x in one frame,
    restricted to names that are conventionally singletons per frame."""
    findings = []
    for sec in sections:
        for frame in sec["frames"]:
            fid = frame["id"]
            meta = frame_meta.get(fid) or {}
            counts: dict[tuple, int] = {}
            for inst in meta.get("instances") or []:
                if not _DUPLICATE_SINGLETON_NAME_RE.search(inst.get("name") or ""):
                    continue
                key = (inst["name"], inst.get("props") or "")
                counts[key] = counts.get(key, 0) + 1
            for (name, props), n in counts.items():
                if n <= 1:
                    continue
                findings.append(
                    {
                        "rule": "duplicate-instance",
                        "severity": "warn",
                        "frameId": fid,
                        "frameName": frame.get("name") or "Frame",
                        "section": sec["name"],
                        "detail": f"instance '{name}' ({props or EMDASH}) appears {n}x in this frame",
                        "suggestion": "check whether this is a duplicated element or an intended repetition",
                    }
                )
    return findings


# button "X" / click the button "X" (and the legacy Polish wording
# przycisk "X") -- ASCII quotes or printer's quotes (opening lower U+201E,
# closing upper U+201D). \uXXXX escapes (rather
# than raw non-ASCII literals) per the repo's ASCII-in-source rule.
# Figma's smart-quote default is the ENGLISH pair (U+201C / U+201D) -- the
# real-world frames use exactly that, so it is accepted alongside
# the low-high pair; a missing opener here was a verified false negative.
_PL_QUOTE_OPEN = "\u201e"
_EN_QUOTE_OPEN = "\u201c"
_QUOTE_CLOSE = "\u201d"
_BUTTON_MENTION_RE = re.compile(
    '(?:przycisk|button)[^"' + _PL_QUOTE_OPEN + _EN_QUOTE_OPEN + ']{0,40}(?:"([^"]+)"|'
    + "[" + _PL_QUOTE_OPEN + _EN_QUOTE_OPEN + "]([^" + _QUOTE_CLOSE + "]+)" + _QUOTE_CLOSE + ")",
    re.IGNORECASE,
)


def _check_text_mentions_missing_button(sections: list, texts_by_frame: dict) -> list:
    """Rule (e): a text says 'button "X"' but no other text in the same
    frame, on a 'button'-ish path, actually carries label X."""
    findings = []
    for sec in sections:
        for frame in sec["frames"]:
            fid = frame["id"]
            texts = texts_by_frame.get(fid) or []
            for t in texts:
                text = t.get("text") or ""
                m = _BUTTON_MENTION_RE.search(text)
                if not m:
                    continue
                label = (m.group(1) or m.group(2) or "").strip()
                if not label:
                    continue
                found = any(
                    other is not t
                    and label.lower() in (other.get("text") or "").lower()
                    and "button" in (other.get("path") or "").lower()
                    for other in texts
                )
                if found:
                    continue
                findings.append(
                    {
                        "rule": "text-mentions-missing-button",
                        "severity": "warn",
                        "frameId": fid,
                        "frameName": frame.get("name") or "Frame",
                        "section": sec["name"],
                        "detail": (
                            f'a text mentions the button "{label}", but the frame has no '
                            "'button' instance/text with that label"
                        ),
                        "suggestion": "add the missing button to the frame or fix the text",
                    }
                )
    return findings


def check_figma_hygiene(sections: list, frame_meta: dict, texts_by_frame: dict, catalog_variants: dict | None = None) -> list:
    """Five deterministic Figma-file consistency checks. PURE (no disk, no
    network, no token) -- see the module-section docstring above this
    function for the exact shape of every parameter and the return schema."""
    catalog_variants = catalog_variants or {}
    findings: list = []
    findings += _check_catalog_vs_instance(sections, frame_meta, catalog_variants)
    findings += _check_frame_naming(sections, texts_by_frame)
    findings += _check_child_outside_breakpoint(sections)
    findings += _check_duplicate_instance(sections, frame_meta)
    findings += _check_text_mentions_missing_button(sections, texts_by_frame)
    return findings


# ---------------------------------------------------------------------------
# DS token map
# ---------------------------------------------------------------------------


# (path, label) - label is what token-map.md says about where the name lives.
_TOKEN_SOURCES = (
    (os.path.join(PROJECT_ROOT, "css", "ds-tokens.css"), "css/ds-tokens.css"),
    (os.path.join(PROJECT_ROOT, "templates", "prototype-build-shell", "src", "tokens.css"), "shell tokens.css"),
)
# Read ONLY to resolve var() chains; their names are not offered as candidates.
_TOKEN_CHAIN_FILES = ()
_DECL_RE = re.compile(r"(--[A-Za-z][A-Za-z0-9_-]*)\s*:\s*([^;}]+?)\s*(?:;|\})")
_VAR_RE = re.compile(r"^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)$")
_HEX_RE = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


def _read_decls(path: str) -> dict | None:
    """Custom-property declarations of one CSS file ({name: raw value}), comments
    stripped. None when the file is absent/unreadable (fail-open)."""
    try:
        with open(path, encoding="utf-8") as f:
            css = f.read()
    except OSError:
        return None
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.DOTALL)
    return {name: val.strip() for name, val in _DECL_RE.findall(css)}


def _norm_hex(val: str) -> str:
    """'#abc' / '#aabbcc' / '#aabbccdd' / 'white' / 'black' -> '#rrggbb' or ''.
    An 8-digit value with alpha < ff is not a plain color and maps to ''."""
    val = val.strip().lower()
    if val == "white":
        return "#ffffff"
    if val == "black":
        return "#000000"
    m = _HEX_RE.match(val)
    if not m:
        return ""
    digits = m.group(1)
    if len(digits) == 3:
        digits = "".join(c * 2 for c in digits)
    if len(digits) == 8:
        if digits[6:] != "ff":
            return ""
        digits = digits[:6]
    return "#" + digits


def _resolve_var(name: str, decls: dict, depth: int = 0) -> str:
    """Follow var(--x) chains to a hex ('' when it never lands on one)."""
    if depth > 12:
        return ""
    raw = decls.get(name)
    if raw is None:
        return ""
    hexval = _norm_hex(raw)
    if hexval:
        return hexval
    m = _VAR_RE.match(raw)
    return _resolve_var(m.group(1), decls, depth + 1) if m else ""


def load_token_map() -> tuple[dict, str]:
    """hex -> ["<name> (<source>)", ...] resolved against the app tokens and
    the build shell tokens. Returns (map, note); note is '' when at
    least one source was read, else a one-line explanation (fail-open: a
    missing source yields NO-MATCH rows, never an error)."""
    all_decls: dict[str, str] = {}
    per_source: list[tuple[str, dict]] = []
    missing: list[str] = []
    for path, label in _TOKEN_SOURCES:
        decls = _read_decls(path)
        if decls is None:
            missing.append(label)
            continue
        per_source.append((label, decls))
    for path in _TOKEN_CHAIN_FILES:
        decls = _read_decls(path)
        if decls:
            all_decls.update(decls)
    for _label, decls in per_source:
        all_decls.update(decls)
    mapping: dict[str, list] = {}
    for label, decls in per_source:
        for name in decls:
            hexval = _resolve_var(name, all_decls)
            if hexval:
                mapping.setdefault(hexval, []).append((label, name))
    order = {label: i for i, (_p, label) in enumerate(_TOKEN_SOURCES)}
    out = {
        hexval: [f"{name} ({label})" for label, name in sorted(entries, key=lambda e: (order[e[0]], len(e[1]), e[1]))]
        for hexval, entries in mapping.items()
    }
    note = ""
    if len(missing) == len(_TOKEN_SOURCES):
        note = (
            "Token sources are not available on this machine (css/ds-tokens.css, shell tokens.css) - "
            "every color is marked NO-MATCH."
        )
    elif missing:
        note = "Missing token sources: " + ", ".join(missing) + " - partial mapping."
    return out, note


# ---------------------------------------------------------------------------
# Markdown renderers
# ---------------------------------------------------------------------------


def _md_escape(text: str) -> str:
    return text.replace("|", "\\|")


def _trim(text: str, limit: int = MAX_TEXT_LEN) -> str:
    text = text.strip()
    return text[:limit] if len(text) > limit else text


def _style_key(t: dict) -> str:
    ls = f", ls {t['ls']:g}" if t["ls"] else ""
    return f"{t['size']}/{t['weight']} (lh {t['lh']}{ls})"


def render_section_md(section: dict, frame_meta: dict, ref_title: str) -> str:
    lines = [f"# {section['name']}", ""]
    sec_id = f" (Figma section id: `{section['id']}`)" if section["id"] else ""
    lines.append(f"{len(section['frames'])} frames{sec_id}. Part of the {ref_title} reference database.")
    lines.append("")
    lines.append("Format of text rows: `size/weight (line-height, letter-spacing)` | text | color | component path.")
    lines.append("")
    lines.append("---")
    for frame in section["frames"]:
        meta = frame_meta[frame["id"]]
        lines.append("")
        lines.append(f"## {frame.get('name') or 'Frame'} \u2014 `{frame['id']}`")
        lines.append("")
        bg = f" | bg: `{meta['bg']}`" if meta["bg"] else ""
        lines.append(f"Size: **{meta['w']} x {meta['h']}**{bg} | Screenshot: [screenshots/{meta['png']}](screenshots/{meta['png']})")
        if meta["distinguishing"] and meta["distinguishing"] != "\u2014":
            lines.append("")
            lines.append(f"Distinguishing content vs same-named frames: {meta['distinguishing']}")
        lines.append("")
        lines.append("### Layout tree (auto-layout containers and component instances)")
        lines.append("")
        lines.append("Legend: `H`/`V` = auto-layout direction, `gap` = item spacing, `pad` = padding, `r` = corner radius, `[inst]` = component instance.")
        lines.append("")
        lines.append("```")
        lines.extend(meta["tree"])
        lines.append("```")
        texts = meta["texts"]
        if texts:
            lines.append("")
            lines.append(f"### Text elements ({len(texts)})")
            lines.append("")
            lines.append("| Style | Text | Color | Path |")
            lines.append("|---|---|---|---|")
            for t in texts:
                lines.append(
                    f"| {_style_key(t)} | {_md_escape(_trim(t['text']))} | `{t['color'] or '-'}` | {_md_escape(t['path'])} |"
                )
        instances = meta["instances"]
        if instances:
            grouped: dict[tuple, int] = OrderedDict()
            for inst in instances:
                key = (inst["name"], inst["props"], inst["size"])
                grouped[key] = grouped.get(key, 0) + 1
            lines.append("")
            lines.append(f"### Component instances ({len(instances)})")
            lines.append("")
            lines.append("| Component | Props | Size | Count |")
            lines.append("|---|---|---|---|")
            for (name, props, size), count in sorted(grouped.items(), key=lambda kv: kv[0][0]):
                lines.append(f"| {_md_escape(name)} | {_md_escape(props) or EMDASH} | {size} | {count} |")
        lines.append("")
        lines.append("---")
    lines.append("")
    return "\n".join(lines)


def render_typography_md(all_texts: list[dict], ref_title: str) -> str:
    groups: dict[tuple, dict] = {}
    for t in all_texts:
        key = (t["size"], t["weight"], t["lh"], t["ls"])
        g = groups.setdefault(key, {"count": 0, "colors": Counter(), "examples": [], "contexts": Counter()})
        g["count"] += 1
        if t["color"]:
            g["colors"][t["color"]] += 1
        if len(g["examples"]) < 3 and _trim(t["text"], 50) not in g["examples"]:
            g["examples"].append(_trim(t["text"], 50))
        if t["path"]:
            g["contexts"][t["path"]] += 1

    lines = [f"# Typography scale \u2014 {ref_title}", ""]
    lines.append("Every size/weight combination observed across all frames (auto-extracted from the Figma node tree).")
    lines.append("")
    lines.append("| Size/Weight | Line height | Letter spacing | Uses | Colors (by frequency) | Semantic role | Example texts | Top contexts |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for (size, weight, lh, ls), g in sorted(groups.items(), key=lambda kv: (-kv[0][0], -kv[0][1])):
        colors = ", ".join(f"`{c}` ({n})" for c, n in g["colors"].most_common(4))
        role = _TYPE_ROLES.get((size, weight), f"{size}/{weight}")
        examples = "; ".join(f"\u201c{_md_escape(e)}\u201d" for e in g["examples"])
        contexts = "; ".join(_md_escape(c) for c, _ in g["contexts"].most_common(3))
        ls_str = f"{ls:g}" if ls else "\u2014"
        lines.append(
            f"| **{size}/{weight}** | {lh} | {ls_str} | {g['count']} | {colors} | {role} | {examples} | {contexts} |"
        )
    lines.append("")
    return "\n".join(lines)


def render_colors_md(color_agg: dict, token_map: dict, ref_title: str, note: str = "") -> str:
    lines = [f"# Color palette \u2014 {ref_title}", ""]
    lines.append("All unique colors observed across the extracted frames (text fills, backgrounds, borders, icon vectors), with DS token candidates (app tokens and build shell tokens).")
    lines.append("")
    if note:
        lines.append(f"> {note}")
        lines.append("")
    lines.append("| Hex | Uses | As | DS token candidates | Top contexts |")
    lines.append("|---|---|---|---|---|")
    ranked = sorted(color_agg.items(), key=lambda kv: -sum(kv[1]["kinds"].values()))
    for hexval, entry in ranked:
        total = sum(entry["kinds"].values())
        kinds = ", ".join(f"{k} ({n})" for k, n in entry["kinds"].most_common())
        base_hex = hexval.split(" ")[0]
        cands = token_map.get(base_hex) or []
        if cands:
            shown = "<br>".join(f"`{v}`" for v in cands[:4])
            if len(cands) > 4:
                shown += f"<br>(+{len(cands) - 4} more)"
        else:
            shown = "**NO-MATCH**"
        contexts = "; ".join(_md_escape(c) for c, _ in entry["contexts"].most_common(3))
        lines.append(f"| `{hexval}` | {total} | {kinds} | {shown} | {contexts} |")
    lines.append("")
    return "\n".join(lines)


def render_components_md(comp_agg: dict, ref_title: str) -> str:
    lines = [f"# Component inventory \u2014 {ref_title}", ""]
    lines.append("Every Figma component instance used across the extracted frames, with variant props and observed sizes.")
    lines.append("")
    lines.append("| Component | Instances | Frames | Variant props seen (count) | Sizes seen (count) |")
    lines.append("|---|---|---|---|---|")
    ranked = sorted(comp_agg.items(), key=lambda kv: -kv[1]["count"])
    for name, entry in ranked:
        props = "<br>".join(f"{_md_escape(p) or EMDASH} ({n})" for p, n in entry["props"].most_common(6))
        sizes = ", ".join(f"{s} ({n})" for s, n in entry["sizes"].most_common(6))
        lines.append(f"| **{_md_escape(name)}** | {entry['count']} | {len(entry['frames'])} | {props or EMDASH} | {sizes} |")
    lines.append("")
    return "\n".join(lines)


def render_layout_md(container_agg: dict, ref_title: str) -> str:
    lines = [f"# Layout specs \u2014 {ref_title}", ""]
    lines.append("Structural containers by usage count (dominant sizes, gaps, paddings). Auto-extracted; use section-*.md layout trees for per-screen detail.")
    lines.append("")
    lines.append("| Name | Count | Top sizes | Gaps | Paddings |")
    lines.append("|---|---|---|---|---|")
    ranked = sorted(container_agg.items(), key=lambda kv: -kv[1]["count"])[:40]
    for name, entry in ranked:
        sizes = ", ".join(f"{s} ({n})" for s, n in entry["sizes"].most_common(3))
        gaps = ", ".join(f"{g} ({n})" for g, n in entry["gaps"].most_common(3)) or "\u2014"
        pads = ", ".join(f"{p} ({n})" for p, n in entry["pads"].most_common(3)) or "\u2014"
        lines.append(f"| {_md_escape(name)} | {entry['count']} | {sizes} | {gaps} | {pads} |")
    lines.append("")
    return "\n".join(lines)


def render_token_map_md(color_agg: dict, token_map: dict, ref_title: str, note: str = "") -> str:
    lines = [f"# Token map \u2014 {ref_title}", ""]
    lines.append("Deterministic mapping: every hex observed in this reference -> the app token (`css/ds-tokens.css`) and the build shell token name that resolve to the same value (semantic names first, then shortest = most generic). **NO-MATCH** = no DS token carries this value; do NOT invent a token, surface it instead.")
    lines.append("")
    if note:
        lines.append(f"> {note}")
        lines.append("")
    lines.append("| Hex | Uses | DS token candidates (of N) | Status |")
    lines.append("|---|---|---|---|")
    ranked = sorted(color_agg.items(), key=lambda kv: -sum(kv[1]["kinds"].values()))
    matched = 0
    for hexval, entry in ranked:
        total = sum(entry["kinds"].values())
        base_hex = hexval.split(" ")[0]
        cands = token_map.get(base_hex) or []
        if cands:
            matched += 1
            shown = ", ".join(f"`{v}`" for v in cands[:4]) + (f" (of {len(cands)})" if len(cands) > 4 else "")
            status = "ok"
        else:
            shown = "\u2014"
            status = "**NO-MATCH**"
        lines.append(f"| `{hexval}` | {total} | {shown} | {status} |")
    lines.append("")
    pct = round(matched / len(ranked) * 100) if ranked else 100
    lines.append(f"Matched: {matched}/{len(ranked)} colors ({pct}%).")
    lines.append("")
    return "\n".join(lines)


def render_index_md(
    sections: list[dict],
    frame_meta: dict,
    ref_title: str,
    file_name: str,
    last_modified: str,
    scale: int,
    devmode_present: bool,
    hygiene: list | None = None,
) -> str:
    today = datetime.date.today().isoformat()
    total = sum(len(s["frames"]) for s in sections)
    hygiene = hygiene or []
    lines = [f"# {ref_title} \u2014 Figma design reference", ""]
    lines.append(
        f"Source: Figma file **{file_name}** (last modified {last_modified[:10]}), extracted {today} via scripts/figma_reference.py (REST API, PNG scale {scale})."
    )
    lines.append("")
    lines.append("| File | Contents |")
    lines.append("|---|---|")
    for sec in sections:
        fname = sec["file"]
        lines.append(f"| [{fname}]({fname}) | {sec['name']} \u2014 {len(sec['frames'])} frames |")
    lines.append("| [typography.md](typography.md) | Complete typography scale with semantic roles |")
    lines.append("| [colors.md](colors.md) | Color palette with DS token candidates + contexts |")
    lines.append("| [components.md](components.md) | Component instance inventory across all frames |")
    lines.append("| [layout.md](layout.md) | Key layout dimensions, gaps, paddings |")
    lines.append("| [token-map.md](token-map.md) | Hex -> DS token mapping (NO-MATCH marked) |")
    lines.append("| [hygiene.json](hygiene.json) | Deterministic Figma-file consistency findings (5 rules) |")
    lines.append(f"| screenshots/ | {total} frame PNGs (named `<frame-id>.png`, `:` replaced by `-`) |")
    if devmode_present:
        lines.append("| dev-mode/ | Per-frame dev-mode code exports (filled by the /figma-ref MCP loop) |")
    lines.append("")
    lines.append(f"## All frames ({total})")
    lines.append("")
    lines.append("| # | Section | Frame | ID | Size | Distinguishing content | Detail |")
    lines.append("|---|---|---|---|---|---|---|")
    idx = 0
    for sec in sections:
        fname = sec["file"]
        for frame in sec["frames"]:
            idx += 1
            meta = frame_meta[frame["id"]]
            lines.append(
                f"| {idx} | {sec['name']} | {_md_escape(frame.get('name') or 'Frame')} | `{frame['id']}` | "
                f"{meta['w']}x{meta['h']} | {_md_escape(meta['distinguishing'])} | [{fname}]({fname}) |"
            )
    lines.append("")
    lines.append(f"## Figma hygiene ({len(hygiene)})")
    lines.append("")
    lines.append("Deterministic design-file consistency checks (catalog-vs-instance,")
    lines.append("duplicate-frame-name, frame-name-vs-content, child-outside-breakpoint,")
    lines.append("duplicate-instance, text-mentions-missing-button). See hygiene.json for")
    lines.append("the machine-readable form.")
    lines.append("")
    lines.append("| Rule | Frame | ID | What is wrong | Suggestion |")
    lines.append("|---|---|---|---|---|")
    if not hygiene:
        lines.append("| \u2014 | \u2014 | \u2014 | No inconsistencies detected | \u2014 |")
    else:
        for item in hygiene:
            lines.append(
                f"| {_md_escape(item.get('rule', ''))} | {_md_escape(item.get('frameName', ''))} | "
                f"`{item.get('frameId', '')}` | {_md_escape(item.get('detail', ''))} | "
                f"{_md_escape(item.get('suggestion', ''))} |"
            )
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Distinguishing content
# ---------------------------------------------------------------------------


def compute_distinguishing(sections: list[dict], texts_by_frame: dict) -> dict:
    """For frames sharing (section, name): pick up to 3 texts not common to the
    whole group. Unique-named frames get an em dash."""
    result: dict[str, str] = {}
    for sec in sections:
        by_name: dict[str, list[dict]] = {}
        for frame in sec["frames"]:
            by_name.setdefault(frame.get("name") or "Frame", []).append(frame)
        for _name, frames in by_name.items():
            if len(frames) == 1:
                result[frames[0]["id"]] = "\u2014"
                continue
            text_sets = {f["id"]: [t["text"].strip() for t in texts_by_frame.get(f["id"], []) if t["text"].strip()] for f in frames}
            common = None
            for vals in text_sets.values():
                s = set(vals)
                common = s if common is None else (common & s)
            common = common or set()
            for f in frames:
                distinct = [t for t in text_sets[f["id"]] if t not in common]
                chosen = (distinct or text_sets[f["id"]])[:3]
                result[f["id"]] = "; ".join(_trim(t, 45) for t in chosen) or "\u2014"
    return result


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description="Extract a structured Figma design reference")
    parser.add_argument("--url", default="", help="Figma URL (design/file link with optional ?node-id=)")
    parser.add_argument("--file", dest="file_key", default="", help="Figma file key (alternative to --url)")
    parser.add_argument("--node-id", dest="node_id", default="", help="Page/section/frame node id ('96560:26612' or '96560-26612')")
    parser.add_argument("--out-id", dest="out_id", required=True, help="Reference id -> user-data/figma-reference/<out-id>/")
    parser.add_argument("--scale", type=int, default=2, choices=[1, 2], help="PNG export scale (default 2)")
    parser.add_argument("--no-images", action="store_true", help="Skip PNG export/download")
    parser.add_argument("--token-stdin", action="store_true", help='Read the Figma token as one JSON line {"figmaToken": ...} from stdin')
    parser.add_argument(
        "--fixture",
        default="",
        help="Offline mode: read the scope node from this JSON file ({fileName, lastModified, scope} or a bare node); no token, no network, no images",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace an existing reference even when it was built from a different file/node (see the scope guard)",
    )
    parser.add_argument(
        "--if-changed",
        dest="if_changed",
        action="store_true",
        help="Skip the export when the existing reference has the same file/node/scale, all its PNGs and the "
        "Figma file's lastModified did not change (one cheap depth=1 call instead of a full export)",
    )
    args = parser.parse_args()

    file_key, node_id = args.file_key, args.node_id.replace("-", ":") if args.node_id else ""
    if args.url:
        url_key, url_node = parse_figma_url(args.url)
        file_key = file_key or url_key
        node_id = node_id or url_node
    if args.fixture and not file_key:
        file_key = "fixture"
    if not file_key:
        print("[figma-reference] no Figma file key (use --url or --file)", file=sys.stderr)
        sys.exit(1)

    out_dir = os.path.join(USER_DATA_DIR, "figma-reference", _sanitize(args.out_id))

    # Scope guard. A reference dir is keyed by prototype id, so a re-run with a
    # DIFFERENT (fileKey, nodeId) does not "refresh" it - it interleaves a second
    # design scope into the same folder: digests and index.md get overwritten to
    # describe the new scope while the previous scope's section files and PNGs
    # stay behind, leaving a reference no reader can trust. That happened for
    # real (2026-08-28: a mobile-file node overwrote a curated desktop
    # reference), so a mismatch now aborts unless --overwrite says otherwise.
    manifest_path = os.path.join(out_dir, "frames.json")
    if os.path.isfile(manifest_path) and not args.overwrite:
        try:
            with open(manifest_path, encoding="utf-8") as f:
                prev = json.load(f) or {}
        except (OSError, ValueError):
            prev = {}
        prev_key, prev_node = prev.get("fileKey") or "", prev.get("nodeId") or ""
        if (prev_key or prev_node) and (prev_key != file_key or prev_node != node_id):
            print(
                "[figma-reference] ABORT: "
                f"{os.path.relpath(out_dir, PROJECT_ROOT)} already holds a reference for another scope "
                f"(file {prev_key or '?'}, node {prev_node or '?'}), but (file {file_key}, node {node_id}) was requested. "
                "Use another --out-id, or --overwrite if you really want to replace the existing reference.",
                file=sys.stderr,
            )
            sys.exit(2)

    # Token resolved after the scope guard: a wrong --out-id is a local mistake
    # and should fail instantly, without depending on an unlocked vault.
    token = ""
    if not args.fixture:
        token = read_token_from_stdin() if args.token_stdin else ""
        if not token:
            print(
                "[figma-reference] no Figma token - the server passes it as one JSON line on stdin (--token-stdin)",
                file=sys.stderr,
            )
            sys.exit(1)

    if args.if_changed and not args.fixture and reference_up_to_date(out_dir, file_key, node_id, args.scale,
                                                                      args.no_images, token):
        print(f"[figma-reference] UP-TO-DATE: {os.path.relpath(out_dir, PROJECT_ROOT)} (file unchanged since the last "
              "export) - skipping the download")
        return

    os.makedirs(out_dir, exist_ok=True)

    # --- 1. Fetch scope ---
    progress(1, 6, "Fetching the Figma tree")
    if args.fixture:
        file_name, last_modified, scope = load_fixture(args.fixture)
    else:
        try:
            file_name, last_modified, scope = fetch_scope(file_key, node_id, token)
        except RequestError as exc:
            print(f"[figma-reference] fetching the Figma tree failed: {exc}", file=sys.stderr)
            sys.exit(1)
    sections = collect_sections(scope)
    # Same-named sections (e.g. two 'Toasty' groups) must not overwrite each
    # other's markdown file - dedupe the filenames once, use them everywhere.
    for sec, base in zip(sections, _deduplicate_names([f"section-{_sanitize(s['name']).lower()}" for s in sections])):
        sec["file"] = base + ".md"
    total_frames = sum(len(s["frames"]) for s in sections)
    if not total_frames:
        print("[figma-reference] no exportable frames in scope", file=sys.stderr)
        sys.exit(1)
    if total_frames > 150:
        print(f"[figma-reference] WARN: {total_frames} frames \u2014 a large scope, the export will take a while", file=sys.stderr)

    # --- 2. Walk frames ---
    progress(2, 6, f"Analysing {total_frames} frames")
    frame_meta: dict[str, dict] = {}
    texts_by_frame: dict[str, list[dict]] = {}
    all_texts: list[dict] = []
    color_agg: dict = {}
    comp_agg: dict = {}
    container_agg: dict = {}
    for sec in sections:
        for frame in sec["frames"]:
            fid = frame["id"]
            w, h = _bbox(frame)
            texts = collect_texts(frame)
            instances = collect_instances(frame)
            texts_by_frame[fid] = texts
            all_texts.extend(texts)
            collect_colors(frame, color_agg)
            collect_containers(frame, container_agg)
            for inst in instances:
                entry = comp_agg.setdefault(inst["name"], {"count": 0, "frames": set(), "props": Counter(), "sizes": Counter()})
                entry["count"] += 1
                entry["frames"].add(fid)
                entry["props"][inst["props"]] += 1
                entry["sizes"][inst["size"]] += 1
            frame_meta[fid] = {
                "w": _fmt_num(w),
                "h": _fmt_num(h),
                "bg": _solid_paint_hex(frame.get("fills")).split(" ")[0],
                "png": fid.replace(":", "-") + ".png",
                "tree": build_tree_lines(frame),
                "texts": texts,
                "instances": instances,
            }

    distinguishing = compute_distinguishing(sections, texts_by_frame)
    for fid, meta in frame_meta.items():
        meta["distinguishing"] = distinguishing.get(fid, "\u2014")

    # Figma hygiene (D2b/D2c). Wrapped in try/except on purpose: a missing or
    # corrupt DS catalog (slim indexes or a shard) must cost the hygiene
    # section only, never the whole extraction -- same fail-open principle as
    # the image export in steps 5+6 below.
    hygiene_findings: list = []
    try:
        instance_names = {
            inst["name"]
            for meta in frame_meta.values()
            for inst in (meta.get("instances") or [])
            if inst.get("name")
        }
        catalog_index = load_catalog_component_index(PROJECT_ROOT)
        catalog_variants = resolve_catalog_variants(instance_names, catalog_index, PROJECT_ROOT)
        hygiene_findings = check_figma_hygiene(sections, frame_meta, texts_by_frame, catalog_variants)
    except Exception as exc:  # noqa: BLE001 -- fail-open: hygiene never blocks the bundle
        print(f"[figma-reference] hygiene check skipped ({exc})", file=sys.stderr)
        hygiene_findings = []

    # --- 3. Render markdown FIRST (image export may fail; the text bundle must survive) ---
    progress(3, 6, "Generating reference files")
    ref_title = _sanitize(args.out_id)
    token_map, token_note = load_token_map()
    for sec in sections:
        _atomic_write_text(os.path.join(out_dir, sec["file"]), render_section_md(sec, frame_meta, ref_title))
    _atomic_write_text(os.path.join(out_dir, "typography.md"), render_typography_md(all_texts, ref_title))
    _atomic_write_text(os.path.join(out_dir, "colors.md"), render_colors_md(color_agg, token_map, ref_title, token_note))
    _atomic_write_text(os.path.join(out_dir, "components.md"), render_components_md(comp_agg, ref_title))
    _atomic_write_text(os.path.join(out_dir, "layout.md"), render_layout_md(container_agg, ref_title))
    _atomic_write_text(os.path.join(out_dir, "token-map.md"), render_token_map_md(color_agg, token_map, ref_title, token_note))
    _atomic_write(
        os.path.join(out_dir, "hygiene.json"),
        {
            "fileKey": file_key,
            "nodeId": node_id,
            "_fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "count": len(hygiene_findings),
            "findings": hygiene_findings,
        },
    )

    devmode_dir = os.path.join(out_dir, "dev-mode")
    os.makedirs(devmode_dir, exist_ok=True)
    devmode_readme = os.path.join(devmode_dir, "README.md")
    if not os.path.isfile(devmode_readme):
        _atomic_write_text(
            devmode_readme,
            "# dev-mode exports\n\nFilled by the /figma-ref skill's MCP loop: one `<frame-id>.txt` per frame\n"
            "(Figma dev-mode `get_design_context` output \u2014 generated code + exact token names).\n"
            "The REST extractor cannot produce these (variables API returns 403 on this team).\n",
        )

    _atomic_write_text(
        os.path.join(out_dir, "index.md"),
        render_index_md(sections, frame_meta, ref_title, file_name, last_modified, args.scale, True, hygiene_findings),
    )

    # --- 4. Manifest (also written before images) ---
    progress(4, 6, "Writing the frames.json manifest")
    manifest = {
        "fileKey": file_key,
        "fileName": file_name,
        "nodeId": node_id,
        "lastModified": last_modified,
        "scale": args.scale,
        "_fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "sections": [
            {
                "name": sec["name"],
                "id": sec["id"],
                "file": sec["file"],
                "frames": [
                    {
                        "id": f["id"],
                        "name": f.get("name") or "Frame",
                        "w": frame_meta[f["id"]]["w"],
                        "h": frame_meta[f["id"]]["h"],
                        "png": "screenshots/" + frame_meta[f["id"]]["png"],
                        "distinguishing": frame_meta[f["id"]]["distinguishing"],
                    }
                    for f in sec["frames"]
                ],
            }
            for sec in sections
        ],
    }
    _atomic_write(os.path.join(out_dir, "frames.json"), manifest)

    # --- 5+6. Images (fail-open: a failed batch costs screenshots, not the bundle) ---
    png_count = 0
    if not args.no_images and not args.fixture:
        node_ids = [f["id"] for sec in sections for f in sec["frames"]]
        progress(5, 6, f"Generating image URLs ({len(node_ids)} frames, scale {args.scale})")
        url_map = fetch_image_urls_resilient(file_key, node_ids, args.scale, token)
        progress(6, 6, "Downloading PNGs")
        shots_dir = os.path.join(out_dir, "screenshots")
        os.makedirs(shots_dir, exist_ok=True)
        for fid in node_ids:
            img_url = url_map.get(fid)
            if not img_url:
                print(f"[figma-reference] null image URL for {fid} \u2014 skipping", file=sys.stderr)
                continue
            try:
                resp = _http_get(img_url, timeout=120)
                resp.raise_for_status()
                _atomic_write_binary(os.path.join(shots_dir, frame_meta[fid]["png"]), [resp.content])
                png_count += 1
            except RequestError as exc:
                print(f"[figma-reference] download failed for {fid}: {exc}", file=sys.stderr)
        if png_count < len(node_ids):
            print(
                f"[figma-reference] WARNING: {len(node_ids) - png_count}/{len(node_ids)} screenshots were not downloaded \u2014 run again with force=1 to fill them in",
                file=sys.stderr,
            )
    else:
        progress(5, 6, "Skipping images")
        progress(6, 6, "Skipping images")

    progress(6, 6, "Done")
    summary = {
        "ok": True,
        "outDir": os.path.relpath(out_dir, PROJECT_ROOT),
        "frames": total_frames,
        "sections": len(sections),
        "png": png_count,
        "lastModified": last_modified,
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
