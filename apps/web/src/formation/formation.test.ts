import { readFileSync } from 'node:fs';
import { GROUP_STATUS, MN_TYPE, termSheetFromGroup, type Approval, type Group } from '@cairn/contract';
import { COIN, decodeSharedProRegTx, termsHash, validateTermSheet, type TermSheet } from '@cairn/shares';
import { describe, expect, it } from 'vitest';
import { agreementOf } from '../matching/agreement.ts';
import { linkedProTx } from '../matching/group.ts';
import { checkMessage, outsiderOf } from './checker.ts';
import { cliPlan, fillArgs, percentString, renderPlan, shareTokens } from './cli.ts';
import { earlyView, labelChainShares, rewardSplit } from './live.ts';
import { setupSheet } from './setup.ts';
import { OP_ACCEPT_STATUS } from '@cairn/contract';
import { AGREE_MARGIN_MS, judgeRegistration, mnStateOf, operatorKeyPublishedAt, type ChainFacts } from './verify.ts';

// biome-ignore lint: fixture JSON
type J = any;
const vectors = new URL('../../../../packages/shares/test/vectors/', import.meta.url);
const load = (name: string): J => JSON.parse(readFileSync(new URL(`regtest/${name}`, vectors), 'utf8'));
const ENVS: Array<{ name: string; text: string; fingerprint: string }> = load('envelopes.json');
const A: J = load('mn-a.json');
const env = (name: string): string => ENVS.find((e) => e.name === name)!.text;
const D400 = readFileSync(new URL('testnet-d400c120.hex', vectors), 'utf8').trim();
const D400_HASH = 'd400c12078251aa1320315a683291667beb3b585a5e0c2609919df27aab674e6';

const termsA: TermSheet = {
  network: 'regtest',
  groupId: 'group-1',
  revision: 2,
  shares: [
    { memberId: 'id-alice', label: 'Alice', amount: 500n * COIN },
    { memberId: 'id-bob', label: 'Bob', amount: 300n * COIN },
    { memberId: 'id-carol', label: 'Carol', amount: 200n * COIN },
  ],
  operatorPubKey: A.operator.public,
  service: '127.0.0.1:20001',
  votingAddress: A.operator.votingAddress,
  votingHolderId: 'id-alice',
  rewardBps: 500,
  earlyPeriodBlocks: 30,
  earlyPenalty: 50n * COIN,
  coordinatorId: 'id-alice',
};
const owner = (i: number): string => A.prepareArgs.shares[i].ownerAddress;
const chainSharesA = decodeSharedProRegTx(A.final).payload.shares;

// The real testnet shared masternode d400c120 (500/300/200, built by the Qt wizard), as a Cairn group.
const ALICE = '5YAVcQVGhDqf9ZZRVXJnk223ebaPt3gUVqFWGqvq3urW';
const BOB = 'TCzHeAhp1QRqW4wuZzZrs4wiBR3m3vnQDxJsbk1uFWd';
const CAROL = '4EfA9Jrvv3nnCFdSf7fad59851iiTRZ6Wcu6YVJ4iSeF';
const GROUP_ID = '9Zv3f6uyGfrnCsqNLUajVmJ5AWwjKLwpt31sBQZm3TUz';
const d400Group = (patch: Partial<Group> = {}): Group => {
  const g: Group = {
    id: GROUP_ID, ownerId: ALICE, docRevision: 1, termsRevision: 1, title: 'd400', mnType: MN_TYPE.regular, operatorId: CAROL, rewardBps: 300, earlyPeriodBlocks: 52560,
    earlyPenalty: 5 * 100_000_000, coordinatorId: ALICE, votingHolderId: ALICE,
    roster: [{ id: ALICE, amount: 500e8, label: 'Alice' }, { id: BOB, amount: 300e8, label: 'Bob' }, { id: CAROL, amount: 200e8, label: 'Carol' }],
    operatorPubKey: '8ca1de0998a6d21724322b77bbe0adcb524c0aa276a6554a1fc66993b63aff8a327b5ebef76e83a6ccaeac3d9ff5f1c6',
    votingAddress: 'ygtn5nLwguprM3A49sjSzhZrHjUMqVywby', status: GROUP_STATUS.live, proTxHash: D400_HASH, ...patch,
  };
  const sheet = termSheetOf(g);
  return { ...g, lockedHash: patch.lockedHash ?? (validateTermSheet(sheet).length ? undefined : termsHash(sheet)) };
};
const termSheetOf = (g: Group) => termSheetFromGroup(g.id, g, 'testnet');
/** The registration block's time in the fixtures (s); approvals and the key are recorded an hour before it unless a test says otherwise. */
const BLOCK_T = 1_792_900_000;
const BEFORE = (BLOCK_T - 3600) * 1000;
const approvalsFor = (g: Group, patch: (a: Approval) => Approval = (a) => a): Approval[] =>
  g.roster.map((r, i) => patch({ id: `ap${i}`, ownerId: r.id, docRevision: 1, createdAt: BEFORE + i, termsRevision: g.termsRevision, groupId: g.id, termsHash: g.lockedHash!, shareAmount: r.amount }));
