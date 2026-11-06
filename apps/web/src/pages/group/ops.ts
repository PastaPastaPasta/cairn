// The writes a group page makes, each a document of the writer's own (the organizer's group and invites, a member's seat and
// approval, the operator's answer), built by the contract's models and confirmed by a proved read-back.
import {
  INVITE_STATUS, approvalData, createOp, deleteOp, groupData, inviteData, opAcceptData, replaceOp, seatData,
  type GroupFields, type OpAcceptFields, type SeatFields,
} from '@cairn/contract';
import { useMemo } from 'react';
import { useApp } from '../../app/context.tsx';
import { useWrite } from '../../data/write.ts';
import type { GroupBundle } from '../../matching/group.ts';

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
    return {
      mySeat,
      myAnswer,
      myApproval,
      /** The organizer's group, replaced at its stored document revision. */
      group: (f: GroupFields) => write(() => replaceOp(cid, 'group', g.id, b.docRevision, groupData(f, net))),
      /** The viewer's seat in this group: created the first time, replaced after (one per member and group on Platform). */
      seat: (f: Omit<SeatFields, 'groupId'>) => {
        const data = () => seatData({ ...f, groupId: g.id }, net);
        return write(() => (mySeat ? replaceOp(cid, 'seat', mySeat.id, mySeat.revision, data()) : createOp(cid, 'seat', data())));
      },
      /** The operator's answer to this group. */
      answer: (f: Omit<OpAcceptFields, 'groupId'>) => {
        const data = () => opAcceptData({ ...f, groupId: g.id }, net);
        return write(() => (myAnswer ? replaceOp(cid, 'opAccept', myAnswer.id, myAnswer.revision, data()) : createOp(cid, 'opAccept', data())));
      },
      /** The organizer's stance on one person: an open invite, or withdrawn (no longer invited, or a request declined). */
      invite: (toId: string, amount: number, status: number, message?: string) => {
        const existing = b.invites.find((i) => i.ownerId === g.ownerId && i.toId === toId);
        const data = () => inviteData({ groupId: g.id, toId, amount, status, message });
        return write(() => (existing ? replaceOp(cid, 'invite', existing.id, existing.revision, data()) : createOp(cid, 'invite', data())));
      },
      approve: (termsHash: string, shareAmount: number) => write(() => createOp(cid, 'approval', approvalData({ groupId: g.id, revision: g.revision, termsHash, shareAmount }))),
      withdrawApproval: () => (myApproval ? write(deleteOp(cid, 'approval', myApproval.id)) : Promise.resolve(null)),
    };
  }, [registry, write, b, me]);
}

export type GroupOps = ReturnType<typeof useGroupOps>;
export const OPEN = INVITE_STATUS.open;
export const WITHDRAWN = INVITE_STATUS.withdrawn;
