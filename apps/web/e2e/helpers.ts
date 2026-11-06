import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

const ACTIVATION = readFileSync(new URL('../src/data/fixtures/activation-mainnet-2026-11-06.json', import.meta.url), 'utf8');

/** Radar's activation answer from a recorded fixture, so pages render the same on every run. */
export async function stubActivation(page: Page, body: string | null = ACTIVATION): Promise<void> {
  await page.route('https://nodes.dashhq.org/api/v1/mainnet/activation', (r) =>
    body === null ? r.abort() : r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body }),
  );
}

/** A list page has finished reading (rows, its empty state, or an error): never a spinner in a screenshot. */
export async function listSettled(page: Page): Promise<void> {
  await page.locator('.rows, .empty-state, .list-status.error, [data-testid="not-open-here"]').first().waitFor({ timeout: 60_000 });
}

/** Console errors other than network failures the app handles (a DAPI node or Radar that does not answer). */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|net::ERR_|ERR_FAILED|grpc|fetch/i.test(t)) return;
    errors.push(t);
  });
  return errors;
}
