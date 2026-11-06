// /looking: members looking for a group, and the signed-in member's own post (M3) with their matches (M4).
import { LOOKING_STATUS, type Looking } from '@cairn/contract';
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { LISTED_OPERATORS, LOOKING, OPEN_LOOKING, OPERATORS, useStatusList } from '../data/lists.ts';
import { usePeople } from '../data/people.ts';
import { openSignIn } from '../ui/Account.tsx';
import { Loaded } from '../ui/Loaded.tsx';
import { LookingEditor, LookingSummary } from '../ui/LookingEditor.tsx';
import { Matches } from '../ui/Matches.tsx';
import { HiddenNote, HideButton, useHidden } from '../ui/hidden.tsx';
import { PersonName } from '../ui/Person.tsx';
import { NotOpenHere, PageHead } from '../ui/states.tsx';
import '../styles/matching.css';

export function LookingPage() {
  const { registry } = useApp();
  const { session } = useAccount();
  const list = useStatusList(LOOKING, OPEN_LOOKING, !!registry.contractId);
  const ops = useStatusList(OPERATORS, LISTED_OPERATORS, !!registry.contractId);
  const [mine, setMine] = useState<Looking | null>(null);
  const onMine = useCallback((l: Looking | null) => setMine(l), []);
  const hidden = useHidden();
  const items = list.status === 'ready' ? list.data.items : [];
  const people = usePeople(items.map((l) => l.ownerId));
  const visible = (all: Looking[]) => all.filter((l) => l.ownerId === session?.identityId || !hidden.has(l.ownerId));
  const opMap = new Map((ops.status === 'ready' ? ops.data.items : []).map((o) => [o.ownerId, o]));
  return (
    <div className="page">
      <PageHead title="Looking for a group" lede="People who have said how much they can bring and what terms they would accept. Organizers whose group they fit can invite them." />
      {!registry.contractId ? (
        <NotOpenHere />
      ) : (
        <div className="two-col two-col-wide-side">
          <section aria-labelledby="looking-list-title">
            <h2 id="looking-list-title" className="visually-hidden">
              Everyone looking
            </h2>
            <Loaded
              load={list}
              retry={list.reload}
              isEmpty={(d) => d.items.length === 0}
              empty={
                <>
                  <p>
                    <b>Nobody is looking on {registry.label} right now.</b>
                  </p>
                  <p>Be the first: post your amount and the terms you accept, and organizers can invite you.</p>
                </>
              }
            >
              {(d) => (
                <>
                  <p className="small muted list-count">
                    {visible(d.items).length} {visible(d.items).length === 1 ? 'person' : 'people'} looking
                  </p>
                  <ul className="rows" data-testid="looking-rows">
                    {visible(d.items).map((l) => (
                      <li key={l.id} className="row row-looking">
                        <div className="row-main">
                          <p className="row-title">
                            <PersonName id={l.ownerId} person={people.get(l.ownerId)} you={l.ownerId === session?.identityId} />
                          </p>
                          <LookingSummary l={l} operators={opMap} />
                          {l.note && <p className="row-note small">{l.note}</p>}
                        </div>
                        {l.ownerId !== session?.identityId && (
                          <div className="row-side">
                            <HideButton id={l.ownerId} name={people.get(l.ownerId)?.name} hidden={hidden} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  <HiddenNote count={d.items.length - visible(d.items).length} />
                  {d.more && (
                    <button type="button" className="btn btn-s" onClick={list.showOlder}>
                      Show older posts
                    </button>
                  )}
                </>
              )}
            </Loaded>
          </section>
          <aside className="side-card" aria-labelledby="my-looking-title">
            <h2 id="my-looking-title" className="h3">
              {mine ? 'Your post' : 'Post that you’re looking'}
            </h2>
            {session ? (
              <LookingEditor identityId={session.identityId} onChange={onMine} onSaved={list.reload} />
            ) : (
              <>
                <p>Say how much you can bring and what terms you accept. Organizers whose group fits can invite you.</p>
                <button type="button" className="btn btn-primary" onClick={openSignIn}>
                  Sign in to post
                </button>
              </>
            )}
            <p className="small muted">
              Organizing a group? Open its page to see who fits and invite them. <Link to="/groups/new">Open a group</Link>
            </p>
          </aside>
        </div>
      )}
      {session && mine?.status === LOOKING_STATUS.open && (
        <section className="section" aria-labelledby="matches-title">
          <h2 id="matches-title">Your matches</h2>
          <Matches me={mine} />
        </section>
      )}
    </div>
  );
}
