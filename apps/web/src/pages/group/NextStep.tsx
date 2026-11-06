// "Your next step": one panel per role the viewer has in the group, each with the one thing to do now. Member and operator steps
// are done right here; the organizer's point to the section that does them.
import { OP_ACCEPT_STATUS, SEAT_STATUS } from '@cairn/contract';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../app/context.tsx';
import { fitsAsChange, fitsRoster, type GroupView } from '../../matching/group.ts';
import { blsPointProblem, blsFormatProblem, serviceProblem, votingAddressProblem } from '../../matching/keys.ts';
import { DUFFS, bpsInput, dash, dashNum, parseDashInput, parsePercentInput, pct } from '../../matching/money.ts';
import { ROLE_WORDS, seatFlags, seatOffers, stepHref, type Step } from '../../matching/nextstep.ts';
import { openSignIn } from '../../ui/Account.tsx';
import { DashField, Field, PercentField, Warnings } from '../../ui/fields.tsx';
import { WriteStatus } from '../../ui/Loaded.tsx';
import { useAction } from '../../ui/useAction.ts';
import { termWarnings } from '../../matching/exit.ts';
import { seatFieldsOf, type GroupOps } from './ops.ts';

interface Props {
  view: GroupView;
  steps: Step[];
  ops: GroupOps;
  me: string | null;
  done(): void;
}

export function NextSteps({ view, steps, ops, me, done }: Props) {
  if (!steps.length) return null;
  return (
    <section className="next-steps" aria-label="Your next step" data-testid="next-steps">
      {steps.map((s) => (
        <div key={s.role} className={`next-step next-${s.tone}`} data-role={s.role} data-testid={`step-${s.role}`}>
          <p className="next-role small">{ROLE_WORDS[s.role]}</p>
          <h2 className="next-title">{s.title}</h2>
          <p>{s.text}</p>
          <StepAction step={s} view={view} ops={ops} me={me} done={done} />
        </div>
      ))}
    </section>
  );
}

function StepAction({ step, view, ops, me, done }: { step: Step; view: GroupView; ops: GroupOps; me: string | null; done(): void }) {
  const g = view.group;
  const jump = (to: string, label: string) => (
    <a className="btn btn-s" href={`#${to}`}>
      {label}
    </a>
  );
  switch (step.action) {
    case 'sign-in':
      return (
        <button type="button" className="btn btn-primary" onClick={openSignIn}>
          Sign in
        </button>
      );
    case 'post-looking':
      return (
        <Link className="btn btn-s" to="/looking">
          Post that I’m looking
        </Link>
      );
    case 'request-seat':
      return <SeatForm view={view} ops={ops} me={me!} done={done} mode="request" />;
    case 'manage-request':
      return <SeatForm view={view} ops={ops} me={me!} done={done} mode="manage" />;
    case 'answer-invite':
      return <InviteAnswer view={view} ops={ops} me={me!} done={done} />;
    case 'confirm-seat':
      return <SeatForm view={view} ops={ops} me={me!} done={done} mode="confirm" />;
    case 'voting-address':
      return <VotingAddressForm view={view} ops={ops} me={me!} done={done} />;
    case 'approve':
    case 'reapprove':
      return jump('terms', 'Read the terms');
    case 'form':
      return (
        <Link className="btn btn-primary" to={stepHref(step, g.id)} data-testid="next-form">
          Next: form it in Dash Core →
        </Link>
      );
    case 'check':
      return (
        <Link className="btn btn-primary" to={stepHref(step, g.id)} data-testid="next-check">
          Open the message checker →
        </Link>
      );
    case 'live':
      return (
        <Link className="btn btn-s" to={stepHref(step, g.id)} data-testid="next-live">
          See it on the live page →
        </Link>
      );
    case 'refill':
      return jump('refill', 'Reopen with the same terms');
    case 'review-requests':
      return jump('requests', 'See the requests');
    case 'fix-roster':
      return jump('roster', 'See the roster');
    case 'invite':
      return jump('invite', 'Who fits');
    case 'choose-operator':
      return jump('operator', 'Choose an operator');
    case 'prepare-lock':
      return jump('lock', view.locked ? 'Lock again' : 'Prepare and lock');
    case 'operator-answer':
    case 'offer':
      return <OperatorAnswer view={view} ops={ops} done={done} offer={step.action === 'offer'} />;
    case 'operator-key':
      return <OperatorKey ops={ops} done={done} />;
    case 'none':
      return null;
  }
}

