// /groups: the one place to find a group (DESIGN §4.1). Say how much you can bring, and every group still taking seats that it fits is
// ranked for you, drawn with you in it; or start a group of your own, which is how others who are looking find you. With no amount it
// lists every group by where it is. Home shows the newest few (OpenGroupsPreview).
import { GROUP_FLAG, GROUP_STATUS, MN_TYPE, SEAT_STATUS, seatsOf, toSeat, type Group, type GroupFields, type Operator } from '@cairn/contract';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { loadGroupBundle, readAll, rawId, useLoad } from '../data/cairn.ts';
import { CLOSED_GROUP_STATUSES, GROUPS, LISTED_GROUP_STATUSES, LISTED_OPERATORS, OPERATORS, RECENT_GROUP_STATUSES, useStatusList } from '../data/lists.ts';
import { usePeople, type Person } from '../data/people.ts';
import { suggestGroupName, useStartGroup } from '../data/startGroup.ts';
import { EXIT_PRESETS, exitShort } from '../matching/exit.ts';
import { CLOSED, groupView } from '../matching/group.ts';
import { fitWords, rankGroups, startedAlone, type Ask, type GroupFit } from '../matching/match.ts';
import { DUFFS, amountProblem, dash, dashNum, parseDashInput, parsePercentInput, pct } from '../matching/money.ts';
import { stageOf, type Stage } from '../matching/stage.ts';
import { GROUP_STATUS_WORDS, operatorName } from '../matching/words.ts';
import { openSignIn } from '../ui/Account.tsx';
import { CairnStack, StoneKey, type Stone } from '../ui/CairnStack.tsx';
import { Field, PercentField } from '../ui/fields.tsx';
import { Loaded } from '../ui/Loaded.tsx';
import { HiddenNote, HideButton, useHidden, type Hidden } from '../ui/hidden.tsx';
import { PersonName } from '../ui/Person.tsx';
import { StartProgress } from '../ui/StartProgress.tsx';
import { NotOpenHere, PageHead } from '../ui/states.tsx';
import type { NewGroupPrefill } from './NewGroupPage.tsx';
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
          <CairnStack
            variant="row"
            closed={CLOSED.includes(g.status)}
            stones={g.roster.map((r) => ({ id: r.id, label: people.get(r.id)?.name ?? 'A co-owner', amount: r.amount / DUFFS, state: 'in' as const }))}
          />
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
    if (!locked || !registry.contractId) return setStage(null);
    const key = `${registry.network}:${g.id}:${g.updatedAt ?? 0}`;
    let hit = lockedStages.get(key);
    if (!hit || Date.now() - hit.at > STAGE_TTL_MS) {
      const read = loadGroupBundle(registry, g.id).then(
        (b) => (b ? stageOf(groupView(b, registry.network), null) : null),
        () => {
          if (lockedStages.get(key) === entry) lockedStages.delete(key);
          return null;
        },
      );
      const entry = { at: Date.now(), stage: read };
      hit = entry;
      lockedStages.set(key, entry);
    }
    let live = true;
    void hit.stage.then((s) => live && setStage(s));
    return () => {
      live = false;
    };
  }, [registry, locked, g.id, g.updatedAt]);
  return stage;
}

/** The empty list: nothing taking co-owners on this network yet, and how to start the first group. */
function NothingOpen({ label }: { label: string }) {
  return (
    <>
      <p>
        <b>No group is taking co-owners on {label} right now.</b>
      </p>
      <p>Start the first one: say how much you can bring, and your group is listed for others to join.</p>
      <p className="form-actions">
        <Link className="btn btn-s" to="/groups#ask">
          Start a group
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
    <Loaded load={taking} retry={taking.reload}>
      {(d) => (d.items.length ? <GroupRows groups={d.items.slice(0, 5)} /> : <RecentlyFormed recent={recent} label={registry.label} />)}
    </Loaded>
  );
}

