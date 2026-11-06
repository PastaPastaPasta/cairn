// Statuses and names in words.
import { GROUP_STATUS, OPERATOR_STATUS, type Operator } from '@cairn/contract';
import { pct } from './money.ts';

export const GROUP_STATUS_WORDS: Record<number, string> = {
  [GROUP_STATUS.draft]: 'Draft',
  [GROUP_STATUS.forming]: 'Taking co-owners',
  [GROUP_STATUS.full]: 'Full, agreeing terms',
  [GROUP_STATUS.locked]: 'Terms locked',
  [GROUP_STATUS.formingOnchain]: 'Forming in Dash Core',
  [GROUP_STATUS.live]: 'Live (organizer says)',
  [GROUP_STATUS.dissolved]: 'Dissolved (organizer says)',
  [GROUP_STATUS.cancelled]: 'Closed',
};

export const OPERATOR_STATUS_WORDS: Record<number, string> = {
  [OPERATOR_STATUS.open]: 'Taking new groups',
  [OPERATOR_STATUS.full]: 'Full for now',
  [OPERATOR_STATUS.paused]: 'Paused',
};

/** An operator's own name, in quotes when it imitates a label Cairn adds. */
export const operatorName = (o: Pick<Operator, 'name' | 'nameSuspect'>) => (o.nameSuspect ? `“${o.name}”` : o.name);

export function rewardRange(o: Pick<Operator, 'rewardBps' | 'rewardMinBps' | 'rewardMaxBps'>): string {
  const lo = o.rewardMinBps ?? o.rewardBps;
  const hi = o.rewardMaxBps ?? o.rewardBps;
  return lo === hi ? pct(o.rewardBps) : `${pct(o.rewardBps)} (accepts ${pct(lo)} to ${pct(hi)})`;
}
