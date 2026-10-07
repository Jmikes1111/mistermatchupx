# MisterMatchup NHL V1 final pre-deployment and model-quality audit

**Scoring/draw status superseded by [NHL V1.1](NHL_DRAW_V11.md); this report is retained as the prior audit record.**

**Recommendation: NO-GO. Blocking model-quality issue: tied-regulation/OT probability is systematically understated (validation 16.0% predicted versus 20.7% observed; holdout 16.2% versus 24.8%). The code and UI are functional, but this important probability output needs a training/validation-based scoring or draw model review before publishing. No push, merge or deployment was performed.**

## Key findings and discrepancies

- Confirmed: 3,979 regular-season games (1,312 each for seasons starting 2023/2024/2025; 43 for 2026), 8,415 unique game/team/goalie appearances, 617 unique current skater summaries, 32 current NHL teams and coverage through October 5, 2026. All 267 source-cache hashes match provenance. Team xG/goals are reciprocal; official score differences are consistent with extra-time outcomes. Current teams have 2–4 observed games, not full last5/10/20 samples.
- Original evaluation reproduced exactly, excluding only evaluation-generated timestamp. NHL_V1.md accurately described that initial implementation, but its methods/results are now explicitly superseded where this audit changed them.
- Original Python test count 29 included duplicated imported/inherited NFL browser tests. Discovery was cleaned up; final distinct suite has 26 Python tests, including expanded NHL browser tests. This was a counting discrepancy, not an NFL model regression.
- Strict console checking found an existing automatic `/favicon.ico` 404. Both HTML pages now declare an empty inline favicon, preventing the request without new network assets or a visual layout change.
- Audit authorized two validation-selected component changes: remove the 30% last10 goalie-quality boost; disable the finishing multiplier. The combined change improved both temporal validation periods but worsened the previously reported holdout. It was **not reverted or retuned using holdout outcomes**.
- Monte Carlo initially introduced ordinary binomial sampling noise. Final probability and projected-mean reporting is analytical, while all 10,000 trials execute and sampled diagnostics remain available. Controls lock during each run to avoid mixed-input races.

## Method and frozen decisions

Team goals combine score/venue-adjusted 5v5 offensive creation with opponent suppression and league-normalized exposure, plus separate PP/PK creation/suppression and bounded other-manpower residual. Current observations shrink toward previous-season franchise rates (10-game prior), then league priors; cold-start constants are explicitly statistical priors, never fabricated observations. Finishing diagnostics remain displayed/available, but final serving finishing factor is one.

Final recency is the original validation-selected blended 5/10/20/season process framework. Last5/10/20/season windows are actual current-season game-level observations; win record is diagnostic only. Separate goalies use longer observed-history GSAx/60, shrink using 600 minutes of neutral prior and bound impact at ±0.65 goals/60. Last5/10 and danger/save metrics remain research/diagnostics. Source/time-labeled unknown starters use recent observed workload weights; this is not a current-roster or starter confirmation. Hypothetical selections remain clearly hypothetical. Confirmed-input architecture requires pre-cutoff evidence, but no feed supplies confirmations.

Scoring remains independent Poisson, selected against negative-binomial variants on validation. NB variance/sampling is correct. OT probability means tied after regulation; all ties resolve through a scoring-rate-based conditional OT winner mixed with neutral shootout probability learned on training. The winning score increments by one. It is a simplified conditional extra-time model, not a full three-on-three simulation. Home factor and shootout fraction are learned on 2023–24 training; a 5% schedule-derived back-to-back penalty remains a heuristic. Arbitrary UI matchups do not invent rest.

Protocol: training is 2023–24. Original 2024–25 validation selected blended/Poisson; this audit uses that validation season chronologically: first 874 games for four component-candidate selection, final 438 for confirmation. Changes must improve late-validation log loss by >0.001 and Brier by >0.0005. The chosen combined variant met that gate. `audit-decision.json` was written before computing new holdout results. Serving evaluation now honors that frozen configuration instead of silently reselecting.

