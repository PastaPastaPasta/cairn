// M3 "Post that I'm looking": the amount, a specific operator or any, the most operator reward accepted, the early-exit terms
// accepted, and whether they can coordinate. One post per identity (unique on Platform): editing replaces it, closing keeps it.
import { LOOKING_STATUS, createOp, lookingData, lookingOf, replaceOp, toLooking, type Looking, type Operator } from '@cairn/contract';
import { useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../app/context.tsx';
import { readOwn, useLoad } from '../data/cairn.ts';
import { LISTED_OPERATORS, OPERATORS, useStatusList } from '../data/lists.ts';
import { useWrite } from '../data/write.ts';
import { EXIT_PRESETS, acceptedPeriod, periodWords } from '../matching/exit.ts';
import { DUFFS, bpsInput, dash, dashNum, parseDashInput, parsePercentInput, pct } from '../matching/money.ts';
import { operatorName } from '../matching/words.ts';
import { DashField, Field, PercentField } from './fields.tsx';
import { WriteStatus } from './Loaded.tsx';
import { useAction } from './useAction.ts';

/** The signed-in identity's looking post (any status), proved. */
export function useMyLooking(identityId: string | null) {
  return useLoad(identityId ? `my-looking:${identityId}` : null, (r) => readOwn(r, 'looking', lookingOf(identityId!), identityId!, (d) => toLooking(d)));
}

export function amountProblem(text: string, required = true): string | null {
  if (!text.trim()) return required ? 'Enter how much you would bring.' : null;
  const v = parseDashInput(text);
  if (v === null) return 'Enter an amount in DASH, like 250 or 312.5.';
  if (v < 100 * DUFFS) return 'A share is at least 100 DASH.';
  if (v > 900 * DUFFS) return 'A share is at most 900 DASH: a masternode needs at least two people.';
  return null;
}

export function LookingSummary({ l, operators }: { l: Looking; operators: ReadonlyMap<string, Operator> }) {
  const op = l.operatorId ? operators.get(l.operatorId) : null;
  const { maxPenalty: pen } = l.earlyPref;
  const p = acceptedPeriod(l.earlyPref.maxPeriodBlocks);
  return (
    <ul className="facts-inline small">
      <li>
        <b className="num">{dash(l.amount)}</b>
      </li>
      <li>{l.operatorId ? <>Wants {op ? operatorName(op) : 'a specific operator'}</> : 'Any operator'}</li>
      <li>Operator reward up to {pct(l.maxRewardBps)}</li>
      <li>{p === null && pen === null ? 'Any exit terms' : [p !== null ? (p === 0 ? 'No early period' : `Early period up to ${periodWords(p)}`) : null, pen !== null ? `penalty up to ${dash(pen)}` : null].filter(Boolean).join(', ')}</li>
      {l.canCoordinate && <li>Can coordinate in Dash-Qt</li>}
    </ul>
  );
}

export function LookingEditor({ identityId, onChange, onSaved }: { identityId: string; onChange?(l: Looking | null): void; onSaved?(): void }) {
  const { registry } = useApp();
  const mine = useMyLooking(identityId);
  const ops = useStatusList(OPERATORS, LISTED_OPERATORS);
  const write = useWrite();
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const current = mine.status === 'ready' ? mine.data : null;
  const known = mine.status === 'ready';
  useEffect(() => {
    if (known) onChange?.(current);
  }, [known, current, onChange]);

  const [amount, setAmount] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [maxReward, setMaxReward] = useState('10');
  const [period, setPeriod] = useState('any');
  const [penalty, setPenalty] = useState('');
  const [coordinate, setCoordinate] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!current) return;
    setAmount(dashNum(current.amount));
    setOperatorId(current.operatorId ?? '');
    setMaxReward(bpsInput(current.maxRewardBps));
    setPeriod(current.earlyPref.maxPeriodBlocks === null ? 'any' : String(acceptedPeriod(current.earlyPref.maxPeriodBlocks)));
    setPenalty(current.earlyPref.maxPenalty === null ? '' : dashNum(current.earlyPref.maxPenalty));
    setCoordinate(current.canCoordinate);
    setNote(current.note ?? '');
  }, [current]);

  if (mine.status === 'loading') return <p className="muted small">Reading your post…</p>;
  if (mine.status === 'error')
    return (
      <p className="error small" role="alert">
        Could not read your post, so posting is off until it can be read: {mine.error}{' '}
        <button type="button" className="btn btn-s" onClick={mine.reload}>
          Try again
        </button>
      </p>
    );

  const operators = ops.status === 'ready' ? ops.data.items : [];
  const opMap = new Map(operators.map((o) => [o.ownerId, o]));
  const rewardBps = parsePercentInput(maxReward);
  const penaltyDuffs = penalty.trim() ? parseDashInput(penalty) : null;
  const problems = {
    amount: amountProblem(amount),
    reward: rewardBps === null ? 'A percentage from 0 to 100.' : null,
    penalty: penalty.trim() && penaltyDuffs === null ? 'Enter an amount in DASH, or leave it empty for any.' : null,
  };
  const blocked = Object.values(problems).some(Boolean);

  const save = (status: number) =>
    run(async () => {
      setSaved(null);
      const data = () =>
        lookingData({
          amount: parseDashInput(amount)!,
          operatorId: operatorId || undefined,
          maxRewardBps: rewardBps!,
          earlyPref: { maxPeriodBlocks: period === 'any' ? null : Number(period), maxPenalty: penaltyDuffs },
          canCoordinate: coordinate,
          note,
          status,
        });
      const cid = registry.contractId!;
      const back = await write(() => (current ? replaceOp(cid, 'looking', current.id, current.docRevision, data()) : createOp(cid, 'looking', data())));
      const l = toLooking(back!);
      setSaved(status === LOOKING_STATUS.open ? 'Posted and read back from Dash Platform.' : 'Closed. Your post is no longer listed.');
      setEditing(false);
      mine.reload();
      onChange?.(l);
      onSaved?.();
    });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!blocked) void save(LOOKING_STATUS.open);
  };

  if (current && !editing) {
    const open = current.status === LOOKING_STATUS.open;
    return (
      <div className="looking-mine" data-testid="my-looking">
        <p>
          <span className={`state state-${open ? 'ok' : 'muted'}`}>{open ? 'Listed: groups can find and invite you' : 'Closed'}</span>
        </p>
        <LookingSummary l={current} operators={opMap} />
        {current.note && <p className="row-note">{current.note}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-s" onClick={() => setEditing(true)} disabled={busy}>
            Edit
          </button>
          {open ? (
            <button type="button" className="btn btn-s" onClick={() => void save(LOOKING_STATUS.closed)} disabled={busy} data-testid="close-looking">
              Close my post
            </button>
          ) : (
            <button type="button" className="btn btn-s btn-primary" onClick={() => void save(LOOKING_STATUS.open)} disabled={busy || blocked}>
              List it again
            </button>
          )}
        </div>
        <WriteStatus busy={busy} error={error} done={saved} />
      </div>
    );
  }

  return (
    <form className="form looking-form" onSubmit={submit} aria-busy={busy} data-testid="looking-form">
      <fieldset disabled={busy}>
        <legend className="visually-hidden">Your looking post</legend>
        <DashField label="How much you would bring" value={amount} onChange={setAmount} problem={amount ? problems.amount : null} hint="100 to 900 DASH. It stays in your own Dash Core wallet until the masternode is formed." testId="looking-amount" />
        <Field label="Operator">
          {({ id, describedBy }) => (
            <select id={id} value={operatorId} onChange={(e) => setOperatorId(e.target.value)} aria-describedby={describedBy}>
              <option value="">Any operator</option>
              {operators.map((o) => (
                <option key={o.ownerId} value={o.ownerId}>
                  {operatorName(o)} ({pct(o.rewardBps)})
                </option>
              ))}
              {operatorId && !opMap.has(operatorId) && <option value={operatorId}>The operator you chose before</option>}
            </select>
          )}
        </Field>
        <PercentField label="Most operator reward you accept" value={maxReward} onChange={setMaxReward} problem={problems.reward} hint="The share of each reward the operator keeps. Typical asks are 5 to 20%." testId="looking-reward" />
        <fieldset className="subfields">
          <legend>Early-exit terms you accept</legend>
          <Field label="Longest early period">
            {({ id }) => (
              <select id={id} value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="any">Any</option>
                <option value="0">None: I only join groups anyone can leave freely</option>
                {EXIT_PRESETS.slice(1).map((p) => (
                  <option key={p.id} value={String(p.blocks)}>
                    Up to {p.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {period !== '0' && <DashField label="Largest penalty" value={penalty} onChange={setPenalty} problem={problems.penalty} hint="Leave empty for any." optional />}
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={coordinate} onChange={(e) => setCoordinate(e.target.checked)} />I can coordinate: I have Dash-Qt 24 on a computer
        </label>
        <Field label="A note for organizers" optional>
          {({ id }) => <textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder="Where you are, when you are free, anything that helps." />}
        </Field>
        <p className="small muted">Your post is public on Dash Platform. Posting costs about 0.0005 DASH of credit.</p>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || blocked} data-testid="looking-save">
            {busy ? 'Posting…' : current ? 'Save changes' : 'Post that I’m looking'}
          </button>
          {current && (
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
        </div>
      </fieldset>
      <WriteStatus busy={busy} error={error} done={saved} />
    </form>
  );
}
