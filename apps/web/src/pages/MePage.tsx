// /me: the signed-in member's own things. Today: the profile, written through the vendored document writer and read back with a
// proved query, which is the end-to-end proof that writes work. Groups, seats, approvals and the listing come next.
import { CONTACT_KINDS, DocError, ROLE, createOp, profileData, replaceOp, type ContactKind, type Contacts, type Profile } from '@cairn/contract';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { formatCredits } from '../auth/runtime.ts';
import { invalidateProfile, readProfile, useProfile } from '../data/profile.ts';
import { openSignIn } from '../ui/Account.tsx';
import { NotOpenHere, PageHead } from '../ui/states.tsx';
import { useAction } from '../ui/useAction.ts';

const CONTACT_LABELS: Record<ContactKind, { label: string; hint: string }> = {
  discord: { label: 'Discord', hint: 'username' },
  yappr: { label: 'Yappr', hint: 'username on yap.pr' },
  telegram: { label: 'Telegram', hint: '@handle' },
  matrix: { label: 'Matrix', hint: '@you:server.org' },
  dashpay: { label: 'DashPay', hint: 'username' },
  website: { label: 'Website', hint: 'https://…' },
};

/** Characters that let one name pass for another: direction overrides, zero-width and other invisible marks (govhub D-035). */
const DECEPTIVE = /[​-‏‪-‮⁠-⁩﻿­]/;
export function nameProblem(name: string): string | null {
  if (DECEPTIVE.test(name)) return 'Remove invisible or text-direction characters from the name.';
  if (!name.trim()) return 'Enter a name.';
  return null;
}

export default function MePage() {
  const { registry } = useApp();
  const { session } = useAccount();
  if (!registry.contractId)
    return (
      <div className="page">
        <PageHead title="My profile" />
        <NotOpenHere />
      </div>
    );
  if (!session)
    return (
      <div className="page">
        <PageHead title="My profile" lede="Your groups, seats, approvals and profile live here once you sign in." />
        <div className="soon">
          <p>
            <b>Sign in to make your profile.</b> Browsing needs no account. A profile lets groups and operators know who you are and how to reach you.
          </p>
          <p>
            <button type="button" className="btn btn-primary" onClick={openSignIn}>
              Sign in or create an account
            </button>
          </p>
        </div>
      </div>
    );
  return <ProfileEditor identityId={session.identityId} />;
}

