// Mainnet v24 activation from Radar (nodes.dashhq.org). Public, CORS-open JSON; read with a timeout and shaped defensively, since a
// missing or changed field must degrade to "unavailable", never break the page.
export const ACTIVATION_URL = 'https://nodes.dashhq.org/api/v1/mainnet/activation';
export const ACTIVATION_PAGE = 'https://nodes.dashhq.org/v24';

export interface Activation {
  /** BIP9 state: defined, started, locked_in, active, failed. */
  state: string;
  active: boolean;
  tipHeight: number | null;
  /** Blocks that signalled in the current window, of `mined` so far, and the threshold to lock in (null before signalling starts). */
  window: { count: number; mined: number; size: number; threshold: number | null } | null;
  /** Earliest estimated activation (height and unix seconds); null once active or unknown. */
  earliest: { height: number; time: number } | null;
  /** Signalling starts at this unix time. */
  startTime: number | null;
  updated: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseActivation(j: unknown): Activation | null {
  const o = j as Record<string, any> | null;
  const d = Array.isArray(o?.deployments) ? (o!.deployments as Array<Record<string, any>>).find((x) => x?.name === 'v24') : undefined;
  if (!d || typeof d.state !== 'string') return null;
  const w = d.window;
  const ea = d.outlook?.earliest_activation;
  return {
    state: d.state,
    active: d.rpc?.active === true || d.state === 'active',
    tipHeight: num(o?.tip?.height),
    window: w && num(w.count) !== null && num(w.mined) !== null ? { count: w.count, mined: w.mined, size: num(d.params?.window) ?? 4032, threshold: num(w.threshold) } : null,
    earliest: ea && num(ea.height) !== null && num(ea.time) !== null ? { height: ea.height, time: ea.time } : null,
    startTime: num(d.params?.start_time),
    updated: num(o?.updated),
  };
}

export async function fetchActivation(signal?: AbortSignal): Promise<Activation> {
  const res = await fetch(ACTIVATION_URL, { signal: signal ?? AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Radar answered ${res.status}`);
  const a = parseActivation(await res.json());
  if (!a) throw new Error('Radar sent an activation status this page cannot read');
  return a;
}
