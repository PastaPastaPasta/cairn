// Platform reads never hang a page (F-010): a node that accepts a request and never answers costs one deadline, then the read is
// tried again (the SDK picks a node per request), then it fails with plain words. Links with a malformed id read as "no such record".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROFILES } from '../config/registry.ts';
import { GID } from '../matching/fixtures.ts';

const answers: Array<'hang' | 'ok'> = [];
const getWithProof = vi.fn(() => (answers.shift() === 'hang' ? new Promise(() => {}) : Promise.resolve({ data: { toJSON: () => ({ $id: GID }) } })));
const queryWithProof = vi.fn(async () => ({ data: new Map() }));
vi.mock('@dashevo/evo-sdk', () => ({
  ensureInitialized: async () => {},
  EvoSDK: class {
    documents = { getWithProof, queryWithProof };
    contracts = { fetch: async () => ({}) };
    async connect() {}
  },
}));

const { PlatformTimeout, READ_DEADLINE_MS, getCairnDoc, queryCairn } = await import('./platform.ts');
const r = PROFILES.testnet;

afterEach(() => {
  vi.useRealTimers();
  answers.length = 0;
  getWithProof.mockClear();
  queryWithProof.mockClear();
});

describe('Platform reads under a deadline', () => {
  // the SDK module loads (a dynamic import) before any deadline starts
  it('connects', async () => {
    await expect(getCairnDoc(r, 'group', GID)).resolves.toEqual({ $id: GID });
  });

  it('tries a hung read once more, then answers', async () => {
    vi.useFakeTimers();
    answers.push('hang', 'ok');
    const read = getCairnDoc(r, 'group', GID);
    await vi.advanceTimersByTimeAsync(READ_DEADLINE_MS + 1);
    await expect(read).resolves.toEqual({ $id: GID });
    expect(getWithProof).toHaveBeenCalledTimes(2);
  });

  it('tries once more after a node drops the connection', async () => {
    getWithProof.mockImplementationOnce(() => Promise.reject(new Error('Failed to fetch')));
    await expect(getCairnDoc(r, 'group', GID)).resolves.toEqual({ $id: GID });
    expect(getWithProof).toHaveBeenCalledTimes(2);
  });

  it('gives up with a plain timeout when every attempt hangs', async () => {
    vi.useFakeTimers();
    answers.push('hang', 'hang');
    const read = getCairnDoc(r, 'group', GID).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2 * READ_DEADLINE_MS + 1);
    const e = await read;
    expect(e).toBeInstanceOf(PlatformTimeout);
    expect((e as Error).message).toMatch(/did not answer in time/);
  });

  it('reads a malformed id as no document, without asking Platform', async () => {
    await expect(getCairnDoc(r, 'group', 'notarealid')).resolves.toBeNull();
    await expect(queryCairn(r, { documentTypeName: 'seat', where: [['groupId', '==', '2'.repeat(32)]], orderBy: [['$ownerId', 'asc']], limit: 100 })).resolves.toEqual({ docs: [], height: null });
    expect(getWithProof).not.toHaveBeenCalled();
    expect(queryWithProof).not.toHaveBeenCalled();
  });
});
