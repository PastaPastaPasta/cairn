// Typed documents of the cairn contract and their (de)serializers.
//   to*(raw)     a proved document's JSON (evo-sdk `Document.toJSON`: byte arrays base64, identifiers base58, integers numbers) ->
//                a model. Throws DocError on anything the schema admits but the app must not trust (bad JSON fields, a roster
//                that is not a list of identities): readers skip such documents.
//   *Data(f)     model fields -> the `data` of a document write (identifiers and hashes as bytes, integers as numbers). Checks
//                every limit cairn.json sets, so consensus never has to refuse a write the UI built.
//   createOp / replaceOp / deleteOp stamp the system times the schema requires.
import { base58, base64, hex } from '@scure/base';
import {
  MAX_EARLY_PERIOD_BLOCKS, MIN_SHARE_AMOUNT, REGULAR_COLLATERAL, areShareAmountsValid, isCompletable, isEarlyPenaltyValid, isEarlyPeriodValid, minAmount,
  decodeAddress, remainingDuffs, validateCoreService, type Network as CoreNetwork,
} from '@cairn/shares';
import { CAIRN_SCHEMAS, GROUP_STATUS, MAX_AMOUNT_DUFFS, MN_TYPE, OP_ACCEPT_STATUS, prop, type DocType, type Network } from './schema.ts';
import { badgeLike, cleanName, nameProblem } from './text.ts';

export type RawDoc = Record<string, unknown>;
/** Same shape as @cairn/auth's DocValue: byte arrays and identifiers as bytes, integers as numbers, strings, booleans. */
export type DocValue = Uint8Array | number | string | boolean;
export type DocData = Record<string, DocValue>;

export type DocOp =
  | { action: 'create'; contractId: string; type: DocType; data: DocData }
  | { action: 'replace'; contractId: string; type: DocType; id: string; revision: number; data: DocData }
  | { action: 'delete'; contractId: string; type: DocType; id: string };

export class DocError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocError';
  }
}

/** System fields every model carries. Times are milliseconds (block time, set by Drive). */
export interface DocMeta {
  id: string;
  ownerId: string;
  revision: number;
  createdAt?: number;
  updatedAt?: number;
}

// ---- reading ---------------------------------------------------------------------------------------------------------------

const fail = (k: string): never => {
  throw new DocError(`document field ${k} missing or malformed`);
};
const absent = (d: RawDoc, k: string) => d[k] === undefined || d[k] === null;
const str = (d: RawDoc, k: string): string => (typeof d[k] === 'string' ? (d[k] as string) : fail(k));
const optStr = (d: RawDoc, k: string): string | undefined => (absent(d, k) ? undefined : str(d, k));
const num = (d: RawDoc, k: string): number => {
  const v = d[k];
  const n = typeof v === 'number' ? v : typeof v === 'bigint' || (typeof v === 'string' && /^\d+$/.test(v)) ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? n : fail(k);
};
const optNum = (d: RawDoc, k: string): number | undefined => (absent(d, k) ? undefined : num(d, k));
const bool = (d: RawDoc, k: string): boolean => (typeof d[k] === 'boolean' ? (d[k] as boolean) : fail(k));
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isIdentifier = (v: unknown): v is string => typeof v === 'string' && B58.test(v) && idBytesOrNull(v) !== null;
const idBytesOrNull = (s: string): Uint8Array | null => {
  try {
    const b = base58.decode(s);
    return b.length === 32 ? b : null;
  } catch {
    return null;
  }
};
const ident = (d: RawDoc, k: string): string => {
  const v = d[k];
  if (isIdentifier(v)) return v;
  if (v instanceof Uint8Array && v.length === 32) return base58.encode(v);
  return fail(k);
};
const optIdent = (d: RawDoc, k: string): string | undefined => (absent(d, k) ? undefined : ident(d, k));
const bytes = (d: RawDoc, k: string, len: number): Uint8Array => {
  const v = d[k];
  let b: Uint8Array | null = null;
  if (v instanceof Uint8Array) b = v;
  else if (typeof v === 'string') {
    try {
      b = base64.decode(v);
    } catch {
      b = null;
    }
  }
  return b && b.length === len ? b : fail(k);
};
const optHex = (d: RawDoc, k: string, len: number): string | undefined => (absent(d, k) ? undefined : hex.encode(bytes(d, k, len)));
const json = <T>(d: RawDoc, k: string, parse: (v: unknown) => T): T => {
  try {
    return parse(JSON.parse(str(d, k)));
  } catch (e) {
    if (e instanceof DocError) throw e;
    return fail(k);
  }
};

