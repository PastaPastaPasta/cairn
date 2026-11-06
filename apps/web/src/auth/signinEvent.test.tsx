// @vitest-environment happy-dom
// The "open sign-in" event does nothing on a network without the cairn contract (every opener is hidden there too).
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { AccountProvider } from '../app/account.tsx';
import { AppProvider } from '../app/context.tsx';
import { render } from '../test/render.tsx';
import { openSignIn } from '../ui/Account.tsx';
import { AuthProvider, useAuth } from './context.tsx';

function SheetProbe() {
  return <output>{useAuth().sheet ?? 'closed'}</output>;
}

async function sheetAfterEvent(profile: 'testnet' | 'mainnet') {
  localStorage.setItem('cairn.profile.v1', profile);
  const r = await render(
    <AppProvider>
      <AccountProvider>
        <AuthProvider>
          <SheetProbe />
        </AuthProvider>
      </AccountProvider>
    </AppProvider>,
  );
  await act(async () => openSignIn());
  const sheet = r.el.querySelector('output')!.textContent;
  await r.unmount();
  return sheet;
}

describe('OPEN_SIGNIN_EVENT', () => {
  afterEach(() => localStorage.clear());

  it('opens the sheet where the contract exists and is ignored where it does not', async () => {
    expect(await sheetAfterEvent('testnet')).toBe('choose');
    expect(await sheetAfterEvent('mainnet')).toBe('closed');
  });
});
