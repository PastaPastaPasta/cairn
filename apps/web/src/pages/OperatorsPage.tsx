// /operators: the directory, with filters for the reward and the region; /operators/:id: one operator's listing, their open groups,
// the masternodes they claim (linked to Radar) and the slot for the chain-verified track record.
import { OPERATOR_STATUS, groupsOfOperator, operatorOf, toGroup, toOperator, type Operator } from '@cairn/contract';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { rawId, readAll, readOwn, useLoad } from '../data/cairn.ts';
import { LISTED_OPERATORS, OPERATORS, useStatusList } from '../data/lists.ts';
import { usePeople } from '../data/people.ts';
import { RADAR, radarMnUrl } from '../lib/radar.ts';
import { parsePercentInput, shortId } from '../matching/money.ts';
import { OPERATOR_STATUS_WORDS, operatorName, rewardRange } from '../matching/words.ts';
import { CLOSED } from '../matching/group.ts';
import { StoneKey } from '../ui/CairnStack.tsx';
import { PercentField } from '../ui/fields.tsx';
import { Loaded } from '../ui/Loaded.tsx';
import { ContactList, PersonName } from '../ui/Person.tsx';
import { NotOpenHere, PageHead } from '../ui/states.tsx';
import { OperatorTrackRecord } from '../formation/TrackRecord.tsx';
import { GroupRows } from './GroupsPage.tsx';
import '../styles/matching.css';

