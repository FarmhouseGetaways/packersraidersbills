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
//
// `count` matters more than it looks. In week 2 one club has played once and
// another twice, so 174 tackles against 68 is mostly a fact about how many
// games each has played. Those rows are labelled on the page, and the column
// headings carry each team's games played, so the denominator is never hidden.

/**
 * Two traps in ESPN's naming, both already paid for once:
 *
 *  - `passing.sacks` is sacks the OFFENCE TOOK. `defensive.sacks` is sacks the
 *    DEFENCE MADE. Same word, opposite meaning, opposite direction.
 *  - `passingYards` is gross; `netPassingYards` is after sack yardage. Mixing
 *    them makes a team's passing game look better than it was.
 */
export const OFFENCE = [
  { key: 'ppg',        label: 'Points per game',      cat: 'scoring', stat: 'totalPointsPerGame',     better: 'high', dp: 1 },
  { key: 'totalYpg',   label: 'Total yards per game', cat: 'rushing', stat: 'netYardsPerGame',        better: 'high', dp: 1 },
  { key: 'passYpg',    label: 'Passing yards per game', cat: 'passing', stat: 'netPassingYardsPerGame', better: 'high', dp: 1 },
  { key: 'rushYpg',    label: 'Rushing yards per game', cat: 'rushing', stat: 'rushingYardsPerGame',  better: 'high', dp: 1 },
  { key: 'compPct',    label: 'Completion %',         cat: 'passing', stat: 'completionPct',          better: 'high', dp: 1, suffix: '%' },
  { key: 'ypa',        label: 'Yards per pass attempt', cat: 'passing', stat: 'netYardsPerPassAttempt', better: 'high', dp: 1 },
  { key: 'ypc',        label: 'Yards per carry',      cat: 'rushing', stat: 'yardsPerRushAttempt',     better: 'high', dp: 1 },
  { key: 'passTd',     label: 'Passing touchdowns',   cat: 'passing', stat: 'passingTouchdowns',       better: 'high', dp: 0, count: true },
  { key: 'rushTd',     label: 'Rushing touchdowns',   cat: 'rushing', stat: 'rushingTouchdowns',       better: 'high', dp: 0, count: true },
  { key: 'qbr',        label: 'Team passer rating',   cat: 'passing', stat: 'QBRating',                better: 'high', dp: 1 },
  { key: 'longPass',   label: 'Longest pass',         cat: 'passing', stat: 'longPassing',             better: 'high', dp: 0 },
  { key: 'ints',       label: 'Interceptions thrown', cat: 'passing', stat: 'interceptions',           better: 'low',  dp: 0, count: true },
  { key: 'sacksTaken', label: 'Sacks allowed',        cat: 'passing', stat: 'sacks',                   better: 'low',  dp: 0, count: true },
  { key: 'fumblesLost', label: 'Fumbles lost',        cat: 'general', stat: 'fumblesLost',             better: 'low',  dp: 0, count: true },
  { key: 'penaltyYds', label: 'Penalty yards',        cat: 'general', stat: 'totalPenaltyYards',       better: 'low',  dp: 0, count: true },
];

export const DEFENCE = [
  // Points conceded comes off the RECORD, not the defensive category: ESPN
  // serves defensive.pointsAllowed and defensive.yardsAllowed as 0 all season,
  // and a real 0 is indistinguishable from missing data on the page.
  { key: 'papg',       label: 'Points allowed per game', from: 'record', field: 'pointsAgainstPerGame', better: 'low', dp: 1 },
  { key: 'sacksMade',  label: 'Sacks',                cat: 'defensive', stat: 'sacks',                  better: 'high', dp: 0, count: true },
  { key: 'tfl',        label: 'Tackles for loss',     cat: 'defensive', stat: 'tacklesForLoss',         better: 'high', dp: 0, count: true },
  { key: 'picks',      label: 'Interceptions',        cat: 'defensiveInterceptions', stat: 'interceptions', better: 'high', dp: 0, count: true },
  { key: 'pd',         label: 'Passes defended',      cat: 'defensive', stat: 'passesDefended',         better: 'high', dp: 0, count: true },
  { key: 'ff',         label: 'Fumbles forced',       cat: 'general',   stat: 'fumblesForced',          better: 'high', dp: 0, count: true },
  { key: 'defTd',      label: 'Defensive touchdowns', cat: 'defensive', stat: 'defensiveTouchdowns',    better: 'high', dp: 0, count: true },
  { key: 'tackles',    label: 'Total tackles',        cat: 'defensive', stat: 'totalTackles',           better: 'high', dp: 0, count: true },
];

export const QB = [
  { key: 'qbYards',   label: 'Passing yards',    cat: 'passing', stat: 'passingYards',      better: 'high', dp: 0, count: true },
  { key: 'qbYpg',     label: 'Yards per game',   cat: 'passing', stat: 'yardsPerGame',      better: 'high', dp: 1 },
  { key: 'qbCompPct', label: 'Completion %',     cat: 'passing', stat: 'completionPct',     better: 'high', dp: 1, suffix: '%' },
  { key: 'qbTd',      label: 'Touchdowns',       cat: 'passing', stat: 'passingTouchdowns', better: 'high', dp: 0, count: true },
  { key: 'qbInt',     label: 'Interceptions',    cat: 'passing', stat: 'interceptions',     better: 'low',  dp: 0, count: true },
  { key: 'qbRating',  label: 'Passer rating',    cat: 'passing', stat: 'QBRating',          better: 'high', dp: 1 },
  { key: 'qbYpa',     label: 'Yards per attempt', cat: 'passing', stat: 'yardsPerPassAttempt', better: 'high', dp: 1 },
  { key: 'qbLong',    label: 'Longest pass',     cat: 'passing', stat: 'longPassing',       better: 'high', dp: 0 },
  { key: 'qbSacks',   label: 'Sacks taken',      cat: 'passing', stat: 'sacks',             better: 'low',  dp: 0, count: true },
  { key: 'qbRush',    label: 'Rushing yards',    cat: 'rushing', stat: 'rushingYards',      better: 'high', dp: 0, count: true },
];

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
