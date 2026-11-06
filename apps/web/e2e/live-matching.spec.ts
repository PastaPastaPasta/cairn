// Opt-in live TESTNET run of matching and agreeing (CAIRN_LIVE=1 npx playwright test e2e/live-matching.spec.ts), with three
// identities in three browsers: an operator who opens a group, and two members who ask for seats. The operator accepts both, the
// group chooses a coordinator and voting key holder, the holder gives the voting address, the operator locks the terms, both
// members approve, and every viewer sees "Ready to form". The group stays on testnet as demo data.
//
// Identities come from the shared secret store (cairn/testnet-matching-*); one that does not exist yet is created the way a user
// does (new phrase, paid by the dash-faucet helper) and its phrase goes only into the store. Phrases never reach the logs.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { expect, test, type Page } from '@playwright/test';
import { OUT, demoAddress, go, signedIn } from './live-helpers.ts';

test.setTimeout(45 * 60_000);

const WRITE = 5 * 60_000;
/** A real shared masternode on testnet (Dash-Qt wizard, 500/300/200), listed as the demo operator's claim. */
const DEMO_CLAIMED = 'd400c12078251aa1320315a683291667beb3b585a5e0c2609919df27aab674e6';

async function ensureProfile(page: Page, name: string) {
  await go(page, '/me#profile');
  const form = page.getByTestId('profile-form');
  await expect(form.getByTestId('profile-save')).toBeEnabled({ timeout: 120_000 });
  if ((await form.getByLabel('Display name').inputValue()) === name) return;
  await form.getByLabel('Display name').fill(name);
  await form.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-saved')).toBeVisible({ timeout: WRITE });
}

/** (Re)opens the group page, so it reads Platform again. */
async function openGroup(page: Page, id: string) {
  await go(page, '/learn');
  await go(page, `/g/${id}`);
  await expect(page.getByTestId('group-status')).toBeVisible({ timeout: 120_000 });
}

