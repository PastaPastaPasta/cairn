// Registers the cairn contract with a deployer identity made from its own seed (tooling, never shipped). Modelled on govhub's
// packages/auth/scripts/mainnet-bootstrap.ts (`fund` and `contract`).
//
//   node --experimental-transform-types packages/contract/scripts/register.ts <network> <command>
//
//   init       make the deployer seed and keep it ONLY in the shared secret store (`secret set cairn/<network>-deployer --link
//              ~/.local/share/cairn/<network>-deployer.json`); never printed
//   status     read-only: funding address, identity, balance, contract state
//   fund       create the deployer identity from a deposit to its DIP-13 funding address (runFunding: IS-lock proof); prints the
//              address once the deposit watcher is live, then waits for the payment
//   contract   register packages/contract/cairn.json with the identity's CRITICAL key and record the id in deployments.json
//
// Files: $CAIRN_DEPLOY_DIR (default ~/.local/share/cairn, 0700). `<network>-deployer.json` ({"phrase", "network"}) is a link into
// the secret store; `<network>-state.json` holds public data only (funding record, ids, the signed transition, fees).
//
// Safety, as govhub's bootstrap:
//  - one run at a time (<network>.lock);
//  - the contract transition is built and signed once at a fixed identity nonce and saved BEFORE the broadcast; a rerun only
//    re-sends those bytes (Platform refuses a replayed nonce), so one saved entry can never make two contracts;
//  - a lost-state guard refuses to register when a contract with these schemas already exists at a nonce this owner used;
//  - errors are redacted (keys never echo).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDapi } from '@cairn/dapi';
import {
  addressOf, CREDITS_PER_DUFF, DASHPAY_CONTRACT_ID, generatePhrase, hash160, KeyPurpose, privateKeyMatches, redact, registrationFundingPath, runFunding,
  SecurityLevel, SeedWallet, wipe, type FundingRecord, type FundingStore, type PlatformPort,
} from '@cairn/auth';
import { classifySend, createEvoPlatform, nonceConsumed } from '@cairn/auth/evo';

type Net = 'testnet' | 'mainnet';
const NET = process.argv[2] as Net;
const CMD = process.argv[3];
if (NET !== 'testnet' && NET !== 'mainnet') throw new Error('usage: register.ts <testnet|mainnet> <init|status|fund|contract>');
const EXPECTED_PV = Number(process.env.CAIRN_EXPECTED_PV ?? (NET === 'testnet' ? 14 : 13));
const DIR = process.env.CAIRN_DEPLOY_DIR ?? join(homedir(), '.local/share/cairn');
const SEED_FILE = join(DIR, `${NET}-deployer.json`);
const SECRET_NAME = `cairn/${NET}-deployer`;
const STATE = join(DIR, `${NET}-state.json`);
const LOCK = join(DIR, `${NET}.lock`);
const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT_FILE = join(HERE, '../cairn.json');
const DEPLOYMENTS_FILE = join(HERE, '../deployments.json');
const IDENTITY_INDEX = 0;
/** 0.1 DASH + 0.02 per type + 0.01 per index (8 types, 14 indexes), plus storage; measured on testnet for govhub's forum: 0.433. */
const EXPECTED_FEE_DASH = 0.42;
const NONCE_VALUE = 0xff_ffff_ffffn;

interface ContractEntry { id: string; ownerId: string; nonce: string; platformVersion: number; schemaSha256: string; raw: string; status: 'publishing' | 'done'; feeCredits?: string; balanceBefore: string; at: string }
interface State { network: Net; fundingAddress: string; identityId?: string; fundings: Record<string, FundingRecord>; contract?: ContractEntry; createFeeCredits?: string }

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2) + '\n';
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const dash = (credits: bigint) => (Number(credits) / 1e11).toFixed(8);
const errText = (e: unknown) => redact(String((e as Error)?.message ?? e)).replace(/[A-Za-z0-9+/]{43}=/g, '[b64]');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ensureDir(d: string) {
  mkdirSync(d, { recursive: true, mode: 0o700 });
  if (statSync(d).uid !== process.getuid!()) throw new Error(`${d} is not owned by this user`);
  chmodSync(d, 0o700);
}
function writePrivate(path: string, content: string) {
  const tmp = `${path}.tmp`;
  rmSync(tmp, { force: true });
  writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' });
  renameSync(tmp, path);
}
function takeLock() {
  let fd: number;
  try {
    fd = openSync(LOCK, 'wx', 0o600);
  } catch {
    throw new Error(`another run holds ${LOCK}; if that process is gone, remove the file`);
  }
  writeSync(fd, String(process.pid));
  closeSync(fd);
  process.on('exit', () => rmSync(LOCK, { force: true }));
}

