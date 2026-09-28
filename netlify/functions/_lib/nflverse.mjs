// nflverse — an independent, community-run play-by-play data project, not
// affiliated with ESPN. Used here because ESPN's own per-team and per-athlete
// "statistics" endpoints turned out to hand back rank and per-game fields
// that are internally inconsistent — two teams tied on the same touchdown
// total got different ranks, and a player's own "yards per game" field did
// not equal his own (correct) season total divided by his own (correct)
// games played. See the commit this file was added in for the numbers.
//
// nflverse publishes one CSV per season with one row per team (or player)
// per game — a real box score, not a pre-aggregated summary — so every
// total and every rank here is computed from scratch, in one place, from
// the same one fetch. Nothing here trusts a rank field handed to us by
// anyone.

const TEAM_STATS_URL = (year) => `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${year}.csv`;
const PLAYER_STATS_URL = (year) => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${year}.csv`;

// nflverse's own abbreviations for franchises that have moved: this project
// tracks LV under 'LV' for the current era, same as ESPN — no translation
// needed there. Nothing here reaches into pre-move history, so this is just
// the current-season file and current abbreviations throughout.

// The player file runs over a megabyte once the season is a few weeks in, so
// this gets longer than espn.mjs's default 8s — a slow fetch of it should
// time out before Netlify's own function limit does, not race it.
async function fetchCsv(url, timeout = 15_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'SportsTicker/1.0' } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return parseCsv(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A plain RFC4180 CSV parser — no dependency exists in this project to reach
 * for, and a naive split(',') breaks the moment a field is quoted with a
 * comma inside it, which nflverse's own headshot_url column does on every
 * row ("f_auto,q_auto" is part of the URL). Handles quoted fields, commas
 * and doubled "" escapes inside them, and \r\n or \n line endings.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { pushField(); continue; }
    if (c === '\r') continue;
    if (c === '\n') { pushRow(); continue; }
    field += c;
  }
  // A trailing newline leaves nothing to push; a file with no trailing
  // newline still has one last field/row waiting.
  if (field !== '' || row.length) pushRow();

  const header = rows.shift();
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function sum(rows, col) {
  return rows.reduce((t, r) => t + num(r[col]), 0);
}

function max(rows, col) {
  return rows.reduce((m, r) => Math.max(m, num(r[col])), 0);
}

const div = (a, b) => (b > 0 ? a / b : null);
const pct = (a, b) => (b > 0 ? (a / b) * 100 : null);

/**
 * The standard NFL passer rating formula (the classic 0–158.3 one every box
 * score reports — not ESPN's proprietary Total QBR, which cannot be
 * reproduced from public play-by-play). Gross yards and raw attempts, not
 * net-of-sacks — that is what the real formula uses.
 */
function passerRating(completions, attempts, yards, tds, ints) {
  if (!attempts) return null;
  const clamp = (v) => Math.max(0, Math.min(2.375, v));
  const a = clamp(((completions / attempts) - 0.3) * 5);
  const b = clamp(((yards / attempts) - 3) * 0.25);
  const c = clamp((tds / attempts) * 20);
  const d = clamp(2.375 - (ints / attempts) * 25);
  return ((a + b + c + d) / 6) * 100;
}

/** One team's full season, built from its own rows only — every number here
 *  is this team's own play-by-play, summed by us, nothing pre-aggregated. */
function buildTeamRow(abbr, rows) {
  const games = rows.length;
  const passYdsGross = sum(rows, 'passing_yards');
  const sackYdsLost = sum(rows, 'sack_yards_lost');
  const passYdsNet = passYdsGross - sackYdsLost;
  const completions = sum(rows, 'completions');
  const attempts = sum(rows, 'attempts');
  const passTd = sum(rows, 'passing_tds');
  const ints = sum(rows, 'passing_interceptions');
  const carries = sum(rows, 'carries');
  const rushYds = sum(rows, 'rushing_yards');
  const rushTd = sum(rows, 'rushing_tds');
  const receptions = sum(rows, 'receptions');
  const recYds = sum(rows, 'receiving_yards');
  const recTd = sum(rows, 'receiving_tds');
  const soloTackles = sum(rows, 'def_tackles_solo');
  const assistTackles = sum(rows, 'def_tackle_assists');
  const fumblesLostTotal = sum(rows, 'fumbles_lost_total');
  const picks = sum(rows, 'def_interceptions');
  const fumblesRecoveredOpp = sum(rows, 'fumble_recovery_opp');
  const fgMade = sum(rows, 'fg_made');
  const fgAtt = sum(rows, 'fg_att');
  const patMade = sum(rows, 'pat_made');
  const patAtt = sum(rows, 'pat_att');
  const puntAtt = sum(rows, 'pt_att');
  const puntYards = sum(rows, 'pt_yards');
  const puntNetYards = sum(rows, 'pt_net_yards');
  const kickoffReturns = sum(rows, 'kickoff_returns');
  const puntReturns = sum(rows, 'punt_returns');

  const takeaways = picks + fumblesRecoveredOpp;
  const giveaways = ints + fumblesLostTotal;

  return {
    abbr, games,
    // scoring & drives
    totalTouchdowns: passTd + rushTd + sum(rows, 'special_teams_tds') + sum(rows, 'def_tds'),
    firstDownsPerGame: div(sum(rows, 'passing_first_downs') + sum(rows, 'rushing_first_downs'), games),
    firstDownsPassing: sum(rows, 'passing_first_downs'),
    firstDownsRushing: sum(rows, 'rushing_first_downs'),
    // passing
    passYdsPerGame: div(passYdsNet, games),
    passYdsNet, passYdsGross, completions, attempts,
    completionPct: pct(completions, attempts),
    passYpa: div(passYdsNet, attempts),
    passYpc: div(passYdsGross, completions),
    passTd, passTdPct: pct(passTd, attempts),
    ints, intPct: pct(ints, attempts),
    passerRating: passerRating(completions, attempts, passYdsGross, passTd, ints),
    passFirstDowns: sum(rows, 'passing_first_downs'),
    passBigPlays: sum(rows, 'passing_20'),
    passYac: sum(rows, 'passing_yards_after_catch'),
    sacksTaken: sum(rows, 'sacks_suffered'),
    sackYdsLost,
    // rushing
    rushYdsPerGame: div(rushYds, games),
    rushYds, carries,
    rushYpc: div(rushYds, carries),
    rushTd,
    rushFirstDowns: sum(rows, 'rushing_first_downs'),
    rushBigPlays: sum(rows, 'rushing_10'),
    rushFumbles: sum(rows, 'rushing_fumbles'),
    // receiving
    recYdsPerGame: div(recYds, games),
    receptions, targets: sum(rows, 'targets'),
    recYpc: div(recYds, receptions),
    recTd,
    recFirstDowns: sum(rows, 'receiving_first_downs'),
    recBigPlays: sum(rows, 'receiving_20'),
    recYac: sum(rows, 'receiving_yards_after_catch'),
    // defence
    sacksMade: sum(rows, 'def_sacks'),
    sackYdsMade: sum(rows, 'def_sack_yards'),
    tfl: sum(rows, 'def_tackles_for_loss'),
    picks,
    pickYds: sum(rows, 'def_interception_yards'),
    passDefended: sum(rows, 'def_pass_defended'),
    fumblesForced: sum(rows, 'def_fumbles_forced'),
    fumblesRecovered: fumblesRecoveredOpp,
    defTd: sum(rows, 'def_tds'),
    safeties: sum(rows, 'def_safeties'),
    soloTackles, assistTackles, totalTackles: soloTackles + assistTackles,
    // turnovers & discipline
    turnoverDiff: takeaways - giveaways,
    takeaways, giveaways,
    fumbles: sum(rows, 'fumbles_total'),
    fumblesLost: fumblesLostTotal,
    penalties: sum(rows, 'penalties'),
    penaltyYards: sum(rows, 'penalty_yards'),
    // kicking, punting & returns
    fgPct: pct(fgMade, fgAtt), fgMade, fgLong: max(rows, 'fg_long'),
    xpPct: pct(patMade, patAtt),
    kickPts: fgMade * 3 + patMade,
    puntAvgGross: div(puntYards, puntAtt),
    puntAvgNet: div(puntNetYards, puntAtt),
    puntIn20: sum(rows, 'pt_inside_20'),
    puntLong: max(rows, 'pt_long'),
    krAvg: div(sum(rows, 'kickoff_return_yards'), kickoffReturns),
    prAvg: div(sum(rows, 'punt_return_yards'), puntReturns),
  };
}

/** Every team's season, and — separately — just our three clubs'. Ranking
 *  needs the full 32; the page only ever displays the three. */
export async function loadNflverseTeams(year) {
  const rows = await fetchCsv(TEAM_STATS_URL(year));
  const byTeam = new Map();
  for (const r of rows) {
    if (r.season_type !== 'REG') continue; // the comparison tables are regular season only, same as ESPN's
    const list = byTeam.get(r.team) || [];
    list.push(r);
    byTeam.set(r.team, list);
  }
  const all = [...byTeam.entries()].map(([abbr, teamRows]) => buildTeamRow(abbr, teamRows));
  return all;
}

/**
 * Each team's leading passer this season (most attempts), plus every
 * qualifying QB league-wide so those leaders can be ranked against the
 * whole league, not just the three clubs.
 */
export async function loadNflverseQbs(year) {
  const rows = await fetchCsv(PLAYER_STATS_URL(year));
  const passers = rows.filter((r) => r.position === 'QB' && r.season_type === 'REG');

  const byPlayer = new Map();
  for (const r of passers) {
    const key = r.player_id;
    const list = byPlayer.get(key) || [];
    list.push(r);
    byPlayer.set(key, list);
  }

  const seasons = [...byPlayer.entries()].map(([id, playerRows]) => {
    const last = playerRows[playerRows.length - 1];
    const attempts = sum(playerRows, 'attempts');
    const completions = sum(playerRows, 'completions');
    const passYds = sum(playerRows, 'passing_yards');
    const passTd = sum(playerRows, 'passing_tds');
    const ints = sum(playerRows, 'passing_interceptions');
    const games = playerRows.length;
    return {
      id,
      name: last.player_display_name,
      team: last.team, // most recent team on file — the one it's shown under
      headshot: last.headshot_url || null,
      games, attempts, completions,
      passYds, passYdsPerGame: div(passYds, games),
      completionPct: pct(completions, attempts),
      passTd, passTdPct: pct(passTd, attempts),
      ints, intPct: pct(ints, attempts),
      passYpa: div(passYds, attempts),
      passYpc: div(passYds, completions),
      passerRating: passerRating(completions, attempts, passYds, passTd, ints),
      sacksTaken: sum(playerRows, 'sacks_suffered'),
      rushYds: sum(playerRows, 'rushing_yards'),
      rushTd: sum(playerRows, 'rushing_tds'),
    };
  });

  // "Qualifying" keeps single mop-up-duty attempts from cluttering the
  // league-wide ranking; 15 is generous enough to include a QB after a
  // single real start.
  const qualified = seasons.filter((q) => q.attempts >= 15);

  // The team's own passing leader can be below the qualifying bar early in
  // the season (one great half before an injury, a bye week) — the ranking
  // pool and "who is this club's own QB" are answered separately on purpose.
  const leaderByTeam = new Map();
  for (const q of seasons) {
    const current = leaderByTeam.get(q.team);
    if (!current || q.attempts > current.attempts) leaderByTeam.set(q.team, q);
  }

  return { qualified, leaderByTeam };
}
