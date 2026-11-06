// M10: is a linked registration the masternode the group approved? Computed from chain facts and the approvals on every read; the
// group's own status field is never consulted. "Verified" means agreed before registered: anyone can copy a masternode's public
// terms into a group once its registration is broadcast, so a match counts only when every approval, and the operator's key on
// Cairn, are at least AGREE_MARGIN_MS older than the registration's block.
import { OP_ACCEPT_STATUS, type Approval, type Group, type OpAccept } from '@cairn/contract';
import { type CheckResult, checkRegistrationAgainstTerms, coreP2PEntries, decodeSharedProRegTx } from '@cairn/shares';
import type { Agreement } from '../matching/agreement.ts';

/** What the chain says about a registration (chain.ts gathers it over DAPI). */
export interface ChainFacts {
  proTxHash: string;
  /** Raw transaction, hash-checked against the txid. */
  hex: string;
  /** 0 while unconfirmed. */
  height: number;
  /** The registration block's header time (seconds), from a header hashed to the proven block; null when it could not be read. */
  blockTime: number | null;
  /** Proven into its block by the merkle root. */
  mined: boolean;
  chainLocked: 'verified' | 'claimed' | 'no';
  /** What the chain proof rests on: ChainLocks from the pinned quorum checkpoint, proof of work, or nodes' agreement. */
  trust: 'quorum-proof' | 'proof-of-work' | 'node';
  /** Set when the chain proof is not secure against a malicious node (testnet proof of work). */
  weak: string | null;
  /** The verified chain tip (a lower bound). */
  tip: number;
  /** The masternode's list entry at the tip: null when the list does not have it, undefined when no list could be read. */
  mn: { isValid: boolean } | null | undefined;
  listTrust: 'proven' | 'agreed' | null;
  notes: string[];
}

export type RegistrationState = 'verified' | 'recorded-after' | 'mismatch' | 'unproven' | 'unconfirmed' | 'not-found';
/** `no-service`: banned because the operator has not given the node its address yet (registered without a service). */
export type MnState = 'valid' | 'no-service' | 'banned' | 'dissolved' | 'unknown';

export interface RegistrationJudgement {
  proTxHash: string;
  state: RegistrationState;
  headline: string;
  detail: string;
  /** Every difference from what was approved, in plain words. */
  problems: string[];
  check: CheckResult | null;
  mnState: MnState;
  mnText: string;
  facts: ChainFacts | null;
}

export const STATE_HEADLINE: Record<RegistrationState, string> = {
  verified: 'Registration verified',
  'recorded-after': 'Registration matches these terms, but they were recorded after it was registered',
  mismatch: 'Does not match what was approved',
  unproven: 'Registered, proof incomplete',
  unconfirmed: 'Waiting for a block',
  'not-found': 'Not on the chain',
};

/** Whether the network pays the masternode, in words: the one status a co-owner cares about most. */
export const MN_HEADLINE: Record<MnState, string> = {
  valid: 'Earning',
  'no-service': 'Not earning yet: waiting for the operator’s service update',
  banned: 'Not earning: PoSe-banned',
  dissolved: 'Dissolved',
  unknown: 'Earning status unknown',
};

function registeredWithoutService(hex: string): boolean {
  try {
    return coreP2PEntries(decodeSharedProRegTx(hex).payload.netInfo).length === 0;
  } catch {
    return false;
  }
}

export function mnStateOf(f: ChainFacts | null): { state: MnState; text: string } {
  if (!f || f.height === 0 || f.mn === undefined) return { state: 'unknown', text: 'The masternode list could not be read just now, so Cairn cannot say whether the network pays it.' };
  if (f.mn === null) {
    return { state: 'dissolved', text: 'It is no longer in the masternode list. A shared masternode leaves the list only when someone leaves, so it has been dissolved and every share went back to its refund address.' };
  }
  if (f.mn.isValid) return { state: 'valid', text: 'The network lists it as valid: it takes part and is paid in turn.' };
  // Cairn's list entries do not keep the address, so this reads the registration: registered without one, the operator's service
  // update is what it waits for (an update and a later ban needs one as well, so the advice holds either way)
  if (registeredWithoutService(f.hex)) {
    return { state: 'no-service', text: 'It was registered without the node’s IP address, and the network pays it only after the operator sends a service update with it. Your coins are safe in the collateral.' };
  }
  return { state: 'banned', text: 'The network banned it for missing its duties, so it is not paid until the operator fixes the node and sends a service update. Your coins are safe in the collateral.' };
}

/**
 * How long before the registration's block time every approval and the operator's key must be on Cairn. Platform's `$createdAt`
 * is its own block time, which a user cannot set, but a registration's terms are public from the moment it is broadcast: someone
 * watching the mempool can copy them into a group and approve them before the block is mined, and a miner may set the block's time
 * somewhat ahead. Honest groups approve before their Dash-Qt session, which takes several rounds, so they clear this easily.
 */
export const AGREE_MARGIN_MS = 15 * 60_000;

/**
 * When the operator's key was on Cairn (ms): the first approval of the locked terms by a roster member, since the approved terms
 * hash covers the key. In a member-led group the operator's own accepted answer must also carry that key (its time is not used:
 * it changes on every later edit).
 */