function init() {
  if (existsSync(SEED_FILE)) throw new Error(`${SEED_FILE} exists already; never replace a deployer seed`);
  const tmp = join(DIR, `.${NET}-deployer.new`);
  rmSync(tmp, { force: true });
  writeFileSync(tmp, JSON.stringify({ phrase: generatePhrase(24), network: NET }) + '\n', { mode: 0o600, flag: 'wx' });
  try {
    const r = spawnSync('secret', ['set', SECRET_NAME, '--link', SEED_FILE, '--file', tmp, '--note', `Cairn ${NET} contract deployer seed (BIP39; identity index 0 owns the cairn contract)`], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.status !== 0) throw new Error(`secret set failed (exit ${r.status})`);
  } finally {
    rmSync(tmp, { force: true });
  }
  if (!existsSync(SEED_FILE)) throw new Error(`secret set did not link ${SEED_FILE}`);
  log(`deployer seed stored as secret ${SECRET_NAME}, linked at ${SEED_FILE}`);
}

function loadSeed(): SeedWallet {
  const mode = statSync(SEED_FILE).mode & 0o777;
  if (mode & 0o077) throw new Error(`${SEED_FILE} must be 0600 (is ${mode.toString(8)})`);
  let raw: { phrase?: unknown; network?: unknown };
  try {
    raw = JSON.parse(readFileSync(SEED_FILE, 'utf8'));
  } catch {
    throw new Error('the seed file is not valid JSON');
  }
  if (typeof raw.phrase !== 'string' || raw.network !== NET) throw new Error(`the seed file needs "phrase" and "network": "${NET}"`);
  try {
    return SeedWallet.fromPhrase(raw.phrase, NET);
  } catch {
    throw new Error('the seed file phrase is not a valid BIP39 phrase');
  } finally {
    raw.phrase = undefined;
  }
}

type Evo = typeof import('@dashevo/evo-sdk');
let wallet: SeedWallet;
let st: State;
let evo: Evo;
let sdk: InstanceType<Evo['EvoSDK']>;
let platform: PlatformPort;
let provedPv = 0;
const save = () => writePrivate(STATE, json(st));
const store: FundingStore = {
  load: (k) => st.fundings[k] ?? null,
  save: (r) => ((st.fundings[r.key] = { ...r, updatedAt: Date.now() }), save()),
  remove: (k) => (delete st.fundings[k], save()),
  list: () => Object.values(st.fundings),
};
const regAddress = () => {
  const k = wallet.derive(registrationFundingPath(NET, IDENTITY_INDEX));
  wipe(k.privateKey);
  return addressOf(k.publicKey, NET);
};
const masterHash = () => {
  const k = wallet.identityKey(IDENTITY_INDEX, 0);
  wipe(k.privateKey);
  return hash160(k.publicKey);
};

async function setup() {
  wallet = loadSeed();
  const fundingAddress = regAddress();
  st = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { network: NET, fundingAddress, fundings: {} };
  if (st.network !== NET || st.fundingAddress !== fundingAddress) throw new Error('the state file belongs to another seed or network');
  evo = await import('@dashevo/evo-sdk');
  await (evo as { ensureInitialized?: () => Promise<void> }).ensureInitialized?.();
  sdk = NET === 'testnet' ? evo.EvoSDK.testnetTrusted({ settings: { timeoutMs: 40_000, retries: 2 } }) : evo.EvoSDK.mainnetTrusted({ settings: { timeoutMs: 40_000, retries: 2 } });
  await sdk.connect();
  const r = await sdk.contracts.fetchWithProof(DASHPAY_CONTRACT_ID);
  provedPv = Math.max(Number(r.metadata.protocolVersion) || 0, sdk.version());
  platform = createEvoPlatform(evo, sdk, NET);
}

async function settledBalance(id: string): Promise<bigint> {
  let prev = -1n;
  for (let i = 0; i < 15; i++) {
    const b = (await platform.balance(id)) ?? 0n;
    if (b === prev) return b;
    prev = b;
    await sleep(2500);
  }
  return prev;
}

async function status() {
  log(`network ${NET}, Platform protocol ${provedPv}; funding address ${st.fundingAddress}`);
  const id = st.identityId ?? (await platform.identityByUniqueKeyHash(masterHash()));
  log(id ? `identity ${id}, balance ${dash((await platform.balance(id)) ?? 0n)} DASH` : 'identity: not created yet');
  if (st.contract) log(`contract ${st.contract.id} ${st.contract.status}${st.contract.feeCredits ? `, fee ${dash(BigInt(st.contract.feeCredits))} DASH` : ''}`);
}

