import { describe, expect, it } from 'vitest';
import { base58, base64 } from '@scure/base';
import {
  CAIRN_SCHEMAS, DocError, GROUP_STATUS, NO_OPERATOR, approvalData, createOp, deleteOp, groupData, inviteData, lookingData, operatorData,
  parseService, profileData, replaceOp, seatData, toApproval, toGroup, toInvite, toLooking, toOperator, toProfile, toSeat,
  type DocData, type DocType, type RawDoc,
} from '../src/index.ts';

const A = base58.encode(new Uint8Array(32).fill(1));
const B = base58.encode(new Uint8Array(32).fill(2));
const C = base58.encode(new Uint8Array(32).fill(3));
const DASH = 100_000_000;

/** What evo-sdk's Document.toJSON gives back for a stored document: identifiers base58, other byte arrays base64. */
function stored(type: DocType, data: DocData, revision = 1): RawDoc {
  const props = CAIRN_SCHEMAS[type]!.properties;
  const out: RawDoc = { $id: C, $ownerId: A, $revision: revision, $createdAt: 1_700_000_000_000, $updatedAt: 1_700_000_100_000 };
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof Uint8Array) out[k] = props[k]?.contentMediaType ? base58.encode(v) : base64.encode(v);
    else out[k] = v;
  }
  return out;
}

describe('profile', () => {
  it('round-trips, trims, keeps contacts in a fixed order and drops empty handles', () => {
    const data = profileData({ displayName: '  Lena ', about: 'Runs nodes in Lisbon', contacts: { website: 'https://lena.example/', discord: 'lena#1', telegram: '' }, roles: 3 });
    expect(data.contacts).toBe('{"discord":"lena#1","website":"https://lena.example/"}');
    const p = toProfile(stored('profile', data));
    expect(p).toMatchObject({ id: C, ownerId: A, displayName: 'Lena', about: 'Runs nodes in Lisbon', roles: 3, contacts: { discord: 'lena#1', website: 'https://lena.example/' } });
  });

  it('refuses what consensus would refuse, and non-https websites', () => {
    expect(() => profileData({ displayName: '' })).toThrow(DocError);
    expect(() => profileData({ displayName: 'x'.repeat(65) })).toThrow(/1..64/);
    expect(() => profileData({ displayName: 'ok', contacts: { website: 'http://insecure.example' } })).toThrow(/https/);
  });

  it('reads a document whose contacts were written by another front end defensively', () => {
    const p = toProfile({ ...stored('profile', profileData({ displayName: 'x' })), contacts: '{"discord":"a","website":"javascript:alert(1)","evil":"y"}' });
    expect(p.contacts).toEqual({ discord: 'a' });
    expect(() => toProfile({ ...stored('profile', profileData({ displayName: 'x' })), contacts: 'not json' })).toThrow(DocError);
  });
});

describe('operator and looking', () => {
  it('operator round-trips; the default reward lies within the range', () => {
    const f = { name: 'Northwind', rewardBps: 500, rewardMinBps: 300, rewardMaxBps: 800, regions: ['EU'], hosting: 'Bare metal', capacity: 4, claimedProTx: ['ab'.repeat(32)], status: 1 };
    expect(toOperator(stored('operator', operatorData(f)))).toMatchObject(f);
    expect(() => operatorData({ ...f, rewardMinBps: 600 })).toThrow(/range/);
    expect(() => operatorData({ ...f, claimedProTx: ['zz'] })).toThrow(DocError);
  });

  it('looking round-trips with and without a preferred operator', () => {
    const f = { amount: 300 * DASH, operatorId: B, maxRewardBps: 1000, earlyPref: { maxPeriodBlocks: 210_240, maxPenalty: 5 * DASH }, canCoordinate: true, note: 'Has Dash-Qt', status: 1 };
    expect(toLooking(stored('looking', lookingData(f)))).toMatchObject(f);
    const any = toLooking(stored('looking', lookingData({ amount: 100 * DASH, maxRewardBps: 0, canCoordinate: false, status: 1 })));
    expect(any.operatorId).toBeUndefined();
    expect(any.earlyPref).toEqual({ maxPeriodBlocks: null, maxPenalty: null });
  });
});

