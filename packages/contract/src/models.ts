// Typed documents of the cairn contract and their (de)serializers.
//   to*(raw)     a proved document's JSON (evo-sdk `Document.toJSON`: byte arrays base64, identifiers base58, integers numbers) ->
//                a model. Throws DocError on anything the schema admits but the app must not trust (bad JSON fields, a roster
//                that is not a list of identities): readers skip such documents.
//   *Data(f)     model fields -> the `data` of a document write (identifiers and hashes as bytes, integers as numbers). Checks
//                every limit cairn.json sets, so consensus never has to refuse a write the UI built.
//   createOp / replaceOp / deleteOp stamp the system times the schema requires.
import { base58, base64, hex } from '@scure/base';
import { CAIRN_SCHEMAS, NO_OPERATOR, prop, type DocType, type Network } from './schema.ts';

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

/** Trims, drops empty handles, checks each one; key order is fixed so equal contacts serialize equally. */
export function normalizeContacts(c: Contacts): Contacts {
  const out: Contacts = {};
  for (const k of CONTACT_KINDS) {
    const v = c[k]?.trim();
    if (!v) continue;
    if (chars(v) > MAX_HANDLE || /[\u0000-\u001f]/.test(v)) throw new DocError(`the ${k} handle is too long or has control characters`);
    if (k === 'website') {
      const u = httpsUrl(v);
      if (!u) throw new DocError('the website must be an https:// address');
      out[k] = u;
    } else out[k] = v;
  }
  return out;
}
function parseContacts(v: unknown): Contacts {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new DocError('contacts is not an object');
  const raw = v as Record<string, unknown>;
  const out: Contacts = {};
  for (const k of CONTACT_KINDS) {
    const x = raw[k];
    if (typeof x !== 'string' || !x || chars(x) > MAX_HANDLE) continue;
    if (k === 'website') {
      const u = httpsUrl(x);
      if (u) out[k] = u;
    } else out[k] = x;
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
function parseEarlyPref(v: unknown): EarlyPref {
  const o = v as Record<string, unknown> | null;
  const n = (x: unknown) => (x === null || x === undefined ? null : Number.isSafeInteger(x) && (x as number) >= 0 ? (x as number) : fail('earlyPref'));
  if (!o || typeof o !== 'object' || Array.isArray(o)) return fail('earlyPref');
  return { maxPeriodBlocks: n(o.maxPeriodBlocks), maxPenalty: n(o.maxPenalty) };
}

/** One share in a group's roster: the member's identity and amount (duffs). */
export interface RosterEntry {
  id: string;
  amount: number;
}
export function parseRoster(v: unknown): RosterEntry[] {
  if (!Array.isArray(v) || v.length > 8) throw new DocError('roster is not a list of up to 8 shares');
  const seen = new Set<string>();
  return v.map((e) => {
    const o = e as Record<string, unknown>;
    if (!o || typeof o !== 'object' || !isIdentifier(o.id) || !Number.isSafeInteger(o.amount) || (o.amount as number) <= 0 || seen.has(o.id as string)) throw new DocError('roster entry malformed or repeated');
    seen.add(o.id as string);
    return { id: o.id as string, amount: o.amount as number };
  });
}

/** `ip:port` of a masternode service: IPv4 only (what Dash Core v24 registers for regular masternodes); mainnet must use 9999. */
export function parseService(v: string, network?: Network): { ip: string; port: number } {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/.exec(v.trim());
  if (!m) throw new DocError('the service address must look like 203.0.113.7:9999');
  const octets = m.slice(1, 5).map(Number);
  const port = Number(m[5]);
  if (octets.some((o) => o > 255) || port < 1 || port > 65535) throw new DocError('the service address is out of range');
  if (network === 'mainnet' && port !== 9999) throw new DocError('mainnet masternodes use port 9999');
  return { ip: octets.join('.'), port };
}

// ---- profile ---------------------------------------------------------------------------------------------------------------

export interface ProfileFields {
  displayName: string;
  about?: string;
  contacts?: Contacts;
  roles?: number;
}
export type Profile = DocMeta & Required<Pick<ProfileFields, 'displayName' | 'contacts' | 'roles'>> & Pick<ProfileFields, 'about'>;

export function profileData(f: ProfileFields): DocData {
  const contacts = normalizeContacts(f.contacts ?? {});
  return defined({
    displayName: checkStr('profile', 'displayName', f.displayName.trim()),
    about: opt(f.about?.trim(), (v) => checkStr('profile', 'about', v)),
    contacts: Object.keys(contacts).length ? jsonStr('profile', 'contacts', contacts) : undefined,
    roles: opt(f.roles, (v) => checkInt('profile', 'roles', v)),
  });
}
export function toProfile(d: RawDoc): Profile {
  return { ...meta(d), displayName: str(d, 'displayName'), about: optStr(d, 'about'), contacts: absent(d, 'contacts') ? {} : json(d, 'contacts', parseContacts), roles: optNum(d, 'roles') ?? 0 };
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
export type Operator = DocMeta & OperatorFields & { regions: string[]; claimedProTx: string[] };

export function operatorData(f: OperatorFields): DocData {
  const lo = f.rewardMinBps ?? f.rewardBps;
  const hi = f.rewardMaxBps ?? f.rewardBps;
  if (lo > f.rewardBps || hi < f.rewardBps) throw new DocError('the default operator reward must lie within the accepted range');
  const regions = (f.regions ?? []).map((r) => r.trim()).filter(Boolean);
  parseRegions(regions);
  const pro = (f.claimedProTx ?? []).map((p) => p.trim().toLowerCase());
  parseProTxList(pro);
  return defined({
    name: checkStr('operator', 'name', f.name.trim()),
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
  return {
    ...meta(d),
    name: str(d, 'name'),
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
    amount: checkInt('looking', 'amount', f.amount),
    operatorId: opt(f.operatorId, (v) => idBytes(v, 'operatorId')),
    maxRewardBps: checkInt('looking', 'maxRewardBps', f.maxRewardBps),
    earlyPref: ep && (ep.maxPeriodBlocks !== null || ep.maxPenalty !== null) ? jsonStr('looking', 'earlyPref', { maxPeriodBlocks: ep.maxPeriodBlocks, maxPenalty: ep.maxPenalty }) : undefined,
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
  /** null: member-led group whose operator is still to be chosen (stored as NO_OPERATOR). */
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
}
export type Group = DocMeta & GroupFields;

export function groupData(f: GroupFields): DocData {
  const roster = parseRoster(f.roster);
  return defined({
    title: checkStr('group', 'title', f.title.trim()),
    about: opt(f.about?.trim(), (v) => checkStr('group', 'about', v)),
    mnType: checkInt('group', 'mnType', f.mnType),
    operatorId: idBytes(f.operatorId ?? NO_OPERATOR, 'operatorId'),
    rewardBps: checkInt('group', 'rewardBps', f.rewardBps),
    earlyPeriodBlocks: checkInt('group', 'earlyPeriodBlocks', f.earlyPeriodBlocks),
    earlyPenalty: checkInt('group', 'earlyPenalty', f.earlyPenalty),
    coordinatorId: opt(f.coordinatorId, (v) => idBytes(v, 'coordinatorId')),
    votingHolderId: opt(f.votingHolderId, (v) => idBytes(v, 'votingHolderId')),
    votingPolicy: opt(f.votingPolicy?.trim(), (v) => checkStr('group', 'votingPolicy', v)),
    chatUrl: opt(f.chatUrl?.trim(), (v) => {
      const u = httpsUrl(v);
      if (!u) throw new DocError('the group chat link must be an https:// address');
      return checkStr('group', 'chatUrl', u);
    }),
    formBy: opt(f.formBy, (v) => checkInt('group', 'formBy', v)),
    roster: jsonStr('group', 'roster', roster.map((r) => ({ id: r.id, amount: r.amount }))),
    revision: checkInt('group', 'revision', f.revision),
    lockedHash: opt(f.lockedHash, (v) => hexBytes('group', 'lockedHash', v, 32)),
    operatorPubKey: opt(f.operatorPubKey, (v) => hexBytes('group', 'operatorPubKey', v, 48)),
    service: opt(f.service, (v) => (parseService(v), checkStr('group', 'service', v.trim()))),
    proTxHash: opt(f.proTxHash, (v) => hexBytes('group', 'proTxHash', v, 32)),
    status: checkInt('group', 'status', f.status),
    refillOf: opt(f.refillOf, (v) => idBytes(v, 'refillOf')),
  });
}
export function toGroup(d: RawDoc): Group {
  const op = ident(d, 'operatorId');
  const chat = optStr(d, 'chatUrl');
  return {
    ...meta(d),
    title: str(d, 'title'),
    about: optStr(d, 'about'),
    mnType: num(d, 'mnType'),
    operatorId: op === NO_OPERATOR ? null : op,
    rewardBps: num(d, 'rewardBps'),
    earlyPeriodBlocks: num(d, 'earlyPeriodBlocks'),
    earlyPenalty: num(d, 'earlyPenalty'),
    coordinatorId: optIdent(d, 'coordinatorId'),
    votingHolderId: optIdent(d, 'votingHolderId'),
    votingPolicy: optStr(d, 'votingPolicy'),
    // a stored link is shown only if it is still an https URL (the schema cannot say so)
    chatUrl: chat ? (httpsUrl(chat) ?? undefined) : undefined,
    formBy: optNum(d, 'formBy'),
    roster: json(d, 'roster', parseRoster),
    revision: num(d, 'revision'),
    lockedHash: optHex(d, 'lockedHash', 32),
    operatorPubKey: optHex(d, 'operatorPubKey', 48),
    service: optStr(d, 'service'),
    proTxHash: optHex(d, 'proTxHash', 32),
    status: num(d, 'status'),
    refillOf: optIdent(d, 'refillOf'),
  };
}

// ---- seat, invite, approval ------------------------------------------------------------------------------------------------

export interface SeatFields {
  groupId: string;
  amount: number;
  message?: string;
  status: number;
}
export type Seat = DocMeta & SeatFields;
export function seatData(f: SeatFields): DocData {
  return defined({
    groupId: idBytes(f.groupId, 'groupId'),
    amount: checkInt('seat', 'amount', f.amount),
    message: opt(f.message?.trim(), (v) => checkStr('seat', 'message', v)),
    status: checkInt('seat', 'status', f.status),
  });
}
export const toSeat = (d: RawDoc): Seat => ({ ...meta(d), groupId: ident(d, 'groupId'), amount: num(d, 'amount'), message: optStr(d, 'message'), status: num(d, 'status') });

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
    amount: checkInt('invite', 'amount', f.amount),
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
    shareAmount: checkInt('approval', 'shareAmount', f.shareAmount),
  };
}
export const toApproval = (d: RawDoc): Approval => ({
  ...meta(d),
  groupId: ident(d, 'groupId'),
  revision: num(d, 'revision'),
  termsHash: hex.encode(bytes(d, 'termsHash', 32)),
  shareAmount: num(d, 'shareAmount'),
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
} satisfies Partial<Record<DocType, (d: RawDoc) => DocMeta>>;