test('@live operator and two members agree terms on testnet up to "Ready to form"', async ({ browser }) => {
  const op = await signedIn(browser, 'cairn/testnet-matching-operator', 'operator');
  const a = await signedIn(browser, 'cairn/testnet-matching-member-a', 'member A');
  const b = await signedIn(browser, 'cairn/testnet-matching-member-b', 'member B');

  await ensureProfile(op.page, 'Stonepath Nodes');
  await ensureProfile(a.page, 'Ana Demo');
  await ensureProfile(b.page, 'Ben Demo');

  // O1: the operator's listing
  await go(op.page, '/me#operator');
  const listing = op.page.getByTestId('operator-form').or(op.page.getByTestId('my-operator'));
  await expect(listing).toBeVisible({ timeout: 120_000 });
  if (await op.page.getByTestId('operator-form').isVisible()) {
    await op.page.getByTestId('operator-name').fill('Stonepath Nodes');
    await op.page.getByTestId('operator-reward').fill('10');
    await op.page.getByTestId('operator-regions').fill('EU-West, US-East');
    await op.page.getByTestId('operator-claimed').fill(DEMO_CLAIMED);
    await op.page.getByTestId('operator-save').click();
    await expect(op.page.getByTestId('my-operator')).toBeVisible({ timeout: WRITE });
  }

  // O2: an operator-led group, open amounts, 3-month early period with a 20 DASH penalty
  await go(op.page, '/groups/new?kind=operator');
  await op.page.getByTestId('group-title').fill(`Cairn demo node ${new Date().toISOString().slice(0, 10)}`);
  await op.page.getByTestId('group-reward').fill('10');
  await op.page.getByRole('radio', { name: '3 months' }).check();
  await op.page.getByTestId('penalty').fill('20');
  await op.page.getByLabel('Group chat link').fill('https://discord.gg/dash');
  await op.page.getByTestId('group-create').click();
  await op.page.waitForURL(/\/g\/[1-9A-HJ-NP-Za-km-z]{43,44}$/, { timeout: WRITE });
  const groupId = op.page.url().split('/g/')[1]!;
  console.log(`group ${groupId}`);

  // M5: both members ask for seats; A offers to coordinate and hold the voting key
  for (const [m, amount, flags] of [
    [a, '600', true],
    [b, '400', false],
  ] as const) {
    await openGroup(m.page, groupId);
    await m.page.getByTestId('seat-amount').fill(amount);
    if (flags) {
      await m.page.getByLabel(/I can coordinate/).check();
      await m.page.getByLabel(/I can hold the voting key/).check();
    }
    await m.page.getByTestId('seat-save').click();
    await expect(m.page.getByTestId('step-requester')).toContainText('Waiting for the organizer', { timeout: WRITE });
  }

  // S1: the organizer adds both to the roster
  await openGroup(op.page, groupId);
  for (let i = 0; i < 2; i++) {
    await expect(op.page.getByTestId('request-accept').first()).toBeEnabled({ timeout: 120_000 });
    await op.page.getByTestId('request-accept').first().click();
    await expect(op.page.getByTestId('roster').locator(':scope > li')).toHaveCount(i + 1, { timeout: WRITE });
  }
  await expect(op.page.getByTestId('lock-section')).toBeVisible({ timeout: WRITE });

  // choose the coordinator and voting key holder (A), and save so A is asked for the address
  await op.page.getByTestId('pick-coordinator').first().check();
  await op.page.getByTestId('pick-holder').first().check();
  await op.page.getByTestId('save-choices').click();
  await expect(op.page.getByTestId('lock-section')).toContainText('Choices saved', { timeout: WRITE });
  await expect(op.page.getByTestId('lock-problems')).toContainText('voting key holder has not given');

  await openGroup(a.page, groupId);
  await expect(a.page.getByTestId('step-member')).toContainText('Give the voting address', { timeout: 120_000 });
  await a.page.getByTestId('voting-address').fill(demoAddress());
  await a.page.getByTestId('voting-address-save').click();
  await expect(a.page.getByTestId('step-member')).toContainText('Waiting for the organizer to lock', { timeout: WRITE });

  // O4 + S3: the operator's key and service, then lock
  const key = Buffer.from(bls12_381.longSignatures.getPublicKey(bls12_381.utils.randomSecretKey()).toBytes()).toString('hex');
  await openGroup(op.page, groupId);
  await op.page.getByTestId('operator-pubkey').fill(key);
  await op.page.getByTestId('operator-service').fill('1.2.3.4:19999');
  await expect(op.page.getByTestId('lock-problems')).toHaveCount(0, { timeout: 30_000 });
  await op.page.getByTestId('lock').click();
  await expect(op.page.getByTestId('term-sheet')).toBeVisible({ timeout: WRITE });
  await expect(op.page.getByTestId('hash-check')).toContainText('Checked');

  // M8: both members approve the term sheet they see
  for (const m of [a, b]) {
    await openGroup(m.page, groupId);
    await expect(m.page.getByTestId('hash-check')).toContainText('Checked', { timeout: 120_000 });
    await m.page.getByTestId('approve-read').check();
    await m.page.getByTestId('approve').click();
    await expect(m.page.getByTestId('approve-box')).toContainText('You approved these terms', { timeout: WRITE });
  }

  for (const m of [op, a, b]) {
    await openGroup(m.page, groupId);
    await expect(m.page.getByTestId('ready')).toBeVisible({ timeout: 120_000 });
    await expect(m.page.getByTestId('group-status')).toHaveText('Ready to form');
  }
  const hash = (await op.page.getByTestId('terms-hash').textContent())?.trim();
  console.log(`READY TO FORM: group ${groupId}, termsHash ${hash}`);
  writeFileSync(join(OUT, 'matching-live-result.json'), JSON.stringify({ groupId, termsHash: hash, operator: op.id, members: [a.id, b.id], at: new Date().toISOString() }, null, 2) + '\n');
});

test('@live a member posts that they are looking, edits it and sees their matches', async ({ browser }) => {
  const b = await signedIn(browser, 'cairn/testnet-matching-member-b', 'member B');
  await go(b.page, '/looking');
  const form = b.page.getByTestId('looking-form');
  const mine = b.page.getByTestId('my-looking');
  await expect(form.or(mine)).toBeVisible({ timeout: 120_000 });
  if (await mine.isVisible()) await mine.getByRole('button', { name: 'Edit' }).click();
  await b.page.getByTestId('looking-amount').fill('300');
  await b.page.getByTestId('looking-reward').fill('15');
  await b.page.getByLabel(/I can coordinate/).check();
  await b.page.getByTestId('looking-save').click();
  await expect(mine).toContainText('300 DASH', { timeout: WRITE });
  await expect(mine).toContainText('Listed');
  // M3 edit: a new amount replaces the same post
  await mine.getByRole('button', { name: 'Edit' }).click();
  await b.page.getByTestId('looking-amount').fill('350');
  await b.page.getByTestId('looking-save').click();
  await expect(mine).toContainText('350 DASH', { timeout: WRITE });
  await expect(b.page.getByTestId('looking-rows')).toContainText('Ben Demo', { timeout: 120_000 });
  await expect(b.page.getByTestId('matches')).toBeVisible();
  console.log(`LOOKING POSTED by ${b.id}`);
});