/** A seat request (visitor), a change or withdrawal (requester, member), or the member's confirmation of a roster entry. */
export function SeatForm({ view, ops, me, done, mode }: { view: GroupView; ops: GroupOps; me: string; done(): void; mode: 'request' | 'manage' | 'confirm' }) {
  const g = view.group;
  const seat = ops.mySeat;
  const share = view.shares.find((s) => s.id === me);
  const [amount, setAmount] = useState(seat ? dashNum(seat.amount) : '');
  const [message, setMessage] = useState(seat?.message ?? '');
  const [coordinate, setCoordinate] = useState(seatOffers(seat?.flags).coordinate);
  const [holdKey, setHoldKey] = useState(seatOffers(seat?.flags).holdKey);
  const { busy, error, run } = useAction();
  const duffs = parseDashInput(amount);
  const fit = duffs === null ? null : share ? fitsAsChange(g, share.id, duffs) : fitsRoster(g.roster, duffs, g.earlyPenalty);
  const problem = !amount.trim() ? null : duffs === null ? 'Enter an amount in DASH.' : duffs < 100 * DUFFS ? 'A share is at least 100 DASH.' : fit && !fit.ok ? fit.message : null;
  const flags = seatFlags(coordinate, holdKey, seat?.flags);
  const save = (status: number, amt: number) =>
    run(async () => {
      await ops.seat({ amount: amt, message, status, flags, votingAddress: seat?.votingAddress, proTxHash: seat?.proTxHash });
      done();
    });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'confirm') return void (share && save(SEAT_STATUS.requested, share.amount));
    if (!problem && duffs !== null) void save(SEAT_STATUS.requested, duffs);
  };
  const flagsUi = (
    <div className="checks">
      <label className="check">
        <input type="checkbox" checked={coordinate} onChange={(e) => setCoordinate(e.target.checked)} />I can coordinate: Dash-Qt 24 on a computer
      </label>
      <label className="check">
        <input type="checkbox" checked={holdKey} onChange={(e) => setHoldKey(e.target.checked)} />I can hold the voting key
      </label>
    </div>
  );
  if (mode === 'confirm') {
    const amt = share?.amount;
    return (
      <form className="form form-tight" onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy}>
          {flagsUi}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" data-testid="seat-confirm">
              Confirm my {amt ? dash(amt) : ''} seat
            </button>
          </div>
        </fieldset>
        <WriteStatus busy={busy} error={error} />
      </form>
    );
  }
  return (
    <form className="form form-tight" onSubmit={submit} aria-busy={busy} data-testid="seat-form">
      <fieldset disabled={busy}>
        <DashField label={mode === 'request' ? 'Your share' : 'Your share (change it)'} value={amount} onChange={setAmount} problem={problem} hint={`${dash(view.remaining)} still open. 100 DASH or more; what is left must still be possible to fill.`} testId="seat-amount" />
        {mode === 'request' && (
          <Field label="A note to the organizer" optional>
            {({ id }) => <input id={id} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={280} />}
          </Field>
        )}
        {flagsUi}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={!!problem || duffs === null} data-testid="seat-save">
            {mode === 'request' ? (seat ? 'Ask again' : 'Ask for a seat') : 'Save'}
          </button>
          {mode === 'manage' && seat?.status === SEAT_STATUS.requested && (
            <button type="button" className="btn" onClick={() => void save(SEAT_STATUS.withdrawn, seat.amount)} data-testid="seat-withdraw">
              Withdraw
            </button>
          )}
        </div>
        {mode === 'request' && <p className="small muted">You only say what you would bring; no DASH moves now. Asking costs about 0.0005 DASH of credit.</p>}
      </fieldset>
      <WriteStatus busy={busy} error={error} />
    </form>
  );
}

