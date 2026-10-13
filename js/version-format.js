// ── Mission Deck — js/version-format.js ────────────────────────────────
// Shared semver helpers. Pure functions, zero document/module dependencies —
// safe to import from both server-adjacent contexts and the SPA.

// parseSemver(str) -> { major, minor, patch } | null
// Accepts an optional leading 'v' prefix and trims whitespace.
export function parseSemver(str) {
  if (typeof str !== 'string') return null;
  const trimmed = str.trim().replace(/^v/i, '');
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

// bumpPatch(semver) -> 'X.Y.(Z+1)' | null
export function bumpPatch(semver) {
  const parsed = parseSemver(semver);
  if (!parsed) return null;
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

// compareSemver(a, b) -> -1 | 0 | 1 | null
// null when either side does not parse as semver - the caller then shows the
// "installed" state rather than offering an update "in the dark".
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  return 0;
}

// formatVersionLabel(version, hash) -> 'v0.5.0 (99f7f05)' | 'v0.5.0' | '99f7f05' | null
export function formatVersionLabel(version, hash) {
  const parsed = parseSemver(version);
  const shortHash = typeof hash === 'string' && hash.length > 0 ? hash.slice(0, 7) : null;
  if (parsed) {
    const label = `v${parsed.major}.${parsed.minor}.${parsed.patch}`;
    return shortHash ? `${label} (${shortHash})` : label;
  }
  return shortHash || null;
}
