import { existsSync } from "node:fs";
for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import sharp from "sharp";
const base = process.env.TEST_BASE_URL || "http://localhost:3010";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ||
    "/home/brij/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  assert.equal((await (await page.request.get(base + "/api/config")).json()).ready, true);
  await page.route("**/api/attempt/state", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Verification temporary outage" }),
    }),
  );
  await page.goto(base + "/contest");
  await page.waitForTimeout(1000);
  const image = await page.screenshot();
  assert.ok(
    (await sharp(image).removeAlpha().stats()).channels.every((channel) => channel.max === 0),
    "An unknown contest state must stay black during an outage",
  );
  await page.unroute("**/api/attempt/state");
  await page.goto(base + "/");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "/tmp/blind-coding-final-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "/tmp/blind-coding-final-mobile.png" });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(base + "/admin");
  await page.locator("#password").fill(process.env.ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Enter dashboard" }).click();
  await page.getByRole("button", { name: "Team management" }).waitFor();
  const overview = await (await page.request.get(base + "/api/admin/overview")).json();

  assert.equal(overview.contest.status, "DRAFT");
  assert.equal(overview.submissions.length, 0);
  assert.ok(!overview.participants.some((p) => p.team === "Verification fixture"));
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.locator("#password").waitFor();
  assert.equal((await page.request.get(base + "/api/admin/overview")).status(), 401);
  console.log(
    "PASS: production PostgreSQL connection, black viewport on state outage, desktop/mobile layout, clean DRAFT contest, admin login, revoked logout session.",
  );
} finally {
  await browser.close();
}
