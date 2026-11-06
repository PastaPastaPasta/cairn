// The operator's and the voting key holder's inputs (DESIGN O4): a BLS operator public key, the node's service, a voting address.
// Checked as Dash Core checks them, as the user types.
import { DocError, parseService, type Network } from '@cairn/contract';
import { decodeAddress } from '@cairn/shares';

/** Why a BLS operator public key cannot be one (format only: 48 bytes as 96 hex characters), or null. */
export function blsFormatProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return 'Paste the BLS operator public key (from `bls generate` on the node: the "public" value).';
  if (/^0x/i.test(t)) return 'Leave out the 0x.';
  if (!/^[0-9a-fA-F]*$/.test(t)) return 'Only hex characters: 0-9 and a-f.';
  if (t.length !== 96) return `A BLS public key is 96 hex characters; this has ${t.length}.`;
  return null;
}

/** Whether the key is a real point on the curve (Dash's basic BLS scheme, compressed G1). Loads the curve code on first use. */
export async function blsPointProblem(text: string): Promise<string | null> {
  const f = blsFormatProblem(text);
  if (f) return f;
  const { bls12_381 } = await import('@noble/curves/bls12-381.js');
  try {
    return bls12_381.G1.Point.fromHex(text.trim().toLowerCase()).is0() ? 'That is the empty key; paste the public key the node generated.' : null;
  } catch {
    return 'This is not a valid BLS public key: check that it was copied whole, and that it is the public key, not the secret.';
  }
}

/** Why `ip:port` cannot be a shared masternode's service on `network` (Dash Core's rules via @cairn/shares), or null. */
export function serviceProblem(text: string, network: Network): string | null {
  if (!text.trim()) return 'Enter the node’s public IPv4 address and port, like 203.0.113.5:9999.';
  try {
    parseService(text, network);
    return null;
  } catch (e) {
    return e instanceof DocError ? e.message : 'Enter an IPv4 address and port.';
  }
}

/** Why `text` cannot be the masternode's voting address (a P2PKH address on this network), or null. */
export function votingAddressProblem(text: string, network: Network): string | null {
  const t = text.trim();
  if (!t) return 'Paste a new address from your Dash Core wallet.';
  const a = decodeAddress(t, network === 'mainnet' ? 'main' : 'test');
  if (!a) return `Not a ${network === 'mainnet' ? 'mainnet (X…)' : 'testnet (y…)'} Dash address.`;
  if (a.type !== 'p2pkh') return 'The voting key must be a regular (P2PKH) address, not a script address.';
  return null;
}