/** Home when no group is taking co-owners: say so, then show what has formed lately, so a newcomer sees what a group looks like. */
function RecentlyFormed({ recent, label }: { recent: ReturnType<typeof useStatusList<Group>>; label: string }) {
  const items = recent.status === 'ready' ? recent.data.items.slice(0, 3) : [];
  return (
    <>
      <div className="empty-state">
        <NothingOpen label={label} />
      </div>
      {recent.status === 'loading' && (
        <p className="small muted" role="status" data-testid="recent-loading">
          <span className="spinner" aria-hidden="true" /> Reading recently formed groups…
        </p>
      )}
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
const AGREEING: readonly number[] = [GROUP_STATUS.full, GROUP_STATUS.locked, GROUP_STATUS.formingOnchain];
const CHIPS = [100, 250, 500];
/** The reward a new group proposes when the member named no operator and no limit. */
const DEFAULT_REWARD_BPS = 1000;

/** What the member asked for, kept in the address so a shared link, a reload and signing in all keep it. */
function useAskParams() {
  const [params, setParams] = useSearchParams();
  const set = useCallback(
    (key: string, value: string) =>
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (value) n.set(key, value);
          else n.delete(key);
          return n;
        },
        { replace: true },
      ),
    [setParams],
  );
  return { amount: params.get('amount') ?? '', operator: params.get('operator') ?? '', reward: params.get('reward') ?? '', exit: params.get('exit') ?? '', set };
}

export function GroupsPage() {
  const { registry } = useApp();
  const { session } = useAccount();
  const me = session?.identityId ?? null;
  const q = useAskParams();
  const [showClosed, setShowClosed] = useState(false);
  const list = useStatusList(GROUPS, showClosed ? ALL_GROUP_STATUSES : LISTED_GROUP_STATUSES, !!registry.contractId);
  const ops = useStatusList(OPERATORS, LISTED_OPERATORS, !!registry.contractId);
  const hidden = useHidden();
  const all = list.status === 'ready' ? list.data.items : null;
  const items = useMemo(() => (all ?? []).filter((g) => g.ownerId === me || !hidden.has(g.ownerId)), [all, hidden, me]);
  const operators = useMemo(() => new Map((ops.status === 'ready' ? ops.data.items : []).map((o) => [o.ownerId, o])), [ops]);
  // the group this member started and is still alone in: their listing, and the amount they already said
  const myGroup = useMemo(() => (me ? (items.find((g) => g.ownerId === me && startedAlone(g)) ?? null) : null), [items, me]);
  // the amount they already said, once, on arrival with none typed; an amount in the address (or typed since) always wins
  const prefilled = useRef(!!q.amount);
  useEffect(() => {
    if (prefilled.current) return;
    if (q.amount) prefilled.current = true;
    else if (myGroup) {
      prefilled.current = true;
      q.set('amount', dashNum(myGroup.roster[0]!.amount));
    }
  }, [myGroup, q]);
  // lives here, not in the start card, so a half-finished start survives the card leaving the page while the amount is retyped
  const starter = useStartGroup();
  const seen = useMyRequests(me, myGroup?.id ?? null);

  const problem = q.amount.trim() ? amountProblem(q.amount) : null;
  const amount = q.amount.trim() && !problem ? parseDashInput(q.amount) : null;
  const ask = useMemo<Ask | null>(
    () =>
      amount
        ? {
            amount,
            operatorId: q.operator || null,
            maxRewardBps: q.reward.trim() ? parsePercentInput(q.reward) : null,
            maxPeriodBlocks: q.exit === 'none' ? 0 : (EXIT_PRESETS.find((p) => p.id === q.exit)?.blocks ?? null),
          }
        : null,
    [amount, q.operator, q.reward, q.exit],
  );

  return (
    <div className="page">
      <PageHead
        title="Find your group"
        lede="A masternode is 1000 DASH from two to eight people. Say how much you can bring: you see every group it fits and how full it would be with you in it. If none fits, start one, and others join you."
      />
      {!registry.contractId ? (
        <NotOpenHere />
      ) : (
        <>
          <AskBar q={q} problem={problem} operators={operators} />
          {starter.pending && !ask && <StartCard starter={starter} operators={operators} operatorsReady first />}
          {ask ? (
            <FitResults ask={ask} items={items} list={list} me={me} myGroup={myGroup} operators={operators} operatorsReady={ops.status === 'ready'} hidden={hidden} starter={starter} seen={seen} />
          ) : (
            <Browse items={items} list={list} label={registry.label} />
          )}
          {ask && list.status === 'ready' && items.length > 0 && (
            <details className="all-groups">
              <summary>Every group on {registry.label}</summary>
              <Browse items={items} list={list} label={registry.label} />
            </details>
          )}
          <label className="check closed-toggle">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} data-testid="filter-closed" />
            Include closed and dissolved groups
          </label>
          <HiddenNote count={(all?.length ?? 0) - items.length} />
          <p className="small muted operator-start">
            Run masternodes for others? <Link to="/groups/new?kind=operator">Open a group as its operator</Link>, with your reward and terms.
          </p>
        </>
      )}
    </div>
  );
}

