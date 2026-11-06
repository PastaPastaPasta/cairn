// /groups: groups still taking co-owners or agreeing terms, with filters (fits my amount, operator, reward, exit terms, status).
// Home shows the newest few (OpenGroupsPreview).
import { GROUP_FLAG, GROUP_STATUS, LOOKING_STATUS, type Group } from '@cairn/contract';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { loadGroupBundle } from '../data/cairn.ts';
import { CLOSED_GROUP_STATUSES, GROUPS, LISTED_GROUP_STATUSES, RECENT_GROUP_STATUSES, useStatusList } from '../data/lists.ts';
import { usePeople } from '../data/people.ts';
import { EXIT_PRESETS, exitShort } from '../matching/exit.ts';
import { fitsRoster, groupView } from '../matching/group.ts';
import { filterGroups } from '../matching/match.ts';
import { DUFFS, dashNum, parseDashInput, parsePercentInput, pct } from '../matching/money.ts';
import { stageOf, type Stage } from '../matching/stage.ts';
import { GROUP_STATUS_WORDS } from '../matching/words.ts';
import { CairnStack } from '../ui/CairnStack.tsx';
import { DashField, PercentField } from '../ui/fields.tsx';
import { Loaded } from '../ui/Loaded.tsx';
import { useMyLooking } from '../ui/LookingEditor.tsx';
import { HiddenNote, useHidden } from '../ui/hidden.tsx';
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
              <RowStatus g={g} />
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

const STAGE_ROW_WORDS: Partial<Record<Stage, string>> = { ready: 'Ready to form', 'session-started': 'Forming in Dash Core' };

/**
 * A locked group's list tag from its approvals: the stored status says only "locked", while its own page says "Ready to form" once
 * everyone has approved. Other statuses need no extra read.
 */
function RowStatus({ g }: { g: Group }) {
  const stage = useLockedStage(g);
  const stageWords = stage ? STAGE_ROW_WORDS[stage] : undefined;
  const ok = g.status === GROUP_STATUS.forming || !!stageWords;
  return <span className={`state state-${ok ? 'ok' : 'muted'}`}>{stageWords ?? GROUP_STATUS_WORDS[g.status] ?? 'Group'}</span>;
}

// a locked group's stage, shared by every list that shows it; approvals change without the group document changing, hence the expiry
const STAGE_TTL_MS = 60_000;
const lockedStages = new Map<string, { at: number; stage: Promise<Stage | null> }>();

function useLockedStage(g: Group): Stage | null {
  const { registry } = useApp();
  const [stage, setStage] = useState<Stage | null>(null);
  const locked = g.status === GROUP_STATUS.locked;
  useEffect(() => {
    if (!locked || !registry.contractId) return;
    const key = `${registry.network}:${g.id}:${g.updatedAt ?? 0}`;
    let hit = lockedStages.get(key);
    if (!hit || Date.now() - hit.at > STAGE_TTL_MS) {
      const read = loadGroupBundle(registry, g.id).then(
        (b) => (b ? stageOf(groupView(b, registry.network), null) : null),
        () => {
          lockedStages.delete(key);
          return null;
        },
      );
      hit = { at: Date.now(), stage: read };
      lockedStages.set(key, hit);
    }
    let live = true;
    void hit.stage.then((s) => live && setStage(s));
    return () => {
      live = false;
    };
  }, [registry, locked, g.id, g.updatedAt]);
  return stage;
}

/** The empty list: nothing taking co-owners on this network, and the two ways to start. */
function NothingOpen({ label }: { label: string }) {
  return (
    <>
      <p>
        <b>No group is taking co-owners on {label} right now.</b>
      </p>
      <p className="form-actions">
        <Link className="btn btn-s" to="/looking">
          Post that I’m looking
        </Link>
        <Link className="btn btn-s" to="/groups/new">
          Open a group
        </Link>
      </p>
    </>
  );
}

/** Home: the newest groups still taking seats, or, when none is, the ones formed or forming lately. */
export function OpenGroupsPreview() {
  const { registry } = useApp();
  const taking = useStatusList(GROUPS, [GROUP_STATUS.forming], !!registry.contractId);
  const none = taking.status === 'ready' && taking.data.items.length === 0;
  const recent = useStatusList(GROUPS, RECENT_GROUP_STATUSES, none);
  if (!registry.contractId) return <NotOpenHere compact />;
  return (
    <Loaded load={taking} retry={taking.reload} isEmpty={(d) => d.items.length === 0} empty={<RecentlyFormed recent={recent} label={registry.label} />}>
      {(d) => <GroupRows groups={d.items.slice(0, 5)} />}
    </Loaded>
  );
}

