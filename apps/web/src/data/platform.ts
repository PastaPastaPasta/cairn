// Platform reads through evo-sdk 5.x, always the proof-verifying variants. The SDK is lazy-loaded (its WASM is a separate ~26 MB
// asset): preloadSdk() runs after first paint. getSdk is govhub's (apps/web/src/data/platform.ts); the reads are Cairn's.
import { CAIRN_SCHEMAS, assertQuery, type CairnQuery, type DocType, type RawDoc } from '@cairn/contract';
import type { Registry } from '../config/registry.ts';

type EvoModule = typeof import('@dashevo/evo-sdk');
export type Sdk = InstanceType<EvoModule['EvoSDK']>;

let current: { key: string; sdk: Promise<Sdk> } | null = null;

const sdkKey = (r: Registry) => JSON.stringify([r.network, r.platform]);

export function getSdk(r: Registry): Promise<Sdk> {
  const key = sdkKey(r);
  if (current?.key === key) return current.sdk;
  const sdk = (async () => {
    const mod: EvoModule = await import('@dashevo/evo-sdk');
    await mod.ensureInitialized?.();
    const s = new mod.EvoSDK({
      network: r.network,
      trusted: r.platform.trusted,
      ...(r.platform.addresses.length ? { addresses: r.platform.addresses } : {}),
      settings: { timeoutMs: 20000, retries: 2 },
    });
    await s.connect();
    return s;
  })();
  current = { key, sdk };
  sdk.catch(() => {
    if (current?.sdk === sdk) current = null;
  });
  return sdk;
}

export function preloadSdk(r: Registry): void {
  getSdk(r).catch(() => {});
}

export interface DocsResult {
  docs: RawDoc[];
  /** Platform height the proof is for. */
  height: number | null;
}

function needContract(r: Registry): string {
  if (!r.contractId) throw new Error(`Cairn is not on ${r.label} yet.`);
  return r.contractId;
}

/** documents.queryWithProof on the cairn contract, PV13-linted first (a bad shape would silently return []). */
export async function queryCairn(r: Registry, q: CairnQuery): Promise<DocsResult> {
  assertQuery(CAIRN_SCHEMAS, q);
  const sdk = await getSdk(r);
  const res = await sdk.documents.queryWithProof({
    dataContractId: needContract(r),
    documentTypeName: q.documentTypeName,
    where: q.where as unknown[],
    ...(q.orderBy ? { orderBy: q.orderBy as unknown[] } : {}),
    ...(q.limit ? { limit: q.limit } : {}),
    ...(q.startAfter ? { startAfter: q.startAfter } : {}),
  } as never);
  const docs = [...res.data.values()].filter((d): d is NonNullable<typeof d> => !!d).map((d) => d.toJSON() as RawDoc);
  const h = (res as { metadata?: { height?: unknown } }).metadata?.height;
  return { docs, height: h === undefined || h === null ? null : Number(h) };
}

/** One document by id, proved; null when Platform proves it absent. */
export async function getCairnDoc(r: Registry, type: DocType, id: string): Promise<RawDoc | null> {
  const sdk = await getSdk(r);
  const res = await sdk.documents.getWithProof(needContract(r), type, id);
  return res.data ? (res.data.toJSON() as RawDoc) : null;
}

/** The identity's DPNS username (proved; the one DashPay and Yappr show), or null. */
export async function dpnsName(r: Registry, identityId: string): Promise<string | null> {
  const sdk = await getSdk(r);
  const res = await sdk.dpns.usernameWithProof(identityId);
  return typeof res.data === 'string' && res.data ? res.data : null;
}