type AskQuery = ReturnType<typeof useAskParams>;

interface MyRequests {
  /** Groups I have an open seat request in. */
  asked: ReadonlySet<string>;
  /** People with an open request to join the group I started. */
  askedMe: ReadonlySet<string>;
}
const NO_REQUESTS: MyRequests = { asked: new Set(), askedMe: new Set() };

/** My open seat requests, and who asked to join the group I started: so a fit card says "You asked", and two lone starters join one group. */
function useMyRequests(me: string | null, myGroupId: string | null): MyRequests {
  const load = useLoad(me ? `my-requests:${me}:${myGroupId ?? ''}` : null, async (r) => {
    const mine = (raw: Record<string, unknown>) => rawId(raw, '$ownerId') === me;
    const [seats, bundle] = await Promise.all([
      readAll(r, 'seat', (a) => seatsOf(me!, a), (d, n) => toSeat(d, n), mine),
      myGroupId ? loadGroupBundle(r, myGroupId) : Promise.resolve(null),
    ]);
    const roster = new Set(bundle?.group.roster.map((x) => x.id) ?? []);
    return {
      asked: new Set(seats.filter((x) => x.status === SEAT_STATUS.requested).map((x) => x.groupId)),
      askedMe: new Set((bundle?.seats ?? []).filter((x) => x.status === SEAT_STATUS.requested && x.ownerId !== me && !roster.has(x.ownerId)).map((x) => x.ownerId)),
    };
  });
  return load.status === 'ready' ? load.data : NO_REQUESTS;
}