function InviteAnswer({ view, ops, me, done }: { view: GroupView; ops: GroupOps; me: string; done(): void }) {
  const inv = view.openInvites.find((i) => i.toId === me)!;
  const [coordinate, setCoordinate] = useState(false);
  const [holdKey, setHoldKey] = useState(false);
  const { busy, error, run } = useAction();
  const fit = fitsRoster(view.group.roster, inv.amount, view.group.earlyPenalty);
  const answer = (status: number) =>
    run(async () => {
      await ops.seat({ amount: inv.amount, status, flags: seatFlags(coordinate, holdKey), message: status === SEAT_STATUS.withdrawn ? 'Declined the invitation' : undefined });
      done();
    });
  return (
    <div className="form form-tight">
      {inv.message && <p className="quote">{inv.message}</p>}
      {!fit.ok && <p className="field-problem small">{fit.message}</p>}
      <div className="checks">
        <label className="check">
          <input type="checkbox" checked={coordinate} onChange={(e) => setCoordinate(e.target.checked)} />I can coordinate: Dash-Qt 24 on a computer
        </label>
        <label className="check">
          <input type="checkbox" checked={holdKey} onChange={(e) => setHoldKey(e.target.checked)} />I can hold the voting key
        </label>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !fit.ok} onClick={() => void answer(SEAT_STATUS.requested)} data-testid="invite-accept">
          Accept {dash(inv.amount)} seat
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void answer(SEAT_STATUS.withdrawn)} data-testid="invite-decline">
          Decline
        </button>
      </div>
      <WriteStatus busy={busy} error={error} />
    </div>
  );
}

function VotingAddressForm({ view, ops, me, done }: { view: GroupView; ops: GroupOps; me: string; done(): void }) {
  const { registry } = useApp();
  const asOperator = view.group.operatorId === me && !view.shares.some((s) => s.id === me);
  const current = asOperator ? ops.myAnswer?.votingAddress : ops.mySeat?.votingAddress;
  const [addr, setAddr] = useState(current ?? '');
  const { busy, error, run } = useAction();
  const problem = addr.trim() ? votingAddressProblem(addr, registry.network) : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem || !addr.trim()) return;
    void run(async () => {
      if (asOperator) {
        const a = ops.myAnswer!;
        await ops.answer({ status: a.status, rewardBps: a.rewardBps, operatorPubKey: a.operatorPubKey, service: a.service, message: a.message, votingAddress: addr.trim() });
      } else {
        await ops.seat({ ...seatFieldsOf(ops.mySeat!), votingAddress: addr.trim() });
      }
      done();
    });
  };
  return (
    <form className="form form-tight" onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy}>
        <Field label="Voting address" problem={problem} hint="In Dash Core: File → Receiving addresses → New. Keep this wallet: its key votes for the masternode.">
          {({ id, describedBy, invalid }) => <input id={id} value={addr} onChange={(e) => setAddr(e.target.value)} spellCheck={false} autoCapitalize="off" className="mono-input" aria-describedby={describedBy} aria-invalid={invalid || undefined} data-testid="voting-address" />}
        </Field>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={!!problem || !addr.trim()} data-testid="voting-address-save">
            Save the voting address
          </button>
        </div>
      </fieldset>
      <WriteStatus busy={busy} error={error} />
    </form>
  );
}

