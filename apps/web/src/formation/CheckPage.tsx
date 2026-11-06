// /check: the standalone message checker. Works without an account or a group; `?group=<id>` compares against that group's terms.
import { coreNetwork } from '@cairn/contract';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { useGroupBundle } from '../data/cairn.ts';
import { agreementOf } from '../matching/agreement.ts';
import { PageHead } from '../ui/states.tsx';
import { Checker } from './Checker.tsx';
import { outsiderOf } from './checker.ts';
import { GroupTabs } from './parts.tsx';

export function CheckPage() {
  const { registry } = useApp();
  const [params] = useSearchParams();
  const groupId = params.get('group') ?? undefined;
  return (
    <div className="page check-page">
      <PageHead
        title="Check a Dash Core message"
        lede="Paste anything Dash-Qt’s Shared Masternode wizard gives you and see what it is, which round it belongs to, and whether it is safe to act on. It works without an account."
      />
      {groupId && registry.contractId && <GroupTabs id={groupId} />}
      <div className="check-layout">
        <div>{groupId && registry.contractId ? <GroupChecker groupId={groupId} /> : <Checker network={coreNetwork(registry.network)} title="Your message" />}</div>
        <aside className="check-aside" aria-label="About the checker">
          <h2>What it reads</h2>
          <ul className="ticks small">
            <li>
              <b>Session messages</b> from all three rounds: Invitation and Details, Locked Terms and Approval, Signing Request and Signed Contribution, and the
              Final Record.
            </li>
            <li>
              <b>Approval requests</b> for dissolving together or changing the operator or voting key.
            </li>
            <li>
              <b>Standby dissolution files</b> and bare transaction hex: a registration or a dissolution.
            </li>
          </ul>
          <h2>Against what you agreed</h2>
          <p className="small">
            On its own the checker can only tell whether Dash Core would accept a message. Open it from your group’s <b>Form</b> page and it compares every share, the
            operator, the reward, the IP address and the exit terms with the terms you approved on Cairn, and says whether it is safe to continue.
          </p>
          <p className="small">
            <Link to="/learn">How forming a shared masternode works</Link>
          </p>
        </aside>
      </div>
    </div>
  );
}

function GroupChecker({ groupId }: { groupId: string }) {
  const { registry } = useApp();
  const { session } = useAccount();
  const load = useGroupBundle(groupId);
  const bundle = load.status === 'ready' ? load.data : null;
  const a = useMemo(() => bundle && agreementOf(bundle.group, bundle.approvals, registry.network), [bundle, registry.network]);
  if (load.status === 'loading') return <p className="muted" role="status">Reading the group’s approved terms…</p>;
  if (!bundle || !a?.anchored || !a.terms) {
    return (
      <>
        <p className="notice-box small">
          {bundle ? `“${bundle.group.title}” has no terms every member approved yet, so there is nothing to compare with.` : 'That group could not be read.'} The checker below reads messages
          on their own.
        </p>
        <Checker network={coreNetwork(registry.network)} title="Your message" />
      </>
    );
  }
  const { group } = bundle;
  const mine = group.roster.find((r) => r.id === session?.identityId)?.label;
  // a link can name any group: only its co-owners and operator know these are the terms they agreed to themselves
  const outsider = outsiderOf(group, session?.identityId);
  return (
    <>
      {outsider && (
        <div className="notice-box check-foreign" data-testid="check-foreign-group">
          <p>
            <b>You are not on this group’s roster — this compares with someone else’s agreement.</b>{' '}
            {outsider === 'signed-out' ? 'Sign in to compare with the terms you approved yourself.' : 'Make sure this is the group you agreed with before you act on anything.'}
          </p>
          <p className="check-foreign-id">
            <span className="check-foreign-title">“{group.title}”</span> · group <span className="num break">{group.id}</span>
          </p>
        </div>
      )}
      <Checker
        network={coreNetwork(registry.network)}
        terms={a.terms}
        myLabel={mine}
        outsider={outsider}
        title={`Check against “${group.title}”`}
        intro={`Compared with the terms every member approved, revision ${group.termsRevision}.`}
      />
    </>
  );
}