/** Home when no group is taking co-owners: say so, then show what has formed lately, so a newcomer sees what a group looks like. */
function RecentlyFormed({ recent, label }: { recent: ReturnType<typeof useStatusList<Group>>; label: string }) {
  const items = recent.status === 'ready' ? recent.data.items.slice(0, 3) : [];
  return (
    <>
      <NothingOpen label={label} />
      {items.length > 0 && (
        <>
          <h3 className="h4">Recently formed or forming</h3>
          <GroupRows groups={items} />
        </>
      )}
    </>
  );
}

const ALL_GROUP_STATUSES = [...LISTED_GROUP_STATUSES, ...CLOSED_GROUP_STATUSES];
type StatusFilter = 'all' | 'forming' | 'agreeing' | 'formed';
const STATUS_FILTER: Record<StatusFilter, readonly number[]> = {
  all: ALL_GROUP_STATUSES,
  forming: [GROUP_STATUS.forming],
  agreeing: [GROUP_STATUS.full, GROUP_STATUS.locked, GROUP_STATUS.formingOnchain],
  formed: [GROUP_STATUS.live, ...CLOSED_GROUP_STATUSES],
};
const DEFAULT_FILTERS = { amount: '', operator: 'any', maxReward: '', exit: 'any', status: 'all' as StatusFilter };

export function GroupsPage() {
  const { registry } = useApp();
  const { session } = useAccount();
  const [showClosed, setShowClosed] = useState(false);
  const list = useStatusList(GROUPS, showClosed ? ALL_GROUP_STATUSES : LISTED_GROUP_STATUSES, !!registry.contractId);
  const mine = useMyLooking(session && registry.contractId ? session.identityId : null);
  const [amount, setAmount] = useState(DEFAULT_FILTERS.amount);
  const [operator, setOperator] = useState(DEFAULT_FILTERS.operator);
  const [maxReward, setMaxReward] = useState(DEFAULT_FILTERS.maxReward);
  const [exit, setExit] = useState(DEFAULT_FILTERS.exit);
  const [status, setStatus] = useState<StatusFilter>(DEFAULT_FILTERS.status);
  const filtered = amount !== DEFAULT_FILTERS.amount || operator !== DEFAULT_FILTERS.operator || maxReward !== DEFAULT_FILTERS.maxReward || exit !== DEFAULT_FILTERS.exit || status !== DEFAULT_FILTERS.status;
  const myAmount = mine.status === 'ready' && mine.data?.status === LOOKING_STATUS.open ? mine.data.amount : null;
  useEffect(() => {
    if (myAmount) setAmount((a) => a || dashNum(myAmount));
  }, [myAmount]);

  const amountDuffs = amount.trim() ? parseDashInput(amount) : null;
  const rewardBps = maxReward.trim() ? parsePercentInput(maxReward) : null;
  const hidden = useHidden();
  const all = list.status === 'ready' ? list.data.items : null;
  const items = useMemo(() => (all ?? []).filter((g) => g.ownerId === session?.identityId || !hidden.has(g.ownerId)), [all, hidden, session]);
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
      <PageHead title="Groups" lede="Groups taking co-owners, agreeing their terms, forming or formed. Each shows how far it is from 1000 DASH, who runs the node, and the terms for leaving early.">
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
              <label htmlFor="g-exit">Leaving-early terms</label>
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
              <select id="g-status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} data-testid="filter-status">
                <option value="all">Every group</option>
                <option value="forming">Taking co-owners</option>
                <option value="agreeing">Agreeing terms or forming</option>
                <option value="formed">Formed</option>
              </select>
            </div>
            <label className="check">
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} data-testid="filter-closed" />
              Include closed and dissolved groups
            </label>
          </form>
          <Loaded
            load={list}
            retry={list.reload}
            isEmpty={(d) => d.items.length === 0}
            empty={<NothingOpen label={registry.label} />}
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
                  <HiddenNote count={d.items.length - items.length} />
                  {d.more && (
                    <button type="button" className="btn btn-s" onClick={list.showOlder}>
                      Show older groups
                    </button>
                  )}
                </>
              ) : (
                <div className="empty-state" data-testid="groups-empty">
                  {filtered ? (
                    <>
                      <p>
                        <b>No group matches these filters.</b> {amountDuffs ? 'Post that you are looking, and an organizer can invite you, or open a group yourself.' : ''}
                      </p>
                      <p className="form-actions">
                        <button
                          type="button"
                          className="btn btn-s"
                          onClick={() => {
                            setAmount(DEFAULT_FILTERS.amount);
                            setOperator(DEFAULT_FILTERS.operator);
                            setMaxReward(DEFAULT_FILTERS.maxReward);
                            setExit(DEFAULT_FILTERS.exit);
                            setStatus(DEFAULT_FILTERS.status);
                          }}
                        >
                          Clear filters
                        </button>
                        <Link className="btn btn-s" to="/groups/new">
                          Open a group
                        </Link>
                      </p>
                    </>
                  ) : (
                    <NothingOpen label={registry.label} />
                  )}
                  <HiddenNote count={d.items.length - items.length} />
                </div>
              )
            }
          </Loaded>
        </>
      )}
    </div>
  );
}
