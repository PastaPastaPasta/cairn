// Small pieces the formation pages share: copy buttons, the verdict banner, findings and fact lists.
import type { Finding, Level } from '@cairn/shares';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Fact, Verdict } from './checker.ts';
import './formation.css';

export function CopyButton({ value, label = 'Copy', what }: { value: string; label?: string; what?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1800);
  };
  return (
    <button type="button" className="copy-btn" onClick={copy} aria-label={what ? `${label} ${what}` : label} data-state={state}>
      <span aria-hidden="true" className="copy-icon">
        {state === 'copied' ? '✓' : '⧉'}
      </span>
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : label}</span>
    </button>
  );
}

/** A labelled value with its copy button: what the coordinator types into one Dash-Qt field. */
export function CopyValue({ label, value, copy, hint, mono = true }: { label: string; value: string; copy?: string; hint?: string; mono?: boolean }) {
  return (
    <div className="copy-value">
      <div className="copy-value-label">{label}</div>
      <div className="copy-value-body">
        <span className={`copy-value-text${mono && copy ? ' num break' : ''}`}>{value}</span>
        {copy !== undefined && <CopyButton value={copy} what={label} />}
      </div>
      {hint && <p className="copy-value-hint small muted">{hint}</p>}
    </div>
  );
}

const VERDICT_ICON: Record<Verdict, string> = { ok: '✓', warn: '!', stop: '✕', neutral: 'i' };

export function VerdictBanner({ verdict, title, text, children, testId = 'verdict' }: { verdict: Verdict; title: string; text: string; children?: ReactNode; testId?: string }) {
  return (
    <div className={`verdict verdict-${verdict}`} role={verdict === 'stop' ? 'alert' : 'status'} data-testid={testId} data-verdict={verdict}>
      <span className="verdict-icon" aria-hidden="true">
        {VERDICT_ICON[verdict]}
      </span>
      <div className="verdict-body">
        <p className="verdict-title">{title}</p>
        <p className="verdict-text">{text}</p>
        {children}
      </div>
    </div>
  );
}

const LEVEL_WORD: Record<Level, string> = { ok: 'Matches', info: 'Note', warn: 'Check', stop: 'Stop' };
const LEVEL_ORDER: Record<Level, number> = { stop: 0, warn: 1, ok: 2, info: 3 };

export function FindingList({ findings }: { findings: readonly Finding[] }) {
  const sorted = [...findings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return (
    <ul className="findings" data-testid="findings">
      {sorted.map((f, i) => (
        <li key={`${f.code}-${i}`} className={`finding finding-${f.level}`} data-code={f.code}>
          <span className="finding-level">{LEVEL_WORD[f.level]}</span>
          <div className="finding-body">
            <span className="finding-title">{f.title}</span>
            {f.detail && (
              <details className="finding-detail">
                <summary>Details</summary>
                <p className="small break">{f.detail}</p>
              </details>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function FactList({ facts, className = '' }: { facts: readonly Fact[]; className?: string }) {
  return (
    <dl className={`fact-grid ${className}`}>
      {facts.map((f) => (
        <div key={f.label} className={`fact${f.tone ? ` fact-${f.tone}` : ''}`}>
          <dt>{f.label}</dt>
          <dd className="break">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A disclosure for technical detail (raw hashes, RPC lines): DESIGN.md principle 5. */
export function Technical({ title = 'Technical details', children, testId }: { title?: string; children: ReactNode; testId?: string }) {
  return (
    <details className="technical" data-testid={testId}>
      <summary>{title}</summary>
      <div className="technical-body">{children}</div>
    </details>
  );
}

export function CodeBlock({ code, copyLabel = 'Copy' }: { code: string; copyLabel?: string }) {
  return (
    <div className="code-block">
      <pre>
        <code>{code}</code>
      </pre>
      <CopyButton value={code} label={copyLabel} />
    </div>
  );
}
