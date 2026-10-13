# Team directory

The `team-directory` module: one page showing every team at once, each as a
card with a logo, a head count and member photos, plus a search over first
name, last name, role and e-mail address. It adds one page to the core hub
`team` (label "Team"); the hub itself is declared in `js/core-hubs.mjs` and
does not belong to this module.

## Views

| view id | Label |
|---|---|
| `team-directory-main` | Team directory |

## Read only

This module writes nothing. The only writer of `team/team-members.json` and
`team/avatars/` is Settings > Users (`/api/team/*`) - a second writer of the
same files would be a second place where that data could disagree. The
roster is read only through the core resolver, `js/team-directory.js`
(`getTeamMembers`, `memberAvatarUrl`, `memberInitials`, `fullName`), through
a dynamic-import bridge in `client/index.js` - a static `import` from
`/js/...` would break the contract test, which loads this file in plain Node
with no browser document and no `/js/...` URL resolver.

## `dataRepos` is a read view

The `team/` folder in the data repository is shared - the top-bar avatar,
the training path and `js/team-directory.js` all read it - and it belongs to
the core in the data sync window. This module declares `team/` with
`access: "read"` only, so it never takes ownership of those shared files;
the contract test holds that rule.

## Team logos

Logo files (`<slug>_light.png` / `<slug>_dark.png`) live in
`data-sub-repositories/ds-data/team/logos/`. Slugs are mapped from team names
in `TEAM_ORDER` / `LOGO_TEAMS` in `client/team-directory-lib.js` (example
teams: Atlas, Borealis, Comet, Delta, Echo, Falcon) - edit those two constants
to match your own teams. A team with no slug in the map (`Guests`) and every
missing file get initials instead of a broken image.

## Tests

`tests/test_team_directory.mjs` checks the module contract (manifest, no
server layer, a read-only `dataRepos` entry, no static `/js/...` import) and
`tests/test_team_directory_lib.mjs` checks the pure functions in
`client/team-directory-lib.js`. Both run with `npm test`.

## Dashboard widget

The "Our teams" widget (`teams`, `client/widget.js`) shows the teams from the
team directory: member photos, head count per team and the share of each
team. The module has no server layer, so the widget reads the core route
`GET /api/team/members`. Variants: s, s2, m, m2 (default), l, xl. When there
is no directory on this machine, the widget shows one sentence pointing to
the Sync window and to Settings > Users. Test:
`tests/test_team_directory_widget.mjs`.
