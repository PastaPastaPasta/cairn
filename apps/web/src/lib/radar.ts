import type { Network } from '@cairn/contract';

/** Radar (Dash HQ's masternode explorer): a masternode's page. Radar defaults to mainnet and takes `?net=testnet`. */
export const RADAR = 'https://radar.dashhq.org';
export const radarMnUrl = (network: Network, proTxHash: string): string => `${RADAR}/mn/${proTxHash}${network === 'mainnet' ? '' : '?net=testnet'}`;
