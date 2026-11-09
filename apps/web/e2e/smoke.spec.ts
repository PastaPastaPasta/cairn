import { expect, test } from '@playwright/test';
import { DEMO_GROUP, collectErrors, listSettled, stubActivation } from './helpers.ts';

const ROUTES: Array<[string, RegExp]> = [
  ['/', /Build a masternode together/],
  ['/groups', /^Find your group$/],
  ['/groups/new', /Open a group/],
  ['/g/4EfA9Jrvv3nnCFdSf7fad59851iiTRZ6Wcu6YVJ4iSeF', /Group 4EfA9J/],
  ['/g/4EfA9Jrvv3nnCFdSf7fad59851iiTRZ6Wcu6YVJ4iSeF/form', /Form the masternode/],
  ['/g/4EfA9Jrvv3nnCFdSf7fad59851iiTRZ6Wcu6YVJ4iSeF/live', /Live masternode/],
  ['/looking', /^Find your group$/],
  ['/operators', /^Operators$/],
  ['/operators/4EfA9Jrvv3nnCFdSf7fad59851iiTRZ6Wcu6YVJ4iSeF', /Operator 4EfA9J/],
  ['/me', /My Cairn/],
  ['/check', /Check a Dash Core message/],
  ['/learn', /How shared masternodes work/],
  ['/settings', /Settings/],
  ['/no-such-page', /Nothing here/],
];

test.describe('every route renders', () => {
  for (const [path, h1] of ROUTES) {
    test(path, async ({ page }) => {
      const errors = collectErrors(page);
      await stubActivation(page);
      await page.goto(path);
      await expect(page.locator('h1')).toHaveText(h1);
      await expect(page.locator('header.top')).toBeVisible();
      await expect(page.locator('footer')).toContainText('Cairn never holds your coins or keys.');
      expect(errors).toEqual([]);
    });
  }
});

test('the strict CSP is in the built page', async ({ page }) => {
  await page.goto('/');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("font-src 'self'");
  expect(csp).toContain("connect-src 'self' https:;");
  expect(csp).not.toMatch(/http:|localhost|127\.0\.0\.1/);
});

test('fonts come from this origin only', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.resourceType() === 'font' && u.host !== new URL(page.url() || 'http://localhost').host) outside.push(r.url());
  });
  await stubActivation(page);
  await page.goto('/learn');
  await page.evaluate(() => document.fonts.ready);
  expect(outside).toEqual([]);
  expect(await page.evaluate(() => document.fonts.check('700 40px "Bricolage Grotesque Variable"'))).toBe(true);
});

const onMainnet = (page: import('@playwright/test').Page) => page.addInitScript(() => localStorage.setItem('cairn.profile.v1', 'mainnet'));

test('home shows the sample cairn in words and mainnet in one line on testnet', async ({ page }) => {
  await stubActivation(page);
  await page.goto('/');
  await expect(page.locator('.hero figcaption')).toHaveText('A sample group: 650 of 1000 DASH. Your 100 makes 750; 250 more and it’s full.');
  await expect(page.locator('.hero .cairn-legend li')).toHaveCount(5);
  await expect(page.locator('.hero .stone-open-label')).toHaveText('250 open');
  await expect(page.getByTestId('activation-line')).toContainText('Mainnet opens after Dash Core v24 activates there (around');
  await expect(page.getByTestId('activation-card')).toHaveCount(0);
});

test('the mainnet home shows the activation card, and it degrades when Radar does not answer', async ({ page }) => {
  await onMainnet(page);
  await stubActivation(page);
  await page.goto('/');
  await expect(page.getByTestId('activation-card')).toContainText('Waiting for mainnet signalling');
  await page.unroute('https://nodes.dashhq.org/api/v1/mainnet/activation');
  await stubActivation(page, null);
  await page.reload();
  await expect(page.getByTestId('activation-card')).toContainText('Mainnet status unavailable right now');
});

test('mainnet without a contract is read-only, testnet is the default', async ({ page }) => {
  await stubActivation(page);
  await page.goto('/groups');
  await expect(page.getByTestId('network-pill')).toContainText('Testnet');
  await page.goto('/settings');
  await page.getByTestId('net-mainnet').check();
  await expect(page.getByTestId('network-pill')).toContainText('Mainnet');
  await page.goto('/groups');
  await expect(page.getByTestId('not-open-here')).toBeVisible();
  await expect(page.getByTestId('signin-button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch to Testnet' }).click();
  await expect(page.getByTestId('network-pill')).toContainText('Testnet');
});

test('testnet lists read the registered contract', async ({ page }) => {
  await stubActivation(page);
  await page.goto('/groups');
  await listSettled(page);
  await expect(page.locator('.list-status.error')).toHaveCount(0);
});

test('the sign-in sheet opens from the header and offers every way in', async ({ page }) => {
  await stubActivation(page);
  await page.goto('/');
  await page.getByTestId('signin-button').click();
  const sheet = page.locator('dialog.sheet[open]');
  await expect(sheet).toBeVisible();
  for (const t of ['Create an account', 'I have a Cairn account phrase', 'Use a passkey', 'Paste a key']) await expect(sheet.getByRole('button', { name: new RegExp(t) })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('keyboard: skip link and nav are reachable', async ({ page }) => {
  await stubActivation(page);
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  for (const path of ['/', '/groups', `/g/${DEMO_GROUP}`, `/g/${DEMO_GROUP}/form`, '/check', '/settings'])
    test(`${path} does not scroll sideways`, async ({ page }) => {
      await stubActivation(page);
      await page.goto(path);
      await page.locator('h1').first().waitFor();
      if (path.endsWith('/form')) await page.getByTestId('form-status').waitFor({ timeout: 90_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    });
});

test('the form page is a trail of steps with the checker beside it', async ({ page }) => {
  test.setTimeout(150_000);
  await stubActivation(page);
  await page.goto(`/g/${DEMO_GROUP}/form`);
  const trail = page.getByTestId('form-status');
  await expect(trail.locator('.trail-step')).toHaveCount(7, { timeout: 90_000 });
  await expect(trail.locator('.trail-step[data-step="agree"]')).toHaveClass(/is-done/);
  await expect(page.locator('#checker [data-testid="checker-input"]')).toBeVisible();
  // one step open at a time; opening another closes it
  await expect(trail.locator('.trail-body:not([hidden])')).toHaveCount(1);
  await trail.locator('.trail-step[data-step="round2"] .trail-btn').click();
  await expect(trail.locator('.trail-step[data-step="round2"] .trail-btn')).toHaveAttribute('aria-expanded', 'true');
  await expect(trail.locator('.trail-body:not([hidden])')).toHaveCount(1);
  await page.getByRole('button', { name: 'Check this round’s message' }).click();
  await expect(page.locator('#checker [data-testid="checker-input"]')).toBeFocused();
  // the coordinator's view folds in the setup sheet
  await page.getByText('The coordinator', { exact: true }).click();
  await trail.locator('.trail-step[data-step="setup"] .trail-btn').click();
  await expect(trail.locator('.trail-step[data-step="setup"]').getByTestId('setup-sheet')).toContainText('Participants');
});
