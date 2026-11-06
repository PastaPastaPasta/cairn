// One term-sheet builder: locking, the approval a member writes, the group page's approval check and the formation pages' agreement
// (form, live, /check, operator track record) all hash what @cairn/contract's termSheetFromGroup returns, byte for byte.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GROUP_STATUS, SEAT_FLAG, termSheetFromGroup } from '@cairn/contract';
import { canonicalize, termsHash } from '@cairn/shares';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agreementOf } from './agreement.ts';
import { A, B, D, GID, VOTING, approval, group, opAccept, seat } from './fixtures.ts';
import { groupView, lockPlan, type GroupBundle } from './group.ts';

vi.mock('@cairn/contract', async (original) => {
  const real = await original<typeof import('@cairn/contract')>();
  return { ...real, termSheetFromGroup: vi.fn(real.termSheetFromGroup) };
});
const builder = vi.mocked(termSheetFromGroup);

function readyToLock(): GroupBundle {
  const g = group({ roster: [{ id: A, amount: D(600) }, { id: B, amount: D(400) }], status: GROUP_STATUS.full });
  return { group: g, seats: [seat(A, D(600), { flags: SEAT_FLAG.canCoordinate | SEAT_FLAG.votingKeyHolder, votingAddress: VOTING }), seat(B, D(400))], opAccepts: [opAccept()], invites: [], approvals: [], voided: [] };
}

describe('one term-sheet builder', () => {
  beforeEach(() => {
    builder.mockClear();
  });

  it('locks, approves, verifies approvals and anchors formation with the same bytes', () => {
    // the lock path: the organizer's plan builds the sheet and the hash written as lockedHash
    const plan = lockPlan(groupView(readyToLock(), 'testnet'), { coordinatorId: A, votingHolderId: A, labels: ['Ana', 'Bo'] });
    expect(builder).toHaveBeenCalled();
    expect(plan.problems).toEqual([]);
    const locked = { ...readyToLock().group, ...plan.fields };
    expect(locked.lockedHash).toBe(plan.hash);

    // the approval each member writes carries the hash the group page recomputes
    builder.mockClear();
    const unapproved = groupView({ ...readyToLock(), group: locked }, 'testnet');
    expect(builder).toHaveBeenCalledWith(GID, locked, 'testnet');
    expect(unapproved.hash).toBe(plan.hash);
    const approvals = [approval(A, unapproved.hash!, D(600)), approval(B, unapproved.hash!, D(400))];

    // the approval verification on /g/:id
    builder.mockClear();
    const view = groupView({ ...readyToLock(), group: locked, approvals }, 'testnet');
    expect(builder).toHaveBeenCalledWith(GID, locked, 'testnet');
    expect(view.shares.map((s) => s.approval)).toEqual(['approved', 'approved']);
    expect(view.ready).toBe(true);

    // the formation path (/g/:id/form, /g/:id/live, /check?group=, the track record)
    builder.mockClear();
    const agreement = agreementOf(locked, approvals, 'testnet');
    expect(builder).toHaveBeenCalledWith(GID, locked, 'testnet');
    expect(agreement.anchored).toBe(true);

    const bytes = canonicalize(plan.sheet);
    expect(canonicalize(view.sheet!)).toBe(bytes);
    expect(canonicalize(agreement.terms!)).toBe(bytes);
    expect(canonicalize(view.agreement.terms!)).toBe(bytes);
    expect(agreement.hash).toBe(termsHash(plan.sheet));
  });

  it('has no second builder anywhere in the web app', () => {
    const src = join(__dirname, '..');
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
      });
    const offenders = files(src).filter((f) => {
      const text = readFileSync(f, 'utf8');
      // a hand-built sheet needs the Core network name and the share rows; only the contract's builder may do that
      return /termSheetOf\b/.test(text) || (/\bTermSheet\b/.test(text) && /memberId:\s*r\.id/.test(text));
    });
    expect(offenders).toEqual([]);
  });
});
