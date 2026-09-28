// What the page compares, in one place.
//
// The API and the front end MUST agree on which direction is better, or the
// winner highlight lands on the wrong team — which is worse than no highlight
// at all, because it looks authoritative. So the direction lives here, is
// served inside the API response, and the page never decides for itself.
//
//   better: 'high'  more is better (yards, points scored, takeaways)
//   better: 'low'   less is better (interceptions thrown, sacks allowed,
//                   points conceded, penalty yards)
//   count: true     a SEASON TOTAL, not a rate
//   format: 'clock' seconds, to be shown as mm:ss
//
// `count` matters more than it looks. Early in a season one club has played
// once and another twice, so 174 tackles against 68 is mostly a fact about how
// many games each has played. Those rows are labelled on the page, and the
// column headings carry each team's games played, so the denominator is never
// hidden.
//
// `nf` names a field on the nflverse-built season object (see nflverse.mjs)
// that this metric reads instead of ESPN's own `cat`/`stat` pair — and gets
// its rank from a rank WE compute across all 32 teams, never from ESPN's own
// per-stat rank field. That field turned out not to be trustworthy: two teams
// tied on the same touchdown total came back with different ESPN ranks, and
// a player's own ESPN "yards per game" field did not equal his own correct
// season yards divided by his own correct games played. See stats.mjs for
// where `nf` is read and where a metric WITHOUT one — because nflverse's
// summary file does not carry it (longest play, red zone / third-down /
// fourth-down %, time of possession, hurries, passes batted down, return
// touchdowns split by type) — has its ESPN value kept but its rank dropped
// rather than shown from a field already shown to be unreliable.
//
// Two traps in ESPN's naming, both already paid for once, that still apply
// to the handful of rows that remain ESPN-sourced:
//
//  - `passing.sacks` is sacks the OFFENCE TOOK. `defensive.sacks` is sacks the
//    DEFENCE MADE. Same word, opposite meaning, opposite direction.
//  - `passingYards` is gross; `netPassingYards` is after sack yardage. Mixing
//    them makes a team's passing game look better than it was.

const m = (key, label, cat, stat, better, opts = {}) => ({ key, label, cat, stat, better, ...opts });

