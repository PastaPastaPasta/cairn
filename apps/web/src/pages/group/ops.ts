// The writes a group's pages make, each a document of the writer's own (the organizer's group and invites, a member's seat and
// approval, the operator's answer), built by the contract's models and confirmed by a proved read-back.
import {
  GROUP_STATUS, INVITE_STATUS, SEAT_FLAG, approvalData, createOp, deleteOp, groupData, inviteData, opAcceptData, replaceOp, seatData,
  type GroupFields, type OpAcceptFields, type Seat, type SeatFields,
} from '@cairn/contract';
import { useMemo } from 'react';
import { useApp } from '../../app/context.tsx';
import { useWrite } from '../../data/write.ts';
import { change, type GroupBundle } from '../../matching/group.ts';

/** A seat's own fields, to change one and write it back. */
export const seatFieldsOf = (s: Seat): Omit<SeatFields, 'groupId'> => ({ amount: s.amount, message: s.message, status: s.status, flags: s.flags, votingAddress: s.votingAddress, proTxHash: s.proTxHash });

export function useGroupOps(b: GroupBundle, me: string | null) {
  const { registry } = useApp();
  const write = useWrite();
  return useMemo(() => {
    const cid = registry.contractId!;
    const net = registry.network;
    const g = b.group;
    const mySeat = me ? b.seats.find((s) => s.ownerId === me) : undefined;
    const myAnswer = me ? b.opAccepts.find((o) => o.ownerId === me) : undefined;
    const myApproval = me ? b.approvals.find((a) => a.ownerId === me) : undefined;
    const organizer = !!me && me === g.ownerId;
    /** A co-owner's own seat: where someone who is not the organizer records formation progress. */
    const coOwnerSeat = me && g.roster.some((r) => r.id === me) ? mySeat : undefined;
    const group = (f: GroupFields) => write(() => replaceOp(cid, 'group', g.id, g.docRevision, groupData(f, net)));
    const seat = (f: Omit<SeatFields, 'groupId'>) => {
      const data = () => seatData({ ...f, groupId: g.id }, net);
      return write(() => (mySeat ? replaceOp(cid, 'seat', mySeat.id, mySeat.docRevision, data()) : createOp(cid, 'seat', data())));
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
        return write(() => (myAnswer ? replaceOp(cid, 'opAccept', myAnswer.id, myAnswer.docRevision, data()) : createOp(cid, 'opAccept', data())));
      },
      /** The organizer's stance on one person: an open invite, or withdrawn (no longer invited, or a request declined). */
      invite: (toId: string, amount: number, status: number, message?: string) => {
        const existing = b.invites.find((i) => i.ownerId === g.ownerId && i.toId === toId);
        const data = () => inviteData({ groupId: g.id, toId, amount, status, message });
        return write(() => (existing ? replaceOp(cid, 'invite', existing.id, existing.docRevision, data()) : createOp(cid, 'invite', data())));
      },
      approve: (termsHash: string, shareAmount: number) => write(() => createOp(cid, 'approval', approvalData({ groupId: g.id, termsRevision: g.termsRevision, termsHash, shareAmount }))),
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
  }, [registry, write, b, me]);
}

export type GroupOps = ReturnType<typeof useGroupOps>;
export const OPEN = INVITE_STATUS.open;
export const WITHDRAWN = INVITE_STATUS.withdrawn;
