// Network profiles, after govhub's registry (apps/web/src/config/registry.ts): one coherent bundle per network (Core and Platform
// network, the cairn contract, DAPI node source, evo-sdk connection). Cairn keeps only the profile choice in localStorage.
import { contractIdFor, type Network } from '@cairn/contract';

export type { Network };
export type ProfileId = Network;

export interface Registry {
  profile: ProfileId;
  network: Network;
  label: string;
  /** The cairn contract; null until it is registered on this network (the app is then read-only "coming soon"). */
  contractId: string | null;
  /** Core-side DAPI (grpc-web on evonodes), for identity funding. */
  dapi: { source: 'quorum' | 'manual'; quorumUrl: string; nodes: string[] };
  /** evo-sdk connection; empty addresses = SDK defaults. */
  platform: { trusted: boolean; addresses: string[] };
  /** Where testnet DASH comes from (testnet only). */
  faucet: string | null;
  /** Masternode explorer and activation data (Radar). */
  radar: string;
}

export const QUORUM_SERVICE: Record<Network, string> = {
  mainnet: 'https://quorums.mainnet.networks.dash.org/masternodes',
  testnet: 'https://quorums.testnet.networks.dash.org/masternodes',
};

const profile = (network: Network, label: string, faucet: string | null): Registry => ({
  profile: network,
  network,
  label,
  contractId: contractIdFor(network),
  dapi: { source: 'quorum', quorumUrl: QUORUM_SERVICE[network], nodes: [] },
  platform: { trusted: true, addresses: [] },
  faucet,
  radar: 'https://nodes.dashhq.org',
});

export const PROFILES: Record<ProfileId, Registry> = {
  testnet: profile('testnet', 'Testnet', 'https://faucet.dashhq.org'),
  mainnet: profile('mainnet', 'Mainnet', null),
};

/** Testnet until the mainnet contract exists: it is where everything works end to end. */
export const DEFAULT_PROFILE: ProfileId = PROFILES.mainnet.contractId ? 'mainnet' : 'testnet';

const KEY = 'cairn.profile.v1';

export function loadProfile(storage: Pick<Storage, 'getItem'> | null): ProfileId {
  try {
    const v = storage?.getItem(KEY);
    return v === 'testnet' || v === 'mainnet' ? v : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(storage: Pick<Storage, 'setItem'> | null, id: ProfileId): void {
  try {
    storage?.setItem(KEY, id);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}
