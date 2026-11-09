// /me: a group I started alone is offered for closing once I sit in another group (DESIGN §4.1); the operator's accepted range names
// the one field that breaks it (F-022).
import { GROUP_STATUS } from '@cairn/contract';
import { describe, expect, it } from 'vitest';
import { A, B, C, D, group, id, opAccept, seat } from '../../matching/fixtures.ts';
import { groupView, type GroupBundle } from '../../matching/group.ts';
import { startedButMovedOn, type MyGroup } from './MyGroups.tsx';
import { rangeProblems } from './OperatorEditor.tsx';

const mine = (b: Partial<GroupBundle> & Pick<GroupBundle, 'group'>): MyGroup => ({ view: groupView({ seats: [], opAccepts: [opAccept()], invites: [], approvals: [], voided: [], ...b }, 'testnet'), steps: [], formByPassed: false });

describe('/me', () => {
  it('offers to close the group I started once I am on another open group’s roster', () => {
    const started = mine({ group: group({ id: id(80), ownerId: A, operatorId: null, roster: [{ id: A, amount: D(300) }] }), seats: [seat(A, D(300))] });
    const joined = mine({ group: group({ id: id(81), roster: [{ id: B, amount: D(400) }, { id: A, amount: D(300) }] }), seats: [seat(A, D(300)), seat(B, D(400))] });
    const closed = mine({ group: group({ id: id(82), roster: [{ id: C, amount: D(700) }, { id: A, amount: D(300) }], status: GROUP_STATUS.cancelled }) });
    expect(startedButMovedOn([started, joined], A).map((m) => [m.started.group.id, m.joined.group.id])).toEqual([[id(80), id(81)]]);
    expect(startedButMovedOn([started, closed], A)).toEqual([]);
    expect(startedButMovedOn([started], A)).toEqual([]);
  });

  it('puts an operator’s range problem under the one field that breaks it', () => {
    expect(rangeProblems(800, 900, undefined)).toEqual({ min: 'At most your usual reward.', max: null });
    expect(rangeProblems(500, undefined, 400)).toEqual({ min: null, max: 'At least your usual reward.' });
    expect(rangeProblems(500, null, 600)).toEqual({ min: 'A percentage from 0 to 100.', max: null });
    expect(rangeProblems(500, 400, 600)).toEqual({ min: null, max: null });
  });
});