/** O3: the chosen operator accepts or declines a member-led group (or offers to run one with no operator yet). */
function OperatorAnswer({ view, ops, done, offer }: { view: GroupView; ops: GroupOps; done(): void; offer: boolean }) {
  const g = view.group;
  const a = ops.myAnswer;
  const [reward, setReward] = useState(bpsInput(g.rewardBps));
  const [message, setMessage] = useState(a?.message ?? '');
  const { busy, error, run } = useAction();
  const bps = parsePercentInput(reward);
  const save = (status: number) =>
    run(async () => {
      await ops.answer({ status, rewardBps: status === OP_ACCEPT_STATUS.accepted ? bps! : (a?.rewardBps ?? g.rewardBps), operatorPubKey: a?.operatorPubKey, service: a?.service, message, votingAddress: a?.votingAddress });
      done();
    });
  return (
    <div className="form form-tight">
      <PercentField label="The reward you accept" value={reward} onChange={setReward} problem={bps === null ? 'A percentage from 0 to 100.' : null} hint={bps !== null && bps !== g.rewardBps ? `The group proposes ${pct(g.rewardBps)}; the organizer decides whether to change it.` : `The group proposes ${pct(g.rewardBps)}.`} testId="answer-reward" />
      <Field label="A note to the group" optional>
        {({ id }) => <input id={id} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={280} />}
      </Field>
      {bps !== null && <Warnings items={termWarnings({ earlyPeriodBlocks: 1, rewardBps: bps })} />}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" disabled={busy || bps === null} onClick={() => void save(OP_ACCEPT_STATUS.accepted)} data-testid="answer-accept">
          {offer ? 'Offer to run it' : 'Accept'}
        </button>
        {!offer && (
          <button type="button" className="btn" disabled={busy} onClick={() => void save(OP_ACCEPT_STATUS.declined)} data-testid="answer-decline">
            Decline
          </button>
        )}
        {offer && a?.status === OP_ACCEPT_STATUS.accepted && (
          <button type="button" className="btn" disabled={busy} onClick={() => void save(OP_ACCEPT_STATUS.withdrawn)}>
            Withdraw my offer
          </button>
        )}
      </div>
      <WriteStatus busy={busy} error={error} />
    </div>
  );
}

/** O4: the operator's BLS public key and the node's service, checked as Dash Core checks them. */
function OperatorKey({ ops, done }: { ops: GroupOps; done(): void }) {
  const { registry } = useApp();
  const a = ops.myAnswer!;
  const [key, setKey] = useState(a.operatorPubKey ?? '');
  const [service, setService] = useState(a.service ?? '');
  const { busy, error, run } = useAction();
  const keyProblem = useBlsProblem(key);
  const svcProblem = service.trim() ? serviceProblem(service, registry.network) : null;
  const ready = key.trim() && service.trim() && !keyProblem && !svcProblem;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    void run(async () => {
      const p = await blsPointProblem(key);
      if (p) throw new Error(p);
      await ops.answer({ status: a.status, rewardBps: a.rewardBps, message: a.message, votingAddress: a.votingAddress, operatorPubKey: key.trim().toLowerCase(), service: service.trim() });
      done();
    });
  };
  return (
    <form className="form form-tight" onSubmit={submit} aria-busy={busy} data-testid="operator-key-form">
      <fieldset disabled={busy}>
        <BlsField value={key} onChange={setKey} problem={keyProblem} />
        <ServiceField value={service} onChange={setService} problem={svcProblem} network={registry.network} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={!ready} data-testid="operator-key-save">
            Save key and address
          </button>
        </div>
      </fieldset>
      <WriteStatus busy={busy} error={error} />
    </form>
  );
}

export function BlsField({ value, onChange, problem }: { value: string; onChange(v: string): void; problem: string | null }) {
  return (
    <Field label="BLS operator public key" problem={problem} hint="A fresh key for this masternode: `bls generate` on your node, the “public” value. Never share the secret.">
      {({ id, describedBy, invalid }) => <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={2} spellCheck={false} className="mono-input" aria-describedby={describedBy} aria-invalid={invalid || undefined} data-testid="operator-pubkey" />}
    </Field>
  );
}

export function ServiceField({ value, onChange, problem, network }: { value: string; onChange(v: string): void; problem: string | null; network: string }) {
  return (
    <Field label="Node address (IP:port)" problem={problem} hint={network === 'mainnet' ? 'Public IPv4, port 9999.' : 'Public IPv4 and the node’s P2P port (testnet: usually 19999).'}>
      {({ id, describedBy, invalid }) => <input id={id} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} inputMode="url" className="mono-input" aria-describedby={describedBy} aria-invalid={invalid || undefined} data-testid="operator-service" />}
    </Field>
  );
}

/** Live BLS check: the format at once, the curve point once the format is right. */
export function useBlsProblem(key: string): string | null {
  const [curve, setCurve] = useState<string | null>(null);
  useEffect(() => {
    setCurve(null);
    if (!key.trim() || blsFormatProblem(key)) return;
    let live = true;
    void blsPointProblem(key).then((p) => live && setCurve(p));
    return () => {
      live = false;
    };
  }, [key]);
  return key.trim() ? (blsFormatProblem(key) ?? curve) : null;
}