export const CATEGORIES = [
  {
    key: 'scoring',
    title: 'Scoring & drives',
    note: 'Points, and how efficiently each club turns possession into them.',
    // Every category starts shut, on purpose. No category is the one everybody
    // wants, and a page that opens as a wall of 103 rows is harder to scan
    // than a list of seven headings. What the reader opens is remembered.
    metrics: [
      // Points scored/conceded come off the RECORD, not a stats-endpoint
      // category: the record is the one number ESPN keeps in sync with the
      // scoreboard in real time. `nflRankKey` says which of our own
      // league-wide ranks (computed in stats.mjs from the standings feed,
      // covering all 32 teams) applies to this row.
      { key: 'ppg', label: 'Points per game', from: 'record', field: 'pointsForPerGame', better: 'high', dp: 1, nflRankKey: 'pf' },
      { key: 'papg', label: 'Points allowed per game', from: 'record', field: 'pointsAgainstPerGame', better: 'low', dp: 1, nflRankKey: 'pa' },
      { key: 'diff', label: 'Point differential', from: 'record', field: 'differential', better: 'high', dp: 0, count: true, nflRankKey: 'diff' },
      m('totalTd', 'Touchdowns', 'scoring', 'totalTouchdowns', 'high', { count: true, nf: 'totalTouchdowns' }),
      m('thirdPct', 'Third down %', 'miscellaneous', 'thirdDownConvPct', 'high', { suffix: '%' }),
      m('fourthPct', 'Fourth down %', 'miscellaneous', 'fourthDownConvPct', 'high', { suffix: '%' }),
      m('rzScore', 'Red zone scoring %', 'miscellaneous', 'redzoneScoringPct', 'high', { suffix: '%' }),
      m('rzTd', 'Red zone touchdown %', 'miscellaneous', 'redzoneTouchdownPct', 'high', { suffix: '%' }),
      m('fdPerGame', 'First downs per game', 'miscellaneous', 'firstDownsPerGame', 'high', { nf: 'firstDownsPerGame' }),
      m('fdPass', 'First downs passing', 'miscellaneous', 'firstDownsPassing', 'high', { count: true, nf: 'firstDownsPassing' }),
      m('fdRush', 'First downs rushing', 'miscellaneous', 'firstDownsRushing', 'high', { count: true, nf: 'firstDownsRushing' }),
      m('top', 'Time of possession', 'miscellaneous', 'possessionTimeSeconds', 'high', { count: true, format: 'clock' }),
    ],
  },
  {
    key: 'passing',
    title: 'Passing',
    note: 'Net figures are after sack yardage; gross is before it.',
    metrics: [
      m('passYpg', 'Passing yards per game (net)', 'passing', 'netPassingYardsPerGame', 'high', { nf: 'passYdsPerGame' }),
      m('passYds', 'Passing yards (net)', 'passing', 'netPassingYards', 'high', { count: true, nf: 'passYdsNet' }),
      m('passGross', 'Passing yards (gross)', 'passing', 'passingYards', 'high', { count: true, nf: 'passYdsGross' }),
      m('comp', 'Completions', 'passing', 'completions', 'high', { count: true, nf: 'completions' }),
      m('att', 'Attempts', 'passing', 'passingAttempts', 'high', { count: true, nf: 'attempts' }),
      m('compPct', 'Completion %', 'passing', 'completionPct', 'high', { suffix: '%', nf: 'completionPct' }),
      m('ypa', 'Yards per attempt (net)', 'passing', 'netYardsPerPassAttempt', 'high', { nf: 'passYpa' }),
      m('ypc', 'Yards per completion', 'passing', 'yardsPerCompletion', 'high', { nf: 'passYpc' }),
      m('passTd', 'Passing touchdowns', 'passing', 'passingTouchdowns', 'high', { count: true, nf: 'passTd' }),
      m('passTdPct', 'Touchdown %', 'passing', 'passingTouchdownPct', 'high', { suffix: '%', nf: 'passTdPct' }),
      m('ints', 'Interceptions thrown', 'passing', 'interceptions', 'low', { count: true, nf: 'ints' }),
      m('intPct', 'Interception %', 'passing', 'interceptionPct', 'low', { suffix: '%', nf: 'intPct' }),
      m('rating', 'Team passer rating', 'passing', 'QBRating', 'high', { nf: 'passerRating' }),
      m('longPass', 'Longest pass', 'passing', 'longPassing', 'high'),
      m('passFd', 'Passing first downs', 'passing', 'passingFirstDowns', 'high', { count: true, nf: 'passFirstDowns' }),
      m('passBig', 'Passing plays of 20+', 'passing', 'passingBigPlays', 'high', { count: true, nf: 'passBigPlays' }),
      m('yac', 'Yards after catch', 'passing', 'passingYardsAfterCatch', 'high', { count: true, nf: 'passYac' }),
      m('sacksTaken', 'Sacks allowed', 'passing', 'sacks', 'low', { count: true, nf: 'sacksTaken' }),
      m('sackYds', 'Yards lost to sacks', 'passing', 'sackYardsLost', 'low', { count: true, nf: 'sackYdsLost' }),
    ],
  },
  {
    key: 'rushing',
    title: 'Rushing',
    metrics: [
      m('rushYpg', 'Rushing yards per game', 'rushing', 'rushingYardsPerGame', 'high', { nf: 'rushYdsPerGame' }),
      m('rushYds', 'Rushing yards', 'rushing', 'rushingYards', 'high', { count: true, nf: 'rushYds' }),
      m('carries', 'Carries', 'rushing', 'rushingAttempts', 'high', { count: true, nf: 'carries' }),
      m('ypr', 'Yards per carry', 'rushing', 'yardsPerRushAttempt', 'high', { nf: 'rushYpc' }),
      m('rushTd', 'Rushing touchdowns', 'rushing', 'rushingTouchdowns', 'high', { count: true, nf: 'rushTd' }),
      m('longRush', 'Longest rush', 'rushing', 'longRushing', 'high'),
      m('rushFd', 'Rushing first downs', 'rushing', 'rushingFirstDowns', 'high', { count: true, nf: 'rushFirstDowns' }),
      m('rushBig', 'Rushing plays of 10+', 'rushing', 'rushingBigPlays', 'high', { count: true, nf: 'rushBigPlays' }),
      m('stuffed', 'Runs stopped for a loss', 'rushing', 'stuffs', 'low', { count: true }),
      m('rushFum', 'Rushing fumbles', 'rushing', 'rushingFumbles', 'low', { count: true, nf: 'rushFumbles' }),
    ],
  },
  {
    key: 'receiving',
    title: 'Receiving',
    metrics: [
      m('recYpg', 'Receiving yards per game', 'receiving', 'receivingYardsPerGame', 'high', { nf: 'recYdsPerGame' }),
      m('rec', 'Receptions', 'receiving', 'receptions', 'high', { count: true, nf: 'receptions' }),
      m('targets', 'Targets', 'receiving', 'receivingTargets', 'high', { count: true, nf: 'targets' }),
      m('ypRec', 'Yards per reception', 'receiving', 'yardsPerReception', 'high', { nf: 'recYpc' }),
      m('recTd', 'Receiving touchdowns', 'receiving', 'receivingTouchdowns', 'high', { count: true, nf: 'recTd' }),
      m('longRec', 'Longest reception', 'receiving', 'longReception', 'high'),
      m('recFd', 'Receiving first downs', 'receiving', 'receivingFirstDowns', 'high', { count: true, nf: 'recFirstDowns' }),
      m('recBig', 'Receptions of 20+', 'receiving', 'receivingBigPlays', 'high', { count: true, nf: 'recBigPlays' }),
      m('recYac', 'Yards after catch', 'receiving', 'receivingYardsAfterCatch', 'high', { count: true, nf: 'recYac' }),
    ],
  },
  {
    key: 'defence',
    title: 'Defence',
    note: 'Points allowed comes from the season record — ESPN does not publish a per-team yards-allowed figure.',
    metrics: [
      { key: 'papg2', label: 'Points allowed per game', from: 'record', field: 'pointsAgainstPerGame', better: 'low', nflRankKey: 'pa' },
      m('sacksMade', 'Sacks', 'defensive', 'sacks', 'high', { count: true, nf: 'sacksMade' }),
      m('sackYdsMade', 'Sack yards', 'defensive', 'sackYards', 'high', { count: true, nf: 'sackYdsMade' }),
      m('hurries', 'Quarterback hurries', 'defensive', 'hurries', 'high', { count: true }),
      m('tfl', 'Tackles for loss', 'defensive', 'tacklesForLoss', 'high', { count: true, nf: 'tfl' }),
      m('picks', 'Interceptions', 'defensiveInterceptions', 'interceptions', 'high', { count: true, nf: 'picks' }),
      m('pickYds', 'Interception return yards', 'defensiveInterceptions', 'interceptionYards', 'high', { count: true, nf: 'pickYds' }),
      m('pickTd', 'Interception touchdowns', 'defensiveInterceptions', 'interceptionTouchdowns', 'high', { count: true }),
      m('pd', 'Passes defended', 'defensive', 'passesDefended', 'high', { count: true, nf: 'passDefended' }),
      m('batted', 'Passes batted down', 'defensive', 'passesBattedDown', 'high', { count: true }),
      m('ff', 'Fumbles forced', 'general', 'fumblesForced', 'high', { count: true, nf: 'fumblesForced' }),
      m('fumRec', 'Fumbles recovered', 'general', 'fumblesRecovered', 'high', { count: true, nf: 'fumblesRecovered' }),
      m('defTd', 'Defensive touchdowns', 'defensive', 'defensiveTouchdowns', 'high', { count: true, nf: 'defTd' }),
      m('safeties', 'Safeties', 'defensive', 'safeties', 'high', { count: true, nf: 'safeties' }),
      m('solo', 'Solo tackles', 'defensive', 'soloTackles', 'high', { count: true, nf: 'soloTackles' }),
      m('assist', 'Assisted tackles', 'defensive', 'assistTackles', 'high', { count: true, nf: 'assistTackles' }),
      m('tackles', 'Total tackles', 'defensive', 'totalTackles', 'high', { count: true, nf: 'totalTackles' }),
    ],
  },
  {
    key: 'turnovers',
    title: 'Turnovers & discipline',
    note: 'The one table where every row that is "high" is something the other side did.',
    metrics: [
      m('toDiff', 'Turnover differential', 'miscellaneous', 'turnOverDifferential', 'high', { count: true, nf: 'turnoverDiff' }),
      m('takeaways', 'Takeaways', 'miscellaneous', 'totalTakeaways', 'high', { count: true, nf: 'takeaways' }),
      m('giveaways', 'Giveaways', 'miscellaneous', 'totalGiveaways', 'low', { count: true, nf: 'giveaways' }),
      m('fumbles', 'Fumbles', 'general', 'fumbles', 'low', { count: true, nf: 'fumbles' }),
      m('fumblesLost', 'Fumbles lost', 'general', 'fumblesLost', 'low', { count: true, nf: 'fumblesLost' }),
      m('penalties', 'Penalties', 'general', 'totalPenalties', 'low', { count: true, nf: 'penalties' }),
      m('penaltyYds', 'Penalty yards', 'general', 'totalPenaltyYards', 'low', { count: true, nf: 'penaltyYards' }),
      m('fdPenalty', 'First downs given by penalty', 'miscellaneous', 'firstDownsPenalty', 'low', { count: true }),
    ],
  },
  {
    key: 'special',
    title: 'Kicking, punting & returns',
    metrics: [
      m('fgPct', 'Field goal %', 'kicking', 'fieldGoalPct', 'high', { suffix: '%', nf: 'fgPct' }),
      m('fgMade', 'Field goals made', 'kicking', 'fieldGoalsMade', 'high', { count: true, nf: 'fgMade' }),
      m('fgLong', 'Longest field goal', 'kicking', 'longFieldGoalMade', 'high', { nf: 'fgLong' }),
      m('xpPct', 'Extra point %', 'kicking', 'extraPointPct', 'high', { suffix: '%', nf: 'xpPct' }),
      m('kickPts', 'Points from kicking', 'kicking', 'totalKickingPoints', 'high', { count: true, nf: 'kickPts' }),
      m('tbPct', 'Touchback %', 'kicking', 'touchbackPct', 'high', { suffix: '%' }),
      m('puntAvg', 'Punting average (gross)', 'punting', 'grossAvgPuntYards', 'high', { nf: 'puntAvgGross' }),
      m('puntNet', 'Punting average (net)', 'punting', 'netAvgPuntYards', 'high', { nf: 'puntAvgNet' }),
      m('puntIn20', 'Punts inside the 20', 'punting', 'puntsInside20', 'high', { count: true, nf: 'puntIn20' }),
      m('puntLong', 'Longest punt', 'punting', 'longPunt', 'high', { nf: 'puntLong' }),
      m('krAvg', 'Yards per kick return', 'returning', 'yardsPerKickReturn', 'high', { nf: 'krAvg' }),
      m('prAvg', 'Yards per punt return', 'returning', 'yardsPerPuntReturn', 'high', { nf: 'prAvg' }),
      m('krTd', 'Kick return touchdowns', 'returning', 'kickReturnTouchdowns', 'high', { count: true }),
      m('prTd', 'Punt return touchdowns', 'returning', 'puntReturnTouchdowns', 'high', { count: true }),
    ],
  },
];

