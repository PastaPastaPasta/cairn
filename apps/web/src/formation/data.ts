// A group's agreement as formation needs it: the group, its seats and the approvals of its locked revision, read with proofs through
// the @cairn/contract models, and the term sheet everyone approved, recomputed from the group (never taken from a stored hash).
import {
  GROUP_STATUS, SEAT_FLAG, approvalsOf, groupData, replaceOp, seatData, seatsOfGroup, toApproval, toGroup, toSeat, type Approval,
  type DocOp, type Group, type Network, type RawDoc, type Seat,
} from '@cairn/contract';
import { type Network as CoreNetwork, type TermSheet, termsHash, validateTermSheet } from '@cairn/shares';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../app/context.tsx';
import type { Registry } from '../config/registry.ts';
import { getCairnDoc, queryCairn } from '../data/platform.ts';

export const coreNetwork = (n: Network): CoreNetwork => (n === 'mainnet' ? 'main' : 'test');

/** A group as read, with the document's own `$revision` (the model's `revision` is the terms revision, which shadows it). */
export interface GroupRecord {
  group: Group;
  docRevision: number;
}

export interface GroupBundle extends GroupRecord {
  seats: Seat[];
  /** Approvals of the group's current terms revision. */
  approvals: Approval[];
}

const docRevision = (raw: RawDoc): number => (typeof raw.$revision === 'number' ? raw.$revision : Number(raw.$revision ?? 1));

function readAll<T>(docs: RawDoc[], read: (d: RawDoc) => T): T[] {
  return docs.flatMap((d) => {
    try {
      return [read(d)];
    } catch {
      return [];
    }
  });
}

export async function readGroupBundle(r: Registry, id: string): Promise<GroupBundle | null> {
  const raw = await getCairnDoc(r, 'group', id);
  if (!raw) return null;
  const group = toGroup(raw, r.network);
  const [seats, approvals] = await Promise.all([
    queryCairn(r, seatsOfGroup(id)).then((x) => readAll(x.docs, (d) => toSeat(d, r.network))),
    queryCairn(r, approvalsOf(id, group.revision)).then((x) => readAll(x.docs, toApproval)),
  ]);
  return { group, docRevision: docRevision(raw), seats, approvals };
}

/**
 * The canonical term sheet of a locked group (DESIGN.md §7), or null while the group lacks something the term sheet needs. Shares in
 * roster order; a service Core would refuse was already dropped by the reader, so it hashes differently and shows as changed terms.
 */
export function termSheetOf(g: Group, network: Network): TermSheet | null {
  if (!g.operatorPubKey || !g.votingAddress || !g.coordinatorId || !g.votingHolderId || g.roster.some((r) => !r.label)) return null;
  return {
    network: coreNetwork(network),
    groupId: g.id,
    revision: g.revision,
    shares: g.roster.map((r) => ({ memberId: r.id, label: r.label!, amount: BigInt(r.amount) })),
    operatorPubKey: g.operatorPubKey.toLowerCase(),
    service: g.service ?? '',
    votingAddress: g.votingAddress,
    votingHolderId: g.votingHolderId,
    rewardBps: g.rewardBps,
    earlyPeriodBlocks: g.earlyPeriodBlocks,
    earlyPenalty: BigInt(g.earlyPenalty),
    coordinatorId: g.coordinatorId,
  };
}

export interface MemberApproval {
  id: string;
  label: string;
  amount: number;
  approval: Approval | null;
  /** The approval names this revision, this exact term sheet and this member's share. */
  ok: boolean;
  problem?: string;
}

export interface Agreement {
  terms: TermSheet | null;
  /** termsHash of the term sheet recomputed from the group. */
  hash: string | null;
  /** The group's stored lockedHash equals the recomputed hash. */
  lockedHashOk: boolean;
  members: MemberApproval[];
  allApproved: boolean;
  /** Why the agreement cannot anchor checks, in plain words; empty when it can. */
  problems: string[];
}

