import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const base = process.env.TEST_BASE_URL || 'http://localhost:3022';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/home/brij/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [width, height] of [[1366, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(base);
    await page.getByRole('heading', { name: /Out of sight/ }).waitFor();
    await page.waitForTimeout(800);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.locator('.memory-orbits i').count(), 3);
    await page.screenshot({ path: `/tmp/blind-release-${width}.png` });
  }
  await page.goto(base + '/login');
  assert.equal(await page.getByText('TRY THE LOCAL DEMO').count(), 0);
  await page.route('**/api/attempt/state', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary outage' }) }));
  await page.goto(base + '/contest');
  await page.waitForTimeout(1000);
  const stats = await sharp(await page.screenshot()).removeAlpha().stats();
  assert.ok(stats.channels.every(channel => channel.max === 0), 'Every pixel must be black on unknown contest state');
  assert.deepEqual(errors, []);
  console.log('PASS: desktop/mobile layout, animated hero, no demo login, pure black outage viewport, no browser exceptions');
} finally { await browser.close(); }
