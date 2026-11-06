// The writes a group's pages make, each a document of the writer's own (the organizer's group and invites, a member's seat and
// approval, the operator's answer), built by the contract's models and confirmed by a proved read-back.
import {
  GROUP_STATUS, INVITE_STATUS, SEAT_FLAG, approvalData, createOp, deleteOp, groupData, inviteData, opAcceptData, replaceOp, seatData,
  type GroupFields, type OpAcceptFields, type Seat, type SeatFields,
} from '@cairn/contract';
import { useMemo } from 'react';
import { useApp } from '../../app/context.tsx';
import { loadGroupBundle } from '../../data/cairn.ts';
import { StaleWrite, useWrite, type WriteOptions } from '../../data/write.ts';
import { change, isLockedStatus, type GroupBundle } from '../../matching/group.ts';

/** A seat's own fields, to change one and write it back. */
export const seatFieldsOf = (s: Seat): Omit<SeatFields, 'groupId'> => ({ amount: s.amount, message: s.message, status: s.status, flags: s.flags, votingAddress: s.votingAddress, proTxHash: s.proTxHash });

/**
 * Why a write this page is about to make no longer fits the group as Platform now stores it (`fresh`), or null. Replaces of a
 * stale document revision are caught by the writer itself; these are the creates Platform would refuse (a second seat, answer or
 * approval of one person) and approvals of terms that are no longer the locked ones.
 */
export function staleBefore(page: GroupBundle, fresh: GroupBundle | null, me: string, kind: 'seat' | 'answer' | 'approve' | 'invite', toId?: string): string | null {
  if (!fresh) return 'This group no longer exists, so nothing was sent.';
  const g = page.group;
  const f = fresh.group;
  switch (kind) {
    case 'seat':
      return !page.seats.some((s) => s.ownerId === me) && fresh.seats.some((s) => s.ownerId === me) ? 'You already have a seat in this group (from another tab or device), so nothing was sent. The page now shows it.' : null;
    case 'answer':
      return !page.opAccepts.some((o) => o.ownerId === me) && fresh.opAccepts.some((o) => o.ownerId === me) ? 'You already answered this group (from another tab or device), so nothing was sent. The page now shows your answer.' : null;
    case 'invite': {
      const had = (b: GroupBundle) => b.invites.some((i) => i.ownerId === me && i.toId === toId);
      return !had(page) && had(fresh) ? 'You already invited this person (from another tab or device), so nothing was sent. The page now shows the invitation.' : null;
    }
    case 'approve':
      // a node behind the page's version of the group is lagging, not a change: the approval names the terms the page showed
      if (f.docRevision < g.docRevision) return fresh.approvals.some((a) => a.ownerId === me && a.termsRevision === g.termsRevision) ? 'You already approved these terms (from another tab or device), so nothing was sent.' : null;
      if (!isLockedStatus(f.status) || f.termsRevision !== g.termsRevision || (f.lockedHash ?? '').toLowerCase() !== (g.lockedHash ?? '').toLowerCase())
        return `The terms changed since this page loaded (they are now terms version ${f.termsRevision}${isLockedStatus(f.status) ? '' : ', not locked yet'}), so your approval was not sent. Read them again before you approve.`;
      return fresh.approvals.some((a) => a.ownerId === me) ? 'You already approved these terms (from another tab or device), so nothing was sent.' : null;
  }
}

