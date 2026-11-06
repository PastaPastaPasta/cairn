// The dash-cli path of DESIGN.md M9 (research doc §4): every command, in order, generated from the approved term sheet. What only a
// member's wallet knows (addresses, coins, change, signatures, transaction hex) is a named placeholder each member fills in.
// Shares are integer duffs and the operator reward a percent string with two decimals, as `protx shared_register_prepare` takes them.
import type { TermSheet } from '@cairn/shares';

/** A value the member fills in: rendered as <NAME>, quoted when it stands for a string. */
export interface Placeholder {
  ph: string;
  kind: 'string' | 'number';
}
export type Arg = string | number | Placeholder | Arg[] | { [k: string]: Arg };

export interface CliCommand {
  /** dash-cli method and sub-command words, e.g. ["protx", "shared_register_prepare"]. */
  method: string[];
  args: Arg[];
}

export interface CliStep {
  id: string;
  /** Who runs it: "Each member", "Coordinator", "Anyone", "Operator", or a member's label. */
  who: string;
  title: string;
  commands: CliCommand[];
  note?: string;
}

const ph = (name: string, kind: Placeholder['kind'] = 'string'): Placeholder => ({ ph: name, kind });
const isPh = (a: unknown): a is Placeholder => typeof a === 'object' && a !== null && 'ph' in a;

