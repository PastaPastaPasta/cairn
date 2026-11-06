// Opt-in live TESTNET run (CAIRN_LIVE=1 npm run e2e:live -w @cairn/web): create an account exactly as a user does (new phrase, pay the
// QR address), with the dash-faucet helper playing the user's wallet; then write a profile through the vendored document writer and
// see it read back with a proof. Spends about 0.01 tDASH. The phrase goes only into the shared secret store (`secret set
// cairn/testnet-e2e-user-<time>`, linked at ~/.local/share/cairn/), never to a loose file or the logs; without the `secret` tool it
// is not kept at all.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { stubActivation } from './helpers.ts';

test.setTimeout(15 * 60_000);

const FAUCET = join(homedir(), '.claude/skills/dash-faucet/scripts/request_core_faucet.py');
const OUT = join(homedir(), '.local/share/cairn');

/** Keeps the throwaway account's phrase in the secret store (stdin, never argv); false when there is no store here. */
function keepPhrase(phrase: string): boolean {
  const stamp = Date.now();
  const r = spawnSync('secret', ['set', `cairn/testnet-e2e-user-${stamp}`, '--link', join(OUT, `testnet-e2e-user-${stamp}.json`), '--note', 'Cairn testnet e2e account (throwaway, test DASH only)'], {
    input: JSON.stringify({ phrase, network: 'testnet', at: new Date().toISOString() }) + '\n',
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  return r.status === 0;
}

test('@live create an account on testnet and save a profile', async ({ page }) => {
  await stubActivation(page);
  await page.goto('/');
  await page.getByTestId('signin-button').click();
  await page.getByRole('button', { name: /Create an account/ }).click();
  const words = (await page.getByTestId('phrase-words').locator('li').allInnerTexts()).map((t) => t.trim().split(/\s+/)[1]!);
  expect(words).toHaveLength(12);
  mkdirSync(OUT, { recursive: true, mode: 0o700 });
  console.log(keepPhrase(words.join(' ')) ? 'phrase kept in the secret store' : 'no secret store: the phrase is not kept');
  await page.getByRole('button', { name: 'I wrote it down' }).click();
  for (const i of await page.locator('[data-testid^="quiz-"]').all()) await i.fill(words[Number((await i.getAttribute('data-testid'))!.slice(5)) - 1]!);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Pay with DASH/ }).click();

  const address = (await page.getByTestId('deposit-address').innerText({ timeout: 120_000 })).trim();
  expect(address).toMatch(/^y[1-9A-HJ-NP-Za-km-z]{33}$/);
  const t0 = Date.now();
  const faucet = execFileSync('python3', ['-I', FAUCET, address, '--amount', '0.01'], { encoding: 'utf8' });
  const txid = /"txid":\s*"([0-9a-f]{64})"/.exec(faucet)?.[1];
  console.log(`faucet paid ${address}: ${txid}`);

  await expect(page.getByTestId('account-button')).toBeVisible({ timeout: 5 * 60_000 });
  console.log(`identity created ${Math.round((Date.now() - t0) / 1000)} s after the payment`);
  await page.keyboard.press('Escape');
  await page.getByTestId('account-button').click();
  const identityId = (await page.getByTestId('session-identity').innerText()).trim();
  console.log(`identity ${identityId}`);
  await page.getByRole('link', { name: 'My profile' }).click();

  const form = page.getByTestId('profile-form');
  await expect(form.getByRole('button', { name: 'Create profile' })).toBeEnabled({ timeout: 120_000 });
  const name = `E2E tester ${new Date().toISOString().slice(0, 16)}`;
  await form.getByLabel('Display name').fill(name);
  await form.getByLabel(/About you/).fill('Testing Cairn on testnet. Not a real member.');
  await form.getByLabel('Yappr').fill('cairn-e2e');
  await form.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-saved')).toBeVisible({ timeout: 4 * 60_000 });
  console.log(await page.getByTestId('profile-saved').innerText());
  await expect(page.getByTestId('account-button')).toHaveText(name);

  // a replace goes through the writer's other path (revision + 1)
  await form.getByLabel('Telegram').fill('@cairn_e2e');
  await form.getByTestId('profile-save').click();
  await expect(page.getByTestId('profile-saved')).toContainText('version 2', { timeout: 4 * 60_000 });
  writeFileSync(join(OUT, 'e2e-user-result.json'), JSON.stringify({ identityId, address, faucetTxid: txid, profile: name, at: new Date().toISOString() }, null, 2) + '\n');
});
