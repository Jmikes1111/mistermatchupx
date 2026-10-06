# MisterMatchup — Settle the debate.

A static, GitHub Pages compatible NFL matchup simulator. V2 retains the original dark design, all 32 teams, inline results, and 10,000 Monte Carlo trials. There is no backend, browser dependency, package installation, or bundler. Serve the repository over HTTP (ES modules do not run reliably via `file://`):

```sh
python3 -m http.server 8000 --bind 127.0.0.1
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
npm run backtest
```

Node 18+ and Python 3.10+ are sufficient for the model and ingestion checks. Browser integration tests additionally use Python Playwright and system Chromium (`/usr/bin/chromium`); install Playwright with `python3 -m pip install playwright` if absent. The website itself needs neither tool. Existing GitHub Pages branch deployment can continue publishing the repository root without a build step. Relative module/data paths work beneath `/mistermatchupx/` and custom domains. No deployment settings have been changed.

## Real data and refresh

The committed snapshot uses **2026 Weeks 1–4: 63 completed regular-season games**, supplemented by **272 real 2025 regular-season games**. Cutoff: October 5, 2026, 11:00 p.m. America/New_York (October 6, 03:00 UTC). `data/provenance.json` records actual inspected column names, row counts, source URLs, retrieval times, and SHA-256 hashes. The primary UI label is **Data through: 2026 Week 4**, with the latest represented game date and completed-game count. Expand the secondary details for **Sources retrieved** (the range of source fetch times), **Model built**, model version, and observation cutoff. `modelBuiltAt` changes when the static snapshot is generated; it does not mean new games or source data were fetched. `sourcesRetrieved` summarizes per-source `retrievedAt` values. These are retrieval times, not upstream publication times. Unknown legacy retrieval times are reported as unknown, never inferred from cache file modification time.

Refresh deliberately, then test and review the resulting assets before deploying:

```sh
python3 scripts/build_data.py --season 2026 --refresh
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
npm run backtest
```

For repeatable local rebuilding, omit `--refresh` to reuse the cache, and supply `--as-of 2026-10-06T03:00:00Z`. Cached files are outside the checkout (`/tmp/mistermatchup-cache` by default); `--cache PATH` selects another location. A historical cutoff excludes later observations but **does not recreate historical versions of corrected upstream files**. Archive downloaded source vintages externally for genuine point-in-time research. Never silently substitute a later season for missing current data. The schedule is required; weekly stats, PBP, player/roster/depth-chart and NGS sources are optional because the model can operate using real game scores without their additional features. A failed retrieval or schema check uses a validated cache if available and logs a warning. Required data with no valid cache, or zero completed current-season games, aborts before replacing the existing snapshot. Optional data with no valid cache logs a warning, is recorded as unavailable, and is omitted without fabricated rows. Provenance records `required`, `status` (`available`, `cached`, or `unavailable`), `cacheUsed`, retrieval time, content hash, and any failure warning. Successful downloads are validated before atomically replacing cached content; retrieval sidecars preserve fetch times across rebuilds. Existing legacy provenance retains its known fetch times and records original cache usage as unknown.

| Dataset | Actual release/source | Used for |
|---|---|---|
| Schedules/results | nflverse/nfldata `data/games.csv` | Final scores, dates, opponents, location and historical rest |
| Weekly team stats | `stats_team/stats_team_week_{season}.csv` | Passing/rushing yards and EPA observations |
| Weekly player stats | `stats_player/stats_player_week_{season}.csv` | QB EPA/dropbacks; RB/WR/TE touches/targets and scrimmage yards |
| Play-by-play | `pbp/play_by_play_{season}.csv.gz` | EPA/play, success rate, yards/play; run/pass plays excluding kneels/spikes and null EPA |
| Rosters | `rosters/roster_2026.csv` | Latest reported roster status attached to QB identity; not an injury report |
| Depth charts | `depth_charts/depth_charts_2026.csv` | Timestamped QB rank-1 selection; observed schema is `dt`, `pos_abb`, `pos_rank`, not legacy weekly fields |
| Next Gen Stats | `nextgen_stats/ngs_passing.csv.gz` | Weekly passing CPOE joined by season/week/team/GSIS ID; week-0 season summaries excluded |

2026 coverage: all 126 game/team sides have PBP EPA, weekly team stats and QB observations; 32 depth-chart QB selections. NGS covers qualifying passers only, with some backups included. Missing NGS observations remain null. The compressed NGS file is available even though the documented uncompressed CSV endpoint returned 404. Dataset publication locations were checked against nflreadr loader code and downloaded schemas, not inferred from old prototype field names.

