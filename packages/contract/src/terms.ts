// The one term-sheet builder (DESIGN.md §7). Locking, approving, verifying approvals, the message checker and the on-chain check all
// hash what this returns, so a group document always means the same terms to every page and every front end.
import type { Network as CoreNetwork, TermSheet } from '@cairn/shares';
import type { GroupFields } from './models.ts';
import type { Network } from './schema.ts';

export const coreNetwork = (n: Network): CoreNetwork => (n === 'mainnet' ? 'main' : 'test');

/** The group fields the term sheet is made of. */
export type TermFields = Pick<
  GroupFields,
  'roster' | 'termsRevision' | 'operatorPubKey' | 'service' | 'votingAddress' | 'votingHolderId' | 'rewardBps' | 'earlyPeriodBlocks' | 'earlyPenalty' | 'coordinatorId'
>;

/**
 * The canonical term sheet a group document (or the fields about to be written) states: shares in roster order, the operator key in
 * lower case. Missing values stay empty, so `validateTermSheet` names them; only a valid sheet has a hash anyone approves.
 */
export function termSheetFromGroup(groupId: string, f: TermFields, network: Network): TermSheet {
  return {
    network: coreNetwork(network),
    groupId,
    revision: f.termsRevision,
    shares: f.roster.map((r) => ({ memberId: r.id, label: r.label ?? '', amount: BigInt(r.amount) })),
    operatorPubKey: (f.operatorPubKey ?? '').toLowerCase(),
    service: f.service ?? '',
    votingAddress: f.votingAddress ?? '',
    votingHolderId: f.votingHolderId ?? '',
    rewardBps: f.rewardBps,
    earlyPeriodBlocks: f.earlyPeriodBlocks,
    earlyPenalty: BigInt(f.earlyPenalty),
    coordinatorId: f.coordinatorId ?? '',
  };
}
