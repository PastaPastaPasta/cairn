// The cairn contract, offline: the conventions govhub's contracts follow (packages/contracts-v1/README.md) as a lint, and the real
// evo-sdk 5.0.0-rc.8 DataContract with full validation at PV13 (mainnet) and PV14 (testnet). scripts/validate/ adds the wasm-dpp
// engines (meta-schema, index rules) that evo-sdk does not run.
import { beforeAll, describe, expect, it } from 'vitest';
import * as evo from '@dashevo/evo-sdk';
import cairn from '../cairn.json' with { type: 'json' };
import govhubVault from './fixtures/govhub-forum-vault.json' with { type: 'json' };
import { DEPLOYMENTS, DOC_TYPES, contractIdFor } from '../src/index.ts';

const w = evo as unknown as Record<string, any>;
const OWNER_B58 = 'GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec';
type Def = { indices?: Array<{ name: string; unique?: boolean; properties: Array<Record<string, string>> }>; properties: Record<string, any>; required?: string[]; [k: string]: unknown };
const types = cairn as unknown as Record<string, Def>;

beforeAll(async () => {
  await (evo as { ensureInitialized?: () => Promise<void> }).ensureInitialized?.();
});

/** The rules govhub's validate-contracts.ts lints, plus Cairn's own (≤ 3 indexes and ≤ 3 properties per index, ≈ 14 indexes in all). */
function lint(): string[] {
  const out: string[] = [];
  for (const [type, def] of Object.entries(types)) {
    const idx = def.indices ?? [];
    if (idx.length > 3) out.push(`${type}: ${idx.length} indexes`);
    if (/-/.test(type)) out.push(`${type}: '-' in name`);
    for (const k of ['documentsMutable', 'canBeDeleted', 'transferable', 'signatureSecurityLevelRequirement']) if (def[k] === undefined) out.push(`${type}: ${k} not explicit`);
    if (def.additionalProperties !== false) out.push(`${type}: additionalProperties`);
    if (def.documentsKeepHistory) out.push(`${type}: documentsKeepHistory`);
    const txt = JSON.stringify(def);
    for (const kw of ['refersTo', 'distinctFrom', 'ttl', 'rankedCountable', 'countable', 'rangeCountable', 'indexOnly', 'propertyConstraints', 'maxBytes'])
      if (txt.includes(`"${kw}"`)) out.push(`${type}: PV14-only keyword ${kw}`);
    for (const [pn, p] of Object.entries<any>(def.properties)) {
      if (pn.includes('-')) out.push(`${type}.${pn}: '-' in name`);
      if (p.type === 'array' && !p.byteArray) out.push(`${type}.${pn}: typed array`);
      if (p.maxItems > 5120 || p.maxLength > 5120) out.push(`${type}.${pn}: over 5120`);
      if (p.type === 'string' && p.maxLength === undefined) out.push(`${type}.${pn}: string without maxLength`);
      if (p.type === 'integer' && (p.minimum === undefined || p.maximum === undefined || p.maximum > Number.MAX_SAFE_INTEGER)) out.push(`${type}.${pn}: integer bounds`);
    }
    const positions = Object.values<any>(def.properties).map((p) => p.position).sort((a, b) => a - b);
    if (positions.some((p, i) => p !== i)) out.push(`${type}: positions not contiguous`);
    for (const ix of idx) {
      if (ix.properties.length > 3) out.push(`${type}.${ix.name}: more than 3 properties`);
      for (const part of ix.properties) {
        const [name] = Object.keys(part) as [string];
        if (part[name] !== 'asc') out.push(`${type}.${ix.name}.${name}: not asc`);
        if (name.startsWith('$')) {
          if (['$createdAt', '$updatedAt'].includes(name) && !def.required?.includes(name)) out.push(`${type}.${ix.name}: ${name} not required`);
          continue;
        }
        const p = def.properties[name];
        if (!p) out.push(`${type}.${ix.name}: unknown ${name}`);
        else {
          if (p.type === 'string' && !(p.maxLength <= 63)) out.push(`${type}.${ix.name}.${name}: indexed string over 63`);
          if (p.byteArray && !(p.maxItems <= 255)) out.push(`${type}.${ix.name}.${name}: indexed byteArray over 255`);
          if (p.type === 'integer' && p.maximum > 2 ** 62) out.push(`${type}.${ix.name}.${name}: indexed integer near 2^63`);
          if (!def.required?.includes(name)) out.push(`${type}.${ix.name}.${name}: indexed property optional`);
        }
      }
    }
  }
  return out;
}

describe('cairn contract', () => {
  it('has the eight types of DESIGN section 7 and 14 indexes', () => {
    expect(DOC_TYPES).toEqual(['profile', 'operator', 'looking', 'group', 'seat', 'invite', 'approval', 'vault']);
    expect(Object.values(types).reduce((a, d) => a + (d.indices?.length ?? 0), 0)).toBe(14);
  });

  it('follows the PV13 conventions govhub lints', () => {
    expect(lint()).toEqual([]);
  });

  it('keeps the vault type identical in shape to govhub forum.vault (the vendored passkey vault depends on it)', () => {
    expect(types.vault).toEqual(govhubVault);
  });

  it('approvals cannot be edited; every other user type can', () => {
    expect(types.approval!.documentsMutable).toBe(false);
    for (const t of ['profile', 'operator', 'looking', 'group', 'seat', 'invite']) expect(types[t]!.documentsMutable).toBe(true);
  });

  it.each([13, 14])('passes evo-sdk 5.0.0-rc.8 full validation at PV%i, round-trips and builds a create transition', (pv) => {
    const c = new w.DataContract({ ownerId: OWNER_B58, identityNonce: 1n, schemas: cairn, fullValidation: true, platformVersion: pv });
    const again = w.DataContract.fromBytes(c.toBytes(pv), true, pv);
    expect(Object.keys(again.schemas).sort()).toEqual([...DOC_TYPES].sort());
    const t = new w.DataContractCreateTransition(c, 1n, pv);
    // well under the 20,480 B state transition limit
    expect(t.toBytes().length).toBeLessThan(20_480);
  });

  it('evo-sdk rejects a broken variant (the engine is really validating)', () => {
    const bad = JSON.parse(JSON.stringify(cairn));
    bad.profile.properties.displayName.type = 'nonsense';
    expect(() => new w.DataContract({ ownerId: OWNER_B58, identityNonce: 1n, schemas: bad, fullValidation: true, platformVersion: 14 })).toThrow();
  });

  it('has one deployment record per network', () => {
    expect(Object.keys(DEPLOYMENTS).sort()).toEqual(['mainnet', 'testnet']);
    expect(contractIdFor('mainnet')).toBeNull();
    expect(contractIdFor('testnet')).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  });
});
