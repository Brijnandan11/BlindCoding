# Capacity test results — 27 October 2026

## PostgreSQL configuration: 500-user API pass

The primary database was changed to PostgreSQL after the Appwrite path failed. The new local production-server test used isolated PostgreSQL 16, Redis/BullMQ and real Docker/GCC judging.

| Measurement | Result |
| --- | ---: |
| Simultaneous virtual participants | 500 |
| API requests | 48,301 |
| Unexpected failed requests | 0 |
| Successful draft saves | 31,320 |
| Final submissions stored durably | 500 / 500 |
| Overall p95 API latency | 232 ms |
| Login p95 | 169 ms |
| Attempt-resume p95 | 68 ms |
| Draft API p95 | 251 ms |
| Submission API p95 | 299 ms |
| Completed judge jobs | 500 / 500 |
| Expected scores reproduced | 500 / 500 |
| Failed judge jobs | 0 |

The API workload ran approximately two minutes of 4.4 KB draft autosaves every two seconds and state polling every five seconds, followed by a 30-second submission window. It checked exact draft restoration, source refusal during coding, one final submission and leaderboard locking until the stored deadline. Expected 403/409 validation responses are successful security checks, not unexpected errors.

**Judge throughput limitation:** all 500 programs were evaluated in fresh sandboxes and received the expected 100/100 test score, but the local rotational-disk host was heavily I/O saturated. Queue wall time was approximately **47 minutes**. A cleanup coordinator was held during profiling; judges continued running, additional workers were introduced, and an image build added I/O load. This is functional scoring evidence, not a controlled fast-judging benchmark. Use a dedicated SSD-backed judge host and verify its drain time before the event. Do not claim the local HDD setup is suitable for timely event scoring.

The API benchmark is a local production-build capacity check, not a Vercel/Render cloud deployment certification or a full 20-minute endurance test. The final autosave/submission-race correction and bounded-body reader were added afterward; regression/build checks cover those changes, but the 500-user measurements above belong to the recorded benchmark revision.

Raw evidence: `artifacts/load-tests/20261027134913/`, including `k6-500.json`, `report.json`, `judge-status.json`, `judging-timings.json` and the diagnostic hold record. Final database readback recorded 500 results, zero errors and 500 perfect test scores. The temporary PostgreSQL and Redis containers were removed. Appwrite records were not modified or migrated.

The compact optional image also passed real GCC output, infinite-loop timeout, non-root identity, unavailable external network and compilation-failure checks. It is not a proven throughput improvement and is not the default image.

## Historical Appwrite results



The legacy Appwrite configuration failed the 500-user capacity test; it is not the recommended production store.

These tests used a local production Next.js server, the configured cloud Appwrite project, a private temporary table, dedicated local Redis, and the Docker judge worker. Existing contest records were not modified. This is not a deployed Vercel/Render benchmark or a 20-minute endurance test.

| Measurement | 100 users | 500 users |
| --- | ---: | ---: |
| API requests | 621 | 911 |
| p95 API latency | 20.66 s | 29.71 s |
| Failed API requests | 61.84% | 54.88% |
| Successful participant logins | 71 / 100 | 411 / 500 |
| Successful attempt resumes | 60 / 71 | 0 / 411 |
| Successful draft saves | 4 | Not reached |
| Accepted final submission requests | 0 / 60 | Not reached |
| Capacity thresholds | Failed | Failed |

Thresholds were p95 latency below 1.5 seconds, fewer than 1% failed requests, and more than 99% successful contest checks. At 500 users, a single-user login before the load took 811 ms. During load, requests hit upstream aborts and the 30-second client timeout.

The intended workload saves approximately 4.4 KB of source every two seconds, polls state every five seconds, then submits within a 30-second window. Attempts are prepared in the coding phase with the normal 15-minute server deadline. The 500-user run failed during login/resume, so it provides no evidence about sustained 500-user autosaving, the final submission burst, or judge throughput. Its lower overall error percentage than the 100-user run is not an improvement: it stopped earlier in the participant journey.

Fixture provisioning/readback also encountered Appwrite connection resets. The 100-user post-load browser check timed out, and the 500-user post-load database readback encountered a connection reset. These are recorded as verification errors, not passes. Both runs' generated temporary tables and Redis instances were deleted. The configured Appwrite plan also refused an additional database because its database-count limit had been reached; using a private temporary table allowed testing without replacing the event database.

Raw summaries and diagnostics are saved locally under:

- `artifacts/load-tests/20261027124322/` — 100 users
- `artifacts/load-tests/20261027125033/` — 500 users

Those directories are ignored by Git and excluded from the Docker build context. They contain synthetic fixture codes and should not be published as deployment assets.

Before another event-capacity claim, investigate the Appwrite request aborts and connection pool saturation, reduce repeated remote reads in authenticated state/resume requests, and measure the backend from the intended hosting region. Repeat the full user journey under load after changes. Database storage capacity alone does not establish request throughput.

## Separate three-user functional check

A small isolated run accepted and persisted 3/3 final submissions. All functional k6 checks passed, including source refusal during coding, draft persistence, and no leaderboard rows for early submitters. A direct API check confirmed rankings unlock only after the stored coding deadline. The three judge jobs completed without failed jobs. This run still missed the 1.5-second latency target (p95 1.94 seconds); it is functional evidence, not a capacity pass. Its test table and Redis instance were deleted. Raw results: `artifacts/load-tests/20261027125427/`.

A separate Chromium UI check with mocked API responses passes for hiding rows while locked and automatically showing released rankings without a manual refresh (`node scripts/verify-leaderboard.mjs`). The live three-user test supplies independent evidence for the server deadline gate.
