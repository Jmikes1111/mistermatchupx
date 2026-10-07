# MisterMatchup NHL V1 — experimental, non-commercial

**Scoring/draw status superseded by [NHL V1.1](NHL_DRAW_V11.md); this report is retained as the prior audit record.**

**This initial implementation report is superseded by [the final audit](NHL_FINAL_AUDIT.md). Its original evaluation tables are retained as historical baseline evidence.**

Development branch: `nhl-v1`. No production deployment, merge, or NFL model change. The existing product-file changes are the NHL prototype link and an empty inline favicon declaration in `index.html`; production NFL data, model, ingestion, styles and tests remain byte-identical.

## Sources and rights

MoneyPuck is a major input, credited on the NHL page. Its [download documentation](https://moneypuck.com/data.htm) explicitly permits non-commercial use and journalist ad-hoc use with attribution; other uses require permission. This implementation claims no ownership or commercial license. Commercial deployment requires rights review, including permission for derived snapshot distribution. No unauthorized statistics-page scraping or PFF data is involved.

The actual downloaded sources are:

- `https://moneypuck.com/moneypuck/playerData/careers/gameByGame/all_teams.csv`: team game-level history, regular-season and playoff flags; only four selected regular seasons are normalized.
- `https://moneypuck.com/moneypuck/playerData/seasonSummary/{2023,2024,2025,2026}/regular/goalies.csv`: enumerates observed goalie IDs.
- `https://moneypuck.com/moneypuck/playerData/careers/gameByGame/regular/goalies/{playerId}.csv`: documented per-goalie career download template; game-level goalie performance.
- `https://moneypuck.com/moneypuck/playerData/seasonSummary/2026/regular/skaters.csv`: current player summaries, reserved for future player modeling, never used for historical predictions.
- `https://api-web.nhle.com/v1/standings/now`: current 32 team names/IDs.
- `https://api-web.nhle.com/v1/club-schedule-season/{club}/{20232024,20242025,20252026,20262027}`: official completed-game results, dates, neutral venue and regulation/OT/shootout classification.

Every concrete URL, inspected CSV header, retrieval timestamp, cache status, byte count and SHA-256 is recorded in `data/nhl/provenance.json`. Core MoneyPuck and NHL domains are accessible. MoneyPuck's documented bulk player archives and dictionaries on `peter-tanner.com` remain unavailable under the environment allowlist; that optional domain was saved in the environment draft, but no publish tool is available. Working documented MoneyPuck-hosted career files supply the needed data. Adapter requests identify this non-commercial project, are paced, reuse hash-validated caches and stop new MoneyPuck requests after HTTP 429. Required source failures stop the build; optional unavailable sources warn and record absence, without invented players.

Raw downloads, including the roughly 127 MB team file, remain outside the checkout in `/tmp/mistermatchup-nhl-cache`. Only compact normalized data is included. Browser visitors fetch only the NHL snapshot, not historical games, evaluation predictions or raw files.

## Actual inspected schemas

Full source headers are preserved in provenance. Calculations validate the following actual columns before using them:

- Team identity: `team`, `season`, `gameId`, `playerTeam`, `opposingTeam`, `home_or_away`, `gameDate`, `situation`, `playoffGame`. Situations used: `all`, `5on5`, `5on4`, `4on5`.
- Team rates/shares: `iceTime`, `xGoalsFor`, `xGoalsAgainst`, `scoreVenueAdjustedxGoalsFor`, `scoreVenueAdjustedxGoalsAgainst`, `shotsOnGoalFor`, `shotsOnGoalAgainst`, `shotAttemptsFor`, `shotAttemptsAgainst`, `unblockedShotAttemptsFor`, `unblockedShotAttemptsAgainst`, `goalsFor`, `goalsAgainst`, plus low/medium/high-danger shots in both directions.
- Goalie: `playerId`, `name`, `season`, `gameId`, `playerTeam`, `gameDate`, `situation`, `icetime`, `xGoals`, `goals`, `ongoal`, `highDangerShots`, `highDangerxGoals`, `highDangerGoals`, `mediumDangerShots`, `mediumDangerGoals`, `lowDangerShots`, `lowDangerGoals`.
- Skater: `playerId`, `name`, `season`, `team`, `position`, `situation`, `games_played`, `icetime`, `I_F_xGoals`, `I_F_shotsOnGoal`, `I_F_goals`, `I_F_primaryAssists`, `I_F_secondaryAssists`, `I_F_points`, `I_F_shotAttempts`, `I_F_highDangerShots`, `onIce_xGoalsPercentage`, `offIce_xGoalsPercentage`.
- NHL JSON: `games[].id`, `season`, `gameType`, `gameDate`, `neutralSite`, `gameState`, `homeTeam.abbrev/score`, `awayTeam.abbrev/score`, `gameOutcome.lastPeriodType`. Winning-goalie outcome fields are never predictive features.

No shooting-talent-adjusted xG field was identified in these inspected files. Adjusted/flurry metrics must not be represented as shooting-talent data. Expected shooting and expected save percentages computed against actual shots on goal are explicitly proxies, not official source-native expected percentages.

## Architecture and method

`scripts/nhl/moneypuck.py` isolates the replaceable source adapter. `build_data.py` validates and normalizes; `evaluate.js` selects scoring/recency configuration; `build_snapshot.js` creates the small static serving artifact. NHL model and UI modules are separate; `js/shared/statistics.js` provides standalone distributions, deterministic random sampling and probability scoring without refactoring NFL. Normalized player identities/statistics are available for future player models; no props, sportsbook or NFL V3 functionality is added.

Team offensive creation and opposing defensive suppression use score/venue-adjusted 5v5 xG/60, with separate PP creation and opposing PK xGA/60. Exposure minutes, season-to-prior shrinkage and a bounded league residual for other manpower states turn rates into expected goals. Shot quality is already represented by MoneyPuck xG. The final audited configuration disables the noisy finishing multiplier (factor one). Finishing remains a diagnostic rather than a strength input. Team process features do not use wins as a strength input. Ten-game prior strength and finishing shrinkage are provisional regularization choices, not established optima.

Current-season game-level last 5/10/20 and season windows retain xG rates/share, shot/Corsi/Fenwick shares, medium+high scoring-chance proxy, high-danger share, goal differential, shooting versus expected proxy, observed goalie GSAx and special teams. Early-season windows state the actual smaller number of games. Current strength is shrunk toward previous-season franchise observations, otherwise league priors. Historical Arizona is explicitly mapped to Utah franchise continuity, not asserted current roster continuity.

Six recency candidates are tested: season-heavy (85% season/15% last20), last20/10/5-heavy (25% season/75% chosen window), exponential 30-day half-life, and a blended-window candidate. Candidate settings are exploratory, not claimed globally optimal.

Goaltending is separate: GSAx = xGA minus goals allowed; GSAx/60, recent10 appearances, longer observed history, save-above-expected, expected-save proxy, xGAA and danger breakdowns. The final audited configuration uses longer observed-history GSAx/60 with 600 minutes of neutral prior and bounded impact; it removes the original 30% last10 boost. Recent goalie performance remains diagnostic. Starter-unknown uses a probability-weighted recent team-workload mixture. No goalie is claimed roster-current or confirmed. Source/time accompany the assumption; hypothetical UI selections are explicitly scenarios. Confirmed/projected interface inputs require pre-cutoff source/time and eligible observations. Goalie workload informs mixture and last appearance; a separate goalie fatigue coefficient is not implemented.

Home factor, shootout fraction and NB dispersion are estimated on 2023–24 training only. Schedule-derived rest is supported in historical evaluation; the 5% back-to-back penalty is an explicit heuristic. Arbitrary UI matchups do not invent dates/rest. Injury, travel and lineup data remain unavailable.

Independent Poisson and gamma-Poisson negative-binomial scoring are compared using historical score variance and out-of-sample probability/score losses. Every matchup runs 10,000 trials. Final displayed probabilities and score means use matching analytical results, while sampled results remain separate diagnostics to avoid prediction noise. Tied regulation scores proceed to a scoring-rate-based sudden-death winner assumption, mixed with a neutral shootout component using training's observed shootout fraction; the winner gets one score increment. Regulation wins, tied-regulation/OT probability and full-game moneyline remain distinct and coherent. OT/SO resolution is a simplified conditional model, not a detailed three-on-three event simulation. Independent scoring omits game-state/empty-net correlation.

## Leakage and timestamps

All team windows, goalie history, league priors and historical mixtures filter pre-cutoff observations. Historical cutoffs are game-date midnight UTC; no same-day game outcomes enter predictions. Game results are labels only. The entire 2023–24 training season precedes validation; 2024–25 chooses the configuration; 2025–26 is an untouched holdout. Players' current aggregated summaries never enter historical features. Poisoned future observations are tested.

**Retrospective limitation:** MoneyPuck career files can be revised after games. Archived versions and actual publication timestamps are unavailable. `availableAt` assumes next-day noon UTC, which can precede the actual source publication. Historical goalie ID enumeration comes from downloaded season summaries (coverage selection bias), and current team identity mapping reflects today's franchises. These are not certified contemporaneous pregame predictions. No current winning-goalie field is used as a historical starter.

Primary UI coverage is `Data through: 2026-10-05`, the latest represented completed game date. Source fetch range and model-build time are secondary metadata, distinct and cache-preserved. Rebuilding advances model-built time only; fetching unchanged data does not advance represented game coverage. Snapshot/provenance timestamps are cross-checked in browser tests.

## Reproduction

From repository root, with Python stdlib, Node and Chromium/Playwright available:

```sh
python3 scripts/nhl/build_data.py --non-commercial
node scripts/nhl/evaluate.js
node scripts/nhl/build_snapshot.js
npm test
python3 -m unittest discover -s tests -v
git diff --check
```

Default source cache is outside Git. `--refresh` explicitly downloads again; no automatic environment or website publishing occurs. GitHub project Pages use relative assets and module-relative snapshot URLs. NHL loading failure disables predictions, rather than generating substitutes.

## Remaining limitations and next steps

No confirmed starter feed, injuries, current lineups, travel, goalie-fatigue adjustment, verified historical publication records, talent-adjusted xG, correlated scoring, market/ATS evaluation or full player distributions. Player summaries are preparation only. Model probabilities remain experimental and uncalibrated. Mixtures can include traded/released goalies because roster confirmation is unavailable. Stronger validation would archive dated source snapshots and starter reports, test longer independent seasons, fit context/shrinkage parameters in nested temporal validation, assess calibration and correlations, and obtain appropriate deployment data rights. These belong after review, not a silent production release.

## Observed evaluation results

Training: 2023–24, 1,312 games. Validation: 2024–25, 1,312. Holdout: 2025–26, 1,312. Current 2026–27: 43 games through October 5. Total normalized games: 3,979; goalie appearances: 8,415; current skater summaries: 617. All 267 recorded download sources available (some from validated cache).

Training regulation mean: 3.0091; variance: 3.1032; NB dispersion: 96.2405. Mild unconditional overdispersion does not automatically justify NB: select using validation probability loss.

| Recency | Distribution | Validation Brier | Validation log loss | Holdout Brier | Holdout log loss | Holdout accuracy |
|---|---|---:|---:|---:|---:|---:|
| season-heavy | poisson | 0.237209 | 0.666915 | 0.244855 | 0.682633 | 56.25% |
| season-heavy | negative-binomial | 0.237219 | 0.666941 | 0.244801 | 0.682522 | 56.25% |
| last-20-heavy | poisson | 0.236861 | 0.666168 | 0.245445 | 0.683816 | 55.03% |
| last-20-heavy | negative-binomial | 0.236875 | 0.666202 | 0.245366 | 0.683651 | 55.03% |
| last-10-heavy | poisson | 0.237359 | 0.667300 | 0.246728 | 0.686577 | 56.02% |
| last-10-heavy | negative-binomial | 0.237343 | 0.667263 | 0.246611 | 0.686323 | 56.02% |
| last-5-heavy | poisson | 0.238273 | 0.668899 | 0.250437 | 0.694948 | 54.27% |
| last-5-heavy | negative-binomial | 0.238201 | 0.668746 | 0.250238 | 0.694469 | 54.27% |
| exponential | poisson | 0.236823 | 0.666101 | 0.245341 | 0.683635 | 55.49% |
| exponential | negative-binomial | 0.236840 | 0.666143 | 0.245267 | 0.683480 | 55.49% |
| blended | poisson | 0.236639 | 0.665658 | 0.246301 | 0.685783 | 55.87% |
| blended | negative-binomial | 0.236645 | 0.665677 | 0.246203 | 0.685566 | 55.87% |

Selected solely on validation: **blended / Poisson**. Full per-candidate regulation-score losses and calibration bins, plus 2,624 selected game predictions, are in `data/nhl/evaluation.json`.

| Holdout baseline | Brier | Log loss | Accuracy |
|---|---:|---:|---:|
| coin | 0.250000 | 0.693147 | 52.21% |
| home | 0.249932 | 0.693015 | 52.21% |
| record | 0.248243 | 0.689624 | 53.73% |
| seasonXg | 0.245244 | 0.683541 | 55.34% |
| simpleXg | 0.245595 | 0.684283 | 55.72% |

The selected model improves over coin/home baselines but **does not outperform season-xG or simple-xG baseline probability quality on holdout**. Accuracy alone is insufficient justification for greater complexity. Calibration bins show some overconfidence (60–70% predictions win about 61%); no post-hoc calibration was fitted on holdout. Keep experimental status, and investigate nested temporal tuning/calibration before any betting-quality claim.

## File inventory

Modified: `index.html` (NHL navigation and empty inline favicon declaration). Added:

- `data/nhl/config.json`
- `data/nhl/evaluation.json`
- `data/nhl/history.json.gz`
- `data/nhl/players.json`
- `data/nhl/provenance.json`
- `data/nhl/snapshot.json`
- `docs/NHL_V1.md`
- `js/nhl/app.js`
- `js/nhl/model.js`
- `js/shared/statistics.js`
- `nhl.css`
- `nhl.html`
- `scripts/nhl/build_data.py`
- `scripts/nhl/build_snapshot.js`
- `scripts/nhl/evaluate.js`
- `scripts/nhl/moneypuck.py`
- `tests/nhl.test.js`
- `tests/test_nhl_browser.py`
- `tests/test_nhl_ingestion.py`

## Final verification and readiness

The initial implementation passed 21 Node tests and 29 Python-discovered checks (including duplicated NFL browser discovery). See the final audit for the final expanded test counts. Chromium checked all 32 NHL teams in 64 reversed matchups, alternating home ice, a hypothetical goalie scenario, mobile viewport, missing-snapshot handling, relative assets under a GitHub project subpath and accurate coverage/provenance timestamps. No page errors or failed asset responses. NFL protected-file hashes differ only for the intentional navigation link. Git whitespace check passes; no new credential matches, private/PFF data, raw CSV archives or cache/temp artifacts are included. Snapshot is approximately 366 KB.

**GO FOR AUDIT** of the isolated non-commercial prototype. This is not approval for commercial deployment, a claim of superiority to xG baselines, or a certified pregame betting record. No merge, push or deployment was performed.
