// Starting a group: the group document, then the organizer's own seat, then any invitations, each confirmed by a proved read-back.
// Steps already confirmed are remembered, so "Finish" after an error never repeats a write (a second group would be a second listing).
import { INVITE_STATUS, SEAT_STATUS, createOp, groupData, inviteData, seatData, type GroupFields, type RawDoc } from '@cairn/contract';
import { useRef, useState } from 'react';
import { useApp } from '../app/context.tsx';
import { useAction } from '../ui/useAction.ts';
import { rawId } from './cairn.ts';
import { UnconfirmedWrite, useWrite } from './write.ts';

export interface StartPlan {
  fields: GroupFields;
  /** The organizer's own share (duffs) and seat flags, when they bring one. */
  mySeat?: { amount: number; flags: number };
  invites?: Array<{ id: string; amount: number; said: string }>;
}

export function useStartGroup() {
  const { registry } = useApp();
  const write = useWrite();
  const action = useAction();
  const [progress, setProgress] = useState<string[]>([]);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const done = useRef(new Set<string>());
  // once the group exists, its plan is fixed: "Finish" completes what was started, never a changed amount or a second group
  const started = useRef<StartPlan | null>(null);

  /** Runs the plan (or, once a group was written, the plan that wrote it); resolves with the group id once every step is confirmed. */
  const start = (next: StartPlan, then: (groupId: string) => void) =>
    action.run(async () => {
      const plan = started.current ?? next;
      const cid = registry.contractId!;
      const net = registry.network;
      setProgress([]);
      // a write Platform accepted counts as done even when its read-back failed: retrying would make a second document
      const once = async (key: string, f: () => Promise<RawDoc | null>, said: string): Promise<string | null> => {
        if (done.current.has(key)) return null;
        try {
          const back = await f();
          done.current.add(key);
          setProgress((p) => [...p, said]);
          return back ? rawId(back, '$id') : null;
        } catch (e) {
          if (e instanceof UnconfirmedWrite) {
            done.current.add(key);
            if (key === 'group') {
              started.current = plan;
              setCreatedId(e.id);
            }
          }
          throw e;
        }
      };
      let gid = createdId;
      if (!gid) {
        gid = await once('group', () => write(() => createOp(cid, 'group', groupData(plan.fields, net))), 'Group created and read back.');
        started.current = plan;
        setCreatedId(gid);
      }
      const groupId = gid!;
      const seat = plan.mySeat;
      if (seat) await once('seat', () => write(() => createOp(cid, 'seat', seatData({ groupId, amount: seat.amount, status: SEAT_STATUS.requested, flags: seat.flags }, net))), 'Your seat confirmed.');
      for (const inv of plan.invites ?? []) await once(`invite:${inv.id}`, () => write(() => createOp(cid, 'invite', inviteData({ groupId, toId: inv.id, amount: inv.amount, status: INVITE_STATUS.open }))), inv.said);
      then(groupId);
    });

  /** The plan of the group already written, when a step after it has not been confirmed yet. */
  return { ...action, start, progress, createdId, pending: createdId ? started.current : null };
}

const STONES = ['Basalt', 'Granite', 'Slate', 'Flint', 'Quartz', 'Marble', 'Shale', 'Gneiss', 'Jasper', 'Onyx', 'Agate', 'Schist', 'Chert', 'Tuff', 'Feldspar', 'Obsidian'];

/** A name for a new group until its organizer picks one: a stone and a number, like "Basalt 27". */
export function suggestGroupName(rand: () => number = Math.random): string {
  return `${STONES[Math.floor(rand() * STONES.length)]} ${10 + Math.floor(rand() * 90)}`;
}
