// Platform reads through evo-sdk 5.x, always the proof-verifying variants. The SDK is lazy-loaded (its WASM is a separate ~26 MB
// asset): preloadSdk() runs after first paint. getSdk is govhub's (apps/web/src/data/platform.ts); the reads are Cairn's.
import { CAIRN_SCHEMAS, assertQuery, type CairnQuery, type DocType, type RawDoc } from '@cairn/contract';
import { base58 } from '@scure/base';
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

/** Platform did not answer within the page's deadline (a node that accepts the connection and never replies). */
export class PlatformTimeout extends Error {
  constructor() {
    super('Dash Platform did not answer in time. The nodes may be busy; try again in a moment.');
    this.name = 'PlatformTimeout';
  }
}

/** One read's deadline. The SDK's own timeout does not end a request a node accepted and never answers. */
export const READ_DEADLINE_MS = 15_000;
const CONNECT_DEADLINE_MS = 30_000;

function deadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new PlatformTimeout()), ms)))]).finally(() => clearTimeout(timer));
}

/**
 * A read under a deadline, tried a second time when the first attempt times out: the SDK picks a node per request, so the retry
 * usually reaches another one. A connection that never comes up is dropped, so the next read starts a fresh one.
 */
export async function withSdk<T>(r: Registry, read: (sdk: Sdk) => Promise<T>, o: { deadlineMs?: number; attempts?: number } = {}): Promise<T> {
  const attempts = o.attempts ?? 2;
  for (let i = 1; ; i++) {
    const sdk = getSdk(r);
    try {
      const ready = await deadline(sdk, CONNECT_DEADLINE_MS).catch((e: unknown) => {
        if (e instanceof PlatformTimeout && current?.sdk === sdk) current = null;
        throw e;
      });
      return await deadline(read(ready), o.deadlineMs ?? READ_DEADLINE_MS);
    } catch (e) {
      if (!(e instanceof PlatformTimeout) || i >= attempts) throw e;
    }
  }
}

/** Identifier fields a query compares: a value that is not base58 of 32 bytes can match nothing, and the SDK would throw on it. */
const ID_FIELDS = new Set(['$id', '$ownerId', 'groupId', 'toId', 'operatorId', 'coordinatorId', 'refillOf']);
/** A Platform identifier as it appears in a link: base58 of 32 bytes. Anything else names no document. */
export const isIdentifier = (v: unknown): v is string => {
  try {
    return typeof v === 'string' && base58.decode(v).length === 32;
  } catch {
    return false;
  }
};
const namesNothing = (q: CairnQuery) =>
  (q.where as readonly (readonly unknown[])[]).some(([field, , value]) => typeof field === 'string' && ID_FIELDS.has(field) && (Array.isArray(value) ? !value.every(isIdentifier) : !isIdentifier(value)));

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
  const contractId = needContract(r);
  if (namesNothing(q)) return { docs: [], height: null };
  const res = await withSdk(r, (sdk) =>
    sdk.documents.queryWithProof({
      dataContractId: contractId,
      documentTypeName: q.documentTypeName,
      where: q.where as unknown[],
      ...(q.orderBy ? { orderBy: q.orderBy as unknown[] } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
      ...(q.startAfter ? { startAfter: q.startAfter } : {}),
    } as never),
  );
  const docs = [...res.data.values()].filter((d): d is NonNullable<typeof d> => !!d).map((d) => d.toJSON() as RawDoc);
  const h = (res as { metadata?: { height?: unknown } }).metadata?.height;
  return { docs, height: h === undefined || h === null ? null : Number(h) };
}

/** One document by id, proved; null when Platform proves it absent. */
export async function getCairnDoc(r: Registry, type: DocType, id: string): Promise<RawDoc | null> {
  const contractId = needContract(r);
  if (!isIdentifier(id)) return null;
  const res = await withSdk(r, (sdk) => sdk.documents.getWithProof(contractId, type, id));
  return res.data ? (res.data.toJSON() as RawDoc) : null;
}

/** The identity's DPNS username (proved; the one DashPay and Yappr show), or null. */
export async function dpnsName(r: Registry, identityId: string): Promise<string | null> {
  if (!isIdentifier(identityId)) return null;
  const res = await withSdk(r, (sdk) => sdk.dpns.usernameWithProof(identityId));
  return typeof res.data === 'string' && res.data ? res.data : null;
}