/** Integer basis points as the percent string the RPC parses ("5.00" for 500, "0.03" for 3). */
export function percentString(bps: number): string {
  if (!Number.isSafeInteger(bps) || bps < 0) throw new RangeError('basis points must be a non-negative integer');
  return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}`;
}

/** A shell-safe placeholder stem per share, from its label ("Alice" -> ALICE), or SHARE<n> when the label has no usable letters or repeats. */
export function shareTokens(terms: Pick<TermSheet, 'shares'>): string[] {
  const seen = new Set<string>();
  return terms.shares.map((s, i) => {
    let t = s.label
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase()
      .slice(0, 16);
    for (let n = i + 1; !t || /^\d/.test(t) || seen.has(t); n++) t = `SHARE${n}`;
    seen.add(t);
    return t;
  });
}

export function cliPlan(terms: TermSheet): CliStep[] {
  const tok = shareTokens(terms);
  const coordinatorIdx = terms.shares.findIndex((s) => s.memberId === terms.coordinatorId);
  const coordinator = coordinatorIdx >= 0 ? terms.shares[coordinatorIdx]!.label : 'The coordinator';
  const reward = percentString(terms.rewardBps);
  const sigs = tok.map((t, i) => ({ shareIndex: i, signature: ph(`${t}_SIGNATURE`) }));
  return [
    {
      id: 'addresses',
      who: 'Each member, in their own wallet',
      title: 'Make fresh addresses and pick your coins',
      commands: [
        { method: ['getnewaddress'], args: ['cairn-owner'] },
        { method: ['getnewaddress'], args: ['cairn-refund'] },
        { method: ['getnewaddress'], args: ['cairn-reward'] },
        { method: ['getnewaddress'], args: ['cairn-change'] },
        { method: ['listunspent'], args: [1] },
        { method: ['lockunspent'], args: ['false', [{ txid: ph('TXID'), vout: ph('VOUT', 'number') }]] },
      ],
      note:
        'The owner address must stay in this wallet: it signs your approval and any dissolution. Pick coins worth at least your share. Send the coordinator your owner, refund and (optional) reward address, the txid and vout of your coins, and your change address and amount. Never send keys.',
    },
    {
      id: 'funding',
      who: coordinator,
      title: 'Build the funding transaction (no collateral output)',
      commands: [
        {
          method: ['createrawtransaction'],
          args: [
            tok.map((t) => ({ txid: ph(`${t}_TXID`), vout: ph(`${t}_VOUT`, 'number') })),
            Object.fromEntries(tok.map((t) => [`<${t}_CHANGE_ADDRESS>`, ph(`${t}_CHANGE_DASH`, 'number')])),
          ],
        },
      ],
      note: `Inputs minus change must be exactly 1000 DASH plus the network fee (about 0.001 DASH), which ${coordinator} pays by leaving their own change that much smaller. Add one {"txid","vout"} entry per coin when a member uses several. Leave out a change entry when there is none.`,
    },
    {
      id: 'prepare',
      who: coordinator,
      title: 'Prepare the registration with the approved terms',
      commands: [
        {
          method: ['protx', 'shared_register_prepare'],
          args: [
            ph('FUNDING_TX'),
            terms.shares.map((s, i) => ({
              amount: Number(s.amount),
              refundAddress: ph(`${tok[i]}_REFUND_ADDRESS`),
              rewardAddress: ph(`${tok[i]}_REWARD_ADDRESS`),
              ownerAddress: ph(`${tok[i]}_OWNER_ADDRESS`),
            })),
            terms.service,
            terms.operatorPubKey,
            terms.votingAddress,
            reward,
            terms.earlyPeriodBlocks,
            Number(terms.earlyPenalty),
          ],
        },
      ],
      note: 'Leave out a "rewardAddress" to pay that share’s rewards to its refund address. The result’s "tx" is PREPARED_TX; send it to everyone. Its consentHash is what each member approves.',
    },
    {
      id: 'sign',
      who: 'Each member, in their own wallet',
      title: 'Check the terms, then approve your share',
      commands: [
        { method: ['decoderawtransaction'], args: [ph('PREPARED_TX')] },
        { method: ['protx', 'shared_sign'], args: [ph('PREPARED_TX')] },
      ],
      note: 'Before approving, check in the output that terms.shares has your amount with your owner, refund and reward addresses, and that the operator key, IP address, voting address, reward and exit terms are the approved ones; in decoderawtransaction, that your change output is there. Send back the {"shareIndex","signature"} entries.',
    },
    {
      id: 'combine',
      who: 'Anyone',
      title: 'Put every approval into the transaction',
      commands: [{ method: ['protx', 'shared_combine'], args: [ph('PREPARED_TX'), sigs] }],
      note: 'The result is COMBINED_TX. It needs an approval for every share.',
    },
    {
      id: 'fund',
      who: 'Each member, one after another',
      title: 'Sign your own coins',
      commands: [{ method: ['signrawtransactionwithwallet'], args: [ph('COMBINED_TX')] }],
      note: 'Pass the "hex" you get on to the next member, who signs that. The last member gets "complete": true. Never sign again after anything changed: every approval would break.',
    },
    {
      id: 'broadcast',
      who: 'Anyone',
      title: 'Broadcast the registration',
      commands: [{ method: ['sendrawtransaction'], args: [ph('SIGNED_TX')] }],
      note: 'The txid it returns is the masternode’s ProTx hash. Link it on Cairn.',
    },
    {
      id: 'standby',
      who: 'Each member, after one confirmation',
      title: 'Create your standby dissolutions',
      commands: [
        { method: ['protx', 'shared_dissolve'], args: [ph('PROTX_HASH'), ph('MY_SHARE_INDEX', 'number'), 100000, 'false', 'false'] },
        { method: ['protx', 'shared_dissolve'], args: [ph('PROTX_HASH'), ph('MY_SHARE_INDEX', 'number'), 100000, 'false', 'true'] },
      ],
      note: 'The first returns every principal and is valid once the early period ends; the second pays the early-exit penalty and is valid at once. Neither expires. Keep both offline with your refund-address backup.',
    },
    {
      id: 'operator',
      who: 'The operator',
      title: 'Start the node and get paid',
      commands: [{ method: ['protx', 'update_service'], args: [ph('PROTX_HASH'), terms.service || ph('IP:PORT'), ph('OPERATOR_BLS_SECRET'), ph('OPERATOR_PAYOUT_ADDRESS'), ph('FEE_SOURCE_ADDRESS')] }],
      note: 'First put masternodeblsprivkey=<OPERATOR_BLS_SECRET> in the node’s dash.conf and restart it. Without an operator payout address the operator reward is not paid at all: the owners keep it.',
    },
  ];
}

// ---- rendering -----------------------------------------------------------------------------------------------------------------

function json(a: Arg): string {
  if (isPh(a)) return a.kind === 'number' ? `<${a.ph}>` : `"<${a.ph}>"`;
  if (Array.isArray(a)) return `[${a.map(json).join(',')}]`;
  if (typeof a === 'object') return `{${Object.entries(a).map(([k, v]) => `${JSON.stringify(k)}:${json(v)}`).join(',')}}`;
  return JSON.stringify(a);
}

/** One shell argument: JSON in single quotes, strings in double quotes (none of ours contain quotes), numbers bare. */
function shellArg(a: Arg): string {
  if (isPh(a)) return a.kind === 'number' ? `<${a.ph}>` : `"<${a.ph}>"`;
  if (typeof a === 'number') return String(a);
  if (typeof a === 'string') return /^(true|false)$/.test(a) ? a : JSON.stringify(a);
  return `'${json(a)}'`;
}

export const cliPrefix = (network: TermSheet['network']) => (network === 'main' ? 'dash-cli' : `dash-cli -${network === 'test' ? 'testnet' : network}`);

export function renderCommand(c: CliCommand, network: TermSheet['network']): string {
  return [cliPrefix(network), ...c.method, ...c.args.map(shellArg)].join(' ');
}

export function renderPlan(steps: readonly CliStep[], network: TermSheet['network']): string {
  return steps.map((s) => [`# ${s.who}: ${s.title}`, ...s.commands.map((c) => renderCommand(c, network))].join('\n')).join('\n\n');
}

/**
 * The command's arguments with placeholders filled in (a null fill drops that object key, as when a member leaves out a reward
 * address), as dash-cli would parse them: what the tests compare with real RPC calls.
 */
export function fillArgs(c: CliCommand, fill: Record<string, string | number | null>): unknown[] {
  const val = (p: Placeholder) => {
    if (!(p.ph in fill)) throw new Error(`no value for <${p.ph}>`);
    return fill[p.ph];
  };
  const go = (a: Arg): unknown => {
    if (isPh(a)) return val(a);
    if (Array.isArray(a)) return a.map(go);
    if (typeof a === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a)) {
        const key = /^<(.+)>$/.test(k) ? String(val(ph(k.slice(1, -1)))) : k;
        const x = go(v);
        if (x !== null) out[key] = x;
      }
      return out;
    }
    return a;
  };
  return c.args.map(go);
}
