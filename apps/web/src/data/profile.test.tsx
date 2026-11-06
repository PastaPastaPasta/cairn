// @vitest-environment happy-dom
// After a save, every useProfile shows the document read back with the write, without asking a (possibly lagging) node again.
import { describe, expect, it, vi } from 'vitest';
import { profileData, toProfile } from '@cairn/contract';
import { AppProvider } from '../app/context.tsx';
import { PROFILES } from '../config/registry.ts';
import { flush, render } from '../test/render.tsx';
import * as platform from './platform.ts';
import { seedProfile, useProfile } from './profile.ts';

const ID = 'GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec';
const profile = (revision: number, displayName: string) => toProfile({ $id: ID, $ownerId: ID, $revision: revision, ...profileData({ displayName }) });

function Probe() {
  const { profile: p, loading } = useProfile(ID);
  return <output>{loading ? 'loading' : `${p?.displayName} v${p?.revision}`}</output>;
}

describe('seedProfile', () => {
  it('replaces the cached profile and updates mounted readers with no new query', async () => {
    const query = vi.spyOn(platform, 'queryCairn');
    seedProfile(PROFILES.testnet, ID, profile(1, 'Lena'));
    const r = await render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    );
    await flush();
    expect(r.el.textContent).toBe('Lena v1');
    seedProfile(PROFILES.testnet, ID, profile(2, 'Lena K'));
    await flush();
    expect(r.el.textContent).toBe('Lena K v2');
    expect(query).not.toHaveBeenCalled();
    await r.unmount();
  });
});