const facts = (patch: Partial<ChainFacts> = {}): ChainFacts => ({
  proTxHash: D400_HASH, hex: D400, height: 1583318, blockTime: BLOCK_T, mined: true, chainLocked: 'verified', trust: 'quorum-proof', weak: null, tip: 1586757, mn: { isValid: false }, listTrust: 'proven', notes: [], ...patch,
});

describe('message checker, standalone', () => {
  it('names every session stage, its round and Dash Core’s verdict, and never calls it safe without agreed terms', () => {
    const expected: Record<string, [string, number]> = {
      'draft-invitation': ['Invitation', 1], 'draft-complete': ['Invitation', 1], frozen: ['Locked Terms', 2], signing: ['Locked Terms', 2],
      combined: ['Signing Request', 3], fundingSigned: ['Signed Contribution', 3], broadcast: ['Final Record', 4],
    };
    for (const [name, [title, round]] of Object.entries(expected)) {
      const v = checkMessage(env(name));
      expect(v.kind, name).toBe('session');
      expect(v.title, name).toBe(title);
      expect(v.round, name).toBe(round);
      expect(v.verdict, name).toBe('neutral');
      expect(v.findings.map((f) => f.code)).toContain('core-ok');
      expect(v.facts.find((f) => f.label === 'Message code')!.value).toBe(ENVS.find((e) => e.name === name)!.fingerprint);
    }
  });

  it('reports rows filled, approvals and signed coins', () => {
    const fact = (name: string, label: string) => checkMessage(env(name)).facts.find((f) => f.label === label)?.value;
    expect(fact('draft-invitation', 'Rows filled')).toBe('1 of 3');
    expect(fact('draft-complete', 'Rows filled')).toBe('3 of 3');
    expect(fact('frozen', 'Approvals')).toBe('0 of 3 valid');
    expect(fact('signing', 'Approvals')).toBe('1 of 3 valid');
    expect(fact('frozen', 'Message')).toBe('Locked Terms (members reply with an Approval)');
    expect(fact('combined', 'Approvals')).toBe('3 of 3 valid');
    expect(fact('combined', 'Coins signed')).toBe('0 of 3 funding inputs');
    expect(fact('fundingSigned', 'Coins signed')).toBe('3 of 3 funding inputs');
  });

  it('stops on a tampered message and warns on an edited one', () => {
    const tampered = env('frozen').replace('"amount": 30000000000', '"amount": 30100000000').replace('"amount": 20000000000', '"amount": 19900000000');
    const v = checkMessage(tampered);
    expect(v.verdict).toBe('stop');
    expect(v.verdictTitle).toBe('Stop — don’t sign');
    const edited = env('draft-invitation').replace('"revision": 4', '"revision": 5');
    expect(checkMessage(edited).findings.map((f) => f.code)).toContain('fingerprint-mismatch');
  });

  it('asks to check an edited message, even with nothing agreed to compare with', () => {
    const edited = env('frozen').replace(/"fingerprint": "[0-9A-F]{4}-[0-9A-F]{4}"/, '"fingerprint": "AAAA-BBBB"');
    const v = checkMessage(edited);
    expect(v.verdict).toBe('warn');
    expect(v.verdictTitle).toBe('Check this');
    expect(v.next.join(' ')).not.toMatch(/Approve and Copy Reply/);
  });

  it('only says “Approve and Copy Reply” for a message checked safe against the approved terms', () => {
    for (const name of ['frozen', 'signing', 'combined']) {
      const v = checkMessage(env(name));
      expect(v.verdict, name).toBe('neutral');
      expect(v.verdictTitle).toBe('Valid in Dash Core, not compared with agreed terms');
      expect(v.next.join(' '), name).not.toMatch(/Approve and Copy Reply|Sign and Copy Reply/);
    }
    expect(checkMessage(env('sigs-dissolve-request')).next.join(' ')).not.toMatch(/Approve and Copy Reply/);
  });

  it('only says “Reserve Coins and Copy Details” for an Invitation checked safe against the approved terms', () => {
    const reserve = /Reserve Coins and Copy Details/;
    expect(checkMessage(env('draft-invitation')).verdict).toBe('neutral');
    expect(checkMessage(env('draft-invitation')).next.join(' ')).not.toMatch(reserve);
    const edited = checkMessage(env('draft-invitation').replace(/"fingerprint": "[0-9A-F]{4}-[0-9A-F]{4}"/, '"fingerprint": "AAAA-BBBB"'));
    expect(edited.verdict).toBe('warn');
    expect(edited.next.join(' ')).not.toMatch(reserve);
    expect(edited.next.join(' ')).toMatch(/before you reserve coins or send your details/);
    const safe = checkMessage(env('draft-invitation'), { terms: termsA, myLabel: 'Alice', myOwnerAddress: owner(0) });
    expect(safe.verdict).toBe('ok');
    expect(safe.next.join(' ')).toMatch(reserve);
  });

  it('stops on a message for another network than the site’s', () => {
    const v = checkMessage(env('frozen'), { network: 'test' });
    expect(v.verdict).toBe('stop');
    expect(v.findings.find((x) => x.code === 'wrong-network')!.title).toBe('Wrong network: this message is for Regtest, and this site is on Testnet');
    expect(v.facts.find((x) => x.label === 'Network')!.tone).toBe('stop');
    expect(checkMessage(env('frozen'), { network: 'regtest' }).verdict).toBe('neutral');
    expect(checkMessage(env('sigs-dissolve-request'), { network: 'test' }).findings.map((x) => x.code)).toContain('wrong-network');
  });

  it('calls a cut-off or damaged message damaged, not out of date', () => {
    const typeOnly = checkMessage('{"type":"dash-shared-mn-session"}', { network: 'test' });
    expect(typeOnly.verdict).toBe('stop');
    expect(typeOnly.summary).toMatch(/incomplete or damaged/);
    expect(typeOnly.summary).not.toMatch(/Update Dash Core/);
    const noNetwork = checkMessage(env('frozen').replace(/\s*"network": "regtest",/, ''), { network: 'test' });
    expect(noNetwork.summary).toMatch(/incomplete or damaged/);
    expect(noNetwork.summary).not.toMatch(/unknown/);
    expect(checkMessage(env('frozen').replace('"version": 1', '"version": 2')).summary).toMatch(/newer version of Dash Core/);
  });

  it('refuses what is not a message', () => {
    expect(checkMessage('').kind).toBe('empty');
    expect(checkMessage('hello').kind).toBe('unknown');
    expect(checkMessage('{"type":"something"}').verdict).toBe('stop');
  });
});

