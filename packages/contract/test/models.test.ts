import { describe, expect, it } from 'vitest';
import { base58, base64 } from '@scure/base';
import { keyIdToAddress } from '@cairn/shares';
import {
  CAIRN_SCHEMAS, DocError, GROUP_STATUS, OP_ACCEPT_STATUS, SEAT_FLAG, approvalData, createOp, deleteOp, groupData, inviteData, lookingData, opAcceptData,
  operatorData, parseService, profileData, replaceOp, seatData, toApproval, toGroup, toInvite, toLooking, toOpAccept, toOperator, toProfile, toSeat,
  type DocData, type DocType, type GroupFields, type RawDoc,
} from '../src/index.ts';

const A = base58.encode(new Uint8Array(32).fill(1));
const B = base58.encode(new Uint8Array(32).fill(2));
const C = base58.encode(new Uint8Array(32).fill(3));
const DASH = 100_000_000;
const VOTE_TEST = keyIdToAddress(new Uint8Array(20).fill(9), 'test');
const VOTE_MAIN = keyIdToAddress(new Uint8Array(20).fill(9), 'main');

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

  it('checks a website after normalizing it, with the same limit on both sides', () => {
    // punycode makes this 100-character input longer than 100 once normalized: refused when written, not silently dropped on read
    const long = `https://${'ü'.repeat(40)}.example/${'a'.repeat(40)}`;
    expect([...long].length).toBeLessThanOrEqual(100);
    expect(() => profileData({ displayName: 'x', contacts: { website: long } })).toThrow(/longer than 100/);
    const ok = `https://bücher.example/${'a'.repeat(50)}`;
    const p = toProfile(stored('profile', profileData({ displayName: 'x', contacts: { website: ok } })));
    expect(p.contacts.website).toBe('https://xn--bcher-kva.example/' + 'a'.repeat(50));
    expect(toProfile({ ...stored('profile', profileData({ displayName: 'x' })), contacts: JSON.stringify({ website: long }) }).contacts).toEqual({});
  });

  it('refuses names that imitate labels or hide characters, and cleans stored ones (govhub D-035)', () => {
    for (const name of ['\u202Eecila', 'al\u200Bice', 'Verified Bob', 'b\u043Eb \u2713', 'alice.dash', '0wner', 'Cairn team', 'p\u0430ypal'])
      expect(() => profileData({ displayName: name }), name).toThrow(DocError);
    for (const name of ['Alice', 'Lena Masternode Hosting', '\u5F20\u4F1F', 'Zo\u00EB', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}']) expect(() => profileData({ displayName: name }), name).not.toThrow();
    const raw = stored('profile', profileData({ displayName: 'x' }));
    expect(toProfile({ ...raw, displayName: '\u202Eecila\u200B' })).toMatchObject({ displayName: 'ecila', nameSuspect: false });
    expect(toProfile({ ...raw, displayName: 'Verified  Bob' })).toMatchObject({ displayName: 'Verified Bob', nameSuspect: true });
    expect(toProfile({ ...raw, displayName: '\u200B\u200B' }).displayName).toBe('');
    expect(() => operatorData({ name: 'Official \u2714 hosting', rewardBps: 0, status: 1 })).toThrow(DocError);
    expect(toOperator({ ...stored('operator', operatorData({ name: 'N', rewardBps: 0, status: 1 })), name: 'N\u2066orth' }).name).toBe('North');
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

  it('refuses an early-exit preference the reader would refuse (the listing would vanish)', () => {
    const f = { amount: 300 * DASH, maxRewardBps: 1000, canCoordinate: true, status: 1 };
    for (const earlyPref of [{ maxPeriodBlocks: -5, maxPenalty: 1.5 }, { maxPeriodBlocks: 420_481, maxPenalty: null }, { maxPeriodBlocks: null, maxPenalty: 0.5 }])
      expect(() => lookingData({ ...f, earlyPref }), JSON.stringify(earlyPref)).toThrow(DocError);
    const max = { maxPeriodBlocks: 420_480, maxPenalty: 0 };
    expect(toLooking(stored('looking', lookingData({ ...f, earlyPref: max }))).earlyPref).toEqual(max);
  });

  it('amounts members bring are valid shares of a regular masternode (100 to 900 DASH)', () => {
    const f = { maxRewardBps: 0, canCoordinate: false, status: 1 };
    for (const amount of [99 * DASH, 901 * DASH, 4000 * DASH]) {
      expect(() => lookingData({ ...f, amount })).toThrow(/100 to 900/);
      expect(() => seatData({ groupId: C, amount, status: 1 }, 'testnet')).toThrow(/100 to 900/);
      expect(() => inviteData({ groupId: C, toId: B, amount, status: 1 })).toThrow(/100 to 900/);
      expect(() => approvalData({ groupId: C, revision: 1, termsHash: 'aa'.repeat(32), shareAmount: amount })).toThrow(/100 to 900/);
    }
  });
});

describe('group', () => {
  const base: GroupFields = {
    title: "Lena's node", mnType: 1, operatorId: B, rewardBps: 500, earlyPeriodBlocks: 52_560, earlyPenalty: 10 * DASH,
    roster: [{ id: A, amount: 400 * DASH }, { id: B, amount: 250 * DASH }], revision: 0, status: GROUP_STATUS.forming,
  };

  it('round-trips every field', () => {
    const f = {
      ...base, about: 'EU operator', coordinatorId: A, votingHolderId: A, votingPolicy: 'majority of shares', chatUrl: 'https://discord.gg/x', formBy: 1_800_000_000,
      lockedHash: 'cd'.repeat(32), operatorPubKey: 'ef'.repeat(48), service: '34.212.1.7:9999', proTxHash: '12'.repeat(32), refillOf: C,
      votingAddress: VOTE_MAIN, flags: 1,
    };
    expect(toGroup(stored('group', groupData(f, 'mainnet')), 'mainnet')).toMatchObject(f);
  });

  it('leaves operatorId out for "operator to be chosen" and reads it back as null', () => {
    const data = groupData({ ...base, operatorId: null }, 'testnet');
    expect('operatorId' in data).toBe(false);
    expect(toGroup(stored('group', data)).operatorId).toBeNull();
  });

  const g = (f: Partial<GroupFields>, network: 'testnet' | 'mainnet' = 'testnet') => () => groupData({ ...base, ...f }, network);
  const id = (i: number) => base58.encode(new Uint8Array(32).fill(i + 1));

  it('refuses malformed rosters, keys and services', () => {
    expect(g({ roster: [{ id: A, amount: 100 * DASH }, { id: A, amount: 200 * DASH }] })).toThrow(/repeated/);
    expect(g({ roster: Array.from({ length: 9 }, (_, i) => ({ id: id(i), amount: 100 * DASH })) })).toThrow(/8 shares/);
    expect(g({ operatorPubKey: 'ab' })).toThrow(/96 hex/);
    expect(g({ service: '[::1]:9999' })).toThrow(DocError);
    expect(g({ chatUrl: 'javascript:alert(1)' })).toThrow(/https/);
  });

  it('applies Dash Core v24 share rules: early period cap, penalty below the smallest share and only with a period, shares 100..1000', () => {
    expect(g({ earlyPeriodBlocks: 4_000_000 })).toThrow(/420480/);
    expect(g({ earlyPeriodBlocks: 420_481 })).toThrow(/420480/);
    expect(g({ earlyPeriodBlocks: 420_480 })).not.toThrow();
    expect(g({ earlyPenalty: 3000 * DASH })).toThrow(/larger than the early-exit penalty|below the smallest share/);
    expect(g({ roster: [{ id: A, amount: 400 * DASH }, { id: B, amount: 150 * DASH }], earlyPenalty: 200 * DASH })).toThrow(/below the smallest share/);
    // shares still to come must be larger than the penalty: [500, 350] with 200 could only finish with a 150 share
    expect(g({ roster: [{ id: A, amount: 500 * DASH }, { id: B, amount: 350 * DASH }], earlyPenalty: 200 * DASH })).toThrow(/larger than the early-exit penalty/);
    expect(g({ roster: [{ id: A, amount: 500 * DASH }, { id: B, amount: 250 * DASH }], earlyPenalty: 200 * DASH })).not.toThrow();
    // an operator-led group starts empty: any penalty two shares can stay above
    expect(g({ roster: [], earlyPenalty: 150 * DASH })).not.toThrow();
    expect(g({ roster: [], earlyPenalty: 499 * DASH })).not.toThrow();
    expect(g({ roster: [], earlyPenalty: 500 * DASH })).toThrow(/larger than the early-exit penalty/);
    expect(g({ earlyPeriodBlocks: 0, earlyPenalty: DASH })).toThrow(/penalty to 0/);
    expect(g({ earlyPeriodBlocks: 1000, earlyPenalty: 0 })).toThrow(/Set an early-exit penalty/);
    expect(g({ earlyPeriodBlocks: 0, earlyPenalty: 0 })).not.toThrow();
    expect(g({ roster: [{ id: A, amount: 90_000_000 * DASH }] })).toThrow(/at least 100 DASH and at most the collateral/);
    expect(g({ roster: [{ id: A, amount: 1001 * DASH }] })).toThrow(/at most the collateral/);
    expect(g({ roster: [{ id: A, amount: 99 * DASH }] })).toThrow(/at least 100 DASH/);
    expect(g({ roster: [{ id: A, amount: 950 * DASH }] })).toThrow(/can no longer add up/);
    expect(g({ roster: [{ id: A, amount: 500 * DASH }, { id: B, amount: 450 * DASH }] })).toThrow(/can no longer add up/);
    expect(g({ roster: Array.from({ length: 8 }, (_, i) => ({ id: id(i), amount: 100 * DASH })) })).toThrow(/can no longer add up/);
    // a status that claims a whole table needs one
    expect(g({ status: GROUP_STATUS.full })).toThrow(/add up to exactly/);
    // Dash Core v24 shares regular masternodes only
    expect(g({ mnType: 2, roster: [{ id: A, amount: 2000 * DASH }] })).toThrow(/only regular masternodes/);
    expect(g({ status: GROUP_STATUS.full, roster: [{ id: A, amount: 600 * DASH }, { id: B, amount: 400 * DASH }] })).not.toThrow();
  });

  it('a stored group that breaks those rules is not read', () => {
    const raw = stored('group', groupData(base, 'testnet'));
    expect(() => toGroup({ ...raw, roster: JSON.stringify([{ id: A, amount: 9e15 }]) })).toThrow(DocError);
    expect(() => toGroup({ ...raw, earlyPenalty: 3000 * DASH })).toThrow(DocError);
    expect(() => toGroup({ ...raw, earlyPeriodBlocks: 4_000_000 })).toThrow(DocError);
    expect(() => toGroup({ ...raw, mnType: 2 })).toThrow(DocError);
  });

  it('a stored status that claims more than the document holds reads as forming', () => {
    const raw = stored('group', groupData(base, 'testnet'));
    expect(toGroup({ ...raw, status: GROUP_STATUS.full }).status).toBe(GROUP_STATUS.forming);
    expect(toGroup({ ...raw, status: GROUP_STATUS.live }).status).toBe(GROUP_STATUS.forming);
    expect(toGroup({ ...raw, status: GROUP_STATUS.cancelled }).status).toBe(GROUP_STATUS.cancelled);
    const full = stored('group', groupData({ ...base, status: GROUP_STATUS.full, roster: [{ id: A, amount: 600 * DASH }, { id: B, amount: 400 * DASH }] }, 'testnet'));
    expect(toGroup(full).status).toBe(GROUP_STATUS.full);
  });

  it('services follow Dash Core: public IPv4, allowed port, 9999 on mainnet; stored canonical', () => {
    expect(parseService(' 34.212.1.7:19999 ', 'testnet')).toEqual({ ip: '34.212.1.7', port: 19999, canonical: '34.212.1.7:19999' });
    expect(() => parseService('34.212.1.7:19999', 'mainnet')).toThrow(/9999/);
    expect(() => parseService('256.0.0.1:9999')).toThrow(/IPv4/);
    for (const s of ['10.1.2.3:9999', '192.168.0.2:9999', '127.0.0.1:9999', '203.0.113.7:9999', '100.64.1.1:9999']) expect(() => parseService(s), s).toThrow(/public IP/);
    for (const s of ['34.212.1.7:22', '34.212.1.7:6667', '34.212.1.7:8333']) expect(() => parseService(s), s).toThrow(/refuses port/);
    expect(groupData({ ...base, service: ' 34.212.1.7:19999 ' }, 'testnet').service).toBe('34.212.1.7:19999');
    expect(g({ service: '34.212.1.7:19999' }, 'mainnet')).toThrow(/9999/);
  });

  it('a stored service Dash Core would refuse is not shown', () => {
    const raw = stored('group', groupData(base, 'testnet'));
    for (const service of ['javascript:alert(1)', '10.0.0.1:9999', '34.212.1.7:443']) expect(toGroup({ ...raw, service }).service, service).toBeUndefined();
    expect(toGroup({ ...raw, service: '34.212.1.7:19999' }).service).toBe('34.212.1.7:19999');
    expect(toGroup({ ...raw, service: '34.212.1.7:19999' }, 'mainnet').service).toBeUndefined();
  });

  it('the voting address is a P2PKH address of the group\'s network', () => {
    expect(groupData({ ...base, votingAddress: ` ${VOTE_TEST} ` }, 'testnet').votingAddress).toBe(VOTE_TEST);
    expect(g({ votingAddress: VOTE_MAIN }, 'testnet')).toThrow(/testnet P2PKH/);
    expect(g({ votingAddress: VOTE_TEST }, 'mainnet')).toThrow(/mainnet P2PKH/);
    expect(g({ votingAddress: '8kGjF3Rx9C1ZLvrsoJzXzszrBNeGJuARZy' }, 'testnet')).toThrow(/P2PKH/);
    const raw = stored('group', groupData(base, 'testnet'));
    expect(toGroup({ ...raw, votingAddress: VOTE_TEST }, 'testnet').votingAddress).toBe(VOTE_TEST);
    expect(toGroup({ ...raw, votingAddress: VOTE_TEST }, 'mainnet').votingAddress).toBeUndefined();
    expect(toGroup({ ...raw, votingAddress: 'not an address' }).votingAddress).toBeUndefined();
  });

  it('roster labels are distinct, visible and short, and round-trip', () => {
    const roster = [{ id: A, amount: 600 * DASH, label: 'Lena' }, { id: B, amount: 400 * DASH, label: 'Ben' }];
    expect(toGroup(stored('group', groupData({ ...base, roster }, 'testnet'))).roster).toEqual(roster);
    for (const label of ['', ' Lena', 'Le\u200Bna', 'x'.repeat(33)]) expect(g({ roster: [{ id: A, amount: 600 * DASH, label }] }), JSON.stringify(label)).toThrow(/labels/);
    expect(g({ roster: [{ id: A, amount: 600 * DASH, label: 'X' }, { id: B, amount: 400 * DASH, label: 'X' }] })).toThrow(/distinct/);
  });

  it('locked terms carry everything the term sheet needs', () => {
    const roster = [{ id: A, amount: 600 * DASH, label: 'Lena' }, { id: B, amount: 400 * DASH, label: 'Ben' }];
    const locked = { roster, status: GROUP_STATUS.locked, operatorPubKey: 'ef'.repeat(48), votingAddress: VOTE_TEST, coordinatorId: A, votingHolderId: A, lockedHash: 'cd'.repeat(32) };
    expect(g(locked)).not.toThrow();
    expect(g({ ...locked, operatorId: null })).toThrow(/operatorId/);
    expect(g({ ...locked, votingAddress: undefined })).toThrow(/votingAddress/);
    expect(g({ ...locked, roster: [{ id: A, amount: 600 * DASH }, { id: B, amount: 400 * DASH }] })).toThrow(/label on every share/);
    expect(g({ ...locked, coordinatorId: C })).toThrow(/coordinator must be one of the co-owners/);
    expect(g({ ...locked, votingHolderId: C })).toThrow(/voting key holder must be a co-owner or the operator/);
    expect(g({ ...locked, operatorId: C, votingHolderId: C })).not.toThrow();
    expect(g({ ...locked, status: GROUP_STATUS.forming, operatorId: null, votingAddress: undefined })).not.toThrow();
  });

  it('a stored chat link that is not https is not shown', () => {
    const raw = stored('group', groupData(base, 'testnet'));
    expect(toGroup({ ...raw, chatUrl: 'javascript:alert(1)' }).chatUrl).toBeUndefined();
  });
});

describe('seat, invite, approval, opAccept', () => {
  it('round-trip', () => {
    expect(toSeat(stored('seat', seatData({ groupId: C, amount: 100 * DASH, message: 'hi', status: 1 }, 'testnet')))).toMatchObject({ groupId: C, amount: 100 * DASH, message: 'hi', status: 1, flags: 0 });
    const seat = { groupId: C, amount: 300 * DASH, status: 1, flags: SEAT_FLAG.canCoordinate | SEAT_FLAG.votingKeyHolder, votingAddress: VOTE_TEST, proTxHash: '34'.repeat(32) };
    expect(toSeat(stored('seat', seatData(seat, 'testnet')), 'testnet')).toMatchObject(seat);
    expect(() => seatData({ ...seat, votingAddress: VOTE_MAIN }, 'testnet')).toThrow(/P2PKH/);
    expect(() => seatData({ ...seat, flags: 70_000 }, 'testnet')).toThrow(DocError);
    expect(toInvite(stored('invite', inviteData({ groupId: C, toId: B, amount: 200 * DASH, status: 1 })))).toMatchObject({ groupId: C, toId: B, amount: 200 * DASH, status: 1 });
    expect(toApproval(stored('approval', approvalData({ groupId: C, revision: 2, termsHash: 'aa'.repeat(32), shareAmount: 300 * DASH })))).toMatchObject({ groupId: C, revision: 2, termsHash: 'aa'.repeat(32) });
  });

  it('opAccept: the operator\'s answer, with the key, service and reward the organizer copies into the group', () => {
    const f = { groupId: C, status: OP_ACCEPT_STATUS.accepted, operatorPubKey: 'ab'.repeat(48), service: '34.212.1.7:9999', rewardBps: 750, message: 'Happy to run it', votingAddress: VOTE_MAIN };
    expect(toOpAccept(stored('opAccept', opAcceptData(f, 'mainnet')), 'mainnet')).toMatchObject(f);
    expect(toOpAccept(stored('opAccept', opAcceptData({ groupId: C, status: OP_ACCEPT_STATUS.declined }, 'testnet')))).toMatchObject({ status: 2, rewardBps: undefined });
    expect(() => opAcceptData({ groupId: C, status: OP_ACCEPT_STATUS.accepted }, 'testnet')).toThrow(/reward/);
    expect(() => opAcceptData({ ...f, service: '192.168.1.2:9999' }, 'mainnet')).toThrow(/public IP/);
    expect(() => opAcceptData({ ...f, service: '34.212.1.7:19999' }, 'mainnet')).toThrow(/9999/);
    expect(() => opAcceptData({ ...f, operatorPubKey: 'ab' }, 'mainnet')).toThrow(/96 hex/);
    expect(() => opAcceptData({ ...f, rewardBps: 10_001 }, 'mainnet')).toThrow(DocError);
    expect(() => opAcceptData({ ...f, votingAddress: VOTE_TEST }, 'mainnet')).toThrow(/P2PKH/);
    expect(toOpAccept({ ...stored('opAccept', opAcceptData(f, 'mainnet')), service: 'javascript:alert(1)' }).service).toBeUndefined();
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
