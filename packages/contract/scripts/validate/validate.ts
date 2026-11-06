// Offline validation of cairn.json, after govhub's spikes/sdk5/scripts/validate-contracts.ts.
//
//   cd packages/contract/scripts/validate && npm ci && npm run validate
//
// Two independent engines, because evo-sdk's `new DataContract({ fullValidation: true })` does not run the "validation"-feature
// checks (indexed string maxLength <= 63, indexed byteArray <= 255, meta-schema, keyword allow-list ...):
//  A. @dashevo/wasm-dpp (the DPP build WITH validation): dataContract.create, createFromObject(skipValidation: false) and a create
//     transition round trip through stateTransition.createFromBuffer(skipValidation: false); 4.1.1 @ PV13 (what mainnet runs) and
//     5.0.0-rc.8 @ PV13 and PV14.
//  B. @dashevo/evo-sdk (what the app ships): DataContract with fullValidation, toBytes/fromBytes and a create transition.
// Negative controls prove engine A enforces the rules. Exit code != 0 on any failure.
import { readFileSync } from 'node:fs';
import * as evo4 from 'evo4';
import * as evo5 from 'evo5';
import dpp4Module from 'dpp4';
import dpp5Module from 'dpp5';

const schemas = JSON.parse(readFileSync(new URL('../../cairn.json', import.meta.url), 'utf8'));
const OWNER_BYTES = new Uint8Array(32).fill(0x11);
const OWNER_B58 = 'GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec';

const errText = (e: unknown): string => {
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; code?: unknown; getMessage?: () => string };
    const m = o.message ?? (typeof o.getMessage === 'function' ? o.getMessage() : String(e));
    return `${m}${o.code !== undefined ? ` [code ${o.code}]` : ''}`;
  }
  return String(e);
};

interface Outcome { ok: boolean; stBytes?: number; error?: string }
type Engine = { label: string; version: number; run: (s: object) => Promise<Outcome> };

function dppEngine(label: string, mod: any, version: number): Engine {
  return {
    label,
    version,
    async run(s) {
      try {
        const dpp = new mod.DashPlatformProtocol({ generate: () => crypto.getRandomValues(new Uint8Array(32)) }, version);
        const c = dpp.dataContract.create(OWNER_BYTES, 1n, s);
        await dpp.dataContract.createFromObject(c.toObject(), { skipValidation: false });
        const st = dpp.dataContract.createDataContractCreateTransition(c);
        const buf: Uint8Array = st.toBuffer();
        await dpp.stateTransition.createFromBuffer(buf, { skipValidation: false });
        return { ok: true, stBytes: buf.length };
      } catch (e) {
        return { ok: false, error: errText(e) };
      }
    },
  };
}

function evoEngine(label: string, sdk: any, version: number): Engine {
  return {
    label,
    version,
    async run(s) {
      try {
        const contract = new sdk.DataContract({ ownerId: OWNER_B58, identityNonce: 1n, schemas: s, fullValidation: true, platformVersion: version });
        sdk.DataContract.fromBytes(contract.toBytes(version), true, version);
        const t = new sdk.DataContractCreateTransition(contract, 1n, version);
        return { ok: true, stBytes: t.toBytes().length };
      } catch (e) {
        return { ok: false, error: errText(e) };
      }
    },
  };
}

await evo4.ensureInitialized();
await evo5.ensureInitialized();
// wasm-dpp is CommonJS: under Node's ESM loader the loader function sits one `default` deeper than under vite-node.
const loader = (m: any): (() => Promise<any>) => (typeof m === 'function' ? m : m.default);
const dpp4 = await loader(dpp4Module)();
const dpp5 = await loader(dpp5Module)();
const dppEngines = [dppEngine('wasm-dpp 4.1.1 @PV13', dpp4, 13), dppEngine('wasm-dpp 5.0.0-rc.8 @PV13', dpp5, 13), dppEngine('wasm-dpp 5.0.0-rc.8 @PV14', dpp5, 14)];
const evoEngines = [evoEngine('evo-sdk 4.1.1 @PV13', evo4, 13), evoEngine('evo-sdk 5.0.0-rc.8 @PV13', evo5, 13), evoEngine('evo-sdk 5.0.0-rc.8 @PV14', evo5, 14)];

let failures = 0;
console.log('cairn.json:');
for (const e of [...dppEngines, ...evoEngines]) {
  const r = await e.run(schemas);
  if (!r.ok) failures++;
  console.log(`  ${e.label.padEnd(28)} ${r.ok ? `PASS (create-ST ${r.stBytes} B)` : `FAIL: ${r.error}`}`);
}