export function OperatorsPage() {
  const { registry } = useApp();
  const list = useStatusList(OPERATORS, LISTED_OPERATORS, !!registry.contractId);
  const [maxReward, setMaxReward] = useState('');
  const [region, setRegion] = useState('any');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const maxBps = maxReward.trim() ? parsePercentInput(maxReward) : null;
  const items = list.status === 'ready' ? list.data.items : [];
  const regions = useMemo(() => [...new Set(items.flatMap((o) => o.regions))].sort((a, b) => a.localeCompare(b)), [items]);
  const shown = items.filter(
    (o) =>
      (!onlyOpen || (o.status === OPERATOR_STATUS.open && o.capacity !== 0)) &&
      (maxBps === null || (o.rewardMinBps ?? o.rewardBps) <= maxBps) &&
      (region === 'any' || o.regions.includes(region)),
  );
  return (
    <div className="page">
      <PageHead
        title="Operators"
        lede="People who run masternodes for a group. An operator supplies the server and its key, takes a share of rewards that the group agrees up front, and never touches anyone’s principal."
      >
        <p className="head-actions">
          <Link className="btn" to="/me#operator">
            List yourself as an operator
          </Link>
        </p>
      </PageHead>
      {!registry.contractId ? (
        <NotOpenHere />
      ) : (
        <>
          <form className="filters" aria-label="Filter operators" onSubmit={(e) => e.preventDefault()}>
            <PercentField label="Reward at most" value={maxReward} onChange={setMaxReward} problem={maxReward.trim() && maxBps === null ? 'A percentage from 0 to 100.' : null} testId="filter-reward" />
            <div className="field">
              <label htmlFor="op-region">Region</label>
              <select id="op-region" value={region} onChange={(e) => setRegion(e.target.value)} data-testid="filter-region">
                <option value="any">Any region</option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <label className="check filter-check">
              <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
              Only those taking new nodes
            </label>
          </form>
          <Loaded
            load={list}
            retry={list.reload}
            isEmpty={(d) => d.items.length === 0}
            empty={
              <>
                <p>
                  <b>No operators listed on {registry.label} yet.</b>
                </p>
                <p>
                  Do you run masternodes? <Link to="/me#operator">List yourself</Link> with your reward and regions, and groups can choose you.
                </p>
              </>
            }
          >
            {(d) =>
              shown.length ? (
                <>
                  <p className="small muted list-count" role="status">
                    {shown.length === d.items.length ? `${d.items.length} ${d.items.length === 1 ? 'operator' : 'operators'}` : `${shown.length} of ${d.items.length} operators match`}
                  </p>
                  <OperatorRows items={shown} />
                  {d.more && (
                    <button type="button" className="btn btn-s" onClick={list.showOlder}>
                      Show older listings
                    </button>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <p>
                    <b>No operator matches these filters.</b>
                  </p>
                  <button
                    type="button"
                    className="btn btn-s"
                    onClick={() => {
                      setMaxReward('');
                      setRegion('any');
                      setOnlyOpen(false);
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              )
            }
          </Loaded>
        </>
      )}
    </div>
  );
}

function OperatorRows({ items }: { items: Operator[] }) {
  return (
    <ul className="rows" data-testid="operator-rows">
      {items.map((o) => (
        <li key={o.id} className="row row-operator">
          <div className="row-main">
            <Link className="row-title" to={`/operators/${o.ownerId}`}>
              {operatorName(o)}
            </Link>
            <p className="row-meta small">
              Asks {rewardRange(o)} of rewards{o.regions.length ? `, runs nodes in ${o.regions.join(', ')}` : ''}
              {o.capacity !== undefined ? `, room for ${o.capacity} more` : ''}.
            </p>
            {o.hosting && <p className="row-note small clamp-2">{o.hosting}</p>}
          </div>
          <div className="row-side">
            <span className={`state state-${o.status === OPERATOR_STATUS.open ? 'ok' : 'muted'}`}>{OPERATOR_STATUS_WORDS[o.status] ?? 'Listed'}</span>
            {o.claimedProTx.length > 0 && <span className="small muted">{o.claimedProTx.length} masternodes claimed</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function OperatorPage() {
  const { id = '' } = useParams();
  const { registry } = useApp();
  const { session } = useAccount();
  const load = useLoad(id, async (r) => {
    const [op, groups] = await Promise.all([
      readOwn(r, 'operator', operatorOf(id), id, (d) => toOperator(d)),
      readAll(r, 'group', (a) => groupsOfOperator(id, undefined, a), (d, n) => toGroup(d, n), (raw) => rawId(raw, 'operatorId') === id),
    ]);
    return { op, groups };
  });
  const people = usePeople(id ? [id] : []);
  const person = people.get(id);
  if (!registry.contractId)
    return (
      <div className="page">
        <PageHead title="Operator" />
        <NotOpenHere />
      </div>
    );
  return (
    <div className="page operator-page">
      <Loaded load={load} retry={load.reload} what="Reading this operator from Dash Platform…">
        {({ op, groups }) =>
          !op ? (
            <>
              <PageHead title={`Operator ${shortId(id)}`} />
              <div className="empty-state">
                <p>
                  <b>No operator listing for this identity on {registry.label}.</b> It may have been removed, or this link is for the other network.
                </p>
                <p>
                  <Link to="/operators">See every operator</Link>
                </p>
              </div>
              {/* the chain-verified record stands without a listing: groups name the operator, not their profile */}
              <OperatorTrackRecord operatorId={id} />
            </>
          ) : (
            <>
              <PageHead title={operatorName(op)} lede={op.hosting}>
                <p className="small muted">
                  <PersonName id={id} person={person} you={session?.identityId === id} /> · <span className={`state state-${op.status === OPERATOR_STATUS.open ? 'ok' : 'muted'}`}>{OPERATOR_STATUS_WORDS[op.status] ?? 'Listed'}</span>
                </p>
              </PageHead>
              <div className="two-col">
                <div>
                  <dl className="facts">
                    <dt>Operator reward</dt>
                    <dd>
                      {rewardRange(op)}
                      <span className="small muted block">The group agrees the reward before the masternode is registered; it stays fixed for that masternode.</span>
                    </dd>
                    <dt>Regions</dt>
                    <dd>{op.regions.length ? op.regions.join(', ') : <span className="muted">Not given</span>}</dd>
                    <dt>Room for</dt>
                    <dd>{op.capacity === undefined ? <span className="muted">Not given</span> : `${op.capacity} more ${op.capacity === 1 ? 'masternode' : 'masternodes'}`}</dd>
                    <dt>Contact</dt>
                    <dd>{person?.profile ? <ContactList contacts={person.profile.contacts} /> : <span className="small muted">No public contact</span>}</dd>
                  </dl>
                  <section className="section" aria-labelledby="op-groups">
                    <h2 id="op-groups">Groups with this operator</h2>
                    {groups.length ? (
                      <>
                        <GroupRows groups={groups} />
                        <StoneKey closed={groups.some((g) => CLOSED.includes(g.status))} />
                      </>
                    ) : (
                      <p className="muted">No groups yet.</p>
                    )}
                    {session && session.identityId !== id && op.status === OPERATOR_STATUS.open && (
                      <p>
                        <Link className="btn" to={`/groups/new?operator=${id}`}>
                          Open a group with this operator
                        </Link>
                      </p>
                    )}
                  </section>
                </div>
                <aside className="side-card">
                  <OperatorTrackRecord operatorId={id} />
                  <h2 className="h3">Masternodes they say they run</h2>
                  {op.claimedProTx.length ? (
                    <ul className="claimed" data-testid="claimed-protx">
                      {op.claimedProTx.map((p) => (
                        <li key={p}>
                          <a href={radarMnUrl(registry.network, p)} rel="noopener noreferrer" target="_blank" className="mono-ish">
                            {p.slice(0, 10)}…{p.slice(-6)}
                          </a>{' '}
                          <span className="state state-muted" title="Listed by the operator; not checked against the chain">
                            claimed
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="small muted">None listed.</p>
                  )}
                  <p className="small muted">
                    Claimed means the operator listed it; anyone can. Open each on <a href={RADAR}>Radar</a> to see its state.
                  </p>
                </aside>
              </div>
            </>
          )
        }
      </Loaded>
    </div>
  );
}
