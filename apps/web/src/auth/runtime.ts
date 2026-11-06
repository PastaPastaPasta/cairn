// The services sign-in and funding run on: Platform through evo-sdk (lazy, shared with the read path) and Core DAPI on the same
// network (an asset lock must be on the Core chain Platform follows).
import type { PlatformPort } from '@cairn/auth';
import type { Dapi } from '@cairn/dapi';
import type { Registry } from '../config/registry.ts';
import { createWebDapi, type DapiConfig } from '../data/dapi.ts';
import { getSdk } from '../data/platform.ts';
import { errText } from '../lib/format.ts';

let port: { key: string; value: Promise<PlatformPort> } | null = null;

export function getPlatformPort(r: Registry): Promise<PlatformPort> {
  const key = JSON.stringify([r.network, r.platform]);
  if (port?.key === key) return port.value;
  const value = (async () => {
    const [evo, sdk, { createEvoPlatform }] = await Promise.all([import('@dashevo/evo-sdk'), getSdk(r), import('@cairn/auth/evo')]);
    return createEvoPlatform(evo, sdk, r.network);
  })();
  port = { key, value };
  value.catch(() => {
    if (port?.value === value) port = null;
  });
  return value;
}

let dapi: { key: string; value: Dapi } | null = null;

export const platformDapiConfig = (r: Registry): DapiConfig => ({ source: r.dapi.source, quorumUrl: r.dapi.quorumUrl, nodes: r.dapi.nodes, network: r.network });

/** DAPI on the profile's network. */
export function getAuthDapi(r: Registry): Dapi {
  const cfg = platformDapiConfig(r);
  const key = JSON.stringify(cfg);
  if (dapi?.key !== key) dapi = { key, value: createWebDapi(cfg) };
  return dapi.value;
}

/** WebAuthn relying party: this host (localhost in development and the e2e tests). */
export const rpId = (): string => location.hostname;

/** 1 DASH = 1e11 credits. */
export function formatCredits(credits: bigint): string {
  const whole = credits / 100_000_000_000n;
  const frac = (credits % 100_000_000_000n).toString().padStart(11, '0').slice(0, 8);
  return `${whole}.${frac} DASH`;
}

/** What one Platform change (a profile save, a post, an approval) costs in credits: about 0.0005 DASH. */
export const CHANGE_COST_CREDITS = 50_000_000n;

/** "0.045 DASH": truncated, never rounded up; more places only when the balance is below 0.001. */
export function formatCreditsShort(credits: bigint): string {
  const places = credits < 100_000_000n ? 5n : 3n;
  const v = credits / 10n ** (11n - places);
  const base = 10n ** places;
  return `${v / base}.${(v % base).toString().padStart(Number(places), '0')} DASH`;
}

export const formatDashNumber = (duffs: number | bigint): string => (Number(duffs) / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
export const formatDuffs = (duffs: number | bigint): string => `${formatDashNumber(duffs)} DASH`;

/** Error text safe to show: no long hex / base58 runs (the SDK can echo transition bytes). */
export function errorText(e: unknown): string {
  return errText(e).replace(/[0-9a-fA-F]{64,}/g, '[…]').replace(/[1-9A-HJ-NP-Za-km-z]{50,}/g, '[…]').slice(0, 400);
}

/**
 * Errors that mean "the network or a node failed just now" rather than "this cannot work": the SDK's quorum prefetch, its WASM streaming
 * fetch, DAPI transport and timeouts. Retrying is the right answer to these, and nothing the user holds is affected.
 */
const TRANSIENT_ERROR = new RegExp(
  [
    'failed to prefetch quorums',
    'webassembly (?:compilation|instantiation) aborted:? network',
    '\\bnetwork ?error\\b',
    'http request error',
    // the browser's own fetch failure, not the SDK's "Failed to fetch identity: <any cause>" wrapper
    '\\bfailed to fetch\\b(?! \\w)',
    '\\bload failed\\b',
    // gRPC and HTTP transport trouble, with a transport word after it: the SDK also reports refused requests as "transport error"
    'transport error[^\\n]*\\b(?:connect|connection|timed out|dns|reset|refused|unreachable)',
    '\\btimed out\\b',
    '\\bdeadline exceeded\\b',
    '\\bERR_(?:NETWORK|INTERNET|CONNECTION|ABORTED|TIMED)',
    '\\btemporarily unavailable\\b',
    '\\b(?:HTTP|status)[ :]+50[234]\\b',
  ].join('|'),
  'i',
);

export const isTransientError = (e: unknown): boolean => TRANSIENT_ERROR.test(errText(e));

/**
 * `errorText`, except that a transient network failure is put in plain words ("could not reach ..., try again") with the technical
 * text kept after it, for a bug report. `what` is what was being read or done ("Platform", "the Dash network").
 */
export function plainErrorText(e: unknown, what = 'the Dash network'): string {
  const raw = errorText(e);
  if (!isTransientError(e)) return raw;
  return `Could not reach ${what} just now: the connection dropped or a node was too slow. Try again in a moment. (${raw.length > 160 ? `${raw.slice(0, 160)}…` : raw})`;
}
