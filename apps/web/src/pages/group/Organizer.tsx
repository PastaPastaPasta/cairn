// The organizer's tools: invite people who fit (M4 on the group side), choose the operator (member-led), edit the terms, prepare
// and lock (S3), and refill a dissolved group (M12). Every change goes through `change()`, which bumps the revision of locked terms.
import { GROUP_FLAG, GROUP_STATUS, MN_TYPE, OPERATOR_STATUS, OP_ACCEPT_STATUS, createOp, groupData, httpsUrl, type Group } from '@cairn/contract';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../app/context.tsx';
import { rawId } from '../../data/cairn.ts';
import { LISTED_OPERATORS, LOOKING, OPEN_LOOKING, OPERATORS, useStatusList } from '../../data/lists.ts';
import { usePeople, type Person } from '../../data/people.ts';
import { useWrite } from '../../data/write.ts';
import { exitProblem } from '../../matching/exit.ts';
import { change, holderVotingAddress, lockPlan, refillFields, saveChoices, type GroupView } from '../../matching/group.ts';
import { serviceProblem, votingAddressProblem } from '../../matching/keys.ts';
import { deriveLabels, labelProblem } from '../../matching/labels.ts';
import { completions, lookingThatFits } from '../../matching/match.ts';
import { bpsInput, dash, dashNum, parseDashInput, parsePercentInput, pct } from '../../matching/money.ts';
import { operatorName } from '../../matching/words.ts';
import { ExitTermsField, Field, PercentField } from '../../ui/fields.tsx';
import { WriteStatus } from '../../ui/Loaded.tsx';
import { PersonName } from '../../ui/Person.tsx';
import { useAction } from '../../ui/useAction.ts';
import { BlsField, ServiceField, useBlsProblem } from './NextStep.tsx';
import { OPEN, WITHDRAWN, type GroupOps } from './ops.ts';

interface Props {
  view: GroupView;
  people: Map<string, Person>;
  ops: GroupOps;
  done(): void;
}

