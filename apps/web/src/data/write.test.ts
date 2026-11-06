// The confirmed writer: a write counts only when a proved read shows the new revision holding exactly what was sent.
import { GROUP_STATUS, MN_TYPE, SEAT_STATUS, createOp, deleteOp, groupData, replaceOp, seatData, type RawDoc } from '@cairn/contract';
import { describe, expect, it, vi } from 'vitest';
import { PROFILES } from '../config/registry.ts';
import { A, GID, ORG, id } from '../matching/fixtures.ts';
import { readDoc, remember } from './cairn.ts';
import { holdsData, StaleWrite, UnconfirmedWrite, writeConfirmed, type WriteDeps } from './write.ts';

vi.mock('./platform.ts', () => ({ getCairnDoc: vi.fn(async () => null), queryCairn: vi.fn() }));

const r = PROFILES.testnet;
const CID = r.contractId!;
const SEAT_ID = id(80);
const seat = (amount: number) => seatData({ groupId: GID, amount, status: SEAT_STATUS.requested, flags: 1 }, 'testnet');
/** A document as a proved read returns it: identifiers base58, the data as stored. */
const stored = (data: Record<string, unknown>, revision: number, docId = SEAT_ID): RawDoc => ({ ...data, $id: docId, $ownerId: A, $revision: revision, groupId: GID, $createdAt: 5, $updatedAt: 6 });

function deps(reads: Array<RawDoc | null>): WriteDeps & { calls: number } {
  const d = {
    calls: 0,
    read: vi.fn(async () => reads[Math.min(d.calls++, reads.length - 1)] ?? null),
    sleep: async () => {},
  };
  return d;
}

describe('confirmed writes', () => {
  it('reads back a create until the node shows it, and returns what Platform holds', async () => {
    const data = seat(300e8);
    const d = deps([null, stored(data, 1)]);
    const back = await writeConfirmed(r, async () => ({ id: SEAT_ID, revision: 1 }), createOp(CID, 'seat', data), d);
    expect(back?.$id).toBe(SEAT_ID);
    expect(d.calls).toBe(2);
  });

  it('waits for the new revision of a replace and refuses a different document', async () => {
    const data = seat(400e8);
    const lagging = deps([stored(seat(300e8), 1), stored(data, 2)]);
    await expect(writeConfirmed(r, async () => ({ id: SEAT_ID, revision: 2 }), replaceOp(CID, 'seat', SEAT_ID, 1, data), lagging)).resolves.toBeTruthy();
    const other = deps([stored(seat(300e8), 1), stored(seat(500e8), 2)]);
    await expect(writeConfirmed(r, async () => ({ id: SEAT_ID, revision: 2 }), replaceOp(CID, 'seat', SEAT_ID, 1, data), other)).rejects.toThrow(/different version/);
    const never = deps([stored(seat(300e8), 1)]);
    await expect(writeConfirmed(r, async () => ({ id: SEAT_ID, revision: 2 }), replaceOp(CID, 'seat', SEAT_ID, 1, data), never)).rejects.toThrow(/does not show it yet/);
  });

  it('sends nothing when the document changed after the page read it (F-001)', async () => {
    const write = vi.fn(async () => ({ id: SEAT_ID, revision: 2 }));
    const newer = deps([stored(seat(500e8), 2)]);
    await expect(writeConfirmed(r, write, replaceOp(CID, 'seat', SEAT_ID, 1, seat(400e8)), newer)).rejects.toBeInstanceOf(StaleWrite);
    const gone = deps([null]);
    await expect(writeConfirmed(r, write, replaceOp(CID, 'seat', SEAT_ID, 1, seat(400e8)), gone)).rejects.toBeInstanceOf(StaleWrite);
    await expect(writeConfirmed(r, write, deleteOp(CID, 'seat', SEAT_ID), deps([null]))).rejects.toBeInstanceOf(StaleWrite);
    expect(write).not.toHaveBeenCalled();
  });

  it('runs the caller’s check before signing, and sends nothing when it throws', async () => {
    const write = vi.fn(async () => ({ id: SEAT_ID, revision: 1 }));
    const check = vi.fn(async () => {
      throw new StaleWrite('the terms changed');
    });
    await expect(writeConfirmed(r, write, createOp(CID, 'seat', seat(300e8)), deps([null]), { check })).rejects.toThrow('the terms changed');
    expect(check).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it('confirms a delete only once the document is gone', async () => {
    const d = deps([stored(seat(300e8), 1), null]);
    await expect(writeConfirmed(r, async () => ({ id: SEAT_ID }), deleteOp(CID, 'seat', SEAT_ID), d)).resolves.toBeNull();
  });

  it('confirms deleting a document this tab wrote, which the node no longer has', async () => {
    remember(r, 'approval', SEAT_ID, stored(seat(300e8), 1));
    await expect(writeConfirmed(r, async () => ({ id: SEAT_ID }), deleteOp(CID, 'approval', SEAT_ID), { read: readDoc, sleep: async () => {} })).resolves.toBeNull();
    await expect(readDoc(r, 'approval', SEAT_ID)).resolves.toBeNull();
  });

  it('names the written document when the read-back fails, so a retry does not write it twice', async () => {
    const err = await writeConfirmed(r, async () => ({ id: SEAT_ID, revision: 1 }), createOp(CID, 'seat', seat(300e8)), deps([null])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnconfirmedWrite);
    expect((err as UnconfirmedWrite).id).toBe(SEAT_ID);
  });

  it('compares a group through its reader, with the network’s rules', () => {
    const g = groupData({ title: 'x', mnType: MN_TYPE.regular, operatorId: ORG, rewardBps: 1000, earlyPeriodBlocks: 0, earlyPenalty: 0, roster: [{ id: A, amount: 500e8 }], termsRevision: 3, status: GROUP_STATUS.forming }, 'testnet');
    const back = { ...g, $id: GID, $ownerId: ORG, $revision: 7, operatorId: ORG, roster: g.roster };
    expect(holdsData('group', back, g, 'testnet')).toBe(true);
    expect(holdsData('group', { ...back, revision: 4 }, g, 'testnet')).toBe(false);
  });
});