describe('message checker, against the approved terms', () => {
  it('is safe once my row is bound by my owner address, and asks for it before', () => {
    const bound = checkMessage(env('frozen'), { terms: termsA, myLabel: 'Bob', myOwnerAddress: owner(1) });
    expect(bound.verdict).toBe('ok');
    expect(bound.verdictTitle).toBe('Safe to continue');
    expect(bound.rows.filter((r) => r.mine).map((r) => r.label)).toEqual(['Bob']);
    const unbound = checkMessage(env('frozen'), { terms: termsA, myLabel: 'Bob' });
    expect(unbound.verdict).toBe('warn');
    expect(unbound.findings.map((f) => f.code)).toContain('my-row-unbound');
  });

  it('stops on a row swap: my owner address on someone else’s share', () => {
    const text = env('draft-complete');
    const swapped = text.split(owner(0)).join('@@').split(owner(1)).join(owner(0)).split('@@').join(owner(1));
    const v = checkMessage(swapped, { terms: termsA, myLabel: 'Bob', myOwnerAddress: owner(1) });
    expect(v.verdict).toBe('stop');
    expect(v.findings.find((f) => f.code === 'my-row-moved')!.title).toMatch(/Your owner address is on someone else.s share/);
  });

  it('downgrades a match to “Check this” for a reader who is not on the group’s roster', () => {
    const title = 'You are not on this group’s roster — this compares with someone else’s agreement';
    for (const outsider of ['signed-out', 'not-member'] as const) {
      const v = checkMessage(env('frozen'), { terms: termsA, myLabel: 'Bob', myOwnerAddress: owner(1), outsider });
      expect(v.verdict, outsider).toBe('warn');
      expect(v.findings.find((f) => f.code === 'not-on-roster')!.title).toBe(title);
      expect(v.next.join(' ')).not.toMatch(/Approve and Copy Reply/);
      const invite = checkMessage(env('draft-invitation'), { terms: termsA, outsider });
      expect(invite.verdict).toBe('warn');
      expect(invite.next.join(' ')).not.toMatch(/Reserve Coins and Copy Details/);
      const reg = checkMessage(A.combined, { terms: termsA, myLabel: 'Bob', myOwnerAddress: owner(1), outsider });
      expect(reg.verdict).toBe('warn');
      expect(reg.findings.map((f) => f.code)).toContain('not-on-roster');
    }
    expect(checkMessage(env('frozen'), { terms: termsA, myLabel: 'Bob', myOwnerAddress: owner(1), outsider: 'signed-out' }).findings.find((f) => f.code === 'not-on-roster')!.detail).toMatch(/Sign in/);
    // a mismatch stays a stop
    expect(checkMessage(env('frozen'), { terms: { ...termsA, rewardBps: 400 }, outsider: 'not-member' }).verdict).toBe('stop');
    // without terms there is nothing to downgrade
    expect(checkMessage(env('frozen'), { outsider: 'not-member' }).findings.map((f) => f.code)).not.toContain('not-on-roster');
  });

  it('counts the roster and the group’s operator as parties to its terms, everyone else as an outsider', () => {
    const g = { roster: [{ id: 'id-alice' }, { id: 'id-bob' }], operatorId: 'id-op' };
    expect(outsiderOf(g, 'id-bob')).toBeUndefined();
    expect(outsiderOf(g, 'id-op')).toBeUndefined();
    expect(outsiderOf(g, 'id-eve')).toBe('not-member');
    expect(outsiderOf(g, null)).toBe('signed-out');
    expect(outsiderOf({ roster: g.roster }, undefined)).toBe('signed-out');
  });

  it('stops when a row’s addresses changed since an earlier message of the session', () => {
    const first = checkMessage(env('draft-complete'), { terms: termsA, myLabel: 'Alice', myOwnerAddress: owner(0) });
    const swapped = env('draft-complete').split(owner(1)).join(owner(2).replace(/.$/, 'X'));
    const v = checkMessage(swapped, { terms: termsA, myLabel: 'Alice', myOwnerAddress: owner(0), rowAddresses: first.session!.rows });
    expect(v.findings.map((f) => f.code)).toContain('row-owner-changed');
    expect(v.verdict).toBe('stop');
  });

  it('stops on terms that differ from the approval', () => {
    const v = checkMessage(env('frozen'), { terms: { ...termsA, rewardBps: 400 }, myLabel: 'Bob', myOwnerAddress: owner(1) });
    expect(v.verdict).toBe('stop');
    expect(v.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['operator-reward', 'tx-reward']));
  });

  it('checks a registration hex: the real testnet d400c120 against its terms', () => {
    const g = d400Group();
    const v = checkMessage(D400, { terms: termSheetOf(g) });
    expect(v.kind).toBe('registration');
    expect(v.verdict).toBe('warn');
    expect(v.findings.find((f) => f.level === 'warn')!.code).toBe('no-service');
    expect(checkMessage(D400, { terms: termSheetOf(d400Group({ rewardBps: 500 })) }).verdict).toBe('stop');
  });
});

