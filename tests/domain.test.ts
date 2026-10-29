import { test } from "node:test";
import assert from "node:assert/strict";
import {
  phase,
  validateSubmission,
  rank,
  leaderboardReleased,
  ContestTiming,
  contestTiming,
  Attempt,
} from "../lib/domain";
import { similarity } from "../judge/scoring";
const a: Attempt = {
  id: "a",
  participantId: "p",
  contestId: "c",
  startedAt: 0,
  viewingEndsAt: 300000,
  codingEndsAt: 1200000,
  draft: "",
  revision: 0,
};
test("exact phase boundaries use absolute server deadlines", () => {
  assert.equal(phase(a, false, 299999), "VIEWING");
  assert.equal(phase(a, false, 300000), "CODING");
  assert.equal(phase(a, false, 1199999), "CODING");
  assert.equal(phase(a, false, 1200000), "EXPIRED");
  assert.equal(phase(a, true, 400000), "SUBMITTED");
});
test("reject early, late and oversized submissions", () => {
  assert.throws(() => validateSubmission(a, 299999, "int main(){}"));
  assert.throws(() => validateSubmission(a, 1200000, ""));
  assert.throws(() => validateSubmission(a, 500000, "a".repeat(32769)));
  assert.doesNotThrow(() => validateSubmission(a, 500000, ""));
});
test("accuracy ranks before speed and speed breaks ties", () => {
  assert.deepEqual(
    rank([
      { id: "a", score: 95, completionMs: 760000 },
      { id: "b", score: 95, completionMs: 622000 },
      { id: "c", score: 94, completionMs: 495000 },
    ]).map((x) => x.id),
    ["b", "a", "c"],
  );
});
test("structure ignores formatting, awards partial credit, and penalizes empty source", () => {
  assert.equal(similarity("int main(){return 0;}", "int main() { /*hello*/ return 0; }"), 1);
  assert.equal(similarity("int main(){return 0;}", ""), 0);
  const partial = similarity("int main(){ int n; return 0;}", "int main(){");
  assert.ok(partial > 0 && partial < 1);
});

test("default contest timing is five minutes reading and fifteen minutes coding", () => {
  const t = contestTiming();
  assert.deepEqual(t, { readingMinutes: 5, codingMinutes: 15, readingMs: 300000, codingMs: 900000 });
});

test("one-minute contest windows remain valid and are not reset to defaults", () => {
  const t = contestTiming({ readingMinutes: 1, codingMinutes: 1 } as ContestTiming);
  assert.deepEqual(t, { readingMinutes: 1, codingMinutes: 1, readingMs: 60000, codingMs: 60000 });
});

test("custom contest timing clamps to valid ranges", () => {
  const t = contestTiming({ readingMinutes: 2, codingMinutes: 8 } as ContestTiming);
  assert.deepEqual(t, { readingMinutes: 2, codingMinutes: 8, readingMs: 120000, codingMs: 480000 });
  assert.deepEqual(contestTiming({ readingMinutes: 0, codingMinutes: 0 } as ContestTiming), {
    readingMinutes: 5,
    codingMinutes: 15,
    readingMs: 300000,
    codingMs: 900000,
  });
});

test("early submission never unlocks leaderboard before the coding deadline", () => {
  assert.equal(leaderboardReleased(a, a.viewingEndsAt), false);
  assert.equal(leaderboardReleased(a, a.viewingEndsAt + 60000), false);
  assert.equal(leaderboardReleased(a, a.codingEndsAt - 1), false);
  assert.equal(leaderboardReleased(a, a.codingEndsAt), true);
  assert.equal(leaderboardReleased(a, a.codingEndsAt + 1), true);
});
