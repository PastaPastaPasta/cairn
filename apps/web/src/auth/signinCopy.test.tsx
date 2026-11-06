// @vitest-environment happy-dom
// The sign-in sheet's naming, order and passkey offer: "Cairn account phrase", Create first, the wallet option as one muted line,
// "Pay ~0.005 DASH", and an offer to stay signed in with a passkey after an account is created or restored. Keys are never stored.
import { storageFundingStore } from '@cairn/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, flush, render, type } from '../test/render.tsx';
import { formatCreditsShort } from './runtime.ts';

const ID = '8GqCCpTFpgPREMUTqHESkuDMvkrfwBEd45fVeLUEYKYL';
const openSheet = vi.fn();
const closeSheet = vi.fn();
const signIn = vi.fn();
const auth = {
  session: { identityId: ID, source: 'seed', wallet: {} } as { identityId: string; source: string; wallet: unknown } | null,
  contractId: ID, network: 'testnet', store: storageFundingStore(localStorage), openSheet, closeSheet, signIn,
  platform: async () => ({}), refreshBalance: () => {}, dapi: () => ({}),
};
let support: 'yes' | 'no' = 'yes';
vi.mock('./context.tsx', () => ({ useAuth: () => auth }));
vi.mock('@cairn/auth', async (orig) => ({
  ...(await orig<typeof import('@cairn/auth')>()),
  listPasskeys: async () => [],
  isValidPhrase: () => true,
  discoverIdentities: async () => [{ identityId: ID, identityIndex: 0 }],
  signInWithSeed: async () => ({ identityId: ID }),
}));
vi.mock('@cairn/auth/webauthn', () => ({
  createPasskey: vi.fn(), getPasskeyPrf: vi.fn(), forgetPasskey: vi.fn(), PasskeyError: class extends Error {}, prfSupport: async () => support, PRF_UNAVAILABLE_MESSAGE: '', userHandleFor: vi.fn(),
}));
const { Choose, CreateFlow, PhraseSignIn } = await import('./AuthSheet.tsx');
const { PasskeyOffer } = await import('./Passkeys.tsx');

const norm = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');
const storageSnapshot = () => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  support = 'yes';
  auth.session = { identityId: ID, source: 'seed', wallet: {} };
});

describe('choose view', () => {
  it('leads with Create, then the Cairn account phrase, then other ways, and ends with one muted wallet line', async () => {
    const r = await render(<Choose />);
    const titles = [...r.el.querySelectorAll('.choice b')].map((b) => b.textContent);
    expect(titles).toEqual(['Create an account', 'I have a Cairn account phrase', 'Use a passkey', 'Paste a key']);
    expect(r.el.querySelector('[data-testid="wallet-signin"]')).toBeNull();
    expect(r.el.querySelector('button[disabled]')).toBeNull();
    const soon = r.el.querySelector('[data-testid="wallet-soon"]')!;
    expect(soon.textContent).toBe('Coming soon: approve sign-in from DashPay.');
    expect(soon.compareDocumentPosition(r.el.querySelector('.choices-s')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    const t = norm(r.el);
    expect(t).toContain('not your Dash Core wallet’s phrase');
    expect(t).not.toMatch(/sign-in phrase|I have a recovery phrase/i);
    await r.unmount();
  });
});

describe('create flow', () => {
  it('names the phrase, says it is not the Dash Core wallet, and calls the payment step "Pay ~0.005 DASH"', async () => {
    const r = await render(<CreateFlow />);
    const t = norm(r.el);
    expect(t).toContain('Cairn account phrase');
    expect(t).toContain('standard Dash recovery phrase');
    expect(t).toContain('Cairn never asks for that or for your wallet’s keys');
    expect(t).toContain('Pay ~0.005 DASH');
    expect(t).not.toContain('Add credit');
    await r.unmount();
  });
});

describe('stay signed in with a passkey', () => {
  it('is offered after restoring with a phrase, instead of closing the sheet', async () => {
    const r = await render(<PhraseSignIn />);
    await type(r.el.querySelector<HTMLTextAreaElement>('[data-testid="phrase-input"]')!, 'legal winner thank year wave sausage worth useful legal winner thank yellow');
    await click(button(r.el, /^Sign in$/));
    await flush();
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(openSheet).toHaveBeenCalledWith('stay');
    expect(closeSheet).not.toHaveBeenCalled();
    await r.unmount();
  });

  it('shows an add-a-passkey button and a Not now that closes it, without writing anything to browser storage', async () => {
    const before = storageSnapshot();
    const r = await render(<PasskeyOffer />);
    await flush();
    expect(norm(r.el)).toContain('Stay signed in on this device with a passkey');
    expect(button(r.el, /^Add a passkey$/)).toBeTruthy();
    await click(button(r.el, /Not now/));
    expect(closeSheet).toHaveBeenCalledTimes(1);
    expect(storageSnapshot()).toBe(before);
    await r.unmount();
  });

  it('is skipped when the session already came from a passkey', async () => {
    auth.session = { identityId: ID, source: 'passkey', wallet: null };
    const r = await render(<PasskeyOffer />);
    await flush();
    expect(r.el.querySelector('[data-testid="passkey-offer"]')).toBeNull();
    expect(closeSheet).toHaveBeenCalled();
    await r.unmount();
  });

  it('is skipped when the browser cannot do passkeys', async () => {
    support = 'no';
    const r = await render(<PasskeyOffer />);
    await flush();
    expect(r.el.querySelector('[data-testid="passkey-offer"]')).toBeNull();
    expect(closeSheet).toHaveBeenCalled();
    await r.unmount();
  });
});

describe('account credit', () => {
  it('is shown in thousandths of a DASH, truncated', () => {
    expect(formatCreditsShort(4_549_933_000n)).toBe('0.045 DASH');
    expect(formatCreditsShort(40_000_000n)).toBe('0.00040 DASH');
    expect(formatCreditsShort(0n)).toBe('0.00000 DASH');
  });
});