describe('review regressions', () => {
  it('binds a registration hex to my owner key: a swapped share is a stop, an unbound one a warning', () => {
    const base = { terms: termsA, myLabel: 'Bob' };
    expect(checkMessage(A.combined, { ...base, myOwnerAddress: owner(1) }).verdict).toBe('ok');
    const swapped = checkMessage(A.combined, { ...base, myOwnerAddress: owner(0) });
    expect(swapped.verdict).toBe('stop');
    expect(swapped.findings.map((f) => f.code)).toContain('owner-amount');
    expect(checkMessage(A.combined, base).findings.map((f) => f.code)).toContain('my-share-unbound');
  });

  it('reads the prepared transaction (placeholder approvals) as waiting, not as a stop', () => {
    const v = checkMessage(A.prepared.tx, { terms: termsA, myLabel: 'Bob', myOwnerAddress: owner(1) });
    expect(v.verdict).toBe('ok');
    expect(v.findings.find((f) => f.code === 'join-sigs')!.level).toBe('info');
    expect(checkMessage(A.prepared.tx).verdict).toBe('neutral');
  });

  it('never calls an approvals message without its transaction safe; a key rotation always asks to confirm the keys', () => {
    const noTx = JSON.stringify({ type: 'dash-shared-mn-sigs', version: 1, network: 'regtest', kind: 'registrar', proTxHash: A.proTxHash, signatures: [] });
    expect(checkMessage(noTx, { chainShares: chainSharesA, proTxHash: A.proTxHash }).verdict).toBe('stop');
    expect(checkMessage(env('sigs-registrar'), { chainShares: chainSharesA, proTxHash: A.proTxHash }).verdict).toBe('warn');
  });

  it('stops on a standby file of unsigned requests', () => {
    const request = JSON.parse(env('sigs-dissolve-request')).tx as string;
    const v = checkMessage(`FULL PRINCIPAL — valid from block 142\n${request}\n\nIMMEDIATE — pays the penalty\n${A.standby.immediate}`, { chainShares: chainSharesA, proTxHash: A.proTxHash });
    expect(v.verdict).toBe('stop');
    expect(v.findings.map((f) => f.code)).toContain('standby-unsigned');
  });

  it('keeps placeholder names distinct when a label looks like a fallback', () => {
    expect(shareTokens({ shares: [{ label: 'Share2' }, { label: '😀' }, { label: '' }] as never })).toEqual(['SHARE2', 'SHARE3', 'SHARE4']);
  });

  it('is not verified on a weak chain proof', () => {
    const g = d400Group();
    expect(judgeRegistration(agreementOf(g, approvalsFor(g), 'testnet'), facts({ weak: 'testnet proof of work' })).state).toBe('unproven');
  });
});

