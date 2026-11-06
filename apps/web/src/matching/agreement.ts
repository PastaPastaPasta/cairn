// What the approvals on Platform say about a group's terms (M8, M10): the term sheet recomputed from the group by the contract's one
// builder, its hash, and each member's approval checked against it. The group page, the form and live pages, /check and the operator
// track record all read approvals through this, so they cannot disagree; the group's own status field is never consulted.
import { termSheetFromGroup, type Approval, type Group, type Network } from '@cairn/contract';
import { termsHash, validateTermSheet, type TermIssue, type TermSheet } from '@cairn/shares';

export type ApprovalState = 'approved' | 'missing' | 'mismatch';

export interface MemberApproval {
  id: string;
  label: string;
  amount: number;
  approval: Approval | null;
  /** approved: this terms revision, this exact term sheet and this member's share. */
  state: ApprovalState;
  problem?: string;
}

export interface Agreement {
  /** The term sheet the group states, valid or not (pages show it). */
  sheet: TermSheet;
  issues: TermIssue[];
  /** The sheet when it is valid: the only terms anything is checked against. */
  terms: TermSheet | null;
  /** termsHash of the valid sheet. */
  hash: string | null;
  /** The group's stored lockedHash equals the recomputed hash. */
  lockedHashOk: boolean;
  members: MemberApproval[];
  allApproved: boolean;
  /** Locked, valid and approved by every member: what checks of Dash Core messages and the chain compare against. */
  anchored: boolean;
  /** Why the agreement cannot anchor checks, in plain words; empty when it can. */
  problems: string[];
}

/** `approvals` are the group's approvals at its current terms revision (others are ignored). */
export function agreementOf(g: Group, approvals: readonly Approval[], network: Network): Agreement {
  const sheet = termSheetFromGroup(g.id, g, network);
  const issues = validateTermSheet(sheet);
  const terms = issues.length ? null : sheet;
  const hash = terms ? termsHash(terms) : null;
  const lockedHashOk = !!hash && hash === g.lockedHash?.toLowerCase();
  const problems: string[] = [];
  if (!g.lockedHash) problems.push('The organizer has not locked the terms yet.');
  else if (issues.length) problems.push(`The locked terms are not a valid term sheet: ${issues.map((i) => i.message).join(' ')}`);
  else if (!lockedHashOk) problems.push('The group’s terms changed after they were locked: its stored terms code no longer matches them.');
  const byOwner = new Map(approvals.filter((a) => a.termsRevision === g.termsRevision).map((a) => [a.ownerId, a]));
  const members = g.roster.map((r): MemberApproval => {
    const a = byOwner.get(r.id) ?? null;
    const base = { id: r.id, label: r.label ?? '', amount: r.amount, approval: a };
    if (!a) return { ...base, state: 'missing', problem: 'has not approved' };
    if (!hash || a.termsHash.toLowerCase() !== hash) return { ...base, state: 'mismatch', problem: 'approved different terms' };
    if (a.shareAmount !== r.amount) return { ...base, state: 'mismatch', problem: 'approved a different share amount' };
    return { ...base, state: 'approved' };
  });
  const allApproved = members.length > 0 && members.every((m) => m.state === 'approved');
  if (lockedHashOk && !allApproved) {
    const missing = members.filter((m) => m.state !== 'approved');
    problems.push(`Not every member approved these exact terms (${missing.map((m) => `${m.label || 'a member'} ${m.problem}`).join('; ')}).`);
  }
  return { sheet, issues, terms, hash, lockedHashOk, members, allApproved, anchored: lockedHashOk && allApproved, problems };
}