function meta(d: RawDoc): DocMeta {
  return { id: ident(d, '$id'), ownerId: ident(d, '$ownerId'), revision: optNum(d, '$revision') ?? 1, createdAt: optNum(d, '$createdAt'), updatedAt: optNum(d, '$updatedAt') };
}

// ---- writing ---------------------------------------------------------------------------------------------------------------

const chars = (s: string) => [...s].length;
function checkStr(type: DocType, k: string, v: string): string {
  const p = prop(type, k);
  const n = chars(v);
  // maxLength counts characters; Platform also caps any value at 5,120 bytes, far above every cap here.
  if (n < (p.minLength ?? 0) || n > (p.maxLength ?? Infinity)) throw new DocError(`${type}.${k} must be ${p.minLength ?? 0}..${p.maxLength} characters (is ${n})`);
  return v;
}
function checkInt(type: DocType, k: string, v: number): number {
  const p = prop(type, k);
  if (!Number.isSafeInteger(v) || v < (p.minimum ?? -Infinity) || v > (p.maximum ?? Infinity)) throw new DocError(`${type}.${k} must be an integer in ${p.minimum}..${p.maximum}`);
  return v;
}
export function idBytes(id: string, what = 'identifier'): Uint8Array {
  const b = isIdentifier(id) ? idBytesOrNull(id) : null;
  if (!b) throw new DocError(`${what} is not a Platform identifier`);
  return b;
}
function hexBytes(type: DocType, k: string, v: string, len: number): Uint8Array {
  if (!new RegExp(`^[0-9a-fA-F]{${len * 2}}$`).test(v)) throw new DocError(`${type}.${k} must be ${len * 2} hex characters`);
  return hex.decode(v.toLowerCase());
}
/** Copies the defined entries only: an optional field left undefined is absent from the document. */
const defined = (o: Record<string, DocValue | undefined>): DocData => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as DocData;
const opt = <T, R>(v: T | undefined | null | '', f: (v: T) => R): R | undefined => (v === undefined || v === null || v === '' ? undefined : f(v as T));

const required = (type: DocType) => (CAIRN_SCHEMAS[type] as unknown as { required?: string[] }).required ?? [];

/** A create: stamps `$createdAt` / `$updatedAt` where the schema requires them (Drive replaces them with the block time). */
export function createOp(contractId: string, type: DocType, data: DocData, now = Date.now()): DocOp {
  const r = required(type);
  return { action: 'create', contractId, type, data: { ...data, ...(r.includes('$createdAt') ? { $createdAt: now } : {}), ...(r.includes('$updatedAt') ? { $updatedAt: now } : {}) } };
}
/** A replace of the stored `revision` (the writer sends revision + 1); stamps `$updatedAt` where required. */
export function replaceOp(contractId: string, type: DocType, id: string, revision: number, data: DocData, now = Date.now()): DocOp {
  if (!(CAIRN_SCHEMAS[type] as unknown as { documentsMutable?: boolean }).documentsMutable) throw new DocError(`cairn.${type} documents cannot be changed`);
  return { action: 'replace', contractId, type, id, revision, data: { ...data, ...(required(type).includes('$updatedAt') ? { $updatedAt: now } : {}) } };
}
export const deleteOp = (contractId: string, type: DocType, id: string): DocOp => ({ action: 'delete', contractId, type, id });

/** A JSON-string field: compact JSON within the field's cap. */
function jsonStr(type: DocType, k: string, v: unknown): string {
  return checkStr(type, k, JSON.stringify(v));
}

// ---- shared field formats --------------------------------------------------------------------------------------------------