/** `onStale` runs when a write is refused before signing because the page is out of date: re-read the group. */
export function useGroupOps(b: GroupBundle, me: string | null, onStale?: () => void) {
  const { registry } = useApp();
  const signed = useWrite();
  return useMemo(() => {
    const cid = registry.contractId!;
    const net = registry.network;
    const g = b.group;
    const write: typeof signed = (op, o) =>
      signed(op, o).catch((e: unknown) => {
        if (e instanceof StaleWrite) onStale?.();
        throw e;
      });
    const fresh = (kind: Parameters<typeof staleBefore>[3], toId?: string): WriteOptions => ({
      check: async () => {
        const why = me ? staleBefore(b, await loadGroupBundle(registry, g.id), me, kind, toId) : null;
        if (why) throw new StaleWrite(why);
      },
    });
    const mySeat = me ? b.seats.find((s) => s.ownerId === me) : undefined;
    const myAnswer = me ? b.opAccepts.find((o) => o.ownerId === me) : undefined;
    const myApproval = me ? b.approvals.find((a) => a.ownerId === me) : undefined;
    const organizer = !!me && me === g.ownerId;
    /** A co-owner's own seat: where someone who is not the organizer records formation progress. */
    const coOwnerSeat = me && g.roster.some((r) => r.id === me) ? mySeat : undefined;
    const group = (f: GroupFields) => write(() => replaceOp(cid, 'group', g.id, g.docRevision, groupData(f, net)));
    const seat = (f: Omit<SeatFields, 'groupId'>) => {
      const data = () => seatData({ ...f, groupId: g.id }, net);
      return mySeat ? write(() => replaceOp(cid, 'seat', mySeat.id, mySeat.docRevision, data())) : write(() => createOp(cid, 'seat', data()), fresh('seat'));
    };
    const coordinatorSeat = me === g.coordinatorId ? coOwnerSeat : undefined;
    return {
      mySeat,
      myAnswer,
      myApproval,
      /** The organizer's group, replaced at its stored document revision. */
      group,
      /** The viewer's seat in this group: created the first time, replaced after (one per member and group on Platform). */
      seat,
      /** The operator's answer to this group. */
      answer: (f: Omit<OpAcceptFields, 'groupId'>) => {
        const data = () => opAcceptData({ ...f, groupId: g.id }, net);
        return myAnswer ? write(() => replaceOp(cid, 'opAccept', myAnswer.id, myAnswer.docRevision, data())) : write(() => createOp(cid, 'opAccept', data()), fresh('answer'));
      },
      /** The organizer's stance on one person: an open invite, or withdrawn (no longer invited, or a request declined). */
      invite: (toId: string, amount: number, status: number, message?: string) => {
        const existing = b.invites.find((i) => i.ownerId === g.ownerId && i.toId === toId);
        const data = () => inviteData({ groupId: g.id, toId, amount, status, message });
        return existing ? write(() => replaceOp(cid, 'invite', existing.id, existing.docRevision, data())) : write(() => createOp(cid, 'invite', data()), fresh('invite', toId));
      },
      /** F-002: approving terms that are no longer the locked ones would be charged and void at once, so they are re-read first. */
      approve: (termsHash: string, shareAmount: number) => write(() => createOp(cid, 'approval', approvalData({ groupId: g.id, termsRevision: g.termsRevision, termsHash, shareAmount })), fresh('approve')),
      withdrawApproval: () => (myApproval ? write(deleteOp(cid, 'approval', myApproval.id)) : Promise.resolve(null)),
      /** M10: the organizer links the registration in the group (claiming live; the chain decides on read), a co-owner in their own seat. */
      canLink: organizer || !!coOwnerSeat,
      linkRegistration: (proTxHash: string) =>
        organizer ? group(change(g, { proTxHash, status: GROUP_STATUS.live })) : coOwnerSeat ? seat({ ...seatFieldsOf(coOwnerSeat), proTxHash }) : Promise.reject(new Error('Only the organizer or a co-owner with a seat can link the registration.')),
      /** The Dash-Qt session has started: the organizer's group status, or the coordinator's own seat flag. */
      canMarkStarted: organizer || !!coordinatorSeat,
      markStarted: () =>
        organizer
          ? group(change(g, { status: GROUP_STATUS.formingOnchain }))
          : coordinatorSeat
            ? seat({ ...seatFieldsOf(coordinatorSeat), flags: (coordinatorSeat.flags ?? 0) | SEAT_FLAG.sessionStarted })
            : Promise.reject(new Error('Only the organizer or the coordinator can mark the session as started.')),
    };
  }, [registry, signed, b, me, onStale]);
}

export type GroupOps = ReturnType<typeof useGroupOps>;
export const OPEN = INVITE_STATUS.open;
export const WITHDRAWN = INVITE_STATUS.withdrawn;
