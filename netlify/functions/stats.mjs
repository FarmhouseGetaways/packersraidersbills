// /api/stats — everything the page shows for the current season.
//
// This exists instead of the page calling ESPN directly for two reasons:
// ESPN's endpoints are not a documented CORS-friendly API, and one page load
// would otherwise be sixteen cross-origin requests. Here it is one request to
// our own origin, fanned out server-side and cached.

import {
  TEAMS, CORE, SITE, getJson, indexCategories, pick, readRecord, allSettledValues,
} from './_lib/espn.mjs';
import { CATEGORIES, QB, leaders, clock } from './_lib/metrics.mjs';
import { loadNflverseTeams, loadNflverseQbs } from './_lib/nflverse.mjs';
import { competitionRank } from './_lib/rank.mjs';

const TTL_MS = 120_000; // two minutes — live enough for a scoreboard, kind to ESPN
let cache = { at: 0, payload: null };

// Not under SITE (…/apis/site/v2/…) — the league standings live one level up,
// under …/apis/v2/…. `level=3` is what asks ESPN for the division tier;
// without it the entries are conference-wide (16 teams), not the four-team
// groups a division table needs.
const STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings?level=3';

// Every status ESPN's roster feed has actually returned: a placed-on-IR
// player is every bit as unavailable as one marked "Out", so the two share
// a rank; anything unrecognised sorts last rather than vanishing.
const INJURY_SEVERITY = { Out: 0, 'Injured Reserve': 0, Doubtful: 1, Questionable: 2 };

export default async () => {
  const fresh = cache.payload && Date.now() - cache.at < TTL_MS;
  if (fresh) return respond(cache.payload, 'hit');

  try {
    const payload = await build();
    cache = { at: Date.now(), payload };
    return respond(payload, 'miss');
  } catch (err) {
    // Serving yesterday's numbers beats serving an error page. Only when
    // there is nothing cached at all does this become a 502.
    if (cache.payload) return respond({ ...cache.payload, stale: true }, 'stale');
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }
};

function respond(payload, cacheState) {
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=600',
      'x-stats-cache': cacheState,
    },
  });
}

async function build() {
  const scoreboard = await getJson(`${SITE}/scoreboard`).catch(() => null);
  const season = readSeason(scoreboard);

  const [teams, standingsRoot, injuries, nflverseTeams, nflverseQbs] = await Promise.all([
    Promise.all(TEAMS.map((t) => buildTeam(t, season.year))),
    getJson(STANDINGS_URL).catch(() => null),
    buildInjuries(),
    loadNflverseTeams(season.year).catch(() => []),
    loadNflverseQbs(season.year).catch(() => ({ qualified: [], leaderByTeam: new Map() })),
  ]);
  const divisions = buildDivisions(standingsRoot);
  const nflRanks = buildLeagueRanks(standingsRoot);
  for (const t of teams) t.nflRank = nflRanks[t.abbr] ?? null;
  const slate = weekGames(scoreboard);

  // Every rank shown in "The numbers" and the quarterback table comes from
  // here — computed once, across all 32 teams (or every qualifying passer),
  // from the same nflverse rows the values themselves are read from. Never
  // from a rank field either ESPN endpoint hands back: see the note at the
  // top of metrics.mjs for why that turned out not to be safe.
  const teamRanks = rankAllMetrics(CATEGORIES.flatMap((c) => c.metrics), nflverseTeams, (r) => r.abbr);
  const qbRanks = rankAllMetrics(QB, nflverseQbs.qualified, (r) => r.id);

  const nflverseByAbbr = new Map(nflverseTeams.map((r) => [r.abbr, r]));
  for (const t of teams) {
    const nfRow = nflverseByAbbr.get(t.abbr);
    // The header on every comparison table ("3 games") and the fallback for
    // the team card's own games-played tile: nflverse's own row count is a
    // real count of that team's completed games, not a cached counter.
    t.gamesPlayed = nfRow?.games ?? t.gamesPlayed;
    t.qb = buildQb(nflverseQbs.leaderByTeam.get(t.abbr));
  }

  return {
    generated: new Date().toISOString(),
    season,
    teams,
    divisions,                           // our three clubs' own divisions only
    injuries,                            // one entry per club, empty list if none listed
    live: slate.filter((g) => g.ours),   // our three clubs' games only
    slate,                               // the whole league's week
    // The winner of each row is decided here, once, so the page cannot
    // disagree with itself about who is ahead.
    comparison: {
      categories: CATEGORIES.map((c) => ({
        key: c.key, title: c.title, note: c.note ?? null, open: !!c.open,
        rows: compare(c.metrics, teams, {
          nfRow: (t) => nflverseByAbbr.get(t.abbr),
          nfRanks: teamRanks,
          nfRankKeyOf: (t) => t.abbr,
        }),
      })),
      qb: compare(QB, teams, {
        source: (t) => t.qb?.indexed,
        nfRow: (t) => t.qb?.nfStats,
        nfRanks: qbRanks,
        nfRankKeyOf: (t) => t.qb?.id,
      }),
    },
  };
}

