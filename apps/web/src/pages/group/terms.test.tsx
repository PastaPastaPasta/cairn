// @vitest-environment happy-dom
// The term sheet a member approves: the recomputed hash decides whether approving is offered, and a mismatch reads in red.
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { A, B, D, OPR, VOTING, approval, group, opAccept, seat } from '../../matching/fixtures.ts';
import { groupView, lockPlan, type GroupBundle } from '../../matching/group.ts';
import { SEAT_FLAG, GROUP_STATUS } from '@cairn/contract';
import { render } from '../../test/render.tsx';
import type { GroupOps } from './ops.ts';
import { TermSheetSection } from './Terms.tsx';

function lockedBundle(): { b: GroupBundle; hash: string } {
  const g = group({ roster: [{ id: A, amount: D(600) }, { id: B, amount: D(400) }], status: GROUP_STATUS.full });
  const b: GroupBundle = { group: g, docRevision: 2, seats: [seat(A, D(600), { flags: SEAT_FLAG.canCoordinate, votingAddress: VOTING }), seat(B, D(400))], opAccepts: [opAccept()], invites: [], approvals: [], voided: [] };
  const p = lockPlan(groupView(b, 'testnet'), { coordinatorId: A, votingHolderId: A, labels: ['Ana', 'Bo'] });
  return { b: { ...b, group: { ...g, ...p.fields } }, hash: p.hash! };
}

const ops = { approve: vi.fn(), withdrawApproval: vi.fn() } as unknown as GroupOps;
const show = (b: GroupBundle, me: string) =>
  render(
    <MemoryRouter>
      <TermSheetSection view={groupView(b, 'testnet')} people={new Map()} me={me} ops={ops} done={() => {}} />
    </MemoryRouter>,
  );

describe('the locked term sheet', () => {
  it('shows the checked terms and offers approval to a member who has not approved', async () => {
    const { b } = lockedBundle();
    const r = await show(b, B);
    expect(r.el.querySelector('[data-testid="hash-check"]')!.className).toContain('ok');
    expect(r.el.querySelector('[data-testid="approve"]')).not.toBeNull();
    expect(r.el.textContent).toContain('Ana');
    expect(r.el.textContent).toContain(OPR.slice(0, 6));
    await r.unmount();
  });

  it('marks a hash that no longer matches in red and offers no approval', async () => {
    const { b, hash } = lockedBundle();
    const r = await show({ ...b, group: { ...b.group, earlyPeriodBlocks: 52_416, earlyPenalty: D(5) }, approvals: [approval(A, hash, D(600))] }, B);
    const check = r.el.querySelector('[data-testid="hash-check"]')!;
    expect(check.className).toContain('bad');
    expect(check.getAttribute('role')).toBe('alert');
    expect((r.el.querySelector('[data-testid="approve"]') as HTMLButtonElement).disabled).toBe(true);
    expect(r.el.textContent).toContain('✗ Does not match');
    await r.unmount();
  });

  it('says ready to form once everyone approved, with the link to the formation page', async () => {
    const { b, hash } = lockedBundle();
    const r = await show({ ...b, approvals: [approval(A, hash, D(600)), approval(B, hash, D(400))] }, A);
    expect(r.el.querySelector('[data-testid="ready"]')!.textContent).toContain('Next: form it in Dash Core');
    expect(r.el.querySelector('[data-testid="ready"] a')!.getAttribute('href')).toMatch(/\/g\/.+\/form$/);
    await r.unmount();
  });
});
