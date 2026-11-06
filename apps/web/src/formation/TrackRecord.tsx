// O6: an operator's track record from chain data only. Every Cairn group naming this operator whose linked registration proves to be
// exactly what its members approved counts; groups' own status claims and the operator's profile never do.
import { groupsOfOperator, toGroup, type Group } from '@cairn/contract';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/context.tsx';
import type { Registry } from '../config/registry.ts';
import { queryCairn } from '../data/platform.ts';
import { errText } from '../lib/format.ts';
import { lookupRegistration } from './chain.ts';
import { agreementOf, linkedProTx, readGroupBundle } from './data.ts';
import { judgeRegistration, type MnState, type RegistrationJudgement } from './verify.ts';
import './formation.css';

export interface TrackEntry {
  group: Pick<Group, 'id' | 'title'>;
  judgement: RegistrationJudgement;
}

export interface TrackSummary {
  /** Groups naming this operator that have a registration linked. */
  linked: number;
  /** Live and verified: the registration is exactly what every member approved, proven on chain. */
  verified: TrackEntry[];
  byState: Record<MnState, number>;
}

export function summarizeTrack(entries: readonly TrackEntry[], linked: number): TrackSummary {
  const verified = entries.filter((e) => e.judgement.state === 'verified');
  const byState: Record<MnState, number> = { valid: 0, banned: 0, dissolved: 0, unknown: 0 };
  for (const e of verified) byState[e.judgement.mnState]++;
  return { linked, verified, byState };
}

/** Every group of the operator with a linked registration, each checked against its approvals and the chain (one at a time). */
export async function readTrackRecord(r: Registry, operatorId: string, onProgress?: (m: string) => void): Promise<TrackSummary> {
  const res = await queryCairn(r, groupsOfOperator(operatorId));
  const groups = res.docs.flatMap((d) => {
    try {
      return [toGroup(d, r.network)];
    } catch {
      return [];
    }
  });
  const entries: TrackEntry[] = [];
  const counted = new Set<string>();
  let linked = 0;
  for (const g of groups.filter((x) => x.lockedHash)) {
    const bundle = await readGroupBundle(r, g.id);
    if (!bundle || bundle.group.operatorId !== operatorId) continue;
    const hashes = linkedProTx(bundle.group, bundle.seats);
    if (!hashes.length) continue;
    linked++;
    const agreement = agreementOf(bundle.group, bundle.approvals, r.network);
    for (const { hash } of hashes) {
      if (counted.has(hash)) continue;
      onProgress?.(`Checking “${bundle.group.title}” against the chain`);
      const j = judgeRegistration(agreement, await lookupRegistration(r, hash));
      entries.push({ group: { id: g.id, title: bundle.group.title }, judgement: j });
      if (j.state === 'verified') {
        counted.add(hash);
        break;
      }
    }
  }
  return summarizeTrack(entries, linked);
}

type TrackState = { status: 'loading'; progress: string } | { status: 'error'; error: string } | { status: 'ready'; summary: TrackSummary };

export function useOperatorTrackRecord(operatorId: string | undefined): TrackState {
  const { registry } = useApp();
  const [state, setState] = useState<TrackState>({ status: 'loading', progress: 'Reading this operator’s groups' });
  useEffect(() => {
    if (!operatorId || !registry.contractId) return;
    let live = true;
    setState({ status: 'loading', progress: 'Reading this operator’s groups' });
    readTrackRecord(registry, operatorId, (progress) => live && setState({ status: 'loading', progress })).then(
      (summary) => live && setState({ status: 'ready', summary }),
      (e: unknown) => live && setState({ status: 'error', error: errText(e) }),
    );
    return () => {
      live = false;
    };
  }, [registry, operatorId]);
  return state;
}

const MN_WORD: Record<MnState, string> = { valid: 'valid', banned: 'PoSe-banned', dissolved: 'dissolved', unknown: 'list unavailable' };

export function OperatorTrackRecord({ operatorId }: { operatorId: string }) {
  const state = useOperatorTrackRecord(operatorId);
  return (
    <section className="track" aria-labelledby="track-title" data-testid="track-record">
      <h2 id="track-title">Track record</h2>
      <p className="small muted">From the chain only: a group counts when its registration is proven on chain and is exactly what every member approved.</p>
      {state.status === 'loading' ? (
        <p className="small muted" role="status">
          <span className="spinner" aria-hidden="true" /> {state.progress}
        </p>
      ) : state.status === 'error' ? (
        <p className="small error" role="alert">
          The track record could not be checked: {state.error}
        </p>
      ) : (
        <TrackBody summary={state.summary} />
      )}
    </section>
  );
}

function TrackBody({ summary }: { summary: TrackSummary }) {
  const v = summary.verified;
  if (!v.length) {
    return <p data-testid="track-summary">{summary.linked ? `${summary.linked} Cairn ${summary.linked === 1 ? 'group has' : 'groups have'} a registration linked, but none is verified yet.` : 'No Cairn group with this operator is live yet.'}</p>;
  }
  const parts = (['valid', 'banned', 'dissolved', 'unknown'] as const).filter((k) => summary.byState[k]).map((k) => `${summary.byState[k]} ${MN_WORD[k]}`);
  return (
    <>
      <p className="track-summary" data-testid="track-summary">
        <b className="track-n">{v.length}</b> Cairn {v.length === 1 ? 'group' : 'groups'} live and verified · {parts.join(', ')} in the masternode list now
      </p>
      <ul className="track-list">
        {v.map((e) => (
          <li key={e.judgement.proTxHash}>
            <Link to={`/g/${e.group.id}/live`}>{e.group.title}</Link>
            <span className={`mn-chip mn-${e.judgement.mnState}`}>{MN_WORD[e.judgement.mnState]}</span>
            <span className="num small muted">{e.judgement.proTxHash.slice(0, 10)}…</span>
          </li>
        ))}
      </ul>
      <p className="small muted">
        The masternode list shows each node’s state now; Radar keeps its history of payments and uptime. A group links a registration by copying its terms, so the
        chain proves each masternode runs with this operator’s key, not that the operator is who their profile says: ask them to show the key in your group chat.
      </p>
    </>
  );
}
