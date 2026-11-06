// M4 for a member with an open looking post: the groups their amount fits, ranked by fit, and combinations of other looking members
// that would complete a group with them, each one click from a new group with those people invited.
import { GROUP_STATUS, type Looking } from '@cairn/contract';
import { Link, useNavigate } from 'react-router-dom';
import { GROUPS, LOOKING, OPEN_LOOKING, useStatusList } from '../data/lists.ts';
import { usePeople } from '../data/people.ts';
import { periodWords } from '../matching/exit.ts';
import { combosWith, rankGroups, type Combo } from '../matching/match.ts';
import { dash, dashNum, pct } from '../matching/money.ts';
import type { NewGroupPrefill } from '../pages/NewGroupPage.tsx';
import { Loaded } from './Loaded.tsx';
import { PersonName } from './Person.tsx';

export function prefillFromCombo(me: Looking, c: Combo): NewGroupPrefill {
  return {
    myAmount: me.amount,
    operatorId: c.operatorId,
    rewardBps: Math.min(c.maxRewardBps, 1000),
    earlyPeriodBlocks: c.maxPeriodBlocks === 0 ? 0 : undefined,
    invites: c.people.map((p) => ({ id: p.ownerId, amount: p.amount })),
    note: `Everyone here accepts an operator reward up to ${pct(c.maxRewardBps)}${c.maxPeriodBlocks !== null ? `, an early period up to ${periodWords(c.maxPeriodBlocks)}` : ''}${c.maxPenalty !== null ? ` and a penalty up to ${dash(c.maxPenalty)}` : ''}.`,
  };
}

export function Matches({ me, organizes }: { me: Looking; organizes?: ReadonlySet<string> }) {
  const groups = useStatusList(GROUPS, [GROUP_STATUS.forming]);
  const posts = useStatusList(LOOKING, OPEN_LOOKING);
  const navigate = useNavigate();
  const fits = groups.status === 'ready' ? rankGroups(groups.data.items, me, organizes).slice(0, 6) : [];
  const combos = posts.status === 'ready' ? combosWith(me, posts.data.items, 4) : [];
  const people = usePeople([...combos.flatMap((c) => c.people.map((p) => p.ownerId)), ...fits.flatMap((f) => (f.group.operatorId ? [f.group.operatorId] : []))]);
  return (
    <div className="matches" data-testid="matches">
      <section aria-labelledby="fit-title">
        <h3 id="fit-title">Groups your {dashNum(me.amount)} DASH fits</h3>
        <Loaded load={groups} retry={groups.reload} isEmpty={() => fits.length === 0} empty={<p>No open group can take {dash(me.amount)} right now. Your post stays listed, so organizers can invite you, or start a group with the people below.</p>}>
          {() => (
            <ol className="fit-list">
              {fits.map((f) => (
                <li key={f.group.id} className="fit-card">
                  <div>
                    <Link to={`/g/${f.group.id}`} className="fit-title">
                      {f.group.title}
                    </Link>
                    <p className="small muted">
                      {f.group.operatorId ? (
                        <>
                          Run by <PersonName id={f.group.operatorId} person={people.get(f.group.operatorId)} />
                        </>
                      ) : (
                        'Operator to be chosen'
                      )}
                      . {f.completes ? 'Your share completes it.' : `With you, ${dash(f.remainingAfter)} would be left.`}
                    </p>
                  </div>
                  <ul className="prefs">
                    {f.prefs.map((p) => (
                      <li key={p.text} className={p.ok ? 'pref-ok' : 'pref-miss'}>
                        <span className="visually-hidden">{p.ok ? 'Meets your terms: ' : 'Differs from your terms: '}</span>
                        {p.text}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </Loaded>
      </section>
      <section aria-labelledby="combo-title">
        <h3 id="combo-title">People who would complete a masternode with you</h3>
        <Loaded load={posts} retry={posts.reload} isEmpty={() => combos.length === 0} empty={<p>No combination of people looking right now adds up to 1000 DASH with you. New posts appear here as people join.</p>}>
          {() => (
            <ol className="combo-list">
              {combos.map((c, i) => (
                <li key={i} className="combo-card" data-testid="combo">
                  <p className="combo-sum">
                    <span>
                      You <b className="num">{dashNum(me.amount)}</b>
                    </span>
                    {c.people.map((p) => (
                      <span key={p.ownerId}>
                        {' + '}
                        <PersonName id={p.ownerId} person={people.get(p.ownerId)} /> <b className="num">{dashNum(p.amount)}</b>
                      </span>
                    ))}
                    <span> = 1000 DASH</span>
                  </p>
                  <p className="small muted">
                    {c.people.length + 1} co-owners. {c.operatorId ? 'Someone asked for a specific operator; the group keeps that choice.' : 'Nobody insists on an operator.'} Everyone accepts up to {pct(c.maxRewardBps)} for the
                    operator.
                  </p>
                  <button type="button" className="btn btn-s btn-primary" onClick={() => navigate('/groups/new', { state: { prefill: prefillFromCombo(me, c) } })} data-testid="combo-open">
                    Open a group and invite these people
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Loaded>
      </section>
    </div>
  );
}
