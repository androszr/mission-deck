'use strict';
// modules/sprint-review/server/confluence.js
// Parsers for the Sprint Review page in Confluence storage format, written
// with zero non-ASCII bytes: every typographic quote and emoji is a \u
// escape (curly quotes U+201C/U+201D, format markers U+1F5BC/U+1F4BB/U+1F5E3,
// the trailing variation selector U+FE0F).
//
// Expected page template (English): one <h2> per team, in page order; under
// it a "Sprint Goal" in quotes, an optional status macro (green / yellow /
// red) and a list of "Topic: ..." items with presenters (user mentions) and
// a format marker (U+1F5BC or U+1F4BB = presentation, U+1F5E3 = discussion).
// A panel titled "Facilitator" names the facilitator. Every <h2> section IS
// a team - there is no team allowlist. A team named in the injected
// `dualSectionTeams` list splits into Problem Space / Solution Space (<h3>,
// with a plain-text fallback).

const CURLY_OPEN = '\u201c';
const CURLY_CLOSE = '\u201d';
// Opening and closing classes differ - Confluence storage format pairs
// &ldquo;...&rdquo; (or a literal curly-quote pair, or &quot; on either
// side), never &ldquo; twice.
const QUOTE_OPEN_CLASS = '(?:&ldquo;|&quot;|[' + CURLY_OPEN + CURLY_CLOSE + '])';
const QUOTE_CLOSE_CLASS = '(?:&rdquo;|&quot;|[' + CURLY_OPEN + CURLY_CLOSE + '])';
const FORMAT_PRESENTATION_RE = /\u{1F5BC}|\u{1F4BB}/u;
const FORMAT_DISCUSSION_RE = /\u{1F5E3}/u;
const FORMAT_STRIP_RE = /[\u{1F5BC}\u{1F4BB}\u{1F5E3}\uFE0F]/gu;

// Strip vendor/role-code affixes from a Confluence displayName, e.g.
// "EXT Rivera Sam" -> "Rivera Sam", "Lee Jordan CTR" -> "Lee Jordan"; adjust
// the codes to your organisation.
const ROLE_CODES_RE = /^(?:EXT|VND|CTR)\s+|\s+(?:EXT|VND|CTR)$|\s*\([^)]*\)\s*$/gi;

function normalizeName(raw) {
  return String(raw || '').replace(ROLE_CODES_RE, '').trim();
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<ac:link>[\s\S]*?<\/ac:link>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&ldquo;/g, CURLY_OPEN)
    .replace(/&rdquo;/g, CURLY_CLOSE)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x[0-9a-fA-F]+;/g, '')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses the "Sprint N Review" / "dd.mm.yyyy Sprint N" title into a review
 * date and sprint number. Either field is null when the title carries no
 * matching pattern - the caller falls back to today's date and the raw
 * title.
 * @param {string} title
 * @returns {{reviewDate: string|null, sprintN: number|null}}
 */
function parseTitle(title) {
  const t = String(title || '');
  const dateM = t.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  const sprintM = t.match(/Sprint\s+(\d+)/i);
  return {
    reviewDate: dateM ? (dateM[3] + '-' + dateM[2] + '-' + dateM[1]) : null,
    sprintN: sprintM ? parseInt(sprintM[1], 10) : null,
  };
}

/**
 * Cleans one <h2>...</h2> heading into a team name: strip HTML/entities,
 * collapse whitespace, then look the cleaned lowercase text up in `aliases`
 * - a hit corrects spelling only (e.g. 'falcon' -> 'Falcon'), a miss
 * keeps the cleaned text AS IS, in its own casing. An empty heading (after
 * cleaning) is not a team and returns null - the only heading this parser
 * ever skips.
 * @param {string} rawHeadingHtml the HTML between <h2...> and </h2>
 * @param {object} aliases lowercase-single-spaced text -> canonical name
 * @returns {string|null}
 */
function canonicalTeamName(rawHeadingHtml, aliases) {
  const cleaned = normalizeName(stripHtml(rawHeadingHtml)).replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const key = cleaned.toLowerCase();
  return (aliases && aliases[key]) || cleaned;
}