/** "I can bring ___ DASH", and once there is an amount, the optional operator, reward and exit-term preferences. */
function AskBar({ q, problem, operators }: { q: AskQuery; problem: string | null; operators: ReadonlyMap<string, Operator> }) {
  // the router updates the address in a transition, a render behind each keystroke: the field keeps its own text, and takes the
  // address's only when something else changed it (a chip, the prefill, back and forward)
  const [text, setText] = useState(q.amount);
  const sent = useRef(q.amount);
  useEffect(() => {
    if (q.amount !== sent.current) {
      sent.current = q.amount;
      setText(q.amount);
    }
  }, [q.amount]);
  const setAmount = (v: string) => {
    sent.current = v;
    setText(v);
    q.set('amount', v);
  };
  const [openPrefs] = useState(!!(q.operator || q.reward || q.exit));
  const rewardBad = q.reward.trim() && parsePercentInput(q.reward) === null;
  return (
    <form className="ask-bar" id="ask" aria-label="What you can bring" onSubmit={(e) => e.preventDefault()}>
      <div className="ask-row">
        <label htmlFor="ask-amount" className="ask-label">
          I can bring
        </label>
        <span className="unit-input ask-input">
          <input
            id="ask-amount"
            value={text}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="250"
            aria-describedby="ask-hint"
            aria-invalid={!!problem || undefined}
            data-testid="ask-amount"
          />
          <span className="unit" aria-hidden="true">
            DASH
          </span>
        </span>
        <span className="ask-chips" role="group" aria-label="Common amounts">
          {CHIPS.map((c) => (
            <button key={c} type="button" className={`amount-chip${text === String(c) ? ' on' : ''}`} aria-pressed={text === String(c)} onClick={() => setAmount(String(c))}>
              {c}
            </button>
          ))}
        </span>
      </div>
      <p id="ask-hint" className={`small ${problem ? 'field-problem' : 'muted'}`} aria-live="polite">
        {problem ?? 'From 100 DASH up. Nothing moves now: you only say what you would bring.'}
      </p>
      {!problem && q.amount.trim() && (
        <details className="ask-more" open={openPrefs || undefined}>
          <summary>Operator and terms you accept (optional)</summary>
          <div className="ask-prefs">
            <div className="field">
              <label htmlFor="ask-operator">Operator</label>
              <select id="ask-operator" value={q.operator} onChange={(e) => q.set('operator', e.target.value)} data-testid="ask-operator">
                <option value="">Any operator</option>
                {[...operators.values()].map((o) => (
                  <option key={o.ownerId} value={o.ownerId}>
                    {operatorName(o)} ({pct(o.rewardBps)})
                  </option>
                ))}
              </select>
            </div>
            <PercentField label="Operator reward at most" value={q.reward} onChange={(v) => q.set('reward', v)} problem={rewardBad ? 'A percentage from 0 to 100.' : null} />
            <div className="field">
              <label htmlFor="ask-exit">Early period at most</label>
              <select id="ask-exit" value={q.exit} onChange={(e) => q.set('exit', e.target.value)}>
                <option value="">Any</option>
                <option value="none">None: free to leave any time</option>
                {EXIT_PRESETS.slice(1).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="small muted">These sort the groups and mark what differs; they never hide a group your amount fits.</p>
        </details>
      )}
    </form>
  );
}

type GroupList = ReturnType<typeof useStatusList<Group>>;

type Starter = ReturnType<typeof useStartGroup>;

/** Where the amount fits, best first, each drawn with the member in it; then starting a group of their own. */
function FitResults({ ask, items, list, me, myGroup, operators, operatorsReady, hidden, starter, seen }: {
  ask: Ask;
  items: Group[];
  list: GroupList;
  me: string | null;
  myGroup: Group | null;
  operators: ReadonlyMap<string, Operator>;
  operatorsReady: boolean;
  hidden: Hidden;
  starter: Starter;
  seen: MyRequests;
}) {
  const fits = useMemo(() => rankGroups(items, ask, me), [items, ask, me]);
  const people = usePeople([...new Set(fits.flatMap((f) => [f.group.ownerId, ...(f.group.operatorId ? [f.group.operatorId] : []), ...f.group.roster.map((r) => r.id)]))]);
  const heading = fits.length ? `${fits.length === 1 ? 'One group' : `${fits.length} groups`} your ${dash(ask.amount)} fits` : `No group fits ${dash(ask.amount)} yet`;
  if (list.status !== 'ready')
    return (
      <Loaded load={list} retry={list.reload}>
        {() => null}
      </Loaded>
    );
  return (
    <section className="fits" aria-labelledby="fits-title">
      <h2 id="fits-title" className="h3">
        {heading}
      </h2>
      <p className="visually-hidden" role="status">
        {heading}
      </p>
      {fits.length > 0 && (
        <ul className="fit-list" data-testid="fit-list">
          {fits.map((f) => (
            <FitCard key={f.group.id} fit={f} ask={ask} people={people} hidden={hidden} seen={seen} myGroup={myGroup} />
          ))}
        </ul>
      )}
      {myGroup && !starter.pending ? <YourListing group={myGroup} /> : <StartCard ask={ask} starter={starter} operators={operators} operatorsReady={operatorsReady} first={!fits.length} />}
    </section>
  );
}

function FitCard({ fit, ask, people, hidden, seen, myGroup }: { fit: GroupFit; ask: Ask; people: Map<string, Person>; hidden: Hidden; seen: MyRequests; myGroup: Group | null }) {
  const g = fit.group;
  const stones: Stone[] = [
    ...g.roster.map((r) => ({ id: r.id, label: people.get(r.id)?.name ?? 'A co-owner', amount: r.amount / DUFFS, state: 'in' as const })),
    { id: 'you', label: 'You', amount: ask.amount / DUFFS, state: 'requested' as const, mine: true },
  ];
  const alone = startedAlone(g);
  const asked = seen.asked.has(g.id);
  // they asked to join my group while I look at theirs: accepting them keeps one group of two, instead of two
  const askedMe = !!myGroup && !!alone && seen.askedMe.has(alone.id);
  return (
    <li className="fit-card fit-join" data-testid="fit-card">
      <div className="fit-join-main">
        <Link className="fit-title" to={`/g/${g.id}`}>
          {g.title}
        </Link>
        <p className="small row-meta">
          {alone ? (
            <>
              Started by <PersonName id={alone.id} person={people.get(alone.id)} /> with {dash(alone.amount)}.{' '}
            </>
          ) : (
            `${g.roster.length} ${g.roster.length === 1 ? 'co-owner' : 'co-owners'} so far. `
          )}
          {g.operatorId ? (
            <>
              Run by <PersonName id={g.operatorId} person={people.get(g.operatorId)} />
            </>
          ) : (
            'Operator to be chosen'
          )}
          , {pct(g.rewardBps)} of rewards. {exitShort(g.earlyPeriodBlocks, g.earlyPenalty)}.
        </p>
        <p className="fit-with">
          <b>{fitWords(fit, ask.amount)}</b>
        </p>
        {fit.prefs.length > 0 && (
          <ul className="prefs small">
            {fit.prefs.map((p) => (
              <li key={p.text} className={p.ok ? 'pref-ok' : 'pref-miss'}>
                {p.text}
              </li>
            ))}
          </ul>
        )}
        {askedMe && (
          <p className="small notice-box" data-testid="asked-me">
            {people.get(alone!.id)?.name ?? 'They'} asked to join <Link to={`/g/${myGroup!.id}`}>your group</Link>. Accept them there, rather than both of you joining each
            other.
          </p>
        )}
      </div>
      <div className="fit-join-side">
        <CairnStack variant="row" legend={false} stones={stones} />
        <div className="fit-join-actions">
          <HideButton id={g.ownerId} name={people.get(g.ownerId)?.name} hidden={hidden} />
          {asked ? (
            <Link className="btn btn-s" to={`/g/${g.id}#join`} data-testid="asked">
              You asked · see it
            </Link>
          ) : (
            <Link className="btn btn-primary btn-s" to={`/g/${g.id}?amount=${encodeURIComponent(dashNum(ask.amount))}#join`} data-testid="ask-to-join">
              Ask to join
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

/** The member's own group, already listed and waiting for others: there is no second one to start. */
function YourListing({ group }: { group: Group }) {
  return (
    <div className="start-card start-mine" data-testid="your-listing">
      <h3 className="h4">Your group is listed</h3>
      <p>
        <Link to={`/g/${group.id}`}>{group.title}</Link> is waiting with your {dash(group.roster[0]!.amount)}. People whose amount fits can ask to join it, and organizers
        can invite you into theirs. If you join one of the groups above instead, close yours from <Link to="/me">My Cairn</Link>.
      </p>
    </div>
  );
}

/** Start a group with this amount: listed at once, so others who are looking find it. One click, with terms to settle later. */
function StartCard({ ask, starter, operators, operatorsReady, first }: { ask?: Ask; starter: Starter; operators: ReadonlyMap<string, Operator>; operatorsReady: boolean; first: boolean }) {
  const { registry } = useApp();
  const { session } = useAccount();
  const navigate = useNavigate();
  const { busy, error, start, progress, createdId, pending: plan } = starter;
  const [name, setName] = useState(suggestGroupName);
  const me = session?.identityId;
  // a listed operator only: an id from the address that the directory does not list is never written as the group's operator
  const operatorId = plan ? plan.fields.operatorId : ask?.operatorId;
  const op = operatorId ? operators.get(operatorId) : undefined;
  const amount = plan ? plan.mySeat!.amount : ask!.amount;
  const rewardBps = plan ? plan.fields.rewardBps : (op?.rewardBps ?? ask!.maxRewardBps ?? DEFAULT_REWARD_BPS);
  const title = plan ? plan.fields.title : name;
  const fields = (): GroupFields => ({
    title: title.trim(),
    mnType: MN_TYPE.regular,
    operatorId: op?.ownerId ?? null,
    rewardBps,
    earlyPeriodBlocks: 0,
    earlyPenalty: 0,
    roster: [{ id: me!, amount }],
    termsRevision: 1,
    status: GROUP_STATUS.forming,
    flags: GROUP_FLAG.openAmounts,
  });
  // a plan already written needs no directory
  const ready = !!plan || operatorsReady;
  const titleProblem = title.trim() ? null : 'Give the group a name.';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!me || titleProblem || busy || !ready) return;
    void start(plan ?? { fields: fields(), mySeat: { amount, flags: 0 } }, (gid) => navigate(`/g/${gid}`));
  };
  return (
    <section className={`start-card${first ? ' start-first' : ''}`} aria-labelledby="start-title" data-testid="start-card">
      <div className="start-head">
        <CairnStack variant="row" legend={false} stones={[{ id: 'you', label: 'You', amount: amount / DUFFS, state: 'in', mine: true }]} />
        <div>
          <h3 id="start-title" className="h4">
            {first ? `Start a group with your ${dash(amount)}` : `Or start your own group with ${dash(amount)}`}
          </h3>
          <p className="small">
            It is listed here straight away. Anyone whose amount fits can ask to join, and you choose who is in. If you later join another group instead, you can close this one.
          </p>
        </div>
      </div>
      <dl className="start-terms small">
        <div>
          <dt>Operator</dt>
          <dd>{op ? `${operatorName(op)}, who accepts or declines` : 'To be chosen: operators can offer to run it'}</dd>
        </div>
        <div>
          <dt>Operator reward</dt>
          <dd>{pct(rewardBps)} proposed</dd>
        </div>
        <div>
          <dt>Leaving early</dt>
          <dd>No penalty yet: you can set early-exit terms before you lock the group</dd>
        </div>
      </dl>
      {!session ? (
        <p className="form-actions">
          <button type="button" className="btn btn-primary" onClick={openSignIn} data-testid="start-sign-in">
            Sign in to start a group
          </button>
        </p>
      ) : (
        <form className="start-form" onSubmit={submit} aria-busy={busy}>
          <fieldset disabled={busy}>
            <Field label="Group name" problem={titleProblem} hint="You can change it later.">
              {({ id, describedBy, invalid }) => <input id={id} value={title} onChange={(e) => setName(e.target.value)} readOnly={!!plan} maxLength={80} aria-describedby={describedBy} aria-invalid={invalid || undefined} data-testid="start-title" />}
            </Field>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={!!titleProblem || !ready} data-testid="start-group">
                {busy ? 'Starting…' : createdId ? 'Finish' : 'Start my group'}
              </button>
              {!createdId && (
                <Link className="btn btn-quiet" to="/groups/new" state={{ prefill: { title: title.trim() || undefined, myAmount: amount, operatorId: op?.ownerId ?? null, rewardBps } satisfies NewGroupPrefill }}>
                  Choose the terms first
                </Link>
              )}
            </div>
            <p className="small muted">Costs about 0.001 DASH of credit on {registry.label}: the group and your seat.</p>
          </fieldset>
          <StartProgress busy={busy} progress={progress} error={error} createdId={createdId} finish="to add your seat" />
        </form>
      )}
    </section>
  );
}

/** With no amount: every group by where it is, taking co-owners first. */
function Browse({ items, list, label }: { items: Group[]; list: GroupList; label: string }) {
  const sections: Array<{ id: string; title: string; groups: Group[] }> = [
    { id: 'taking', title: 'Taking co-owners', groups: items.filter((g) => g.status === GROUP_STATUS.forming) },
    { id: 'agreeing', title: 'Agreeing terms or forming', groups: items.filter((g) => AGREEING.includes(g.status)) },
    { id: 'formed', title: 'Formed', groups: items.filter((g) => g.status === GROUP_STATUS.live) },
    { id: 'closed', title: 'Closed', groups: items.filter((g) => CLOSED.includes(g.status)) },
  ];
  return (
    <Loaded load={list} retry={list.reload}>
      {(d) => (
        <div className="browse" data-testid="browse">
          {!sections[0]!.groups.length && (
            <div className="empty-state" data-testid="groups-empty">
              <NothingOpen label={label} />
            </div>
          )}
          {sections
            .filter((s) => s.groups.length)
            .map((s) => (
              <section key={s.id} className="browse-section" aria-labelledby={`browse-${s.id}`}>
                <h2 id={`browse-${s.id}`} className="h4">
                  {s.title} <span className="count">{s.groups.length}</span>
                </h2>
                <GroupRows groups={s.groups} />
              </section>
            ))}
          {items.length > 0 && <StoneKey />}
          {d.more && (
            <button type="button" className="btn btn-s" onClick={list.showOlder}>
              Show older groups
            </button>
          )}
        </div>
      )}
    </Loaded>
  );
}
