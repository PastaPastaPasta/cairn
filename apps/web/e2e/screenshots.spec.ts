// Screenshots of the main pages at 2x: light and dark, desktop and phone width. Written to apps/web/screenshots/ (not committed).
import { test } from '@playwright/test';
import { listSettled, stubActivation } from './helpers.ts';

const PAGES = [
  { name: 'home', path: '/', list: true },
  { name: 'learn', path: '/learn', list: false },
  { name: 'groups', path: '/groups', list: true },
  { name: 'me', path: '/me', list: false },
  { name: 'settings', path: '/settings', list: false },
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
          if (p.list) await listSettled(page);
          if (p.name === 'home') await page.getByTestId('activation-line').filter({ hasText: 'around' }).waitFor();
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: `screenshots/${p.name}-${size.name}-${scheme}.png`, fullPage: true });
        });
      }
    });
  }
}
