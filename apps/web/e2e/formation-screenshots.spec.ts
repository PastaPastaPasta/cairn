// Screenshots of the formation pages at 2x, light and dark, desktop and phone width, with real data: the testnet demo group (d400c120)
// and real Dash-Qt messages. Written to apps/web/screenshots/ (not committed).
import { readFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { CHECKER_GROUP, DEMO_GROUP, stubActivation } from './helpers.ts';

const ENVS: Array<{ name: string; text: string }> = JSON.parse(readFileSync(new URL('../../../packages/shares/test/vectors/regtest/envelopes.json', import.meta.url), 'utf8'));
const BOB_OWNER: string = JSON.parse(readFileSync(new URL('../../../packages/shares/test/vectors/regtest/mn-a.json', import.meta.url), 'utf8')).prepareArgs.shares[1].ownerAddress;
const OPERATOR = '5WUBJ5fg2owsgs7yocQSZFoGE3u4Jf6CZPU8JANRFwAJ';

const PAGES: Array<{ name: string; path: string; ready(p: Page): Promise<void> }> = [
  {
    name: 'check',
    path: '/check',
    ready: async (p) => {
      await p.getByTestId('checker-input').fill(ENVS.find((e) => e.name === 'signing')!.text);
      await p.getByTestId('verdict').waitFor();
    },
  },
  {
    name: 'check-group-stop',
    path: `/check?group=${CHECKER_GROUP}`,
    ready: async (p) => {
      await p.getByTestId('checker-my-row').waitFor({ timeout: 90_000 });
      await p.getByTestId('checker-my-row').selectOption('Bob');
      await p.getByTestId('checker-owner').fill(BOB_OWNER);
      await p.getByTestId('checker-input').fill(ENVS.find((e) => e.name === 'frozen')!.text);
      await p.getByTestId('verdict').waitFor();
    },
  },
  {
    name: 'form',
    path: `/g/${DEMO_GROUP}/form`,
    ready: async (p) => {
      await p.getByTestId('form-status').waitFor({ timeout: 90_000 });
      await p.getByText('The coordinator', { exact: true }).click();
      await p.locator('.trail-step[data-step="setup"] .trail-btn').click();
      await p.getByTestId('setup-sheet').waitFor();
      await p.getByTestId('form-status').getByRole('link').waitFor({ timeout: 120_000 });
    },
  },
  {
    name: 'form-cli',
    path: `/g/${DEMO_GROUP}/form`,
    ready: async (p) => {
      await p.getByTestId('cli-drawer').waitFor({ timeout: 90_000 });
      await p.getByTestId('cli-drawer').locator('summary').click();
      await p.getByTestId('cli').waitFor();
    },
  },
  {
    name: 'live',
    path: `/g/${DEMO_GROUP}/live`,
    ready: async (p) => {
      await p.getByTestId('mn-state').waitFor({ timeout: 150_000 });
    },
  },
  {
    name: 'operator-track-record',
    path: `/operators/${OPERATOR}`,
    ready: async (p) => {
      await p.getByTestId('track-summary').waitFor({ timeout: 150_000 });
    },
  },
];
const SIZES = [
  { name: 'desktop', viewport: { width: 1280, height: 860 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const size of SIZES) {
    test.describe(`formation ${scheme} ${size.name}`, () => {
      test.use({ viewport: size.viewport, deviceScaleFactor: 2, colorScheme: scheme, isMobile: size.name === 'mobile', hasTouch: size.name === 'mobile' });
      for (const p of PAGES) {
        test(p.name, async ({ page }) => {
          test.setTimeout(240_000);
          await stubActivation(page);
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await page.goto(p.path);
          await page.locator('h1').first().waitFor();
          await p.ready(page);
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: `screenshots/formation-${p.name}-${size.name}-${scheme}.png`, fullPage: true });
        });
      }
    });
  }
}