async function fund() {
  if (st.identityId) return log(`identity already created: ${st.identityId}`);
  const existing = await platform.identityByUniqueKeyHash(masterHash());
  if (existing) {
    st.identityId = existing;
    save();
    return log(`identity already exists on Platform: ${existing}`);
  }
  const t0 = Date.now();
  let shown = false;
  const { identityId, record: rec } = await runFunding({
    wallet, dapi: createDapi({ network: NET }), platform, store, kind: 'create', identityIndex: IDENTITY_INDEX, legacy: false, isLockWaitMs: 180_000,
    log: (m) => log(`  ${m}`),
    onUpdate: (v) => {
      log(`  ${v.state}${v.note ? ` (${v.note})` : ''}`);
      if (v.state === 'awaiting-deposit' && !shown) {
        shown = true;
        log(`PAY ${v.address} (watching; at least ${(v.minDuffs / 1e8).toFixed(8)} DASH, ~${EXPECTED_FEE_DASH * 1.5} DASH for the contract)`);
      }
    },
  });
  const bal = await settledBalance(identityId);
  const fee = BigInt(rec.lock!.lockDuffs) * CREDITS_PER_DUFF - bal;
  st.identityId = identityId;
  st.createFeeCredits = fee.toString();
  save();
  log(`identity ${identityId}: balance ${dash(bal)} DASH, create fee ${dash(fee)} DASH, ${Math.round((Date.now() - t0) / 1000)} s (${rec.proofKind} proof)`);
}

const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
const isNotFound = (e: unknown) => /\bNOT_FOUND\b|contract\b.*\b(?:not found|does not exist)/i.test(String((e as Error)?.message ?? e));
async function fetchContract(id: string) {
  for (let i = 0; ; i++) {
    try {
      return (await sdk.contracts.fetch(id)) ?? null;
    } catch (e) {
      if (isNotFound(e)) return null;
      if (i >= 3) throw e;
      await sleep(5000);
    }
  }
}

function recordDeployment(e: ContractEntry) {
  const d = JSON.parse(readFileSync(DEPLOYMENTS_FILE, 'utf8'));
  d[NET] = { contractId: e.id, ownerId: e.ownerId, registeredAt: e.at, feeCredits: e.feeCredits ?? null };
  writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(d, null, 2) + '\n');
  log(`recorded ${e.id} in ${DEPLOYMENTS_FILE}`);
}

