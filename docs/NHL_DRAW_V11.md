# MisterMatchup NHL V1.1 — regulation draw / OT model fix

**GO FOR DEPLOYMENT for the existing clearly labeled non-commercial experimental prototype. No push, merge or deployment performed.** The model corrects a demonstrated score-distribution misspecification with a training-fitted joint-score calibration that improves validation and the single frozen holdout evaluation. It still underpredicts the unusually high holdout draw rate by 3.8 percentage points and is not a certified pregame/betting model. No parameter was changed after viewing this holdout.

## Frozen scope and evaluation policy

All previous team-strength decisions stay frozen: blended recency, no recent-goalie boost, no finishing multiplier, 5v5 offense/defense, special teams, opponent suppression, shrinkage, home factor, rest heuristic and source/goalie architecture. Only regulation-score distribution, its exact/sampling integration, score-mean reporting, precise OT labels and necessary evaluation/snapshot/test plumbing changed. NFL, player data, injuries, lineups and site layout did not change.

Training: 2023–24 (1,312 games). Validation: 2024–25 (1,312). Decision frozen at `2026-10-07T02:14:41.557Z` UTC; the 2025–26 holdout was then evaluated **once**, at `2026-10-07T02:15:32.850Z` UTC. The evaluator refuses a second pass. That season was known from earlier audits, so this is not a pristine newly discovered test; no draw candidate selection used its outcomes. The model and decision were not retuned afterward. Existing source revisions/assumed next-day-noon availability remain retrospective limitations.

## Root cause and mathematical checks

The existing independent-Poisson PMF, regulation/full-game formulas and simulation were mathematically correct. Direct PMF-product equality, tie-sum equality, normalization and Monte Carlo tests pass. Completed-game regulation labels correctly subtract the extra-time deciding goal from OT/SO final results. There is no analytical/simulation implementation error explaining the shortfall.

The score distribution underallocates diagonal mass, particularly 1–1, 2–2 and 3–3. NHL tied-regulation outcomes are more common than this independent-Poisson joint distribution permits given frozen goal rates. This is a statistical misspecification, not proof of one specific hockey mechanism. Tactical late-game state dependence and regulation-draw persistence are plausible but not measured causally here.

| Diagnostic | Training | Validation |
|---|---:|---:|
| Home/away goal correlation | -0.1172 | -0.0895 |
| Residual goal correlation after frozen rates | -0.0809 | -0.0589 |
| Frozen independent-Poisson draw rate | 15.96% | 16.03% |
| Diagnostic equalized rates, same total | 16.44% | 16.63% |
| Diagnostic neutralized home factor | 16.02% | 16.10% |

Equalizing the rates can only raise validation ties to 16.6%; removing the home adjustment raises them to 16.1%. Neither explains observed 20.7%, so no team-strength/home tuning was warranted. Regulation goal variance is near its mean (training home 3.113 versus mean 3.115; away 3.073 versus mean 2.903). Positive shared-goal components can mechanically raise ties but contradict the fitted dependence and worsen score likelihood. Residual correlation is also mildly negative, so missing positive covariance is not the primary supported explanation.

Frozen rate totals slightly overestimate observed regulation totals: training 6.183 versus 6.018; validation 6.046 versus 5.874. Historical all-situation source exposure includes extra time in 272/271 games, and its residual can carry some extra-time creation into the forecast. Exact period-separated historical xG is unavailable in the normalized inputs; this remains a modest input/period limitation. Team-strength creation and exposure were left unchanged as instructed. The new score distribution reports its actual calibrated regulation means rather than incorrectly labeling the original rate inputs as unchanged distribution means.

## Models tested and training results

Twenty-seven parameterized score models across seven families were tested. Parameters were fit on training joint-score likelihood, except draw-logit coefficients whose offset binary-draw likelihood is mathematically equivalent to the joint-score likelihood contribution of the diagonal tilt. A fixed ridge penalty of 5 was used for additional slope coefficients. Validation selection prioritized draw log loss, with guards limiting winner-log-loss deterioration to 0.005 and joint-score-loss deterioration to 0.01 versus Poisson. Aggregate draw rate alone was not a selection criterion.

