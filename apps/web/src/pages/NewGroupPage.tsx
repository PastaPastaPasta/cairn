// /groups/new: open a group, operator-led (O2: the organizer runs the node and sets the terms) or member-led (M6: a member picks an
// operator from the directory or leaves it to be chosen). Every amount and exit rule is checked as you type; the zero-penalty and
// permanent-reward warnings sit next to the choices they are about. Creating writes the group, then the organizer's own seat, then
// any invites, each confirmed by a proved read-back.
import {
  GROUP_FLAG, GROUP_STATUS, INVITE_STATUS, MN_TYPE, OPERATOR_STATUS, SEAT_STATUS,
  createOp, groupData, httpsUrl, inviteData, seatData, type GroupFields, type RawDoc, type RosterEntry,
} from '@cairn/contract';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { rawId } from '../data/cairn.ts';
import { LISTED_OPERATORS, OPERATORS, useStatusList } from '../data/lists.ts';
import { usePeople } from '../data/people.ts';
import { UnconfirmedWrite, useWrite } from '../data/write.ts';
import { exitProblem, termWarnings } from '../matching/exit.ts';
import { fitsRoster } from '../matching/group.ts';
import { DUFFS, bpsInput, dash, dashNum, parseDashInput, parsePercentInput, pct } from '../matching/money.ts';
import { seatFlags } from '../matching/nextstep.ts';
import { operatorName } from '../matching/words.ts';
import { openSignIn } from '../ui/Account.tsx';
import { DashField, ExitTermsField, Field, PercentField, Warnings } from '../ui/fields.tsx';
import { amountProblem } from '../ui/LookingEditor.tsx';
import { useMyOperator } from './me/OperatorEditor.tsx';
import { PersonName } from '../ui/Person.tsx';
import { NotOpenHere, PageHead } from '../ui/states.tsx';
import { useAction } from '../ui/useAction.ts';
import '../styles/matching.css';

/** A new group proposed from a match (Matches → "Open a group and invite these people"). */
export interface NewGroupPrefill {
  myAmount: number;
  operatorId: string | null;
  rewardBps: number;
  earlyPeriodBlocks?: number;
  invites: Array<{ id: string; amount: number }>;
  note?: string;
}

type Kind = 'operator' | 'member';

export function NewGroupPage() {
  const { registry } = useApp();
  const { session } = useAccount();
  if (!registry.contractId)
    return (
      <div className="page">
        <PageHead title="Open a group" />
        <NotOpenHere />
      </div>
    );
  if (!session)
    return (
      <div className="page">
        <PageHead title="Open a group" lede="Start a masternode with others: as its operator, with your terms, or as a member who picks an operator from the directory." />
        <div className="soon">
          <p>
            <b>Sign in to open a group.</b> The group is a record on Dash Platform owned by your account; you accept seats and lock the terms from it.
          </p>
          <button type="button" className="btn btn-primary" onClick={openSignIn}>
            Sign in or create an account
          </button>
        </div>
      </div>
    );
  return <NewGroupForm identityId={session.identityId} />;
}

