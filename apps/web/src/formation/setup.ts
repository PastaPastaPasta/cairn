// The coordinator's setup sheet: what to type on each page of Dash-Qt's "Shared Masternode" wizard, in its own page order and
// field names (src/qt/sharedmncreatedialog.cpp: Participants → Masternode settings → Exit terms → Your contribution → Invite
// participants → Approvals → Signatures → Shared masternode registered).
import { type TermSheet, formatDash } from '@cairn/shares';
import { percentString } from './cli.ts';

export interface SetupField {
  label: string;
  /** What to type or pick, as shown. */
  value: string;
  /** What the copy button copies (absent: nothing to copy). */
  copy?: string;
  hint?: string;
}

export interface SetupPage {
  id: string;
  /** The page title Dash-Qt shows. */
  title: string;
  /** How to get there, or what to press on it. */
  intro: string;
  fields: SetupField[];
  /** A table of rows (the Participants page). */
  rows?: Array<{ n: number; name: string; amount: string; me: boolean }>;
  notes: string[];
}

/** Dash-Qt's early-period presets (2.5 minutes a block: 576 a day). */
const PRESETS: Record<number, string> = { 0: 'None', 52560: '3 months', 105120: '6 months', 210240: '1 year', 420480: '2 years' };

const plainDash = (d: bigint) => formatDash(d);

export function setupSheet(terms: TermSheet, o: { operatorName?: string } = {}): SetupPage[] {
  const coordinator = terms.shares.find((s) => s.memberId === terms.coordinatorId);
  const n = terms.shares.length;
  const preset = PRESETS[terms.earlyPeriodBlocks];
  return [
    {
      id: 'start',
      title: 'Shared masternode',
      intro: 'In Dash-Qt, open the Masternodes tab and press “Shared Masternode…”, then “Start a Shared Masternode”.',
      fields: [],
      notes: [
        'Use the wallet that holds the coins for your own share: Dash-Qt lets only the wallet that started the session coordinate it.',
        'Dash-Qt only offers this once Dash Core v24 is active on the network.',
      ],
    },
    {
      id: 'participants',
      title: 'Participants',
      intro: `Press “Add Participant” until there are ${n} rows (or “Remove” extra ones), then type each name and amount exactly as below, in this order.`,
      fields: [],
      rows: terms.shares.map((s, i) => ({ n: i + 1, name: s.label, amount: plainDash(s.amount), me: s.memberId === terms.coordinatorId })),
      notes: [
        `Tick “Me” on your own row${coordinator ? ` (${coordinator.label})` : ''}.`,
        'Names must match exactly: everyone’s checker compares rows by name and amount. The meter under the table should read 1000 of 1000 ✓.',
      ],
    },
    {
      id: 'settings',
      title: 'Masternode settings',
      intro: 'These are the same for every participant.',
      fields: [
        terms.service
          ? { label: 'Service addresses', value: terms.service, copy: terms.service }
          : { label: 'Service addresses', value: 'Leave empty', hint: 'The operator sets it later with a service update; until then the masternode is banned and earns nothing.' },
        { label: 'Operator key', value: 'Choose “Use an existing operator public key” and paste:', hint: 'Never generate a key here unless you will run the node yourself.' },
        { label: 'Operator public key', value: terms.operatorPubKey, copy: terms.operatorPubKey },
        ...(o.operatorName ? [{ label: 'Node run by', value: o.operatorName, copy: o.operatorName, hint: 'Free text, for everyone’s information.' }] : []),
        { label: 'Voting address', value: terms.votingAddress, copy: terms.votingAddress },
        { label: 'Operator reward', value: `${percentString(terms.rewardBps)} %`, copy: percentString(terms.rewardBps), hint: 'Permanent for this masternode.' },
      ],
      notes: [],
    },
    {
      id: 'exit',
      title: 'Exit terms',
      intro: preset ? `Press the “${preset}” button, or type the number of blocks.` : 'Type the number of blocks.',
      fields: [
        { label: 'Early period', value: `${terms.earlyPeriodBlocks} blocks`, copy: String(terms.earlyPeriodBlocks) },
        { label: 'Early-exit penalty', value: `${plainDash(terms.earlyPenalty)} DASH`, copy: plainDash(terms.earlyPenalty) },
      ],
      notes: terms.earlyPeriodBlocks === 0 ? ['With no early period anyone can leave at any time, for only the network fee.'] : [],
    },
    {
      id: 'contribution',
      title: 'Your contribution',
      intro: 'Your own share: Cairn has nothing to fill in here, because these live only in your wallet.',
      fields: [
        { label: 'Owner, refund and reward address', value: 'Press “Use new address” for each', hint: 'Fresh addresses: the share table is public forever.' },
        { label: 'Network fee', value: 'Keep the default (0.001 DASH)', hint: 'You pay it on top of your share.' },
      ],
      notes: ['Press “Reserve Coins”. Dash-Qt sets the coins aside in your wallet until the session ends or you release them.'],
    },
    {
      id: 'invite',
      title: 'Invite participants',
      intro: 'Press “Copy Invitation” and paste it into Cairn’s checker below first: it should say “Safe to continue”. Then send the same invitation to everyone.',
      fields: [],
      notes: [
        'Each person sends back their Details. Paste each reply into Dash-Qt (“Paste” at the bottom).',
        'When every row is filled, press “Lock Terms”, then “Lock and Approve”. After that nobody can edit anything.',
      ],
    },
    {
      id: 'approvals',
      title: 'Approvals',
      intro: 'Press “Copy Locked Terms” and send it to everyone. Each person checks it and replies with their Approval.',
      fields: [],
      notes: ['Paste every Approval into Dash-Qt. When all are in, Dash-Qt moves on.'],
    },
    {
      id: 'signatures',
      title: 'Signatures',
      intro: 'Press “Copy Signing Request” and send it to everyone. Each person signs only their own coins and replies with their Signed Contribution.',
      fields: [],
      notes: ['Paste every Signed Contribution, then press “Broadcast Registration”.'],
    },
    {
      id: 'complete',
      title: 'Shared masternode registered',
      intro: 'Copy the ProTx hash and link it on Cairn (below) so everyone can see the registration verified against your approvals.',
      fields: [],
      notes: ['Save the Final Record, and create your standby dissolution once the masternode has one confirmation.'],
    },
  ];
}