export const CONTACT_KINDS = ['discord', 'yappr', 'telegram', 'matrix', 'dashpay', 'website'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
/** Contact handles. Everything stored is public: a handle the user keeps private is simply not stored. */
export type Contacts = Partial<Record<ContactKind, string>>;
const MAX_HANDLE = 100;

/** An https URL, or null. */
export function httpsUrl(v: string): string | null {
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A handle as stored and shown, or why it cannot be: the website is normalized first, so both sides check the same length. */
function contactHandle(k: ContactKind, raw: string): { ok: string } | { problem: string } {
  const v = raw.trim();
  if (/[\u0000-\u001f\u007f]/.test(v)) return { problem: `the ${k} handle has control characters` };
  const out = k === 'website' ? httpsUrl(v) : v;
  if (out === null) return { problem: 'the website must be an https:// address' };
  if (chars(out) > MAX_HANDLE) return { problem: `the ${k} handle is longer than ${MAX_HANDLE} characters${k === 'website' ? ' once written as a full address' : ''}` };
  return { ok: out };
}

/** Trims, drops empty handles, checks each one; key order is fixed so equal contacts serialize equally. */
export function normalizeContacts(c: Contacts): Contacts {
  const out: Contacts = {};
  for (const k of CONTACT_KINDS) {
    if (!c[k]?.trim()) continue;
    const h = contactHandle(k, c[k]!);
    if ('problem' in h) throw new DocError(h.problem);
    out[k] = h.ok;
  }
  return out;
}
function parseContacts(v: unknown): Contacts {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new DocError('contacts is not an object');
  const raw = v as Record<string, unknown>;
  const out: Contacts = {};
  for (const k of CONTACT_KINDS) {
    const x = raw[k];
    if (typeof x !== 'string' || !x.trim()) continue;
    const h = contactHandle(k, x);
    if ('ok' in h) out[k] = h.ok;
  }
  return out;
}

const stringList = (max: number, each: (s: string) => boolean) => (v: unknown): string[] => {
  if (!Array.isArray(v) || v.length > max || !v.every((x) => typeof x === 'string' && each(x))) throw new DocError('not a list of the expected strings');
  return v as string[];
};
const PROTX = /^[0-9a-f]{64}$/;
const parseRegions = stringList(8, (s) => s.length >= 1 && s.length <= 24);
const parseProTxList = stringList(20, (s) => PROTX.test(s));

/** Members' early-exit preference: the longest early period and the largest penalty they accept; null = any. */
export interface EarlyPref {
  maxPeriodBlocks: number | null;
  maxPenalty: number | null;
}
/** The same bounds on read and write: whole numbers or null, the period within Core's cap. */
export function parseEarlyPref(v: unknown): EarlyPref {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new DocError('the early-exit preference is not an object');
  const n = (x: unknown, max: number, what: string) => {
    if (x === null || x === undefined) return null;
    if (!Number.isSafeInteger(x) || (x as number) < 0 || (x as number) > max) throw new DocError(`the ${what} must be a whole number from 0 to ${max}, or any`);
    return x as number;
  };
  return { maxPeriodBlocks: n(o.maxPeriodBlocks, MAX_EARLY_PERIOD_BLOCKS, 'longest early period'), maxPenalty: n(o.maxPenalty, MAX_AMOUNT_DUFFS, 'largest penalty') };
}

const SHARE_MAX = REGULAR_COLLATERAL - MIN_SHARE_AMOUNT;
/** A share a member brings to a regular masternode: 100 to 900 DASH (a table needs two shares). EvoNodes are not open yet. */
function checkShare(type: DocType, k: string, v: number): number {
  checkInt(type, k, v);
  const d = BigInt(v);
  if (d < MIN_SHARE_AMOUNT || d > SHARE_MAX) throw new DocError(`${type}.${k}: a share is 100 to 900 DASH`);
  return v;
}

/** One share in a group's roster: the member's identity, amount (duffs) and the row label everyone types into Dash-Qt. */
export interface RosterEntry {
  id: string;
  amount: number;
  /** Fixed by the organizer by lock time, so every member computes the same term sheet. */
  label?: string;
}
const MAX_LABEL = 32;
const labelOk = (v: unknown): v is string => typeof v === 'string' && v === cleanName(v) && v.length > 0 && chars(v) <= MAX_LABEL;
/**
 * A roster Dash Core could still accept for a regular masternode: distinct members, each share 100 DASH up to the collateral, and a
 * remainder that shares larger than the early penalty can still fill.
 */
export function parseRoster(v: unknown, earlyPenalty = 0): RosterEntry[] {
  const collateral = REGULAR_COLLATERAL;
  if (!Array.isArray(v) || v.length > 8) throw new DocError('roster is not a list of up to 8 shares');
  const seen = new Set<string>();
  const labels = new Set<string>();
  const roster = v.map((e) => {
    const o = e as Record<string, unknown>;
    if (!o || typeof o !== 'object' || !isIdentifier(o.id) || !Number.isSafeInteger(o.amount) || seen.has(o.id as string)) throw new DocError('roster entry malformed or repeated');
    if (BigInt(o.amount as number) < MIN_SHARE_AMOUNT || BigInt(o.amount as number) > collateral) throw new DocError('every roster share must be at least 100 DASH and at most the collateral');
    if (o.label !== undefined && (!labelOk(o.label) || labels.has(o.label))) throw new DocError(`share labels must be distinct, 1..${MAX_LABEL} visible characters, without extra spaces`);
    seen.add(o.id as string);
    if (o.label === undefined) return { id: o.id as string, amount: o.amount as number };
    labels.add(o.label);
    return { id: o.id as string, amount: o.amount as number, label: o.label };
  });
  if (!isCompletable(roster.length, remainingDuffs(roster.map((r) => BigInt(r.amount)), collateral), BigInt(earlyPenalty)))
    throw new DocError('the roster can no longer add up to the collateral with valid shares larger than the early-exit penalty');
  return roster;
}

const coreNetwork = (n: Network): CoreNetwork => (n === 'mainnet' ? 'main' : 'test');

/**
 * A masternode service as Dash Core accepts it for a shared (ProTx v3) registration: public IPv4, a port Core allows, 9999 on
 * mainnet. Without a network, the rules both networks share (mainnet adds only the port). Returns the canonical `ip:port`.
 */
export function parseService(v: string, network?: Network): { ip: string; port: number; canonical: string } {
  const r = validateCoreService(v.trim(), coreNetwork(network ?? 'testnet'));
  if (!r.ok) throw new DocError(r.message);
  return { ip: r.ip, port: r.port, canonical: r.canonical };
}
const serviceOrUndefined = (v: string | undefined, network?: Network): string | undefined => {
  if (v === undefined) return undefined;
  try {
    return parseService(v, network).canonical;
  } catch {
    return undefined;
  }
};

/**
 * The early-exit rules of @cairn/shares against the shares so far; null when they hold. Shares still to come are covered by
 * parseRoster, which needs room for shares larger than the penalty.
 */
function earlyTermsProblem(roster: RosterEntry[], earlyPeriodBlocks: number, earlyPenalty: number): string | null {
  const period = isEarlyPeriodValid(earlyPeriodBlocks);
  if (!period.ok) return period.message;
  const pen = isEarlyPenaltyValid(earlyPeriodBlocks, BigInt(earlyPenalty), roster.length ? minAmount(roster.map((r) => BigInt(r.amount))) : REGULAR_COLLATERAL);
  if (!pen.ok) return pen.message;
  if (earlyPeriodBlocks > 0 && earlyPenalty === 0) return 'Set an early-exit penalty, or set the early period to 0 (a zero penalty makes the period meaningless).';
  return null;
}

/** Why a group's status claims more than it holds (a whole table, or frozen terms with everything the term sheet needs), or null. */
function statusClaimProblem(f: Omit<GroupFields, 'roster'>, roster: RosterEntry[]): string | null {
  if (COMPLETE_STATUSES.includes(f.status)) {
    const table = areShareAmountsValid(roster.map((r) => BigInt(r.amount)));
    if (!table.ok) return table.message;
  }
  if (!LOCKED_STATUSES.includes(f.status)) return null;
  const missing: string[] = (['operatorId', 'operatorPubKey', 'votingAddress', 'coordinatorId', 'votingHolderId', 'lockedHash'] as const).filter((k) => !f[k]);
  if (roster.some((r) => !r.label)) missing.push('a label on every share');
  if (missing.length) return `locked terms need ${missing.join(', ')}`;
  if (!roster.some((r) => r.id === f.coordinatorId)) return 'the coordinator must be one of the co-owners';
  // the holder supplies the voting address in their own document: a seat, or the operator's opAccept
  if (f.votingHolderId !== f.operatorId && !roster.some((r) => r.id === f.votingHolderId)) return 'the voting key holder must be a co-owner or the operator';
  return null;
}
/** Statuses that claim the roster is a whole share table. */
const COMPLETE_STATUSES: readonly number[] = [GROUP_STATUS.full, GROUP_STATUS.locked, GROUP_STATUS.formingOnchain, GROUP_STATUS.live];
/** Statuses that claim frozen terms: everything the term sheet (@cairn/shares TermSheet) needs must be there. */
const LOCKED_STATUSES: readonly number[] = [GROUP_STATUS.locked, GROUP_STATUS.formingOnchain, GROUP_STATUS.live];

/** A P2PKH address (what Core takes as a voting key) on `network`, or on either network when unknown. */
const isP2pkh = (v: string, network?: Network): boolean => decodeAddress(v, network && coreNetwork(network))?.type === 'p2pkh';
function checkVotingAddress(type: DocType, v: string, network: Network): string {
  if (!isP2pkh(v, network)) throw new DocError(`the voting address must be a ${network} P2PKH address (${network === 'mainnet' ? 'X' : 'y'}…)`);
  return checkStr(type, 'votingAddress', v);
}
const votingAddressOrUndefined = (v: string | undefined, network?: Network) => (v !== undefined && isP2pkh(v, network) ? v : undefined);

// ---- profile ---------------------------------------------------------------------------------------------------------------

export interface ProfileFields {
  displayName: string;
  about?: string;
  contacts?: Contacts;
  roles?: number;
}
/** `displayName` is cleaned (invisible characters removed; may be empty); `nameSuspect` marks a name that imitates a label. */
export type Profile = DocMeta & Required<Pick<ProfileFields, 'displayName' | 'contacts' | 'roles'>> & Pick<ProfileFields, 'about'> & { nameSuspect: boolean };

function checkName(type: DocType, k: string, v: string): string {
  const problem = nameProblem(v);
  if (problem) throw new DocError(problem);
  return checkStr(type, k, v.trim());
}
const readName = (d: RawDoc, k: string) => {
  const name = cleanName(str(d, k));
  return { name, suspect: badgeLike(name) };
};

export function profileData(f: ProfileFields): DocData {
  const contacts = normalizeContacts(f.contacts ?? {});
  return defined({
    displayName: checkName('profile', 'displayName', f.displayName),
    about: opt(f.about?.trim(), (v) => checkStr('profile', 'about', v)),
    contacts: Object.keys(contacts).length ? jsonStr('profile', 'contacts', contacts) : undefined,
    roles: opt(f.roles, (v) => checkInt('profile', 'roles', v)),
  });
}
export function toProfile(d: RawDoc): Profile {
  const { name, suspect } = readName(d, 'displayName');
  return { ...meta(d), displayName: name, nameSuspect: suspect, about: optStr(d, 'about'), contacts: absent(d, 'contacts') ? {} : json(d, 'contacts', parseContacts), roles: optNum(d, 'roles') ?? 0 };
}

// ---- operator --------------------------------------------------------------------------------------------------------------

export interface OperatorFields {
  name: string;
  /** Operator reward this operator asks for by default, in basis points of the masternode reward (0..10000). */
  rewardBps: number;
  rewardMinBps?: number;
  rewardMaxBps?: number;
  regions?: string[];
  hosting?: string;
  /** How many more masternodes they will take on. */
  capacity?: number;
  /** ProTx hashes (display hex) they say they operate: shown as claimed until the chain confirms them. */
  claimedProTx?: string[];
  status: number;
}
export type Operator = DocMeta & OperatorFields & { regions: string[]; claimedProTx: string[]; nameSuspect: boolean };

export function operatorData(f: OperatorFields): DocData {
  const lo = f.rewardMinBps ?? f.rewardBps;
  const hi = f.rewardMaxBps ?? f.rewardBps;
  if (lo > f.rewardBps || hi < f.rewardBps) throw new DocError('the default operator reward must lie within the accepted range');
  const regions = (f.regions ?? []).map((r) => r.trim()).filter(Boolean);
  parseRegions(regions);
  const pro = (f.claimedProTx ?? []).map((p) => p.trim().toLowerCase());
  parseProTxList(pro);
  return defined({
    name: checkName('operator', 'name', f.name),
    rewardBps: checkInt('operator', 'rewardBps', f.rewardBps),
    rewardMinBps: opt(f.rewardMinBps, (v) => checkInt('operator', 'rewardMinBps', v)),
    rewardMaxBps: opt(f.rewardMaxBps, (v) => checkInt('operator', 'rewardMaxBps', v)),
    regions: regions.length ? jsonStr('operator', 'regions', regions) : undefined,
    hosting: opt(f.hosting?.trim(), (v) => checkStr('operator', 'hosting', v)),
    capacity: opt(f.capacity, (v) => checkInt('operator', 'capacity', v)),
    claimedProTx: pro.length ? jsonStr('operator', 'claimedProTx', pro) : undefined,
    status: checkInt('operator', 'status', f.status),
  });
}
export function toOperator(d: RawDoc): Operator {
  const { name, suspect } = readName(d, 'name');
  return {
    ...meta(d),
    name,
    nameSuspect: suspect,
    rewardBps: num(d, 'rewardBps'),
    rewardMinBps: optNum(d, 'rewardMinBps'),
    rewardMaxBps: optNum(d, 'rewardMaxBps'),
    regions: absent(d, 'regions') ? [] : json(d, 'regions', parseRegions),
    hosting: optStr(d, 'hosting'),
    capacity: optNum(d, 'capacity'),
    claimedProTx: absent(d, 'claimedProTx') ? [] : json(d, 'claimedProTx', parseProTxList),
    status: num(d, 'status'),
  };
}

// ---- looking ---------------------------------------------------------------------------------------------------------------

export interface LookingFields {
  /** Duffs the member brings. */
  amount: number;
  /** A specific operator they want; absent = any. */
  operatorId?: string;
  maxRewardBps: number;
  earlyPref?: EarlyPref;
  canCoordinate: boolean;
  note?: string;
  status: number;
}
export type Looking = DocMeta & LookingFields & { earlyPref: EarlyPref };

export function lookingData(f: LookingFields): DocData {
  const ep = f.earlyPref;
  return defined({
    amount: checkShare('looking', 'amount', f.amount),
    operatorId: opt(f.operatorId, (v) => idBytes(v, 'operatorId')),
    maxRewardBps: checkInt('looking', 'maxRewardBps', f.maxRewardBps),
    earlyPref: ep && (ep.maxPeriodBlocks !== null || ep.maxPenalty !== null) ? jsonStr('looking', 'earlyPref', parseEarlyPref(ep)) : undefined,
    canCoordinate: f.canCoordinate,
    note: opt(f.note?.trim(), (v) => checkStr('looking', 'note', v)),
    status: checkInt('looking', 'status', f.status),
  });
}
export function toLooking(d: RawDoc): Looking {
  return {
    ...meta(d),
    amount: num(d, 'amount'),
    operatorId: optIdent(d, 'operatorId'),
    maxRewardBps: num(d, 'maxRewardBps'),
    earlyPref: absent(d, 'earlyPref') ? { maxPeriodBlocks: null, maxPenalty: null } : json(d, 'earlyPref', parseEarlyPref),
    canCoordinate: bool(d, 'canCoordinate'),
    note: optStr(d, 'note'),
    status: num(d, 'status'),
  };
}

// ---- group -----------------------------------------------------------------------------------------------------------------

export interface GroupFields {
  title: string;
  about?: string;
  mnType: number;
  /** null: a member-led group whose operator is still to be chosen (the property is left out). */
  operatorId: string | null;
  rewardBps: number;
  earlyPeriodBlocks: number;
  /** Duffs. */
  earlyPenalty: number;
  coordinatorId?: string;
  votingHolderId?: string;
  votingPolicy?: string;
  chatUrl?: string;
  /** Unix seconds. */
  formBy?: number;
  roster: RosterEntry[];
  revision: number;
  /** termsHash of the locked revision (hex). */
  lockedHash?: string;
  /** BLS operator public key, 48 bytes (96 hex). */
  operatorPubKey?: string;
  service?: string;
  /** ProRegTx hash, display order hex. */
  proTxHash?: string;
  /** The organizer's claim; chain-derivable states are recomputed on read. */
  status: number;
  refillOf?: string;
  /** P2PKH address of the voting key holder's key; part of the term sheet, required from lock on. */
  votingAddress?: string;
  /** GROUP_FLAG bits. */
  flags?: number;
}
export type Group = DocMeta & GroupFields;

/** The group document for a write on `network`: schema limits plus Dash Core's share-table, early-exit and service rules. */
export function groupData(f: GroupFields, network: Network): DocData {
  const mnType = checkInt('group', 'mnType', f.mnType);
  // Dash Core v24 shares regular masternodes only (shared EvoNodes need evo_shares); the schema leaves room for them
  if (mnType !== MN_TYPE.regular) throw new DocError('only regular masternodes can be shared with Dash Core v24');
  checkInt('group', 'earlyPeriodBlocks', f.earlyPeriodBlocks);
  checkInt('group', 'earlyPenalty', f.earlyPenalty);
  const roster = parseRoster(f.roster, f.earlyPenalty);
  const problem = earlyTermsProblem(roster, f.earlyPeriodBlocks, f.earlyPenalty) ?? statusClaimProblem(f, roster);
  if (problem) throw new DocError(problem);
  return defined({
    title: checkStr('group', 'title', f.title.trim()),
    about: opt(f.about?.trim(), (v) => checkStr('group', 'about', v)),
    mnType,
    operatorId: opt(f.operatorId, (v) => idBytes(v, 'operatorId')),
    rewardBps: checkInt('group', 'rewardBps', f.rewardBps),
    earlyPeriodBlocks: f.earlyPeriodBlocks,
    earlyPenalty: f.earlyPenalty,
    coordinatorId: opt(f.coordinatorId, (v) => idBytes(v, 'coordinatorId')),
    votingHolderId: opt(f.votingHolderId, (v) => idBytes(v, 'votingHolderId')),
    votingPolicy: opt(f.votingPolicy?.trim(), (v) => checkStr('group', 'votingPolicy', v)),
    chatUrl: opt(f.chatUrl?.trim(), (v) => {
      const u = httpsUrl(v);
      if (!u) throw new DocError('the group chat link must be an https:// address');
      return checkStr('group', 'chatUrl', u);
    }),
    formBy: opt(f.formBy, (v) => checkInt('group', 'formBy', v)),
    roster: jsonStr('group', 'roster', roster),
    revision: checkInt('group', 'revision', f.revision),
    lockedHash: opt(f.lockedHash, (v) => hexBytes('group', 'lockedHash', v, 32)),
    operatorPubKey: opt(f.operatorPubKey, (v) => hexBytes('group', 'operatorPubKey', v, 48)),
    service: opt(f.service?.trim(), (v) => checkStr('group', 'service', parseService(v, network).canonical)),
    proTxHash: opt(f.proTxHash, (v) => hexBytes('group', 'proTxHash', v, 32)),
    status: checkInt('group', 'status', f.status),
    refillOf: opt(f.refillOf, (v) => idBytes(v, 'refillOf')),
    votingAddress: opt(f.votingAddress?.trim(), (v) => checkVotingAddress('group', v, network)),
    flags: opt(f.flags, (v) => checkInt('group', 'flags', v)),
  });
}
/**
 * A stored group. Throws when it is not a regular masternode or its roster or early-exit terms break Dash Core's rules (no front end
 * may show them as terms); drops a service or voting address Core would refuse, judged by `network`'s rules when given; reads a
 * status that claims more than the document holds (a whole table, complete locked terms) as forming.
 */
export function toGroup(d: RawDoc, network?: Network): Group {
  const chat = optStr(d, 'chatUrl');
  const mnType = num(d, 'mnType');
  if (mnType !== MN_TYPE.regular) fail('mnType');
  const earlyPeriodBlocks = num(d, 'earlyPeriodBlocks');
  const earlyPenalty = num(d, 'earlyPenalty');
  const roster = json(d, 'roster', (v) => parseRoster(v, earlyPenalty));
  if (earlyTermsProblem(roster, earlyPeriodBlocks, earlyPenalty)) fail('earlyPenalty');
  const g: Group = {
    ...meta(d),
    title: str(d, 'title'),
    about: optStr(d, 'about'),
    mnType,
    operatorId: optIdent(d, 'operatorId') ?? null,
    rewardBps: num(d, 'rewardBps'),
    earlyPeriodBlocks,
    earlyPenalty,
    coordinatorId: optIdent(d, 'coordinatorId'),
    votingHolderId: optIdent(d, 'votingHolderId'),
    votingPolicy: optStr(d, 'votingPolicy'),
    // a stored link is shown only if it is still an https URL (the schema cannot say so)
    chatUrl: chat ? (httpsUrl(chat) ?? undefined) : undefined,
    formBy: optNum(d, 'formBy'),
    roster,
    revision: num(d, 'revision'),
    lockedHash: optHex(d, 'lockedHash', 32),
    operatorPubKey: optHex(d, 'operatorPubKey', 48),
    service: serviceOrUndefined(optStr(d, 'service'), network),
    proTxHash: optHex(d, 'proTxHash', 32),
    status: num(d, 'status'),
    refillOf: optIdent(d, 'refillOf'),
    votingAddress: votingAddressOrUndefined(optStr(d, 'votingAddress'), network),
    flags: optNum(d, 'flags'),
  };
  return statusClaimProblem(g, roster) ? { ...g, status: GROUP_STATUS.forming } : g;
}

// ---- seat, invite, approval ------------------------------------------------------------------------------------------------

export interface SeatFields {
  groupId: string;
  amount: number;
  message?: string;
  status: number;
  /** SEAT_FLAG bits: can coordinate (has Dash-Qt v24 on a desktop), willing to hold the voting key. */
  flags?: number;
  /** P2PKH address of the voting key, from the member the group chose to hold it. */
  votingAddress?: string;
  /** The ProRegTx this member links after broadcast (any member can; Cairn checks it against the chain and the approvals). */
  proTxHash?: string;
}
export type Seat = DocMeta & SeatFields;
export function seatData(f: SeatFields, network: Network): DocData {
  return defined({
    groupId: idBytes(f.groupId, 'groupId'),
    amount: checkShare('seat', 'amount', f.amount),
    message: opt(f.message?.trim(), (v) => checkStr('seat', 'message', v)),
    status: checkInt('seat', 'status', f.status),
    flags: opt(f.flags, (v) => checkInt('seat', 'flags', v)),
    votingAddress: opt(f.votingAddress?.trim(), (v) => checkVotingAddress('seat', v, network)),
    proTxHash: opt(f.proTxHash, (v) => hexBytes('seat', 'proTxHash', v, 32)),
  });
}
export const toSeat = (d: RawDoc, network?: Network): Seat => ({
  ...meta(d),
  groupId: ident(d, 'groupId'),
  amount: num(d, 'amount'),
  message: optStr(d, 'message'),
  status: num(d, 'status'),
  flags: optNum(d, 'flags') ?? 0,
  votingAddress: votingAddressOrUndefined(optStr(d, 'votingAddress'), network),
  proTxHash: optHex(d, 'proTxHash', 32),
});

export interface InviteFields {
  groupId: string;
  toId: string;
  amount: number;
  message?: string;
  status: number;
}
export type Invite = DocMeta & InviteFields;
export function inviteData(f: InviteFields): DocData {
  return defined({
    groupId: idBytes(f.groupId, 'groupId'),
    toId: idBytes(f.toId, 'toId'),
    amount: checkShare('invite', 'amount', f.amount),
    message: opt(f.message?.trim(), (v) => checkStr('invite', 'message', v)),
    status: checkInt('invite', 'status', f.status),
  });
}
export const toInvite = (d: RawDoc): Invite => ({ ...meta(d), groupId: ident(d, 'groupId'), toId: ident(d, 'toId'), amount: num(d, 'amount'), message: optStr(d, 'message'), status: num(d, 'status') });

export interface ApprovalFields {
  groupId: string;
  revision: number;
  /** sha256 term-sheet hash (hex). */
  termsHash: string;
  shareAmount: number;
}
export type Approval = DocMeta & ApprovalFields;
export function approvalData(f: ApprovalFields): DocData {
  return {
    groupId: idBytes(f.groupId, 'groupId'),
    revision: checkInt('approval', 'revision', f.revision),
    termsHash: hexBytes('approval', 'termsHash', f.termsHash, 32),
    shareAmount: checkShare('approval', 'shareAmount', f.shareAmount),
  };
}
export const toApproval = (d: RawDoc): Approval => ({
  ...meta(d),
  groupId: ident(d, 'groupId'),
  revision: num(d, 'revision'),
  termsHash: hex.encode(bytes(d, 'termsHash', 32)),
  shareAmount: num(d, 'shareAmount'),
});

// ---- opAccept --------------------------------------------------------------------------------------------------------------

/**
 * The operator's side of a member-led group, owned by the operator (they cannot write the organizer's group). The organizer copies
 * the key, service and reward into the group before locking. In an operator-led group the operator is the organizer, so the group
 * carries them directly.
 */
export interface OpAcceptFields {
  groupId: string;
  status: number;
  /** BLS operator public key, 48 bytes (96 hex); may follow the acceptance, before lock. */
  operatorPubKey?: string;
  service?: string;
  /** The operator reward they accept, in basis points; required when accepting. */
  rewardBps?: number;
  message?: string;
  /** P2PKH address of the voting key, when the group chose the operator to hold it. */
  votingAddress?: string;
}
export type OpAccept = DocMeta & OpAcceptFields;
export function opAcceptData(f: OpAcceptFields, network: Network): DocData {
  if (f.status === OP_ACCEPT_STATUS.accepted && f.rewardBps === undefined) throw new DocError('accepting a group needs the operator reward you accept');
  return defined({
    groupId: idBytes(f.groupId, 'groupId'),
    status: checkInt('opAccept', 'status', f.status),
    operatorPubKey: opt(f.operatorPubKey, (v) => hexBytes('opAccept', 'operatorPubKey', v, 48)),
    service: opt(f.service?.trim(), (v) => checkStr('opAccept', 'service', parseService(v, network).canonical)),
    rewardBps: opt(f.rewardBps, (v) => checkInt('opAccept', 'rewardBps', v)),
    message: opt(f.message?.trim(), (v) => checkStr('opAccept', 'message', v)),
    votingAddress: opt(f.votingAddress?.trim(), (v) => checkVotingAddress('opAccept', v, network)),
  });
}
export const toOpAccept = (d: RawDoc, network?: Network): OpAccept => ({
  ...meta(d),
  groupId: ident(d, 'groupId'),
  status: num(d, 'status'),
  operatorPubKey: optHex(d, 'operatorPubKey', 48),
  service: serviceOrUndefined(optStr(d, 'service'), network),
  rewardBps: optNum(d, 'rewardBps'),
  message: optStr(d, 'message'),
  votingAddress: votingAddressOrUndefined(optStr(d, 'votingAddress'), network),
});

/** Every reader by type, for generic list code. */
export const READERS = {
  profile: toProfile,
  operator: toOperator,
  looking: toLooking,
  group: toGroup,
  seat: toSeat,
  invite: toInvite,
  approval: toApproval,
  opAccept: toOpAccept,
} satisfies Partial<Record<DocType, (d: RawDoc) => DocMeta>>;
