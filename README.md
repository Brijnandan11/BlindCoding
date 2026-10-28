# Blind Coding — Coding Club

An individual C-code memory contest: five minutes of read-only study, then fifteen minutes of invisible typing on a completely black viewport. Ctrl+Enter or F10 creates one final submission. Expired drafts receive no automatic submission. Accuracy determines ranking; completion time breaks ties. Each organizer-created team nominates exactly three participants.

The production configuration uses **Next.js/TypeScript, Supabase Postgres, Redis/BullMQ and a separate Docker/GCC judge**. The backend remains Next.js route handlers.

## Setup

```sh
npm ci
# Configure Supabase DATABASE_URL, REDIS_URL, STORE_NAMESPACE and ADMIN_PASSWORD.
npm run db:migrate
npm run dev
```

Copy settings from `.env.example` into a private environment file. For Supabase, copy the PostgreSQL pooler connection URI from Dashboard → Connect (Session mode for the persistent backend/judge). Keep the same `STORE_NAMESPACE` on backend and judge, even when they use different database URLs. Set a random admin password of at least 24 characters. No default admin password, demo account or automatic sample contest exists.

Sign in at `/admin`, save the official C source and weighted test cases in DRAFT, create real three-person teams, distribute codes privately, then open the contest. Source and test cases are locked after the first attempt starts.

## Deployment

[DEPLOYMENT.md](DEPLOYMENT.md) describes the Vercel frontend, Render backend, PostgreSQL/Redis settings and dedicated SSD-backed judge host. The frontend receives only the backend HTTPS origin and gateway secret. Database and admin credentials stay on the backend. Vercel and the Render web container do not execute submitted programs.

```sh
docker build -t blind-coding-sandbox judge
npm run judge
```

The judge requires Linux, Docker and the same database/Redis namespace. `JUDGE_CONCURRENCY` defaults to 2 and accepts 1–8. Use a dedicated SSD-backed host: local profiling found severe rotational-disk I/O stalls during fresh container creation. Adding API instances does not fix judge disk throughput.

## Storage, timing and reliability

A bounded PostgreSQL connection pool serves concurrent participants. Indexed record lookups and batched writes reduce database work. Redis caches shared records and leaderboard snapshots; an acknowledged draft waits for a durable PostgreSQL commit. Logout writes a revocation tombstone, and per-attempt locks serialize saves and submission. The database's unique record key enforces one final submission. Team creation inserts the three participants and team atomically on PostgreSQL.

PostgreSQL stores authoritative deadlines, attempts, drafts, final submissions and scores. Redis loss can be recovered from durable records; cache/queue outages can temporarily interrupt APIs without resetting deadlines. Source access is refused after study ends. The browser remains black when contest state is unavailable.

Early submission does not unlock rankings. The participant leaderboard releases at that participant's stored coding deadline and refreshes automatically. Anonymous rankings require the organizer to close the contest and every attempt's coding deadline to have ended. Admin monitoring and exports remain available. Live drafts are never returned to the admin interface.

Scoring: weighted functional tests contribute 50 points, C-token sequence similarity 30, and successful compilation 20. Token comparison ignores whitespace/comments; it is not an AST/semantic equivalence claim. Noncompiling partial code can earn structure credit. Organizers should approve the rubric and official test cases.

## Verification and capacity

```sh
npm test
npm run typecheck
npm run build
node scripts/verify-sandbox.cjs
node scripts/verify-leaderboard.mjs
npm run test:load
```

The default load suite provisions private, temporary PostgreSQL and Redis containers and starts a local production server plus Docker judges. It requires Docker, k6 and a built sandbox image. No production database is used. Metrics, synthetic codes and cleanup reports stay in ignored `artifacts/load-tests/` directories, excluded from Docker build context.

The PostgreSQL 500-user API test passed 48,301 requests with zero failures, 31,320 draft saves and 500 stored final submissions; p95 API latency was 232 ms. See [LOAD_TEST_RESULTS.md](LOAD_TEST_RESULTS.md) for judge completion, environment limits and historical failures. This local benchmark is not a Vercel/Render deployment certification or a full 20-minute endurance run. Repeat staging checks on the selected hosts before the event.

Use supervised fullscreen/kiosk machines. A website can black out its own viewport, but cannot hide OS chrome or prevent photographs and developer tools.
