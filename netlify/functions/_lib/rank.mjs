// Shared ranking helper.
//
// Both the standings-derived ranks (points, differential) and the
// nflverse-derived ranks (everything in nflverse.mjs) need the exact same
// thing: given a value per team, work out where each one stands among ALL of
// them — competition ranking (1, 1, 3), not dense ranking (1, 1, 2), so two
// tied leaders don't make the next team look like it only trails by one spot.
//
// This exists so that logic is written once. It replaces trusting any
// single-source "rank" field ESPN hands back per stat — see the comments in
// nflverse.mjs for why that field turned out not to be safe to use.

/**
 * @param {Array} rows - one entry per team (or player)
 * @param {(row) => number} valueOf
 * @param {boolean} lowerIsBetter
 * @returns {Map} id -> rank, keyed by whatever `keyOf` returns
 */
export function competitionRank(rows, valueOf, lowerIsBetter, keyOf = (r) => r.abbr) {
  const dir = lowerIsBetter ? 1 : -1;
  const sorted = rows
    .filter((r) => Number.isFinite(valueOf(r)))
    .sort((a, b) => dir * (valueOf(a) - valueOf(b)));
  const out = new Map();
  let rank = 0;
  sorted.forEach((r, i) => {
    if (i === 0 || valueOf(r) !== valueOf(sorted[i - 1])) rank = i + 1;
    out.set(keyOf(r), rank);
  });
  return out;
}
