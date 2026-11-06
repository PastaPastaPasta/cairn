// The vault (F13, F13b) reads go through the same PV13 query lint as the web app's queries before they reach the SDK.
import { describe, expect, it } from 'vitest';
import cairnSchemas from '@cairn/contract/cairn.json' with { type: 'json' };
import { lintQuery, type ContractSchemas, type DocQuery } from '@cairn/contract/queryLint';
import { createEvoPlatform } from '../src/evo.ts';

const CAIRN = 'HfLWUEWnp4YCQ9Mzp9DexG58WPKvHm7SahMVSuzKSQRw';
const OWNER = '9CVk5ytx8oD7WQq3R2s3PxDbpT5Skg13Xjbh2tTdmnbv';

function fakeSdk() {
  const sent: DocQuery[] = [];
  const sdk = { documents: { queryWithProof: async (q: DocQuery) => (sent.push(q), { data: new Map() }) } };
  return { sdk, sent };
}
const lint = (q: DocQuery) => lintQuery(cairnSchemas as unknown as ContractSchemas, q);

describe('auth queries pass the PV13 lint', () => {
  it('vault list (F13) and byCredential (F13b)', async () => {
    const { sdk, sent } = fakeSdk();
    const p = createEvoPlatform({} as never, sdk as never, 'mainnet');
    await p.vault!.list(CAIRN, OWNER);
    await p.vault!.byCredential(CAIRN, OWNER, new Uint8Array(16).fill(3));
    expect(sent).toHaveLength(2);
    for (const q of sent) expect(lint(q)).toMatchObject({ ok: true, index: 'byCredential' });
  });
});
