// Early-exit terms in plain language, and the rules a group's terms must meet as the organizer types them (DESIGN S2, S5).
import { MAX_EARLY_PERIOD_BLOCKS, MIN_SHARE_AMOUNT, isEarlyPenaltyValid, isEarlyPeriodValid } from '@cairn/shares';
import { dash, pct } from './money.ts';

/** Dash aims for one block every 2.5 minutes. */
export const BLOCKS_PER_DAY = 576;

export interface ExitPreset {
  id: string;
  label: string;
  blocks: number;
}
/** The early periods offered by name; 2 years is exactly Dash Core's cap (420,480 blocks). */
export const EXIT_PRESETS: readonly ExitPreset[] = [
  { id: 'none', label: 'No early period', blocks: 0 },
  { id: '3m', label: '3 months', blocks: 91 * BLOCKS_PER_DAY },
  { id: '6m', label: '6 months', blocks: 182 * BLOCKS_PER_DAY },
  { id: '1y', label: '1 year', blocks: 365 * BLOCKS_PER_DAY },
  { id: '2y', label: '2 years', blocks: 730 * BLOCKS_PER_DAY },
];

export const presetFor = (blocks: number): ExitPreset | undefined => EXIT_PRESETS.find((p) => p.blocks === blocks);

/** "3 months", or "about 40 days" for a period that is not a preset. */
export function periodWords(blocks: number): string {
  const p = presetFor(blocks);
  if (p) return p.blocks ? p.label : 'no early period';
  const days = Math.round(blocks / BLOCKS_PER_DAY);
  return days >= 1 ? `about ${days} ${days === 1 ? 'day' : 'days'}` : `${blocks} blocks`;
}

/** One line a member can read: what leaving early costs. */
export function exitWords(period: number, penalty: number): string {
  if (!period) return 'Anyone can leave at any time, with no penalty.';
  return `Leaving in the first ${periodWords(period)} costs ${dash(penalty)}, paid to the others. After that, anyone can leave at no cost.`;
}

/** Short form for lists. */
export function exitShort(period: number, penalty: number): string {
  return period ? `${dash(penalty)} to leave in the first ${periodWords(period)}` : 'Free to leave any time';
}

/**
 * Why these early-exit terms cannot be used with shares as small as `smallestShare` (duffs), or null. Dash Core's rules plus
 * Cairn's: a penalty exactly when there is an early period.
 */
export function exitProblem(period: number, penalty: number, smallestShare: number = Number(MIN_SHARE_AMOUNT)): string | null {
  if (!Number.isSafeInteger(period) || period < 0) return 'The early period must be a whole number of blocks.';
  if (period > MAX_EARLY_PERIOD_BLOCKS) return `The early period can be at most ${MAX_EARLY_PERIOD_BLOCKS.toLocaleString('en-US')} blocks (2 years).`;
  const p = isEarlyPeriodValid(period);
  if (!p.ok) return p.message;
  if (!Number.isSafeInteger(penalty) || penalty < 0) return 'Enter the penalty in DASH.';
  if (period === 0 && penalty > 0) return 'Without an early period there is nothing to penalise: set the penalty to 0.';
  if (period > 0 && penalty === 0) return 'Set a penalty for leaving early, or choose no early period (a zero penalty makes the period meaningless).';
  const pen = isEarlyPenaltyValid(period, BigInt(penalty), BigInt(smallestShare));
  if (!pen.ok) return `The penalty must be less than the smallest share (${dash(smallestShare)}).`;
  return null;
}

export interface Warning {
  id: string;
  text: string;
}

/** The warnings DESIGN S5 asks for, for the terms a group proposes. */
export function termWarnings(t: { earlyPeriodBlocks: number; rewardBps: number }): Warning[] {
  const out: Warning[] = [];
  if (!t.earlyPeriodBlocks)
    out.push({ id: 'free-exit', text: 'No early period: any co-owner can leave at any time without a penalty, and leaving dissolves the masternode for everyone. Your coins come back, but the node stops.' });
  out.push({
    id: 'reward-permanent',
    text: `The operator’s ${pct(t.rewardBps)} of the rewards is fixed when the masternode is registered. Changing it later means dissolving the masternode and forming it again.`,
  });
  return out;
}
