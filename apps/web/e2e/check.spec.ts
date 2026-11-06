// The message checker with real Dash-Qt messages: the dashd 24.0.0 regtest fixtures (and a testnet copy of their draft), a standby
// file, and the real testnet registration d400c120. The group-mode tests read two testnet groups made by scripts/testnet-demo.ts.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { envelopeFingerprint, readUniValue } from '@cairn/shares';
import { DEMO_GROUP as MATCHING_DEMO } from './demo.ts';
import { CHECKER_GROUP, DEMO_GROUP, collectErrors, stubActivation } from './helpers.ts';

const vectors = new URL('../../../packages/shares/test/vectors/', import.meta.url);
const ENVS: Array<{ name: string; text: string }> = JSON.parse(readFileSync(new URL('regtest/envelopes.json', vectors), 'utf8'));
const A = JSON.parse(readFileSync(new URL('regtest/mn-a.json', vectors), 'utf8'));
const D400 = readFileSync(new URL('testnet-d400c120.hex', vectors), 'utf8').trim();
const env = (name: string) => ENVS.find((e) => e.name === name)!.text;
const owner = (i: number): string => A.prepareArgs.shares[i].ownerAddress;


/** The regtest draft as a testnet session: same address prefixes, the checker group's public service, a fresh message code. */
function testnetDraft(text: string): string {
  const moved = text.replace('"network": "regtest"', '"network": "test"').replace('"coreP2PAddrs": "127.0.0.1:20001"', '"coreP2PAddrs": "8.8.4.4:19999"');
  const code = envelopeFingerprint(readUniValue(moved)!);
  return moved.replace(/"fingerprint": "[0-9A-F]{4}-[0-9A-F]{4}"/, `"fingerprint": "${code}"`);
}
const swapOwners = (text: string) => text.split(owner(0)).join('@@').split(owner(1)).join(owner(0)).split('@@').join(owner(1));

async function paste(page: Page, text: string) {
  await page.getByTestId('checker-input').fill(text);
}
const verdict = (page: Page) => page.getByTestId('verdict');

test.describe('standalone /check', () => {
  test('reads every round of a real session and sends nothing anywhere', async ({ page }) => {
    const errors = collectErrors(page);
    await stubActivation(page);
    await page.goto('/check');
    await expect(page.getByTestId('checker-private')).toContainText('Nothing you paste or open here is uploaded');
    const sent: string[] = [];
    page.on('request', (r) => sent.push(`${r.url()} ${r.postData() ?? ''}`));
    const frozen = env('frozen');
    await paste(page, frozen);
    const result = page.getByTestId('check-result');
    await expect(result.locator('.check-kind')).toHaveText('Locked Terms');
    await expect(result).toContainText('Round 2 of 3: Locked Terms → Approval');
    await expect(result).toContainText('B2B8-01BC');
    // the fixtures are regtest messages and this site is on Testnet
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'stop');
    await expect(page.getByTestId('findings').locator('[data-code="wrong-network"]')).toContainText('Wrong network: this message is for Regtest, and this site is on Testnet');
    await expect(result.getByTestId('check-rows').locator('tbody tr')).toHaveCount(3);
    for (const [name, title] of [['combined', 'Signing Request'], ['fundingSigned', 'Signed Contribution'], ['broadcast', 'Final Record']]) {
      await paste(page, env(name!));
      await expect(result.locator('.check-kind')).toHaveText(title!);
    }
    await page.waitForTimeout(1500);
    const sessionId = /"sessionId": "([0-9a-f]{64})"/.exec(frozen)![1]!;
    expect(sent.filter((s) => s.includes(sessionId) || s.includes(owner(0)) || s.includes(A.prepared.consentHash))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a valid testnet message is not called safe on its own, and an edited one asks to check it', async ({ page }) => {
    await stubActivation(page);
    await page.goto('/check');
    const draft = testnetDraft(env('draft-complete'));
    await paste(page, draft);
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'neutral');
    await expect(verdict(page)).toContainText('Valid in Dash Core, not compared with agreed terms');
    await paste(page, draft.replace(/"fingerprint": "[0-9A-F]{4}-[0-9A-F]{4}"/, '"fingerprint": "AAAA-BBBB"'));
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'warn');
    await expect(verdict(page)).toContainText('Check this');
    await expect(page.getByTestId('check-result')).not.toContainText('Approve and Copy Reply');
  });

  test('stops on a tampered message', async ({ page }) => {
    await stubActivation(page);
    await page.goto('/check');
    await paste(page, env('frozen').replace('"amount": 30000000000', '"amount": 30100000000').replace('"amount": 20000000000', '"amount": 19900000000'));
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'stop');
    await expect(verdict(page)).toContainText('Stop — don’t sign');
    await expect(page.getByTestId('findings')).toContainText('Dash Core would refuse this message');
  });

  test('opens a standby dissolution file from disk', async ({ page }) => {
    await stubActivation(page);
    await page.goto('/check');
    const file = ['Dash shared masternode — standby dissolution', `Masternode: ${A.proTxHash}`, '', 'FULL PRINCIPAL — valid from block 142 (~1 hour)', A.standby.full, '', 'IMMEDIATE — pays the 50 DASH early-exit penalty, valid right away', A.standby.immediate].join('\n');
    await page.getByTestId('checker-file').setInputFiles({ name: 'standby-dissolution-bbbf4cb0-share3.txt', mimeType: 'text/plain', buffer: Buffer.from(file) });
    await expect(page.getByTestId('check-result').locator('.check-kind')).toHaveText('Standby dissolution');
    await expect(page.getByTestId('check-result')).toContainText('block 142');
    await expect(page.getByTestId('findings')).toContainText('Anyone who has this can broadcast it');
  });
});

