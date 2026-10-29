import { existsSync } from "node:fs";
process.env.FORCE_NODE_FETCH = "1";
for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
const { register } = await import("tsx/esm/api");
register();
const { get, create, put, list, remove: removeRecord } = await import("../lib/store.ts");
const { SAMPLE_SOURCE } = await import("./verification-source.mjs");
const { createHash } = await import("node:crypto");
const { chromium } = await import("@playwright/test");
const assert = (await import("node:assert/strict")).default;
const base = process.env.TEST_BASE_URL || "http://localhost:3001";
if (process.env.DATABASE_URL && !String(process.env.STORE_TABLE_ID || "").startsWith("load-"))
  throw new Error("PostgreSQL browser verification requires an isolated load-test table.");
const original = await get("contest", "contest-main");
assert.equal(
  (await list("attempt")).length,
  0,
  "Run live verification before real contest attempts exist.",
);
assert.notEqual(original?.status, "OPEN", "Close the contest before controlled verification.");
const fixture = original || {
  id: "contest-main",
  name: "Blind Coding 2026",
  status: "DRAFT",
  source: SAMPLE_SOURCE,
  tests: [
    { input: "5\n", output: "15", points: 1 },
    { input: "10\n", output: "55", points: 1 },
    { input: "1\n", output: "1", points: 1 },
    { input: "100\n", output: "5050", points: 1 },
  ],
};
if (!original) await create("contest", fixture.id, fixture);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ||
    "/home/brij/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let people = [],
  attemptId,
  teamId,
  adminToken;
const attemptIds = [];
const sessions = [];
async function request(route, method = "GET", data) {
  const r = await context.request.fetch(base + "/api/" + route, {
    method,
    data,
    headers: { Origin: base },
  });
  const body = await r.json();
  assert.ok(r.ok(), route + ": " + JSON.stringify(body));
  return body;
}
async function collectSession() {
  const token = (await context.cookies()).find((c) => c.name === "bc_session")?.value;
  if (token) sessions.push(createHash("sha256").update(token).digest("hex").slice(0, 32));
}
async function saveContest(status) {
  const r = await context.request.fetch(base + "/api/admin/contest", {
    method: "POST",
    data: {
      name: fixture.name,
      source: fixture.source,
      status,
      readingMinutes: fixture.readingMinutes || 5,
      codingMinutes: fixture.codingMinutes || 15,
      tests: fixture.tests,
    },
    headers: { Origin: base, Cookie: "bc_session=" + adminToken },
  });
  const body = await r.json();
  assert.ok(r.ok(), "admin/contest: " + JSON.stringify(body));
  return body;
}
async function remove(kind, id) {
  await removeRecord(kind, id);
}

