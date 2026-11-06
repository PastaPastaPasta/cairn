import { describe, expect, it } from 'vitest';
import { base58 } from '@scure/base';
import {
  CAIRN_SCHEMAS, approvalsOf, groupsByStatus, groupsOfOperator, groupsOrganizedBy, invitesOfGroup, invitesTo, lintQuery, lookingByStatus, lookingOf,
  opAcceptOf, opAcceptsOf, opAcceptsOfGroup, operatorOf, operatorsByStatus, profileOf, profilesOf, seatOf, seatsOf, seatsOfGroup,
} from '../src/index.ts';

const A = base58.encode(new Uint8Array(32).fill(1));
const B = base58.encode(new Uint8Array(32).fill(2));
const lint = (q: Parameters<typeof lintQuery>[1]) => lintQuery(CAIRN_SCHEMAS, q);

describe('every cairn query passes the PV13 lint and lands on the intended index', () => {
  const cases: Array<[string, ReturnType<typeof profileOf>, string]> = [
    ['profileOf', profileOf(A), 'byOwner'],
    ['profilesOf', profilesOf([A, B, A]), 'byOwner'],
    ['operatorOf', operatorOf(A), 'byOwner'],
    ['operatorsByStatus', operatorsByStatus(1), 'byStatus'],
    ['operatorsByStatus page', operatorsByStatus(1, 1_700_000_000_000), 'byStatus'],
    ['lookingOf', lookingOf(A), 'byOwner'],
    ['lookingByStatus', lookingByStatus(1), 'byStatus'],
    ['groupsByStatus', groupsByStatus(2), 'byStatus'],
    ['groupsOfOperator', groupsOfOperator(A), 'byOperator'],
    ['groupsOfOperator status', groupsOfOperator(A, 2), 'byOperator'],
    ['groupsOrganizedBy', groupsOrganizedBy(A), 'byOwner'],
    ['seatsOfGroup', seatsOfGroup(A, B), 'byGroupOwner'],
    ['seatOf', seatOf(A, B), 'byGroupOwner'],
    ['seatsOf', seatsOf(A), 'byOwner'],
    ['invitesTo', invitesTo(A), 'byTo'],
    ['invitesOfGroup', invitesOfGroup(A), 'byGroup'],
    ['approvalsOf', approvalsOf(A, 3), 'byGroupRevisionOwner'],
    ['opAcceptsOfGroup', opAcceptsOfGroup(A, B), 'byGroupOwner'],
    ['opAcceptOf', opAcceptOf(A, B), 'byGroupOwner'],
    ['opAcceptsOf', opAcceptsOf(A), 'byOwner'],
  ];
  it.each(cases)('%s', (_n, q, index) => {
    expect(lint(q)).toMatchObject({ ok: true, index });
  });

  it('newest-first lists carry the range PV13 needs and never startAfter', () => {
    const q = groupsByStatus(2, 123);
    expect(q.where).toContainEqual(['$updatedAt', '<=', 123]);
    expect(q.orderBy).toEqual([['$updatedAt', 'desc']]);
    expect(q.startAfter).toBeUndefined();
  });

  it('the lint catches the shapes PV13 answers with a silent []', () => {
    expect(lint({ documentTypeName: 'group', where: [['status', '==', 2]], orderBy: [['$updatedAt', 'desc']] }).ok).toBe(false);
    expect(lint({ documentTypeName: 'approval', where: [['groupId', '==', A], ['$ownerId', '==', B]] }).ok).toBe(false);
    expect(lint({ documentTypeName: 'group', where: [['status', 'in', [1, 2]]], orderBy: [['status', 'asc']] }).ok).toBe(false);
    expect(() => profilesOf([])).toThrow();
  });
});