export function InviteSection({ view, people, ops, done }: Props) {
  const g = view.group;
  const posts = useStatusList(LOOKING, OPEN_LOOKING);
  const { busy, error, run } = useAction();
  const exclude = useMemo(() => new Set([...view.requests.map((r) => r.seat.ownerId), ...view.openInvites.map((i) => i.toId), ...view.declined.map((s) => s.ownerId)]), [view]);
  const fits = posts.status === 'ready' ? lookingThatFits(g, posts.data.items, exclude) : [];
  const combos = completions(g, fits);
  const morePeople = usePeople(fits.map((f) => f.looking.ownerId));
  const name = (id: string) => morePeople.get(id) ?? people.get(id);
  const invite = (xs: Array<{ ownerId: string; amount: number }>) =>
    run(async () => {
      for (const x of xs) await ops.invite(x.ownerId, x.amount, OPEN);
      done();
    });
  return (
    <section className="section tool" id="invite" aria-labelledby="invite-title">
      <h2 id="invite-title">Find co-owners</h2>
      <p className="muted">
        {dash(view.remaining)} still open. These people are looking and their amount fits; Dash Core’s rules are already checked. Invited people accept or decline from this page.
      </p>
      {combos.length > 0 && (
        <div className="combos">
          <h3 className="h4">Would complete the group</h3>
          <ul className="combo-list">
            {combos.map((c) => (
              <li key={c.map((l) => l.ownerId).join()} className="combo-card">
                <p className="combo-sum">
                  {c.map((l, i) => (
                    <span key={l.ownerId}>
                      {i > 0 && ' + '}
                      <PersonName id={l.ownerId} person={name(l.ownerId)} /> <b className="num">{dashNum(l.amount)}</b>
                    </span>
                  ))}{' '}
                  = {dash(view.remaining)}
                </p>
                <button type="button" className="btn btn-s btn-primary" disabled={busy} onClick={() => invite(c)} data-testid="invite-combo">
                  Invite {c.length === 1 ? 'them' : `all ${c.length}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {posts.status === 'loading' && <p className="small muted">Reading who is looking…</p>}
      {posts.status === 'ready' && !fits.length && <p className="small">Nobody looking right now fits what is left. Share the group’s link, or check back later.</p>}
      {fits.length > 0 && (
        <ul className="fit-people">
          {fits.slice(0, 12).map((f) => (
            <li key={f.looking.ownerId} className="fit-person" data-testid="fit-person">
              <div>
                <PersonName id={f.looking.ownerId} person={name(f.looking.ownerId)} /> <b className="num">{dash(f.looking.amount)}</b>
                {f.completes && <span className="role-tag">completes it</span>}
                <ul className="prefs small">
                  {f.prefs.map((p) => (
                    <li key={p.text} className={p.ok ? 'pref-ok' : 'pref-miss'}>
                      {p.text.replace('Your chosen operator', 'Wants this operator')}
                    </li>
                  ))}
                  {f.looking.canCoordinate && <li className="pref-ok">Can coordinate</li>}
                </ul>
              </div>
              <button type="button" className="btn btn-s" disabled={busy} onClick={() => invite([f.looking])} data-testid="invite-person">
                Invite
              </button>
            </li>
          ))}
        </ul>
      )}
      {view.openInvites.length > 0 && (
        <>
          <h3 className="h4">Invited</h3>
          <ul className="fit-people">
            {view.openInvites.map((i) => (
              <li key={i.id} className="fit-person">
                <span>
                  <PersonName id={i.toId} person={name(i.toId)} /> <span className="num">{dash(i.amount)}</span>
                </span>
                <button type="button" className="btn btn-s btn-quiet" disabled={busy} onClick={() => run(async () => { await ops.invite(i.toId, i.amount, WITHDRAWN); done(); })}>
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <WriteStatus busy={busy} error={error} />
    </section>
  );
}

export function OperatorSection({ view, people, ops, done }: Props) {
  const g = view.group;
  const directory = useStatusList(OPERATORS, LISTED_OPERATORS);
  const [pick, setPick] = useState('');
  const { busy, error, run } = useAction();
  const save = (next: Partial<Group>) => run(async () => {
    await ops.group(change(g, next));
    done();
  });
  const answer = view.operatorAnswer;
  const listed = directory.status === 'ready' ? directory.data.items.filter((o) => o.ownerId !== g.operatorId && o.status !== OPERATOR_STATUS.paused) : [];
  return (
    <section className="section tool" id="operator" aria-labelledby="operator-title">
      <h2 id="operator-title">Operator</h2>
      {g.operatorId ? (
        <p>
          <PersonName id={g.operatorId} person={people.get(g.operatorId)} />{' '}
          {answer?.status === OP_ACCEPT_STATUS.accepted ? (
            <>
              accepted{answer.rewardBps !== g.rewardBps ? ` at ${pct(answer.rewardBps ?? 0)}, not the group’s ${pct(g.rewardBps)}` : ''}.{' '}
              {answer.operatorPubKey && answer.service ? 'Key and address given.' : 'Key and address still to come.'}
            </>
          ) : answer?.status === OP_ACCEPT_STATUS.declined ? (
            'declined. Choose another operator.'
          ) : (
            'has not answered yet.'
          )}
        </p>
      ) : (
        <p className="muted">No operator yet.</p>
      )}
      {answer?.status === OP_ACCEPT_STATUS.accepted && answer.rewardBps !== undefined && answer.rewardBps !== g.rewardBps && (
        <button type="button" className="btn btn-s" disabled={busy} onClick={() => save({ rewardBps: answer.rewardBps! })}>
          Use their {pct(answer.rewardBps)}
        </button>
      )}
      {view.offers.length > 0 && (
        <>
          <h3 className="h4">Offers</h3>
          <ul className="fit-people">
            {view.offers.map((o) => (
              <li key={o.id} className="fit-person">
                <span>
                  <PersonName id={o.ownerId} person={people.get(o.ownerId)} /> asks {pct(o.rewardBps ?? g.rewardBps)}
                  {o.message && <span className="quote small block">{o.message}</span>}
                </span>
                <button type="button" className="btn btn-s btn-primary" disabled={busy} onClick={() => save({ operatorId: o.ownerId, rewardBps: o.rewardBps ?? g.rewardBps })} data-testid="choose-offer">
                  Choose
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <form
        className="inline-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          const o = listed.find((x) => x.ownerId === pick);
          if (o) void save({ operatorId: o.ownerId, rewardBps: o.rewardBps });
        }}
      >
        <Field label={g.operatorId ? 'Choose a different operator' : 'Choose from the directory'}>
          {({ id }) => (
            <select id={id} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Pick an operator</option>
              {listed.map((o) => (
                <option key={o.ownerId} value={o.ownerId}>
                  {operatorName(o)} ({pct(o.rewardBps)})
                </option>
              ))}
            </select>
          )}
        </Field>
        <button type="submit" className="btn btn-s" disabled={busy || !pick}>
          Choose
        </button>
      </form>
      <p className="small muted">Choosing sets the group’s reward to their ask; the operator then accepts or declines from this page.</p>
      <WriteStatus busy={busy} error={error} />
    </section>
  );
}

export function EditTerms({ view, ops, done }: Omit<Props, 'people'>) {
  const g = view.group;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(g.title);
  const [about, setAbout] = useState(g.about ?? '');
  const [reward, setReward] = useState(bpsInput(g.rewardBps));
  const [period, setPeriod] = useState(g.earlyPeriodBlocks);
  const [penalty, setPenalty] = useState(g.earlyPenalty ? dashNum(g.earlyPenalty) : '');
  const [chat, setChat] = useState(g.chatUrl ?? '');
  const [policy, setPolicy] = useState(g.votingPolicy ?? '');
  const [openAmounts, setOpenAmounts] = useState(view.openAmounts);
  const { busy, error, run } = useAction();
  const bps = parsePercentInput(reward);
  const pen = period ? parseDashInput(penalty) : 0;
  const smallest = Math.min(...g.roster.map((r) => r.amount), 100 * 1e8);
  const next = () => ({
    title: title.trim(),
    about: about.trim() || undefined,
    rewardBps: bps!,
    earlyPeriodBlocks: period,
    earlyPenalty: pen ?? 0,
    chatUrl: chat.trim() || undefined,
    votingPolicy: policy.trim() || undefined,
    flags: ((g.flags ?? 0) & ~GROUP_FLAG.openAmounts) | (openAmounts ? GROUP_FLAG.openAmounts : 0),
  });
  const problems = [!title.trim() && 'Give the group a name.', bps === null && 'The reward must be a percentage from 0 to 100.', pen === null ? 'Enter the penalty in DASH.' : exitProblem(period, pen, smallest), chat.trim() && !httpsUrl(chat) && 'The chat link must start with https://'].filter(Boolean) as string[];
  let rule: string | null = null;
  if (!problems.length) {
    try {
      groupData(change(g, next()), view.network);
    } catch (e) {
      rule = (e as Error).message;
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problems.length || rule) return;
    void run(async () => {
      await ops.group(change(g, next()));
      setOpen(false);
      done();
    });
  };
  return (
    <section className="section tool" aria-labelledby="edit-title">
      <h2 id="edit-title">Terms and details</h2>
      {!open ? (
        <div className="form-actions">
          <button type="button" className="btn btn-s" onClick={() => setOpen(true)} data-testid="edit-terms">
            Edit
          </button>
          <CloseGroup view={view} ops={ops} done={done} />
        </div>
      ) : (
        <form className="form" onSubmit={submit} aria-busy={busy}>
          <fieldset disabled={busy}>
            {view.locked && <p className="notice-box small">The terms are locked. Saving any change makes revision {g.revision + 1}, unlocks the terms and voids every approval.</p>}
            <Field label="Group name">{({ id }) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />}</Field>
            <Field label="About" optional>
              {({ id }) => <textarea id={id} value={about} onChange={(e) => setAbout(e.target.value)} maxLength={1000} rows={3} />}
            </Field>
            <PercentField label="Operator reward" value={reward} onChange={setReward} problem={bps === null ? 'A percentage from 0 to 100.' : null} hint={!view.operatorLed && g.operatorId ? 'The operator must accept a new reward again.' : undefined} />
            <ExitTermsField period={period} onPeriod={setPeriod} penalty={penalty} onPenalty={setPenalty} problem={pen === null ? 'Enter the penalty in DASH.' : exitProblem(period, pen, smallest)} rewardBps={bps} />
            <label className="check">
              <input type="checkbox" checked={openAmounts} onChange={(e) => setOpenAmounts(e.target.checked)} />
              Anyone can ask for a seat (otherwise by invitation)
            </label>
            <Field label="Group chat link" optional problem={chat.trim() && !httpsUrl(chat) ? 'The chat link must start with https://' : null}>
              {({ id, describedBy }) => <input id={id} value={chat} onChange={(e) => setChat(e.target.value)} inputMode="url" aria-describedby={describedBy} />}
            </Field>
            <Field label="How the voting key is used" optional>
              {({ id }) => <input id={id} value={policy} onChange={(e) => setPolicy(e.target.value)} maxLength={280} />}
            </Field>
            {rule && <p className="field-problem">{rule}</p>}
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={problems.length > 0 || !!rule}>
                Save
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <WriteStatus busy={busy} error={error} />
    </section>
  );
}

function CloseGroup({ view, ops, done }: Omit<Props, 'people'>) {
  const [sure, setSure] = useState(false);
  const { busy, error, run } = useAction();
  if (!sure)
    return (
      <button type="button" className="btn btn-s btn-quiet" onClick={() => setSure(true)}>
        Close the group
      </button>
    );
  return (
    <span className="confirm-inline">
      <span className="small">Close it for everyone? Seats and approvals stop counting.</span>
      <button type="button" className="btn btn-s" disabled={busy} onClick={() => run(async () => { await ops.group(change(view.group, { status: GROUP_STATUS.cancelled })); done(); })}>
        Yes, close it
      </button>
      <button type="button" className="btn btn-s btn-quiet" onClick={() => setSure(false)}>
        Keep it open
      </button>
      <WriteStatus busy={busy} error={error} />
    </span>
  );
}

export function LockSection({ view, people, ops, done }: Props) {
  const { registry } = useApp();
  const g = view.group;
  const nameOf = (id: string) => people.get(id)?.name ?? null;
  const defaults = deriveLabels(g.roster, nameOf);
  const [labels, setLabels] = useState<string[]>(defaults);
  const namesKnown = g.roster.every((r) => people.has(r.id));
  // labels follow the names until the organizer edits one
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setLabels(deriveLabels(g.roster, nameOf));
  }, [namesKnown, g.roster, touched]); // eslint-disable-line react-hooks/exhaustive-deps
  const [coordinatorId, setCoordinatorId] = useState(g.coordinatorId ?? view.coordinatorCandidates[0] ?? '');
  const [holderId, setHolderId] = useState(g.votingHolderId ?? '');
  const [key, setKey] = useState(g.operatorPubKey ?? '');
  const [service, setService] = useState(g.service ?? '');
  const [voting, setVoting] = useState(g.votingHolderId === g.operatorId ? (g.votingAddress ?? '') : '');
  const [editing, setEditing] = useState(!view.locked);
  const { busy, error, run } = useAction();
  const keyProblem = useBlsProblem(view.operatorLed ? key : '');
  const choices = { coordinatorId: coordinatorId || undefined, votingHolderId: holderId || undefined, labels, operatorPubKey: key, service, votingAddress: voting };
  const plan = lockPlan(view, choices);
  const labelProblems = labels.map((l, i) => labelProblem(l, labels.filter((_, j) => j !== i)));
  const svcProblem = view.operatorLed && service.trim() ? serviceProblem(service, registry.network) : null;
  const votingProblem = view.operatorLed && holderId === g.operatorId && voting.trim() ? votingAddressProblem(voting, registry.network) : null;
  const problems = [...new Set([...labelProblems.filter(Boolean), keyProblem, svcProblem, votingProblem, ...plan.problems].filter(Boolean) as string[])];
  const holderAddress = holderVotingAddress(view, holderId || undefined, voting);

  const [saved, setSaved] = useState<string | null>(null);
  const saveChoicesOnly = () => run(async () => {
    setSaved(null);
    await ops.group(saveChoices(g, choices));
    setSaved('Choices saved and read back. Lock when everything above is in place.');
    done();
  });
  const lock = () =>
    run(async () => {
      if (problems.length || !plan.hash) throw new Error(problems[0] ?? 'The terms are not complete.');
      await ops.group(plan.fields);
      setEditing(false);
      done();
    });

  if (view.locked && !editing)
    return (
      <section className="section tool" id="lock" aria-labelledby="lock-title">
        <h2 id="lock-title">Locked terms</h2>
        <p>
          Locked at revision {g.revision}. {view.approvedCount} of {view.shares.length} approved.
        </p>
        <button type="button" className="btn btn-s" onClick={() => setEditing(true)}>
          Change coordinator, voting key or labels
        </button>
      </section>
    );
  return (
    <section className="section tool" id="lock" aria-labelledby="lock-title" data-testid="lock-section">
      <h2 id="lock-title">Prepare and lock the terms</h2>
      <p className="muted">Locking freezes the shares and terms into revision {g.revision}. Members then approve exactly that; any later change makes a new revision and voids the approvals.</p>
      {view.locked && <p className="notice-box small">Saving makes revision {g.revision + 1} and voids every approval.</p>}
      <form className="form" onSubmit={(e) => e.preventDefault()} aria-busy={busy}>
        <fieldset disabled={busy}>
          <fieldset className="subfields">
            <legend>Coordinator</legend>
            <p className="small muted">The co-owner who starts the shared masternode in Dash-Qt (desktop) and pays the ~0.001 DASH network fee. Only members who said they can are listed.</p>
            {view.coordinatorCandidates.length ? (
              view.coordinatorCandidates.map((id) => (
                <label key={id} className="check">
                  <input type="radio" name="coordinator" checked={coordinatorId === id} onChange={() => setCoordinatorId(id)} data-testid="pick-coordinator" />
                  <PersonName id={id} person={people.get(id)} />
                </label>
              ))
            ) : (
              <p className="small field-problem">Nobody has said they can coordinate yet. A member ticks “I can coordinate” on their seat.</p>
            )}
          </fieldset>
          <fieldset className="subfields">
            <legend>Voting key holder</legend>
            <p className="small muted">Holds the masternode’s governance voting key and gives its address. Members who offered, and the operator.</p>
            {view.holderCandidates.map((id) => (
              <label key={id} className="check">
                <input type="radio" name="holder" checked={holderId === id} onChange={() => setHolderId(id)} data-testid="pick-holder" />
                <PersonName id={id} person={people.get(id)} />
                {id === g.operatorId && <span className="role-tag">operator</span>}
                {holderId === id && <span className="small muted">{holderVotingAddress(view, id, voting) ? ' address given' : id === g.operatorId && view.operatorLed ? '' : ' address still to come'}</span>}
              </label>
            ))}
            {holderId && !holderAddress && !(view.operatorLed && holderId === g.operatorId) && (
              <p className="small">
                Save your choices so <PersonName id={holderId} person={people.get(holderId)} /> sees the request for the address.
              </p>
            )}
          </fieldset>
          <fieldset className="subfields">
            <legend>Share labels</legend>
            <p className="small muted">The row names the coordinator types into Dash-Qt. Short, plain letters, different for each share.</p>
            <div className="label-grid">
              {g.roster.map((r, i) => (
                <Field key={r.id} label={<><PersonName id={r.id} person={people.get(r.id)} /> · {dash(r.amount)}</>} problem={labelProblems[i]}>
                  {({ id, describedBy, invalid }) => (
                    <input
                      id={id}
                      value={labels[i] ?? ''}
                      onChange={(e) => {
                        setTouched(true);
                        setLabels((ls) => ls.map((l, j) => (j === i ? e.target.value : l)));
                      }}
                      maxLength={20}
                      spellCheck={false}
                      aria-describedby={describedBy}
                      aria-invalid={invalid || undefined}
                      data-testid="share-label"
                    />
                  )}
                </Field>
              ))}
            </div>
          </fieldset>
          {view.operatorLed && (
            <fieldset className="subfields">
              <legend>Your node</legend>
              <BlsField value={key} onChange={setKey} problem={keyProblem} />
              <ServiceField value={service} onChange={setService} problem={svcProblem} network={registry.network} />
              {holderId === g.operatorId && (
                <Field label="Voting address" problem={votingProblem} hint="You hold the voting key: a new address from your Dash Core wallet.">
                  {({ id, describedBy }) => <input id={id} value={voting} onChange={(e) => setVoting(e.target.value)} className="mono-input" spellCheck={false} aria-describedby={describedBy} />}
                </Field>
              )}
            </fieldset>
          )}
          {problems.length > 0 && (
            <ul className="lock-problems small" data-testid="lock-problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-primary" disabled={problems.length > 0} onClick={() => void lock()} data-testid="lock">
              Lock the terms
            </button>
            <button type="button" className="btn" onClick={() => void saveChoicesOnly()} data-testid="save-choices">
              Save choices without locking
            </button>
            {view.locked && (
              <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </fieldset>
      </form>
      <WriteStatus busy={busy} error={error} done={saved} />
    </section>
  );
}

/** M12: after a dissolution, reopen with the same terms for the leavers' amount. Remaining members confirm with a seat. */
export function RefillPanel({ view, people, me }: { view: GroupView; people: Map<string, Person>; me: string }) {
  const { registry } = useApp();
  const navigate = useNavigate();
  const write = useWrite();
  const g = view.group;
  const [leavers, setLeavers] = useState<string[]>([]);
  const { busy, error, run } = useAction();
  const fields = refillFields(g, leavers);
  let problem: string | null = leavers.length ? null : 'Tick who left.';
  if (!problem)
    try {
      groupData(fields, registry.network);
    } catch (e) {
      problem = (e as Error).message;
    }
  const open = () =>
    run(async () => {
      const back = await write(() => createOp(registry.contractId!, 'group', groupData({ ...fields, title: `${g.title} (refill)`.slice(0, 80), mnType: MN_TYPE.regular }, registry.network)));
      navigate(`/g/${rawId(back!, '$id')}`);
    });
  return (
    <section className="section tool" aria-labelledby="refill-title" data-testid="refill">
      <h2 id="refill-title">Reopen with the same terms</h2>
      <p className="muted">When someone leaves, the masternode dissolves and every share goes back. The rest of you can start again with the same operator and terms, needing only the leavers’ amount.</p>
      <fieldset className="subfields">
        <legend>Who left?</legend>
        {g.roster
          .filter((r) => r.id !== me)
          .map((r) => (
            <label key={r.id} className="check">
              <input type="checkbox" checked={leavers.includes(r.id)} onChange={(e) => setLeavers((ls) => (e.target.checked ? [...ls, r.id] : ls.filter((x) => x !== r.id)))} />
              <PersonName id={r.id} person={people.get(r.id)} /> · {dash(r.amount)}
            </label>
          ))}
      </fieldset>
      {leavers.length > 0 && <p className="small">The new group needs {dash(fields.roster.length ? 1000e8 - fields.roster.reduce((a, r) => a + r.amount, 0) : 1000e8)} from new co-owners. You become its organizer; everyone staying confirms with a seat there.</p>}
      {problem && leavers.length > 0 && <p className="field-problem small">{problem}</p>}
      <button type="button" className="btn btn-primary" disabled={busy || !!problem} onClick={() => void open()}>
        Open the refill group
      </button>
      <WriteStatus busy={busy} error={error} />
    </section>
  );
}