describe('maintenance messages', () => {
  it('checks a dissolve-together request against the registered share table', () => {
    expect(checkMessage(env('sigs-dissolve-request')).verdict).toBe('neutral');
    const v = checkMessage(env('sigs-dissolve'), { chainShares: chainSharesA, proTxHash: A.proTxHash });
    expect(v.kind).toBe('sigs');
    expect(v.verdict).toBe('ok');
    expect(v.findings.map((f) => f.code)).toContain('returns-principal');
    expect(checkMessage(env('sigs-dissolve'), { chainShares: chainSharesA, proTxHash: 'aa'.repeat(32) }).verdict).toBe('stop');
  });

  it('reads a key rotation request', () => {
    const v = checkMessage(env('sigs-registrar'), { chainShares: chainSharesA, proTxHash: A.proTxHash });
    expect(v.title).toBe('Request to change the operator or voting key');
    expect(v.facts.map((f) => f.label)).toContain('New voting address');
  });

  it('reads a standby dissolution file as Dash-Qt writes it', () => {
    const file = [
      'Dash shared masternode — standby dissolution',
      `Masternode: ${A.proTxHash}`,
      'Share: 3',
      'Created: 2026-11-06',
      '',
      'Each block below is a complete signed transaction. Broadcast one of them with sendrawtransaction.',
      '',
      'FULL PRINCIPAL — valid from block 142 (~1 hour)',
      A.standby.full,
      '',
      'IMMEDIATE — pays the 50 DASH early-exit penalty, valid right away',
      A.standby.immediate,
    ].join('\n');
    const v = checkMessage(file, { chainShares: chainSharesA, proTxHash: A.proTxHash });
    expect(v.kind).toBe('standby');
    expect(v.facts.find((f) => f.label === 'Full principal valid from')!.value).toBe('block 142');
    expect(v.findings.filter((f) => f.level === 'stop')).toEqual([]);
    expect(v.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['keep-private', 'dissolve-principal', 'dissolve-sigs']));
    expect(checkMessage(A.standby.full).kind).toBe('dissolution');
  });
});