async function contract() {
  const ownerId = st.identityId;
  if (!ownerId) throw new Error('create the deployer identity first (fund)');
  const nr = await sdk.identities.nonceWithProof(ownerId);
  const pv = Math.max(provedPv, Number(nr.metadata.protocolVersion) || 0);
  if (pv !== EXPECTED_PV) throw new Error(`Platform protocol version is ${pv}, expected ${EXPECTED_PV}: stop`);
  const nonceNow = BigInt(nr.data ?? 0n) & NONCE_VALUE;
  const text = readFileSync(CONTRACT_FILE, 'utf8');
  const sha = createHash('sha256').update(text).digest('hex');
  const schemas = JSON.parse(text);
  const newContract = (nonce: bigint) => new evo.DataContract({ ownerId, identityNonce: nonce, schemas, fullValidation: true, platformVersion: pv } as never);
  const wantSchemas = JSON.stringify(canon((newContract(1n).toJSON(pv) as { documentSchemas: unknown }).documentSchemas));
  const probe = async (id: string, tries: number): Promise<'absent' | 'same' | 'other'> => {
    let back: Awaited<ReturnType<typeof fetchContract>> = null;
    for (let i = 0; i < tries && !back; i++) {
      back = await fetchContract(id);
      if (!back && i + 1 < tries) await sleep(3000);
    }
    if (!back) return 'absent';
    const same = JSON.stringify(canon((back.toJSON(pv) as { documentSchemas: unknown }).documentSchemas)) === wantSchemas && back.ownerId.toString() === ownerId;
    return same ? 'same' : 'other';
  };
  const verify = async (id: string, tries = 20) => {
    const r = await probe(id, tries);
    if (r === 'other') throw new Error(`${id} is a contract with other schemas or another owner than cairn.json by ${ownerId}`);
    return r === 'same';
  };
  const finish = async (e: ContractEntry, landedEarlier: boolean) => {
    let after = await settledBalance(ownerId);
    for (let i = 0; i < 10 && !landedEarlier && after === BigInt(e.balanceBefore); i++) {
      await sleep(3000);
      after = await settledBalance(ownerId);
    }
    st.contract = { ...e, status: 'done', feeCredits: (BigInt(e.balanceBefore) - after).toString() };
    save();
    recordDeployment(st.contract);
    log(`cairn: ${e.id} registered and read back (schemas match cairn.json); fee ${dash(BigInt(st.contract.feeCredits!))} DASH, owner balance ${dash(after)} DASH`);
  };

  const saved = st.contract;
  if (saved?.status === 'done') {
    if (!(await verify(saved.id))) throw new Error(`${saved.id} is recorded as done but cannot be read back`);
    recordDeployment(saved);
    return log(`${saved.id} already registered; read back and schemas match cairn.json`);
  }
  if (saved) {
    if (saved.schemaSha256 !== sha) throw new Error(`cairn.json changed since the attempt that saved ${saved.id}: investigate`);
    if (await verify(saved.id, 3)) return await finish(saved, true);
    log(`re-sending the saved transition for ${saved.id} (nonce ${saved.nonce})`);
    await sdk.stateTransitions.broadcastAndWait(evo.StateTransition.fromBytes(Uint8Array.from(Buffer.from(saved.raw, 'hex')))).catch((e) => log(`broadcast (${classifySend(e)}): ${errText(e)}`));
    if (await verify(saved.id)) return await finish(saved, false);
    const fresh = BigInt((await sdk.identities.nonceWithProof(ownerId)).data ?? 0n);
    throw new Error(`${saved.id} not visible; nonce ${saved.nonce} is ${nonceConsumed(fresh, BigInt(saved.nonce)) ? 'USED: stop and investigate' : 'still free: rerun re-sends the same bytes (never sign again at a higher nonce)'}`);
  }

  for (let n = 1n; n <= nonceNow; n++) {
    const id = newContract(n).id.toString();
    if ((await probe(id, 1)) === 'same') throw new Error(`${id} (nonce ${n}) already holds cairn.json: record it instead of registering again`);
  }
  const nonce = nonceNow + 1n;
  const dc = newContract(nonce);
  const id = dc.id.toString();
  const before = await settledBalance(ownerId);
  const need = BigInt(Math.round(EXPECTED_FEE_DASH * 1.25 * 1e11));
  if (before < need) throw new Error(`owner balance ${dash(before)} DASH is below ${dash(need)} (expected fee x1.25)`);
  const identity = await sdk.identities.fetch(ownerId);
  const pub = identity?.getPublicKeyById(1);
  if (!pub) throw new Error(`owner ${ownerId} or its key 1 not found`);
  const d = wallet.identityKey(IDENTITY_INDEX, 1);
  let raw: string;
  try {
    const info = pub.toObject() as { purpose: number; securityLevel: number; type: number; data: Uint8Array };
    if (info.purpose !== KeyPurpose.AUTHENTICATION || info.securityLevel !== SecurityLevel.CRITICAL || !privateKeyMatches(d.privateKey, { type: info.type, data: Uint8Array.from(info.data) }))
      throw new Error(`key 1 of ${ownerId} is not the seed's AUTH/CRITICAL key`);
    const t = new evo.DataContractCreateTransition(dc, nonce, pv);
    if (t.getDataContract(pv).id.toString() !== id) throw new Error(`transition contract id differs from ${id}`);
    const stt = t.toStateTransition();
    const priv = evo.PrivateKey.fromBytes(d.privateKey, NET);
    try {
      stt.sign(priv, pub);
    } finally {
      try {
        priv.free();
      } catch {
        /* consumed */
      }
    }
    if (stt.signaturePublicKeyId !== 1) throw new Error(`transition signed by key ${stt.signaturePublicKeyId}, expected 1`);
    raw = Buffer.from(stt.toBytes()).toString('hex');
  } finally {
    wipe(d.privateKey);
  }
  const entry: ContractEntry = { id, ownerId, nonce: nonce.toString(), platformVersion: pv, schemaSha256: sha, raw, status: 'publishing', balanceBefore: before.toString(), at: new Date().toISOString() };
  st.contract = entry;
  save();
  log(`registering ${id} (owner ${ownerId}, nonce ${nonce}, PV ${pv}, balance ${dash(before)} DASH)`);
  await sdk.stateTransitions.broadcastAndWait(evo.StateTransition.fromBytes(Uint8Array.from(Buffer.from(raw, 'hex')))).catch((e) => log(`broadcast threw (${classifySend(e)}; checking Platform): ${errText(e)}`));
  if (!(await verify(id))) throw new Error(`${id} not visible after the broadcast; rerun \`contract\` (it only re-sends the same transition)`);
  await finish(entry, false);
}

async function main() {
  ensureDir(DIR);
  takeLock();
  if (CMD === 'init') return init();
  await setup();
  switch (CMD) {
    case 'status':
      return status();
    case 'fund':
      return fund();
    case 'contract':
      return contract();
    default:
      throw new Error('usage: register.ts <testnet|mainnet> <init|status|fund|contract>');
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`error: ${errText(e)}`);
    process.exit(1);
  },
);
