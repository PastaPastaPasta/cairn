// Form fields for matching: amounts in DASH, percentages, early-exit terms. Each field shows its rule's message as the user types
// (DESIGN S2), tied to the input with aria-describedby / aria-invalid so screen readers hear it too.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { EXIT_PRESETS, presetFor, termWarnings, BLOCKS_PER_DAY } from '../matching/exit.ts';

export function Field({ label, hint, problem, children, optional }: { label: ReactNode; hint?: ReactNode; problem?: string | null; optional?: boolean; children(p: { id: string; describedBy: string | undefined; invalid: boolean }): ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const problemId = `${id}-problem`;
  const describedBy = [hint ? hintId : null, problem ? problemId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {optional && <span className="small muted"> (optional)</span>}
      </label>
      {children({ id, describedBy, invalid: !!problem })}
      {hint && (
        <span id={hintId} className="small muted field-hint">
          {hint}
        </span>
      )}
      {problem && (
        <span id={problemId} className="small field-problem" role="alert">
          {problem}
        </span>
      )}
    </div>
  );
}

export function DashField({ label, value, onChange, problem, hint, optional, testId, disabled }: { label: ReactNode; value: string; onChange(v: string): void; problem?: string | null; hint?: ReactNode; optional?: boolean; testId?: string; disabled?: boolean }) {
  return (
    <Field label={label} hint={hint} problem={problem} optional={optional}>
      {({ id, describedBy, invalid }) => (
        <span className="unit-input">
          <input id={id} value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" autoComplete="off" spellCheck={false} aria-describedby={describedBy} aria-invalid={invalid || undefined} data-testid={testId} disabled={disabled} />
          <span className="unit" aria-hidden="true">
            DASH
          </span>
        </span>
      )}
    </Field>
  );
}

export function PercentField({ label, value, onChange, problem, hint, testId, disabled }: { label: ReactNode; value: string; onChange(v: string): void; problem?: string | null; hint?: ReactNode; testId?: string; disabled?: boolean }) {
  return (
    <Field label={label} hint={hint} problem={problem}>
      {({ id, describedBy, invalid }) => (
        <span className="unit-input unit-input-s">
          <input id={id} value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" autoComplete="off" aria-describedby={describedBy} aria-invalid={invalid || undefined} data-testid={testId} disabled={disabled} />
          <span className="unit" aria-hidden="true">
            %
          </span>
        </span>
      )}
    </Field>
  );
}

const daysOf = (blocks: number) => (blocks > 0 ? String(Math.round(blocks / BLOCKS_PER_DAY)) : '');
/** Custom days as blocks; NaN while the field is empty or zero, so the form's own rules refuse it instead of picking a preset. */
const daysToBlocks = (t: string) => (Number(t) > 0 ? Number(t) * BLOCKS_PER_DAY : NaN);

/** Early period by name (or custom days) and the penalty, with Core's rules and the warnings that matter. */
export function ExitTermsField({ period, onPeriod, penalty, onPenalty, problem, rewardBps, disabled }: { period: number; onPeriod(blocks: number): void; penalty: string; onPenalty(v: string): void; problem: string | null; rewardBps: number | null; disabled?: boolean }) {
  const name = useId();
  // "Other" is the user's choice, not whether the number happens to equal a preset: typing 91 or clearing the field keeps it open
  const [other, setOther] = useState(() => !presetFor(period));
  const [daysText, setDaysText] = useState(() => (presetFor(period) ? '' : daysOf(period)));
  useEffect(() => {
    if (Object.is(daysToBlocks(daysText), period)) return;
    setOther(!presetFor(period));
    setDaysText(presetFor(period) ? '' : daysOf(period));
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps -- only a change from outside (a reset) re-derives the field
  const days = Number(daysText);
  const daysProblem = !other ? null : !(days > 0) ? 'Enter the number of days, from 1 to 730.' : days > 730 ? 'At most 730 days: Dash Core’s cap is 2 years.' : null;
  const typeDays = (v: string) => {
    const t = v.replace(/\D/g, '');
    setDaysText(t);
    onPeriod(daysToBlocks(t));
  };
  return (
    <fieldset className="exit-terms" disabled={disabled}>
      <legend>Leaving early</legend>
      <p className="small muted">Anyone can always leave; that dissolves the masternode and gives every share back. In the early period, whoever leaves pays the penalty to the others.</p>
      <div className="pills" role="radiogroup" aria-label="Early period">
        {EXIT_PRESETS.map((p) => {
          const on = !other && period === p.blocks;
          return (
            <label key={p.id} className={on ? 'on' : ''}>
              <input
                type="radio"
                name={name}
                checked={on}
                onChange={() => {
                  setOther(false);
                  onPeriod(p.blocks);
                }}
              />
              {p.label}
            </label>
          );
        })}
        <label className={other ? 'on' : ''}>
          <input
            type="radio"
            name={name}
            checked={other}
            onChange={() => {
              setOther(true);
              typeDays('30');
            }}
          />
          Other
        </label>
      </div>
      {other && (
        <Field label="Early period in days" problem={daysProblem} hint={days > 0 ? `${(days * BLOCKS_PER_DAY).toLocaleString('en-US')} blocks at 576 a day; at most 730 days.` : 'At 576 blocks a day; at most 730 days.'}>
          {({ id, describedBy, invalid }) => <input id={id} inputMode="numeric" value={daysText} onChange={(e) => typeDays(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid || undefined} data-testid="period-days" />}
        </Field>
      )}
      {(other || period > 0) && <DashField label="Penalty for leaving early" value={penalty} onChange={onPenalty} problem={daysProblem ? null : problem} hint="Paid by whoever leaves early, split among the others. It must be less than the smallest share." testId="penalty" />}
      {!other && period === 0 && problem && (
        <p className="field-problem small" role="alert">
          {problem}
        </p>
      )}
      {rewardBps !== null && <Warnings items={termWarnings({ earlyPeriodBlocks: other && !(period > 0) ? 1 : period, rewardBps }).filter((w) => w.id === 'free-exit')} />}
    </fieldset>
  );
}

export function Warnings({ items }: { items: Array<{ id: string; text: string }> }) {
  if (!items.length) return null;
  return (
    <ul className="warnings" data-testid="warnings">
      {items.map((w) => (
        <li key={w.id} className="warning" data-warning={w.id}>
          {w.text}
        </li>
      ))}
    </ul>
  );
}
