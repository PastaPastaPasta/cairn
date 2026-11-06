// /me: the signed-in identity's own things, each with its next step: groups (as organizer, co-owner, requester, invitee or
// operator), the looking post and its matches, the operator listing, and the profile. Every write goes through the vendored
// document writer and is read back with a proof.
import { CONTACT_KINDS, DocError, LOOKING_STATUS, ROLE, createOp, nameProblem, profileData, replaceOp, toProfile, type ContactKind, type Contacts, type DocData, type Looking, type Profile } from '@cairn/contract';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { formatCredits } from '../auth/runtime.ts';
import { forgetPerson } from '../data/people.ts';
import { readProfile, seedProfile, useProfile } from '../data/profile.ts';
import { openSignIn } from '../ui/Account.tsx';
import { LookingEditor } from '../ui/LookingEditor.tsx';
import { Matches } from '../ui/Matches.tsx';
import { GroupsNeedingOperator, MyGroups } from './me/MyGroups.tsx';
import { OperatorEditor, useMyOperator } from './me/OperatorEditor.tsx';
import '../styles/matching.css';
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

/** Whether a profile read back from Platform holds exactly the fields a write sent. */
export function holdsWrite(back: Profile, sent: DocData): boolean {
  const want = toProfile({ $id: back.id, $ownerId: back.ownerId, ...sent });
  const fields = (p: Profile) => JSON.stringify([p.displayName, p.about ?? null, p.contacts, p.roles]);
  return fields(back) === fields(want);
}

export default function MePage() {
  const { registry } = useApp();
  const { session } = useAccount();
  if (!registry.contractId)
    return (
      <div className="page">
        <PageHead title="My Cairn" />
        <NotOpenHere />
      </div>
    );
  if (!session)
    return (
      <div className="page">
        <PageHead title="My Cairn" lede="Your groups, seats, invitations, approvals, your looking post and operator listing, and your profile live here once you sign in." />
        <div className="soon">
          <p>
            <b>Sign in to see your groups and make your profile.</b> Browsing needs no account. A profile lets groups and operators know who you are and how to reach you.
          </p>
          <p>
            <button type="button" className="btn btn-primary" onClick={openSignIn}>
              Sign in or create an account
            </button>
          </p>
        </div>
      </div>
    );
  return <MeDashboard identityId={session.identityId} />;
}

const SECTIONS = [
  { id: 'groups', label: 'Groups' },
  { id: 'looking', label: 'Looking' },
  { id: 'operator', label: 'Operator' },
  { id: 'profile', label: 'Profile' },
];

function MeDashboard({ identityId }: { identityId: string }) {
  const listing = useMyOperator(identityId);
  const isOperator = listing.status === 'ready' && !!listing.data;
  const [looking, setLooking] = useState<Looking | null>(null);
  const onLooking = useCallback((l: Looking | null) => setLooking(l), []);
  return (
    <div className="page me">
      <PageHead title="My Cairn" lede="What needs you next, in every group you are part of, and how others see you.">
        <nav className="me-nav" aria-label="On this page">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.label}
            </a>
          ))}
        </nav>
      </PageHead>
      <section className="me-section" id="groups" aria-labelledby="me-groups">
        <h2 id="me-groups">Your groups and next steps</h2>
        <MyGroups me={identityId} isOperator={isOperator} />
      </section>
      <section className="me-section" id="looking" aria-labelledby="me-looking">
        <h2 id="me-looking">Looking for a group</h2>
        <div className="side-card">
          <LookingEditor identityId={identityId} onChange={onLooking} />
        </div>
        {looking?.status === LOOKING_STATUS.open && (
          <>
            <h3 className="me-sub">Your matches</h3>
            <Matches me={looking} />
          </>
        )}
      </section>
      <section className="me-section" id="operator" aria-labelledby="me-operator">
        <h2 id="me-operator">Operator listing</h2>
        <p className="muted">If you run masternodes, list yourself so groups can choose you. Skip this if you only bring a share.</p>
        <div className="side-card">
          <OperatorEditor identityId={identityId} />
        </div>
        {isOperator && (
          <>
            <h3 className="me-sub">Groups that need an operator</h3>
            <GroupsNeedingOperator />
          </>
        )}
      </section>
      <section className="me-section" id="profile" aria-labelledby="me-profile">
        <h2 id="me-profile">Profile</h2>
        <ProfileEditor identityId={identityId} />
      </section>
    </div>
  );
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
    setName(profile?.displayName || dpns || '');
    setAbout(profile?.about ?? '');
    setContacts(profile?.contacts ?? {});
    setRoles(profile?.roles ?? ROLE.member);
  }, [profile, dpns, loading]);

  const problem = name ? nameProblem(name) : null;
  // without a successful read the page cannot know whether a profile exists: a create would hit the unique index and still cost a fee
  const blocked = !!problem || !!readError;
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (blocked) return;
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
      const done = await write(op);
      // read it back with a proof: what Platform stores, not what this page sent; a lagging node may still serve the old revision
      const want = done.revision ?? 1;
      let back = await readProfile(registry, identityId);
      for (let i = 0; i < 5 && (back.profile?.revision ?? 0) < want; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        back = await readProfile(registry, identityId);
      }
      if (!back.profile || back.profile.revision < want) throw new Error('Platform confirmed the change, but the node read now does not show it yet. Reload in a minute.');
      if (!holdsWrite(back.profile, data)) throw new Error('Platform now holds a different profile than this page sent (another tab or app may have changed it). Reload before you edit again.');
      seedProfile(registry, identityId, back.profile);
      forgetPerson(registry, identityId);
      setSaved({ revision: back.profile.revision, height: back.height });
    });
  };

  return (
    <div>
      <p className="muted">How groups, operators and people looking for a group see you. Everything here is public on Dash Platform.</p>
      <div className="me-layout">
        <form className="form profile-form" onSubmit={save} aria-busy={busy} data-testid="profile-form">
          <fieldset disabled={busy || loading}>
            <legend className="visually-hidden">Profile</legend>
            <label>
              Display name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required aria-describedby="name-help" autoComplete="nickname" />
              <span id="name-help" className="small muted">
                {dpns ? `Your Dash username ${dpns} is shown first, with this name next to it.` : 'Up to 64 characters.'}
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
              <button type="submit" className="btn btn-primary" disabled={busy || loading || blocked} data-testid="profile-save">
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
          {readError && <p className="error small">Could not read your profile, so saving is off until it can be read: {readError}. Reload to try again.</p>}
        </form>
        <aside className="me-side" aria-label="Your account">
          <h3>Your account</h3>
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
          <ProfileStatus profile={profile} loading={loading} failed={!!readError} />
          <p className="small">
            New here? See <Link to="/learn">how a group forms</Link>.
          </p>
        </aside>
      </div>
    </div>
  );
}

function ProfileStatus({ profile, loading, failed }: { profile: Profile | null; loading: boolean; failed: boolean }) {
  if (loading) return <p className="small muted">Reading your profile…</p>;
  if (failed) return <p className="small">Your profile could not be read.</p>;
  if (!profile) return <p className="small">No profile on Platform yet.</p>;
  return (
    <p className="small">
      Profile on Platform, version {profile.revision}
      {profile.updatedAt ? `, saved ${new Date(profile.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}.
    </p>
  );
}
