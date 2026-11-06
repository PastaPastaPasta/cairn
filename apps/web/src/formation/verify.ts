// M10: is a linked registration the masternode the group approved? Computed from chain facts and the approvals on every read; the
// group's own status field is never consulted.
import { type CheckResult, checkRegistrationAgainstTerms } from '@cairn/shares';
import type { Agreement } from './data.ts';

/** What the chain says about a registration (chain.ts gathers it over DAPI). */
export interface ChainFacts {
  proTxHash: string;
  /** Raw transaction, hash-checked against the txid. */
  hex: string;
  /** 0 while unconfirmed. */
  height: number;
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

export type RegistrationState = 'verified' | 'mismatch' | 'unproven' | 'unconfirmed' | 'not-found';
export type MnState = 'valid' | 'banned' | 'dissolved' | 'unknown';

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
  verified: 'Live (verified)',
  mismatch: 'Does not match what was approved',
  unproven: 'Registered, proof incomplete',
  unconfirmed: 'Waiting for a block',
  'not-found': 'Not on the chain',
};

export function mnStateOf(f: ChainFacts | null): { state: MnState; text: string } {
  if (!f || f.height === 0 || f.mn === undefined) return { state: 'unknown', text: 'The masternode list could not be read.' };
  if (f.mn === null) {
    return { state: 'dissolved', text: 'It is no longer in the masternode list. A shared masternode leaves the list only when a dissolution spends its collateral, so it has been dissolved.' };
  }
  return f.mn.isValid
    ? { state: 'valid', text: 'Valid in the masternode list: it takes part and is paid in turn.' }
    : { state: 'banned', text: 'PoSe-banned: the network does not pay it until the operator fixes the node and sends a service update.' };
}

export function judgeRegistration(agreement: Agreement, lookup: ChainFacts | { notFound: true; proTxHash: string }): RegistrationJudgement {
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
  if (!lookup.mined || lookup.chainLocked !== 'verified') {
    return {
      ...base,
      state: 'unproven',
      headline: STATE_HEADLINE.unproven,
      detail: `It matches the approved terms and is in block ${lookup.height.toLocaleString('en-US')}, but the ChainLock above it could not be verified${lookup.notes.length ? ` (${lookup.notes.join('; ')})` : ''}.`,
    };
  }
  return {
    ...base,
    state: 'verified',
    headline: STATE_HEADLINE.verified,
    detail: `Registered in block ${lookup.height.toLocaleString('en-US')}, ChainLocked, and exactly what every member approved: shares, operator, voting key, reward, exit terms and service, with every co-owner’s approval valid.`,
  };
}
