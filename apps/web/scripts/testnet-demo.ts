// Testnet demo groups (tooling, never shipped), written with three test identities through @cairn/auth's document writer and the
// @cairn/contract models, the same path the web app takes:
//
//   demo     terms exactly those of the real testnet shared masternode d400c120... (500/300/200, built by Dash-Qt's wizard),
//            locked, approved by all three and linked to that ProTx: /g/:id/live shows "Live (verified)" against real chain data.
//   checker  terms of the dashd 24.0.0 regtest fixture mn-a, moved to testnet (same address prefixes; a public service address),
//            locked and approved, never linked: the Playwright checker tests paste that fixture's draft against it.
//
//   cd apps/web && npx vite-node scripts/testnet-demo.ts [status|demo|checker]
//
// The identities are the e2e accounts in the shared secret store (cairn/testnet-e2e-user, -2, -1793991111033), read through their
// links in ~/.local/share/cairn; phrases never leave this process. Progress (public ids only) is kept in
// ~/.local/share/cairn/testnet-demo.json so a rerun continues where it stopped.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { KeyType, SeedWallet, discoverIdentities, redact, signInWithSeed, type PlatformPort, type Session } from '@cairn/auth';
import { createEvoPlatform } from '@cairn/auth/evo';
import {
  GROUP_STATUS, MN_TYPE, SEAT_FLAG, SEAT_STATUS, approvalData, contractIdFor, createOp, groupData, replaceOp, seatData, termSheetFromGroup, toGroup, type DocOp, type GroupFields,
} from '@cairn/contract';
import { bytesToHex, decodeSharedProRegTx, keyIdToAddress, termsHash } from '@cairn/shares';

const DIR = join(homedir(), '.local/share/cairn');
const STATE = join(DIR, 'testnet-demo.json');
const VECTORS = new URL('../../../packages/shares/test/vectors/', import.meta.url);
const HEX = readFileSync(new URL('testnet-d400c120.hex', VECTORS), 'utf8').trim();
const MN_A = JSON.parse(readFileSync(new URL('regtest/mn-a.json', VECTORS), 'utf8'));
/** The service the checker group (and the e2e tests' testnet copy of the regtest draft) uses: routable, as testnet requires. */
export const CHECKER_SERVICE = '8.8.4.4:19999';
const PEOPLE = [
  { label: 'Alice', file: 'testnet-e2e-user.json' },
  { label: 'Bob', file: 'testnet-e2e-user-2.json' },
  { label: 'Carol', file: 'testnet-e2e-user-1793991111033.json' },
] as const;
const CONTRACT = contractIdFor('testnet')!;
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

interface GroupProgress {
  groupId?: string;
  seats?: Record<string, string>;
  locked?: boolean;
  approvals?: Record<string, string>;
  linked?: boolean;
}
interface State {
  ids?: Record<string, string>;
  groups?: Record<string, GroupProgress>;
}
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });

async function signIn(platform: PlatformPort, file: string): Promise<Session> {
  const raw = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as { phrase?: string };
  const wallet = SeedWallet.fromPhrase(raw.phrase!, 'testnet');
  raw.phrase = undefined;
  const found = await discoverIdentities(wallet, platform);
  if (!found[0]) throw new Error(`${file}: no identity`);
  return signInWithSeed(wallet, found[0], platform);
}

type Sdk = InstanceType<typeof import('@dashevo/evo-sdk')['EvoSDK']>;

