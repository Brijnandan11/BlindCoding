import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { checkLoginLimit } from "./rate-limit";
import { cacheDelete, cached, withRecordLock } from "./cache";
import { get, create, put, list, live, remove, createGroup, usePostgres } from "./store";
import { sqlCreateParticipantForTeam } from "./postgres";
import {
  Attempt,
  Participant,
  Contest,
  Submission,
  contestTiming,
  phase,
  validateSubmission,
  rank,
} from "./domain";
export const id = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
export const CONTEST = "contest-main";
export async function session() {
  const token = (await cookies()).get("bc_session")?.value;
  if (!token) return null;
  const s = await get<{ participantId?: string; admin?: boolean; expires: number }>(
    "session",
    id(token),
  );
  return s && s.expires > Date.now() ? s : null;
}
export async function login(participantId?: string, admin = false) {
  const token = randomBytes(32).toString("hex");
  await put("session", id(token), { participantId, admin, expires: Date.now() + 86400000 });
  (await cookies()).set("bc_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 86400,
  });
}
export async function requireAdmin() {
  if (!(await session())?.admin) throw new Error("Admin authentication required.");
}
export async function context() {
  const s = await session();
  if (!s?.participantId) throw new Error("Please sign in with your participant code.");
  const [p, c] = await Promise.all([
    get<Participant>("participant", s.participantId),
    get<Contest>("contest", CONTEST),
  ]);
  const a = await get<Attempt>("attempt", id(s.participantId + CONTEST + (c?.roundId || "")));
  if (!p) throw new Error("Participant not found.");
  return { p, a };
}
export async function state(known?: Awaited<ReturnType<typeof context>>) {
  const { p, a } = known || (await context());
  const [sub, c] = await Promise.all([
    a ? get<Submission>("submission", a.id) : null,
    get<Contest>("contest", CONTEST),
  ]);
  return {
    participant: p,
    attempt: a
      ? {
          id: a.id,
          startedAt: a.startedAt,
          viewingEndsAt: a.viewingEndsAt,
          codingEndsAt: a.codingEndsAt,
        }
      : null,
    phase: a ? phase(a, !!sub) : "WAITING",
    submission: sub ? publicSubmission(sub) : null,
    serverNow: Date.now(),
    contest: c
      ? {
          name: c.name,
          status: c.status,
          ...contestTiming(c),
          ...(a
            ? {
                readingMinutes: Math.max(1, Math.ceil((a.viewingEndsAt - a.startedAt) / 60000)),
                codingMinutes: Math.max(1, Math.ceil((a.codingEndsAt - a.viewingEndsAt) / 60000)),
              }
            : {}),
        }
      : null,
  };
}
export function publicSubmission(s: Submission) {
  const { source, ...rest } = s;
  return rest;
}
export async function leaderboard() {
  return cached("leaderboard", 5, buildLeaderboard);
}
async function buildLeaderboard() {
  const [subs, people, contest] = await Promise.all([
    list<Submission>("submission"),
    list<Participant>("participant"),
    get<Contest>("contest", CONTEST),
  ]);
  const currentRound = contest?.roundId;
  return rank(subs.filter((s) => s.status === "RESULT" && s.roundId === currentRound)).map((s, i) => ({
    rank: i + 1,
    id: s.id,
    score: s.score ?? 0,
    completionMs: s.completionMs,
    name: people.find((p) => p.id === s.participantId)?.name || "Participant",
    team: people.find((p) => p.id === s.participantId)?.team || "",
  }));
}
export async function participantLeaderboard() {
  const now = Date.now();
  const s = await session();
  let availableAt: number | null = null;
  const contest = await get<Contest>("contest", CONTEST);
  const timing = contestTiming(contest);
  let codingMinutes = timing.codingMinutes;
  let unlocked = !!s?.admin;
  const [allAttempts, allSubmissions] = await Promise.all([
    list<Attempt>("attempt"),
    list<Submission>("submission"),
  ]);
  const currentRound = contest?.roundId;
  const attempts = allAttempts.filter((attempt) => attempt.roundId === currentRound);
  const submissions = allSubmissions.filter((submission) => submission.roundId === currentRound);
  const contestEnd = attempts.length
    ? Math.max(...attempts.map((attempt) => attempt.codingEndsAt))
    : contest?.startedAt
      ? contest.startedAt + timing.readingMs + timing.codingMs
      : null;
  availableAt = contestEnd;
  const submissionsByAttempt = new Map(
    submissions.map((submission) => [submission.attemptId, submission]),
  );
  const allJudged =
    attempts.every((attempt) => attempt.codingEndsAt <= now) &&
    attempts.every((attempt) => {
      const submission = submissionsByAttempt.get(attempt.id);
      return submission?.status === "RESULT";
    });
  const roundEnded = contestEnd !== null && now >= contestEnd;
  if (s?.participantId) {
    const attempt = await get<Attempt>(
      "attempt",
      id(s.participantId + CONTEST + (contest?.roundId || "")),
    );
    if (attempt) codingMinutes = Math.max(1, Math.ceil((attempt.codingEndsAt - attempt.viewingEndsAt) / 60000));
    unlocked = roundEnded && allJudged;
  } else if (!s?.admin) {
    unlocked = roundEnded && allJudged;
  }
  return {
    locked: !unlocked,
    availableAt,
    codingMinutes,
    pendingJudging: attempts.filter((attempt) => {
      const submission = submissionsByAttempt.get(attempt.id);
      return submission?.status !== "RESULT";
    }).length,
    serverNow: now,
    rows: unlocked ? await leaderboard() : [],
  };
}

