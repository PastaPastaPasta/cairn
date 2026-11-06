// Chain facts for a linked registration, over DAPI (@cairn/dapi): the ProRegTx proven into a block of a chain this browser verified
// itself (anchored on ChainLocks from the pinned quorum checkpoint where a proof source exists), and the masternode's entry in the
// masternode list proven against that chain. Nothing here trusts a Cairn document: callers judge these facts against the approvals.
import { AllNodesFailedError, GrpcError, createDapi, quorumListProofSource, type AnchoredChain, type Dapi, type ProofSource, type Verifiers } from '@cairn/dapi';
import type { Network } from '@cairn/contract';
import type { Registry } from '../config/registry.ts';
import type { ChainFacts } from './verify.ts';

/** Public DIP 175 proof relays; mainnet has none that answers a browser yet (govhub, 2026-10-24). */
const PROOF_SERVICE: Partial<Record<Network, string>> = { testnet: 'https://quorums.testnet.networks.dash.org/proofs' };

async function loadVerifiers(): Promise<Verifiers> {
  const [{ x11, x11Many }, { verifyChainLock }, coreproof] = await Promise.all([
    import('@cairn/dapi/x11'),
    import('@cairn/dapi/bls'),
    import('@cairn/dapi/coreproof').catch(() => null),
  ]);
  return { hashHeader: x11, hashHeaders: x11Many, verifyChainLock, ...(coreproof ? { verifyQuorumProof: coreproof.verifyQuorumProof } : {}) };
}

let client: { key: string; dapi: Dapi; sources: ProofSource[] } | null = null;

/** One verifying client per network setting; its anchored chain is reused for a minute across checks (and the track record). */
function chainClient(r: Registry): { dapi: Dapi; sources: ProofSource[] } {
  const key = JSON.stringify([r.network, r.dapi]);
  if (client?.key !== key) {
    const source = r.dapi.source === 'quorum' || !r.dapi.nodes.length ? { nodeListUrl: r.dapi.quorumUrl } : { nodes: r.dapi.nodes };
    const proof = PROOF_SERVICE[r.network];
    client = { key, dapi: createDapi({ network: r.network, ...source, verifiers: loadVerifiers }), sources: proof ? [quorumListProofSource(proof)] : [] };
  }
  return client;
}

const NOT_FOUND = 5;
/** Two distinct nodes said NOT_FOUND (one node's word is inconclusive). */
function isNotFound(e: unknown): boolean {
  if (e instanceof GrpcError && e.code === NOT_FOUND) return true;
  if (!(e instanceof AllNodesFailedError)) return false;
  const nf = new Set(e.errors.filter((x) => x.error instanceof GrpcError && x.error.code === NOT_FOUND).map((x) => x.node));
  return nf.size >= 2 && nf.size === e.errors.length;
}

export type ChainLookup = ChainFacts | { notFound: true; proTxHash: string };

/**
 * The registration and the masternode's list entry, proven as far as DAPI allows. With a proof source the chain is anchored down to
 * the registration's block: inclusion, a verified ChainLock above it, and the list proven against the same chain. Without one (mainnet
 * today) the ChainLock is proven over a header walk and the list is the one at least two of three nodes agree on.
 */
export async function lookupRegistration(r: Registry, proTxHash: string, onProgress?: (m: string) => void): Promise<ChainLookup> {
  const { dapi, sources } = chainClient(r);
  const hash = proTxHash.toLowerCase();
  const say = (m: string) => onProgress?.(m);
  let first;
  try {
    say('Fetching the registration and proving it into its block');
    first = await dapi.getVerifiedTransaction(hash, { chainLock: false });
  } catch (e) {
    if (isNotFound(e)) return { notFound: true, proTxHash: hash };
    throw e;
  }
  const hex = toHex(first.raw);
  if (first.height === 0) {
    return { proTxHash: hash, hex, height: 0, mined: false, chainLocked: 'no', trust: 'node', weak: null, tip: 0, mn: undefined, listTrust: null, notes: ['The registration is not in a block yet.'] };
  }
  if (sources.length) {
    try {
      say('Verifying the chain from the pinned checkpoint');
      const anchor: AnchoredChain = await dapi.anchorChain({ from: first.height, proofSources: sources, onProgress: say });
      say('Proving the registration against the verified chain');
      const v = await dapi.getVerifiedTransaction(hash, { anchor });
      const entry = anchor.sml.masternodes.find((m) => m.proTxHash === hash);
      return {
        proTxHash: hash,
        hex,
        height: v.height,
        mined: v.proof.merkle,
        chainLocked: v.proof.anchor ? 'verified' : v.chainLocked,
        trust: anchor.trust.kind,
        weak: anchor.weak,
        tip: anchor.tip,
        mn: entry ? { isValid: entry.isValid } : null,
        listTrust: 'proven',
        notes: v.proof.notes,
      };
    } catch (e) {
      say(`The chain could not be anchored (${e instanceof Error ? e.message : String(e)}); proving the ChainLock directly`);
    }
  }
  const v = await dapi.getVerifiedTransaction(hash, { maxHeaderSpan: 30_000, headerTimeoutMs: 60_000 });
  say('Reading the masternode list from several nodes');
  const sml = await dapi.getSml().catch(() => null);
  const entry = sml?.masternodes.find((m) => m.proTxHash === hash);
  return {
    proTxHash: hash,
    hex,
    height: v.height,
    mined: v.proof.merkle,
    chainLocked: v.chainLocked,
    trust: 'node',
    weak: null,
    tip: Math.max(v.proof.chainLock?.height ?? 0, sml?.height ?? 0, v.height),
    mn: sml ? (entry ? { isValid: entry.isValid } : null) : undefined,
    listTrust: sml ? 'agreed' : null,
    notes: v.proof.notes,
  };
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