function ProfileEditor({ identityId }: { identityId: string }) {
  const { registry } = useApp();
  const { write, balance } = useAccount();
  const { profile, dpns, loading, error: readError } = useProfile(identityId);
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [contacts, setContacts] = useState<Contacts>({});
  const [roles, setRoles] = useState<number>(ROLE.member);
  const [saved, setSaved] = useState<{ revision: number; height: number | null } | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (loading) return;
    setName(profile?.displayName ?? dpns ?? '');
    setAbout(profile?.about ?? '');
    setContacts(profile?.contacts ?? {});
    setRoles(profile?.roles || ROLE.member);
  }, [profile, dpns, loading]);

  const problem = name ? nameProblem(name) : null;
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return;
    setSaved(null);
    void run(async () => {
      let data;
      try {
        data = profileData({ displayName: name, about, contacts, roles });
      } catch (err) {
        throw err instanceof DocError ? new Error(err.message) : err;
      }
      const contractId = registry.contractId!;
      const op = profile ? replaceOp(contractId, 'profile', profile.id, profile.revision, data) : createOp(contractId, 'profile', data);
      await write(op);
      // read it back with a proof: what Platform stores, not what this page sent
      const back = await readProfile(registry, identityId);
      if (!back.profile || back.profile.displayName !== name.trim()) throw new Error('The profile was sent, but Platform does not show it yet. Reload in a minute.');
      invalidateProfile();
      setSaved({ revision: back.profile.revision, height: back.height });
    });
  };

  return (
    <div className="page me">
      <PageHead title="My profile" lede="How groups, operators and people looking for a group see you. Everything here is public on Dash Platform." />
      <div className="me-layout">
        <form className="form profile-form" onSubmit={save} aria-busy={busy} data-testid="profile-form">
          <fieldset disabled={busy || loading}>
            <legend className="visually-hidden">Profile</legend>
            <label>
              Display name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required aria-describedby="name-help" autoComplete="nickname" />
              <span id="name-help" className="small muted">
                {dpns ? `Your Dash username is ${dpns}; it is shown next to this name.` : 'Up to 64 characters.'}
              </span>
            </label>
            {problem && (
              <p className="error small" role="alert">
                {problem}
              </p>
            )}
            <label>
              About you <span className="small muted">(optional)</span>
              <textarea value={about} onChange={(e) => setAbout(e.target.value)} maxLength={500} rows={4} />
            </label>
            <fieldset className="roles-pick">
              <legend>I am here as</legend>
              <label className="check">
                <input type="checkbox" checked={!!(roles & ROLE.member)} onChange={(e) => setRoles((r) => (e.target.checked ? r | ROLE.member : r & ~ROLE.member))} />
                A co-owner (I bring a share)
              </label>
              <label className="check">
                <input type="checkbox" checked={!!(roles & ROLE.operator)} onChange={(e) => setRoles((r) => (e.target.checked ? r | ROLE.operator : r & ~ROLE.operator))} />
                An operator (I run masternodes)
              </label>
            </fieldset>
            <fieldset className="contacts">
              <legend>Contact handles</legend>
              <p className="small muted">Only what you fill in is published. Leave a handle empty to keep it to yourself.</p>
              <div className="contact-grid">
                {CONTACT_KINDS.map((k) => (
                  <label key={k}>
                    {CONTACT_LABELS[k].label}
                    <input
                      value={contacts[k] ?? ''}
                      onChange={(e) => setContacts((c) => ({ ...c, [k]: e.target.value }))}
                      placeholder={CONTACT_LABELS[k].hint}
                      maxLength={k === 'website' ? 100 : 64}
                      spellCheck={false}
                      autoCapitalize="off"
                      inputMode={k === 'website' ? 'url' : 'text'}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="small muted">
              Saving costs about 0.0005 DASH of credit{balance !== null ? `; you have ${formatCredits(balance)}` : ''}.
            </p>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={busy || loading || !!problem} data-testid="profile-save">
                {busy ? 'Saving…' : profile ? 'Save changes' : 'Create profile'}
              </button>
            </div>
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {saved && (
            <p className="notice-ok" role="status" data-testid="profile-saved">
              Saved and read back from Dash Platform{saved.height ? ` at block ${saved.height.toLocaleString('en-US')}` : ''} (version {saved.revision}).
            </p>
          )}
          {readError && <p className="error small">Could not read your profile: {readError}</p>}
        </form>
        <aside className="me-side" aria-label="Your account">
          <h2>Your account</h2>
          <p className="small muted">Identity</p>
          <p className="mono-ish break small" data-testid="me-identity">
            {identityId}
          </p>
          {dpns && (
            <>
              <p className="small muted">Dash username</p>
              <p data-testid="me-dpns">{dpns}</p>
            </>
          )}
          <ProfileStatus profile={profile} loading={loading} />
          <h2>Coming next</h2>
          <p className="small">
            Your groups, seats and approvals, and posting that you are looking. See <Link to="/learn">how a group forms</Link>.
          </p>
        </aside>
      </div>
    </div>
  );
}

function ProfileStatus({ profile, loading }: { profile: Profile | null; loading: boolean }) {
  if (loading) return <p className="small muted">Reading your profile…</p>;
  if (!profile) return <p className="small">No profile on Platform yet.</p>;
  return (
    <p className="small">
      Profile on Platform, version {profile.revision}
      {profile.updatedAt ? `, saved ${new Date(profile.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}.
    </p>
  );
}