/**
 * Parses one team's topic list out of a section's HTML. `randomBytes` is
 * injected so the test suite can assert deterministic ids.
 * @param {string} sectionHtml
 * @param {object} userMap userkey -> display name
 * @param {(size: number) => Buffer} randomBytes
 */
function parseTopics(sectionHtml, userMap, randomBytes) {
  const topics = [];
  const chunks = sectionHtml.split(/(?=<li[^>]*>(?:<p[^>]*>)?(?:<strong[^>]*>)?\s*(?:&nbsp;|\s)*Topic)/i);
  for (const chunk of chunks) {
    if (!/\bTopic\b/i.test(chunk.slice(0, 300))) continue;
    const nestedUl = chunk.indexOf('<ul');
    const inlineHtml = nestedUl > 0 ? chunk.slice(0, nestedUl) : chunk;
    const userkeys = [...inlineHtml.matchAll(/ri:userkey="([^"]+)"/g)].map((m) => m[1]);
    const presenters = userkeys.map((k) => userMap[k] || '').filter(Boolean);
    const hasPres = FORMAT_PRESENTATION_RE.test(inlineHtml);
    const hasDisc = FORMAT_DISCUSSION_RE.test(inlineHtml);
    let format = '';
    if (hasPres && hasDisc) format = 'presentation';
    else if (hasPres) format = 'presentation';
    else if (hasDisc) format = 'discussion';
    const firstParaEnd = inlineHtml.indexOf('</p>');
    const titleHtml = firstParaEnd > 0 ? inlineHtml.slice(0, firstParaEnd + 4) : inlineHtml;
    let title = stripHtml(titleHtml);
    title = title.replace(/^\s*Topic\s*:?\s*/i, '').trim();
    title = title.replace(/\s*(Goal:|Steps taken:|Results[/:]|Lessons:).*$/si, '').trim();
    title = title.replace(FORMAT_STRIP_RE, '').replace(/\s*\/\s*$/, '').replace(/\s+/g, ' ').trim();
    if (!title) continue;
    // The unfilled Confluence template row is literally "Topic: ..." - skip
    // the placeholder, or every import would carry one empty row.
    if (/^[.\u2026\s]+$/.test(title)) continue;
    topics.push({ id: 'cf-' + randomBytes(4).toString('hex'), title, format, presenters: presenters.slice() });
  }
  return topics;
}

/**
 * Finds the panel whose title contains "Facilitat" (covers "Facilitator" /
 * "Facilitated by", with or without an emoji) and returns the first resolved
 * userkey inside it.
 */
function extractFacilitator(body, userMap) {
  const titleIdx = body.search(/ac:name="title">[^<]*Facilitat[^<]*<\/ac:parameter>/i);
  if (titleIdx < 0) return '';
  const win = body.slice(titleIdx, titleIdx + 600);
  const keyM = win.match(/ri:userkey="([^"]+)"/);
  return keyM ? (userMap[keyM[1]] || '') : '';
}

function parseGoalAndStatus(sectionOrBody) {
  const goalMatch = sectionOrBody.match(new RegExp('Sprint[\\s\\S]{0,100}?Goal[\\s\\S]{0,400}?' + QUOTE_OPEN_CLASS + '([\\s\\S]+?)' + QUOTE_CLOSE_CLASS, 'i'));
  const goal = goalMatch ? stripHtml(goalMatch[1]).trim() : '';
  const macroMatches = [...sectionOrBody.matchAll(/ac:name="status"[\s\S]{0,500}?<ac:parameter ac:name="colour">([^<]+)<\/ac:parameter>/g)];
  let realizationStatus = '';
  if (macroMatches.length === 1) {
    const col = macroMatches[0][1].trim().toLowerCase();
    if (col === 'green') realizationStatus = 'achieved';
    else if (col === 'red') realizationStatus = 'not-achieved';
    else if (col === 'yellow') realizationStatus = 'partial';
  }
  return { goal, realizationStatus };
}

/**
 * Splits an Echo-shaped (dual-section) team's section into its Problem Space / Solution
 * Space HTML halves. Primary: split on <h3> headings (most reliable for a
 * standard Confluence structure). Fallback, when no <h3> heading matched
 * either label: a plain-text split on the words "Solution Space" (with
 * "Problem Space" marking where the first half starts, when present); with
 * neither found the whole section is treated as Problem Space.
 */