Source attribution: [nflverse-data](https://github.com/nflverse/nflverse-data), [nfldata](https://github.com/nflverse/nfldata), [nflreadr dictionaries](https://nflreadr.nflverse.com/articles/index.html), and [NFL Next Gen Stats](https://nextgenstats.nfl.com/). Source-specific upstream terms apply; no universal license for all upstream material is asserted. No PFF grades are fetched or redistributed; incidental PFF identifier columns are excluded from the static snapshot.

## Model and architecture

- `scripts/build_data.py`: standard-library ingestion, actual-schema checks, joins, missing-data reporting and compact static outputs. Large datasets stay out of the browser.
- `data/snapshot.json`: normalized game-level history plus observed QB depth-chart context, roughly 0.8 MB. `provenance.json` retains audit metadata.
- `js/model.js`: pure cutoff-aware rating construction, expected scores, seeded or random Monte Carlo sampling, explanation and 50-matchup self-tests.
- `js/app.js` and `styles.css`: loading, interface and visual styling. Failed data loading disables predictions and shows a recoverable error; stale results disappear when selections change.
- `js/adapters.js`: explicit licensed-PFF adjustment interface. It performs no scraping, fetching, or grade redistribution.
- `js/evaluation.js` and `scripts/backtest.js`: walk-forward evaluation and recorded predictions, accuracy, Brier score, log loss, calibration bins and an optional timestamped ATS interface.

Ratings blend a recency-weighted average (75%) and season average (25%). Recency has a 42-day half-life plus a season-wide weight floor; previous-season games receive 0.3 times current-season weight. Effective sample weight is shrunk toward league average with a 2.5-game prior. Offense and defense combine scoring (0.65 coefficient), EPA/play (12 points per EPA/play difference), and success rate (5-point coefficient), with a damped 0.35 opponent-scoring adjustment. Defense is positive when stronger. Bounds prevent extreme small-sample outputs. With no historical observations the explicit **model prior** is 22 points and neutral ratings, not fabricated team measurements.

QB EPA is already represented in team efficiency. A small, regressed starter-versus-observed-QB adjustment avoids counting that performance twice. Weekly NGS CPOE adds a separately bounded, regressed passing adjustment. Skill-player production is incorporated through team efficiency and shown as factual contributors in “Why?”; there are no invented individual injury penalties. The observed rank-1 QB is used only if its depth-chart timestamp precedes the cutoff. Missing starter performance does not invent a replacement rating. Roster status is displayed in model data, but is not treated as proof of game-day availability.

Home field contributes 1.7 points to Team 1. Unchecked means neutral field. Arbitrary hypothetical pairings have no implied real schedule/rest; historical evaluation supplies the actual known rest differential with a capped adjustment. Context supports timestamped, attributed injury, roster, advanced and licensed-PFF point adjustments (up to 5 points each). Nothing is enabled without supplied evidence.

Simulations sample nonnegative rounded scores with historical score dispersion (bounded 8–14) and a shared pace component. Tied trials are split randomly for **two-way** winner probabilities; real NFL regular-season ties are possible. Model edge replaces the old unsupported “high confidence” label. Coefficients and score-distribution choices are **heuristic and not trained or calibrated**. This is an experimental model, not evidence of a profitable betting system.

## Backtesting and limitations

`npm run backtest` evaluates completed 2026 games. `node scripts/backtest.js 2025` evaluates the supported prior season, skipping the initial games without 32 prior league observations. Features use only games whose conservative `availableAt` (following day at noon UTC) precedes midnight on the target game date. Current depth charts are disabled; final-game QB IDs, final-game stats and market lines are never input features. Same-day results are excluded. A leakage test poisons future scores, EPA, QB stats and depth charts and confirms unchanged past predictions.

The checked-in 2026 report evaluates 63 games: **61.9% accuracy**, **0.2351 Brier**, **0.6608 log loss**. Calibration bins and per-game predictions are stored in `data/backtest-2026.json`. Ties receive a fractional 0.5 outcome for probability metrics and are excluded from binary accuracy. These are retrospective descriptive results on a small sample, not a held-out validation or calibrated claim. Source corrections and availability delays remain limitations; true pre-game information availability requires archived source versions and publication timestamps.

ATS is not reported because timestamped pre-game market lines are unavailable in this implementation. The evaluation interface accepts an explicitly signed home handicap only with an observation timestamp before kickoff, skips prediction passes, and records pushes separately. It does not pretend today's schedule odds establish historical availability.

Next steps: archive source vintages and injury reports; automate reviewed/tested refreshes; evaluate multiple seasons with untouched holdout seasons; fit coefficients and score dispersion using training-only data; calibrate probabilities and compare against neutral/home-only baselines; integrate confirmed starters and licensed timestamped markets for ATS. Weather, travel, OL/defensive-player adjustments and live injury availability are currently unavailable, not synthesized.
