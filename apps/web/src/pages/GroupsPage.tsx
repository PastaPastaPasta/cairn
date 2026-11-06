// /groups: groups still taking co-owners or agreeing terms, with filters (fits my amount, operator, reward, exit terms, status).
// Home shows the newest few (OpenGroupsPreview).
import { GROUP_FLAG, GROUP_STATUS, LOOKING_STATUS, type Group } from '@cairn/contract';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { GROUPS, OPEN_GROUP_STATUSES, useStatusList } from '../data/lists.ts';
import { usePeople } from '../data/people.ts';
import { EXIT_PRESETS, exitShort } from '../matching/exit.ts';
import { fitsRoster } from '../matching/group.ts';
import { filterGroups } from '../matching/match.ts';
import { DUFFS, dashNum, parseDashInput, parsePercentInput, pct } from '../matching/money.ts';
import { CairnStack } from '../ui/CairnStack.tsx';
import { DashField, PercentField } from '../ui/fields.tsx';
import { GroupStatusTag } from '../ui/GroupStatusTag.tsx';
import { Loaded } from '../ui/Loaded.tsx';
import { useMyLooking } from '../ui/LookingEditor.tsx';
import { PersonName } from '../ui/Person.tsx';
import { NotOpenHere, PageHead } from '../ui/states.tsx';
import '../styles/matching.css';

export function GroupRows({ groups, note }: { groups: Group[]; note?(g: Group): ReactNode }) {
  const people = usePeople(groups.flatMap((g) => (g.operatorId ? [g.operatorId] : [])));
  return (
    <ul className="rows" data-testid="group-rows">
      {groups.map((g) => (
        <li key={g.id} className="row">
          <div className="row-main">
            <Link className="row-title" to={`/g/${g.id}`}>
              {g.title}
            </Link>
            <p className="row-meta small">
              {g.operatorId ? (
                <>
                  Run by <PersonName id={g.operatorId} person={people.get(g.operatorId)} />
                </>
              ) : (
                'Operator to be chosen'
              )}
              , {pct(g.rewardBps)} of rewards. {exitShort(g.earlyPeriodBlocks, g.earlyPenalty)}.
            </p>
            <p className="row-tags">
              <GroupStatusTag g={g} />
              {g.status === GROUP_STATUS.forming && !((g.flags ?? 0) & GROUP_FLAG.openAmounts) && <span className="state state-muted">By invitation</span>}
              {g.refillOf && <span className="state state-muted">Refill</span>}
            </p>
            {note?.(g)}
          </div>
          <CairnStack variant="row" stones={g.roster.map((r) => ({ id: r.id, label: people.get(r.id)?.name ?? 'A co-owner', amount: r.amount / DUFFS, state: 'in' as const }))} />
        </li>
      ))}
    </ul>
  );
}

/** Home: the newest groups still taking seats. */
export function OpenGroupsPreview() {
  const { registry } = useApp();
  const list = useStatusList(GROUPS, [GROUP_STATUS.forming], !!registry.contractId);
  if (!registry.contractId) return <NotOpenHere compact />;
  return (
    <Loaded
      load={list}
      retry={list.reload}
      isEmpty={(d) => d.items.length === 0}
      empty={
        <>
          <p>
            <b>No open groups yet.</b> Groups appear here as soon as an operator or a member opens one.
          </p>
          <p>
            <Link to="/groups/new">Open a group</Link> or <Link to="/looking">post that you are looking</Link>.
          </p>
        </>
      }
    >
      {(d) => <GroupRows groups={d.items.slice(0, 5)} />}
    </Loaded>
  );
}

type StatusFilter = 'forming' | 'agreeing' | 'all';
const STATUS_FILTER: Record<StatusFilter, readonly number[]> = { forming: [GROUP_STATUS.forming], agreeing: [GROUP_STATUS.full, GROUP_STATUS.locked], all: OPEN_GROUP_STATUSES };