function NewGroupForm({ identityId }: { identityId: string }) {
  const { registry } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const prefill = (useLocation().state as { prefill?: NewGroupPrefill } | null)?.prefill;
  const myListing = useMyOperator(identityId);
  const ops = useStatusList(OPERATORS, LISTED_OPERATORS);
  const write = useWrite();
  const { busy, error, run } = useAction();
  const [progress, setProgress] = useState<string[]>([]);
  const [createdId, setCreatedId] = useState<string | null>(null);
  // steps already confirmed, so "Finish" after an error never repeats a write
  const done = useRef(new Set<string>());

  const [kind, setKind] = useState<Kind>(params.get('kind') === 'operator' ? 'operator' : 'member');
  const [title, setTitle] = useState('');
  const [about, setAbout] = useState(prefill?.note ?? '');
  const [myAmount, setMyAmount] = useState(prefill ? dashNum(prefill.myAmount) : '');
  const [operatorId, setOperatorId] = useState(prefill?.operatorId ?? params.get('operator') ?? '');
  const [reward, setReward] = useState(prefill ? bpsInput(prefill.rewardBps) : '10');
  const [rewardTouched, setRewardTouched] = useState(!!prefill);
  const [openAmounts, setOpenAmounts] = useState(true);
  const [period, setPeriod] = useState(prefill?.earlyPeriodBlocks ?? 0);
  const [penalty, setPenalty] = useState('');
  const [chat, setChat] = useState('');
  const [formBy, setFormBy] = useState('');
  const [policy, setPolicy] = useState('');
  const [coordinate, setCoordinate] = useState(false);
  const [holdKey, setHoldKey] = useState(false);
  const [invites, setInvites] = useState(prefill?.invites ?? []);
  const people = usePeople(invites.map((i) => i.id));

  const listing = myListing.status === 'ready' ? myListing.data : null;
  const operators = ops.status === 'ready' ? ops.data.items.filter((o) => o.ownerId !== identityId) : [];
  const chosen = operators.find((o) => o.ownerId === operatorId);
  // the reward follows the operator's ask until the organizer types their own
  useEffect(() => {
    if (rewardTouched) return;
    if (kind === 'operator' && listing) setReward(bpsInput(listing.rewardBps));
    else if (kind === 'member' && chosen) setReward(bpsInput(chosen.rewardBps));
  }, [kind, listing, chosen, rewardTouched]);

  const amountDuffs = myAmount.trim() ? parseDashInput(myAmount) : null;
  const rewardBps = parsePercentInput(reward);
  const penaltyDuffs = period ? parseDashInput(penalty) : 0;
  const ownRoster: RosterEntry[] = amountDuffs ? [{ id: identityId, amount: amountDuffs }] : [];
  const smallest = Math.min(...[...ownRoster.map((r) => r.amount), ...invites.map((i) => i.amount), 100 * DUFFS]);

  const inviteProblems = useMemo(() => {
    const out: Array<string | null> = [];
    const roster = [...ownRoster];
    for (const inv of invites) {
      const fit = fitsRoster(roster, inv.amount, penaltyDuffs ?? 0);
      out.push(fit.ok ? null : fit.message);
      if (fit.ok) roster.push({ id: inv.id, amount: inv.amount });
    }
    return out;
  }, [invites, amountDuffs, penaltyDuffs]); // eslint-disable-line react-hooks/exhaustive-deps

  const problems = {
    title: !title.trim() ? 'Give the group a name.' : null,
    amount: kind === 'member' ? amountProblem(myAmount) : amountProblem(myAmount, false),
    reward: rewardBps === null ? 'A percentage from 0 to 100.' : kind === 'operator' && listing && (rewardBps < (listing.rewardMinBps ?? 0) || rewardBps > (listing.rewardMaxBps ?? 10_000)) ? `Your listing accepts ${pct(listing.rewardMinBps ?? 0)} to ${pct(listing.rewardMaxBps ?? 10_000)}.` : null,
    exit: penaltyDuffs === null ? 'Enter the penalty in DASH.' : exitProblem(period, penaltyDuffs, smallest),
    chat: chat.trim() && !httpsUrl(chat) ? 'The chat link must start with https://' : null,
    invites: inviteProblems.find(Boolean) ?? null,
  };
  const fields = (): GroupFields => ({
    title: title.trim(),
    about: about.trim() || undefined,
    mnType: MN_TYPE.regular,
    operatorId: kind === 'operator' ? identityId : operatorId || null,
    rewardBps: rewardBps!,
    earlyPeriodBlocks: period,
    earlyPenalty: penaltyDuffs ?? 0,
    votingPolicy: policy.trim() || undefined,
    chatUrl: chat.trim() || undefined,
    formBy: formBy ? Math.floor(new Date(`${formBy}T23:59:59`).getTime() / 1000) : undefined,
    roster: ownRoster,
    termsRevision: 1,
    status: GROUP_STATUS.forming,
    flags: openAmounts ? GROUP_FLAG.openAmounts : 0,
  });
  let ruleProblem: string | null = null;
  const firstProblem = Object.values(problems).find(Boolean) ?? null;
  if (!firstProblem) {
    try {
      groupData(fields(), registry.network);
    } catch (e) {
      ruleProblem = (e as Error).message;
    }
  }
  const blocked = !!firstProblem || !!ruleProblem;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (blocked || busy) return;
    const cid = registry.contractId!;
    void run(async () => {
      setProgress([]);
      // a write Platform accepted counts as done even when its read-back failed: retrying would make a second document
      const once = async (key: string, f: () => Promise<RawDoc | null>, said: string): Promise<string | null> => {
        if (done.current.has(key)) return null;
        try {
          const back = await f();
          done.current.add(key);
          setProgress((p) => [...p, said]);
          return back ? rawId(back, '$id') : null;
        } catch (e) {
          if (e instanceof UnconfirmedWrite) {
            done.current.add(key);
            if (key === 'group') setCreatedId(e.id);
          }
          throw e;
        }
      };
      const gid = createdId ?? (await once('group', () => write(() => createOp(cid, 'group', groupData(fields(), registry.network))), 'Group created and read back.'))!;
      setCreatedId(gid);
      if (amountDuffs)
        await once('seat', () => write(() => createOp(cid, 'seat', seatData({ groupId: gid, amount: amountDuffs, status: SEAT_STATUS.requested, flags: seatFlags(coordinate, holdKey) }, registry.network))), 'Your seat confirmed.');
      for (const inv of invites)
        await once(inv.id, () => write(() => createOp(cid, 'invite', inviteData({ groupId: gid, toId: inv.id, amount: inv.amount, status: INVITE_STATUS.open }))), `Invited ${people.get(inv.id)?.name ?? 'a member'} (${dash(inv.amount)}).`);
      navigate(`/g/${gid}`);
    });
  };

  return (
    <div className="page">
      <PageHead title="Open a group" lede="A group is where co-owners and an operator agree on one masternode. You accept seats, and when the shares reach 1000 DASH you lock the terms for everyone to approve." />
      {prefill && (
        <p className="notice-box small">
          Opening a group for a match: your {dash(prefill.myAmount)} plus {prefill.invites.length} {prefill.invites.length === 1 ? 'person' : 'people'} you will invite. {prefill.note}
        </p>
      )}
      <form className="form form-card new-group" onSubmit={submit} aria-busy={busy} data-testid="new-group-form">
        <fieldset disabled={busy}>
          <legend className="visually-hidden">The group</legend>
          <fieldset className="kind-pick">
            <legend>Who runs the node?</legend>
            <label className={`choice-card${kind === 'member' ? ' on' : ''}`}>
              <input type="radio" name="kind" checked={kind === 'member'} onChange={() => setKind('member')} />
              <span>
                <b>An operator we choose</b>
                <span className="small muted block">You bring a share and organize; pick an operator from the directory now or later.</span>
              </span>
            </label>
            <label className={`choice-card${kind === 'operator' ? ' on' : ''}`}>
              <input type="radio" name="kind" checked={kind === 'operator'} onChange={() => setKind('operator')} data-testid="kind-operator" />
              <span>
                <b>I run it</b>
                <span className="small muted block">You are the operator and set the reward. You may also bring a share.</span>
              </span>
            </label>
          </fieldset>
          {kind === 'operator' && myListing.status === 'ready' && !listing && (
            <p className="small notice-box">
              You have no operator listing yet. Members trust an operator they can look up: <Link to="/me#operator">add your listing</Link> (it can wait).
            </p>
          )}

          <Field label="Group name" problem={title ? problems.title : null} hint="Shown in lists. Plain words, like “Lisbon node, 2027”.">
            {({ id, describedBy, invalid }) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} aria-describedby={describedBy} aria-invalid={invalid || undefined} data-testid="group-title" />}
          </Field>
          <Field label="About the group" optional>
            {({ id }) => <textarea id={id} value={about} onChange={(e) => setAbout(e.target.value)} maxLength={1000} rows={3} />}
          </Field>

          <DashField
            label={kind === 'member' ? 'Your share' : 'Your own share'}
            optional={kind === 'operator'}
            value={myAmount}
            onChange={setMyAmount}
            problem={myAmount ? problems.amount : null}
            hint="100 to 900 DASH, from your own Dash Core wallet. Others fill the rest up to 1000."
            testId="group-my-amount"
          />
          {amountDuffs !== null && !problems.amount && (
            <div className="checks">
              <label className="check">
                <input type="checkbox" checked={coordinate} onChange={(e) => setCoordinate(e.target.checked)} />I can coordinate: I have Dash-Qt 24 on a computer
              </label>
              <label className="check">
                <input type="checkbox" checked={holdKey} onChange={(e) => setHoldKey(e.target.checked)} />I can hold the voting key
              </label>
            </div>
          )}

          {kind === 'member' && (
            <Field label="Operator" hint={chosen ? `${operatorName(chosen)} asks ${pct(chosen.rewardBps)}. They accept or decline from the group page.` : 'You can choose later; operators can also offer.'}>
              {({ id, describedBy }) => (
                <select id={id} value={operatorId} onChange={(e) => setOperatorId(e.target.value)} aria-describedby={describedBy} data-testid="group-operator">
                  <option value="">To be chosen</option>
                  {operators
                    .filter((o) => o.status === OPERATOR_STATUS.open || o.ownerId === operatorId)
                    .map((o) => (
                      <option key={o.ownerId} value={o.ownerId}>
                        {operatorName(o)} ({pct(o.rewardBps)})
                      </option>
                    ))}
                  {operatorId && !chosen && <option value={operatorId}>The operator from your link</option>}
                </select>
              )}
            </Field>
          )}
          <PercentField
            label={kind === 'operator' ? 'Your operator reward' : 'Operator reward you propose'}
            value={reward}
            onChange={(v) => {
              setReward(v);
              setRewardTouched(true);
            }}
            problem={problems.reward}
            hint="The operator’s cut of every masternode payment; the rest is split by share."
            testId="group-reward"
          />
          {rewardBps !== null && <Warnings items={termWarnings({ earlyPeriodBlocks: 1, rewardBps })} />}

          <fieldset className="kind-pick">
            <legend>Seats</legend>
            <label className={`choice-card${openAmounts ? ' on' : ''}`}>
              <input type="radio" name="amounts" checked={openAmounts} onChange={() => setOpenAmounts(true)} />
              <span>
                <b>Anyone can ask for a seat</b>
                <span className="small muted block">Members propose any amount that still lets the group reach exactly 1000.</span>
              </span>
            </label>
            <label className={`choice-card${!openAmounts ? ' on' : ''}`}>
              <input type="radio" name="amounts" checked={!openAmounts} onChange={() => setOpenAmounts(false)} />
              <span>
                <b>By invitation</b>
                <span className="small muted block">You invite people who are looking, with the amount for each seat.</span>
              </span>
            </label>
          </fieldset>

          <ExitTermsField period={period} onPeriod={setPeriod} penalty={penalty} onPenalty={setPenalty} problem={period === 0 || penalty.trim() ? problems.exit : null} rewardBps={rewardBps} />

          <fieldset className="subfields">
            <legend>Coordinating</legend>
            <Field label="Group chat link" optional problem={problems.chat} hint="Discord, Yappr, Telegram or Matrix. Cairn has no chat of its own.">
              {({ id, describedBy, invalid }) => <input id={id} value={chat} onChange={(e) => setChat(e.target.value)} inputMode="url" placeholder="https://…" aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
            </Field>
            <Field label="Form by" optional hint="A date to aim for. Afterwards, members are reminded to release coins they reserved in Dash-Qt.">
              {({ id, describedBy }) => <input id={id} type="date" value={formBy} onChange={(e) => setFormBy(e.target.value)} aria-describedby={describedBy} />}
            </Field>
            <Field label="How the voting key is used" optional hint="For example: “votes as the majority of shares decides in the group chat”.">
              {({ id, describedBy }) => <input id={id} value={policy} onChange={(e) => setPolicy(e.target.value)} maxLength={280} aria-describedby={describedBy} />}
            </Field>
          </fieldset>

          {invites.length > 0 && (
            <fieldset className="subfields">
              <legend>Invite</legend>
              <ul className="invite-list">
                {invites.map((inv, i) => (
                  <li key={inv.id}>
                    <PersonName id={inv.id} person={people.get(inv.id)} /> <span className="num">{dash(inv.amount)}</span>
                    {inviteProblems[i] && <span className="field-problem small"> {inviteProblems[i]}</span>}
                    <button type="button" className="btn btn-quiet btn-s" onClick={() => setInvites((xs) => xs.filter((x) => x.id !== inv.id))} aria-label={`Do not invite ${people.get(inv.id)?.name ?? 'this person'}`}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          {ruleProblem && (
            <p className="field-problem" role="alert">
              {ruleProblem}
            </p>
          )}
          <p className="small muted">
            Opening costs about 0.0005 DASH of credit{amountDuffs ? ', your seat about the same' : ''}
            {invites.length ? `, and each invitation about the same` : ''}.
          </p>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-l" disabled={blocked || busy} data-testid="group-create">
              {busy ? 'Opening…' : createdId ? 'Finish' : 'Open the group'}
            </button>
            {blocked && firstProblem && <span className="small muted">{firstProblem}</span>}
          </div>
        </fieldset>
        {(busy || progress.length > 0) && (
          <ol className="progress-list small" aria-live="polite">
            {progress.map((p) => (
              <li key={p}>{p}</li>
            ))}
            {busy && (
              <li>
                <span className="spinner" aria-hidden="true" /> Signing and confirming on Dash Platform…
              </li>
            )}
          </ol>
        )}
        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
            {createdId && (
              <p>
                The group itself was created. <Link to={`/g/${createdId}`}>Open it</Link> to finish from there, or press Finish to try the rest again.
              </p>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