| Family (training-fitted) | Predicted ties | Observed ties | Draw Brier | Winner Brier | Winner log loss | Accuracy | Score log loss |
|---|---:|---:|---:|---:|---:|---:|---:|
| independent-poisson | 15.96% | 20.73% | 0.166518 | 0.238932 | 0.670327 | 58.08% | 3.875929 |
| bivariate-poisson | 15.96% | 20.73% | 0.166518 | 0.238932 | 0.670327 | 58.08% | 3.875929 |
| dixon-coles | 16.29% | 20.73% | 0.166210 | 0.238933 | 0.670328 | 58.08% | 3.875117 |
| negative-binomial | 15.87% | 20.73% | 0.166599 | 0.238935 | 0.670338 | 58.08% | 3.875955 |
| shared-gamma | 16.00% | 20.73% | 0.166485 | 0.238932 | 0.670328 | 58.08% | 3.877216 |
| draw-logit-intercept | 20.73% | 20.73% | 0.164247 | 0.238947 | 0.670380 | 58.08% | 3.868032 |
| draw-logit-inputs | 20.73% | 20.73% | 0.164207 | 0.238949 | 0.670386 | 58.08% | 3.867882 |

Independent Poisson: baseline. Bivariate Poisson: shared fraction 0/.1/.2/.3/.4/.5; training chooses zero. Dixon–Coles: rho −.12/−.08/−.04/−.02/0/.02; best −.08, with insufficient effect because NHL draws commonly occur above 1–1. Independent NB: dispersion 5/10/20/50/96.24/200; best 200, near Poisson. Shared-gamma pace mixture: shapes 5/10/20/50/100/200; best 200, near independence. Draw-logit: constant offset or three coefficients (intercept, absolute goal differential, expected total). More elaborate slopes do not validate better.

## Validation and selection

| Family | Predicted ties | Observed ties | Draw Brier | Draw log loss | Winner Brier | Winner log loss | Accuracy | Score log loss |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| independent-poisson | 16.03% | 20.66% | 0.166249 | 0.517686 | 0.233909 | 0.659810 | 59.22% | 3.864637 |
| bivariate-poisson | 16.03% | 20.66% | 0.166249 | 0.517686 | 0.233909 | 0.659810 | 59.22% | 3.864637 |
| dixon-coles | 16.39% | 20.66% | 0.165963 | 0.516615 | 0.233906 | 0.659801 | 59.22% | 3.862084 |
| negative-binomial | 15.95% | 20.66% | 0.166321 | 0.517958 | 0.233929 | 0.659862 | 59.22% | 3.864463 |
| shared-gamma | 16.07% | 20.66% | 0.166216 | 0.517563 | 0.233911 | 0.659815 | 59.22% | 3.865394 |
| draw-logit-intercept | 20.82% | 20.66% | 0.164197 | 0.510294 | 0.234016 | 0.660081 | 59.22% | 3.857245 |
| draw-logit-inputs | 21.03% | 20.66% | 0.164255 | 0.510425 | 0.234043 | 0.660149 | 59.22% | 3.857376 |

**Selected: diagonal-inflated Poisson via one learned draw-logit offset.** It improves per-game draw Brier/log loss and joint-score fit on validation; winner metrics degrade only negligibly within the predeclared guard. Additional calibration slopes overfit relative to the simple model. Coefficients are not selected to match the reported holdout.

Let P(i,j) be the normalized frozen-rate independent-Poisson score probability; pD its diagonal sum. Training learns theta = **0.320241362** (odds multiplier **1.377460**). The calibrated draw probability is `qD = logistic(logit(pD) + theta)`. Each diagonal score becomes `Q(i,i) = P(i,i) qD/pD`; each off-diagonal score becomes `Q(i,j) = P(i,j) (1-qD)/(1-pD)`. All probabilities stay nonnegative and sum to one. Equivalently, Q is P tilted by `exp(theta * I(i=j))` with a per-matchup normalizer. This is maximum-likelihood event calibration, **not an arbitrary fixed percentage addition**. Its percentage-point adjustment varies with pregame goal rates.

Score matrix support is 0–40 goals per team, renormalized for numerical evaluation; beyond this support probability is zero. Serving omitted tail is below 1e−9 over all 992 directed team pairs, effectively zero at current rates. The full finite distribution, its moments and the sampling CDF are shared by analytics and simulation.

## Which games draw, correlation and matchup-type evidence

The calibration preserves independent-Poisson game ordering. Validation draw AUC is **0.4924** (training 0.5294); no claim of improved ranking/discrimination is made. Probability calibration improves proper draw scores but does not reveal a reliable new feature for picking specific OT games. Additional expected-total/parity slopes did not improve validation. A training-frequency constant draw baseline is reported below rather than hidden. Conditional draw discrimination remains weak.

