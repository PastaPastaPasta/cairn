// Platform refuses a write when the identity's balance is too low. Say so before signing, and put Platform's own refusal in plain
// words, as govhub's voting/funds.ts does.
import { errText } from '../lib/format.ts';

/** 1 DASH = 1e11 credits. A profile, listing or seat write costs about 0.0004 to 0.0006 DASH (measured on testnet). */
export const WRITE_CREDITS = 60_000_000n;

export class TopUpError extends Error {
  constructor(
    readonly balance: bigint,
    readonly required: bigint,
  ) {
    super(`Your account has ${(Number(balance) / 1e11).toFixed(5)} DASH of credit; this change needs about ${(Number(required) / 1e11).toFixed(5)} DASH. Top up from the account menu, then try again.`);
    this.name = 'TopUpError';
  }
}

/** Throws a TopUpError when the known balance cannot pay for a write (unknown balance: the write is tried). */
export function assertCanAffordWrite(balance: bigint | null): void {
  if (balance !== null && balance < WRITE_CREDITS) throw new TopUpError(balance, WRITE_CREDITS);
}

/** Platform's refusal for a too-small balance, as a TopUpError; anything else unchanged. */
export function topUpFromError(e: unknown): unknown {
  const m = /insufficient identity \S+ balance (\d+) required (\d+)/i.exec(errText(e));
  return m ? new TopUpError(BigInt(m[1]!), BigInt(m[2]!)) : e;
}