/**
 * For every metric that names an `nf` field, rank every row (team or QB) on
 * that field, across the FULL set passed in — all 32 teams, or every
 * qualifying passer — never just the three this page shows. Two metrics
 * that read the same field (e.g. a team's own passer-rating row and the QB
 * table's) share the same rank computation rather than each redoing it.
 */
function rankAllMetrics(metrics, rows, keyOf) {
  const out = {};
  for (const m of metrics) {
    if (!m.nf || out[m.nf]) continue;
    out[m.nf] = competitionRank(rows, (r) => r[m.nf], m.better === 'low', keyOf);
  }
  return out;
}

function readSeason(scoreboard) {
  const league = scoreboard?.leagues?.[0];
  const year = league?.season?.year;
  return {
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    week: scoreboard?.week?.number ?? null,
    type: league?.season?.type?.name ?? 'Regular Season',
  };
}

async function buildTeam(team, year) {
  const base = `${CORE}/seasons/${year}/types/2/teams/${team.id}`;
  const [info, stats] = await allSettledValues([
    getJson(`${SITE}/teams/${team.slug}`),
    getJson(`${base}/statistics`),
  ]);

  const t = info?.team ?? {};
  const indexed = indexCategories(stats?.splits?.categories);
  const record = readRecord(t.record);

  return {
    ...team,
    // ESPN serves each club's own colours. Preferring them over the hardcoded
    // pair means the page follows a rebrand without a commit; the constants in
    // espn.mjs are only the fallback for when this call fails.
    color: t.color ? `#${t.color}` : team.color,
    alt: t.alternateColor ? `#${t.alternateColor}` : team.alt,
    displayName: t.displayName ?? team.name,
    location: t.location ?? null,
    nickname: t.nickname ?? null,
    logo: pickLogo(t.logos),
    record,
    // Overwritten with nflverse's own count once build() has that data —
    // this ESPN value is only ever the fallback for when that fetch fails.
    gamesPlayed: indexed?.general?.gamesPlayed?.value ?? null,
    standing: t.standingSummary ?? null,
    nextEvent: readNextEvent(t.nextEvent),
    indexed,
    // Set in build(), once the nflverse passing data is in: buildQb(t, nfQb).
    qb: null,
  };
}

function pickLogo(logos) {
  if (!Array.isArray(logos) || !logos.length) return null;
  // The page is dark, so prefer the logo ESPN marks for dark backgrounds.
  const dark = logos.find((l) => (l.rel || []).includes('dark'));
  return (dark || logos[0]).href ?? null;
}

function readNextEvent(nextEvent) {
  const ev = Array.isArray(nextEvent) ? nextEvent[0] : null;
  if (!ev) return null;
  return {
    name: ev.shortName ?? ev.name ?? null,
    date: ev.date ?? null,
    week: ev.week?.number ?? null,
    venue: ev.competitions?.[0]?.venue?.fullName ?? null,
  };
}

/**
 * Each club's leading passer, read from nflverse rather than ESPN's athlete
 * endpoints — one fewer thing pointed at ESPN, and it already has everything
 * this needs: name, headshot, and every number the QB table compares.
 * `nfStats` is kept on the object (not flattened) so compare() can read it
 * by the same `nf` field names the team rows use.
 */
function buildQb(q) {
  if (!q) return null;
  const rating = Number.isFinite(q.passerRating) ? q.passerRating.toFixed(1) : null;
  return {
    id: q.id,
    name: q.name,
    jersey: null, // not in nflverse's player file; the position/name are enough to identify the card
    position: 'QB',
    headshot: q.headshot,
    line: qbLine(q),
    nfStats: q,
    // A small compatibility shape so the QB card's rating badge
    // (drawQbs in app.js) can keep reading indexed.passing.QBRating.display
    // exactly as it always has — the number underneath is now our own. This
    // is also the only reason "Longest pass" in the QB comparison table is
    // blank now rather than merely rank-less: it lived on the per-athlete
    // ESPN endpoint this function used to call, and nflverse's summary file
    // does not carry single-play stats (see the note in nflverse.mjs).
    indexed: { passing: { QBRating: { value: q.passerRating, display: rating, rank: null } } },
  };
}

function qbLine(q) {
  if (!Number.isFinite(q.attempts) || !q.attempts) return null;
  const parts = [`${q.completions}/${q.attempts}`, `${q.passYds} YDS`, `${q.passTd} TD`];
  if (q.ints) parts.push(`${q.ints} INT`);
  return parts.join(', ');
}