describe('dash-cli commands', () => {
  it('writes the operator reward as a two-decimal percent string', () => {
    expect([0, 3, 300, 500, 1250, 10000].map(percentString)).toEqual(['0.00', '0.03', '3.00', '5.00', '12.50', '100.00']);
  });

  it('names placeholders after labels, safely', () => {
    expect(shareTokens({ shares: [{ label: 'Alice' }, { label: "Zoë's ✓" }, { label: '!!' }, { label: 'alice' }] as never })).toEqual(['ALICE', 'ZOE_S', 'SHARE3', 'SHARE4']);
  });

  it('fills to exactly the arguments the real dashd 24.0.0 regtest run used', () => {
    const plan = cliPlan(termsA);
    const fill: Record<string, string | number | null> = { FUNDING_TX: A.fundingTx };
    ['ALICE', 'BOB', 'CAROL'].forEach((t, i) => {
      const s = A.prepareArgs.shares[i];
      Object.assign(fill, { [`${t}_OWNER_ADDRESS`]: s.ownerAddress, [`${t}_REFUND_ADDRESS`]: s.refundAddress, [`${t}_REWARD_ADDRESS`]: s.rewardAddress ?? null });
      const c = A.contributions[i];
      Object.assign(fill, { [`${t}_TXID`]: c.inputs[0].txid, [`${t}_VOUT`]: c.inputs[0].vout, [`${t}_CHANGE_ADDRESS`]: c.change.address, [`${t}_CHANGE_DASH`]: c.change.amount / 1e8 });
    });
    const prepare = plan.find((s) => s.id === 'prepare')!.commands[0]!;
    expect(prepare.method).toEqual(['protx', 'shared_register_prepare']);
    const p = A.prepareArgs;
    expect(fillArgs(prepare, fill)).toEqual([p.fundingTx, p.shares, p.coreP2PAddrs, p.operatorPubKey, p.votingAddress, p.operatorReward, p.earlyPeriodBlocks, p.earlyPenalty]);
    const [inputs, outputs] = fillArgs(plan.find((s) => s.id === 'funding')!.commands[0]!, fill) as [unknown[], Record<string, number>];
    expect(inputs).toEqual(A.fundingDecoded.vin.map((i: J) => ({ txid: i.txid, vout: i.vout })));
    expect(Object.entries(outputs).map(([a, v]) => [a, Math.round(v * 1e8)])).toEqual(A.fundingDecoded.vout.map((o: J) => [o.scriptPubKey.address ?? o.scriptPubKey.addresses?.[0], o.valueSat]));
    const combine = fillArgs(plan.find((s) => s.id === 'combine')!.commands[0]!, { PREPARED_TX: A.prepared.tx, ALICE_SIGNATURE: A.signatures[0].signature, BOB_SIGNATURE: A.signatures[1].signature, CAROL_SIGNATURE: A.signatures[2].signature });
    expect(combine).toEqual([A.prepared.tx, A.signatures]);
  });

  it('renders the whole sequence for the d400c120 terms', () => {
    const terms = termSheetOf(d400Group());
    expect(renderPlan(cliPlan(terms), terms.network)).toMatchSnapshot();
  });
});

describe('coordinator setup sheet', () => {
  it('follows Dash-Qt’s page order and fields', () => {
    const pages = setupSheet(termSheetOf(d400Group()), { operatorName: 'Carol' });
    expect(pages.map((p) => p.title)).toEqual([
      'Shared masternode', 'Participants', 'Masternode settings', 'Exit terms', 'Your contribution', 'Invite participants', 'Approvals', 'Signatures', 'Shared masternode registered',
    ]);
    expect(pages[1]!.rows).toEqual([
      { n: 1, name: 'Alice', amount: '500', me: true },
      { n: 2, name: 'Bob', amount: '300', me: false },
      { n: 3, name: 'Carol', amount: '200', me: false },
    ]);
    const settings = Object.fromEntries(pages[2]!.fields.map((f) => [f.label, f.copy ?? f.value]));
    expect(settings).toMatchObject({ 'Service addresses': 'Leave empty', 'Voting address': 'ygtn5nLwguprM3A49sjSzhZrHjUMqVywby', 'Operator reward': '3.00', 'Node run by': 'Carol' });
    expect(pages[3]!.intro).toContain('“3 months”');
    expect(pages[3]!.fields.map((f) => f.copy)).toEqual(['52560', '5']);
  });
});

