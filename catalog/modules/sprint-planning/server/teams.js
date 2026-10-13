'use strict';
// modules/sprint-planning/server/teams.js
// The one list of teams. Adding a team is one entry here; the plan id regex
// in plan.js is derived from TEAM_IDS, so nothing else hardcodes a name.
// The teams below are examples - replace them with your own.
//
// rosterTeam     - the `team` value in team/team-members.json
// sprintSrc      - the board key in the Sprint Stats index (boards.<key>, sprints[].src)
// sprintTeamKey  - the team name inside that board's sprint entries
// unit           - SP (story points) or MD (man-days)
// refinementSlot - null shows "Refinement slot to be set". Fill it with the
//                  team's fixed refinement slot:
//   { weekday: 2, from: '10:00', to: '11:00' }   // weekday 1..5 = Mon..Fri

const TEAMS = [
  { id: 'atlas', label: 'Atlas', rosterTeam: 'Atlas', sprintSrc: 'main', sprintTeamKey: 'Atlas', unit: 'SP', refinementSlot: null },
  { id: 'borealis', label: 'Borealis', rosterTeam: 'Borealis', sprintSrc: 'main', sprintTeamKey: 'Borealis', unit: 'SP', refinementSlot: null },
  { id: 'comet', label: 'Comet', rosterTeam: 'Comet', sprintSrc: 'main', sprintTeamKey: 'Comet', unit: 'SP', refinementSlot: null },
  { id: 'delta', label: 'Delta', rosterTeam: 'Delta', sprintSrc: 'ops', sprintTeamKey: 'Delta', unit: 'MD', refinementSlot: null },
];

const TEAM_IDS = TEAMS.map((t) => t.id);

/** @param {string} id @returns {object|null} */
function teamById(id) {
  return TEAMS.find((t) => t.id === id) || null;
}

module.exports = { TEAMS, TEAM_IDS, teamById };
