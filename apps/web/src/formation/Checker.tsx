// The message checker (DESIGN.md M9): paste or drop what Dash-Qt copied and see, in this browser only, what it is and whether it is
// safe to act on. The text is read locally (a FileReader for files) and handed to pure functions; nothing is sent anywhere.
import { MAX_ENVELOPE_BYTES, type ChainShare, type TermSheet } from '@cairn/shares';
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { VERDICT_TITLE, checkMessage, dashPlain as dash, roundName, type CheckContext, type CheckView, type RowAddresses } from './checker.ts';
import { Icon } from '../ui/Icon.tsx';
import { FactList, FindingList, Technical, VerdictBanner } from './ui.tsx';

export interface CheckerProps {
  network: CheckContext['network'];
  /** The group's approved terms: the checker then gives a verdict against them. */
  terms?: TermSheet | null;
  /** The signed-in member's row label, preselected. */
  myLabel?: string;
  chainShares?: readonly ChainShare[];
  proTxHash?: string;
  /** Heading level text for the panel. */
  title?: string;
  intro?: string;
}

export function Checker({ network, terms, myLabel: initialLabel, chainShares, proTxHash, title = 'Check a message', intro }: CheckerProps) {
  const id = useId();
  const [text, setText] = useState('');
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [myLabel, setMyLabel] = useState(initialLabel ?? '');
  const [myOwner, setMyOwner] = useState('');
  const [dragging, setDragging] = useState(false);
  /** Rows seen in earlier messages of each session, kept only in this page's memory. */
  const seen = useRef(new Map<string, { rows: Record<string, RowAddresses>; revision: number }>());
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => setMyLabel(initialLabel ?? ''), [initialLabel]);

  const view = useMemo<CheckView>(() => {
    const ctx: CheckContext = {
      network,
      ...(terms ? { terms } : {}),
      ...(terms && myLabel ? { myLabel } : {}),
      ...(terms && myOwner.trim() ? { myOwnerAddress: myOwner.trim() } : {}),
      ...(chainShares ? { chainShares } : {}),
      ...(proTxHash ? { proTxHash } : {}),
    };
    const first = checkMessage(text, ctx);
    const earlier = first.session ? seen.current.get(first.session.id) : undefined;
    if (!earlier || !terms) return first;
    const v = checkMessage(text, { ...ctx, rowAddresses: earlier.rows });
    if (first.session!.revision < earlier.revision) {
      v.findings.push({ level: 'warn', code: 'older-revision', title: 'This is an older copy than one you checked before', detail: `revision ${first.session!.revision}; you already checked revision ${earlier.revision}` });
      if (v.verdict === 'ok') Object.assign(v, { verdict: 'warn', verdictTitle: VERDICT_TITLE.warn, verdictText: 'It matches the approved terms, but it is older than a copy you already checked: make sure you act on the newest one.' });
    }
    return v;
  }, [text, network, terms, myLabel, myOwner, chainShares, proTxHash]);

  useEffect(() => {
    if (!view.session || view.verdict === 'stop') return;
    const prev = seen.current.get(view.session.id);
    seen.current.set(view.session.id, { rows: { ...prev?.rows, ...view.session.rows }, revision: Math.max(prev?.revision ?? 0, view.session.revision) });
  }, [view]);

  const readFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_ENVELOPE_BYTES) {
      setFileNote(`${file.name} is too large to be a Dash-Qt message.`);
      return;
    }
    file.text().then(
      (t) => {
        setText(t);
        setFileNote(`Read ${file.name} in this browser.`);
      },
      () => setFileNote(`${file.name} could not be read.`),
    );
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    readFile(e.dataTransfer.files[0]);
  };

  return (
    <section className="checker" aria-labelledby={`${id}-title`} data-testid="checker">
      <div className="checker-head">
        <h2 id={`${id}-title`}>{title}</h2>
        {intro && <p className="muted">{intro}</p>}
      </div>
      <p className="checker-private small" data-testid="checker-private">
        <Icon name="lock" size={15} /> Checked in this browser. Nothing you paste or open here is uploaded or sent anywhere.
      </p>
      {terms && (
        <div className="checker-me">
          <label>
            <span>Your row</span>
            <select value={myLabel} onChange={(e) => setMyLabel(e.target.value)} data-testid="checker-my-row">
              <option value="">I’m not a co-owner here</option>
              {terms.shares.map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label} · {dash(s.amount)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>
              Your owner address <span className="muted">(from Dash-Qt, “Your share”)</span>
            </span>
            <input type="text" spellCheck={false} autoComplete="off" className="num" placeholder={terms.network === 'main' ? 'X…' : 'y…'} value={myOwner} onChange={(e) => setMyOwner(e.target.value)} data-testid="checker-owner" />
          </label>
        </div>
      )}
      <div
        className={`checker-drop${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <label htmlFor={`${id}-text`} className="visually-hidden">
          Message from Dash-Qt
        </label>
        <textarea
          id={`${id}-text`}
          className="checker-text num"
          rows={text ? 8 : 5}
          spellCheck={false}
          autoComplete="off"
          placeholder="Paste the message Dash-Qt copied (an invitation, locked terms, a signing request or a reply), a standby dissolution file, or transaction hex. You can also drop a file here."
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFileNote(null);
          }}
          data-testid="checker-input"
        />
        <div className="checker-actions">
          <button type="button" className="btn btn-s" onClick={() => fileInput.current?.click()}>
            Open a file…
          </button>
          <input ref={fileInput} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={(e) => readFile(e.target.files?.[0])} data-testid="checker-file" />
          {text && (
            <button type="button" className="btn btn-s" onClick={() => (setText(''), setFileNote(null))}>
              Clear
            </button>
          )}
          {fileNote && <span className="small muted">{fileNote}</span>}
        </div>
      </div>
      {view.kind !== 'empty' && <CheckResultView view={view} hasTerms={!!terms} />}
    </section>
  );
}

const ROUND_STEPS = ['Invitation → Details', 'Locked Terms → Approval', 'Signing Request → Signed Contribution'];

function CheckResultView({ view, hasTerms }: { view: CheckView; hasTerms: boolean }) {
  return (
    <div className="check-result" data-testid="check-result" aria-live="polite">
      {view.verdictTitle && <VerdictBanner verdict={view.verdict} title={view.verdictTitle} text={view.verdictText} />}
      <div className="check-what">
        <p className="check-kind">{view.title}</p>
        <p className="check-summary">{view.summary}</p>
      </div>
      {view.round && (
        <ol className="rounds" aria-label={roundName(view.round)}>
          {ROUND_STEPS.map((s, i) => (
            <li key={s} className={i + 1 < view.round! ? 'done' : i + 1 === view.round ? 'now' : ''} aria-current={i + 1 === view.round ? 'step' : undefined}>
              <span className="round-n">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      )}
      {view.facts.length > 0 && <FactList facts={view.facts} />}
      {view.rows.length > 0 && (
        <div className="table-wrap">
          <table className="check-rows" data-testid="check-rows">
            <caption className="visually-hidden">Shares in this message</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Name</th>
                <th scope="col" className="r">
                  Amount
                </th>
                <th scope="col">Details</th>
                {view.rows.some((r) => r.approval) && <th scope="col">Approval</th>}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.index} className={r.mine ? 'mine' : ''}>
                  <td className="num">{r.index + 1}</td>
                  <td>
                    {r.label || <span className="muted">(no name)</span>}
                    {r.mine && <span className="tag">you</span>}
                  </td>
                  <td className="num r">{dash(r.amount)}</td>
                  <td>{r.filled ? 'filled' : <span className="muted">waiting</span>}</td>
                  {r.approval && <td className={`appr appr-${r.approval}`}>{r.approval === 'valid' ? 'approved' : r.approval === 'invalid' ? 'invalid' : <span className="muted">not yet</span>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.findings.length > 0 && (
        <>
          <h3 className="check-h">{hasTerms ? 'Compared with what your group approved' : 'What Cairn checked'}</h3>
          <FindingList findings={view.findings} />
        </>
      )}
      {view.next.length > 0 && (
        <>
          <h3 className="check-h">What to do next</h3>
          <ol className="checker-next">
            {view.next.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ol>
        </>
      )}
      {(view.technical.length > 0 || view.rows.some((r) => r.ownerAddress)) && (
        <Technical>
          <FactList facts={view.technical} className="facts-tech" />
          {view.rows.some((r) => r.ownerAddress) && (
            <FactList
              className="facts-tech"
              facts={view.rows.map((r) => ({
                label: `${r.label || `Row ${r.index + 1}`} addresses`,
                value: r.ownerAddress ? `owner ${r.ownerAddress} · refund ${r.refundAddress || '–'} · reward ${r.rewardAddress || '(refund address)'}` : 'not filled yet',
              }))}
            />
          )}
        </Technical>
      )}
    </div>
  );
}