| Validation expected differential | Games | Predicted ties | Actual ties |
|---|---:|---:|---:|
| 0–0.25 | 370 | 21.67% | 19.46% |
| 0.25–0.5 | 287 | 21.38% | 21.95% |
| 0.5–1 | 431 | 20.78% | 20.88% |
| 1–∞ | 224 | 18.77% | 20.54% |

| Validation expected total | Games | Predicted ties | Actual ties |
|---|---:|---:|---:|
| 0–5.5 | 130 | 22.40% | 16.92% |
| 5.5–6 | 488 | 21.37% | 22.34% |
| 6–6.5 | 509 | 20.43% | 19.84% |
| 6.5–7 | 169 | 19.39% | 21.30% |
| 7–∞ | 16 | 18.84% | 18.75% |

Observed parity/total patterns are noisy and not reliably monotonic. Stronger assumptions were not adopted. `draw-summary.json` also reports favorite-probability bins, home-favored/away-favored/neutral games, both seasons and actual-shot/xG pace groups. Home and away share the same draw event, so their unconditional draw rate is necessarily identical; venue groups must be interpreted as favorite side or neutral venue. Actual-shot/xG groups are descriptive postgame diagnostics, never pregame features. Conditioning on a total can itself induce negative correlation; these groups do not establish causality or justify a shared component.

## Conditional overtime and full-game probabilities

Retained the existing rate-based sudden-death proxy mixed with training shootout fraction. It has evidence versus neutral: among 271 actual validation extra-time games, conditional-winner Brier 0.243605 versus 0.250000 and log loss 0.680258 versus 0.693147. That satisfies the predeclared gain thresholds. This is not a confirmed team-specific OT/lineup model, but replacing it with neutral would discard the validated advantage.

`regulationA + qD + regulationB = 1`; `fullGameA = regulationA + qD * conditionalOT_A`, with the equivalent expression for B. OT probability means tied after 60 minutes, not a team’s chance of winning in OT. Every sampled tie resolves to a winner, adding one final-score goal. Full-game analytical score means include the calibrated regulation means plus that expected increment.

## Single frozen holdout result

| 2025–26, 1,312 games | Previous audited | NHL V1.1 |
|---|---:|---:|
| Predicted ties | 16.19% | 21.02% |
| Observed ties | 24.85% | 24.85% |
| Draw Brier | 0.194055 | 0.188016 |
| Draw log loss | 0.584640 | 0.564387 |
| Winner accuracy | 54.04% | 54.04% |
| Winner Brier | 0.247096 | 0.246867 |
| Winner log loss | 0.687243 | 0.686758 |
| Regulation score log loss | 3.836861 | 3.816607 |

Tie underprediction falls from 8.66 to **3.83 percentage points**; proper draw and score losses improve on both validation and holdout. Holdout draw AUC is 0.5209, still weak. A training-frequency constant-draw baseline has validation Brier 0.163891, log loss 0.509358; holdout Brier 0.188430, log loss 0.565581. It is slightly better on validation and slightly worse on holdout; these observations did not trigger another tuning pass.

The holdout observed rate shifted from about 20.7% in training/validation to 24.8%. The model does not manufacture that shift from future outcomes. Winner accuracy remains 54.0%; the full-game model still does not beat simple-xG baselines from the previous audit. No new full-game calibration or unrelated ratings were fitted. Residual bias is a monitoring limitation, not a concealed perfect calibration claim.

## Score sanity and analytical / Monte Carlo agreement

| Scenario | Teams | Calibrated regulation means | Tie % | 0–0 | 1–1 | 2–2 | 3–3 | 4–4 |
|---|---|---|---:|---:|---:|---:|---:|---:|
| even | DET/EDM | 3.210/3.210 | 20.84% | 0.21% | 2.13% | 5.55% | 6.42% | 4.17% |
| favorite | COL/VAN | 4.488/2.334 | 14.51% | 0.14% | 1.46% | 3.83% | 4.47% | 2.93% |
| high-total | PIT/VAN | 4.178/2.785 | 17.48% | 0.12% | 1.41% | 4.11% | 5.34% | 3.91% |
| low-total | STL/NYR | 2.609/2.768 | 22.69% | 0.58% | 4.22% | 7.72% | 6.27% | 2.86% |
| strong-goalie | CAR/NYR | 3.173/2.660 | 21.37% | 0.37% | 3.14% | 6.68% | 6.33% | 3.38% |
| weak-goalie | CAR/NYR | 3.597/2.671 | 19.73% | 0.24% | 2.32% | 5.61% | 6.03% | 3.65% |

