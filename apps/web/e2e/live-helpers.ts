// Live testnet helpers for the matching specs: identities from the shared secret store (created the way a user does when missing,
// paid by the dash-faucet helper), signed in through the real sign-in sheet. Phrases never reach the logs.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58 } from '@scure/base';
import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { stubActivation } from './helpers.ts';

export const FAUCET = join(homedir(), '.claude/skills/dash-faucet/scripts/request_core_faucet.py');
export const OUT = join(homedir(), '.local/share/cairn');

function storedPhrase(name: string): string | null {
  const r = spawnSync('secret', ['get', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (r.status !== 0 || !r.stdout.trim()) return null;
  try {
    return (JSON.parse(r.stdout) as { phrase?: string }).phrase ?? null;
  } catch {
    return null;
  }
}

function keepPhrase(name: string, phrase: string, note: string): void {
  mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const r = spawnSync('secret', ['set', name, '--link', join(OUT, `${name.split('/')[1]}.json`), '--note', note], {
    input: JSON.stringify({ phrase, network: 'testnet', at: new Date().toISOString() }) + '\n',
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  if (r.status !== 0) throw new Error(`could not keep the phrase for ${name} in the secret store`);
}

/** A testnet P2PKH address nobody holds the key of (demo data only). */
export function demoAddress(): string {
  const payload = new Uint8Array(21);
  payload[0] = 140;
  crypto.getRandomValues(payload.subarray(1));
  const check = sha256(sha256(payload)).slice(0, 4);
  return base58.encode(new Uint8Array([...payload, ...check]));
}

export async function signedIn(browser: Browser, secretName: string, label: string, options: BrowserContextOptions = {}): Promise<{ page: Page; id: string }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  const page = await ctx.newPage();
  await stubActivation(page);
  await page.goto('/');
  await page.getByTestId('signin-button').click();
  const phrase = storedPhrase(secretName);
  if (phrase) {
    await page.getByRole('button', { name: /I have a recovery phrase/ }).click();
    await page.getByTestId('phrase-input').fill(phrase);
    await page.locator('dialog.sheet[open]').getByRole('button', { name: 'Sign in', exact: true }).click();
  } else {
    await page.getByRole('button', { name: /Create an account/ }).click();
    const words = (await page.getByTestId('phrase-words').locator('li').allInnerTexts()).map((t) => t.trim().split(/\s+/)[1]!);
    expect(words).toHaveLength(12);
    keepPhrase(secretName, words.join(' '), `Cairn testnet matching e2e: ${label} (throwaway, test DASH only)`);
    await page.getByRole('button', { name: 'I wrote it down' }).click();
    for (const i of await page.locator('[data-testid^="quiz-"]').all()) await i.fill(words[Number((await i.getAttribute('data-testid'))!.slice(5)) - 1]!);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Pay with DASH/ }).click();
    const address = (await page.getByTestId('deposit-address').innerText({ timeout: 120_000 })).trim();
    const out = execFileSync('python3', ['-I', FAUCET, address, '--amount', '0.05'], { encoding: 'utf8' });
    console.log(`${label}: faucet paid ${address}: ${/"txid":\s*"([0-9a-f]{64})"/.exec(out)?.[1]}`);
  }
  await expect(page.getByTestId('account-button')).toBeVisible({ timeout: 6 * 60_000 });
  await page.keyboard.press('Escape');
  await page.getByTestId('account-button').click();
  const id = (await page.getByTestId('session-identity').innerText()).trim();
  await expect(page.getByTestId('session-balance')).not.toHaveText('reading…', { timeout: 60_000 }).catch(() => {});
  console.log(`${label}: ${id} (credit ${(await page.getByTestId('session-balance').innerText()).trim()})`);
  await page.keyboard.press('Escape');
  return { page, id };
}


/**
 * Client-side navigation: the signed-in key lives only in this page's memory, so a full load (page.goto) would sign out. React
 * Router follows history changes announced with popstate.
 */
export async function go(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    history.pushState({}, '', p);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForURL((u) => u.pathname + u.search + u.hash === path || u.pathname === path.split(/[?#]/)[0]);
}