**2025–26 is a previously reported holdout, not pristine.** Its outcomes were not used to choose these settings, but it cannot be described as an untouched newly discovered test. The 43-game 2026 sample was evaluated only after the decision froze; it is too small for reliable independent season validation. Future dates should be archived prospectively with source hashes, publication times, starter evidence and frozen predictions. No available completed normalized season remains fully untouched.

## Why complexity did not consistently beat xG

The evidence supports noisy recent goalie and finishing adjustments on validation, not a universal causal explanation for the holdout gap. The final combined variant generalizes worse to the reported holdout. Season shifts, correlated features and sampling uncertainty remain plausible; exact causal attribution cannot be established from a two-season retrospective study. More complexity did not reliably improve probability quality.

| Validation ablation | Brier | Log loss |
|---|---:|---:|
| stock | 0.236639 | 0.665658 |
| no-goalie | 0.236275 | 0.664836 |
| half-goalie | 0.236018 | 0.664321 |
| double-goalie | 0.240512 | 0.674296 |
| goalie:multiseason | 0.235155 | 0.662543 |
| no-finishing | 0.235499 | 0.663125 |
| no-special | 0.238791 | 0.670212 |
| no-home | 0.239472 | 0.671801 |
| no-rest | 0.237594 | 0.667748 |
| prior:0 | 0.237801 | 0.667941 |
| no-score-adjustment | 0.236508 | 0.665426 |
| no-opponent-suppression | 0.241046 | 0.674922 |

Special teams, home ice, schedule rest, opponent suppression and previous-season priors help this validation comparison. Eliminating priors hurts early-season log loss (0.671315 versus 0.663160). Doubling goalie influence hurts. Removing all goalie information also modestly helps versus original recent-heavy weighting; stable multi-season quality helps more on validation. This evidence motivates reducing noise, not pretending goalie performance has no predictive value.

Raw additional recent finishing, goal-differential and goalie-GSAx logit signals with coefficient +0.5 hurt validation (log losses 0.672196, 0.692750, 0.680385). Recent xG% and shot-share additions barely change performance; high-danger additions do not help. Those signals overlap with xG and already-modeled process. Unfitted raw special-team additions are severely noisy and scale-sensitive; this does **not** show that special teams lack signal. Results-based hot streaks are not automatically treated as quality.

SOS diagnostic using prior-to-cutoff opponents’ current strength, with fixed adjustment powers 0/.5/1, gives validation log losses 0.665658, 0.665576, 0.665711. Changes are too small for adoption. League/exposure normalization and reciprocity checks passed; no column-name or arithmetic normalization error explains the gap.

## Recency evidence

| Full-model process recency | Validation Brier | Validation log loss |
|---|---:|---:|
| season-only | 0.237481 | 0.667484 |
| last-20 | 0.236971 | 0.666332 |
| last-10 | 0.237778 | 0.667954 |
| last-5 | 0.238112 | 0.668273 |
| blended | 0.236639 | 0.665658 |
| exponential-games | 0.236896 | 0.666229 |
| exponential-days | 0.236823 | 0.666101 |

Pure last5/10 is noisier than blended process. Exponential-game half-life is 10 games; day half-life is 30 days. Those are fixed study candidates, not optimized truths. A separate process-only xG-share baseline tests all seven approaches. Its validation-selected choice is blended. On holdout, exponential variants happen to score slightly better, but the baseline choice was **not changed using that information**. All candidate baseline results are preserved in audit-summary.json.

## Goalie evidence