test.describe('against a group’s approved terms (testnet)', () => {
  test.setTimeout(150_000);

  test('safe for my bound row, stop on a row swap', async ({ page }) => {
    await stubActivation(page);
    await page.goto(`/check?group=${CHECKER_GROUP}`);
    await expect(page.getByTestId('checker-my-row')).toBeVisible({ timeout: 90_000 });
    await page.getByTestId('checker-my-row').selectOption('Bob');
    await page.getByTestId('checker-owner').fill(owner(1));
    const draft = testnetDraft(env('draft-complete'));
    await paste(page, draft);
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'ok');
    await expect(verdict(page)).toContainText('Safe to continue');
    await expect(page.getByTestId('check-rows').locator('tr.mine')).toContainText('Bob');

    await paste(page, swapOwners(draft));
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'stop');
    await expect(page.getByTestId('findings').locator('[data-code="my-row-moved"]')).toContainText('Your owner address is on someone else');
  });

  test('a different operator reward is a stop; an unbound row asks for the owner address', async ({ page }) => {
    await stubActivation(page);
    await page.goto(`/check?group=${CHECKER_GROUP}`);
    await expect(page.getByTestId('checker-my-row')).toBeVisible({ timeout: 90_000 });
    await page.getByTestId('checker-my-row').selectOption('Alice');
    const draft = testnetDraft(env('draft-complete'));
    await paste(page, draft);
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'warn');
    await expect(page.getByTestId('findings').locator('[data-code="my-row-unbound"]')).toBeVisible();
    await paste(page, testnetDraft(env('draft-complete').replace('"operatorReward": 500', '"operatorReward": 900')));
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'stop');
    await expect(page.getByTestId('findings').locator('[data-code="operator-reward"]')).toBeVisible();
  });

  test('the real d400c120 registration matches the demo group’s terms', async ({ page }) => {
    await stubActivation(page);
    await page.goto(`/check?group=${DEMO_GROUP}`);
    await expect(page.getByTestId('checker-my-row')).toBeVisible({ timeout: 90_000 });
    await paste(page, D400);
    const result = page.getByTestId('check-result');
    await expect(result.locator('.check-kind')).toHaveText('Shared masternode registration');
    await expect(verdict(page)).toHaveAttribute('data-verdict', 'warn');
    await expect(page.getByTestId('findings').locator('[data-code="join-sigs"]')).toContainText('All 3 co-owner approvals are valid');
    await expect(page.getByTestId('findings').locator('[data-code="no-service"]')).toBeVisible();
    expect(await page.getByTestId('findings').locator('.finding-stop').count()).toBe(0);
  });
});

test('the live page verifies the demo group against real testnet chain data', async ({ page }) => {
  test.setTimeout(180_000);
  await stubActivation(page);
  await page.goto(`/g/${DEMO_GROUP}/live`);
  const reg = page.getByTestId('registration').first();
  await expect(reg).toHaveAttribute('data-state', 'verified', { timeout: 150_000 });
  await expect(reg).toContainText('Live (verified)');
  await expect(page.getByTestId('mn-state')).toHaveAttribute('data-state', /valid|banned/);
  await expect(page.getByTestId('early-period')).toContainText('ends at block 1,635,878');
  await expect(page.getByTestId('reward-split')).toContainText('48.5%');
});

test('the group, form and live pages tell one lifecycle, from the documents and the chain', async ({ page }) => {
  test.setTimeout(240_000);
  await stubActivation(page);
  // locked and approved by every member, nothing linked: ready to form
  await page.goto(`/g/${MATCHING_DEMO}`);
  await expect(page.getByTestId('group-status')).toHaveText('Ready to form', { timeout: 90_000 });
  await expect(page.getByRole('navigation', { name: 'This group' })).toBeVisible();
  // a linked registration: the group page asks the chain, not the organizer's "live" claim
  await page.goto(`/g/${DEMO_GROUP}`);
  await expect(page.getByTestId('group-status')).toHaveText('Live (verified)', { timeout: 150_000 });
  await expect(page.getByTestId('step-visitor')).toContainText('This masternode is live');
  await page.getByRole('navigation', { name: 'This group' }).getByRole('link', { name: 'Form' }).click();
  const status = page.getByTestId('form-status');
  await expect(status).toContainText('Ready to form', { timeout: 90_000 });
  await expect(status.getByRole('link', { name: 'Live (verified)' })).toBeVisible({ timeout: 150_000 });
  await page.getByRole('navigation', { name: 'This group' }).getByRole('link', { name: 'Check a message' }).click();
  await expect(page).toHaveURL(new RegExp(`/check\\?group=${DEMO_GROUP}$`));
  await expect(page.getByTestId('checker-my-row')).toBeVisible({ timeout: 90_000 });
  // the checker fixture: approved by all three, so /check compares against it, but its operator never accepted, so not ready
  await page.goto(`/g/${CHECKER_GROUP}`);
  await expect(page.getByTestId('group-status')).toHaveText('Terms locked · 3 of 3 approved', { timeout: 90_000 });
});
