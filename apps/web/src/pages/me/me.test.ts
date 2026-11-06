// /me: a looking post is questioned once its owner sits in a full group (F-021); the operator's accepted range names the one field
// that breaks it (F-022).
import { GROUP_STATUS } from '@cairn/contract';
import { describe, expect, it } from 'vitest';
import { A, B, C, D, group, opAccept, seat } from '../../matching/fixtures.ts';
import { groupView, type GroupBundle } from '../../matching/group.ts';
import { seatedIn, type MyGroup } from './MyGroups.tsx';
import { rangeProblems } from './OperatorEditor.tsx';

const mine = (b: Partial<GroupBundle> & Pick<GroupBundle, 'group'>): MyGroup => ({ view: groupView({ seats: [], opAccepts: [opAccept()], invites: [], approvals: [], voided: [], ...b }, 'testnet'), steps: [], formByPassed: false });

describe('/me', () => {
  it('counts the full groups whose roster I am on, not open or closed ones', () => {
    const full = mine({ group: group({ roster: [{ id: A, amount: D(600) }, { id: B, amount: D(400) }], status: GROUP_STATUS.full }), seats: [seat(A, D(600)), seat(B, D(400))] });
    const open = mine({ group: group({ roster: [{ id: A, amount: D(300) }] }), seats: [seat(A, D(300))] });
    const closed = mine({ group: group({ roster: [{ id: A, amount: D(600) }, { id: C, amount: D(400) }], status: GROUP_STATUS.cancelled }), seats: [seat(A, D(600)), seat(C, D(400))] });
    expect(seatedIn([full, open, closed], A)).toBe(1);
    expect(seatedIn([full], C)).toBe(0);
  });

  it('puts an operator’s range problem under the one field that breaks it', () => {
    expect(rangeProblems(800, 900, undefined)).toEqual({ min: 'At most your usual reward.', max: null });
    expect(rangeProblems(500, undefined, 400)).toEqual({ min: null, max: 'At least your usual reward.' });
    expect(rangeProblems(500, null, 600)).toEqual({ min: 'A percentage from 0 to 100.', max: null });
    expect(rangeProblems(500, 400, 600)).toEqual({ min: null, max: null });
  });
});