| Goalie approach | Validation Brier | Validation log loss |
|---|---:|---:|
| season | 0.236836 | 0.665973 |
| multiseason | 0.235155 | 0.662543 |
| last5 | 0.239538 | 0.671688 |
| last10 | 0.238647 | 0.669813 |
| exponential | 0.236996 | 0.666325 |
| save-above-expected | 0.235200 | 0.662641 |
| raw-gsax | 0.235198 | 0.662628 |
| workload-rest | 0.235155 | 0.662543 |
| prior18000 | 0.235203 | 0.662646 |
| prior72000 | 0.235162 | 0.662546 |
| prior144000 | 0.235250 | 0.662717 |

All goalie comparisons keep the same source/time-labeled workload mixture; they do not infer the actual winning/starting goalie from the target outcome. GSAx totals are converted to per-game exposure when tested, avoiding arbitrary cumulative-total scaling. Save-above-expected is converted using a fixed 30-shot reference. Multi-season history here means only available normalized seasons, not full career longevity. Season-only and recent5/10 quality are noisier. Regression is necessary. The tested rest heuristic did not change predictions under the next-day-noon availability rule; its equality to multi-season is **no evidence of goalie-rest usefulness**. No reliable goalie fatigue model is deployed.

## Calibration and final comparison

Buckets below use each game’s **predicted favorite** (one observation per game), preventing asymmetric home-only buckets. Final probabilities remain uncalibrated: a symmetric temperature candidate fitted only on early validation worsened late-validation Brier/log loss. No calibration is silently fitted on holdout.

| Favorite probability | Games | Mean predicted | Actual win rate |
|---|---:|---:|---:|
| 50%–55% | 516 | 52.44% | 49.22% |
| 55%–60% | 390 | 57.47% | 54.36% |
| 60%–65% | 239 | 62.08% | 55.23% |
| 65%–70% | 116 | 67.13% | 63.79% |
| 70%–100% | 51 | 73.09% | 72.55% |

Favorite buckets show moderate holdout overconfidence through 50–70%, strongest in the 60–65% bucket (62.1% predicted versus 55.2% realized); 70%+ is close but small (51 games). The late-validation period instead showed underconfidence in several buckets, illustrating a cross-season calibration shift. This is a likely contributor to the probability-quality gap, not evidence for fitting the holdout.

Generalized logistic calibration with a fitted intercept improved the original model’s diagnostic late-validation metrics, but it was not adopted for arbitrary neutral matchups: an unconditional intercept breaks team-exchange symmetry and does not correspond to the scoring distribution. The predeclared serving calibration study therefore uses symmetric temperature only. Its final fitted slope 0.975 changes late-validation Brier from 0.226794 to 0.227032 and log loss from 0.645040 to 0.645594, failing the adoption gate. A future home-aware, coherent outcome calibration could be studied on new validation seasons.

| Previously reported 2025–26 holdout | Games | Accuracy | Brier | Log loss |
|---|---:|---:|---:|---:|
| 50/50 | 1312 | 52.21% | 0.250000 | 0.693147 |
| Home-team training baseline | 1312 | 52.21% | 0.249932 | 0.693015 |
| Season-record baseline | 1312 | 53.73% | 0.248243 | 0.689624 |
| Season xG% baseline | 1312 | 55.34% | 0.245244 | 0.683541 |
| Simple xG strength baseline | 1312 | 55.72% | 0.245595 | 0.684283 |
| Validation-selected blended xG recency baseline | 1312 | 54.50% | 0.245201 | 0.683431 |
| Original NHL V1 uncalibrated | 1312 | 55.87% | 0.246301 | 0.685783 |
| Final audited NHL V1 uncalibrated | 1312 | 54.04% | 0.247096 | 0.687243 |
| Final calibrated model | — | — | — | Not adopted: failed validation |

The 50/50 baseline accuracy uses the evaluation’s deterministic `p >= 0.5` tie-break toward the home side; it is not a claim that a random coin predicts 52.2% in expectation.

Final-minus-original holdout log-loss difference is 0.001461; descriptive paired day-cluster bootstrap 95% interval is [-0.003617, 0.006438]. Do not infer definitive superiority from small differences. The final model remains worse than simple xG on both probability scores. All baselines are visible.