/**
 * Every game on this week's scoreboard, the whole league's, soonest first.
 * `ours` marks the ones involving one of the three clubs: the live-scores
 * strip and the game-day default are ours only, while the scores ticker
 * shows the full slate.
 */
function weekGames(scoreboard) {
  const ours = new Set(TEAMS.map((t) => t.abbr));
  const out = [];
  for (const ev of scoreboard?.events || []) {
    const comp = ev.competitions?.[0];
    const cs = comp?.competitors || [];
    const situation = comp?.situation;
    out.push({
      name: ev.shortName ?? null,
      date: ev.date ?? null,                          // kickoff, ISO — drives the game-day default and the live-scores window
      state: comp?.status?.type?.state ?? null,       // pre | in | post
      detail: comp?.status?.type?.shortDetail ?? null,
      venue: comp?.venue?.fullName ?? null,
      network: (comp?.broadcasts || []).flatMap((b) => b.names || [])[0] ?? null,
      // down/distance only ever arrive together; yardLine's own orientation
      // (whose 0 end?) isn't worth the risk of getting backwards for a "down
      // & distance" note, so it is read here but never turned into a
      // "ball on" position.
      down: Number.isFinite(situation?.down) ? situation.down : null,
      distance: Number.isFinite(situation?.distance) ? situation.distance : null,
      redZone: situation?.isRedZone === true,
      ours: cs.some((c) => ours.has(c.team?.abbreviation)),
      teams: cs.map((c) => ({
        abbr: c.team?.abbreviation ?? null,
        score: c.score != null ? Number(c.score) : null,
        home: c.homeAway === 'home',
      })),
    });
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/**
 * Our three clubs' own divisions — never the other five. A reader here for
 * the Packers has no use for the NFC South standings; this stays a page
 * about three teams, not a league standings site that happens to open on
 * three teams.
 */
function buildDivisions(root) {
  const groups = root?.children?.flatMap((conf) => conf.children || []) || [];
  const ourAbbrs = new Set(TEAMS.flatMap((t) => t.abbrs || [t.abbr]));

  const divisions = groups
    .filter((g) => (g.standings?.entries || []).some((e) => ourAbbrs.has(e.team?.abbreviation)))
    .map((g) => ({
      name: g.name ?? null,
      teams: (g.standings?.entries || [])
        .map((e) => ({
          abbr: e.team?.abbreviation ?? null,
          name: e.team?.shortDisplayName ?? e.team?.displayName ?? null,
          logo: pickLogo(e.team?.logos),
          ours: ourAbbrs.has(e.team?.abbreviation),
          wins: divStat(e, 'wins'),
          losses: divStat(e, 'losses'),
          ties: divStat(e, 'ties'),
          pct: divStat(e, 'winPercent'),
          gamesBehind: divStat(e, 'gamesBehind', true),
          streak: divStat(e, 'streak', true),
          differential: divStat(e, 'differential', true),
        }))
        .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1)),
    }));

  // Packers, Raiders, Bills order — the page's own club order — rather than
  // however ESPN happened to walk conferences and divisions.
  return TEAMS
    .map((t) => divisions.find((d) => d.teams.some((x) => x.ours && x.abbr === t.abbr)))
    .filter(Boolean)
    // Two of the three can share a division only if realignment ever
    // happens; dedupe so it is not shown twice.
    .filter((d, i, arr) => arr.indexOf(d) === i);
}

function divStat(entry, name, display = false) {
  const s = (entry.stats || []).find((x) => x.name === name);
  if (!s) return null;
  return display ? (s.displayValue ?? null) : (Number.isFinite(s.value) ? s.value : null);
}

/**
 * Where each of our three clubs stands among all 32 teams — not just the
 * three on this page — on points scored, points allowed and point
 * differential. The small print under each number on the team card.
 *
 * The standings feed gives season TOTALS for points, not the per-game
 * average the card shows, and two teams can easily have played a different
 * number of games at any point in the season — so scored/allowed are
 * divided down to a per-game figure before ranking. Differential is ranked
 * as the league already reports it: a season total, not per-game.
 */
