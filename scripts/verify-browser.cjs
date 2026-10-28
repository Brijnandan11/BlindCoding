const { chromium } = require("@playwright/test");
const fs = require("fs/promises");
const crypto = require("crypto");
const assert = require("node:assert/strict");
const base = process.env.TEST_BASE_URL || "http://localhost:3001";
const id = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);
(async () => {
  const config = await fetch(base + "/api/config").then((r) => r.json());
  assert.equal(config.demo, true, "Refusing to modify a live contest.");
  const browser = await chromium.launch({
    executablePath: "/home/brij/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: "/tmp/blind-coding-desktop.png", fullPage: true });
  assert.equal(await page.locator("h1").innerText(), "Out of sight.\nInto memory._");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/blind-coding-mobile.png", fullPage: true });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "Mobile page overflows",
  );
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(base + "/admin");
  await page.locator("#password").fill("demo-admin");
  await page.getByRole("button", { name: "Enter dashboard" }).click();
  await page.getByRole("button", { name: "Team management" }).waitFor();
  await page.getByRole("button", { name: "Team management" }).click();
  const suffix = Date.now();
  await page.locator('[name="team"]').fill("QA " + suffix);
  for (let n = 1; n <= 3; n++)
    await page.locator('[name="p' + n + '"]').fill("QA Participant " + n);
  await page.getByRole("button", { name: "Create team & codes" }).click();
  const msg = await page.locator(".success-message").innerText();
  const code = msg.match(/BC-[A-F0-9]+-01/)[0];
  await page.goto(base + "/login");
  await page.locator("#code").fill(code);
  await page.getByRole("button", { name: "Enter contest", exact: true }).click();
  await page.waitForURL("**/instructions");
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Start my 5 minutes" }).click();
  await page.waitForURL("**/contest");
  await page.waitForFunction(() =>
    document.querySelector(".study-code pre")?.textContent.includes("#include"),
  );
  assert.ok((await page.locator(".study-code pre").innerText()).includes("#include"));
  let state = await page.evaluate(() => fetch("/api/attempt/state").then((r) => r.json()));
  const file = ".data/attempt-" + state.attempt.id + ".json";
  const a = JSON.parse(await fs.readFile(file, "utf8"));
  a.viewingEndsAt = Date.now() - 1000;
  a.codingEndsAt = Date.now() + 900000;
  await fs.writeFile(file, JSON.stringify(a));
  await page.reload();
  await page.locator(".blind-input").waitFor();
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.querySelector(".black-screen")).backgroundColor,
    ),
    "rgb(0, 0, 0)",
  );
  assert.equal(await page.locator(".black-screen").innerText(), "");
  assert.equal(await page.locator(".study-code").count(), 0);
  assert.equal(await page.evaluate(() => fetch("/api/attempt/source").then((r) => r.status)), 400);
  await page.keyboard.type("int main(){return 0;}");
  await page.waitForTimeout(2500);
  assert.equal(await page.locator(".blind-input").inputValue(), "int main(){return 0;}");
  await page.screenshot({ path: "/tmp/blind-coding-black.png" });
  const pixels = await require("sharp")("/tmp/blind-coding-black.png").removeAlpha().stats();
  assert.ok(
    pixels.channels.every((c) => c.max === 0),
    "Black viewport contains visible pixels",
  );
  await page.reload();
  await page.locator(".blind-input").waitFor();
  await page.waitForTimeout(700);
  assert.equal(await page.locator(".blind-input").inputValue(), "int main(){return 0;}");
  await page.keyboard.press("Control+Enter");
  await page.waitForURL("**/result");
  await page.getByRole("heading", { name: "Submission received." }).waitFor();
  assert.equal(
    await page.evaluate(() =>
      fetch("/api/submission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "again" }),
      }).then((r) => r.status),
    ),
    403,
  );
  state = await page.evaluate(() => fetch("/api/result").then((r) => r.json()));
  assert.equal(state.submission.status, "QUEUED");
  assert.ok(state.submission.completionMs > 0);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: desktop/mobile layout, admin team creation, participant login, study source, black screen, hidden input, autosave, refresh recovery, keyboard submit, duplicate rejection.",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
