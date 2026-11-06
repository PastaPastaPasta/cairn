// Every query the app sends to the cairn contract. Each builder runs the PV13 lint (queryLint.ts) when it is built, so a shape
// PV13 mainnet would silently answer with [] never reaches the network. Lists newest-first carry a no-op range on $updatedAt
// (PV13 ignores desc without one, R7) and page with a bound, never startAfter (R8); ascending lists page with startAfter.
import { assertQuery, type DocQuery } from '../queryLint.ts';
import { CAIRN_SCHEMAS, type DocType } from './schema.ts';

/** Drive's page size: the default and the largest `limit` and `in` list. */
export const PAGE = 100;

export interface CairnQuery extends DocQuery {
  documentTypeName: DocType;
}

const checked = (q: CairnQuery): CairnQuery => {
  assertQuery(CAIRN_SCHEMAS, q);
  return q;
};
const paged = (q: CairnQuery, startAfter?: string): CairnQuery => (startAfter ? { ...q, startAfter } : q);
const batchOf = (ids: readonly string[]): string[] => {
  const u = [...new Set(ids)];
  if (u.length === 0 || u.length > PAGE) throw new Error(`in-list needs 1..${PAGE} distinct values, got ${u.length}`);
  return u;
};
/** Newest first by `$updatedAt` within one status; `before` (ms) pages: documents at exactly that time are re-read, the caller drops ids it has. */
const newest = (type: DocType, status: number, before?: number, limit = PAGE): CairnQuery =>
  checked({
    documentTypeName: type,
    where: [['status', '==', status], before === undefined ? ['$updatedAt', '>', 0] : ['$updatedAt', '<=', before]],
    orderBy: [['$updatedAt', 'desc']],
    limit,
  });
const byOwner = (type: DocType, ownerId: string): CairnQuery => checked({ documentTypeName: type, where: [['$ownerId', '==', ownerId]], limit: 1 });

// profile
export const profileOf = (ownerId: string) => byOwner('profile', ownerId);
export const profilesOf = (ownerIds: readonly string[]) =>
  checked({ documentTypeName: 'profile', where: [['$ownerId', 'in', batchOf(ownerIds)]], orderBy: [['$ownerId', 'asc']], limit: PAGE });

// operator
export const operatorOf = (ownerId: string) => byOwner('operator', ownerId);
export const operatorsByStatus = (status: number, before?: number, limit?: number) => newest('operator', status, before, limit);

// looking
export const lookingOf = (ownerId: string) => byOwner('looking', ownerId);
export const lookingByStatus = (status: number, before?: number, limit?: number) => newest('looking', status, before, limit);

// group
export const groupsByStatus = (status: number, before?: number, limit?: number) => newest('group', status, before, limit);
export const groupsOfOperator = (operatorId: string, status?: number, startAfter?: string) =>
  checked(
    paged(
      status === undefined
        ? { documentTypeName: 'group', where: [['operatorId', '==', operatorId]], orderBy: [['status', 'asc']], limit: PAGE }
        : { documentTypeName: 'group', where: [['operatorId', '==', operatorId], ['status', '==', status]], limit: PAGE },
      startAfter,
    ),
  );
export const groupsOrganizedBy = (ownerId: string, startAfter?: string) =>
  checked(paged({ documentTypeName: 'group', where: [['$ownerId', '==', ownerId]], limit: PAGE }, startAfter));

// seat
export const seatsOfGroup = (groupId: string, startAfter?: string) =>
  checked(paged({ documentTypeName: 'seat', where: [['groupId', '==', groupId]], orderBy: [['$ownerId', 'asc']], limit: PAGE }, startAfter));
export const seatOf = (groupId: string, ownerId: string) =>
  checked({ documentTypeName: 'seat', where: [['groupId', '==', groupId], ['$ownerId', '==', ownerId]], limit: 1 });
export const seatsOf = (ownerId: string, startAfter?: string) =>
  checked(paged({ documentTypeName: 'seat', where: [['$ownerId', '==', ownerId]], limit: PAGE }, startAfter));

// invite
export const invitesTo = (toId: string, startAfter?: string) => checked(paged({ documentTypeName: 'invite', where: [['toId', '==', toId]], limit: PAGE }, startAfter));
export const invitesOfGroup = (groupId: string, startAfter?: string) =>
  checked(paged({ documentTypeName: 'invite', where: [['groupId', '==', groupId]], limit: PAGE }, startAfter));

// approval
export const approvalsOf = (groupId: string, revision: number, startAfter?: string) =>
  checked(
    paged(
      { documentTypeName: 'approval', where: [['groupId', '==', groupId], ['revision', '==', revision]], orderBy: [['$ownerId', 'asc']], limit: PAGE },
      startAfter,
    ),
  );

// opAccept
export const opAcceptsOfGroup = (groupId: string, startAfter?: string) =>
  checked(paged({ documentTypeName: 'opAccept', where: [['groupId', '==', groupId]], orderBy: [['$ownerId', 'asc']], limit: PAGE }, startAfter));
export const opAcceptOf = (groupId: string, ownerId: string) =>
  checked({ documentTypeName: 'opAccept', where: [['groupId', '==', groupId], ['$ownerId', '==', ownerId]], limit: 1 });
export const opAcceptsOf = (ownerId: string, startAfter?: string) =>
  checked(paged({ documentTypeName: 'opAccept', where: [['$ownerId', '==', ownerId]], limit: PAGE }, startAfter));