Reserved 2026 sample (43 games): original Brier 0.226888, log loss 0.644455; final Brier 0.226358, log loss 0.643729. This tiny result does not erase the full-season holdout weakness.

## Simulation and leakage audit

All 992 distinct directed current-team pairings have expected goals in [2.213, 4.551]. Six team/distribution cases each ran 100 independent 10,000-trial repetitions (6 million trials). Monte Carlo mean probabilities and SD agree with analytical/binomial expectations; sampled Poisson mean/variance are 2.99269/2.99191 versus 3/3, and NB 2.99349/3.45003 versus 3/3.45. Analytical probabilities now eliminate repeated-run prediction noise without deleting the simulation.

Historical OT frequency and predicted tied-regulation probability: validation predicted 16.03% versus actual 20.66%; holdout predicted 16.19% versus actual 24.85%. These remain approximate rather than explicitly calibrated tie probabilities. Regulation A + regulation B + OT sum to one; full-game A+B sum to one; each full-game win probability includes its regulation wins plus conditional extra-time wins. Score means add exactly one goal to the extra-time winner. Home advantage and stronger goalies move probabilities in the correct directions; no impossible scores or probabilities were observed.

Ten seeded-random historical games across validation and holdout were traced. Their team windows, last10 game IDs and goalie candidates use only pre-cutoff eligible observations; the target game and later games are excluded. Raw source CSV rows for those target/recent IDs were independently matched to normalized dates, xGF, xGA and TOI. Future-observation poisoning tests also pass. Current season skater summaries never enter historical features; winning-goalie outcome fields are not predictive inputs.

**Unavoidable leakage limits:** archived MoneyPuck file versions and publication times are unavailable. Files may be revised after games. Availability assumes next-day noon UTC and may precede actual publication. Goalie-ID coverage is enumerated from retrospectively retrieved season summaries, introducing coverage-selection bias; current identities/ARI→UTA franchise mapping are retrospective. These results are not certified pregame records. The league prior includes only eligible prior/current-season games. No future outcome is used to tune this frozen model.

## Product, source rights and timestamps

Chromium serves the repository at a GitHub project subpath. Desktop/mobile, 32 selectable teams, 64 directed/reversed matchups, home toggle, repeat stability, both navigation directions, hypothetical goalies, missing-goalie fallback and failed-snapshot disabling are checked. All expanded tables stay within a scrollable mobile container; no page overflow. FULL GAME WIN %, REGULATION WIN % and OVERTIME % are explicitly labeled. Why statements derive from actual selected inputs; no fabricated injuries or starters.

MoneyPuck terms were retrieved again from https://moneypuck.com/data.htm: free non-commercial and journalist ad-hoc use, clear MoneyPuck.com credit required; other purposes require inquiry/permission. Commercial monetization needs explicit appropriate permission/license, including derived-data distribution. The UI clearly labels non-commercial prototype use and attribution. NHL public schedules supply outcomes/identity, not licensed proprietary grades. No PFF data, keys, private information, raw CSV archives or cache/temp artifacts are shipped.

Data through remains **2026-10-05**. Source retrieval range remains 2026-10-06T23:43:05.727313Z–2026-10-06T23:52:41.962964Z (UTC provenance). Model built is 2026-10-07T00:07:58.171Z (UTC), advanced only because the model changed. UI localizes secondary timestamp displays. Snapshot/provenance match; rebuilding did not invent newer game coverage.

## NFL regression and exact files

Existing NFL model, ratings, data, ingestion, backtest, JS, stylesheet and tests match the protected original hashes. Existing NFL browser tests pass, including timestamps and results. The only tracked original file changed is index.html: intentional NHL navigation plus empty inline favicon declaration to prevent a browser console 404. NFL simulation outputs and data are unchanged.

