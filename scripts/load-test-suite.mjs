import { existsSync, mkdirSync, writeFileSync, createWriteStream, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);
const { register } = await import("tsx/esm/api");
register();
const { storageNamespace } = await import("../lib/storage-namespace.ts");
const loadPort = Number(process.argv[6] || 3042);
if (!Number.isInteger(loadPort) || loadPort < 1024 || loadPort > 65535)
  throw new Error("Invalid local load-test port.");
const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const tableId = "load-" + stamp + "-" + randomBytes(3).toString("hex");
if (!tableId.startsWith("load-"))
  throw new Error("Isolation check failed");
const dir = join(process.cwd(), "artifacts", "load-tests", stamp);
mkdirSync(dir, { recursive: true });
const mode = process.argv[4] || "postgres";
if (!["postgres", "postgres-api-only", "api-only"].includes(mode))
  throw new Error("Unknown load-test mode");
const judgeEnabled = !mode.endsWith("api-only");
let sql;
const postgresName = "bc-load-pg-" + stamp;
let postgresCreated = false;
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const record = (kind, id) => hash(kind + ":" + id);
const children = [];
const redisName = "bc-load-" + stamp;
let redisCreated = false;
const report = {
  startedAt: new Date().toISOString(),
  tableId,
  target: "Local production Next.js server + isolated PostgreSQL 16 + Redis + Docker GCC judge",
  storage: "supabase-postgres-compatible",
  officialDuration: false,
  judgeEnabled,
  waves: [],
  cleanup: {},
};
function log(message) {
  console.log(new Date().toISOString(), message);
}
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(command, args, {
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    child.stdout.on("data", (d) => {
      output += d;
      if (options.log) options.log.write(d);
    });
    child.stderr.on("data", (d) => {
      output += d;
      if (options.log) options.log.write(d);
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 || options.allowFailure
        ? resolve({ code, output })
        : reject(new Error(command + " failed: " + output.slice(-1500))),
    );
  });
}
function background(args, name, env) {
  const file = createWriteStream(join(dir, name + ".log"));
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(file);
  child.stderr.pipe(file);
  children.push(child);
  return child;
}
async function save(kind, id, value, create = true) {
  if (create) await sql.sqlCreate(record(kind, id), kind, value);
  else await sql.sqlUpsert([{ id: record(kind, id), kind, value }]);
}
async function get(kind, id) {
  const row = (await sql.sqlRead([record(kind, id)]))[0];
  if (!row) throw Object.assign(new Error("Missing fixture row"), { code: 404 });
  return row.payload;
}
async function pool(items, fn, count = 8) {
  let index = 0;
  const results = await Promise.allSettled(
    Array.from({ length: count }, async () => {
      while (index < items.length) {
        const i = index++;
        await fn(items[i], i);
      }
    }),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stopping = false;
async function cleanup() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  await sleep(2000);
  for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
  if (redisCreated) {
    try {
      await run("docker", ["rm", "-f", redisName]);
      report.cleanup.redisRemoved = true;
    } catch (e) {
      report.cleanup.redisError = e.message;
    }
  }
  if (postgresCreated) {
    await sql?.closePostgres();
    try {
      await run("docker", ["rm", "-f", "-v", postgresName]);
      report.cleanup.postgresRemoved = true;
    } catch (error) {
      report.cleanup.postgresError = error.message;
    }
  }
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
  log("Report saved: " + join(dir, "report.json"));
}
process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(143);
});
process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});
try {
  {
    log(
      "Starting an isolated PostgreSQL container; no production database will be modified.",
    );
    const password = randomBytes(32).toString("hex");
    await run(
      "docker",
      [
        "run",
        "-d",
        "--name",
        postgresName,
        "-e",
        "POSTGRES_PASSWORD",
        "-p",
        "127.0.0.1::5432",
        "postgres:16",
      ],
      { env: { ...process.env, POSTGRES_PASSWORD: password } },
    );
    postgresCreated = true;
    const mapping = JSON.parse((await run("docker", ["inspect", postgresName])).output)[0]
      .NetworkSettings.Ports["5432/tcp"][0];
    process.env.DATABASE_URL = `postgres://postgres:${password}@127.0.0.1:${mapping.HostPort}/postgres`;
    process.env.STORE_TABLE_ID = tableId;
    sql = await import("../lib/postgres.ts");
    let ready = false;
    for (let n = 0; n < 60; n++) {
      try {
        await sql.initializePostgres();
        ready = true;
        break;
      } catch {
        await sleep(1000);
      }
    }
    if (!ready) throw new Error("Test PostgreSQL did not start");
  }
  const setupLog = createWriteStream(join(dir, "setup.log"));
  const env = {
    ...process.env,
    STORE_TABLE_ID: tableId,
    DATABASE_URL: process.env.DATABASE_URL,
    BACKEND_URL: "",
    REQUIRE_GATEWAY: "false",
    APP_URL: `http://localhost:${loadPort}`,
    PORT: String(loadPort),
    HOSTNAME: "0.0.0.0",
    NODE_ENV: "production",
    ADMIN_PASSWORD: randomBytes(32).toString("hex"),
    JUDGE_CONCURRENCY: process.env.JUDGE_CONCURRENCY || "4",
    JUDGE_IMAGE: process.argv[7] || process.env.JUDGE_IMAGE || "blind-coding-sandbox",
  };
  log("Private test table provisioned. Starting isolated Redis.");
  await run("docker", [
    "run",
    "-d",
    "--name",
    redisName,
    "-p",
    "127.0.0.1::6379",
    "redis:7-alpine",
    "redis-server",
    "--appendonly",
    "no",
  ]);
  redisCreated = true;
  const mapping = JSON.parse((await run("docker", ["inspect", redisName])).output)[0]
    .NetworkSettings.Ports["6379/tcp"][0];
  env.REDIS_URL = "redis://127.0.0.1:" + mapping.HostPort;
  const contest = {
    id: "contest-main",
    name: "Isolated capacity test",
    status: "OPEN",
    source:
      '#include <stdio.h>\nint main(void){int n; scanf("%d", &n); printf("%d\\n", n*(n+1)/2); return 0;}',
    tests: [
      { input: "5\n", output: "15", points: 1 },
      { input: "10\n", output: "55", points: 1 },
    ],
  };
  await save("contest", contest.id, contest);
  background(["scripts/run.mjs", "start", "--port", String(loadPort)], "backend", env);
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try {
      if ((await fetch(env.APP_URL + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await sleep(1000);
  }
  if (!ready) throw new Error("Test backend did not start");
  // Judge performance is measured separately from API latency so a queue backlog is visible.
  if (judgeEnabled) background(["scripts/run.mjs", "judge"], "judge", env);
  if (process.argv[5] === "journey") {
    log(
      "Running the real browser study → black typing → draft restore → judge → delayed leaderboard journey.",
    );
    await save("contest", contest.id, { ...contest, status: "DRAFT" }, false);
    await run(process.execPath, ["scripts/verify-live.mjs"], {
      env: { ...env, TEST_BASE_URL: env.APP_URL },
      log: createWriteStream(join(dir, "browser-journey.log")),
    });
    report.browserJourneyPassed = true;
    await save("contest", contest.id, contest, false);
    const { default: Redis } = await import("ioredis");
    const client = new Redis(env.REDIS_URL);
    await client.del(`bc:${storageNamespace(env)}:record:contest:${contest.id}`);
    await client.quit();
  }
  for (const users of (process.argv[2] || process.env.LOAD_WAVES || "100,500")
    .split(",")
    .map(Number)) {
    if (!Number.isInteger(users) || users < 1 || users > 750)
      throw new Error("Wave must be 1..750 users");
    const people = Array.from({ length: users }, (_, i) => {
      const code = `LOAD-${stamp}-${users}-${i}`;
      const team = `Load team ${Math.floor(i / 3) + 1}`;
      const name = i % 6 < 3 ? "Same name student" : `Load participant ${i + 1}`;
      return {
        id: hash(code),
        code,
        name,
        teamId: `load-${users}-${Math.floor(i / 3)}`,
        team,
      };
    });
    const attempts = [];
    log(`Seeding ${users} isolated participant and attempt records.`);
    await pool(people, async (p) => {
      await save("participant", p.id, p);
      const viewingEndsAt = Date.now() - 1000;
      const a = {
        id: hash(p.id + "contest-main"),
        participantId: p.id,
        contestId: "contest-main",
        startedAt: viewingEndsAt - 300000,
        viewingEndsAt,
        codingEndsAt: viewingEndsAt + 900000,
        draft: "",
        revision: 0,
      };
      attempts.push(a);
      await save("attempt", a.id, a);
    });
    // A private monitor session verifies persisted outcomes and deadline release after the wave.
    const token = randomBytes(32).toString("hex");
    await save("session", hash(token), {
      participantId: people[0].id,
      expires: Date.now() + 3600000,
    });
    const codesFile = join(dir, `codes-${users}.json`);
    writeFileSync(codesFile, JSON.stringify(people.map((p) => ({ team: p.team, name: p.name }))), { mode: 0o600 });
    const summaryFile = join(dir, `k6-${users}.json`);
    const wave = {
      users,
      startedAt: new Date().toISOString(),
      steadySeconds: Math.max(0, Number(process.argv[3] || 70) - 10),
      draftSizeDescription: "approximately 4.4 KB",
    };
    report.waves.push(wave);
    writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
    const probeStart = Date.now();
    const probe = await fetch(env.APP_URL + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: env.APP_URL },
      body: JSON.stringify({ team: people[0].team, name: people[0].name }),
    });
    const probeData = await probe.json();
    wave.singleUserProbe = {
      status: probe.status,
      latencyMs: Date.now() - probeStart,
      error: probeData.error,
    };
    log("Single-user login probe: " + JSON.stringify(wave.singleUserProbe));

    log(
      `Starting k6: ${users} users, ~4 KB autosaves every two seconds, five-second state polls, then 30-second submission burst.`,
    );
    const result = await run(
      "k6",
      [
        "run",
        "--quiet",
        "--summary-export",
        join(dir, `summary-${users}.json`),
        "-e",
        `BASE_URL=${env.APP_URL}`,
        "-e",
        `CODES_FILE=${codesFile}`,
        "-e",
        `USERS=${users}`,
        "-e",
        `BURST_AT=${Date.now() + Number(process.argv[3] || 70) * 1000}`,
        "-e",
        `SUMMARY_FILE=${summaryFile}`,
        "scripts/load-test-capacity.js",
      ],
      { allowFailure: true, log: createWriteStream(join(dir, `k6-${users}.log`)) },
    );
    wave.k6ExitCode = result.code;
    if (existsSync(summaryFile)) {
      const summary = JSON.parse(readFileSync(summaryFile, "utf8"));
      wave.metrics = Object.fromEntries(
        Object.entries(summary.metrics).filter(([name]) =>
          [
            "http_req_duration",
            "http_req_failed",
            "contest_success",
            "api_latency",
            "accepted_submissions",
            "successful_draft_saves",
            "late_draft_intervals",
            "http_reqs",
            "checks",
          ].includes(name),
        ),
      );
    }
    const submissions = [];
    wave.readbackErrors = [];
    await pool(
      attempts,
      async (a) => {
        try {
          submissions.push(await get("submission", a.id));
        } catch (e) {
          if (e.code !== 404) wave.readbackErrors.push(e.message);
        }
      },
      4,
    );
    wave.persistedSubmissions = submissions.length;
    wave.finalPayloadsPreserved = submissions.every((s) => s.source.endsWith("/* final marker */"));
    wave.submissionStates = submissions.reduce((out, s) => {
      out[s.status] = (out[s.status] || 0) + 1;
      return out;
    }, {});
    let browser;
    if (users <= 3 && result.code === 0) {
      const { chromium } = await import("@playwright/test");
      browser = await chromium.launch({
        executablePath:
          process.env.CHROMIUM_PATH ||
          "/home/brij/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
        headless: true,
        args: ["--no-sandbox"],
      });
      const page = await browser.newPage();
      await page.context().addCookies([
        {
          name: "bc_session",
          value: token,
          url: env.APP_URL,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
      await page.goto(env.APP_URL + "/leaderboard");
      await page
        .getByRole("heading", { name: "The leaderboard opens after your 15 minutes." })
        .waitFor();
      await page.screenshot({ path: join(dir, "leaderboard-locked.png") });
      wave.browserLeaderboardLocked = true;
    }
    const headers = { Cookie: "bc_session=" + token };
    const before = await (await fetch(env.APP_URL + "/api/leaderboard", { headers })).json();
    wave.earlyLeaderboardLocked = before.locked === true && before.rows?.length === 0;
    const a = attempts.find((a) => a.participantId === people[0].id);
    const saved = await get("attempt", a.id);
    await save("attempt", a.id, { ...saved, codingEndsAt: Date.now() - 1 }, false);
    // Fixture-only clock changes bypass the application write-through cache.
    const { default: Redis } = await import("ioredis");
    const testRedis = new Redis(env.REDIS_URL);
    const cacheNamespace = storageNamespace(env);
    await testRedis.del(`bc:${cacheNamespace}:record:attempt:${a.id}`);
    await testRedis.quit();
    const after = await (await fetch(env.APP_URL + "/api/leaderboard", { headers })).json();
    wave.leaderboardUnlocksAfterDeadline = after.locked === false && Array.isArray(after.rows);
    if (browser) {
      try {
        const page = browser.contexts()[0].pages()[0];
        await page.reload();
        await page.getByRole("heading", { name: "The leaderboard.", exact: true }).waitFor();
        await page.screenshot({ path: join(dir, "leaderboard-unlocked.png") });
        wave.browserLeaderboardUnlocked = true;
      } finally {
        await browser.close();
      }
    }

    const logout = await fetch(env.APP_URL + "/api/auth/logout", {
      method: "POST",
      headers: { ...headers, Origin: env.APP_URL, "Content-Type": "application/json" },
      body: "{}",
    });
    const revoked = await fetch(env.APP_URL + "/api/attempt/state", { headers });
    wave.cachedSessionRevoked = logout.ok && revoked.status === 401;
    log(
      `Wave ${users}: k6 exit ${result.code}; ${submissions.length}/${users} submissions persisted; states ${JSON.stringify(wave.submissionStates)}.`,
    );
    writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
    if (result.code !== 0) {
      process.exitCode = 1;
      log(
        "Capacity thresholds failed; continuing with the requested 500-user measurement where applicable.",
      );
    }
  }
  if (judgeEnabled) {
    log("Allowing up to ten minutes for the isolated judge queue to drain.");
    const { Queue } = await import("bullmq");
    const { redisConnection } = await import("../lib/redis.ts");
    const queue = new Queue("blind-judge", { connection: redisConnection(env.REDIS_URL) });
    const deadline = Date.now() + 600000;
    do {
      report.judgeQueue = await queue.getJobCounts(
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed",
      );
      if (!report.judgeQueue.waiting && !report.judgeQueue.active && !report.judgeQueue.delayed)
        break;
      log("Judge queue: " + JSON.stringify(report.judgeQueue));
      await sleep(15000);
    } while (Date.now() < deadline);
    report.judgeQueue = await queue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
    );
    report.judgeDrainTimedOut = !!(
      report.judgeQueue.waiting ||
      report.judgeQueue.active ||
      report.judgeQueue.delayed
    );
    await queue.close();
    const finalSubmissions = (
      await sql
        .postgres()
        .query(`SELECT payload FROM ${sql.sqlTable()} WHERE kind=$1`, ["submission"])
    ).rows.map((row) => row.payload);
    report.finalResults = {
      total: finalSubmissions.length,
      completed: finalSubmissions.filter((s) => s.status === "RESULT").length,
      errors: finalSubmissions.filter((s) => s.status === "ERROR").length,
      perfectScores: finalSubmissions.filter((s) => s.score === 100).length,
    };
  }
  report.apiPassed = report.waves.every(
    (w) =>
      w.k6ExitCode === 0 &&
      w.persistedSubmissions === w.users &&
      w.earlyLeaderboardLocked &&
      w.leaderboardUnlocksAfterDeadline &&
      w.cachedSessionRevoked &&
      w.finalPayloadsPreserved &&
      !w.readbackErrors.length,
  );
  const expected = report.waves.reduce((count, w) => count + w.users, 0);
  report.passed =
    report.apiPassed &&
    (!judgeEnabled ||
      (!report.judgeDrainTimedOut &&
        report.finalResults?.completed === expected &&
        report.finalResults?.perfectScores === expected &&
        report.finalResults?.errors === 0));
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.error = error.message;
  log("Load test stopped: " + error.message);
  process.exitCode = 1;
} finally {
  await cleanup();
}