export async function handle(method: string, route: string, body: Record<string, unknown>) {
  if (!live) throw new Error("Service unavailable. Contact the event organizer.");
  if (route === "config") return { ready: true };
  if (route === "auth/login" && method === "POST") {
    const team = String(body.team || "").trim();
    const name = String(body.name || "").trim();
    const branch = String(body.branch || "").trim();
    if (!team || !name) throw new Error("Enter your team name and participant name.");
    await checkLoginLimit("participant:" + id(team.toLowerCase() + ":" + name.toLowerCase()));
    const people = await cached("participants-for-login", 15, () => list<Participant>("participant"));
    let matches = people.filter(
      (p) => p.team.trim().toLowerCase() === team.toLowerCase() && p.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (!matches.length) {
      const knownTeam = await cached("teams-for-registration", 15, async () =>
        (await list<{ id: string; name: string }>("team")).find((candidate) => candidate.name.trim().toLowerCase() === team.toLowerCase()) || null,
      );
      if (!knownTeam) throw new Error("Team not found. Ask the organizer to create your team first.");
      const teamId = knownTeam.id;
      const participant = { id: id("participant:" + teamId + ":" + randomBytes(16).toString("hex")), name: name.slice(0, 100), code: "", teamId, team: knownTeam.name, branch: branch.slice(0, 100) };
      await checkLoginLimit("participant-register:" + id(team.toLowerCase() + ":" + name.toLowerCase()));
      await sqlCreateParticipantForTeam(participant.id, participant, teamId, team);
      matches = [participant];
    }
    if (matches.length > 1) throw new Error("More than one participant has that name on this team. Contact the organizer.");
    const p = matches[0];
    await login(p.id);
    return { ok: true };
  }
  if (route === "auth/logout" && method === "POST") {
    const token = (await cookies()).get("bc_session")?.value;
    if (token) await remove("session", id(token));
    (await cookies()).delete("bc_session");
    return { ok: true };
  }
  if (route === "admin/login" && method === "POST") {
    await checkLoginLimit("admin");
    const expected = process.env.ADMIN_PASSWORD || "";
    const minimumPasswordLength = Number(process.env.ADMIN_PASSWORD_MIN_LENGTH || 24);
    if (
      !expected ||
      (process.env.NODE_ENV === "production" &&
        (!Number.isInteger(minimumPasswordLength) ||
          minimumPasswordLength < 10 ||
          expected.length < minimumPasswordLength))
    )
      throw new Error("Service unavailable. Configure a strong admin password.");
    const supplied = String(body.password || "");
    if (
      !expected ||
      !timingSafeEqual(
        createHash("sha256").update(expected).digest(),
        createHash("sha256").update(supplied).digest(),
      )
    )
      throw new Error("Incorrect admin password.");
    await login(undefined, true);
    return { ok: true };
  }
  if (route === "leaderboard") return participantLeaderboard();
  if (route.startsWith("admin/")) {
    await requireAdmin();
    if (route === "admin/overview") {
      const [participants, attempts, submissions, c] = await Promise.all([
        list<Participant>("participant"),
        list<Attempt>("attempt"),
        list<Submission>("submission"),
        get<Contest>("contest", CONTEST),
      ]);
      const timing = contestTiming(c);
      const roundAttempts = attempts.filter((attempt) => attempt.roundId === c?.roundId);
      return {
        participants: participants.map((p) => {
          const a = roundAttempts.find((x) => x.participantId === p.id);
          const s = submissions.find((x) => x.participantId === p.id && x.roundId === c?.roundId);
          return {
            ...p,
            phase: s?.status || (a ? phase(a, false) : "WAITING"),
            attempt: a ? { viewingEndsAt: a.viewingEndsAt, codingEndsAt: a.codingEndsAt } : null,
          };
        }),
        submissions: submissions.map(publicSubmission),
        contest: c ? { ...c, ...timing } : null,
        productionStoreConfigured: usePostgres,
        serverNow: Date.now(),
      };
    }
    if (route === "admin/teams" && method === "POST") {
      const name = String(body.name || "").trim();
      if (!name) throw new Error("Enter a team name.");
      const teamId = id("team-name:" + name.toLowerCase());
      await createGroup([
        { kind: "team", id: teamId, value: { id: teamId, name: name.slice(0, 100), participants: [] } },
      ]);
      return { team: { id: teamId, name: name.slice(0, 100) } };
    }
    if (route === "admin/contest" && method === "POST") {
      if (!usePostgres && process.env.NODE_ENV === "production" && body.status === "OPEN")
        throw new Error("Configure PostgreSQL before opening a production contest.");
      const old = await get<Contest>("contest", CONTEST);
      const readingMinutes = Number(body.readingMinutes);
      const codingMinutes = Number(body.codingMinutes);
      const timing = contestTiming({ readingMinutes, codingMinutes });
      if (!Number.isFinite(readingMinutes) || !Number.isInteger(readingMinutes) || readingMinutes < 1) {
        throw new Error("Reading time must be a valid positive number of minutes.");
      }
      if (!Number.isFinite(codingMinutes) || !Number.isInteger(codingMinutes) || codingMinutes < 1) {
        throw new Error("Blind coding time must be a valid positive number of minutes.");
      }
      const attempts = await list<Attempt>("attempt");
      const status = body.status === "OPEN" ? "OPEN" : body.status === "CLOSED" ? "CLOSED" : "DRAFT";
      if (
        old?.status === "OPEN" &&
        (old.readingMinutes !== timing.readingMinutes || old.codingMinutes !== timing.codingMinutes)
      )
        throw new Error("Contest timing is locked while the contest is open.");
      if (old?.status === "OPEN" && (body.source !== old.source || JSON.stringify(body.tests) !== JSON.stringify(old.tests)))
        throw new Error("Source and test cases are locked while the contest is open.");
      const openingNewRound = status === "OPEN" && old?.status !== "OPEN";
      if (openingNewRound && old?.startedAt) {
        const previousAttempts = attempts.filter((attempt) => attempt.roundId === old.roundId);
        const submissions = await list<Submission>("submission");
        if (
          previousAttempts.some((attempt) => attempt.codingEndsAt > Date.now()) ||
          previousAttempts.some((attempt) => {
            const submission = submissions.find(
              (row) => row.attemptId === attempt.id && row.roundId === old.roundId,
            );
            return submission?.status !== "RESULT" && submission?.status !== "ERROR";
          })
        )
          throw new Error("Wait for the current round to end and finish judging before opening another round.");
      }
      const c: Contest = {
        id: CONTEST,
        name: String(body.name || "Blind Coding 2026").slice(0, 200),
        status,
        source: String(body.source || ""),
        tests: body.tests as Contest["tests"],
        readingMinutes: timing.readingMinutes,
        codingMinutes: timing.codingMinutes,
        startedAt: openingNewRound ? Date.now() : old?.startedAt ?? (status === "OPEN" ? Date.now() : undefined),
        roundId: openingNewRound ? randomBytes(12).toString("hex") : old?.roundId,
      };
      if (
        !c.source ||
        Buffer.byteLength(c.source) > 32768 ||
        !Array.isArray(c.tests) ||
        !c.tests.length ||
        c.tests.length > 10 ||
        c.tests.some(
          (t) =>
            !t ||
            typeof t.input !== "string" ||
            typeof t.output !== "string" ||
            Buffer.byteLength(t.input) > 8192 ||
            Buffer.byteLength(t.output) > 8192 ||
            !Number.isFinite(t.points) ||
            t.points <= 0,
        )
      )
        throw new Error("Provide source code and valid weighted test cases.");
      if (old) await put("contest", CONTEST, c);
      else await create("contest", CONTEST, c);
      if (openingNewRound) await cacheDelete("leaderboard");
      return { ok: true };
    }
    if (route === "admin/submission" && method === "POST") {
      const submission = await get<Submission>("submission", String(body.id || ""));
      if (!submission) throw new Error("Submission not found.");
      return submission;
    }
    if (route === "admin/retry" && method === "POST") {
      const submission = await get<Submission>("submission", String(body.id || ""));
      if (!submission || submission.status !== "ERROR")
        throw new Error("Only failed judge jobs can be retried.");
      await put("submission", submission.id, { ...submission, status: "QUEUED", error: undefined });
      return { ok: true };
    }
    if (route === "admin/export") {
      return { rows: await leaderboard() };
    }
    throw new Error("Unknown admin endpoint.");
  }
  if (route === "attempt/state" || route === "result") return state();
  const { p, a } = await context();
  if (route === "attempt/start" && method === "POST") {
    if (a) return state({ p, a });
    if (!usePostgres && process.env.NODE_ENV === "production")
      throw new Error("Configure PostgreSQL before starting a production contest.");
    let c = await get<Contest>("contest", CONTEST);
    if (c?.status !== "OPEN") throw new Error("The contest is not open yet.");
    if (!c.startedAt) {
      await withRecordLock("contest-start", async () => {
        const current = await get<Contest>("contest", CONTEST);
        if (current?.status !== "OPEN") throw new Error("The contest is not open yet.");
        if (!current.startedAt) await put("contest", CONTEST, { ...current, startedAt: Date.now() });
        c = await get<Contest>("contest", CONTEST);
      });
    }
    const timing = contestTiming(c);
    const contestStart = c.startedAt || Date.now();
    if (Date.now() >= contestStart + timing.readingMs + timing.codingMs)
      throw new Error("This contest has ended. Contact the organizer.");
    const attempt: Attempt = {
      id: id(p.id + CONTEST + (c.roundId || "")),
      participantId: p.id,
      contestId: CONTEST,
      roundId: c.roundId,
      startedAt: contestStart,
      viewingEndsAt: contestStart + timing.readingMs,
      codingEndsAt: contestStart + timing.readingMs + timing.codingMs,
      challengeSource: c.source,
      challengeTests: c.tests,
      draft: "",
      revision: 0,
    };
    try {
      await create("attempt", attempt.id, attempt);
    } catch (e) {
      if (!(await get("attempt", attempt.id))) throw e;
    }
    return state();
  }
  if (!a) throw new Error("Start your attempt first.");
  const existing = await get<Submission>("submission", a.id);
  const currentPhase = phase(a, !!existing);
  if (route === "attempt/source") {
    if (currentPhase !== "VIEWING")
      throw new Error("Source is unavailable after the study period.");
    const c = await get<Contest>("contest", CONTEST);
    if (Date.now() >= a.viewingEndsAt)
      throw new Error("Source is unavailable after the study period.");
    return { source: a.challengeSource ?? c?.source, serverNow: Date.now() };
  }
  if (route === "attempt/draft" && method === "GET") {
    if (currentPhase !== "CODING") throw new Error("Draft is only available during coding.");
    return { draft: a.draft, revision: a.revision };
  }
  if (route === "attempt/draft" && method === "PUT") {
    return withRecordLock("draft:" + a.id, async () => {
      const current = await get<Attempt>("attempt", a.id);
      if (!current) throw new Error("Start your attempt first.");
      const final = await get<Submission>("submission", a.id);
      if (final) throw new Error("Your submission is locked.");
      const source = String(body.source || "");
      validateSubmission(current, Date.now(), source);
      const revision = Number(body.revision);
      if (!Number.isSafeInteger(revision) || revision < 1)
        throw new Error("Invalid draft revision.");
      if (revision > current.revision)
        await put("attempt", a.id, { ...current, draft: source, revision });
      return { ok: true, revision: Math.max(revision, current.revision) };
    });
  }
  if (route === "submission" && method === "POST") {
    return withRecordLock("submission:" + a.id, async () => {
      if (await get<Submission>("submission", a.id)) throw new Error("You have already submitted.");
      const now = Date.now(),
        source = String(body.source || "");
      validateSubmission(a, now, source);
      const sub: Submission = {
        id: a.id,
        attemptId: a.id,
        participantId: p.id,
        contestId: CONTEST,
        roundId: a.roundId,
        source,
        submittedAt: now,
        completionMs: now - a.viewingEndsAt,
        status: "QUEUED",
      };
      await create("submission", a.id, sub);
      return publicSubmission(sub);
    });
  }
  throw new Error("Unknown endpoint.");
}
