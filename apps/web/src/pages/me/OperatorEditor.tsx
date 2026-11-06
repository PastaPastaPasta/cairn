// O1: the operator listing. Name, the reward asked by default and the range accepted, regions, hosting, how many more nodes,
// status, and the masternodes they already run (shown to others as "claimed", linked to Radar).
import { OPERATOR_STATUS, createOp, nameProblem, operatorData, operatorOf, replaceOp, toOperator, type Operator } from '@cairn/contract';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../app/context.tsx';
import { readOwn, useLoad } from '../../data/cairn.ts';
import { useWrite } from '../../data/write.ts';
import { radarMnUrl } from '../../lib/radar.ts';
import { bpsInput, parsePercentInput } from '../../matching/money.ts';
import { OPERATOR_STATUS_WORDS, rewardRange } from '../../matching/words.ts';
import { Field, PercentField } from '../../ui/fields.tsx';
import { WriteStatus } from '../../ui/Loaded.tsx';
import { useAction } from '../../ui/useAction.ts';

export function useMyOperator(identityId: string | null) {
  return useLoad(identityId ? `my-operator:${identityId}` : null, (r) => readOwn(r, 'operator', operatorOf(identityId!), identityId!, (d) => toOperator(d)));
}

const splitList = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

export function proTxProblems(lines: string[]): string | null {
  const bad = lines.filter((l) => !/^[0-9a-fA-F]{64}$/.test(l));
  if (bad.length) return `Each ProTx hash is 64 hex characters: ${bad.length === 1 ? `“${bad[0]!.slice(0, 20)}${bad[0]!.length > 20 ? '…' : ''}” is not` : `${bad.length} lines are not`}.`;
  if (lines.length > 20) return 'Up to 20 masternodes.';
  if (new Set(lines.map((l) => l.toLowerCase())).size !== lines.length) return 'A ProTx hash is listed twice.';
  return null;
}

