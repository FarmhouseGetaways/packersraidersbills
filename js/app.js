/* SportsTicker — reads /api/stats and /api/history and draws the page.
   No framework, no build step, no dependencies. */

const REFRESH_MS = 60_000;

const $ = (id) => document.getElementById(id);

const state = { stats: null, history: null };

/**
 * 'stats' (the regular scrolling notes) or 'scores' (this week's games,
 * date/time/score, for the whole slate — not just our three clubs). Starts
 * null; the first stats load picks a default — 'scores' if today is a game
 * day for any of the three clubs, 'stats' otherwise — and a click on the
 * toggle overrides that for the rest of the session. Refreshing every 60s
 * must never reset a reader's manual choice back to the day's default,
 * which is why this only gets a value ONCE (`tickerMode === null` below),
 * never re-derived on every redraw.
 */
let tickerMode = null;

/**
 * Which statistic categories are open.
 *
 * This has to be remembered outside the DOM. The page redraws itself every 60
 * seconds, and a rebuilt <details> defaults to closed — so without this, any
 * category the reader opened would snap shut under them roughly once a minute.
 * Kept in localStorage too, so it survives a reload; wrapped because a private
 * window can throw on access rather than simply returning nothing.
 */
// Stored as a map of key -> open, NOT a list of open keys. The difference
// matters: a list cannot tell "the reader closed this" apart from "this
// category did not exist yet", so a category added later would never get its
// own default. Absent from the map means never seen, and only then does the
// category's own `open` apply.
const OPEN_KEY = 'prb-open-categories';
let openCats = null;

function loadOpen() {
  if (openCats) return openCats;
  openCats = new Map();
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) openCats.set(k, !!v);
  } catch { /* private window, blocked storage — the defaults still apply */ }
  return openCats;
}

/** Whether this category should be drawn open, applying its default once. */
function startsOpen(cat) {
  const map = loadOpen();
  if (!map.has(cat.key)) map.set(cat.key, !!cat.open);
  return map.get(cat.key);
}

function rememberOpen() {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(Object.fromEntries(openCats)));
  } catch { /* nothing to do, and nothing worth telling the reader */ }
}

boot();

async function boot() {
  await loadStats();
  // The history endpoint reads twenty seasons of schedules, so it is fetched
  // second and drawn when it lands. The live numbers never wait for it.
  loadHistory();
  setInterval(loadStats, REFRESH_MS);
  // Refresh on return to the tab: a scoreboard left open for an hour is the
  // normal case, and stale scores are the whole failure mode of this page.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadStats();
  });
  wakeTicker();
  $('ticker-toggle').addEventListener('click', (e) => {
    const mode = e.target.closest('button')?.dataset.mode;
    if (!mode || mode === tickerMode) return;
    tickerMode = mode;
    drawTicker();
  });
  // Delegated once, here, rather than per-card in drawHistory() — that
  // runs once per page load today, but a listener attached there would
  // silently stack a duplicate on every call if that ever changed.
  $('h2h').addEventListener('click', (e) => {
    const btn = e.target.closest('.meetings-more');
    if (!btn) return;
    const list = btn.previousElementSibling;
    const expanded = list.classList.toggle('expanded');
    const hiddenCount = list.querySelectorAll('.meeting-extra').length;
    btn.textContent = expanded ? 'Show fewer' : `Show ${hiddenCount} more`;
  });
}

const TICKER_PX_PER_SEC = 55;
const TICKER_MIN_DURATION_S = 14;
const TICKER_MAX_DURATION_S = 90;

/**
 * Restarts .ticker-track's scroll animation, timed to the CURRENT
 * content's width rather than a fixed duration. A fixed 58s meant a short
 * list (three games, in scores mode) crawled at the pace tuned for the
 * much longer stats list — which read as both "too slow" and "a long
 * pause at the loop seam": the seam itself is only ever a few fixed
 * pixels, but at that reduced effective speed it took many extra seconds
 * to cross, reading as a stall between the last item and the repeat.
 *
 * Removing and re-adding the animation (rather than only changing
 * animation-duration in place) is also what fixes a second, separate
 * ticker bug: WebKit can keep a compositor layer "animating" without
 * actually repainting it after the content underneath changes — which
 * read as the ticker going blank after a couple of toggle clicks, or
 * stuck paused after an iOS pull-to-refresh restores the page from the
 * back-forward cache. A genuine restart forces a fresh layer built from
 * whatever is in the DOM right now, not a stale one.
 */
