// @vitest-environment happy-dom
// A page left open notices a change (F-002): a visible page re-checks the document's revision on an interval and on focus, and
// re-reads only when it moved.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../app/context.tsx';
import { render } from '../test/render.tsx';
import { WATCH_EVERY_MS, useLoad, type Watch } from './cairn.ts';

vi.mock('./platform.ts', () => ({ getCairnDoc: vi.fn(), queryCairn: vi.fn() }));

let shown: ReturnType<typeof useLoad<number>> | null = null;
function Probe({ load, watch }: { load(): Promise<number>; watch: Watch<number> }) {
  shown = useLoad('k', load, watch);
  return null;
}

afterEach(() => vi.useRealTimers());

describe('watching an open page', () => {
  it('re-reads when the revision moved, and says so', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let stored = 1;
    const load = vi.fn(async () => stored);
    const version = vi.fn(async () => String(stored));
    const r = await render(
      <AppProvider>
        <Probe load={load} watch={{ version, of: (d) => String(d) }} />
      </AppProvider>,
    );
    await act(async () => {});
    expect(shown!.status).toBe('ready');
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTime(WATCH_EVERY_MS));
    expect(version).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(shown!.updated).toBe(false);

    stored = 2;
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(2);
    expect(shown!.status === 'ready' && shown!.data).toBe(2);
    expect(shown!.updated).toBe(true);
    await r.unmount();
  });
});