Six representative scenarios each run 10,000, 100,000 and 1,000,000 full-game simulations, plus 1,000,000 regulation-only samples to check cell probabilities and moments: **12.66 million trials**. Maximum probability error is 1.831 binomial standard errors, below the 6-SE guard. Score means, variances, covariance and 0–0 through 4–4 frequencies agree with the analytical matrix; detailed errors and moments are in draw-simulation.json. Probability and score displays remain analytical and stable across repeats.

All 992 directed current-team pairs are finite, normalized and coherent. Stronger goalie scenarios lower opponent scoring inputs/means; the home toggle has the expected effect. The calibrated matrix shifts goal means slightly (typically a few hundredths) and does not pretend to preserve the raw rate means; the UI now displays the true regulation distribution means. The high-score tail (either team ≥10) ranges about 0.10%–1.77% in the representative cases and is reduced by diagonal calibration for off-diagonal extremes, not inflated to generate more draws. Score dependence outside the diagonal is still approximate; the tilt does not fully reproduce the observed negative covariance.

## Tests, pipeline and precise changed files

Passed: 32 Node tests, 26 Python tests, Chromium desktop/mobile checks for all 32 teams and 64 reversed matchups, home toggle, repeated analytical stability, hypothetical/missing goalie behavior, missing snapshot, NFL↔NHL navigation, timestamps and relative GitHub Pages paths. No console/page errors, missing resources, NaN or mobile overflow. New score tests cover PMF products, every score family, positivity/normalization, symmetry, bivariate moments, Dixon–Coles validity, learned odds identity, frozen strengths and 100k sampling agreement.

Commands executed: `node scripts/nhl/draw_features.js`; `node scripts/nhl/select_draw_model.js`; `node scripts/nhl/evaluate_draw_holdout.js` (once); `node scripts/nhl/build_snapshot.js`; `node scripts/nhl/verify_draw_model.js`; `node scripts/nhl/report_draw_model.js`; `npm test`; `python3 -m unittest discover -s tests -v`; NHL JS syntax checks; frozen-input/NFL-file hashes; `git diff --check`. The legacy evaluation command now reports the frozen V1.1 workflow and cannot silently overwrite the serving configuration or rerun the holdout.

Source coverage/retrieval times remain unchanged; only model-built time advances. Static visitors fetch the compact snapshot, not draw histories/research datasets. All research temporary/cache files are outside Git. No credentials, private data, PFF material or new raw datasets are included. MoneyPuck attribution and non-commercial rights limitations remain; monetization requires permission/license review.

Files changed during this task (compared with the preceding audit state):
- Modified: `data/nhl/config.json`
- Added: `data/nhl/draw-decision.json`
- Added: `data/nhl/draw-holdout.json`
- Added: `data/nhl/draw-simulation.json`
- Added: `data/nhl/draw-summary.json`
- Modified: `data/nhl/provenance.json`
- Modified: `data/nhl/snapshot.json`
- Added: `docs/NHL_DRAW_V11.md`
- Modified: `docs/NHL_FINAL_AUDIT.md`
- Modified: `docs/NHL_V1.md`
- Modified: `js/nhl/app.js`
- Modified: `js/nhl/model.js`
- Added: `js/nhl/regulation.js`
- Modified: `nhl.html`
- Modified: `scripts/nhl/build_snapshot.js`
- Added: `scripts/nhl/draw_features.js`
- Modified: `scripts/nhl/evaluate.js`
- Added: `scripts/nhl/evaluate_draw_holdout.js`
- Added: `scripts/nhl/report_draw_model.js`
- Added: `scripts/nhl/select_draw_model.js`
- Added: `scripts/nhl/verify_draw_model.js`
- Added: `tests/nhl-draw.test.js`
- Modified: `tests/nhl.test.js`

No NFL files, normalized team/goalie history, player summaries, player architecture or team-strength formulas changed. The branch remains nhl-v1; main/HEAD and remote deployment are untouched.

## Limitations and next steps

Residual 3.8-point holdout tie underprediction; weak conditional draw discrimination; a simple draw baseline remains competitive; retrospective file/publication limitations; approximate off-diagonal score dependence; historical whole-game residual exposure; unconfirmed starters; previously examined holdout. Recommended next step is prospective dated prediction/source archiving and a new independent temporal validation/test season, then test regulation-only event exposure or richer joint game-state models without revisiting this holdout for tuning. Rights review precedes commercial deployment.

GO FOR DEPLOYMENT
