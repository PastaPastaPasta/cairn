// Signed-in screenshots at 2x (light and dark, desktop and phone width) of the demo group as its organizer and as a member, of /me,
// /looking and the new-group form. Live: it signs in the demo identities from the secret store; it writes nothing.
// CAIRN_LIVE=1 npx playwright test e2e/screenshots-matching-live.spec.ts
import { test, type Page } from '@playwright/test';
import { DEMO_GROUP } from './demo.ts';
import { go, signedIn } from './live-helpers.ts';

test.setTimeout(20 * 60_000);

const SIZES = [
  { name: 'desktop', width: 1280, height: 860 },
  { name: 'mobile', width: 390, height: 844 },
];

async function shoot(page: Page, path: string, name: string, ready: (p: Page) => Promise<unknown>) {
  for (const scheme of ['light', 'dark'] as const) {
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await go(page, path);
      await ready(page);
      await page.locator('.list-status [role="status"]').first().waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `screenshots/matching/${name}-${size.name}-${scheme}.png`, fullPage: true });
    }
  }
}

test('@live signed-in screenshots of the matching pages', async ({ browser }) => {
  const opts = { deviceScaleFactor: 2 };
  const op = await signedIn(browser, 'cairn/testnet-matching-operator', 'operator', opts);
  const a = await signedIn(browser, 'cairn/testnet-matching-member-a', 'member A', opts);
  // names arrive after the documents (profiles and DPNS): wait until the roster shows them
  const group = async (p: Page) => {
    await p.getByTestId('next-steps').waitFor({ timeout: 120_000 });
    await p.getByTestId('roster').locator('.person-name.mono-ish').first().waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {});
  };
  await shoot(op.page, `/g/${DEMO_GROUP}`, 'group-organizer', group);
  await shoot(a.page, `/g/${DEMO_GROUP}`, 'group-member', group);
  await shoot(a.page, '/me', 'me-member', (p) => p.getByTestId('my-groups').waitFor({ timeout: 120_000 }));
  await shoot(op.page, '/me', 'me-operator', (p) => p.getByTestId('my-operator').waitFor({ timeout: 120_000 }));
  await shoot(a.page, '/looking', 'looking-signed-in', (p) => p.getByTestId('looking-rows').or(p.locator('.empty-state')).first().waitFor({ timeout: 120_000 }));
  await shoot(a.page, '/groups/new', 'groups-new-form', (p) => p.getByTestId('new-group-form').waitFor());
});
