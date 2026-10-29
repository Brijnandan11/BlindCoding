export const DEFAULT_READING_MINUTES = 5;
export const DEFAULT_CODING_MINUTES = 15;
export const STUDY_SECONDS = DEFAULT_READING_MINUTES * 60;
export const CODING_SECONDS = DEFAULT_CODING_MINUTES * 60;
export const MAX_SOURCE_BYTES = 32768;
export type ContestTiming = {
  readingMinutes: number;
  codingMinutes: number;
  readingMs: number;
  codingMs: number;
};
export type Contest = {
  id: string;
  name: string;
  status: "DRAFT" | "OPEN" | "CLOSED";
  source: string;
  tests: { input: string; output: string; points: number }[];
  readingMinutes?: number;
  codingMinutes?: number;
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
export function contestTiming(input?: Partial<ContestTiming | Contest> | null): ContestTiming {
  const rawReadingMinutes = Number(input?.readingMinutes ?? DEFAULT_READING_MINUTES);
  const rawCodingMinutes = Number(input?.codingMinutes ?? DEFAULT_CODING_MINUTES);
  const readingMinutes = Number.isFinite(rawReadingMinutes) && rawReadingMinutes >= 1
    ? rawReadingMinutes
    : DEFAULT_READING_MINUTES;
  const codingMinutes = Number.isFinite(rawCodingMinutes) && rawCodingMinutes >= 1
    ? rawCodingMinutes
    : DEFAULT_CODING_MINUTES;
  return {
    readingMinutes,
    codingMinutes,
    readingMs: readingMinutes * 60 * 1000,
    codingMs: codingMinutes * 60 * 1000,
  };
}
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
