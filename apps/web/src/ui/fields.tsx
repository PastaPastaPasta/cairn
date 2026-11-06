// Form fields for matching: amounts in DASH, percentages, early-exit terms. Each field shows its rule's message as the user types
// (DESIGN S2), tied to the input with aria-describedby / aria-invalid so screen readers hear it too.
import { useId, type ReactNode } from 'react';
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

/** Early period by name (or custom days) and the penalty, with Core's rules and the warnings that matter. */
export function ExitTermsField({ period, onPeriod, penalty, onPenalty, problem, rewardBps, disabled }: { period: number; onPeriod(blocks: number): void; penalty: string; onPenalty(v: string): void; problem: string | null; rewardBps: number | null; disabled?: boolean }) {
  const name = useId();
  const custom = !presetFor(period);
  const days = Math.round(period / BLOCKS_PER_DAY);
  return (
    <fieldset className="exit-terms" disabled={disabled}>
      <legend>Leaving early</legend>
      <p className="small muted">Anyone can always leave; that dissolves the masternode and gives every share back. In the early period, whoever leaves pays the penalty to the others.</p>
      <div className="pills" role="radiogroup" aria-label="Early period">
        {EXIT_PRESETS.map((p) => (
          <label key={p.id} className={period === p.blocks ? 'on' : ''}>
            <input type="radio" name={name} checked={period === p.blocks} onChange={() => onPeriod(p.blocks)} />
            {p.label}
          </label>
        ))}
        <label className={custom ? 'on' : ''}>
          <input type="radio" name={name} checked={custom} onChange={() => onPeriod(30 * BLOCKS_PER_DAY)} />
          Other
        </label>
      </div>
      {custom && (
        <Field label="Early period in days" hint={`${period.toLocaleString('en-US')} blocks at 576 a day; at most 730 days.`}>
          {({ id, describedBy }) => <input id={id} inputMode="numeric" value={days || ''} onChange={(e) => onPeriod(Math.max(0, Math.round(Number(e.target.value.replace(/\D/g, '')) * BLOCKS_PER_DAY)))} aria-describedby={describedBy} />}
        </Field>
      )}
      {period > 0 && <DashField label="Penalty for leaving early" value={penalty} onChange={onPenalty} problem={problem} hint="Paid by whoever leaves early, split among the others. It must be less than the smallest share." testId="penalty" />}
      {period === 0 && problem && (
        <p className="field-problem small" role="alert">
          {problem}
        </p>
      )}
      {rewardBps !== null && <Warnings items={termWarnings({ earlyPeriodBlocks: period, rewardBps }).filter((w) => w.id === 'free-exit')} />}
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
