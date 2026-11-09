// @vitest-environment happy-dom
// Starting a group never writes a second group, and "Finish" completes the plan that wrote the group, not whatever the page now asks.
import { GROUP_FLAG, GROUP_STATUS, MN_TYPE, type DocOp } from '@cairn/contract';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../app/context.tsx';
import { A, D, GID } from '../matching/fixtures.ts';
import { render } from '../test/render.tsx';
import { useStartGroup, type StartPlan } from './startGroup.ts';

const sent = vi.hoisted(() => ({ ops: [] as DocOp[], fail: new Set<string>(), gid: '' }));
vi.mock('./write.ts', async (orig) => {
  const real = await orig<typeof import('./write.ts')>();
  return {
    ...real,
    useWrite: () => async (op: DocOp | (() => DocOp)) => {
      const o = typeof op === 'function' ? op() : op;
      sent.ops.push(o);
      if (sent.fail.has(o.type)) {
        sent.fail.delete(o.type);
        if (o.type === 'group') throw new real.UnconfirmedWrite('not read back yet', sent.gid);
        throw new Error('no credit');
      }
      return { $id: o.type === 'group' ? sent.gid : sent.gid.replace(/^./, '2') };
    },
  };
});

const plan = (amount: number): StartPlan => ({
  fields: { title: 'Basalt 27', mnType: MN_TYPE.regular, operatorId: null, rewardBps: 1000, earlyPeriodBlocks: 0, earlyPenalty: 0, roster: [{ id: A, amount: D(amount) }], termsRevision: 1, status: GROUP_STATUS.forming, flags: GROUP_FLAG.openAmounts },
  mySeat: { amount: D(amount), flags: 0 },
});

async function harness() {
  let hook!: ReturnType<typeof useStartGroup>;
  const Probe = () => {
    hook = useStartGroup();
    return null;
  };
  const r = await render(
    <AppProvider>
      <Probe />
    </AppProvider>,
  );
  return { get: () => hook, r };
}

const kinds = () => sent.ops.map((o) => `${o.action}:${o.type}`);
const seatAmount = () => (sent.ops.filter((o) => o.type === 'seat').at(-1) as { data?: { amount?: number } }).data?.amount;

describe('starting a group', () => {
  beforeEach(() => {
    localStorage.setItem('cairn.profile.v1', 'testnet');
    sent.ops = [];
    sent.fail = new Set();
    sent.gid = GID;
  });
  afterEach(() => localStorage.clear());

  it('finishes the seat of the group it wrote, at that group’s amount, after the seat write failed', async () => {
    const h = await harness();
    sent.fail.add('seat');
    const then = vi.fn();
    await act(() => h.get().start(plan(300), then));
    expect(h.get().createdId).toBe(GID);
    expect(h.get().pending?.mySeat?.amount).toBe(D(300));
    await act(() => h.get().start(plan(250), then));
    expect(kinds()).toEqual(['create:group', 'create:seat', 'create:seat']);
    expect(seatAmount()).toBe(D(300));
    expect(then).toHaveBeenCalledWith(GID);
    await h.r.unmount();
  });

  it('never writes the group again when Platform accepted it but the read-back failed', async () => {
    const h = await harness();
    sent.fail.add('group');
    await act(() => h.get().start(plan(300), () => {}));
    expect(h.get().createdId).toBe(GID);
    await act(() => h.get().start(plan(400), () => {}));
    expect(kinds()).toEqual(['create:group', 'create:seat']);
    expect(seatAmount()).toBe(D(300));
    await h.r.unmount();
  });
});
