// /g/:id/live (DESIGN.md M11): the group's masternode as the chain shows it. Every status here is computed from chain data on this
// read: the registration proven and compared with the approvals, the masternode list entry proven against the same chain.
import { COIN, decodeSharedProRegTx, formatDash, type ChainShare } from '@cairn/shares';
import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { personName, useProfile } from '../data/profile.ts';
import { PageHead } from '../ui/states.tsx';
import { Checker } from './Checker.tsx';
import { dash } from './checker.ts';
import { percentString } from './cli.ts';
import { coreNetwork, linkedProTx, useGroupBundle, type Agreement, type GroupBundle } from './data.ts';
import { earlyView, labelChainShares, rewardSplit } from './live.ts';
import { GroupGate, GroupTabs, RegistrationCard, RegProgress } from './parts.tsx';
import { CodeBlock, CopyButton, Technical } from './ui.tsx';
import { primaryOf, useRegistrations } from './useRegistration.ts';
import type { MnState, RegistrationJudgement } from './verify.ts';

const n = (x: number) => x.toLocaleString('en-US');
const GOVERNANCE = 'https://gov.dashhq.org';

export function GroupLivePage() {
  const { id = '' } = useParams();
  const { state } = useGroupBundle(id);
  return (
    <GroupGate title="Live masternode" id={id} state={state}>
      {state.status === 'ready' && <LiveBody bundle={state.bundle} agreement={state.agreement} />}
    </GroupGate>
  );
}

const MN_WORDS: Record<MnState, string> = { valid: 'Valid', banned: 'PoSe-banned', dissolved: 'Dissolved', unknown: 'Unknown' };

function LiveBody({ bundle, agreement }: { bundle: GroupBundle; agreement: Agreement }) {
  const g = bundle.group;
  const linked = useMemo(() => linkedProTx(g, bundle.seats).map((x) => x.hash), [g, bundle.seats]);
  const { state, recheck } = useRegistrations(linked, agreement);
  const j = state.status === 'done' ? primaryOf(state.results) : null;
  const others = state.status === 'done' ? state.results.filter((r) => r !== j) : [];
  return (
    <div className="page live-page">
      <PageHead title="Live masternode" lede={<><b>{g.title}</b>: read from the chain on every visit, never from Cairn’s own records.</>} />
      <GroupTabs id={g.id} />
      {!linked.length ? (
        <div className="empty-state" data-testid="not-linked">
          <p>
            <b>No registration is linked yet.</b> Once the coordinator broadcasts it, any co-owner pastes its ProTx hash on the <Link to={`/g/${g.id}/form`}>Form</Link> page.
          </p>
        </div>
      ) : !j ? (
        <div className="live-checking">
          <RegProgress state={state} />
          {state.status === 'error' && (
            <button type="button" className="btn btn-s" onClick={recheck}>
              Try again
            </button>
          )}
        </div>
      ) : (
        <LiveRegistration j={j} bundle={bundle} agreement={agreement} />
      )}
      {others.length > 0 && (
        <section className="form-section">
          <h2>Other linked registrations</h2>
          <p className="muted small">More than one ProTx hash is linked to this group. Only one can be the masternode everyone approved.</p>
          {others.map((o) => (
            <RegistrationCard key={o.proTxHash} j={o} compact />
          ))}
        </section>
      )}
    </div>
  );
}