async function main() {
  const cmd = process.argv[2] ?? 'status';
  const evo = await import('@dashevo/evo-sdk');
  await (evo as { ensureInitialized?: () => Promise<void> }).ensureInitialized?.();
  const sdk: Sdk = evo.EvoSDK.testnetTrusted({ settings: { timeoutMs: 40_000, retries: 2 } });
  await sdk.connect();
  const platform = createEvoPlatform(evo, sdk, 'testnet');
  const sessions: Record<string, Session> = {};
  for (const p of PEOPLE) sessions[p.label] = await signIn(platform, p.file);
  const ids = (state.ids = Object.fromEntries(Object.entries(sessions).map(([k, s]) => [k, s.identityId])));
  for (const [k, s] of Object.entries(sessions)) log(`${k} ${s.identityId} balance ${Number((await platform.balance(s.identityId)) ?? 0n) / 1e11} DASH`);
  save();
  const write = (who: string, op: DocOp) => {
    const s = sessions[who]!;
    return platform.writeDocument({ ownerId: s.identityId, key: { id: s.keyId, purpose: 0, securityLevel: s.securityLevel, type: KeyType.ECDSA_SECP256K1, privateKey: s.privateKey }, op });
  };
  const roster = (amounts: number[]) => PEOPLE.map((x, i) => ({ id: ids[x.label]!, amount: amounts[i]!, label: x.label }));

  /** Create (or continue) one group: organizer Alice, seats, lock, every approval, and optionally the link. */
  async function formGroup(key: string, fields: GroupFields, proTxHash?: string) {
    const st = ((state.groups ??= {})[key] ??= {});
    if (!st.groupId) {
      st.groupId = (await write('Alice', createOp(CONTRACT, 'group', groupData(fields, 'testnet')))).id;
      save();
      log(`${key}: group ${st.groupId}`);
    }
    const groupId = st.groupId;
    st.seats ??= {};
    for (const x of PEOPLE) {
      if (st.seats[x.label]) continue;
      const alice = x.label === 'Alice';
      const data = seatData(
        {
          groupId,
          amount: fields.roster.find((r) => r.id === ids[x.label])!.amount,
          status: SEAT_STATUS.requested,
          message: alice ? 'I coordinate in Dash-Qt and hold the voting key.' : undefined,
          flags: alice ? SEAT_FLAG.canCoordinate | SEAT_FLAG.votingKeyHolder : 0,
          votingAddress: alice ? fields.votingAddress : undefined,
        },
        'testnet',
      );
      st.seats[x.label] = (await write(x.label, createOp(CONTRACT, 'seat', data))).id;
      save();
    }
    const current = async () => {
      const raw = (await sdk.documents.getWithProof(CONTRACT, 'group', groupId)).data!.toJSON() as Record<string, unknown>;
      return toGroup(raw, 'testnet');
    };
    const hash = termsHash(termSheetFromGroup(groupId, fields, 'testnet'));
    if (!st.locked) {
      const { docRevision } = await current();
      await write('Alice', replaceOp(CONTRACT, 'group', groupId, docRevision, groupData({ ...fields, status: GROUP_STATUS.locked, lockedHash: hash }, 'testnet')));
      st.locked = true;
      save();
      log(`${key}: locked, termsHash ${hash}`);
    }
    st.approvals ??= {};
    for (const x of PEOPLE) {
      if (st.approvals[x.label]) continue;
      const amount = fields.roster.find((r) => r.id === ids[x.label])!.amount;
      st.approvals[x.label] = (await write(x.label, createOp(CONTRACT, 'approval', approvalData({ groupId, termsRevision: fields.termsRevision, termsHash: hash, shareAmount: amount })))).id;
      save();
    }
    if (proTxHash && !st.linked) {
      const { docRevision } = await current();
      await write('Alice', replaceOp(CONTRACT, 'group', groupId, docRevision, groupData({ ...fields, status: GROUP_STATUS.live, lockedHash: hash, proTxHash }, 'testnet')));
      st.linked = true;
      save();
      log(`${key}: linked ${proTxHash}`);
    }
    const group = await current();
    log(`${key}: group ${groupId}, status ${group.status}, proTxHash ${group.proTxHash ?? '-'}, lockedHash ${group.lockedHash === hash ? 'matches' : 'DIFFERS'}`);
  }

  const common = { mnType: MN_TYPE.regular, operatorId: ids.Carol!, coordinatorId: ids.Alice!, votingHolderId: ids.Alice!, termsRevision: 1, status: GROUP_STATUS.full };
  if (cmd === 'demo') {
    const d = decodeSharedProRegTx(HEX);
    const p = d.payload;
    await formGroup(
      'demo',
      {
        ...common,
        title: 'Testnet demo: the d400c120 shared masternode',
        about:
          'A demonstration on testnet. Its locked terms are exactly those of the real shared masternode d400c120… that Dash-Qt’s wizard registered at block 1,583,318 (500/300/200 DASH), approved by three test accounts. Test DASH only.',
        rewardBps: p.operatorReward,
        earlyPeriodBlocks: p.earlyPeriodBlocks,
        earlyPenalty: Number(p.earlyPenalty),
        votingPolicy: 'Alice votes as the majority of shares decides in the group chat.',
        roster: roster(p.shares.map((s) => Number(s.amount))),
        operatorPubKey: bytesToHex(p.pubKeyOperator),
        votingAddress: keyIdToAddress(p.keyIDVoting, 'test'),
      },
      d.txid,
    );
  } else if (cmd === 'checker') {
    const a = MN_A.prepareArgs;
    await formGroup('checker', {
      ...common,
      title: 'Testnet checker fixture (not a real masternode)',
      about: 'Terms of Dash Core’s own regtest run, moved to testnet so Cairn’s browser tests can check real Dash-Qt messages against a locked group. Never formed.',
      rewardBps: 500,
      earlyPeriodBlocks: a.earlyPeriodBlocks,
      earlyPenalty: a.earlyPenalty,
      roster: roster(a.shares.map((s: { amount: number }) => s.amount)),
      operatorPubKey: a.operatorPubKey,
      votingAddress: a.votingAddress,
      service: CHECKER_SERVICE,
    });
  }
  for (const s of Object.values(sessions)) s.end();
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(redact(String((e as Error)?.stack ?? e)));
    process.exit(1);
  },
);