export function GroupsPage() {
  const { registry } = useApp();
  const { session } = useAccount();
  const list = useStatusList(GROUPS, OPEN_GROUP_STATUSES, !!registry.contractId);
  const mine = useMyLooking(session && registry.contractId ? session.identityId : null);
  const [amount, setAmount] = useState('');
  const [operator, setOperator] = useState('any');
  const [maxReward, setMaxReward] = useState('');
  const [exit, setExit] = useState('any');
  const [status, setStatus] = useState<StatusFilter>('forming');
  const myAmount = mine.status === 'ready' && mine.data?.status === LOOKING_STATUS.open ? mine.data.amount : null;
  useEffect(() => {
    if (myAmount) setAmount((a) => a || dashNum(myAmount));
  }, [myAmount]);

  const amountDuffs = amount.trim() ? parseDashInput(amount) : null;
  const rewardBps = maxReward.trim() ? parsePercentInput(maxReward) : null;
  const items = list.status === 'ready' ? list.data.items : [];
  const operatorIds = useMemo(() => [...new Set(items.flatMap((g) => (g.operatorId ? [g.operatorId] : [])))], [items]);
  const people = usePeople(operatorIds);
  const exitBlocks = exit === 'any' ? null : (EXIT_PRESETS.find((p) => p.id === exit)?.blocks ?? null);
  const shown = useMemo(() => {
    const byStatus = items.filter((g) => STATUS_FILTER[status].includes(g.status));
    const f = filterGroups(byStatus, { amount: amountDuffs, operator, maxRewardBps: rewardBps, maxPeriodBlocks: exitBlocks });
    // with an amount, groups it completes come first, then those it brings closest to 1000
    if (!amountDuffs) return f;
    const after = (g: Group) => {
      const fit = fitsRoster(g.roster, amountDuffs, g.earlyPenalty);
      return fit.ok ? Number(fit.remainingAfter) : Infinity;
    };
    return [...f].sort((a, b) => after(a) - after(b));
  }, [items, status, amountDuffs, operator, rewardBps, exitBlocks]);

  const amountProblem = amount.trim() && amountDuffs === null ? 'Enter an amount in DASH, like 250.' : amountDuffs !== null && (amountDuffs < 100 * DUFFS || amountDuffs > 900 * DUFFS) ? 'A share is 100 to 900 DASH.' : null;
  return (
    <div className="page">
      <PageHead title="Groups" lede="Groups still taking co-owners or agreeing their terms. Each shows how far it is from 1000 DASH, who runs the node, and the terms for leaving early.">
        <p className="head-actions">
          <Link className="btn btn-primary" to="/groups/new">
            Open a group
          </Link>
          <Link className="btn" to="/looking">
            Post that I’m looking
          </Link>
        </p>
      </PageHead>
      {!registry.contractId ? (
        <NotOpenHere />
      ) : (
        <>
          <form className="filters" aria-label="Filter groups" onSubmit={(e) => e.preventDefault()}>
            <DashField label="Fits my amount" value={amount} onChange={setAmount} problem={amountProblem} hint={myAmount ? 'From your looking post.' : 'Only groups that can take this share.'} optional testId="filter-amount" />
            <div className="field">
              <label htmlFor="g-operator">Operator</label>
              <select id="g-operator" value={operator} onChange={(e) => setOperator(e.target.value)}>
                <option value="any">Any operator</option>
                <option value="none">Still to be chosen</option>
                {operatorIds.map((id) => (
                  <option key={id} value={id}>
                    {people.get(id)?.name ?? `${id.slice(0, 6)}…`}
                  </option>
                ))}
              </select>
            </div>
            <PercentField label="Operator reward at most" value={maxReward} onChange={setMaxReward} problem={maxReward.trim() && rewardBps === null ? 'A percentage from 0 to 100.' : null} />
            <div className="field">
              <label htmlFor="g-exit">Early period</label>
              <select id="g-exit" value={exit} onChange={(e) => setExit(e.target.value)}>
                <option value="any">Any</option>
                <option value="none">None (free to leave)</option>
                {EXIT_PRESETS.slice(1).map((p) => (
                  <option key={p.id} value={p.id}>
                    Up to {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="g-status">Show</label>
              <select id="g-status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
                <option value="forming">Taking co-owners</option>
                <option value="agreeing">Full, agreeing terms</option>
                <option value="all">All open groups</option>
              </select>
            </div>
          </form>
          <Loaded
            load={list}
            retry={list.reload}
            isEmpty={(d) => d.items.length === 0}
            empty={
              <>
                <p>
                  <b>No open groups on {registry.label} yet.</b>
                </p>
                <p>
                  <Link to="/groups/new">Open the first one</Link>, as an operator or as a member, or <Link to="/looking">post that you are looking</Link> so others can find you.
                </p>
              </>
            }
          >
            {(d) =>
              shown.length ? (
                <>
                  <p className="small muted list-count" role="status">
                    {shown.length} {shown.length === 1 ? 'group' : 'groups'}
                    {amountDuffs ? ` your ${dashNum(amountDuffs)} DASH fits` : ''}
                  </p>
                  <GroupRows
                    groups={shown}
                    note={
                      amountDuffs
                        ? (g) => {
                            const fit = fitsRoster(g.roster, amountDuffs, g.earlyPenalty);
                            return fit.ok ? <p className="fit-note small">{fit.remainingAfter === 0n ? 'Your share completes this group.' : `With you, ${dashNum(fit.remainingAfter)} DASH would be left.`}</p> : null;
                          }
                        : undefined
                    }
                  />
                  {d.more && (
                    <button type="button" className="btn btn-s" onClick={list.showOlder}>
                      Show older groups
                    </button>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <p>
                    <b>No group matches these filters.</b> {amountDuffs ? 'Post that you are looking, and an organizer can invite you, or open a group yourself.' : ''}
                  </p>
                  <p className="form-actions">
                    <button
                      type="button"
                      className="btn btn-s"
                      onClick={() => {
                        setAmount('');
                        setOperator('any');
                        setMaxReward('');
                        setExit('any');
                        setStatus('all');
                      }}
                    >
                      Clear filters
                    </button>
                    <Link className="btn btn-s" to="/groups/new">
                      Open a group
                    </Link>
                  </p>
                </div>
              )
            }
          </Loaded>
        </>
      )}
    </div>
  );
}