function LiveRegistration({ j, bundle, agreement }: { j: RegistrationJudgement; bundle: GroupBundle; agreement: Agreement }) {
  const { registry } = useApp();
  const { session } = useAccount();
  const g = bundle.group;
  const f = j.facts;
  const decoded = useMemo(() => {
    try {
      return f ? decodeSharedProRegTx(f.hex) : null;
    } catch {
      return null;
    }
  }, [f]);
  const shares: ChainShare[] | undefined = decoded?.payload.shares;
  const terms = agreement.terms;
  const mine = g.roster.find((r) => r.id === session?.identityId)?.label;
  const holder = useProfile(g.votingHolderId ?? null);
  const holderName = personName(holder.profile, holder.dpns) ?? g.roster.find((r) => r.id === g.votingHolderId)?.label ?? 'the voting key holder';
  const radar = `${registry.radar}/mn/${j.proTxHash}${registry.network === 'testnet' ? '?net=testnet' : ''}`;
  const verified = j.state === 'verified' || j.state === 'unproven';

  return (
    <>
      <section className={`live-hero live-${j.state}`} aria-label="Status" data-testid="live-status">
        <RegistrationCard j={j} />
        {verified && f && (
          <div className="live-mn" data-testid="mn-state" data-state={j.mnState}>
            <p className="live-mn-label small muted">In the masternode list</p>
            <p className={`live-mn-state mn-${j.mnState}`}>{MN_WORDS[j.mnState]}</p>
            <p className="small">{j.mnText}</p>
            {j.check?.findings.some((x) => x.code === 'no-service') && (
              <p className="small notice-box">No IP address is registered: the operator must send a service update before it can earn (see the operator checklist below).</p>
            )}
          </div>
        )}
      </section>

      {verified && f && terms && (
        <>
          <section className="live-facts" aria-label="Registration">
            <Fact label="ProTx hash">
              <span className="num break">{j.proTxHash}</span> <CopyButton value={j.proTxHash} what="ProTx hash" />
            </Fact>
            <Fact label="Registered">block {n(f.height)}</Fact>
            <EarlyFact registered={f.height} period={terms.earlyPeriodBlocks} penalty={terms.earlyPenalty} tip={f.tip} />
            <Fact label="Chain tip (verified)">block {n(f.tip)}</Fact>
          </section>
          {shares && <RewardSplit shares={shares} terms={terms} mine={mine} rewardBps={terms.rewardBps} />}
          <section className="live-links" aria-label="Elsewhere">
            <a className="btn" href={radar} rel="noopener">
              Open on Radar
            </a>
            <a className="btn" href={GOVERNANCE} rel="noopener">
              Vote on Governance
            </a>
            <p className="small muted">
              Radar shows payments, uptime and measured rewards. The masternode’s votes are cast by {holderName}, who holds its voting key.
              {g.votingPolicy ? ` Their policy: “${g.votingPolicy}”` : ''}
            </p>
          </section>
          <Maintenance j={j} early={earlyView(f.height, terms.earlyPeriodBlocks, f.tip)} hasPenalty={terms.earlyPenalty > 0n} service={terms.service} network={terms.network} />
          <section className="form-section" id="checker">
            <Checker
              network={coreNetwork(registry.network)}
              terms={terms}
              myLabel={mine}
              chainShares={shares}
              proTxHash={j.proTxHash}
              title="Check a maintenance message"
              intro="Approval requests (dissolve together, rotate keys) and standby dissolutions are checked against the registered masternode: its shares, owner keys and refund addresses."
            />
          </section>
          <section className="form-section dissolve-note" aria-labelledby="dissolve-title">
            <h2 id="dissolve-title">How Cairn notices a dissolution</h2>
            <p className="small">
              DAPI has no <span className="num">protx</span> calls, so Cairn cannot ask for the dissolution itself. It reads the masternode list instead, proven against a
              ChainLocked chain: a shared masternode leaves the list only when a dissolution spends its collateral, so a verified registration that is gone from the list
              has been dissolved. Every principal went back to its refund address; the group can reopen with the same terms.
            </p>
          </section>
        </>
      )}
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="live-fact">
      <p className="live-fact-label small muted">{label}</p>
      <p className="live-fact-value">{children}</p>
    </div>
  );
}