describe('group', () => {
  const base = {
    title: "Lena's node", mnType: 1, operatorId: B, rewardBps: 500, earlyPeriodBlocks: 52_560, earlyPenalty: 10 * DASH,
    roster: [{ id: A, amount: 400 * DASH }, { id: B, amount: 250 * DASH }], revision: 0, status: GROUP_STATUS.forming,
  };

  it('round-trips every field', () => {
    const f = {
      ...base, about: 'EU operator', coordinatorId: A, votingHolderId: A, votingPolicy: 'majority of shares', chatUrl: 'https://discord.gg/x', formBy: 1_800_000_000,
      lockedHash: 'cd'.repeat(32), operatorPubKey: 'ef'.repeat(48), service: '203.0.113.7:9999', proTxHash: '12'.repeat(32), refillOf: C,
    };
    expect(toGroup(stored('group', groupData(f)))).toMatchObject(f);
  });

  it('stores "operator to be chosen" as the zero identifier and reads it back as null', () => {
    const data = groupData({ ...base, operatorId: null });
    expect(base58.encode(data.operatorId as Uint8Array)).toBe(NO_OPERATOR);
    expect(toGroup(stored('group', data)).operatorId).toBeNull();
  });

  it('refuses malformed rosters, keys and services', () => {
    expect(() => groupData({ ...base, roster: [{ id: A, amount: 1 }, { id: A, amount: 2 }] })).toThrow(/repeated/);
    expect(() => groupData({ ...base, roster: Array.from({ length: 9 }, (_, i) => ({ id: base58.encode(new Uint8Array(32).fill(i + 1)), amount: DASH })) })).toThrow(/8 shares/);
    expect(() => groupData({ ...base, operatorPubKey: 'ab' })).toThrow(/96 hex/);
    expect(() => groupData({ ...base, service: '[::1]:9999' })).toThrow(DocError);
    expect(() => groupData({ ...base, chatUrl: 'javascript:alert(1)' })).toThrow(/https/);
  });

  it('parseService checks the mainnet port', () => {
    expect(parseService('203.0.113.7:19999', 'testnet')).toEqual({ ip: '203.0.113.7', port: 19999 });
    expect(() => parseService('203.0.113.7:19999', 'mainnet')).toThrow(/9999/);
    expect(() => parseService('256.0.0.1:9999')).toThrow(/range/);
  });

  it('a stored chat link that is not https is not shown', () => {
    const raw = stored('group', groupData(base));
    expect(toGroup({ ...raw, chatUrl: 'javascript:alert(1)' }).chatUrl).toBeUndefined();
  });
});

describe('seat, invite, approval', () => {
  it('round-trip', () => {
    expect(toSeat(stored('seat', seatData({ groupId: C, amount: 100 * DASH, message: 'hi', status: 1 })))).toMatchObject({ groupId: C, amount: 100 * DASH, message: 'hi', status: 1 });
    expect(toInvite(stored('invite', inviteData({ groupId: C, toId: B, amount: 200 * DASH, status: 1 })))).toMatchObject({ groupId: C, toId: B, amount: 200 * DASH, status: 1 });
    expect(toApproval(stored('approval', approvalData({ groupId: C, revision: 2, termsHash: 'aa'.repeat(32), shareAmount: 300 * DASH })))).toMatchObject({ groupId: C, revision: 2, termsHash: 'aa'.repeat(32) });
  });
});

describe('write ops', () => {
  it('stamp exactly the system times each type requires', () => {
    const p = createOp('X', 'profile', { displayName: 'a' }, 5);
    expect(p).toEqual({ action: 'create', contractId: 'X', type: 'profile', data: { displayName: 'a', $createdAt: 5, $updatedAt: 5 } });
    const a = createOp('X', 'approval', { revision: 1 }, 5);
    expect(a.action === 'create' && a.data).toEqual({ revision: 1, $createdAt: 5 });
    const r = replaceOp('X', 'profile', C, 3, { displayName: 'b' }, 9);
    expect(r).toEqual({ action: 'replace', contractId: 'X', type: 'profile', id: C, revision: 3, data: { displayName: 'b', $updatedAt: 9 } });
    expect(() => replaceOp('X', 'approval', C, 1, {})).toThrow(/cannot be changed/);
    expect(deleteOp('X', 'seat', C)).toEqual({ action: 'delete', contractId: 'X', type: 'seat', id: C });
  });
});
