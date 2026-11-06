// The write pre-flight (F-001, F-002): a write the page can tell Platform would refuse, or one that no longer means what the page
// showed, is never signed.
import { GROUP_STATUS } from '@cairn/contract';
import { describe, expect, it } from 'vitest';
import { A, B, D, approval, group, opAccept, seat } from '../../matching/fixtures.ts';
import type { GroupBundle } from '../../matching/group.ts';
import { staleBefore } from './ops.ts';

const locked = (over: Partial<GroupBundle['group']> = {}): GroupBundle => ({
  group: group({ roster: [{ id: A, amount: D(600) }, { id: B, amount: D(400) }], status: GROUP_STATUS.locked, termsRevision: 2, lockedHash: 'ab'.repeat(32), ...over }),
  seats: [seat(A, D(600)), seat(B, D(400))],
  opAccepts: [opAccept()],
  invites: [],
  approvals: [],
  voided: [],
});

describe('write pre-flight', () => {
  it('lets an approval of the terms still locked through', () => {
    expect(staleBefore(locked(), locked(), B, 'approve')).toBeNull();
  });

  it('refuses to approve terms the organizer changed or unlocked since the page loaded', () => {
    const page = locked();
    expect(staleBefore(page, locked({ termsRevision: 3, lockedHash: 'cd'.repeat(32) }), B, 'approve')).toMatch(/terms changed since this page loaded \(they are now terms version 3\)/);
    expect(staleBefore(page, locked({ termsRevision: 3, status: GROUP_STATUS.full, lockedHash: undefined }), B, 'approve')).toMatch(/not locked yet/);
    expect(staleBefore(page, null, B, 'approve')).toMatch(/no longer exists/);
  });

  it('reads a node behind the page as lag, not as changed terms', () => {
    const page = locked({ docRevision: 4 });
    expect(staleBefore(page, locked({ docRevision: 3, termsRevision: 1, status: GROUP_STATUS.full, lockedHash: undefined }), B, 'approve')).toBeNull();
  });

  it('refuses a second approval, seat or answer of one person (a unique index Platform enforces after charging)', () => {
    const page = locked();
    expect(staleBefore(page, { ...page, approvals: [approval(B, 'ab'.repeat(32), D(400), 2)] }, B, 'approve')).toMatch(/already approved/);
    const noSeat = { ...page, seats: [seat(A, D(600))] };
    expect(staleBefore(noSeat, page, B, 'seat')).toMatch(/already have a seat/);
    expect(staleBefore(noSeat, noSeat, B, 'seat')).toBeNull();
    const noAnswer = { ...page, opAccepts: [] };
    expect(staleBefore(noAnswer, page, opAccept().ownerId, 'answer')).toMatch(/already answered/);
  });
});
