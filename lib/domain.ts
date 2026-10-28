export const STUDY_SECONDS = 300;
export const CODING_SECONDS = 900;
export const MAX_SOURCE_BYTES = 32768;
export type Contest = {
  id: string;
  name: string;
  status: "DRAFT" | "OPEN" | "CLOSED";
  source: string;
  tests: { input: string; output: string; points: number }[];
};
export type Participant = { id: string; name: string; code: string; teamId: string; team: string; branch?: string };
export type Attempt = {
  id: string;
  participantId: string;
  contestId: string;
  startedAt: number;
  viewingEndsAt: number;
  codingEndsAt: number;
  draft: string;
  revision: number;
};
export type Submission = {
  id: string;
  attemptId: string;
  participantId: string;
  contestId: string;
  source: string;
  submittedAt: number;
  completionMs: number;
  status: "QUEUED" | "JUDGING" | "RESULT" | "ERROR";
  score?: number;
  functional?: number;
  structure?: number;
  syntax?: number;
  error?: string;
  tests?: { passed: boolean; error?: string }[];
};
export function phase(a: Attempt, submitted: boolean, now = Date.now()) {
  if (submitted) return "SUBMITTED";
  if (now < a.viewingEndsAt) return "VIEWING";
  if (now < a.codingEndsAt) return "CODING";
  return "EXPIRED";
}
export function validateSubmission(a: Attempt, now: number, source: string) {
  if (phase(a, false, now) !== "CODING")
    throw new Error("Submissions are accepted only during the coding period.");
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES)
    throw new Error("Code exceeds the 32 KB limit.");
}
export function rank<T extends { score?: number; completionMs: number; id: string }>(rows: T[]) {
  return [...rows].sort(
    (a, b) =>
      (b.score ?? 0) - (a.score ?? 0) ||
      a.completionMs - b.completionMs ||
      a.id.localeCompare(b.id),
  );
}

// Submission time never advances the participant leaderboard release.
export function leaderboardReleased(attempt: Pick<Attempt, "codingEndsAt">, now = Date.now()) {
  return now >= attempt.codingEndsAt;
}