const variant = (mut: (c: any) => void) => {
  const c = JSON.parse(JSON.stringify(schemas));
  mut(c);
  return c;
};
const controls: { label: string; s: object; expect13: 'reject' | 'accept'; expect14: 'reject' | 'accept' }[] = [
  { label: 'indexed string maxLength 100', s: variant((c) => { c.profile.properties.displayName.maxLength = 100; c.profile.required.push('displayName'); c.profile.indices.push({ name: 'x', properties: [{ displayName: 'asc' }] }); }), expect13: 'reject', expect14: 'reject' },
  { label: 'indexed byteArray maxItems 300', s: variant((c) => { c.seat.properties.groupId = { type: 'array', byteArray: true, minItems: 32, maxItems: 300, position: 0 }; }), expect13: 'reject', expect14: 'reject' },
  { label: 'refersTo keyword', s: variant((c) => { c.invite.properties.toId.refersTo = { type: 'identity' }; }), expect13: 'reject', expect14: 'accept' },
  { label: 'typed array', s: variant((c) => { c.profile.properties.roles = { type: 'array', items: { type: 'integer' }, maxItems: 3, position: 3 }; }), expect13: 'reject', expect14: 'accept' },
  { label: 'unknown keyword on a type', s: variant((c) => { c.profile.foo = 1; }), expect13: 'reject', expect14: 'reject' },
];
console.log('\nNegative controls (wasm-dpp; expectation per version):');
for (const ctl of controls) {
  const verdicts: string[] = [];
  for (const e of dppEngines) {
    const r = await e.run(ctl.s);
    const want = e.version === 14 ? ctl.expect14 : ctl.expect13;
    const got = r.ok ? 'accept' : 'reject';
    if (got !== want) failures++;
    verdicts.push(`${e.label.replace('wasm-dpp ', '')}=${got}${got === want ? '' : ` (UNEXPECTED, wanted ${want})`}`);
  }
  console.log(`  ${ctl.label.padEnd(32)} ${verdicts.join('   ')}`);
}
// Documents, after govhub's spikes/sdk5/scripts/validate-documents.ts: per type a MAX document (every field at its bound), a MIN
// document (required fields only, e.g. a group with no operatorId under the byOperator index), every bounded field one past its
// limit (must be rejected), and the MAX document through a batch transition with full validation.
const valueFor = (p: any, mode: 'max' | 'min', over = false): unknown => {
  if (p.type === 'boolean') return true;
  if (p.type === 'integer') return over ? p.maximum + 1 : mode === 'max' ? p.maximum : p.minimum;
  if (p.type === 'string') return 'x'.repeat(over ? p.maxLength + 1 : mode === 'max' ? p.maxLength : p.minLength);
  return Buffer.alloc(over ? p.maxItems + 1 : mode === 'max' ? p.maxItems : p.minItems, 7);
};
const sample = (def: any, mode: 'max' | 'min') =>
  Object.fromEntries(Object.entries<any>(def.properties).filter(([k]) => mode === 'max' || (def.required ?? []).includes(k)).map(([k, p]) => [k, valueFor(p, mode)]));
console.log('\nDocuments (MAX, MIN, every bound +1, MAX in a batch transition):');
for (const [type, def] of Object.entries<any>(schemas)) {
  const cells: string[] = [];
  for (const e of dppEngines) {
    const mod = e.version === 13 && e.label.includes('4.1.1') ? dpp4 : dpp5;
    const dpp = new mod.DashPlatformProtocol({ generate: () => crypto.getRandomValues(new Uint8Array(32)) }, e.version);
    const dc = dpp.dataContract.create(OWNER_BYTES, 1n, schemas);
    const mk = (data: Record<string, unknown>) => dpp.document.create(dc, OWNER_B58, type, data);
    const errs: string[] = [];
    for (const mode of ['max', 'min'] as const) {
      try {
        const r = mk(sample(def, mode)).validate(e.version);
        if (!r.isValid()) errs.push(`${mode}: ${r.getErrors().map((x: any) => String(x.message).slice(0, 80)).join('; ')}`);
      } catch (x) {
        errs.push(`${mode} threw: ${errText(x).slice(0, 80)}`);
      }
    }
    for (const [k, p] of Object.entries<any>(def.properties)) {
      if (p.type === 'boolean') continue;
      let rejected = false;
      try {
        rejected = !mk({ ...sample(def, 'max'), [k]: valueFor(p, 'max', true) }).validate(e.version).isValid();
      } catch (x) {
        // identifiers are converted to 32 bytes while the document is built: a wrong length is refused right there
        if (p.contentMediaType && /byte length/.test(errText(x))) rejected = true;
        else errs.push(`over-limit ${k} threw: ${errText(x).slice(0, 60)}`);
      }
      if (!rejected) errs.push(`over-limit ${k} ACCEPTED`);
    }
    try {
      const st = dpp.document.createStateTransition({ create: [mk(sample(def, 'max'))] }, { [OWNER_B58]: { [dc.getId().toString()]: '1' } });
      await dpp.stateTransition.createFromBuffer(st.toBuffer(), { skipValidation: false });
    } catch (x) {
      errs.push(`ST: ${errText(x).slice(0, 100)}`);
    }
    if (errs.length) failures++;
    cells.push(`${e.label.replace('wasm-dpp ', '')}=${errs.length ? `FAIL (${errs.join(' | ')})` : 'PASS'}`);
  }
  console.log(`  ${type.padEnd(10)} ${cells.join('   ')}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nVALID ON ALL TARGETS; ALL NEGATIVE CONTROLS AND DOCUMENTS BEHAVED AS EXPECTED');
process.exit(failures ? 1 : 0);
