// Where a group is in its life (DESIGN §6), one answer for the group page, its next steps, /me and the form page:
//   open → full → locked → ready to form → session started → linked → live | mismatch → dissolved
// Whatever the chain can know (a registration's match, live, dissolved) comes from the chain check of the linked registration; the
// group's status field is only the organizer's claim and decides nothing the chain can.
import { GROUP_STATUS } from '@cairn/contract';
import type { RegistrationJudgement, RegistrationState } from '../formation/verify.ts';
import type { GroupView } from './group.ts';

export type Stage = 'open' | 'full' | 'locked' | 'ready' | 'session-started' | 'linked' | 'live' | 'mismatch' | 'dissolved' | 'closed';

/** The chain's verdict on the group's registration (the verified one if several are linked); null while unchecked. */
export type ChainVerdict = Pick<RegistrationJudgement, 'state' | 'mnState'>;

const MATCHES: readonly RegistrationState[] = ['verified', 'unproven', 'unconfirmed'];

export function stageOf(v: GroupView, chain: ChainVerdict | null): Stage {
  if (v.linked.length) {
    // a hash no node knows is a typo or a node not serving it yet, not proof the registration differs
    if (!chain || chain.state === 'not-found') return 'linked';
    if (!MATCHES.includes(chain.state)) return 'mismatch';
    if (chain.mnState === 'dissolved') return 'dissolved';
    return chain.state === 'verified' ? 'live' : 'linked';
  }
  if (v.group.status === GROUP_STATUS.cancelled) return 'closed';
  if (v.group.status === GROUP_STATUS.dissolved) return 'dissolved';
  if (v.ready) return v.sessionStarted ? 'session-started' : 'ready';
  if (v.locked) return 'locked';
  return v.full ? 'full' : 'open';
}

/** Past "ready to form": the form page's tools and the live page are where the group's next steps happen. */
export const isFormed = (s: Stage) => s === 'linked' || s === 'live' || s === 'mismatch' || s === 'dissolved';

/** The Dash-Qt session is under way or done: the terms stay as locked, and the form and live pages take over. */
export const isUnderway = (s: Stage) => s === 'session-started' || isFormed(s);