/** The quarterback table is built separately — it reads a player, not a team. */
export const QB = [
  m('qbYards', 'Passing yards', 'passing', 'passingYards', 'high', { count: true, nf: 'passYds' }),
  m('qbYpg', 'Yards per game', 'passing', 'yardsPerGame', 'high', { nf: 'passYdsPerGame' }),
  m('qbComp', 'Completions', 'passing', 'completions', 'high', { count: true, nf: 'completions' }),
  m('qbAtt', 'Attempts', 'passing', 'passingAttempts', 'high', { count: true, nf: 'attempts' }),
  m('qbCompPct', 'Completion %', 'passing', 'completionPct', 'high', { suffix: '%', nf: 'completionPct' }),
  m('qbTd', 'Touchdowns', 'passing', 'passingTouchdowns', 'high', { count: true, nf: 'passTd' }),
  m('qbInt', 'Interceptions', 'passing', 'interceptions', 'low', { count: true, nf: 'ints' }),
  m('qbRating', 'Passer rating', 'passing', 'QBRating', 'high', { nf: 'passerRating' }),
  m('qbYpa', 'Yards per attempt', 'passing', 'yardsPerPassAttempt', 'high', { nf: 'passYpa' }),
  m('qbYpc', 'Yards per completion', 'passing', 'yardsPerCompletion', 'high', { nf: 'passYpc' }),
  m('qbLong', 'Longest pass', 'passing', 'longPassing', 'high'),
  m('qbSacks', 'Sacks taken', 'passing', 'sacks', 'low', { count: true, nf: 'sacksTaken' }),
  m('qbRush', 'Rushing yards', 'rushing', 'rushingYards', 'high', { count: true, nf: 'rushYds' }),
  m('qbRushTd', 'Rushing touchdowns', 'rushing', 'rushingTouchdowns', 'high', { count: true, nf: 'rushTd' }),
];

/** Every team metric, flat — used by the tests and by nothing else. */
export const ALL_TEAM_METRICS = CATEGORIES.flatMap((c) => c.metrics);

/**
 * Which of the supplied values wins a row.
 *
 * Returns every key that ties for the lead, because a two-way tie highlighted
 * as a single winner is a wrong answer. Values that are null (a stat ESPN did
 * not serve) never win and never block a winner.
 */
export function leaders(values, better) {
  const real = Object.entries(values).filter(([, v]) => typeof v === 'number' && Number.isFinite(v));
  // A leader needs something to lead. One value against two blanks is not a
  // comparison, so nothing is highlighted.
  if (real.length < 2) return [];
  const best = better === 'low'
    ? Math.min(...real.map(([, v]) => v))
    : Math.max(...real.map(([, v]) => v));
  const won = real.filter(([, v]) => v === best).map(([k]) => k);
  // If everybody is level there is no leader. Highlighting all three on a
  // 0-0-0 row says "all three lead", which is not a fact about anything.
  return won.length === real.length ? [] : won;
}

/** Seconds to mm:ss. ESPN serves time of possession as a raw second count. */
export function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const mins = Math.floor(seconds / 60);
  return `${mins}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}