try {
  await page.goto(base + "/admin");
  await page.locator("#password").fill(process.env.ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Enter dashboard" }).click();
  await page.getByRole("button", { name: "Team management" }).waitFor();
  adminToken = (await context.cookies()).find((cookie) => cookie.name === "bc_session")?.value;
  assert.ok(adminToken, "Admin session was not created.");
  await collectSession();
  const overview = await request("admin/overview");

  await page.getByRole("button", { name: "Team management" }).click();
  await page.locator("[name=team]").fill("Verification fixture");
  for (let i = 1; i <= 3; i++)
    await page.locator("[name=p" + i + "]").fill("Verification Participant " + i);
  const teamResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/admin/teams") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create team & codes" }).click();
  const response = await teamResponse;
  assert.ok(response.ok());
  people = (await response.json()).participants;
  teamId = people[0].teamId;
  await saveContest("OPEN");
  await page.goto(base + "/login");
  await page.locator("#code").fill(people[0].code);
  await page.getByRole("button", { name: "Enter contest", exact: true }).click();
  await page.waitForURL("**/instructions");
  await collectSession();
  await page.locator("input[type=checkbox]").check();
  await page.getByRole("button", { name: "Start my 5 minutes" }).click();
  await page.waitForURL("**/contest");
  await page.waitForFunction(() =>
    document.querySelector(".study-code pre")?.textContent.includes("#include"),
  );
  const state = await request("attempt/state");
  attemptId = state.attempt.id;
  attemptIds.push(attemptId);
  assert.equal(state.phase, "VIEWING");
  assert.equal(state.attempt.viewingEndsAt - state.attempt.startedAt, 300000);
  assert.equal(state.attempt.codingEndsAt - state.attempt.viewingEndsAt, 900000);
  const attempt = await get("attempt", attemptId);
  await put("attempt", attemptId, {
    ...attempt,
    viewingEndsAt: Date.now() - 1000,
    codingEndsAt: Date.now() + 900000,
  });
  let releaseRestore;
  const restoreGate = new Promise((resolve) => {
    releaseRestore = resolve;
  });
  let delayedRestore = false;
  await page.route("**/api/attempt/draft", async (route) => {
    if (route.request().method() === "GET" && !delayedRestore) {
      delayedRestore = true;
      await restoreGate;
    }
    await route.continue();
  });
  await page.reload();
  await page.locator(".blind-input").waitFor();
  await page.keyboard.insertText(fixture.source);
  releaseRestore();
  await page.waitForTimeout(1500);
  const sourceResponse = await context.request.get(base + "/api/attempt/source");
  assert.ok([400, 403].includes(sourceResponse.status()));
  const saveDeadline = Date.now() + 30000;
  let saved;
  while (Date.now() < saveDeadline) {
    saved = await get("attempt", attemptId);
    if (saved.draft === fixture.source) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(saved.draft, fixture.source, "Typing during draft restoration must be preserved.");
  await page.reload();
  await page.locator(".blind-input").waitFor();
  await page.waitForFunction(
    (expected) => document.querySelector("textarea")?.value === expected,
    fixture.source,
  );
  await page.screenshot({ path: "/tmp/blind-live-black.png" });
  const sharp = (await import("sharp")).default;
  assert.ok(
    (await sharp("/tmp/blind-live-black.png").removeAlpha().stats()).channels.every(
      (c) => c.max === 0,
    ),
  );
  let injectedResultFailure = false;
  await page.route("**/api/result", async (route) => {
    if (!injectedResultFailure) {
      injectedResultFailure = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary verification network failure" }),
      });
    } else await route.continue();
  });
  await page.keyboard.press("Control+Enter");
  await page.waitForURL("**/result");
  assert.equal(
    (
      await context.request.post(base + "/api/submission", {
        data: { source: "again" },
        headers: { Origin: base },
      })
    ).status(),
    409,
  );
  console.log(
    "PASS: live PostgreSQL authentication, team creation, deadlines, source cutoff, pure-black viewport, hidden input, draft persistence/recovery, keyboard submission, duplicate rejection.",
  );
  const deadline = Date.now() + 300000;
  let submission;
  while (Date.now() < deadline) {
    try {
      submission = await get("submission", attemptId);
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    if (submission?.status === "RESULT") break;
    if (submission?.status === "ERROR") throw new Error("Judge failed: " + submission.error);
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.equal(submission?.status, "RESULT", "Judge did not finish within five minutes");
  assert.equal(submission.score, 100);
  assert.equal(submission.functional, 50);
  assert.equal(submission.structure, 30);
  assert.equal(submission.syntax, 20);
  console.log(
    "Verified judge score:",
    submission.score,
    "UI:",
    await page.locator("h1").innerText(),
  );
  await page.screenshot({ path: "/tmp/blind-live-result.png" });
  await page.getByText("FINAL ACCURACY", { exact: true }).waitFor();
  assert.equal(injectedResultFailure, true);
  await page.goto(base + "/leaderboard");
  await page
    .getByRole("heading", { name: "The leaderboard opens after your 15 minutes." })
    .waitFor();
  const lockedBoard = await request("leaderboard");
  assert.equal(lockedBoard.locked, true);
  assert.equal(lockedBoard.rows.length, 0);
  const completedAttempt = await get("attempt", attemptId);
  await put("attempt", attemptId, { ...completedAttempt, codingEndsAt: Date.now() - 1 });
  await page.reload();
  await page.getByText(people[0].name, { exact: false }).waitFor();
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: typing during draft restoration and result recovery after a simulated request failure.",
  );
  console.log(
    "PASS: PostgreSQL → BullMQ → isolated GCC sandbox → 100/100 result → individual leaderboard.",
  );
  const firstRound = await get("attempt", attemptId);
  await saveContest("CLOSED");
  await saveContest("OPEN");
  const repeatedState = await request("attempt/start", "POST", {});
  const repeatedAttemptId = repeatedState.attempt.id;
  attemptIds.push(repeatedAttemptId);
  assert.notEqual(repeatedAttemptId, attemptId, "A retake must create a separate attempt record.");
  const repeatedAttempt = await get("attempt", repeatedAttemptId);
  assert.notEqual(repeatedAttempt.roundId, firstRound.roundId, "A retake must create a new round.");
  await put("attempt", repeatedAttemptId, {
    ...repeatedAttempt,
    viewingEndsAt: Date.now() - 1000,
    codingEndsAt: Date.now() + 900000,
  });
  await request("submission", "POST", { source: fixture.source });
  const repeatDeadline = Date.now() + 300000;
  let repeatedSubmission;
  while (Date.now() < repeatDeadline) {
    repeatedSubmission = await get("submission", repeatedAttemptId);
    if (repeatedSubmission?.status === "RESULT") break;
    if (repeatedSubmission?.status === "ERROR") throw new Error("Retake judge failed: " + repeatedSubmission.error);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.equal(repeatedSubmission?.status, "RESULT", "Retake judge did not finish within five minutes");
  assert.equal(repeatedSubmission.score, 100);
  console.log("PASS: the same participant completed a second contest round and received a separate score.");
} finally {
  await browser.close();
  for (const id of attemptIds) {
    await remove("submission", id).catch((e) => console.error("Test cleanup:", e.message));
    await remove("attempt", id).catch((e) => console.error("Test cleanup:", e.message));
  }
  for (const person of people)
    await remove("participant", person.id).catch((e) => console.error("Test cleanup:", e.message));
  if (teamId) await remove("team", teamId).catch((e) => console.error("Test cleanup:", e.message));
  for (const session of sessions)
    await remove("session", session).catch((e) => console.error("Test cleanup:", e.message));
  await put("contest", fixture.id, { ...fixture, status: original?.status || "DRAFT" });
}
