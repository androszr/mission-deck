#!/usr/bin/env node
'use strict';
// scripts/mini-deck-avatars.js
//
// Writes Mini Deck's demo avatars: one fruit with a face per person in
// apps/mini-deck/public/data/team.json (scripts/_fruit-avatars.js), into
// apps/mini-deck/public/avatars/<slug>.svg, and points each member's
// `avatar` at its file. Deterministic: a second run changes nothing.
//
//   node scripts/mini-deck-avatars.js

const fs = require('fs');
const path = require('path');
const { fruitAvatarSvg } = require('./_fruit-avatars.js');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'apps', 'mini-deck', 'public');
const TEAM = path.join(APP, 'data', 'team.json');

function slugOf(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function build(team) {
  const files = new Map();
  const members = team.members.map((m, i) => {
    const rel = 'avatars/' + slugOf(m.name) + '.svg';
    files.set(rel, fruitAvatarSvg(i, m.name));
    return { name: m.name, role: m.role, squad: m.squad, avatar: rel };
  });
  return { team: { ...team, members }, files };
}

function main() {
  const team = JSON.parse(fs.readFileSync(TEAM, 'utf8'));
  const { team: next, files } = build(team);
  fs.mkdirSync(path.join(APP, 'avatars'), { recursive: true });
  for (const [rel, svg] of files) fs.writeFileSync(path.join(APP, rel), svg);
  const lines = next.members.map((m) => '    ' + JSON.stringify(m).replace(/","/g, '", "').replace(/^\{"/, '{ "').replace(/"\}$/, '" }').replace(/":"/g, '": "'));
  fs.writeFileSync(TEAM, '{\n  "generatedAt": ' + JSON.stringify(next.generatedAt) + ',\n  "members": [\n' + lines.join(',\n') + '\n  ]\n}\n');
  console.log('Mini Deck avatars: ' + files.size + ' written.');
}

if (require.main === module) main();

module.exports = { build, slugOf };