Relative to the prior NHL prototype, exact modified files are `index.html`, `nhl.html`, `js/nhl/app.js`, `js/nhl/model.js`, `scripts/nhl/evaluate.js`, `scripts/nhl/build_snapshot.js`, `data/nhl/config.json`, `data/nhl/evaluation.json`, `data/nhl/snapshot.json`, `data/nhl/provenance.json`, `tests/nhl.test.js`, `tests/test_nhl_browser.py`, and `docs/NHL_V1.md`. New audit files are the four `audit_*.js` scripts, three `audit-*.json` files, and this report.

Complete branch inventory follows (one existing file modified; the rest added). Relative to the prior NHL prototype, this audit changed model/app/HTML, frozen evaluation/snapshot/provenance, expanded tests/documentation and added audit scripts/metadata. History and player observations remain unchanged.

- Modified: `index.html`
- Added: `data/nhl/audit-decision.json`
- Added: `data/nhl/audit-protocol.json`
- Added: `data/nhl/audit-summary.json`
- Added: `data/nhl/config.json`
- Added: `data/nhl/evaluation.json`
- Added: `data/nhl/history.json.gz`
- Added: `data/nhl/players.json`
- Added: `data/nhl/provenance.json`
- Added: `data/nhl/snapshot.json`
- Added: `docs/NHL_FINAL_AUDIT.md`
- Added: `docs/NHL_V1.md`
- Added: `js/nhl/app.js`
- Added: `js/nhl/model.js`
- Added: `js/shared/statistics.js`
- Added: `nhl.css`
- Added: `nhl.html`
- Added: `scripts/nhl/audit_baselines.js`
- Added: `scripts/nhl/audit_followup.js`
- Added: `scripts/nhl/audit_model.js`
- Added: `scripts/nhl/audit_simulation.js`
- Added: `scripts/nhl/build_data.py`
- Added: `scripts/nhl/build_snapshot.js`
- Added: `scripts/nhl/evaluate.js`
- Added: `scripts/nhl/moneypuck.py`
- Added: `tests/nhl.test.js`
- Added: `tests/test_nhl_browser.py`
- Added: `tests/test_nhl_ingestion.py`

## Exact verification commands and remaining weaknesses

Executed: `node scripts/nhl/evaluate.js` (original reproduction, then frozen final evaluation); `node scripts/nhl/audit_model.js`; `node scripts/nhl/audit_followup.js`; `node scripts/nhl/audit_baselines.js`; `node scripts/nhl/build_snapshot.js`; `node scripts/nhl/audit_simulation.js`; `npm test`; `python3 -m unittest discover -s tests -v`; source-cache hash/CSV reciprocity/raw-trace checks; NFL protected-file hash checks; credential/artifact scan; `git diff --check`.

Final test evidence is 23 Node tests and 26 distinct Python tests, all passed after the favicon correction. Initial strict browser run failed for favicon 404; it was fixed rather than suppressed. Auxiliary research outputs are in /tmp, compact audit evidence is in data/nhl/audit-summary.json. Audit scripts regenerate their default /tmp output folder and never publish serving code.

Blocking next step: compare correlated scoring or explicit regulation-draw calibration on training/validation with coherent joint outcomes and Monte Carlo agreement; freeze all choices before a future independent test. Do not choose a correction merely to match the reported holdout. Baseline inferiority alone is not the blocker; the substantial repeated OT underprediction is.

Weaknesses: retrospective files; no confirmed starter/lineup/injury/travel feed; stale traded-goalie workload possibilities; only two completed evaluation seasons; multiple validation comparisons; no independent full-season unused test; no calibrated serving probabilities; independent scoring and approximate OT; unfit rest/shrinkage coefficients; model not better than xG baselines. Next priorities are prospective archives/predictions, a fresh completed validation/test season, roster/starter evidence, nested temporal regularization and home-aware coherent calibration, and data rights review before monetization.

NO-GO
