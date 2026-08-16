import { test } from '@playwright/test';

test('capture more surfaces', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForTimeout(2500);
  const dismiss = page.locator('button:has-text("Start"), button:has-text("Got it"), [aria-label="Close"]').first();
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click().catch(() => {});
  await page.keyboard.press('Tab');
  await page.waitForTimeout(600);
  const starter = page.locator('button:has-text("First Light")').first();
  if (await starter.isVisible().catch(() => false)) { await starter.click(); await page.waitForTimeout(1200); }
  // mixer via the visible "Mix" button
  await page.locator('button:has-text("Mix")').first().click().catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: '/tmp/oj-shots/04-mixer.png' });
  await page.locator('button:has-text("Mix")').first().click().catch(() => {});
  // piano roll: double-click inside the keys clip by coordinates
  await page.mouse.dblclick(500, 342);
  await page.waitForTimeout(900);
  await page.screenshot({ path: '/tmp/oj-shots/05-pianoroll-inline.png' });
  // focused roll via Enter
  await page.mouse.click(500, 342);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  await page.screenshot({ path: '/tmp/oj-shots/05b-pianoroll-full.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // dark theme via localStorage + reload (theme id from oj-tokens; try 'midnight')
  await page.evaluate(() => localStorage.setItem('openjammer-theme', 'midnight'));
  await page.reload(); await page.waitForTimeout(2500);
  const d2 = page.locator('button:has-text("Start"), [aria-label="Close"]').first();
  if (await d2.isVisible().catch(() => false)) await d2.click().catch(() => {});
  await page.keyboard.press('Tab'); await page.waitForTimeout(600);
  const s2 = page.locator('button:has-text("First Light")').first();
  if (await s2.isVisible().catch(() => false)) { await s2.click(); await page.waitForTimeout(1000); }
  await page.screenshot({ path: '/tmp/oj-shots/07-arrangement-dark.png' });
});
