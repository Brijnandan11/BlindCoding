# Release verification

The production configuration uses Supabase PostgreSQL, Redis caching/BullMQ and a separate Docker/GCC judge. The backend uses Next.js route handlers.

## Recorded evidence

- The isolated PostgreSQL **500-user API test passed**: 48,301 requests, zero unexpected failures, 31,320 successful draft saves and 500 stored final submissions; overall p95 latency was 232 ms.
- All 500 submitted programs were evaluated in fresh Docker sandboxes and produced the expected 100/100 result. Zero judge jobs failed. Final PostgreSQL readback confirmed the counts.
- Early leaderboard access, exact draft restoration, duplicate final submission rejection and source refusal were checked under load.
- The judge host was a saturated rotational disk. Queue completion took approximately 47 minutes, with profiling and image-build interference. A dedicated SSD judge deployment still needs its own throughput verification.
- Earlier browser checks verified desktop/mobile layout, a pure-black outage viewport, and the leaderboard waiting page's automatic release. The full newly-added PostgreSQL browser-journey command has not been run in this revision.
- The optional compact sandbox image passed compilation/output, timeout, non-root, network isolation and invalid-compilation checks.

## Final code checks

Final checks completed successfully: **TypeScript passes, all 25 regression tests pass, and the production Next.js build passes.** The suite includes SDK lowercase-method retries, durable batching, compression/backward compatibility, database identifier validation, cross-host cache namespaces, exact timer boundaries, ranking and bounded request-body reading.

Final code also separates draft and final-submission locks so a background save cannot reject a legitimate submit shortcut, and limits chunked bodies while reading them. Those corrections were added after the recorded 500-user run and are not presented as a second load-test pass.

See [LOAD_TEST_RESULTS.md](LOAD_TEST_RESULTS.md) for exact scope and [DEPLOYMENT.md](DEPLOYMENT.md) for Vercel/Render/Supabase configuration. No cloud deployment or paid resource creation was performed.