describe('agreement and registration (M10)', () => {
  it('builds the term sheet from the group in roster order', () => {
    const t = termSheetOf(d400Group());
    expect(t.shares.map((s) => [s.label, s.amount])).toEqual([['Alice', 500n * COIN], ['Bob', 300n * COIN], ['Carol', 200n * COIN]]);
    expect(t).toMatchObject({ network: 'test', service: '', rewardBps: 300, earlyPenalty: 5n * COIN });
    const incomplete = d400Group({ votingAddress: undefined, lockedHash: 'aa'.repeat(32) });
    expect(agreementOf(incomplete, approvalsFor(incomplete), 'testnet')).toMatchObject({ terms: null, hash: null, anchored: false });
  });

  it('is verified only when every approval names the locked hash and the chain matches', () => {
    const g = d400Group();
    const ok = judgeRegistration(agreementOf(g, approvalsFor(g), 'testnet'), facts(), BEFORE);
    expect(ok.state).toBe('verified');
    expect(ok.headline).toBe('Registration verified');
    // d400c120 was registered without a service: banned until the operator's service update, not "live"
    expect(ok.mnState).toBe('no-service');
    const missing = agreementOf(g, approvalsFor(g).slice(0, 2), 'testnet');
    expect(judgeRegistration(missing, facts()).state).toBe('mismatch');
    const other = agreementOf(g, approvalsFor(g, (a) => (a.ownerId === BOB ? { ...a, termsHash: 'ab'.repeat(32) } : a)), 'testnet');
    expect(judgeRegistration(other, facts()).problems.join(' ')).toMatch(/Bob approved different terms/);
  });

  it('shows a clear mismatch when the group’s terms differ from the chain', () => {
    const g = d400Group({ earlyPenalty: 6e8 });
    const j = judgeRegistration(agreementOf(g, approvalsFor(g), 'testnet'), facts());
    expect(j.state).toBe('mismatch');
    expect(j.problems.join(' ')).toMatch(/early-exit terms/);
  });

  it('notices terms edited after lock', () => {
    const g = d400Group();
    const edited = { ...g, rewardBps: 400 };
    const a = agreementOf(edited, approvalsFor(g), 'testnet');
    expect(a.lockedHashOk).toBe(false);
    expect(judgeRegistration(a, facts()).state).toBe('mismatch');
  });

  it('counts a match as verified only when it was agreed before it was registered (F-003)', () => {
    const g = d400Group();
    const a = agreementOf(g, approvalsFor(g), 'testnet');
    // the testnet demo: someone else's registered masternode, its public terms copied into a group and approved afterwards
    const copied = agreementOf(g, approvalsFor(g, (x) => (x.ownerId === BOB ? { ...x, createdAt: (BLOCK_T + 86_400) * 1000 } : x)), 'testnet');
    const late = judgeRegistration(copied, facts(), BEFORE);
    expect(late.state).toBe('recorded-after');
    expect(late.headline).toBe('Registration matches these terms, but they were recorded after it was registered');
    expect(late.detail).toMatch(/Bob’s approval was not on Cairn 15 minutes before it was registered/);
    expect(late.problems).toEqual([]);
    expect(judgeRegistration(a, facts(), (BLOCK_T + 1) * 1000)).toMatchObject({ state: 'recorded-after', detail: expect.stringMatching(/the operator’s key was not on Cairn/) });
    expect(judgeRegistration(a, facts()).state).toBe('recorded-after');
    expect(judgeRegistration(a, facts({ blockTime: null }), BEFORE).state).toBe('unproven');
  });

  it('needs everything on Cairn at least 15 minutes before the registration’s block (mempool copies, block-time drift)', () => {
    const g = d400Group();
    const at = (ms: number) => agreementOf(g, approvalsFor(g, (x) => (x.ownerId === BOB ? { ...x, createdAt: ms } : x)), 'testnet');
    const cutoff = BLOCK_T * 1000 - AGREE_MARGIN_MS;
    expect(AGREE_MARGIN_MS).toBe(15 * 60_000);
    expect(judgeRegistration(at(cutoff), facts(), BEFORE).state).toBe('verified');
    // approved while the registration waited in the mempool: before its block, but too close to it
    const copied = judgeRegistration(at(cutoff + 1), facts(), BEFORE);
    expect(copied.state).toBe('recorded-after');
    expect(copied.detail).toMatch(/Bob’s approval was not on Cairn 15 minutes before it was registered/);
    expect(judgeRegistration(at(BEFORE), facts(), cutoff).state).toBe('verified');
    expect(judgeRegistration(at(BEFORE), facts(), cutoff + 1)).toMatchObject({ state: 'recorded-after', detail: expect.stringMatching(/the operator’s key was not on Cairn/) });
  });

  it('dates the operator’s key by the first member approval of the locked terms, which cover the key', () => {
    const g = d400Group();
    const answer = { id: 'oa', ownerId: CAROL, docRevision: 2, groupId: g.id, status: OP_ACCEPT_STATUS.accepted, rewardBps: 300, operatorPubKey: g.operatorPubKey, createdAt: BEFORE - 5, updatedAt: BEFORE - 1 };
    expect(operatorKeyPublishedAt(g, [answer], approvalsFor(g))).toBe(BEFORE);
    // member-led: the operator editing their answer's message after registration does not make the key late
    expect(operatorKeyPublishedAt(g, [{ ...answer, updatedAt: (BLOCK_T + 86_400) * 1000 }], approvalsFor(g))).toBe(BEFORE);
    // but their accepted answer must carry that key
    expect(operatorKeyPublishedAt(g, [{ ...answer, operatorPubKey: 'ab'.repeat(48) }], approvalsFor(g))).toBeNull();
    expect(operatorKeyPublishedAt(g, [{ ...answer, status: OP_ACCEPT_STATUS.withdrawn }], approvalsFor(g))).toBeNull();
    expect(operatorKeyPublishedAt(g, [], approvalsFor(g))).toBeNull();
    // approvals of another revision, of other terms, or by someone off the roster do not date it
    const others = approvalsFor(g, (x) => (x.ownerId === BOB ? { ...x, termsRevision: g.termsRevision - 1, createdAt: 1 } : x.ownerId === CAROL ? { ...x, termsHash: 'ab'.repeat(32), createdAt: 2 } : x));
    expect(operatorKeyPublishedAt(g, [answer], [...others, { ...others[0]!, id: 'x', ownerId: 'stranger', createdAt: 3 }])).toBe(BEFORE);
    expect(operatorKeyPublishedAt(g, [answer], [])).toBeNull();
    const opLed = { ...g, ownerId: CAROL };
    expect(operatorKeyPublishedAt(opLed, [], approvalsFor(opLed))).toBe(BEFORE);
  });

  it('tells earning from not earning, and why', () => {
    expect(mnStateOf(facts({ mn: { isValid: true } })).state).toBe('valid');
    expect(mnStateOf(facts()).state).toBe('no-service');
    // a registration with a service that the network banned
    expect(mnStateOf(facts({ hex: A.final, mn: { isValid: false } })).state).toBe('banned');
    expect(mnStateOf(facts({ mn: undefined })).state).toBe('unknown');
  });

  it('needs a verified ChainLock, and reads a missing list entry as dissolved', () => {
    const g = d400Group();
    const a = agreementOf(g, approvalsFor(g), 'testnet');
    expect(judgeRegistration(a, facts({ chainLocked: 'claimed' })).state).toBe('unproven');
    expect(judgeRegistration(a, facts({ height: 0 })).state).toBe('unconfirmed');
    expect(judgeRegistration(a, facts({ mn: null })).mnState).toBe('dissolved');
    expect(judgeRegistration(a, facts({ mn: { isValid: true } })).mnState).toBe('valid');
    expect(judgeRegistration(a, { notFound: true, proTxHash: D400_HASH }).state).toBe('not-found');
  });

  it('collects linked hashes from the organizer and roster members only', () => {
    const g = d400Group();
    const seat = (ownerId: string, proTxHash?: string) => ({ id: `s-${ownerId}`, ownerId, docRevision: 1, groupId: g.id, amount: 1, status: 1, flags: 0, proTxHash });
    expect(linkedProTx(g, [seat(BOB, D400_HASH), seat(GROUP_ID, 'ee'.repeat(32)), seat(CAROL, 'cc'.repeat(32))])).toEqual([
      { hash: D400_HASH, by: ALICE },
      { hash: 'cc'.repeat(32), by: CAROL },
    ]);
  });
});

