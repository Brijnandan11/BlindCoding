import { Queue, Worker } from "bullmq";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, get, list, put } from "../lib/store";
import { cacheDelete, withRecordLock } from "../lib/cache";
import { Attempt, Contest, Submission } from "../lib/domain";
import { similarity } from "./scoring";
import { redisConnection } from "../lib/redis";
const connection = redisConnection();
const concurrency = Number(process.env.JUDGE_CONCURRENCY || 2);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
  throw new Error("JUDGE_CONCURRENCY must be an integer between 1 and 8.");
const queue = new Queue("blind-judge", { connection });
async function execute(args: string[], timeout: number) {
  return new Promise<{ code: number; output: string; error: string }>((resolve, reject) => {
    const p = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "",
      error = "",
      done = false;
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      if (!done) {
        done = true;
        resolve({ code: 124, output, error: "Sandbox timeout" });
      }
    }, timeout);
    p.stdout.on("data", (d) => {
      if (output.length < 262144) output += d.toString();
    });
    p.stderr.on("data", (d) => {
      if (error.length < 65536) error += d.toString();
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (!done) {
        done = true;
        resolve({ code: code ?? 1, output, error });
      }
    });
  });
}
const worker = new Worker(
  "blind-judge",
  async (job) => {
    const started = performance.now();
    const timings: Record<string, number> = {};
    let checkpoint = started;
    const mark = (name: string) => {
      const now = performance.now();
      timings[name] = Math.round(now - checkpoint);
      checkpoint = now;
    };
    const s = await get<Submission>("submission", job.data.id);
    if (!s || s.status === "RESULT") return;
    const c = await get<Contest>("contest", s.contestId);
    if (!c) throw new Error("Missing contest");
    const attempt = await get<Attempt>("attempt", s.attemptId);
    const tests = attempt?.challengeTests || c.tests;
    mark("read");
    await put("submission", s.id, { ...s, status: "JUDGING" });
    mark("startWrite");
    const dir = await mkdtemp(join(tmpdir(), "blind-judge-"));
    const name = "bc-" + s.id;
    try {
      await chmod(dir, 0o755);
      await writeFile(join(dir, "source.c"), s.source, { mode: 0o644 });
      await writeFile(
        join(dir, "tests.json"),
        JSON.stringify(tests.map((t) => ({ input: t.input }))),
        { mode: 0o644 },
      );
      const r = await execute(
        [
          "run",
          "--rm",
          "--name",
          name,
          "--network",
          "none",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--pids-limit",
          "32",
          "--cpus",
          "0.5",
          "--memory",
          "128m",
          "--memory-swap",
          "128m",
          "--user",
          "65534:65534",
          "--ulimit",
          "fsize=1048576:1048576",
          "--ulimit",
          "nofile=64:64",
          "--tmpfs",
          "/work:rw,exec,nosuid,size=16m,mode=1777",
          "--mount",
          `type=bind,src=${dir},dst=/input,readonly`,
          "--entrypoint",
          "python3",
          process.env.JUDGE_IMAGE || "blind-coding-sandbox",
          "/runner.py",
        ],
        120000,
      );
      mark("sandbox");
      if (r.code !== 0) throw new Error("Sandbox infrastructure failure: " + r.error.slice(0, 300));
      const evaluation = JSON.parse(r.output);
      evaluation.results = evaluation.results.map(
        (result: { output?: string; code?: number; error?: string }, i: number) => ({
          passed:
            evaluation.compiled &&
            result.code === 0 &&
            (result.output || "").trim().split(/\s+/).join(" ") ==
            tests[i].output.trim().split(/\s+/).join(" "),
          error: result.error,
        }),
      );
      const syntax = evaluation.compiled ? 20 : 0;
      const total = tests.reduce((n, t) => n + t.points, 0);
      const functional =
        (evaluation.results.reduce(
          (n: number, t: { passed: boolean }, i: number) => n + (t.passed ? tests[i].points : 0),
          0,
        ) /
          total) *
        50;
      const structure = similarity(s.source, c.source) * 30;
      await put("submission", s.id, {
        ...s,
        status: "RESULT",
        syntax,
        functional: Number(functional.toFixed(2)),
        structure: Number(structure.toFixed(2)),
        score: Number((syntax + functional + structure).toFixed(2)),
        tests: evaluation.results,
        error: evaluation.error,
      });
      await cacheDelete("leaderboard");
      mark("resultWrite");
    } finally {
      await execute(["rm", "-f", name], 5000).catch(() => {});
      await rm(dir, { recursive: true, force: true });
      mark("cleanup");
      if (process.env.JUDGE_TIMINGS === "true")
        console.log(
          "Judge timing:",
          JSON.stringify({ ...timings, total: Math.round(performance.now() - started) }),
        );
    }
  },
  { connection, concurrency },
);
worker.on("failed", async (job, error) => {
  if (!job) return;
  if (job.attemptsMade < Number(job.opts.attempts || 1)) return;
  const s = await get<Submission>("submission", job.data.id);
  if (s && s.status !== "RESULT")
    await put("submission", s.id, { ...s, status: "ERROR", error: error.message });
});
// Durable outbox: Redis can be rebuilt by scanning PostgreSQL submissions.
async function reconcile() {
  const now = Date.now();
  for (const attempt of await list<Attempt>("attempt")) {
    if (attempt.codingEndsAt > now) continue;
    if (await get<Submission>("submission", attempt.id)) continue;
    await withRecordLock("draft:" + attempt.id, () =>
      withRecordLock("submission:" + attempt.id, async () => {
        if (await get<Submission>("submission", attempt.id)) return;
        const submission: Submission = {
          id: attempt.id,
          attemptId: attempt.id,
          participantId: attempt.participantId,
          contestId: attempt.contestId,
          roundId: attempt.roundId,
          source: attempt.draft,
          submittedAt: attempt.codingEndsAt,
          completionMs: attempt.codingEndsAt - attempt.viewingEndsAt,
          status: "QUEUED",
        };
        try {
          await create("submission", attempt.id, submission);
        } catch (error) {
          if ((error as { code?: number | string }).code !== 409) throw error;
        }
      }),
    );
  }
  for (const s of await list<Submission>("submission"))
    if (["QUEUED", "JUDGING"].includes(s.status)) {
      const existing = await queue.getJob(s.id);
      if (
        existing &&
        s.status === "QUEUED" &&
        ["failed", "completed"].includes(await existing.getState())
      )
        await existing.remove();
      await queue.add(
        "evaluate",
        { id: s.id },
        {
          jobId: s.id,
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
    }
}
await reconcile();
let reconciling = false;
const timer = setInterval(async () => {
  if (reconciling) return;
  reconciling = true;
  try {
    await reconcile();
  } catch (error) {
    console.error(error);
  } finally {
    reconciling = false;
  }
}, 5000);
worker.on("error", (error) => console.error("Judge queue connection failed:", error.message));
console.log("Judge worker ready. Waiting for submissions.");
async function stop() {
  clearInterval(timer);
  await worker.close();
  await queue.close();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
