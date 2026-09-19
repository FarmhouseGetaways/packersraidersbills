# PackersRaidersBills — handover

Written 19 Sep 2026 at the end of a Claude Code **cloud** session. Everything
below is verified, not assumed: each claim was checked against the live API,
the live site or the deploy record at the time of writing.

## Status at a glance

| | |
|---|---|
| **Live** | https://packersraidersbills.netlify.app — public, working, real data |
| **Repo** | `FarmhouseGetaways/packersraidersbills`, branch `main`, auto-deploys on push |
| **Netlify project** | `packersraidersbills`, site id `292c3512-cdc0-4d75-b8c8-546216c003fc` |
| **Outstanding** | **One thing only** — attach `packersraidersbills.com`. See below. |

## The one job left

`packersraidersbills.com` is registered at **directnic.com** (where all of this
owner's domains live) and is **not yet attached to anything**.

1. Netlify → the `packersraidersbills` project → **Domain management** → **Add a
   domain** → `packersraidersbills.com`. Add `www` as well when offered.
2. **Set the apex as primary.** This is load-bearing: the repo already ships
   `<link rel="canonical" href="https://packersraidersbills.com/">`, an
   `og:url`, and a `sitemap.xml` all pointing at the apex. If www ends up
   primary, either change it back or update those three — never leave them
   disagreeing, it splits the page across two addresses in search.
3. Netlify then offers nameservers **or** manual records. Prefer the
   nameservers: it is one field at directnic, and Netlify then owns apex, www
   and the certificate. Manual alternative: `A` on `@` → `75.2.60.5`, `CNAME`
   on `www` → `packersraidersbills.netlify.app`.
4. At **directnic.com** → sign in → the domain → the nameserver section →
   replace directnic's four with Netlify's.
5. The certificate provisions itself once DNS resolves.

**Verify rather than assume** — apex 200, www redirecting to apex, certificate
covering both, `/api/stats` 200 with live data on the real domain,
`/sitemap.xml` and `/robots.txt` 200, and the served canonical matching the
primary domain.

Nameserver delegation moves **all** DNS to Netlify. Fine today — the domain is
new and carries no email. If email is ever added, its MX records have to live
at Netlify too.

## What this is

A live statistics page comparing three NFL clubs — Green Bay Packers, Las Vegas
Raiders, Buffalo Bills. Static HTML, one stylesheet, one JavaScript file, two
Netlify functions. No build step, no dependencies, no npm, **no environment
variables** (ESPN's public API needs no key).

- Three club panels — record, standing, points for/against, next fixture
- Head to head — all three pairings, series and every meeting since 2007
- **103 statistics in seven collapsible categories** plus a quarterback table
- Twenty seasons of form, one shared scale across the clubs
- A scrolling ticker of records, quarterback lines, fixtures and series

Every figure is read live. `/api/stats` (2 min cache) and `/api/history` (6 h)
fan out to ESPN server-side. **Nothing is hardcoded**; when ESPN cannot be
reached the page serves its last good copy and says it is stale rather than
inventing a number.

## Four traps in ESPN's API — each cost real time

1. **`site.api.espn.com` answers 403 to a request with NO User-Agent.** Not 401,
   not a rate limit. Node's `fetch` sends none by default, so half the calls
   failed while `sports.core.api` ones kept working — the page still rendered,
   with fallback colours and no records, and nothing logged an error.
2. **The Raiders were `OAK` until 2020.** Matching on `LV` alone reported a
   twenty-season head-to-head as a single game. Each club carries an `abbrs`
   list of every name it has played under.
3. **`passing.sacks` is sacks TAKEN; `defensive.sacks` is sacks MADE.** Same
   word, opposite meaning, opposite direction of "better".
4. **`defensive.yardsAllowed` and `pointsAllowed` are served as `0`** all
   season. Points conceded is read off the season record instead; yards allowed
   is not shown at all rather than shown as nothing.

Smaller: the team endpoint needs a **lowercase** slug (`/teams/gb`, not `/GB`),
and `passingYards` is gross while `netPassingYards` is after sack yardage.

## Judgement calls that should not be quietly undone

- **Season totals are labelled, and every column heading shows games played.**
  Early in a season one club has played once and another twice, so comparing
  raw counts is mostly a fact about the schedule.
- **A club is drawn in its own colour, lightened to be legible — not swapped
  for its secondary.** Dropping dark primaries to secondaries turned the
  Packers gold and the Bills red: legible, and wrong. The Raiders are the one
  exception, because `#000000` has no hue to lighten.
- **Every category starts collapsed.** No category is the one everybody wants,
  and 103 rows at once is a wall. What a reader opens is remembered.
- **Open/closed state is a Map of key → boolean, held outside the DOM.** The
  page redraws every 60 s and a rebuilt `<details>` defaults to closed. A
  *list* of open keys cannot tell "the reader closed this" from "this did not
  exist yet", so a new category would never get its own default.
- **A row containing a negative value scales across its own range.** Scaling by
  absolute value drew Green Bay's −17 point differential as a full-width bar,
  making the worst club read as the leader.

## Running and testing it

```
node tools/dev-server.mjs          # http://127.0.0.1:8099, real functions
node --test netlify/functions/_lib/*.test.mjs    # 29 tests, plain Node
```

Driving it with a headless browser: launch Chromium with
`--ignore-certificate-errors` or `a.espncdn.com` logos and Google Fonts are
blocked on certificate grounds and you will design blind. Headshots are
`loading="lazy"` — scroll the page **and wait for them to decode** before
screenshotting; scrolling back to the top too early cancels the fetches and
they come out as empty circles.

`css/site.css` and `js/app.js` are cached for a year and linked with `?v=`
hashes. Change either and bump its string, or nobody sees the change.

## What a cloud session could not do — do not repeat these attempts

- **Create a GitHub repository.** `POST /user/repos` → 403; the Claude GitHub
  App has Contents write on existing repos, not Administration on the account.
  The owner created it by hand in the end.
- **Drive a browser.** No `claude-in-chrome` tools exist in a cloud session —
  no link to the owner's machine. A session on their **desktop** has them.
- **Anything to do with domains or DNS.** Every Netlify MCP tool was checked:
  visitor access, forms, form submissions, rename, env vars, create project,
  deploys, extensions. There is **no** domain, DNS or certificate operation.

One thing that *did* work on a retry: **visitor access controls**. Netlify had
created the site requiring team login on **all** deploys, which is why it
returned 401 to every signed-out device while appearing to work on a desktop
already signed into Netlify. It is now `non_production`, matching
farmhousegetaways and the app. **Do not set it back to `all`.**

## History

| Commit | |
|---|---|
| `9d02830` | The build — live ESPN data, two functions, 27 tests |
| `ef8ee24` | Broadcast-graphics rework — condensed type, club-colour floods, logos |
| `b764085` | PackersRaidersBills branding, logos throughout, 33 → 103 statistics |
| `2482192` | Every category starts collapsed |
| `252d20d` | canonical, Open Graph, sitemap.xml, robots — all pointing at the apex |

There is also a dead end worth knowing about: the work was briefly parked in
`FarmhouseGetaways/farmhousegetaways` on branch `claude/new-repository-njrszf`
(commit `1994fc7`) because a cloud session could not create a repository and
the container was going to be reclaimed. It was removed again in `b7ff5e3`
once the real repo existed, and that branch's tree is byte-identical to `main`.
**Nothing is owed there.**
