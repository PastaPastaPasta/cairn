// Screenshots of the matching and agreeing pages at 2x: light and dark, desktop and phone width, signed out. The group and operator
// pages show the testnet demo group the live run left in place. Written to apps/web/screenshots/matching/ (not committed).
// Signed-in views come from screenshots-matching-live.spec.ts.
import { test } from '@playwright/test';
import { DEMO_GROUP, DEMO_OPERATOR } from './demo.ts';
import { listSettled, stubActivation } from './helpers.ts';

const PAGES = [
  { name: 'groups', path: '/groups', settle: listSettled },
  { name: 'groups-new', path: '/groups/new' },
  { name: 'groups-amount', path: '/groups?amount=300', testId: 'start-card' },
  { name: 'operators', path: '/operators', settle: listSettled },
  { name: 'operator', path: `/operators/${DEMO_OPERATOR}`, testId: 'track-summary' },
  { name: 'group', path: `/g/${DEMO_GROUP}`, testId: 'group-status' },
  { name: 'me', path: '/me' },
];
const SIZES = [
  { name: 'desktop', viewport: { width: 1280, height: 860 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const size of SIZES) {
    test.describe(`${scheme} ${size.name}`, () => {
      test.use({ viewport: size.viewport, deviceScaleFactor: 2, colorScheme: scheme, isMobile: size.name === 'mobile', hasTouch: size.name === 'mobile' });
      for (const p of PAGES) {
        test(p.name, async ({ page }) => {
          await stubActivation(page);
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await page.goto(p.path);
          await page.locator('h1').first().waitFor();
          if (p.settle) await p.settle(page);
          if (p.testId) await page.getByTestId(p.testId).waitFor({ timeout: 60_000 });
          await page.locator('.person-name.mono-ish').first().waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {});
          await page.locator('.list-status [role="status"], .spinner').first().waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: `screenshots/matching/${p.name}-${size.name}-${scheme}.png`, fullPage: true });
        });
      }
    });
  }
}
