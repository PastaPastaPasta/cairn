// The public lists (groups, operators): newest first within each status, proved, merged across statuses.
import {
  GROUP_STATUS, OPERATOR_STATUS, groupsByStatus, operatorsByStatus, toGroup, toOperator,
  type CairnQuery, type DocMeta, type DocType, type Group, type Operator,
} from '@cairn/contract';
import { useState } from 'react';
import type { Registry } from '../config/registry.ts';
import { readNewest, useLoad, type Reader } from './cairn.ts';

interface ListSpec<T> {
  type: DocType;
  query(status: number, before?: number): CairnQuery;
  read: Reader<T>;
}

export const GROUPS: ListSpec<Group> = { type: 'group', query: (s, b) => groupsByStatus(s, b), read: (d, n) => toGroup(d, n) };
export const OPERATORS: ListSpec<Operator> = { type: 'operator', query: (s, b) => operatorsByStatus(s, b), read: (d) => toOperator(d) };

/** Statuses a public list shows. */
export const OPEN_GROUP_STATUSES = [GROUP_STATUS.forming, GROUP_STATUS.full, GROUP_STATUS.locked];
/** /groups by default: taking co-owners, agreeing, ready, forming and live. */
export const LISTED_GROUP_STATUSES = [...OPEN_GROUP_STATUSES, GROUP_STATUS.formingOnchain, GROUP_STATUS.live];
/** Home's "recently formed or forming", when no group is taking co-owners. */
export const RECENT_GROUP_STATUSES = [GROUP_STATUS.locked, GROUP_STATUS.formingOnchain, GROUP_STATUS.live];
/** Behind /groups' "include closed" toggle. */
export const CLOSED_GROUP_STATUSES = [GROUP_STATUS.dissolved, GROUP_STATUS.cancelled];
export const LISTED_OPERATORS = [OPERATOR_STATUS.open, OPERATOR_STATUS.full];

/** `pages` pages of each status, newest first, without duplicates. `more`: some status has older documents. */
export async function readStatuses<T extends DocMeta & { status: number }>(r: Registry, spec: ListSpec<T>, statuses: readonly number[], pages = 1): Promise<{ items: T[]; more: boolean }> {
  const all = new Map<string, T>();
  let more = false;
  await Promise.all(
    statuses.map(async (status) => {
      let before: number | undefined;
      for (let p = 0; p < pages; p++) {
        const res = await readNewest(r, spec.type, spec.query(status, before), spec.read, (raw) => Number(raw.status) === status);
        for (const it of res.items) if (it.status === status) all.set(it.id, it);
        const oldest = res.items.reduce<number | undefined>((m, it) => (it.updatedAt !== undefined && (m === undefined || it.updatedAt < m) ? it.updatedAt : m), undefined);
        if (!res.more || oldest === undefined) return;
        if (p === pages - 1) more = true;
        before = oldest;
      }
    }),
  );
  return { items: [...all.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)), more };
}

/** A public list as React state, with "show older". */
export function useStatusList<T extends DocMeta & { status: number }>(spec: ListSpec<T>, statuses: readonly number[], enabled = true) {
  const [pages, setPages] = useState(1);
  const load = useLoad(enabled ? `${spec.type}:${statuses.join(',')}:${pages}` : null, (r) => readStatuses(r, spec, statuses, pages));
  return { ...load, showOlder: () => setPages((p) => p + 1) };
}
