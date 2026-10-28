import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const base = "http://localhost:3052";
const server = spawn(process.execPath, [".next/standalone/server.js"], {
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: "3052",
    BACKEND_URL: "",
    REQUIRE_GATEWAY: "true",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let serverError = "";
server.stderr.on("data", (d) => (serverError += d));
let browser;
try {
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, serverError || "UI verification server did not start");
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      "/home/brij/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let calls = 0;
  await page.route("**/api/leaderboard", async (route) => {
    const now = Date.now();
    calls++;
    const locked = calls === 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        locked,
        serverNow: now,
        availableAt: locked ? now + 2500 : now - 1,
        rows: locked
          ? []
          : [
              {
                id: "verification",
                name: "Verification participant",
                team: "Test team",
                score: 95,
                completionMs: 60000,
                rank: 1,
              },
            ],
      }),
    });
  });
  await page.goto(base + "/leaderboard");
  await page
    .getByRole("heading", { name: "The leaderboard opens after your 15 minutes." })
    .waitFor();
  assert.equal(await page.getByRole("cell", { name: /Verification participant/ }).count(), 0);
  await page.screenshot({ path: "/tmp/blind-leaderboard-waiting.png" });
  await page.getByRole("cell", { name: /Verification participant/ }).waitFor();
  assert.ok(calls >= 2, "Leaderboard must recheck the API automatically");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: "/tmp/blind-leaderboard-released.png" });
  console.log(
    "PASS: waiting page hides ranking rows, automatically rechecks at the deadline, and displays released rankings without a manual refresh. API responses are mocked in this UI check.",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  if (server.exitCode === null) server.kill("SIGKILL");
}