/** What the approvals on Platform say about the group's terms, recomputed: never trusted from the group's own status field. */
export function agreementOf(g: Group, approvals: readonly Approval[], network: Network): Agreement {
  const terms = termSheetOf(g, network);
  const hash = terms ? termsHash(terms) : null;
  const locked = g.lockedHash?.toLowerCase() ?? null;
  const lockedHashOk = !!hash && hash === locked;
  const problems: string[] = [];
  if (!locked) problems.push('The organizer has not locked the terms yet.');
  else if (!terms) problems.push('The locked terms are incomplete: the operator key, voting address, coordinator or a share label is missing.');
  else if (!lockedHashOk) problems.push('The group’s terms changed after they were locked: its stored terms code no longer matches them.');
  if (terms) {
    const issues = validateTermSheet(terms);
    if (issues.length) problems.push(`The terms break Dash Core’s rules: ${issues.map((i) => i.message).join(' ')}`);
  }
  const byOwner = new Map(approvals.map((a) => [a.ownerId, a]));
  const members = g.roster.map((r): MemberApproval => {
    const a = byOwner.get(r.id) ?? null;
    const base = { id: r.id, label: r.label ?? '', amount: r.amount, approval: a };
    if (!a) return { ...base, ok: false, problem: 'has not approved' };
    if (a.revision !== g.revision) return { ...base, ok: false, problem: `approved revision ${a.revision}, not ${g.revision}` };
    if (!hash || a.termsHash.toLowerCase() !== hash || a.termsHash.toLowerCase() !== locked) return { ...base, ok: false, problem: 'approved different terms' };
    if (a.shareAmount !== r.amount) return { ...base, ok: false, problem: 'approved a different share amount' };
    return { ...base, ok: true };
  });
  const allApproved = members.length > 0 && members.every((m) => m.ok);
  if (lockedHashOk && !allApproved) {
    const missing = members.filter((m) => !m.ok);
    problems.push(`Not every member approved these exact terms (${missing.map((m) => `${m.label || 'a member'} ${m.problem}`).join('; ')}).`);
  }
  return { terms, hash, lockedHashOk, members, allApproved, problems };
}

/** ProTx hashes linked to the group: the organizer's, then each co-owner's own (seats of people not on the roster are ignored). */
export function linkedProTx(g: Group, seats: readonly Seat[]): Array<{ hash: string; by: string }> {
  const roster = new Set(g.roster.map((r) => r.id));
  const out: Array<{ hash: string; by: string }> = [];
  const add = (hash: string | undefined, by: string) => {
    const h = hash?.toLowerCase();
    if (h && !out.some((x) => x.hash === h)) out.push({ hash: h, by });
  };
  add(g.proTxHash, g.ownerId);
  for (const s of seats) if (roster.has(s.ownerId) && s.groupId === g.id) add(s.proTxHash, s.ownerId);
  return out;
}

/** The coordinator marked the Dash-Qt session as started (their seat flag), or the organizer moved the group on to forming on chain. */
export function sessionStarted(g: Group, seats: readonly Seat[]): boolean {
  if (g.status === GROUP_STATUS.formingOnchain || g.status === GROUP_STATUS.live) return true;
  const seat = seats.find((s) => s.ownerId === g.coordinatorId && s.groupId === g.id);
  return !!seat && ((seat.flags ?? 0) & SEAT_FLAG.sessionStarted) !== 0;
}

const seatFields = (s: Seat) => ({ groupId: s.groupId, amount: s.amount, message: s.message, status: s.status, flags: s.flags, votingAddress: s.votingAddress, proTxHash: s.proTxHash });

/**
 * The write that links a registration: the organizer's group carries it (and claims "live"; the chain decides on read), anyone else
 * links it in their own seat. Null when this identity has neither.
 */
export function linkProTxOp(r: Registry, rec: GroupRecord, seats: readonly Seat[], me: string, proTxHash: string): DocOp | null {
  const contractId = r.contractId!;
  const g = rec.group;
  if (g.ownerId === me) {
    return replaceOp(contractId, 'group', g.id, rec.docRevision, groupData({ ...g, proTxHash, status: GROUP_STATUS.live }, r.network));
  }
  const seat = seats.find((s) => s.ownerId === me && s.groupId === g.id);
  if (!seat) return null;
  return replaceOp(contractId, 'seat', seat.id, seat.revision, seatData({ ...seatFields(seat), proTxHash }, r.network));
}

/** The write that marks the Dash-Qt session as started: the organizer's group status, or the coordinator's own seat flag. */
export function markStartedOp(r: Registry, rec: GroupRecord, seats: readonly Seat[], me: string): DocOp | null {
  const contractId = r.contractId!;
  const g = rec.group;
  if (g.ownerId === me) return replaceOp(contractId, 'group', g.id, rec.docRevision, groupData({ ...g, status: GROUP_STATUS.formingOnchain }, r.network));
  const seat = seats.find((s) => s.ownerId === me && s.groupId === g.id);
  if (!seat || me !== g.coordinatorId) return null;
  return replaceOp(contractId, 'seat', seat.id, seat.revision, seatData({ ...seatFields(seat), flags: (seat.flags ?? 0) | SEAT_FLAG.sessionStarted }, r.network));
}

export type BundleState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; error: string }
  | { status: 'ready'; bundle: GroupBundle; agreement: Agreement };

/** The group, its seats and approvals, re-read on `refresh()`. */
export function useGroupBundle(id: string | undefined): { state: BundleState; refresh(): void } {
  const { registry } = useApp();
  const [state, setState] = useState<BundleState>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!id || !registry.contractId) return;
    let live = true;
    readGroupBundle(registry, id).then(
      (bundle) => {
        if (!live) return;
        setState(bundle ? { status: 'ready', bundle, agreement: agreementOf(bundle.group, bundle.approvals, registry.network) } : { status: 'missing' });
      },
      (e: unknown) => live && setState({ status: 'error', error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [registry, id, tick]);
  return { state, refresh };
}