describe('live computations (M11)', () => {
  it('splits a real regtest payout exactly as consensus paid it', () => {
    const paid = A.payouts[0].masternode.slice(1).map((m: J) => BigInt(m.amount));
    const total = paid.reduce((a: bigint, b: bigint) => a + b, 0n);
    const labels = labelChainShares(chainSharesA.map((s) => s.amount), termsA.shares);
    const split = rewardSplit(total, 500, chainSharesA, labels, { operatorPayoutSet: false, mine: 'Bob' });
    expect(split.operator).toBe(0n);
    expect(split.rows.map((r) => r.part)).toEqual(paid);
    expect(split.rows.map((r) => r.fraction)).toEqual([0.5, 0.3, 0.2]);
    expect(split.rows.find((r) => r.mine)!.label).toBe('Bob');
    const withOperator = rewardSplit(100_000_000n, 300, chainSharesA, labels);
    expect(withOperator.operator).toBe(3_000_000n);
    expect(withOperator.rows.map((r) => r.part)).toEqual([48_500_000n, 29_100_000n, 19_400_000n]);
  });

  it('labels chain shares by amount, ambiguous ones by every name', () => {
    expect(labelChainShares([500n, 250n, 250n], [{ memberId: 'a', label: 'A', amount: 250n }, { memberId: 'b', label: 'B', amount: 500n }, { memberId: 'c', label: 'C', amount: 250n }])).toEqual(['B', 'A or C', 'A or C']);
  });

  it('counts down the early period in blocks and days', () => {
    expect(earlyView(1583318, 52560, 1586757)).toEqual({ registeredHeight: 1583318, endHeight: 1635878, blocksLeft: 49121, daysLeft: 85.3, over: false, none: false });
    expect(earlyView(100, 30, 200)).toMatchObject({ blocksLeft: 0, over: true });
    expect(earlyView(100, 0, 100)).toMatchObject({ none: true, over: true });
  });
});
