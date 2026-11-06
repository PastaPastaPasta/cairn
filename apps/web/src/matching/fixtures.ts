// Test documents for the matching logic: models as the readers return them, with real-looking identifiers.
import { GROUP_STATUS, LOOKING_STATUS, MN_TYPE, OP_ACCEPT_STATUS, SEAT_STATUS, type Approval, type Group, type Looking, type OpAccept, type Seat } from '@cairn/contract';
import { keyIdToAddress } from '@cairn/shares';
import { base58 } from '@scure/base';
import { DUFFS } from './money.ts';

export const id = (n: number): string => base58.encode(new Uint8Array(32).fill(n));
export const D = (dash: number) => dash * DUFFS;

export const ORG = id(1);
export const OPR = id(2);
export const A = id(3);
export const B = id(4);
export const C = id(5);
export const GID = id(9);

export const BLS = 'a'.repeat(96);
export const SERVICE = '45.32.70.131:19999';
export const VOTING = keyIdToAddress(new Uint8Array(20).fill(7), 'test');

export function group(over: Partial<Group> = {}): Group {
  return {
    id: GID,
    ownerId: ORG,
    revision: 1,
    updatedAt: 1,
    title: 'Lisbon node',
    mnType: MN_TYPE.regular,
    operatorId: OPR,
    rewardBps: 1000,
    earlyPeriodBlocks: 0,
    earlyPenalty: 0,
    roster: [],
    status: GROUP_STATUS.forming,
    flags: 1,
    ...over,
  } as Group;
}

export function seat(ownerId: string, amount: number, over: Partial<Seat> = {}): Seat {
  return { id: id(100 + amount / DUFFS / 10), ownerId, revision: 1, groupId: GID, amount, status: SEAT_STATUS.requested, flags: 0, ...over } as Seat;
}

export function looking(ownerId: string, amount: number, over: Partial<Looking> = {}): Looking {
  return { id: id(200), ownerId, revision: 1, amount, maxRewardBps: 2000, earlyPref: { maxPeriodBlocks: null, maxPenalty: null }, canCoordinate: false, status: LOOKING_STATUS.open, ...over } as Looking;
}

export function opAccept(over: Partial<OpAccept> = {}): OpAccept {
  return { id: id(50), ownerId: OPR, revision: 1, groupId: GID, status: OP_ACCEPT_STATUS.accepted, rewardBps: 1000, operatorPubKey: BLS, service: SERVICE, ...over } as OpAccept;
}

export function approval(ownerId: string, termsHash: string, shareAmount: number, revision = 1): Approval {
  return { id: id(60), ownerId, groupId: GID, termsHash, shareAmount, revision } as Approval;
}
