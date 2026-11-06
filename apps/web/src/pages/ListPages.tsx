// The public lists: open groups, members looking for a group, operators. Read live from the cairn contract with proofs; matching,
// filters and posting come in the next delivery step, so each page says what it will hold and what to do meanwhile.
import { GROUP_STATUS, LOOKING_STATUS, OPERATOR_STATUS, groupsByStatus, lookingByStatus, operatorsByStatus, toGroup, toLooking, toOperator, type CairnQuery, type DocMeta, type Group, type Looking, type Network, type Operator, type RawDoc } from '@cairn/contract';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/context.tsx';
import { plainErrorText } from '../auth/runtime.ts';
import { queryCairn } from '../data/platform.ts';
import { CairnStack } from '../ui/CairnStack.tsx';
import { NotOpenHere, PageHead } from '../ui/states.tsx';

const DASH = 100_000_000;
const dash = (duffs: number) => (duffs / DASH).toLocaleString('en-US', { maximumFractionDigits: 8 });
const pct = (bps: number) => `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
const shortId = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`;
/** Dash aims for one block every 2.5 minutes: 576 a day. */
const blocksToDays = (b: number) => Math.round(b / 576);

type ListState<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; items: T[] };

/** One proved query, its documents read with `read` (malformed ones skipped: the contract admits values the app must not trust). */
function useList<T extends DocMeta>(query: CairnQuery | null, read: (d: RawDoc, network: Network) => T): ListState<T> {
  const { registry } = useApp();
  const [state, setState] = useState<ListState<T>>({ status: 'loading' });
  const key = query ? JSON.stringify(query) : null;
  useEffect(() => {
    if (!query || !registry.contractId) return;
    let live = true;
    setState({ status: 'loading' });
    queryCairn(registry, query).then(
      (r) => {
        const items = r.docs.flatMap((d) => {
          try {
            return [read(d, registry.network)];
          } catch {
            return [];
          }
        });
        if (live) setState({ status: 'ready', items });
      },
      (e: unknown) => live && setState({ status: 'error', error: plainErrorText(e, 'Dash Platform') }),
    );
    return () => {
      live = false;
    };
  }, [registry, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

function ListBody<T>({ state, empty, children }: { state: ListState<T>; empty: ReactNode; children(items: T[]): ReactNode }) {
  if (state.status === 'loading')
    return (
      <p className="list-status muted" role="status">
        Reading from Dash Platform…
      </p>
    );
  if (state.status === 'error')
    return (
      <p className="list-status error" role="alert">
        {state.error}
      </p>
    );
  return state.items.length ? <>{children(state.items)}</> : <div className="empty-state">{empty}</div>;
}

function exitTerms(g: Pick<Group, 'earlyPeriodBlocks' | 'earlyPenalty'>): string {
  if (!g.earlyPeriodBlocks) return 'Anyone can leave any time, no penalty';
  return `${dash(g.earlyPenalty)} DASH penalty for leaving in the first ${blocksToDays(g.earlyPeriodBlocks)} days`;
}

export function GroupRows({ groups }: { groups: Group[] }) {
  return (
    <ul className="rows" data-testid="group-rows">
      {groups.map((g) => (
        <li key={g.id} className="row">
          <div className="row-main">
            <Link className="row-title" to={`/g/${g.id}`}>
              {g.title}
            </Link>
            <p className="row-meta small">
              {g.operatorId ? `Operator ${shortId(g.operatorId)}` : 'Operator to be chosen'}, takes {pct(g.rewardBps)} of rewards. {exitTerms(g)}.
            </p>
          </div>
          <CairnStack variant="row" stones={g.roster.map((r) => ({ id: r.id, label: shortId(r.id), amount: r.amount / DASH, state: 'in' as const }))} />
        </li>
      ))}
    </ul>
  );
}

const FORMING = groupsByStatus(GROUP_STATUS.forming, undefined, 20);

/** Home: the newest groups still taking seats. */
export function OpenGroupsPreview() {
  const { registry } = useApp();
  const state = useList(registry.contractId ? FORMING : null, toGroup);
  if (!registry.contractId) return <NotOpenHere compact />;
  return (
    <ListBody
      state={state}
      empty={
        <>
          <p>
            <b>No open groups yet.</b> Groups appear here as soon as an operator or a member opens one.
          </p>
          <p className="small muted">Opening groups and posting that you are looking arrive in the next release. You can make your profile today.</p>
        </>
      }
    >
      {(items) => <GroupRows groups={items.slice(0, 5)} />}
    </ListBody>
  );
}

export function GroupsPage() {
  const { registry } = useApp();
  const state = useList(registry.contractId ? groupsByStatus(GROUP_STATUS.forming) : null, toGroup);
  return (
    <div className="page">
      <PageHead title="Groups" lede="Groups that are still taking co-owners, newest first. Each one shows how far it is from 1000 DASH, who runs the node, and the terms for leaving early." />
      {registry.contractId ? (
        <ListBody
          state={state}
          empty={
            <>
              <p>
                <b>No open groups on {registry.label} yet.</b>
              </p>
              <p>
                Opening a group is coming in the next release. Meanwhile, <Link to="/me">make your profile</Link> so others can find you, or read{' '}
                <Link to="/learn">how a group forms</Link>.
              </p>
            </>
          }
        >
          {(items) => <GroupRows groups={items} />}
        </ListBody>
      ) : (
        <NotOpenHere />
      )}
    </div>
  );
}

function LookingRows({ items }: { items: Looking[] }) {
  return (
    <ul className="rows">
      {items.map((l) => (
        <li key={l.id} className="row">
          <div className="row-main">
            <p className="row-title">
              <span className="num">{dash(l.amount)} DASH</span> from {shortId(l.ownerId)}
            </p>
            <p className="row-meta small">
              {l.operatorId ? `Wants operator ${shortId(l.operatorId)}` : 'Any operator'}, up to {pct(l.maxRewardBps)} operator reward.{' '}
              {l.canCoordinate ? 'Can coordinate in Dash-Qt.' : ''}
            </p>
            {l.note && <p className="row-note">{l.note}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function LookingPage() {
  const { registry } = useApp();
  const state = useList(registry.contractId ? lookingByStatus(LOOKING_STATUS.open) : null, toLooking);
  return (
    <div className="page">
      <PageHead title="Looking for a group" lede="People who have said how much they can bring and what terms they would accept. Groups that fit can invite them." />
      {registry.contractId ? (
        <ListBody
          state={state}
          empty={
            <>
              <p>
                <b>Nobody has posted yet.</b>
              </p>
              <p>Posting that you are looking, with your amount and the terms you accept, comes in the next release. Your profile is ready to fill in now.</p>
              <p>
                <Link className="btn" to="/me">
                  Make your profile
                </Link>
              </p>
            </>
          }
        >
          {(items) => <LookingRows items={items} />}
        </ListBody>
      ) : (
        <NotOpenHere />
      )}
    </div>
  );
}

function OperatorRows({ items }: { items: Operator[] }) {
  return (
    <ul className="rows">
      {items.map((o) => (
        <li key={o.id} className="row">
          <div className="row-main">
            <Link className="row-title" to={`/operators/${o.ownerId}`}>
              {o.name}
            </Link>
            <p className="row-meta small">
              Asks {pct(o.rewardBps)} of rewards{o.regions.length ? `, runs nodes in ${o.regions.join(', ')}` : ''}
              {o.capacity !== undefined ? `, room for ${o.capacity} more` : ''}.
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function OperatorsPage() {
  const { registry } = useApp();
  const state = useList(registry.contractId ? operatorsByStatus(OPERATOR_STATUS.open) : null, toOperator);
  return (
    <div className="page">
      <PageHead
        title="Operators"
        lede="People who run masternodes for a group. An operator supplies the server and its key, takes a share of rewards that the group agrees up front, and never touches anyone’s principal."
      />
      {registry.contractId ? (
        <ListBody
          state={state}
          empty={
            <>
              <p>
                <b>No operators listed on {registry.label} yet.</b>
              </p>
              <p>
                Operator profiles, with a track record Cairn computes from the chain rather than from what operators say, come in the next release.
              </p>
            </>
          }
        >
          {(items) => <OperatorRows items={items} />}
        </ListBody>
      ) : (
        <NotOpenHere />
      )}
    </div>
  );
}