function buildLeagueRanks(root) {
  const entries = (root?.children || [])
    .flatMap((conf) => conf.children || [])
    .flatMap((div) => div.standings?.entries || []);

  const rows = entries.map((e) => {
    const games = (divStat(e, 'wins') ?? 0) + (divStat(e, 'losses') ?? 0) + (divStat(e, 'ties') ?? 0);
    const pf = divStat(e, 'pointsFor');
    const pa = divStat(e, 'pointsAgainst');
    return {
      abbr: e.team?.abbreviation ?? null,
      pf: games && pf != null ? pf / games : null,
      pa: games && pa != null ? pa / games : null,
      diff: divStat(e, 'differential'),
    };
  }).filter((r) => r.abbr);

  const rankBy = (valueOf, lowerIsBetter) => {
    const dir = lowerIsBetter ? 1 : -1;
    const sorted = rows
      .filter((r) => Number.isFinite(valueOf(r)))
      .sort((a, b) => dir * (valueOf(a) - valueOf(b)));
    const out = {};
    let rank = 0;
    sorted.forEach((r, i) => {
      if (i === 0 || valueOf(r) !== valueOf(sorted[i - 1])) rank = i + 1;
      out[r.abbr] = rank;
    });
    return out;
  };

  const pfRank = rankBy((r) => r.pf, false);
  const paRank = rankBy((r) => r.pa, true);
  const diffRank = rankBy((r) => r.diff, false);

  const out = {};
  for (const r of rows) out[r.abbr] = { pf: pfRank[r.abbr] ?? null, pa: paRank[r.abbr] ?? null, diff: diffRank[r.abbr] ?? null };
  return out;
}

/**
 * The current injury report for each club, from the same roster call ESPN's
 * own site reads it from — not the "injuries" core-API feed, which turns out
 * to be a general player-news log (most of it about players who are fully
 * active) rather than a report of who is actually unavailable.
 */
async function buildInjuries() {
  const rosters = await allSettledValues(TEAMS.map((t) => getJson(`${SITE}/teams/${t.slug}/roster`)));
  return TEAMS.map((team, i) => {
    const groups = rosters[i]?.athletes || [];
    const players = groups
      .flatMap((g) => g.items || [])
      .flatMap((a) => {
        const inj = a.injuries?.[0];
        if (!inj?.status) return [];
        return [{
          name: a.fullName ?? a.displayName ?? null,
          position: a.position?.abbreviation ?? null,
          status: inj.status,
          date: inj.date ?? null,
        }];
      })
      .sort((a, b) => (
        (INJURY_SEVERITY[a.status] ?? 3) - (INJURY_SEVERITY[b.status] ?? 3)
        || String(a.name).localeCompare(String(b.name))
      ));
    return { key: team.key, players };
  });
}

/**
 * Build one comparison row per metric: each team's value, and who leads.
 *
 * Three sources, in priority order:
 *   1. `m.from === 'record'` — straight off the season record (wins, points).
 *      Ranked from `nfRanks`/`nflRankKey` when the metric names one — the
 *      standings-derived league ranks computed in build().
 *   2. `m.nf` — a field on the nflverse season row (`nfRow(t)`), ranked
 *      against every row in `nfRanks[m.nf]` (all 32 teams, or every
 *      qualifying QB — never just the three this page shows).
 *   3. Neither — ESPN's own indexed stat. The value is kept (nothing better
 *      exists for these — third-down %, time of possession, longest play,
 *      and the rest nflverse's summary file doesn't carry), but the rank is
 *      always null: ESPN's own per-stat rank field is what sent us looking
 *      for a second source in the first place, and is never shown again.
 */
function compare(metrics, teams, opts = {}) {
  const {
    source = (t) => t.indexed,
    nfRow = () => null,
    nfRanks = {},
    nfRankKeyOf = (t) => t.abbr,
  } = opts;

  return metrics.map((m) => {
    const values = {};
    const displays = {};
    const ranks = {};
    for (const t of teams) {
      if (m.from === 'record') {
        const v = t.record?.[m.field];
        values[t.key] = Number.isFinite(v) ? v : null;
        displays[t.key] = Number.isFinite(v) ? v.toFixed(m.dp ?? 0) : null;
        ranks[t.key] = m.nflRankKey ? (t.nflRank?.[m.nflRankKey] ?? null) : null;
        continue;
      }
      if (m.nf) {
        const row = nfRow(t);
        const v = row ? row[m.nf] : null;
        values[t.key] = Number.isFinite(v) ? v : null;
        displays[t.key] = formatNf(v, m);
        ranks[t.key] = nfRanks[m.nf]?.get(nfRankKeyOf(t)) ?? null;
        continue;
      }
      const s = pick(source(t), m.cat, m.stat);
      values[t.key] = s.value;
      // Time of possession arrives as a raw second count; "3448" is not a
      // time of possession anybody reads.
      displays[t.key] = m.format === 'clock' ? clock(s.value) : s.display;
      ranks[t.key] = null;
    }
    return {
      key: m.key, label: m.label, better: m.better, suffix: m.suffix ?? '',
      count: !!m.count,
      values, displays, ranks,
      leaders: leaders(values, m.better),
    };
  });
}

/** nflverse hands back raw numbers, not ESPN's pre-formatted display
 *  strings — a season total reads as a whole number, a rate or percentage to
 *  one decimal place, matching what this page already showed for the same
 *  kind of figure. */
function formatNf(v, m) {
  if (!Number.isFinite(v)) return null;
  return v.toFixed(m.dp ?? (m.count ? 0 : 1));
}