export function operatorKeyPublishedAt(g: Group, opAccepts: readonly OpAccept[], approvals: readonly Approval[]): number | null {
  const key = (g.operatorPubKey ?? '').toLowerCase();
  const locked = (g.lockedHash ?? '').toLowerCase();
  if (!key || !locked) return null;
  const operatorLed = !!g.operatorId && g.operatorId === g.ownerId;
  if (!operatorLed && !opAccepts.some((o) => o.ownerId === g.operatorId && o.status === OP_ACCEPT_STATUS.accepted && (o.operatorPubKey ?? '').toLowerCase() === key)) return null;
  const times = approvals
    .filter((a) => a.termsRevision === g.termsRevision && a.termsHash.toLowerCase() === locked && g.roster.some((r) => r.id === a.ownerId))
    .map((a) => a.createdAt);
  return times.length && times.every((t) => t !== undefined) ? Math.min(...(times as number[])) : null;
}

/** What was not on Cairn by AGREE_MARGIN_MS before the registration's block time (empty: everything was agreed in time). */
export function recordedLate(agreement: Agreement, keyPublishedAt: number | null, blockTime: number): string[] {
  const cutoff = blockTime * 1000 - AGREE_MARGIN_MS;
  const late = agreement.members.filter((m) => m.approval?.createdAt === undefined || m.approval.createdAt > cutoff).map((m) => `${m.label || 'a co-owner'}’s approval`);
  if (keyPublishedAt === null || keyPublishedAt > cutoff) late.push('the operator’s key');
  return late;
}

const block = (h: number) => `block ${h.toLocaleString('en-US')}`;
const listWords = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** `keyPublishedAt`: operatorKeyPublishedAt of the group; without it the registration can match but never count as verified. */
export function judgeRegistration(agreement: Agreement, lookup: ChainFacts | { notFound: true; proTxHash: string }, keyPublishedAt: number | null = null): RegistrationJudgement {
  if ('notFound' in lookup) {
    return {
      proTxHash: lookup.proTxHash,
      state: 'not-found',
      headline: STATE_HEADLINE['not-found'],
      detail: 'No node has a transaction with this hash. Check that the whole ProTx hash was copied from Dash-Qt.',
      problems: [],
      check: null,
      mnState: 'unknown',
      mnText: '',
      facts: null,
    };
  }
  const check = agreement.terms ? checkRegistrationAgainstTerms(lookup.hex, agreement.terms, { proTxHash: lookup.proTxHash }) : null;
  const problems = [
    ...agreement.problems,
    ...(check?.findings.filter((x) => x.level === 'stop').map((x) => (x.detail ? `${x.title}: ${x.detail}` : x.title)) ?? []),
  ];
  const mn = mnStateOf(lookup);
  const base = { proTxHash: lookup.proTxHash, problems, check, mnState: mn.state, mnText: mn.text, facts: lookup };
  if (problems.length) {
    return { ...base, state: 'mismatch', headline: STATE_HEADLINE.mismatch, detail: 'This registration is not what every member approved. Nobody should treat it as this group’s masternode.' };
  }
  if (lookup.height === 0) {
    return { ...base, state: 'unconfirmed', headline: STATE_HEADLINE.unconfirmed, detail: 'It matches the approved terms. Cairn verifies it again once it is in a block.' };
  }
  if (lookup.weak) {
    return {
      ...base,
      state: 'unproven',
      headline: STATE_HEADLINE.unproven,
      detail: `It matches the approved terms and is in block ${lookup.height.toLocaleString('en-US')}, but the chain it was proven on is not secure against a lying node here (${lookup.weak}).`,
    };
  }
  if (!lookup.mined || lookup.chainLocked !== 'verified') {
    return {
      ...base,
      state: 'unproven',
      headline: STATE_HEADLINE.unproven,
      detail: `It matches the approved terms and is in ${block(lookup.height)}, but the network’s final confirmation of that block could not be checked here${lookup.notes.length ? ` (${lookup.notes.join('; ')})` : ''}.`,
    };
  }
  if (lookup.blockTime === null) {
    return { ...base, state: 'unproven', headline: STATE_HEADLINE.unproven, detail: `It matches the approved terms and is in ${block(lookup.height)}, but the time of that block could not be read, so Cairn cannot tell whether the terms were agreed before it.` };
  }
  const late = recordedLate(agreement, keyPublishedAt, lookup.blockTime);
  if (late.length) {
    return {
      ...base,
      state: 'recorded-after',
      headline: STATE_HEADLINE['recorded-after'],
      detail: `The masternode in ${block(lookup.height)} has exactly these shares, operator, voting key, reward, exit terms and service, but ${listWords(late)} ${late.length === 1 ? 'was' : 'were'} not on Cairn ${AGREE_MARGIN_MS / 60_000} minutes before it was registered. Anyone can copy a masternode’s public terms once its registration is broadcast, so Cairn does not count it as this group’s verified masternode or in the operator’s track record.`,
    };
  }
  return {
    ...base,
    state: 'verified',
    headline: STATE_HEADLINE.verified,
    detail: `Registered in ${block(lookup.height)}, confirmed for good, and exactly what all ${agreement.members.length} co-owners approved before it was registered: shares, operator, voting key, reward, exit terms and service.`,
  };
}