function EarlyFact({ registered, period, penalty, tip }: { registered: number; period: number; penalty: bigint; tip: number }) {
  const e = earlyView(registered, period, tip);
  return (
    <div className="live-fact" data-testid="early-period">
      <p className="live-fact-label small muted">Early period</p>
      {e.none ? (
        <p className="live-fact-value">None: anyone can leave at any time</p>
      ) : (
        <>
          <p className="live-fact-value">ends at block {n(e.endHeight)}</p>
          <p className="small">
            {e.over ? (
              'Over: leaving alone is free now.'
            ) : (
              <>
                <b className="num">{n(e.blocksLeft)}</b> blocks to go, about <b>{e.daysLeft.toLocaleString('en-US')}</b> days. Leaving alone before then costs {dash(penalty)}, split among
                the others.
              </>
            )}
          </p>
          {!e.over && (
            <div className="early-bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, ((tip - registered) / period) * 100)}%` }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RewardSplit({ shares, terms, mine, rewardBps }: { shares: ChainShare[]; terms: NonNullable<Agreement['terms']>; mine?: string; rewardBps: number }) {
  const labels = labelChainShares(shares.map((s) => s.amount), terms.shares);
  const split = rewardSplit(COIN, rewardBps, shares, labels, mine ? { mine } : {});
  return (
    <section className="form-section reward" aria-labelledby="reward-title" data-testid="reward-split">
      <h2 id="reward-title">How each payment is split</h2>
      <p className="muted small">
        Every block that pays this masternode splits the payment by consensus, straight to each share’s reward address. Shown per 1 DASH paid; Radar shows the measured
        payments.
      </p>
      <div className="table-wrap">
        <table className="split">
          <thead>
            <tr>
              <th scope="col">Share</th>
              <th scope="col" className="r">
                Amount
              </th>
              <th scope="col" className="r">
                Of each payment
              </th>
              <th scope="col" className="r">
                Per 1 DASH paid
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="split-op">
              <td>Operator</td>
              <td className="r muted">–</td>
              <td className="r num">{percentString(rewardBps)}%</td>
              <td className="r num">{formatDash(split.operator)}</td>
            </tr>
            {split.rows.map((r) => (
              <tr key={r.index} className={r.mine ? 'mine' : ''}>
                <td>
                  {r.label}
                  {r.mine && <span className="tag">you</span>}
                </td>
                <td className="r num">{dash(r.amount)}</td>
                <td className="r num">{(r.fraction * 100).toLocaleString('en-US', { maximumFractionDigits: 4 })}%</td>
                <td className="r num">{formatDash(r.part)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        The operator’s {percentString(rewardBps)}% is paid only once the operator has set a payout address with a service update; until then the co-owners keep it, split the
        same way. The percentage is permanent for this masternode.
      </p>
    </section>
  );
}

function Maintenance({ j, early, hasPenalty, service, network }: { j: RegistrationJudgement; early: ReturnType<typeof earlyView>; hasPenalty: boolean; service: string; network: 'main' | 'test' | 'devnet' | 'regtest' }) {
  const h = j.proTxHash;
  const cli = network === 'main' ? 'dash-cli' : 'dash-cli -testnet';
  return (
    <section className="form-section maintenance" aria-labelledby="maint-title" data-testid="maintenance">
      <h2 id="maint-title">Looking after it</h2>
      <p className="muted small">In Dash-Qt every action starts from the Masternodes tab: right-click this masternode. The RPC lines are for dashd and the console.</p>
      <HowTo title="Save your standby dissolution now" tag="each co-owner" open>
        <p>A signed exit you keep offline. It returns every principal, works even if this wallet is lost, and never expires.</p>
        <ol>
          <li>Right-click the masternode → “Create Standby Dissolution…”.</li>
          <li>Pick your share and press “Create Standby Dissolution…”, then save the text file.</li>
          <li>
            It holds two transactions: <b>full principal</b>, valid {early.over || early.none ? 'now' : `from block ${n(early.endHeight)}`}, and <b>immediate</b>
            {hasPenalty ? ', which pays the early-exit penalty and is valid at once' : ''}.
          </li>
          <li>Paste it into the checker below to check it, then store it with your refund-address backup, apart from this wallet.</li>
        </ol>
        <Rpc code={`${cli} protx shared_dissolve ${h} <MY_SHARE_INDEX> 100000 false false\n${cli} protx shared_dissolve ${h} <MY_SHARE_INDEX> 100000 false true`} />
      </HowTo>
      <HowTo title="Change your reward address" tag="just you">
        <p>Only your share is affected and nobody else signs. Your refund address never changes.</p>
        <ol>
          <li>Right-click → “Change Reward Address…”.</li>
          <li>Pick your share, then “Use new address” (or “Use refund address”), and the address that pays the small fee.</li>
          <li>Press “Send Update”.</li>
        </ol>
        <Rpc code={`${cli} protx shared_update_share ${h} <MY_SHARE_INDEX> "<NEW_REWARD_ADDRESS>" "<FEE_SOURCE_ADDRESS>"`} />
      </HowTo>
      <HowTo title="Replace the operator or the voting key" tag="needs everyone">
        <p>Every co-owner must approve. If one cannot be reached, only leaving remains.</p>
        <ol>
          <li>One person: right-click → “Rotate Keys…”, enter the new operator key and/or voting address (blank keeps the current one), then “Prepare Request”.</li>
          <li>They send the request to everyone. Each co-owner checks it in the checker below, then in Dash-Qt pastes it and presses “Approve and Copy Reply”.</li>
          <li>The person who prepared it pastes every reply and presses “Send Rotation”. Only their wallet can send it.</li>
          <li>A new operator key bans the masternode until the new operator sends a service update.</li>
        </ol>
        <Rpc
          code={`${cli} protx shared_update_registrar_prepare ${h} "<NEW_OPERATOR_PUBKEY or empty>" "<NEW_VOTING_ADDRESS or empty>" "<FEE_SOURCE_ADDRESS>"\n${cli} protx shared_sign "<TX>"\n${cli} protx shared_combine "<TX>" '[{"shareIndex":0,"signature":"<SIG>"},…]' true`}
        />
      </HowTo>
      <HowTo title="Leave" tag="just you">
        <p>
          Leaving ends the masternode for everyone and returns every principal to its refund address.{' '}
          {early.none || early.over ? 'The early period is over, so leaving alone is free.' : `Leaving alone before block ${n(early.endHeight)} costs the early-exit penalty, split among the others.`}{' '}
          If everyone agrees, leaving together is always free.
        </p>
        <ol>
          <li>Right-click → “Dissolve…”.</li>
          <li>“Dissolve Now” leaves alone (tick that you accept the penalty if it applies). “Dissolve Together” prepares a request every co-owner approves.</li>
          <li>The others can open a new group with the same terms that needs only the amount that left.</li>
        </ol>
        <Rpc
          code={`${cli} protx shared_dissolve ${h} <MY_SHARE_INDEX>\n# together, free: prepare, everyone signs, then combine and send\n${cli} protx shared_dissolve_prepare ${h} <MY_SHARE_INDEX>\n${cli} protx shared_sign "<TX>"\n${cli} protx shared_combine "<TX>" '[…every signature…]' true`}
        />
      </HowTo>
      <HowTo title="Operator checklist" tag="the operator" open={j.check?.findings.some((x) => x.code === 'no-service')}>
        <ol>
          <li>
            Put <span className="num">masternodeblsprivkey=&lt;BLS secret&gt;</span> in the node’s <span className="num">dash.conf</span> and restart it.
          </li>
          <li>
            Send a service update with an operator payout address. {service ? '' : 'This masternode was registered without an IP address, so until then it is banned and earns nothing. '}
            Without a payout address the operator reward is not paid at all: the co-owners keep it.
          </li>
          <li>Keep the node up and current: missed duties get it PoSe-banned, and a banned masternode earns nothing for anyone.</li>
        </ol>
        <Rpc code={`${cli} protx update_service ${h} "${service || '<IP:PORT>'}" "<BLS_SECRET>" "<OPERATOR_PAYOUT_ADDRESS>" "<FEE_SOURCE_ADDRESS>"`} />
      </HowTo>
    </section>
  );
}

function HowTo({ title, tag, open, children }: { title: string; tag: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="howto" open={open}>
      <summary>
        {title} <span className="tag">{tag}</span>
      </summary>
      <div className="howto-body">{children}</div>
    </details>
  );
}

function Rpc({ code }: { code: string }) {
  return (
    <Technical title="With dash-cli">
      <CodeBlock code={code} />
    </Technical>
  );
}
