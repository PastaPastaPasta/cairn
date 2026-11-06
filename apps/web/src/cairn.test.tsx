// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, loadProfile, PROFILES } from './config/registry.ts';
import { parseActivation } from './data/activation.ts';
import fixture from './data/fixtures/activation-mainnet-2026-11-06.json';
import { nameProblem, profileData, toProfile, type Profile } from '@cairn/contract';
import { personName } from './data/profile.ts';
import { holdsWrite } from './pages/MePage.tsx';
import { render } from './test/render.tsx';
import { activationWords } from './ui/Activation.tsx';
import { SAMPLE_STONES, sampleCaption } from './pages/HomePage.tsx';
import { CairnStack, cairnLayout, cairnSummary, type Stone } from './ui/CairnStack.tsx';

const stones: Stone[] = [
  { id: 'a', label: 'Lena', amount: 300, state: 'approved' },
  { id: 'b', label: 'Marco', amount: 200, state: 'in' },
  { id: 'c', label: 'Kim', amount: 100, state: 'requested' },
];

describe('the cairn', () => {
  it('says in words what the stones show; a requested seat does not count', () => {
    expect(cairnSummary(stones, 1000)).toBe('500 of 1000 DASH from 2 co-owners. 500 DASH still open. One person has asked for a seat.');
    expect(cairnSummary([{ id: 'x', label: 'X', amount: 1000, state: 'signed' }], 1000)).toBe('1000 of 1000 DASH from one co-owner. Full.');
  });

  it('draws one stone per counted share, lists every share with its state, and hides the drawing from assistive tech', async () => {
    const r = await render(<CairnStack stones={stones} />);
    expect(r.el.querySelectorAll('svg path.stone-in, svg path.stone-approved')).toHaveLength(2);
    expect(r.el.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    const items = [...r.el.querySelectorAll('.cairn-legend li')].map((li) => li.textContent);
    // top down, as drawn: what is open, the ask on top of the stack, then the shares
    expect(items).toEqual(['Open400 DASHstill open', 'Kim100 DASHasked for a seat', 'Marco200 DASHin the group', 'Lena300 DASHapproved the terms']);
    await r.unmount();
  });

  it('stacks an ask on the cairn, not inside the open space, and labels the open remainder with its size', async () => {
    expect(cairnLayout(stones, 1000)).toMatchObject({ asked: [{ id: 'c', amount: 100 }], open: 400 });
    // asks never draw past 1000: the second is cut to what is left, the third is not drawn
    const crowded = cairnLayout([...stones, { id: 'd', label: 'D', amount: 450, state: 'requested' }, { id: 'e', label: 'E', amount: 100, state: 'requested' }], 1000);
    expect(crowded.asked.map((s) => [s.id, s.amount])).toEqual([['c', 100], ['d', 400]]);
    expect(crowded.open).toBe(0);
    const r = await render(<CairnStack stones={stones} />);
    expect(r.el.querySelector('.stone-open + .stone-open-label')?.textContent).toBe('400 open');
    expect(r.el.querySelectorAll('.stone-asked-group path.stone-requested')).toHaveLength(1);
    await r.unmount();
  });

  it('hatches every stone of a closed group', async () => {
    const r = await render(<CairnStack stones={stones} closed />);
    const fills = [...r.el.querySelectorAll<SVGElement>('path.stone-in, path.stone-approved')].map((p) => p.style.fill);
    expect(fills).toHaveLength(2);
    expect(fills.every((f) => f.startsWith('url('))).toBe(true);
    expect(r.el.querySelector('figure')!.className).toContain('cairn-closed');
    await r.unmount();
  });

  it('the home page sample adds up: three co-owners in, the visitor asking, and the rest open', async () => {
    expect(sampleCaption(SAMPLE_STONES)).toBe('A sample group: 650 of 1000 DASH. Your 100 makes 750; 250 more and it’s full.');
    expect(SAMPLE_STONES.find((s) => s.mine)).toMatchObject({ label: 'You', state: 'requested' });
    expect(cairnLayout(SAMPLE_STONES, 1000).open).toBe(250);
    const r = await render(<CairnStack stones={SAMPLE_STONES} caption={sampleCaption(SAMPLE_STONES)} />);
    expect(r.el.querySelector('.stone-open-label')?.textContent).toBe('250 open');
    expect(r.el.querySelector('.cairn-key-mine')?.textContent).toBe('You100 DASHasking for a seat');
    await r.unmount();
  });

  it('keeps a stone’s shape between renders', async () => {
    const a = await render(<CairnStack stones={stones} />);
    const b = await render(<CairnStack stones={stones} />);
    expect(a.el.querySelector('path.stone')!.getAttribute('d')).toBe(b.el.querySelector('path.stone')!.getAttribute('d'));
    await a.unmount();
    await b.unmount();
  });
});

describe('mainnet activation from Radar', () => {
  it('reads the recorded answer', () => {
    const a = parseActivation(fixture)!;
    expect(a).toMatchObject({ state: 'defined', active: false, tipHeight: 2_567_869, earliest: { height: 2_580_480 } });
    expect(activationWords(a)).toMatchObject({ title: 'Waiting for mainnet signalling', step: 0 });
  });

  it('words each later state, and refuses an answer it cannot read', () => {
    const base = parseActivation(fixture)!;
    expect(activationWords({ ...base, state: 'started', window: { count: 1200, mined: 2000, size: 4032, threshold: 3226 } }).detail).toMatch(/1,200 blocks signalled .* 3,226 needed/);
    expect(activationWords({ ...base, state: 'locked_in' }).step).toBe(2);
    expect(activationWords({ ...base, state: 'active', active: true }).title).toMatch(/live on mainnet/);
    expect(parseActivation({ deployments: [] })).toBeNull();
    expect(parseActivation(null)).toBeNull();
  });
});

describe('network profiles', () => {
  it('default to Testnet while mainnet has no contract, and keep Mainnet read-only', () => {
    expect(PROFILES.testnet.contractId).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(PROFILES.mainnet.contractId).toBeNull();
    expect(DEFAULT_PROFILE).toBe('testnet');
    expect(loadProfile({ getItem: () => 'mainnet' })).toBe('mainnet');
    expect(loadProfile({ getItem: () => 'nonsense' })).toBe('testnet');
    expect(loadProfile(null)).toBe('testnet');
  });
});

const ID = 'GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec';

describe('display names', () => {
  it('refuse invisible and direction characters', () => {
    expect(nameProblem('Lena')).toBeNull();
    expect(nameProblem('Le\u202Ena')).toMatch(/invisible/);
    expect(nameProblem('Le\u200Bna')).toMatch(/invisible/);
    expect(nameProblem('   ')).toMatch(/Enter/);
    expect(nameProblem('Verified Lena')).toMatch(/badge/);
  });

  const profile = (displayName: string): Profile => toProfile({ $id: ID, $ownerId: ID, $revision: 2, displayName });

  it('show the proved Dash username first, then the own name, quoted when it imitates a label', () => {
    expect(personName(profile('Lena'), 'lena.dash')).toBe('lena.dash');
    expect(personName(profile('Lena'), null)).toBe('Lena');
    expect(personName(profile('Verified Lena'), null)).toBe('“Verified Lena”');
    expect(personName(profile('\u200B'), null)).toBeNull();
    expect(personName(null, null)).toBeNull();
  });
});

describe('profile read-back', () => {
  const sent = profileData({ displayName: 'Lena', about: 'Lisbon', contacts: { discord: 'lena', website: 'https://lena.example' }, roles: 1 });
  const back = (over: Record<string, unknown>) => toProfile({ $id: ID, $ownerId: ID, $revision: 3, ...sent, ...over });

  it('accepts only a document holding every field the write sent', () => {
    expect(holdsWrite(back({}), sent)).toBe(true);
    expect(holdsWrite(back({ about: 'Porto' }), sent)).toBe(false);
    expect(holdsWrite(back({ roles: 0 }), sent)).toBe(false);
    expect(holdsWrite(back({ contacts: '{"discord":"lena"}' }), sent)).toBe(false);
    expect(holdsWrite(back({ about: undefined }), sent)).toBe(false);
  });
});
