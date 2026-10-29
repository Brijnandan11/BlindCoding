import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { checkLoginLimit } from "./rate-limit";
import { cacheDelete, cached, withRecordLock } from "./cache";
import { get, create, put, list, live, remove, createGroup, usePostgres } from "./store";
import { sqlCreateParticipantForTeam } from "./postgres";
import { codeMatchPercent } from "./code-match";
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
const ACTIVE_CONTEST = "active-contest";
const ADMIN_CONTEST = "admin-contest";
async function activeContestId() {
  const selected = await get<{ id?: string }>("setting", ACTIVE_CONTEST);
  return selected?.id || CONTEST;
}
async function selectedContestId() {
  const selected = await get<{ id?: string }>("setting", ADMIN_CONTEST);
  return selected?.id || (await activeContestId());
}
async function getActiveContest() {
  const activeId = await activeContestId();
  return (await get<Contest>("contest", activeId)) || (activeId !== CONTEST ? await get<Contest>("contest", CONTEST) : null);
}
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
  await put("session", id(token), { key: id(token), participantId, admin, expires: Date.now() + 86400000 });
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
  const [p, c] = await Promise.all([get<Participant>("participant", s.participantId), getActiveContest()]);
  if (!p) throw new Error("Participant not found.");
  const currentAttempt = c
    ? await get<Attempt>("attempt", id(s.participantId + c.id + (c.roundId || "")))
    : null;
  if (currentAttempt) return { p, a: currentAttempt, c };
  const [attempts, contests] = await Promise.all([
    list<Attempt>("attempt"),
    list<Contest>("contest"),
  ]);
  const liveAttempt = attempts
    .filter((attempt) => attempt.participantId === p.id && attempt.codingEndsAt > Date.now())
    .sort((a, b) => b.startedAt - a.startedAt)
    .find((attempt) => contests.some((item) => item.id === attempt.contestId));
  if (liveAttempt) {
    const contest = contests.find((item) => item.id === liveAttempt.contestId)!;
    return { p, a: liveAttempt, c: contest };
  }
  return { p, a: null, c };
}
export async function state(known?: Awaited<ReturnType<typeof context>>) {
  const { p, a, c } = known || (await context());
  const sub = a ? await get<Submission>("submission", a.id) : null;
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
    submission: sub
      ? publicSubmission({
          ...sub,
          score: Number(codeMatchPercent(sub.source, a?.challengeSource || c?.source || "").toFixed(2)),
        })
      : null,
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
async function deleteParticipantRecords(participantId: string) {
  await assertParticipantCanDelete(participantId);
  const [attempts, submissions, sessions, teams] = await Promise.all([
    list<Attempt>("attempt"),
    list<Submission>("submission"),
    list<{ key?: string; participantId?: string }>("session"),
    list<{ id: string; participants?: string[] }>("team"),
  ]);
  const ownedAttempts = attempts.filter((attempt) => attempt.participantId === participantId);
  const ownedSubmissions = submissions.filter((submission) => submission.participantId === participantId);
  for (const attempt of ownedAttempts) {
    if (attempt.codingEndsAt > Date.now())
      throw new Error("This participant still has an active event. Close the event and wait for it to finish before deleting them.");
    const submission = ownedSubmissions.find((item) => item.attemptId === attempt.id);
    if (!submission || submission.status === "QUEUED" || submission.status === "JUDGING")
      throw new Error("Wait for this participant's submissions to finish judging before deleting them.");
  }
  for (const attempt of ownedAttempts) {
    await withRecordLock("draft:" + attempt.id, () =>
      withRecordLock("submission:" + attempt.id, async () => {
        const currentAttempt = await get<Attempt>("attempt", attempt.id);
        const currentSubmission = await get<Submission>("submission", attempt.id);
        if (currentAttempt?.codingEndsAt && currentAttempt.codingEndsAt > Date.now())
          throw new Error("This participant still has an active event. Wait for it to finish before deleting them.");
        if (currentSubmission && ["QUEUED", "JUDGING"].includes(currentSubmission.status))
          throw new Error("Wait for this participant's submissions to finish judging before deleting them.");
        await remove("submission", attempt.id);
        await remove("attempt", attempt.id);
      }),
    );
  }
  for (const submission of ownedSubmissions)
    if (!ownedAttempts.some((attempt) => attempt.id === submission.attemptId))
      await remove("submission", submission.id);
  await remove("participant", participantId);
  for (const item of sessions)
    if (item.participantId === participantId && item.key) await remove("session", item.key);
  for (const team of teams)
    if (team.participants?.includes(participantId))
      await put("team", team.id, {
        ...team,
        participants: team.participants.filter((id) => id !== participantId),
      });
  await cacheDelete("participants-for-login", "teams-for-registration", "leaderboard");
}
async function assertParticipantCanDelete(participantId: string) {
  const [attempts, submissions] = await Promise.all([list<Attempt>("attempt"), list<Submission>("submission")]);
  const ownedAttempts = attempts.filter((attempt) => attempt.participantId === participantId);
  const ownedSubmissions = submissions.filter((submission) => submission.participantId === participantId);
  for (const attempt of ownedAttempts) {
    if (attempt.codingEndsAt > Date.now())
      throw new Error("This participant still has an active event. Close the event and wait for it to finish before deleting them.");
    const submission = ownedSubmissions.find((item) => item.attemptId === attempt.id);
    if (!submission || submission.status === "QUEUED" || submission.status === "JUDGING")
      throw new Error("Wait for this participant's submissions to finish judging before deleting them.");
  }
}
async function withRecordLockRetry<T>(key: string, action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return await withRecordLock(key, action);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("update is already in progress") || attempt === 19)
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error("Could not acquire the event record lock.");
}
async function deleteContestRecords(contest: Contest) {
  const [attempts, submissions] = await Promise.all([list<Attempt>("attempt"), list<Submission>("submission")]);
  const ownedAttempts = attempts.filter((attempt) => attempt.contestId === contest.id);
  const ownedSubmissions = submissions.filter((submission) => submission.contestId === contest.id);
  for (const attempt of ownedAttempts) {
    await withRecordLockRetry("draft:" + attempt.id, () =>
      withRecordLockRetry("submission:" + attempt.id, async () => {
        await remove("submission", attempt.id);
        await remove("attempt", attempt.id);
      }),
    );
  }
  for (const submission of ownedSubmissions)
    await withRecordLockRetry("submission:" + submission.id, () => remove("submission", submission.id));
  await remove("contest", contest.id);
  const [active, selected, remaining] = await Promise.all([
    get<{ id?: string }>("setting", ACTIVE_CONTEST),
    get<{ id?: string }>("setting", ADMIN_CONTEST),
    list<Contest>("contest"),
  ]);
  const fallback = remaining.find((item) => item.status === "OPEN") || remaining[0];
  if (active?.id === contest.id) {
    if (fallback) await put("setting", ACTIVE_CONTEST, { id: fallback.id });
    else await remove("setting", ACTIVE_CONTEST);
  }
  if (selected?.id === contest.id) {
    if (fallback) await put("setting", ADMIN_CONTEST, { id: fallback.id });
    else await remove("setting", ADMIN_CONTEST);
  }
  await cacheDelete("leaderboard");
}
export async function leaderboard(contest?: Contest | null) {
  const selected = contest || (await getActiveContest());
  if (!selected) return [];
  return cached("leaderboard", 5, () => buildLeaderboard(selected));
}
async function matchRoundSubmissions(contest: Contest, attempts: Attempt[]) {
  await Promise.all(attempts.map((attempt) =>
    withRecordLockRetry("submission:" + attempt.id, async () => {
      const existing = await get<Submission>("submission", attempt.id);
      const submission: Submission = existing || {
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
      const score = Number(
        codeMatchPercent(submission.source, attempt.challengeSource || contest.source).toFixed(2),
      );
      await put("submission", submission.id, {
        ...submission,
        status: "RESULT",
        score,
        error: undefined,
      });
    }),
  ));
  await cacheDelete("leaderboard");
}
async function buildLeaderboard(contest: Contest) {
  const [subs, people, attempts] = await Promise.all([
    list<Submission>("submission"),
    list<Participant>("participant"),
    list<Attempt>("attempt"),
  ]);
  const currentRound = contest?.roundId;
  const results = subs
    .filter((submission) => ["RESULT", "ERROR"].includes(submission.status) && submission.contestId === contest.id && submission.roundId === currentRound)
    .map((submission) => {
      const attempt = attempts.find((item) => item.id === submission.attemptId);
      return {
        ...submission,
        status: "RESULT" as const,
        score: Number(codeMatchPercent(submission.source, attempt?.challengeSource || contest.source).toFixed(2)),
      };
    });
  return rank(results).map((s, i) => ({
    rank: i + 1,
    id: s.id,
    score: s.score ?? 0,
    completionMs: s.completionMs,
    name: people.find((p) => p.id === s.participantId)?.name || "Participant",
    team: people.find((p) => p.id === s.participantId)?.team || "",
  }));
}
export async function participantLeaderboard() {
  const s = await session();
  let availableAt: number | null = null;
  let contest = await getActiveContest();
  let unlocked = !!s?.admin;
  const [allAttempts, allSubmissions, contests] = await Promise.all([
    list<Attempt>("attempt"),
    list<Submission>("submission"),
    list<Contest>("contest"),
  ]);
  const now = Date.now();
  if (s?.participantId && contest) {
    const hasCurrentAttempt = allAttempts.some(
      (attempt) => attempt.participantId === s.participantId && attempt.contestId === contest!.id && attempt.roundId === contest!.roundId,
    );
    if (!hasCurrentAttempt) {
      const previousAttempt = allAttempts
        .filter((attempt) => attempt.participantId === s.participantId)
        .sort((a, b) => b.startedAt - a.startedAt)[0];
      const previousContest = contests.find((item) => item.id === previousAttempt?.contestId);
      if (previousContest) contest = previousContest;
    }
  }
  const timing = contestTiming(contest);
  let codingMinutes = timing.codingMinutes;
  const currentRound = contest?.roundId;
  const attempts = allAttempts.filter((attempt) => attempt.contestId === contest?.id && attempt.roundId === currentRound);
  let submissions = allSubmissions.filter((submission) => submission.contestId === contest?.id && submission.roundId === currentRound);
  const contestEnd = attempts.length
    ? Math.max(...attempts.map((attempt) => attempt.codingEndsAt))
    : contest?.startedAt
      ? contest.startedAt + timing.readingMs + timing.codingMs
      : null;
  availableAt = contestEnd;
  const roundEnded = contestEnd !== null && now >= contestEnd;
  if (roundEnded && contest && attempts.length) {
    await matchRoundSubmissions(contest, attempts);
    submissions = (await list<Submission>("submission")).filter(
      (submission) => submission.contestId === contest.id && submission.roundId === currentRound,
    );
  }
  const submissionsByAttempt = new Map(
    submissions.map((submission) => [submission.attemptId, submission]),
  );
  const allJudged =
    attempts.every((attempt) => attempt.codingEndsAt <= now) &&
    attempts.every((attempt) => {
      const submission = submissionsByAttempt.get(attempt.id);
      return submission?.status === "RESULT" || submission?.status === "ERROR";
    });
  if (s?.participantId) {
    const attempt = await get<Attempt>(
      "attempt",
      id(s.participantId + (contest?.id || CONTEST) + (contest?.roundId || "")),
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
      return submission?.status !== "RESULT" && submission?.status !== "ERROR";
    }).length,
    serverNow: now,
    rows: unlocked ? await leaderboard(contest) : [],
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
      const [participants, teams, attempts, submissions, contests, selectedId] = await Promise.all([
        list<Participant>("participant"),
        list<{ id: string; name: string; participants?: string[] }>("team"),
        list<Attempt>("attempt"),
        list<Submission>("submission"),
        list<Contest>("contest"),
        selectedContestId(),
      ]);
      const c = contests.find((item) => item.id === selectedId) || contests.find((item) => item.id === CONTEST) || null;
      const timing = contestTiming(c);
      const roundAttempts = attempts.filter((attempt) => attempt.contestId === c?.id && attempt.roundId === c?.roundId);
      return {
        participants: participants.map((p) => {
          const a = roundAttempts.find((x) => x.participantId === p.id);
          const s = submissions.find(
            (x) => x.participantId === p.id && x.contestId === c?.id && x.roundId === c?.roundId,
          );
          return {
            ...p,
            phase: s?.status || (a ? phase(a, false) : "WAITING"),
            attempt: a ? { viewingEndsAt: a.viewingEndsAt, codingEndsAt: a.codingEndsAt } : null,
          };
        }),
        submissions: submissions.map((submission) => ({
          ...publicSubmission(submission),
          eventName: contests.find((item) => item.id === submission.contestId)?.name || "Deleted event",
        })),
        contest: c ? { ...c, ...timing } : null,
        contests: contests.map((item) => ({ ...item, ...contestTiming(item) })),
        selectedContestId: c?.id || "",
        teams,
        productionStoreConfigured: usePostgres,
        serverNow: Date.now(),
      };
    }
    if (route === "admin/contest/select" && method === "POST") {
      const eventId = String(body.eventId || "");
      if (!(await get<Contest>("contest", eventId))) throw new Error("Event not found.");
      await put("setting", ADMIN_CONTEST, { id: eventId });
      return { ok: true };
    }
    if (route === "admin/contest/create" && method === "POST") {
      const eventId = randomBytes(12).toString("hex");
      const contest: Contest = {
        id: eventId,
        name: "Compare Three Numbers",
        status: "DRAFT",
        source: `#include <stdio.h>\n\nint main(void) {\n    int first, second, third;\n    if (scanf("%d %d %d", &first, &second, &third) != 3) {\n        return 1;\n    }\n\n    if (first >= second && first >= third) {\n        printf("%d\\n", first);\n    } else if (second >= first && second >= third) {\n        printf("%d\\n", second);\n    } else {\n        printf("%d\\n", third);\n    }\n\n    return 0;\n}\n`,
        tests: [
          { input: "3 7 5\n", output: "7", points: 1 },
          { input: "12 4 9\n", output: "12", points: 1 },
          { input: "2 6 11\n", output: "11", points: 1 },
          { input: "8 8 3\n", output: "8", points: 1 },
          { input: "-4 -9 -2\n", output: "-2", points: 1 },
        ],
        readingMinutes: 5,
        codingMinutes: 15,
      };
      await create("contest", eventId, contest);
      await put("setting", ADMIN_CONTEST, { id: eventId });
      return { ok: true, eventId };
    }
    if (route === "admin/contest/status" && method === "POST") {
      const eventId = String(body.eventId || "");
      const status = String(body.status || "");
      if (!["OPEN", "CLOSED", "DRAFT"].includes(status)) throw new Error("Choose a valid event status.");
      if (status === "OPEN" && !usePostgres && process.env.NODE_ENV === "production")
        throw new Error("Configure PostgreSQL before opening a production event.");
      await withRecordLock("contest-admin", async () => {
        const event = await get<Contest>("contest", eventId);
        if (!event) throw new Error("Event not found.");
        if (status === "OPEN") {
          const contests = await list<Contest>("contest");
          if (contests.some((item) => item.id !== event.id && item.status === "OPEN"))
            throw new Error("Close the currently open event before opening another.");
          if (!event.source || !event.tests?.length) throw new Error("Save the event source and test cases before opening it.");
        }
        const reopening = status === "OPEN" && event.status !== "OPEN";
        const updated: Contest = {
          ...event,
          status: status as Contest["status"],
          startedAt: reopening ? Date.now() : event.startedAt,
          roundId: reopening ? randomBytes(12).toString("hex") : event.roundId,
        };
        await put("contest", event.id, updated);
        if (status === "OPEN") await put("setting", ACTIVE_CONTEST, { id: event.id });
        await cacheDelete("leaderboard");
      });
      return { ok: true };
    }
    if (route === "admin/contest/delete" && method === "POST") {
      await withRecordLock("contest-admin", async () => {
        const event = await get<Contest>("contest", String(body.eventId || ""));
        if (!event) throw new Error("Event not found.");
        await deleteContestRecords(event);
      });
      return { ok: true };
    }
    if (route === "admin/teams" && method === "POST") {
      const name = String(body.name || "").trim();
      if (!name) throw new Error("Enter a team name.");
      const normalizedName = name.slice(0, 100);
      const existing = await list<{ name: string }>("team");
      if (existing.some((team) => team.name.trim().toLowerCase() === normalizedName.toLowerCase()))
        throw new Error("A team with that name already exists.");
      const teamId = id("team-name:" + normalizedName.toLowerCase());
      await createGroup([
        { kind: "team", id: teamId, value: { id: teamId, name: normalizedName, participants: [] } },
      ]);
      await cacheDelete("teams-for-registration");
      return { team: { id: teamId, name: normalizedName } };
    }
    if (route === "admin/team/delete" && method === "POST") {
      const team = await get<{ id: string; participants?: string[] }>("team", String(body.teamId || ""));
      if (!team) throw new Error("Team not found.");
      const participants = await list<Participant>("participant");
      const teamMembers = participants.filter((item) => item.teamId === team.id);
      for (const participant of teamMembers) await assertParticipantCanDelete(participant.id);
      for (const participant of teamMembers)
        await deleteParticipantRecords(participant.id);
      await remove("team", team.id);
      await cacheDelete("teams-for-registration");
      return { ok: true };
    }
    if (route === "admin/participant" && method === "POST") {
      const teamId = String(body.teamId || "");
      const team = await get<{ id: string; name: string }>("team", teamId);
      if (!team) throw new Error("Choose an existing team.");
      const name = String(body.name || "").trim();
      if (!name) throw new Error("Enter the participant's name.");
      const participantId = id("participant:" + teamId + ":" + randomBytes(16).toString("hex"));
      const participant: Participant = {
        id: participantId,
        name: name.slice(0, 100),
        code: "",
        teamId,
        team: team.name,
        branch: String(body.branch || "").trim().slice(0, 100),
      };
      await sqlCreateParticipantForTeam(participantId, participant, teamId, team.name);
      return { ok: true };
    }
    if (route === "admin/participant/delete" && method === "POST") {
      const participantId = String(body.participantId || "");
      if (!(await get<Participant>("participant", participantId))) throw new Error("Participant not found.");
      await deleteParticipantRecords(participantId);
      return { ok: true };
    }
    if (route === "admin/contest" && method === "POST") {
      let previousStatus: Contest["status"] = "DRAFT";
      const eventId = String(body.eventId || (await selectedContestId()));
      await withRecordLock("contest-admin", async () => {
      const old = await get<Contest>("contest", eventId);
      if (!old) throw new Error("Select an event before saving its settings.");
      previousStatus = old.status;
      const readingMinutes = Number(body.readingMinutes);
      const codingMinutes = Number(body.codingMinutes);
      const timing = contestTiming({ readingMinutes, codingMinutes });
      if (!Number.isFinite(readingMinutes) || !Number.isInteger(readingMinutes) || readingMinutes < 1) {
        throw new Error("Reading time must be a valid positive number of minutes.");
      }
      if (!Number.isFinite(codingMinutes) || !Number.isInteger(codingMinutes) || codingMinutes < 1) {
        throw new Error("Blind coding time must be a valid positive number of minutes.");
      }
      if (
        old?.status === "OPEN" &&
        (old.readingMinutes !== timing.readingMinutes || old.codingMinutes !== timing.codingMinutes)
      )
        throw new Error("Contest timing is locked while the contest is open.");
      if (old?.status === "OPEN" && (body.source !== old.source || JSON.stringify(body.tests) !== JSON.stringify(old.tests)))
        throw new Error("Source and test cases are locked while the event is open.");
      const c: Contest = {
        ...old,
        id: eventId,
        name: String(body.name || "New event").trim().slice(0, 200),
        source: String(body.source || ""),
        tests: body.tests as Contest["tests"],
        readingMinutes: timing.readingMinutes,
        codingMinutes: timing.codingMinutes,
      };
      if (!c.name) throw new Error("Enter an event name.");
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
      await put("contest", eventId, c);
      await cacheDelete("leaderboard");
      });
      const requestedStatus = String(body.status || "");
      if (["OPEN", "CLOSED", "DRAFT"].includes(requestedStatus) && requestedStatus !== previousStatus)
        await handle("POST", "admin/contest/status", { eventId, status: requestedStatus });
      return { ok: true };
    }
    if (route === "admin/submission" && method === "POST") {
      const submission = await get<Submission>("submission", String(body.id || ""));
      if (!submission) throw new Error("Submission not found.");
      return submission;
    }
    if (route === "admin/retry" && method === "POST") {
      const submissionId = String(body.id || "");
      await withRecordLock("submission:" + submissionId, async () => {
        const submission = await get<Submission>("submission", submissionId);
        if (!submission || submission.status !== "ERROR")
          throw new Error("Only failed judge jobs can be retried.");
        await put("submission", submission.id, { ...submission, status: "QUEUED", error: undefined });
      });
      return { ok: true };
    }
    if (route === "admin/submission/delete" && method === "POST") {
      const submissionId = String(body.id || "");
      const submission = await get<Submission>("submission", submissionId);
      if (!submission) throw new Error("Submission not found.");
      if (submission.status === "QUEUED" || submission.status === "JUDGING")
        throw new Error("Wait for judging to finish before deleting this submission.");
      const attempt = await get<Attempt>("attempt", submission.attemptId);
      if (attempt) {
        if (attempt.codingEndsAt > Date.now())
          throw new Error("Wait for this event's coding deadline before deleting its submission.");
        await withRecordLock("draft:" + attempt.id, () =>
          withRecordLock("submission:" + attempt.id, async () => {
            const current = await get<Submission>("submission", submission.id);
            const currentAttempt = await get<Attempt>("attempt", attempt.id);
            if (!current || ["QUEUED", "JUDGING"].includes(current.status))
              throw new Error("Wait for judging to finish before deleting this submission.");
            if (currentAttempt?.codingEndsAt && currentAttempt.codingEndsAt > Date.now())
              throw new Error("Wait for this event's coding deadline before deleting its submission.");
            await remove("submission", submission.id);
            await remove("attempt", attempt.id);
          }),
        );
      } else await remove("submission", submission.id);
      await cacheDelete("leaderboard");
      return { ok: true };
    }
    if (route === "admin/export") {
      const contest = await get<Contest>("contest", await selectedContestId());
      return { rows: contest ? await buildLeaderboard(contest) : [] };
    }
    throw new Error("Unknown admin endpoint.");
  }
  if (route === "attempt/state" || route === "result") return state();
  const { p, a, c: currentContest } = await context();
  if (route === "attempt/start" && method === "POST") {
    if (a) return state({ p, a, c: currentContest });
    if (!usePostgres && process.env.NODE_ENV === "production")
      throw new Error("Configure PostgreSQL before starting a production contest.");
    let c = currentContest;
    if (c?.status !== "OPEN") throw new Error("The contest is not open yet.");
    if (!c) throw new Error("The contest is not open yet.");
    const timing = contestTiming(c);
    const attemptStart = Date.now();
    const attempt: Attempt = {
      id: id(p.id + c.id + (c.roundId || "")),
      participantId: p.id,
      contestId: c.id,
      roundId: c.roundId,
      startedAt: attemptStart,
      viewingEndsAt: attemptStart + timing.readingMs,
      codingEndsAt: attemptStart + timing.readingMs + timing.codingMs,
      challengeSource: c.source,
      challengeTests: c.tests,
      draft: "",
      revision: 0,
    };
    return withRecordLock("attempt:" + attempt.id, async () => {
      const existingAttempt = await get<Attempt>("attempt", attempt.id);
      if (existingAttempt) return state({ p, a: existingAttempt, c });
      await create("attempt", attempt.id, attempt);
      return state({ p, a: attempt, c });
    });
  }
  if (!a) throw new Error("Start your attempt first.");
  const existing = await get<Submission>("submission", a.id);
  const currentPhase = phase(a, !!existing);
  if (route === "attempt/source") {
    if (currentPhase !== "VIEWING")
      throw new Error("Source is unavailable after the study period.");
    const c = await get<Contest>("contest", a.contestId);
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
        contestId: a.contestId,
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