function retimeAndRestartTicker() {
  const track = $('ticker-track');
  const list = $('ticker-list');
  if (!track || !list) return;
  const duration = Math.min(
    TICKER_MAX_DURATION_S,
    Math.max(TICKER_MIN_DURATION_S, list.scrollWidth / TICKER_PX_PER_SEC),
  );
  track.style.animation = 'none';
  void track.offsetHeight; // force reflow between removing and restoring
  track.style.animation = `scroll ${duration}s linear infinite`;
}

function wakeTicker() {
  window.addEventListener('pageshow', retimeAndRestartTicker);
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`stats ${res.status}`);
    state.stats = await res.json();
    drawStats();
  } catch (err) {
    if (!state.stats) fail(err);
  }
}

async function loadHistory() {
  try {
    const res = await fetch('/api/history', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`history ${res.status}`);
    state.history = await res.json();
    drawHistory();
  } catch {
    // The page is still fully useful without the historical sections, so a
    // failure here hides them rather than shouting about it.
  }
}

function fail(err) {
  const el = $('status');
  el.className = 'status error';
  el.textContent = `Could not load the statistics (${err.message}). They come from ESPN's public API — if that is down, this page has nothing to show. It will try again in a minute.`;
}

/* ------------------------------------------------------------------ colour */

/**
 * The colour a club is drawn in on a near-black page.
 *
 * Two problems, and they need different answers. Green Bay's green and
 * Buffalo's navy are dark but they ARE the club's colour, so they are
 * lightened until they read against the background and keep their hue. The
 * Raiders' primary is literally #000000 — there is no hue to lighten, only
 * grey — so that one falls back to the club's own silver.
 *
 * Dropping every dark primary to its secondary (the first version of this)
 * turned the Packers gold and the Bills red, which is legible and wrong.
 *
 * Lightening alone isn't enough, either. Green Bay's green is dark AND only
 * moderately saturated (ESPN's own swatch is ~42% saturation, against the
 * Bills' fully-saturated navy), so raising just its lightness to clear
 * MIN_LUM produced a flat, grey-green next to the Bills' vivid blue. The
 * saturation is floored too, so a muted dark colour comes out reading as
 * its hue, not as a wash of it.
 */
const MIN_LUM = 0.13;
const MIN_SAT = 0.6;

function accent(team) {
  const primary = team.color || '#4a5a70';
  const { h, s, l } = hsl(primary);
  if (s < 0.12) return team.alt || '#a5acaf';   // black, white or grey: no hue to keep
  if (luminance(primary) >= MIN_LUM) return primary;

  const sat = Math.max(s, MIN_SAT);
  let lift = l;
  while (lift < 0.62 && luminance(hslHex(h, sat, lift)) < MIN_LUM) lift += 0.02;
  return hslHex(h, sat, lift);
}

function hsl(hex) {
  const { r, g, b } = rgb(hex);
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return { h, s, l };
}

function hslHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function luminance(hex) {
  const { r, g, b } = rgb(hex);
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function rgb(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}

/** Black or white text on a given background, whichever is readable. */
function inkOn(hex) {
  return luminance(hex) > 0.35 ? '#0a0c10' : '#ffffff';
}

function themed(el, team) {
  const a = accent(team);
  el.style.setProperty('--team', a);
  el.style.setProperty('--team-ink', inkOn(a));
  // A pale accent floods much more strongly than a dark one at the same
  // percentage: the Raiders' silver washed out their whole column while the
  // Packers' green barely showed. Scale the tint to the colour's brightness.
  el.style.setProperty('--team-flood', luminance(a) > 0.3 ? '7%' : '14%');
  return el;
}

/* ------------------------------------------------------------------ format */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function ordinal(n) {
  if (!Number.isFinite(n)) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ------------------------------------------------------------- draw: stats */

function drawStats() {
  const d = state.stats;
  $('status').hidden = true;

  const week = d.season.week ? `Week ${d.season.week}` : d.season.type;
  $('season-text').textContent = `${d.season.year} ${d.season.type} · ${week} · updated ${new Date(d.generated).toLocaleTimeString()}`;
  $('season-line').querySelector('.dot').classList.toggle('stale', !!d.stale);

  drawTeams(d.teams);
  drawCategories(d.comparison.categories, d.teams);
  drawQbs(d.teams);
  drawCategory($('qb-cat'), {
    key: 'qb', title: 'Quarterback comparison', note: null, open: false,
    rows: d.comparison.qb,
  }, d.teams);
  if (tickerMode === null) tickerMode = isGameDay(d.live) ? 'scores' : 'stats';
  drawLiveScores(d);
  drawTicker();

  for (const id of ['teams-section', 'cats-section', 'qb-section']) $(id).hidden = false;

  $('foot-meta').textContent = `Season ${d.season.year}. Read ${new Date(d.generated).toLocaleString()}${d.stale ? ' — serving the last good copy; the live read failed.' : ''}`;
}

function drawCategories(categories, teams) {
  const wrap = $('categories');
  wrap.textContent = '';
  for (const cat of categories) wrap.appendChild(buildCategory(cat, teams));
}

function drawCategory(wrap, cat, teams) {
  wrap.textContent = '';
  wrap.appendChild(buildCategory(cat, teams));
}

/**
 * One collapsible category. A real <details>, so it opens with a click or the
 * keyboard and still works with JavaScript disabled after the first paint —
 * no hand-rolled toggle to get wrong.
 */
function buildCategory(cat, teams) {
  const det = document.createElement('details');
  det.className = 'cat';
  det.open = startsOpen(cat);
  det.addEventListener('toggle', () => {
    openCats.set(cat.key, det.open);
    rememberOpen();
  });

  const sum = document.createElement('summary');
  sum.innerHTML = `
    <svg class="cat-arrow" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span class="cat-title">${esc(cat.title)}</span>
    <span class="cat-count">${cat.rows.length} stat${cat.rows.length === 1 ? '' : 's'}</span>`;
  det.appendChild(sum);

  const body = document.createElement('div');
  body.className = 'cat-body';
  if (cat.note) {
    const note = document.createElement('p');
    note.className = 'cat-note';
    note.textContent = cat.note;
    body.appendChild(note);
  }
  const rows = document.createElement('div');
  rows.className = 'rows';
  drawRows(rows, cat.rows, teams);
  body.appendChild(rows);
  det.appendChild(body);
  return det;
}

/** Win percentage, ties counting as half a win — the standard sort key for
 *  "current record" that's fair when the three clubs have played a
 *  different number of games. No games played sorts last, not first. */
function winPct(r) {
  const w = r?.wins ?? 0, l = r?.losses ?? 0, ties = r?.ties ?? 0;
  const gp = w + l + ties;
  return gp ? (w + ties * 0.5) / gp : -1;
}

/** Best-of-these-three-clubs standing: win percentage first, point
 *  differential to break a tie (two clubs can easily share a percentage
 *  this early in a season; their differential is what the record doesn't
 *  show but the eye would reach for next). */
function standingsCompare(a, b) {
  const pct = winPct(b.record) - winPct(a.record);
  if (pct) return pct;
  return (b.record?.differential ?? -Infinity) - (a.record?.differential ?? -Infinity);
}

function standingsRank(teams) {
  const sorted = [...teams].sort(standingsCompare);
  const ranks = {};
  sorted.forEach((t, i) => {
    ranks[t.key] = i > 0 && standingsCompare(t, sorted[i - 1]) === 0 ? ranks[sorted[i - 1].key] : i + 1;
  });
  return ranks;
}

function drawTeams(teams) {
  const wrap = $('teams');
  wrap.textContent = '';

  // Rank among just these three clubs on the headline numbers — computed
  // once, up front, the same way drawRows ranks a stat row.
  const pfRank = rankAmong(teams, (t) => t.record?.pointsForPerGame, false);
  const paRank = rankAmong(teams, (t) => t.record?.pointsAgainstPerGame, true);
  const diffRank = rankAmong(teams, (t) => t.record?.differential, false);
  // The panels stay in the page's fixed club order — same as the ticker,
  // the comparison tables, history — rather than reshuffling by standing
  // every week; the rank badge says who's ahead without moving anyone.
  const stRank = standingsRank(teams);

  for (const t of teams) {
    const r = t.record || {};
    const card = document.createElement('article');
    card.className = 'team-card';
    card.innerHTML = `
      ${t.logo ? `<img class="team-watermark" src="${esc(t.logo)}" alt="" width="150" height="150" loading="lazy">` : ''}
      ${stRank[t.key] ? `<div class="team-rank">#${stRank[t.key]}</div>` : ''}
      <div class="team-top">
        ${t.logo ? `<img class="team-logo" src="${esc(t.logo)}" alt="" width="42" height="42" loading="lazy">` : ''}
        <div>
          <div class="team-abbr">${esc(t.abbr)}</div>
          <div class="team-name">${esc(t.displayName || t.name)}</div>
          <div class="team-standing">${esc(t.standing || '')}</div>
        </div>
      </div>
      <div class="record">
        <span class="record-big">${esc(r.summary || '—')}</span>
        <span class="record-label">record</span>
      </div>
      <div class="team-grid">
        ${kv('Points scored / game', num(r.pointsForPerGame, 1), rankBadge(pfRank[t.key]))}
        ${kv('Points allowed / game', num(r.pointsAgainstPerGame, 1), rankBadge(paRank[t.key]))}
        ${kv('Point differential', r.differential == null ? '—' : (r.differential > 0 ? '+' : '') + r.differential, rankBadge(diffRank[t.key]))}
        ${kv('Games played', statOf(t, 'general', 'gamesPlayed'))}
      </div>
      ${t.nextEvent ? `<p class="team-next">Next: <b>${esc(t.nextEvent.name || '')}</b> ${esc(shortDate(t.nextEvent.date))}</p>` : ''}
    `;
    wrap.appendChild(themed(card, t));
  }
}

const kv = (k, v, badge = '') => `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${badge}${esc(v)}</span></div>`;

function num(v, dp = 0) {
  return Number.isFinite(v) ? v.toFixed(dp) : '—';
}

function statOf(team, cat, name) {
  return team.indexed?.[cat]?.[name]?.display ?? '—';
}

/**
 * Where each team stands among just these three clubs on one measure — 1
 * for the best, tied values share a rank, and the next rank after a tie
 * skips ahead (standard competition ranking: 1, 1, 3, not 1, 1, 2).
 */
function rankAmong(teams, valueOf, lowerIsBetter) {
  const dir = lowerIsBetter ? 1 : -1;
  const entries = teams
    .map((t) => ({ key: t.key, v: valueOf(t) }))
    .filter((e) => Number.isFinite(e.v))
    .sort((a, b) => dir * (a.v - b.v));
  const ranks = {};
  let rank = 0;
  entries.forEach((e, i) => {
    if (i === 0 || e.v !== entries[i - 1].v) rank = i + 1;
    ranks[e.key] = rank;
  });
  return ranks;
}

/** Small "1st of these three" badge — same visual token wherever a rank
 *  among just the three clubs is shown, colour-filled only for the leader. */
const rankBadge = (rank) => (rank ? `<span class="rank-num${rank === 1 ? ' lead' : ''}">${rank}</span> ` : '');

/**
 * One comparison table.
 *
 * The bar is scaled against the largest of the three values, so on a
 * lower-is-better row the leader is the SHORTEST bar — which is what the eye
 * expects for "fewest interceptions". The leader is also marked explicitly,
 * using the winner the API worked out, never a comparison made here.
 */
function drawRows(wrap, rows, teams) {
  wrap.textContent = '';

  // How many of this table's rows each club leads — the count the table as
  // a whole boils down to, shown in the header rather than left for the
  // reader to tally themselves.
  const leadCounts = Object.fromEntries(
    teams.map((t) => [t.key, rows.filter((r) => r.leaders.includes(t.key)).length]),
  );
  const topLead = Math.max(...Object.values(leadCounts));

  const head = document.createElement('div');
  head.className = 'rows-head';
  head.innerHTML = `<div class="th-label"></div>` + teams.map((t) => (
    `<div class="th-team" style="--team:${esc(accent(t))}">` +
    (t.logo ? `<img class="th-logo" src="${esc(t.logo)}" alt="" width="20" height="20">` : '') +
    `<span>${esc(t.abbr)}</span>` +
    `<span class="th-lead${topLead > 0 && leadCounts[t.key] === topLead ? ' top' : ''}">Leading in ${leadCounts[t.key]}</span>` +
    (Number.isFinite(t.gamesPlayed) ? `<span class="th-gp">${t.gamesPlayed} game${t.gamesPlayed === 1 ? '' : 's'}</span>` : '') +
    `</div>`
  )).join('');
  wrap.appendChild(head);

  for (const row of rows) {
    const nums = teams.map((t) => row.values[t.key]).filter((v) => Number.isFinite(v));
    const max = nums.length ? Math.max(...nums) : 0;
    const min = nums.length ? Math.min(...nums) : 0;
    const among = rankAmong(teams, (t) => row.values[t.key], row.better === 'low');
    const el = document.createElement('div');
    el.className = 'row';

    const label = document.createElement('div');
    label.className = 'row-label';
    // A season total is marked, because the three clubs have not played the
    // same number of games and comparing raw counts hides that.
    label.innerHTML = `<span>${esc(row.label)}</span>`
      + (row.better === 'low' ? '<span class="row-hint">fewer is better</span>' : '')
      + (row.count ? '<span class="row-hint" title="A season total — the clubs have played a different number of games">season total</span>' : '');
    el.appendChild(label);

    for (const t of teams) {
      const v = row.values[t.key];
      const display = row.displays[t.key];
      const rank = row.ranks?.[t.key];
      const lead = row.leaders.includes(t.key);
      const cell = document.createElement('div');
      cell.className = `cell${lead ? ' lead' : ''}${display == null ? ' empty' : ''}`;
      // Point differential and a quarterback's rushing yards both go
      // negative. Scaling by absolute value drew the WORST team the longest
      // bar, so when anything in the row is below zero the row is scaled
      // across its own range instead: lowest empty, highest full.
      const width = !Number.isFinite(v) ? 0
        : min < 0 ? (max === min ? 100 : Math.max(2, ((v - min) / (max - min)) * 100))
        : max > 0 ? Math.max(2, (v / max) * 100)
        : 0;
      cell.innerHTML = `
        <div class="cell-top">
          <span class="cell-val">
            ${display != null && among[t.key] ? `<span class="rank-num${lead ? ' lead' : ''}">${among[t.key]}</span>` : ''}
            <span class="bar-val">${display == null ? '—' : esc(display) + esc(row.suffix || '')}</span>
          </span>
          ${rank ? `<span class="rank">${esc(ordinal(rank))} in NFL</span>` : ''}
        </div>
        <div class="bar"><i style="width:${width}%"></i></div>
      `;
      el.appendChild(themed(cell, t));
    }
    wrap.appendChild(el);
  }
}

function drawQbs(teams) {
  const wrap = $('qbs');
  wrap.textContent = '';
  for (const t of teams) {
    if (!t.qb) continue;
    const rating = t.qb.indexed?.passing?.QBRating?.display;
    const card = document.createElement('article');
    card.className = 'qb-card';
    card.innerHTML = `
      ${t.qb.headshot ? `<img class="qb-shot" src="${esc(t.qb.headshot)}" alt="" width="62" height="62" loading="lazy">` : '<div class="qb-shot"></div>'}
      <div>
        <div class="qb-name">${esc(t.qb.name || '')}</div>
        <div class="qb-meta">${t.logo ? `<img class="qb-team-logo" src="${esc(t.logo)}" alt="" width="16" height="16" loading="lazy">` : ''}${esc(t.abbr)} · ${esc(t.qb.position || 'QB')}${t.qb.jersey ? ` · #${esc(t.qb.jersey)}` : ''}</div>
        ${t.qb.line ? `<div class="qb-line">${esc(t.qb.line)}</div>` : ''}
      </div>
      ${rating ? `<div class="qb-rating"><span class="v">${esc(rating)}</span><span class="k">Rating</span></div>` : ''}
    `;
    wrap.appendChild(themed(card, t));
  }
}

/* ----------------------------------------------------------- draw: history */

function drawHistory() {
  const h = state.history;
  const teams = state.stats?.teams;
  if (!h || !teams) return;

  const byKey = Object.fromEntries(teams.map((t) => [t.key, t]));

  $('h2h-note').textContent = `Every meeting since the AFL–NFL merger in ${h.h2hWindow.from}. Oakland-era games count as the Raiders.`;
  const wrap = $('h2h');
  wrap.textContent = '';

  for (const pair of h.h2h) {
    const [ak, bk] = pair.pair;
    const a = byKey[ak], b = byKey[bk];
    if (!a || !b) continue;
    const aw = pair.record[ak] || 0;
    const bw = pair.record[bk] || 0;
    const total = aw + bw + (pair.record.ties || 0);

    const card = document.createElement('article');
    card.className = 'h2h-card';
    card.style.setProperty('--a', accent(a));
    card.style.setProperty('--b', accent(b));
    card.innerHTML = `
      <div class="h2h-top">
        <span class="h2h-side">${a.logo ? `<img src="${esc(a.logo)}" alt="" width="26" height="26" loading="lazy">` : ''}${esc(a.abbr)}</span>
        <span class="h2h-v">VS</span>
        <span class="h2h-side">${esc(b.abbr)}${b.logo ? `<img src="${esc(b.logo)}" alt="" width="26" height="26" loading="lazy">` : ''}</span>
      </div>
      <div class="h2h-score">
        <b style="color:${esc(accent(a))}">${aw}</b><span class="sep">–</span><b style="color:${esc(accent(b))}">${bw}</b>
      </div>
      <div class="h2h-bar">
        <i style="width:${total ? (aw / total) * 100 : 50}%;background:${esc(accent(a))}"></i>
        <i style="width:${total ? (bw / total) * 100 : 50}%;background:${esc(accent(b))}"></i>
      </div>
      <p class="h2h-meta">${pair.record.played} meeting${pair.record.played === 1 ? '' : 's'} since ${h.h2hWindow.from}${pair.record.ties ? `, ${pair.record.ties} tied` : ''}</p>
      <ul class="meetings">
        ${pair.games.slice(0, 5).map((g) => meetingRow(g, byKey)).join('')}
        ${pair.games.slice(5).map((g) => meetingRow(g, byKey, true)).join('')}
      </ul>
      ${pair.games.length > 5 ? `<button class="meetings-more" type="button">Show ${pair.games.length - 5} more</button>` : ''}
    `;
    wrap.appendChild(card);
  }
  $('h2h-section').hidden = false;

  drawSeasons(h, teams);
  drawTicker();
}

function meetingRow(g, byKey, extra = false) {
  const cls = extra ? ' class="meeting-extra"' : '';
  if (!g.completed) {
    return `<li${cls}><span class="yr">${esc(g.season)}</span><span>${esc(g.away)} @ ${esc(g.home)}</span><span class="sched">${esc(shortDate(g.date)) || 'scheduled'}</span></li>`;
  }
  const winner = Object.values(byKey).find((t) => (t.abbrs || [t.abbr]).includes(g.winner));
  const col = winner ? accent(winner) : '#3a4553';
  return `<li${cls}>
    <span class="yr">${esc(g.season)}</span>
    <span>${esc(g.away)} ${esc(g.awayScore)} @ ${esc(g.home)} ${esc(g.homeScore)}</span>
    <span class="res" style="background:${esc(col)};color:${esc(inkOn(col))}"><span>${winner?.logo ? `<img src="${esc(winner.logo)}" alt="" width="13" height="13" loading="lazy">` : ''}${esc(g.winner || 'TIE')}</span></span>
  </li>`;
}

/**
 * Which club(s) had the most wins in each season, among just the seasons
 * where at least two of the three clubs have data. A year where every club
 * present is tied marks nobody — there is no "best" to point at.
 */
function bestOfYear(h, teams) {
  const byYear = {};
  for (const t of teams) {
    for (const s of h.seasons[t.key] || []) {
      if (!s.played) continue;
      (byYear[s.year] ??= {})[t.key] = s.wins;
    }
  }
  const best = {};
  for (const [year, byTeam] of Object.entries(byYear)) {
    const keys = Object.keys(byTeam);
    if (keys.length < 2) continue;
    const max = Math.max(...keys.map((k) => byTeam[k]));
    const winners = keys.filter((k) => byTeam[k] === max);
    if (winners.length < keys.length) best[year] = new Set(winners);
  }
  return best;
}

function drawSeasons(h, teams) {
  const wrap = $('history');
  wrap.textContent = '';
  // One shared scale across all three clubs, or a 7-win season on one chart
  // would look the same height as a 13-win season on another.
  const allWins = Object.values(h.seasons).flat().filter((s) => s.played).map((s) => s.wins);
  const maxWins = Math.max(...allWins, 1);
  const best = bestOfYear(h, teams);

  for (const t of teams) {
    const seasons = h.seasons[t.key] || [];
    const played = seasons.filter((s) => s.played);
    const wins = played.reduce((a, s) => a + s.wins, 0);
    const losses = played.reduce((a, s) => a + s.losses, 0);
    const ties = played.reduce((a, s) => a + (s.ties || 0), 0);

    const row = document.createElement('article');
    row.className = 'hist-row';
    row.innerHTML = `
      <div class="hist-head">
        ${t.logo ? `<img src="${esc(t.logo)}" alt="" width="24" height="24" loading="lazy">` : ''}
        <span class="hist-name">${esc(t.displayName || t.name)}</span>
        <span class="hist-summary">${wins}–${losses}${ties ? `–${ties}` : ''} across ${played.length} seasons</span>
      </div>
      <div class="seasons">
        ${seasons.map((s) => {
          if (!s.played) return `<div class="season-col none" title="${esc(s.year)}: no data"><span class="sb" style="height:4%"></span><span class="sy">${String(s.year).slice(2)}</span></div>`;
          const winning = s.wins > s.losses;
          const isBest = best[s.year]?.has(t.key);
          return `<div class="season-col${winning ? ' winning' : ''}" title="${esc(s.year)}: ${s.wins}–${s.losses}${s.ties ? `–${s.ties}` : ''}${isBest ? ' — best of the three that season' : ''}">
            <span class="sr">${isBest ? '<span class="sr-best">★</span>' : ''}${s.wins}–${s.losses}</span>
            <span class="sb" style="height:${(s.wins / maxWins) * 100}%"></span>
            <span class="sy">${String(s.year).slice(2)}</span>
          </div>`;
        }).join('')}
      </div>
    `;
    wrap.appendChild(themed(row, t));
  }
  $('history-note').textContent = `Bar height is wins in that season, on one scale across all three clubs. ★ marks whichever club won the most games that year. ${h.seasonWindow.from}–${h.seasonWindow.to}.`;
  $('history-section').hidden = false;
}

/* ------------------------------------------------------------ draw: ticker */

/** Local calendar day, not UTC — "today"/"this game day" means the reader's
 *  own day, not the server's or ESPN's. */
function isSameLocalDay(iso, ref = new Date()) {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.toDateString() === ref.toDateString();
}

/** Any of our three clubs playing today, by the reader's own clock. */
function isGameDay(games) {
  return (games || []).some((g) => isSameLocalDay(g.date));
}

function buildStatsTickerItems(d) {
  const items = [];

  for (const g of d.live || []) {
    if (g.state === 'in') {
      const score = g.teams.map((t) => `${t.abbr} ${t.score ?? 0}`).join('  ');
      items.push({ team: null, html: `<span class="ticker-live">LIVE</span> <b>${esc(score)}</b> <span>${esc(g.detail || '')}</span>` });
    }
  }

  for (const t of d.teams) {
    const r = t.record || {};
    items.push({ team: t, html: `<b>${esc(r.summary || '—')}</b> <span>${esc(t.standing || '')}</span>` });
    items.push({ team: t, html: `<span>PF/g</span> <b>${esc(num(r.pointsForPerGame, 1))}</b> <span>· PA/g</span> <b>${esc(num(r.pointsAgainstPerGame, 1))}</b>` });
    if (t.qb) items.push({ team: t, html: `<span>${esc(t.qb.name)}</span> <b>${esc(t.qb.line || '')}</b>` });
    if (t.nextEvent) items.push({ team: t, html: `<span>Next</span> <b>${esc(t.nextEvent.name || '')}</b> <span>${esc(shortDate(t.nextEvent.date))}</span>` });
  }

  for (const pair of state.history?.h2h || []) {
    const [ak, bk] = pair.pair;
    items.push({ team: null, html: `<span>Series since ${esc(state.history.h2hWindow.from)}</span> <b>${esc(pair.abbr[0])} ${pair.record[ak]}–${pair.record[bk]} ${esc(pair.abbr[1])}</b>` });
  }

  return items;
}

/**
 * This week's full slate for the three clubs — not just live ones, unlike
 * the small in-progress note the stats ticker carries. One item per game,
 * whatever its state: kickoff date/time if it hasn't started, the score and
 * clock if it has, the final score once it's over. `g.detail` already reads
 * as a finished sentence in every state ("9/20 - 1:00 PM EDT", "Q3 8:42",
 * "Final") — ESPN's own text, not reformatted here.
 */
function buildScoreTickerItems(games) {
  return (games || []).map((g) => {
    const away = g.teams?.find((t) => !t.home);
    const home = g.teams?.find((t) => t.home);
    const started = g.state !== 'pre';
    const score = started && away && home
      ? `${away.abbr} ${away.score ?? 0} – ${home.abbr} ${home.score ?? 0}`
      : (g.name || `${away?.abbr ?? '?'} @ ${home?.abbr ?? '?'}`);
    const tag = g.state === 'in' ? '<span class="ticker-live">LIVE</span> ' : '';
    return { team: null, html: `${tag}<b>${esc(score)}</b> <span>${esc(g.detail || '')}</span>` };
  });
}

function drawTicker() {
  const d = state.stats;
  if (!d) return;

  updateTickerToggle(d.live);
  const items = tickerMode === 'scores' && (d.live || []).length
    ? buildScoreTickerItems(d.live)
    : buildStatsTickerItems(d);

  const html = items.map((it) => {
    const style = it.team ? ` style="--team:${esc(accent(it.team))};--team-ink:${esc(inkOn(accent(it.team)))}"` : '';
    const tag = it.team
      ? `<span class="ticker-tag"${style}><span>${it.team.logo ? `<img src="${esc(it.team.logo)}" alt="" width="15" height="15">` : ''}${esc(it.team.abbr)}</span></span>`
      : '';
    return `<li>${tag}${it.html}</li>`;
  }).join('');

  // Both copies always get the same markup. The second is aria-hidden and is
  // only there so the loop has no gap — see the comment in index.html.
  $('ticker-list').innerHTML = html;
  $('ticker-list-copy').innerHTML = html;
  retimeAndRestartTicker();
}

/** Shows the toggle only when there's a second mode worth switching to, and
 *  marks whichever of its two buttons matches the ticker's current mode —
 *  aria-pressed, not a class alone, so the state is announced as well as
 *  drawn. */
function updateTickerToggle(games) {
  const group = $('ticker-toggle');
  const hasGames = (games || []).length > 0;
  group.hidden = !hasGames;
  if (!hasGames) return;
  for (const btn of group.querySelectorAll('button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === tickerMode));
  }
}

/* ------------------------------------------------------- draw: live scores */

/**
 * Whether a game belongs in the standing live-scores strip right now: from
 * an hour before kickoff, so a reader who opens the page early sees it's
 * coming; through the whole game while it's in progress; and for the rest
 * of that game's calendar day once it's final, so the result doesn't
 * vanish the instant the clock hits zero. Gone again the next day.
 */
const LIVE_SCORE_PRE_WINDOW_MS = 60 * 60 * 1000;
function isLiveScoreActive(g, now = new Date()) {
  if (!g.date) return false;
  if (g.state === 'in') return true;
  if (g.state === 'post') return isSameLocalDay(g.date, now);
  if (g.state === 'pre') return now.getTime() >= new Date(g.date).getTime() - LIVE_SCORE_PRE_WINDOW_MS;
  return false;
}

/**
 * The standing strip at the top of the page — separate from the ticker,
 * and only ever our three clubs' own games (every game in d.live already
 * is one, since the API only ever collects theirs). Zero, one, two or all
 * three can show at once, one card per active game: if only the Bills
 * played today, that's the only card; if all three kick off around the
 * same time, all three show together.
 */
function drawLiveScores(d) {
  const section = $('livescores-section');
  const wrap = $('livescores');
  const byKey = Object.fromEntries((d.teams || []).map((t) => [t.key, t]));
  const active = (d.live || []).filter((g) => isLiveScoreActive(g));

  if (!active.length) {
    section.hidden = true;
    wrap.textContent = '';
    return;
  }

  wrap.textContent = '';
  for (const g of active) {
    const away = g.teams?.find((t) => !t.home);
    const home = g.teams?.find((t) => t.home);
    // Whichever side is one of ours drives the card's colour; if somehow
    // both are (two of the three playing each other), home wins the tie
    // for which accent is used — both scores show either way.
    const byAbbr = (abbr) => Object.values(byKey).find((t) => t.abbr === abbr);
    const oursTeam = byAbbr(home?.abbr) || byAbbr(away?.abbr);

    const card = document.createElement('article');
    card.className = `live-card live-${g.state || 'pre'}`;
    card.innerHTML = `
      <div class="live-status">
        ${g.state === 'in' ? '<span class="live-dot" aria-hidden="true"></span> LIVE' : g.state === 'post' ? 'FINAL' : 'UPCOMING'}
      </div>
      <div class="live-match">
        <span class="live-side">${away?.abbr ? esc(away.abbr) : '—'}${g.state !== 'pre' ? ` <b>${esc(away?.score ?? 0)}</b>` : ''}</span>
        <span class="live-at">@</span>
        <span class="live-side">${home?.abbr ? esc(home.abbr) : '—'}${g.state !== 'pre' ? ` <b>${esc(home?.score ?? 0)}</b>` : ''}</span>
      </div>
      <div class="live-detail">${esc(g.detail || '')}</div>
    `;
    if (oursTeam) {
      card.style.setProperty('--team', accent(oursTeam));
      card.style.setProperty('--team-ink', inkOn(accent(oursTeam)));
    }
    wrap.appendChild(card);
  }
  section.hidden = false;
}
