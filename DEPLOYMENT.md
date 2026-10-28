# Vercel frontend + Render backend + PostgreSQL (Supabase supported)

The production contest path uses PostgreSQL and Redis. Next.js serves the frontend and existing route-handler backend. The Docker judge runs on a separate Linux host. No paid resource or external deployment was created automatically.

## 1. Supabase Postgres and Redis

Create a Supabase project and use its PostgreSQL connection string as `DATABASE_URL`. For the persistent Render API and judge workers, prefer Supabase's **Session pooler** connection string; use the **Transaction pooler** when deploying serverless processes. Copy the complete URI from Supabase Dashboard → Connect, preserve its SSL settings, and percent-encode special characters in the password. Never use a Supabase API key in `DATABASE_URL` or expose the database URL to the browser.

The schema uses regular PostgreSQL and does not require Supabase Auth, Data API access, or public table grants. The app connects with the database role, so keep the `records` table private and do not add `anon`/`authenticated` grants or disable RLS protections on other project tables. The setup command below creates the app table and index.

Provision Redis as a separate shared service. Supabase does not provide the Redis cache and queue required by this app. For a Render-hosted backend, keep services in a nearby region. The external judge uses the TLS-enabled Supabase pooler URL and the same Redis service.

Set a unique `STORE_NAMESPACE`, for example `blind-coding-2026-production`, identically on backend and judge. This makes cache invalidation work when their database hostnames differ. Keep staging in a different namespace and database. Keep `STORE_TABLE_ID=records` unless deliberately isolating a separate event.

`PG_POOL_MAX=10` caps database connections per Node process. Budget the sum of backend and judge pools against the database's actual connection limit. The 500-user run did not create one database connection per participant.

Redis must be reachable from both backend and judge and must not be public without authentication. Use TLS on public connections. PostgreSQL remains the durable source of truth for timers, drafts, submissions and scores.

## 2. Render backend

Create a Docker Web Service using repository-root context and the root `Dockerfile` (or set the Dockerfile path to `infra/Dockerfile.web`). Set:

- Health path: `/api/health` (process liveness, not dependency certification)
- Pre-deploy command: `node scripts/setup-postgres.mjs`
- `DATABASE_URL`: dedicated PostgreSQL internal connection URL
- `STORE_TABLE_ID=records`
- `STORE_NAMESPACE`: same event namespace as the judge
- `PG_POOL_MAX=10`
- `REDIS_URL`: shared Redis connection
- `ADMIN_PASSWORD`: at least 24 random characters
- `APP_URL`: exact Vercel frontend origin
- `BACKEND_API_SECRET`: a random secret shared only with Vercel (`openssl rand -hex 32`)
- `REQUIRE_GATEWAY=true`

Leave `BACKEND_URL` unset on Render. The container uses Render's `PORT` and binds to `0.0.0.0`. Configure an always-on service for the event and verify its resources under staging load.

The pre-deploy migration creates the private records table and indexes without deleting existing records. Run it before accepting participants. Database credentials must permit that schema setup; runtime can use a separate restricted read/write role afterward.

## 3. Vercel frontend

Import the repository root as a Next.js project. `vercel.json` configures installation/build commands. Set only:

- `BACKEND_URL`: exact Render HTTPS origin, without a path
- `BACKEND_API_SECRET`: same secret as Render
- `APP_URL`: exact frontend production origin

Do not put database, Redis or organizer credentials on the frontend. No setting above uses `NEXT_PUBLIC_`. The same-origin `/api/*` gateway forwards HttpOnly cookies to Render and Set-Cookie headers back to the browser. HTTPS, Secure cookies and SameSite=Strict remain enforced.

Use a separate backend/database for previews. Redeploy after configuration changes.

## 4. Dedicated judge host

Use a dedicated **SSD-backed Linux Docker host**, not the API/database host or an unprivileged Render web container. The local rotational-disk host was I/O saturated while creating sandboxes; the queue protects the API, but scoring throughput requires suitable judge storage and compute.

On the judge host:

```sh
npm ci
docker build -t blind-coding-sandbox judge
npm run judge
```

Configure `DATABASE_URL` (TLS-enabled external URL if outside Render), `STORE_TABLE_ID`, `STORE_NAMESPACE`, `REDIS_URL`, `JUDGE_IMAGE=blind-coding-sandbox`, `JUDGE_CONCURRENCY=4`, and a bounded `PG_POOL_MAX`. Run under a process supervisor with restart and graceful SIGTERM. Add hosts sharing the same database/Redis namespace when measured queue throughput requires it. Docker access must stay off the public API host.

Each program receives a fresh container with networking disabled, a read-only root, no capabilities, non-root execution, process/CPU/memory/output limits and temporary writable space. Expected outputs stay on the judge host. Do not reuse containers containing another participant's program. Run `node scripts/verify-sandbox.cjs` on the actual judge host.

## 5. Event acceptance

1. Verify organizer login, real three-person roster creation and the official C source/test cases in DRAFT.
2. Verify the complete browser → Vercel gateway → Render → PostgreSQL → queue → sandbox → result path in staging.
3. Test refresh, reconnect, exact source cutoff, black input, shortcuts, one final submission, and the delayed leaderboard.
4. Run the 500-user save/poll/submission burst against the chosen hosts. Measure judge drain time separately; an API pass alone does not prove timely scoring.
5. Verify database backup/restore and worker restart recovery, then open the production contest.

Early submitters see rankings only after their full 15-minute coding window. The API returns zero ranking rows before release. Anonymous rankings require a closed contest and all timers ended. Time remains a tie-breaker; expired drafts are not submitted automatically.