function splitDualSections(rest) {
  let psHtml = '';
  let ssHtml = '';
  const h3Parts = rest.split(/<h3[^>]*>/i);
  for (const part of h3Parts) {
    const end = part.indexOf('</h3>');
    if (end < 0) continue;
    const heading = stripHtml(part.slice(0, end)).toLowerCase();
    const content = part.slice(end + 5);
    if (/problem.?space/i.test(heading)) psHtml += content;
    else if (/solution.?space/i.test(heading)) ssHtml += content;
  }
  if (!psHtml && !ssHtml) {
    const ssIdx = rest.search(/Solution\s+Space/i);
    if (ssIdx > 0) {
      const psIdx = rest.search(/Problem\s+Space/i);
      psHtml = psIdx >= 0 ? rest.slice(psIdx, ssIdx) : rest.slice(0, ssIdx);
      ssHtml = rest.slice(ssIdx);
    } else {
      psHtml = rest;
    }
  }
  return { psHtml, ssHtml };
}

/**
 * Parses the page body into a per-team map, in page order:
 * { team: { goal, realizationStatus, topics } } for a normal team, or
 * { team: { goal, realizationStatus, topicsProblemSpace, topicsSolutionSpace } }
 * for a team in `opts.dualSectionTeams`. Every <h2> section with a non-empty
 * heading (after canonicalTeamName cleaning) becomes a team - there is no
 * allowlist and no single-team fallback. The same team appearing twice on
 * the page appends its second section's topics to the first rather than
 * overwriting it.
 * @param {string} body Confluence storage-format body
 * @param {object} userMap userkey -> display name
 * @param {{aliases?: object, dualSectionTeams?: string[]}} opts
 * @param {(size: number) => Buffer} randomBytes
 */
function parseBody(body, userMap, opts, randomBytes) {
  const aliases = (opts && opts.aliases) || {};
  const dualSectionTeams = (opts && opts.dualSectionTeams) || [];
  const result = {};
  const sections = body.split(/<h2[^>]*>/);
  for (const section of sections) {
    const h2End = section.indexOf('</h2>');
    if (h2End < 0) continue;
    const teamName = canonicalTeamName(section.slice(0, h2End), aliases);
    if (!teamName) continue;
    const rest = section.slice(h2End + 5);
    const { goal, realizationStatus } = parseGoalAndStatus(rest);

    if (dualSectionTeams.includes(teamName)) {
      const { psHtml, ssHtml } = splitDualSections(rest);
      const freshPs = parseTopics(psHtml, userMap, randomBytes);
      const freshSs = parseTopics(ssHtml, userMap, randomBytes);
      const prior = result[teamName];
      result[teamName] = {
        goal: prior ? prior.goal : goal,
        realizationStatus: prior ? prior.realizationStatus : realizationStatus,
        topicsProblemSpace: prior ? [...prior.topicsProblemSpace, ...freshPs] : freshPs,
        topicsSolutionSpace: prior ? [...prior.topicsSolutionSpace, ...freshSs] : freshSs,
      };
    } else {
      const freshTopics = parseTopics(rest, userMap, randomBytes);
      const prior = result[teamName];
      result[teamName] = {
        goal: prior ? prior.goal : goal,
        realizationStatus: prior ? prior.realizationStatus : realizationStatus,
        topics: prior ? [...prior.topics, ...freshTopics] : freshTopics,
      };
    }
  }
  return result;
}