export function OperatorEditor({ identityId }: { identityId: string }) {
  const { registry } = useApp();
  const mine = useMyOperator(identityId);
  const write = useWrite();
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState<string | null>(null);
  const current: Operator | null = mine.status === 'ready' ? mine.data : null;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [reward, setReward] = useState('10');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [regions, setRegions] = useState('');
  const [hosting, setHosting] = useState('');
  const [capacity, setCapacity] = useState('');
  const [claimed, setClaimed] = useState('');
  const [status, setStatus] = useState<number>(OPERATOR_STATUS.open);
  useEffect(() => {
    if (!current) return;
    setName(current.name);
    setReward(bpsInput(current.rewardBps));
    setMin(current.rewardMinBps === undefined ? '' : bpsInput(current.rewardMinBps));
    setMax(current.rewardMaxBps === undefined ? '' : bpsInput(current.rewardMaxBps));
    setRegions(current.regions.join(', '));
    setHosting(current.hosting ?? '');
    setCapacity(current.capacity === undefined ? '' : String(current.capacity));
    setClaimed(current.claimedProTx.join('\n'));
    setStatus(current.status);
  }, [current]);

  if (mine.status === 'loading') return <p className="small muted">Reading your listing…</p>;
  if (mine.status === 'error')
    return (
      <p className="error small" role="alert">
        Could not read your listing, so saving is off: {mine.error}{' '}
        <button type="button" className="btn btn-s" onClick={mine.reload}>
          Try again
        </button>
      </p>
    );

  if (current && !editing)
    return (
      <div className="listing-mine" data-testid="my-operator">
        <p>
          <Link to={`/operators/${identityId}`} className="fit-title">
            {current.name}
          </Link>{' '}
          <span className={`state state-${current.status === OPERATOR_STATUS.open ? 'ok' : 'muted'}`}>{OPERATOR_STATUS_WORDS[current.status]}</span>
        </p>
        <p className="small">
          Asks {rewardRange(current)}
          {current.regions.length ? ` · ${current.regions.join(', ')}` : ''}
          {current.capacity !== undefined ? ` · room for ${current.capacity}` : ''}
        </p>
        <div className="form-actions">
          <button type="button" className="btn btn-s" onClick={() => setEditing(true)}>
            Edit listing
          </button>
          <Link className="btn btn-s" to="/groups/new?kind=operator">
            Open a group you run
          </Link>
        </div>
        <WriteStatus busy={busy} error={error} done={saved} />
      </div>
    );

  if (!current && !editing)
    return (
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => setEditing(true)} data-testid="operator-start">
          List me as an operator
        </button>
      </div>
    );

  const bps = parsePercentInput(reward);
  const minBps = min.trim() ? parsePercentInput(min) : undefined;
  const maxBps = max.trim() ? parsePercentInput(max) : undefined;
  const capN = capacity.trim() ? Number(capacity) : undefined;
  const regionList = splitList(regions);
  const proTx = splitList(claimed);
  const problems = {
    name: name ? nameProblem(name) : null,
    reward: bps === null ? 'A percentage from 0 to 100.' : null,
    range:
      minBps === null || maxBps === null
        ? 'Percentages from 0 to 100.'
        : bps !== null && ((minBps ?? bps) > bps || (maxBps ?? bps) < bps)
          ? 'The range must include your default reward.'
          : null,
    regions: regionList.length > 8 ? 'Up to 8 regions.' : regionList.some((r) => r.length > 24) ? 'Each region up to 24 characters.' : null,
    capacity: capN !== undefined && (!Number.isInteger(capN) || capN < 0 || capN > 1000) ? 'A whole number, 0 to 1000.' : null,
    claimed: proTx.length ? proTxProblems(proTx) : null,
  };
  const blocked = !name.trim() || Object.values(problems).some(Boolean);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (blocked) return;
    void run(async () => {
      setSaved(null);
      const data = () => operatorData({ name, rewardBps: bps!, rewardMinBps: minBps ?? undefined, rewardMaxBps: maxBps ?? undefined, regions: regionList, hosting, capacity: capN, claimedProTx: proTx, status });
      const cid = registry.contractId!;
      await write(() => (current ? replaceOp(cid, 'operator', current.id, current.revision, data()) : createOp(cid, 'operator', data())));
      setSaved('Saved and read back from Dash Platform.');
      setEditing(false);
      mine.reload();
    });
  };
  return (
    <form className="form" onSubmit={submit} aria-busy={busy} data-testid="operator-form">
      <fieldset disabled={busy}>
        <legend className="visually-hidden">Operator listing</legend>
        <Field label="Name groups see" problem={problems.name}>
          {({ id, describedBy, invalid }) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={64} aria-describedby={describedBy} aria-invalid={invalid || undefined} data-testid="operator-name" />}
        </Field>
        <div className="field-row">
          <PercentField label="Your usual reward" value={reward} onChange={setReward} problem={problems.reward} testId="operator-reward" />
          <PercentField label="Lowest you accept" value={min} onChange={setMin} problem={problems.range} hint="Optional" />
          <PercentField label="Highest you ask" value={max} onChange={setMax} problem={problems.range} hint="Optional" />
        </div>
        <Field label="Regions" optional problem={problems.regions} hint="Where your servers are, separated by commas: “EU-West, US-East”.">
          {({ id, describedBy }) => <input id={id} value={regions} onChange={(e) => setRegions(e.target.value)} aria-describedby={describedBy} data-testid="operator-regions" />}
        </Field>
        <Field label="How you host" optional hint="Providers, monitoring, how you handle upgrades.">
          {({ id, describedBy }) => <textarea id={id} value={hosting} onChange={(e) => setHosting(e.target.value)} maxLength={1000} rows={3} aria-describedby={describedBy} />}
        </Field>
        <div className="field-row">
          <Field label="Room for" optional problem={problems.capacity} hint="More masternodes you will take on.">
            {({ id, describedBy }) => <input id={id} value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-describedby={describedBy} />}
          </Field>
          <Field label="Status">
            {({ id }) => (
              <select id={id} value={status} onChange={(e) => setStatus(Number(e.target.value))}>
                {Object.entries(OPERATOR_STATUS_WORDS).map(([v, w]) => (
                  <option key={v} value={v}>
                    {w}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field label="Masternodes you run" optional problem={problems.claimed} hint="ProTx hashes, one per line. Shown as “claimed” with a link to Radar; the chain-verified record is separate.">
          {({ id, describedBy, invalid }) => <textarea id={id} value={claimed} onChange={(e) => setClaimed(e.target.value)} rows={3} className="mono-input" spellCheck={false} aria-describedby={describedBy} aria-invalid={invalid || undefined} data-testid="operator-claimed" />}
        </Field>
        {proTx.length > 0 && !problems.claimed && (
          <ul className="claimed small">
            {proTx.map((p) => (
              <li key={p}>
                <a href={radarMnUrl(registry.network, p.toLowerCase())} target="_blank" rel="noopener noreferrer" className="mono-ish">
                  {p.slice(0, 10)}…
                </a>{' '}
                <span className="state state-muted">claimed</span>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">Your listing is public on Dash Platform. Saving costs about 0.0005 DASH of credit.</p>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || blocked} data-testid="operator-save">
            {busy ? 'Saving…' : current ? 'Save listing' : 'List me as an operator'}
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
