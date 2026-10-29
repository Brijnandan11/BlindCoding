import { Queue, Worker } from "bullmq";
import { create, get, list, put } from "../lib/store";
import { cacheDelete, withRecordLock } from "../lib/cache";
import { Attempt, Contest, Submission } from "../lib/domain";
import { codeMatchPercent } from "../lib/code-match";
import { redisConnection } from "../lib/redis";
const connection = redisConnection();
const concurrency = Number(process.env.JUDGE_CONCURRENCY || 2);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
  throw new Error("JUDGE_CONCURRENCY must be an integer between 1 and 8.");
const queue = new Queue("blind-judge", { connection });
const worker = new Worker(
  "blind-judge",
  async (job) => {
    const s = await withRecordLock("submission:" + job.data.id, async () => {
      const current = await get<Submission>("submission", job.data.id);
      if (!current || current.status === "RESULT") return null;
      await put("submission", current.id, { ...current, status: "JUDGING" });
      return current;
    });
    if (!s) return;
    const c = await get<Contest>("contest", s.contestId);
    if (!c) return;
    const attempt = await get<Attempt>("attempt", s.attemptId);
    const score = Number(codeMatchPercent(s.source, attempt?.challengeSource || c.source).toFixed(2));
    const saved = await withRecordLock("submission:" + s.id, async () => {
      const current = await get<Submission>("submission", s.id);
      const currentContest = await get<Contest>("contest", s.contestId);
      if (!current || !currentContest) return false;
      await put("submission", s.id, {
        ...current,
        status: "RESULT",
        score,
        error: undefined,
      });
      return true;
    });
    if (saved) await cacheDelete("leaderboard");
  },
  { connection, concurrency },
);
worker.on("failed", async (job, error) => {
  if (!job) return;
  if (job.attemptsMade < Number(job.opts.attempts || 1)) return;
  await withRecordLock("submission:" + job.data.id, async () => {
    const s = await get<Submission>("submission", job.data.id);
    if (s && s.status !== "RESULT") {
      await put("submission", s.id, { ...s, status: "ERROR", error: error.message });
      await cacheDelete("leaderboard");
    }
  });
});
// Durable outbox: Redis can be rebuilt by scanning PostgreSQL submissions.
async function reconcile(): Promise<number> {
  const now = Date.now();
  let nextDeadline = Number.POSITIVE_INFINITY;
  for (const attempt of await list<Attempt>("attempt")) {
    if (attempt.codingEndsAt > now) {
      nextDeadline = Math.min(nextDeadline, attempt.codingEndsAt);
      continue;
    }
    if (await get<Submission>("submission", attempt.id)) continue;
    await withRecordLock("draft:" + attempt.id, () =>
      withRecordLock("submission:" + attempt.id, async () => {
        const currentAttempt = await get<Attempt>("attempt", attempt.id);
        if (!currentAttempt) return;
        if (await get<Submission>("submission", attempt.id)) return;
        const submission: Submission = {
          id: attempt.id,
          attemptId: attempt.id,
          participantId: currentAttempt.participantId,
          contestId: currentAttempt.contestId,
          roundId: currentAttempt.roundId,
          source: currentAttempt.draft,
          submittedAt: currentAttempt.codingEndsAt,
          completionMs: currentAttempt.codingEndsAt - currentAttempt.viewingEndsAt,
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
  return Number.isFinite(nextDeadline)
    ? Math.min(5000, Math.max(1, nextDeadline - Date.now()))
    : 5000;
}
let reconciling = false;
let timer: ReturnType<typeof setTimeout>;
async function scheduleReconcile() {
  if (reconciling) return;
  reconciling = true;
  let delay = 5000;
  try {
    delay = await reconcile();
  } catch (error) {
    console.error(error);
  } finally {
    reconciling = false;
    timer = setTimeout(scheduleReconcile, delay);
  }
}
await scheduleReconcile();
worker.on("error", (error) => console.error("Judge queue connection failed:", error.message));
console.log("Judge worker ready. Waiting for submissions.");
async function stop() {
  clearTimeout(timer);
  await worker.close();
  await queue.close();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