/** Normalizes a topic title for identity comparison across re-imports. */
function normTitle(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Keeps every existing topic and appends only freshly-parsed topics that do
 * not already have a match among the old ones, matched by title AND by
 * count per title (a naive "does this title exist" check silently drops
 * legitimate duplicates).
 * Only previously-imported topics (id prefix "cf-") have their mutable
 * fields (format, presenters) refreshed from the fresh parse; manually
 * added topics ("t-") are left untouched.
 */
function mergeTopicsList(oldTopics, freshTopics) {
  const old = Array.isArray(oldTopics) ? oldTopics : [];
  const fresh = Array.isArray(freshTopics) ? freshTopics : [];
  const remaining = new Map();
  for (let i = 0; i < old.length; i++) {
    const key = normTitle(old[i] && old[i].title);
    if (!remaining.has(key)) remaining.set(key, []);
    remaining.get(key).push(i);
  }
  const result = old.slice();
  const added = [];
  for (const t of fresh) {
    const key = normTitle(t && t.title);
    const queue = remaining.get(key);
    const idx = queue && queue.length ? queue.shift() : -1;
    if (idx >= 0) {
      if (result[idx] && String(result[idx].id || '').startsWith('cf-')) {
        result[idx] = { ...result[idx], format: t.format, presenters: t.presenters };
      }
    } else {
      added.push(t);
    }
  }
  return [...result, ...added];
}

/**
 * Re-import merge, per team: keeps realizationStatus/submitted/every other
 * manual field untouched and merges topics additively. A team listed in
 * `dualSectionTeams` merges topicsProblemSpace and topicsSolutionSpace
 * separately (no flat `topics`); every other team merges `topics`. A team
 * with no prior submission takes the fresh parse as-is.
 * @param {object} oldSubmissions
 * @param {object} freshSubmissions
 * @param {string[]} [dualSectionTeams]
 */
function mergeReimportedSubmissions(oldSubmissions, freshSubmissions, dualSectionTeams) {
  const dual = dualSectionTeams || [];
  const merged = {};
  const teams = new Set([
    ...Object.keys(oldSubmissions || {}),
    ...Object.keys(freshSubmissions || {}),
  ]);
  for (const team of teams) {
    const hadOld = !!(oldSubmissions && oldSubmissions[team]);
    const freshSub = (freshSubmissions && freshSubmissions[team]) || {};
    if (!hadOld) {
      merged[team] = freshSub;
      continue;
    }
    const oldSub = oldSubmissions[team];
    merged[team] = dual.includes(team)
      ? {
        ...oldSub,
        topicsProblemSpace: mergeTopicsList(oldSub.topicsProblemSpace, freshSub.topicsProblemSpace),
        topicsSolutionSpace: mergeTopicsList(oldSub.topicsSolutionSpace, freshSub.topicsSolutionSpace),
      }
      : {
        ...oldSub,
        topics: mergeTopicsList(oldSub.topics, freshSub.topics),
      };
  }
  return merged;
}

/**
 * Compares a Confluence page against the existing session list to decide
 * the badge the import modal shows.
 * @param {{id: string, version: {number: number}}} page
 * @param {{confluencePageId: string, confluenceVersion: number|null}|null} existing
 * @returns {'new'|'synced'|'outdated'}
 */
function discoverStatus(page, existing) {
  if (!existing) return 'new';
  const cfVersion = page.version && page.version.number;
  return (cfVersion && existing.confluenceVersion && existing.confluenceVersion === cfVersion) ? 'synced' : 'outdated';
}

function newSessionIdFor(randomBytes) {
  return 'sr-' + randomBytes(8).toString('hex');
}

/**
 * Assembles a full session object from a fetched Confluence page. Does not
 * decide whether this is a fresh import or a re-import - the caller
 * (server/index.js) merges against an existing session by confluencePageId.
 * teamGoals and submissions are built from whichever teams parseBody found
 * on the page, in page order - a page with no <h2> at all yields
 * teamGoals: [] and submissions: {} (an empty-teams session, not an error).
 * @param {{title: string, body: string, userMap: object,
 *   aliases: object, dualSectionTeams: string[], meetingKey: string,
 *   pageId: string, version: number|null, now: () => Date,
 *   randomBytes: (size: number) => Buffer,
 *   deadlineFromReviewDate: (d: string) => string}} args
 */
function buildImportedSession(args) {
  const title = args.title || '';
  const parsedTitle = parseTitle(title);
  const reviewDate = parsedTitle.reviewDate || args.now().toISOString().slice(0, 10);
  const sprintN = parsedTitle.sprintN;
  const sprintName = sprintN ? ('Sprint ' + sprintN) : title;

  const dualSectionTeams = args.dualSectionTeams || [];
  const parsed = parseBody(args.body, args.userMap, { aliases: args.aliases, dualSectionTeams }, args.randomBytes);
  const teams = Object.keys(parsed);

  const teamGoals = teams.map((t) => ({ team: t, goal: parsed[t].goal || '', sprint_name: sprintName }));

  const submissions = {};
  for (const t of teams) {
    const p = parsed[t];
    submissions[t] = dualSectionTeams.includes(t)
      ? {
        submitted: true,
        realizationStatus: p.realizationStatus || '',
        topicsProblemSpace: p.topicsProblemSpace || [],
        topicsSolutionSpace: p.topicsSolutionSpace || [],
      }
      : {
        submitted: true,
        realizationStatus: p.realizationStatus || '',
        topics: p.topics || [],
      };
  }

  const nowIso = args.now().toISOString();
  return {
    id: newSessionIdFor(args.randomBytes),
    createdAt: nowIso,
    updatedAt: nowIso,
    reviewDate,
    sprintN,
    sprintName,
    deadline: args.deadlineFromReviewDate(reviewDate),
    facilitatorPo: extractFacilitator(args.body, args.userMap),
    meeting: args.meetingKey,
    teamGoals,
    submissions,
    cardsSentAt: null,
    confluencePageId: args.pageId,
    confluenceVersion: args.version,
  };
}

// -- HTTP client --------------------------------------------------------------
// createConfluenceClient wraps an injected `http(url, opts) -> Promise<Response>`
// so tests never touch the network. The HTML-instead-of-JSON gate mirrors
// the core's _confluenceFetchJson: a fetch that threw, a non-2xx, or a 2xx body that
// is not JSON (the tell for Confluence's SSO login page, served with a 200)
// all resolve to a typed error rather than letting a login page parse as
// session data.

class ConfluenceError extends Error {
  constructor(code, extra) {
    super(code);
    this.code = code;
    if (extra) Object.assign(this, extra);
  }
}

function createConfluenceClient(opts) {
  const http = opts.http;
  const baseUrl = opts.baseUrl;
  const token = opts.token;

  async function getJson(pathAndQuery, timeoutMs) {
    let res;
    try {
      res = await http(baseUrl + pathAndQuery, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ConfluenceError('confluence-unreachable');
    }
    const ctype = (res.headers && typeof res.headers.get === 'function' ? (res.headers.get('content-type') || '') : '').toLowerCase();
    if (ctype.includes('text/html')) throw new ConfluenceError('confluence-unreachable');
    if (!res.ok) throw new ConfluenceError('confluence-http', { status: res.status });
    try {
      return await res.json();
    } catch {
      throw new ConfluenceError('confluence-unreachable');
    }
  }

  return {
    childPages(parentId) {
      return getJson('/rest/api/content/' + parentId + '/child/page?limit=50&expand=version', 10000);
    },
    page(pageId) {
      return getJson('/rest/api/content/' + pageId + '?expand=body.storage,title,version', 15000);
    },
    getJson,
  };
}

/**
 * Resolves a set of Confluence userkeys to display names, in parallel.
 * A single failure resolves that one key to an empty string and never
 * aborts the rest of the import.
 * @param {ReturnType<createConfluenceClient>} client
 * @param {string[]} userkeys
 * @returns {Promise<object>} userkey -> display name
 */
async function resolveUsers(client, userkeys) {
  const userMap = {};
  await Promise.all(userkeys.map(async (key) => {
    try {
      const ud = await client.getJson('/rest/api/user?key=' + encodeURIComponent(key), 8000);
      const displayName = normalizeName(ud && ud.displayName);
      if (displayName) userMap[key] = displayName;
    } catch {
      // One unresolved presenter never blocks the rest of the import.
    }
  }));
  return userMap;
}

module.exports = {
  ConfluenceError,
  normalizeName,
  stripHtml,
  parseTitle,
  canonicalTeamName,
  parseTopics,
  extractFacilitator,
  parseBody,
  normTitle,
  mergeTopicsList,
  mergeReimportedSubmissions,
  discoverStatus,
  buildImportedSession,
  createConfluenceClient,
  resolveUsers,
};
