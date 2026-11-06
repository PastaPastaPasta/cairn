import cairnJson from '../cairn.json' with { type: 'json' };
import deploymentsJson from '../deployments.json' with { type: 'json' };
import type { ContractSchemas } from '../queryLint.ts';

export type Network = 'testnet' | 'mainnet';
export type DocType = 'profile' | 'operator' | 'looking' | 'group' | 'seat' | 'invite' | 'approval' | 'opAccept' | 'vault';

/** The `documentSchemas` map registered as the `cairn` contract (one per network, same schemas). */
export const CAIRN_SCHEMAS = cairnJson as unknown as ContractSchemas;
export const DOC_TYPES = Object.keys(cairnJson) as DocType[];

export interface Deployment {
  contractId: string | null;
  ownerId: string | null;
  registeredAt: string | null;
  feeCredits: string | null;
}

/** Where the cairn contract lives on each network; null until it is registered there (scripts/register.ts writes this file). */
export const DEPLOYMENTS = deploymentsJson as Record<Network, Deployment>;
export const contractIdFor = (network: Network): string | null => DEPLOYMENTS[network]?.contractId ?? null;

/** 1 DASH in duffs. */
export const DUFFS_PER_DASH = 100_000_000;
/** Schema cap on every amount (4000 DASH, room for shared EvoNodes). The v24 share rules are stricter and live in @cairn/shares. */
export const MAX_AMOUNT_DUFFS = 400_000_000_000;
export const MAX_BPS = 10_000;

export const MN_TYPE = { regular: 1, evo: 2 } as const;
export const OPERATOR_STATUS = { open: 1, full: 2, paused: 3 } as const;
export const LOOKING_STATUS = { open: 1, matched: 2, closed: 3 } as const;
export const GROUP_STATUS = { draft: 1, forming: 2, full: 3, locked: 4, formingOnchain: 5, live: 6, dissolved: 7, cancelled: 8 } as const;
export const SEAT_STATUS = { requested: 1, withdrawn: 2 } as const;
export const INVITE_STATUS = { open: 1, withdrawn: 2 } as const;
/** `opAccept.status`: the operator's answer to a member-led group (accepted doubles as an offer to a group with no operator yet). */
export const OP_ACCEPT_STATUS = { accepted: 1, declined: 2, withdrawn: 3 } as const;
/** `seat.flags` bits. sessionStarted: the coordinator (a co-owner, rarely the organizer) has started the Dash-Qt session. */
export const SEAT_FLAG = { canCoordinate: 1, votingKeyHolder: 2, sessionStarted: 4 } as const;
/** `group.flags` bits. openAmounts: members may ask for any amount that fits; without it the organizer offers seats at set amounts. */
export const GROUP_FLAG = { openAmounts: 1 } as const;
/** `profile.roles` bits. */
export const ROLE = { member: 1, operator: 2 } as const;

export type GroupStatus = (typeof GROUP_STATUS)[keyof typeof GROUP_STATUS];

interface PropLimits {
  type?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}
/** A property's schema (limits come from cairn.json, so code and contract cannot drift). */
export function prop(type: DocType, name: string): PropLimits {
  const p = (CAIRN_SCHEMAS[type]?.properties as Record<string, PropLimits> | undefined)?.[name];
  if (!p) throw new Error(`cairn.${type} has no property ${name}`);
  return p;
}
