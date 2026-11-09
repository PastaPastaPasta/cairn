// Signed-out and visitor flows on real testnet groups: a co-owner who opens a group link before signing in is asked whether they
// are in it, never told they are not (D-003); only the group's own people see the formation footer (F-017); /groups opens on
// every group that is not closed (D-006).
import { expect, test } from '@playwright/test';
import { DEMO_GROUP as MATCHING_DEMO } from './demo.ts';
import { CHECKER_GROUP, listSettled, stubActivation } from './helpers.ts';

test('a signed-out visitor to a locked group is asked whether they are in it', async ({ page }) => {
  test.setTimeout(150_000);
  await stubActivation(page);
  await page.goto(`/g/${CHECKER_GROUP}`);
  await expect(page.getByTestId('group-status')).toHaveText('Terms locked · 3 of 3 approved', { timeout: 90_000 });
  const step = page.getByTestId('step-visitor');
  await expect(step).toContainText('Next step');
  await expect(step).toContainText('Are you in this group?');
  await expect(step.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByTestId('form-blocker')).toHaveCount(0);
  // the checker fixture is not ready to form, so its form page shows no roles; the matching demo is
  await page.goto(`/g/${MATCHING_DEMO}/form`);
  await expect(page.getByTestId('form-signed-out')).toContainText('Are you in this group?', { timeout: 90_000 });
  await expect(page.getByText('You are not a co-owner of this group')).toHaveCount(0);
});

test('/groups lists groups past "taking co-owners" with no amount typed', async ({ page }) => {
  await stubActivation(page);
  await page.goto('/groups');
  await listSettled(page);
  await expect(page.getByTestId('group-rows').first()).toBeVisible();
});

test('the Home amount opens /groups with that amount, and starting a group asks to sign in', async ({ page }) => {
  await stubActivation(page);
  await page.goto('/');
  await page.getByTestId('hero-amount').fill('300');
  await page.getByRole('button', { name: 'Find my group' }).click();
  await expect(page).toHaveURL(/\/groups\?amount=300$/);
  await expect(page.getByTestId('ask-amount')).toHaveValue('300');
  await expect(page.locator('#fits-title')).toContainText('300 DASH', { timeout: 90_000 });
  await expect(page.getByTestId('start-card').or(page.getByTestId('your-listing'))).toBeVisible();
  await page.getByTestId('start-sign-in').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('/looking now leads to /groups', async ({ page }) => {
  await stubActivation(page);
  await page.goto('/looking');
  await expect(page).toHaveURL(/\/groups$/);
});
