// /g/:id/form (DESIGN.md M9-M10): forming a locked, fully approved group's masternode in Dash-Qt. The coordinator's setup sheet,
// every member's three rounds with the checker, the dash-cli path, and linking the registration once it is broadcast.
import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { personName, useProfile } from '../data/profile.ts';
import { ActivationCard } from '../ui/Activation.tsx';
import { PageHead } from '../ui/states.tsx';
import { useAction } from '../ui/useAction.ts';
import { Checker } from './Checker.tsx';
import { dashPlain as dash } from './checker.ts';
import { cliPlan, renderCommand } from './cli.ts';
import { coreNetwork, linkedProTx, markStartedOp, sessionStarted, useGroupBundle, type GroupBundle, type Agreement } from './data.ts';
import { GroupGate, GroupTabs, LinkRegistration, RegistrationCard } from './parts.tsx';
import { setupSheet, type SetupPage } from './setup.ts';
import { CodeBlock, CopyButton, CopyValue, Technical } from './ui.tsx';
import { primaryOf, useRegistrations, useV24Active } from './useRegistration.ts';

export function GroupFormPage() {
  const { id = '' } = useParams();
  const { state, refresh } = useGroupBundle(id);
  return (
    <GroupGate title="Form the masternode" id={id} state={state}>
      {state.status === 'ready' && <FormBody bundle={state.bundle} agreement={state.agreement} refresh={refresh} />}
    </GroupGate>
  );
}

function FormBody({ bundle, agreement, refresh }: { bundle: GroupBundle; agreement: Agreement; refresh(): void }) {
  const { registry } = useApp();
  const { session } = useAccount();
  const g = bundle.group;
  const me = session?.identityId;
  const mine = g.roster.find((r) => r.id === me);
  const coordinator = g.roster.find((r) => r.id === g.coordinatorId);
  const iCoordinate = !!me && me === g.coordinatorId;
  const active = useV24Active(registry.network);
  const waiting = active === false || (registry.network === 'mainnet' && active !== true);
  const ready = agreement.lockedHashOk && agreement.allApproved && !!agreement.terms;
  const operator = useProfile(g.operatorId);
  const operatorName = personName(operator.profile, operator.dpns) ?? undefined;
  const linked = useMemo(() => linkedProTx(g, bundle.seats).map((x) => x.hash), [g, bundle.seats]);
  const regs = useRegistrations(linked, ready ? agreement : null);
  const started = sessionStarted(g, bundle.seats);
  const later = waiting ? <span className="tag tag-later">available once v24 activates</span> : null;

  return (
    <div className="page form-page">
      <PageHead
        title="Form the masternode"
        lede={
          <>
            <b>{g.title}</b>: {g.roster.length} co-owners, 1000 DASH. One member coordinates in Dash-Qt; everyone else checks each message here and approves it in their own
            wallet.
          </>
        }
      />
      <GroupTabs id={g.id} />

      <ul className="form-status" aria-label="Where this group is" data-testid="form-status">
        <StatusItem ok={agreement.lockedHashOk} label={agreement.lockedHashOk ? `Terms locked, revision ${g.revision}` : 'Terms not locked'} />
        <StatusItem
          ok={agreement.allApproved}
          label={`${agreement.members.filter((m) => m.ok).length} of ${agreement.members.length} approved these exact terms`}
        />
        <StatusItem ok={started} pending={!started} label={started ? 'Dash-Qt session started' : 'Dash-Qt session not started yet'} />
        <RegistrationStatus linked={linked.length > 0} state={regs.state} id={g.id} />
      </ul>

      {!ready && (
        <div className="empty-state not-ready" data-testid="not-ready">
          <p>
            <b>Not ready to form yet.</b> Forming starts once the organizer has locked the terms and every member has approved them on Cairn: that approval is
            what every message below is checked against.
          </p>
          <ul className="small">
            {agreement.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p>
            <Link to={`/g/${g.id}`}>Back to the group</Link>
          </p>
        </div>
      )}

      {ready && agreement.terms && (
        <>
          {waiting && (
            <div className="form-waiting">
              <p className="notice-box">
                <b>Shared masternodes are not active on {registry.label} yet.</b> Dash-Qt refuses to start a session until Dash Core v24 activates. Everything below
                is ready for that day; the steps are marked “available once v24 activates”.
              </p>
              <ActivationCard />
            </div>
          )}

          <section className="form-role" aria-label="Your part">
            {iCoordinate ? (
              <p>
                <b>You coordinate.</b> You run Dash-Qt’s wizard, pay the network fee (about 0.001 DASH) and broadcast. Start with the setup sheet.
              </p>
            ) : mine ? (
              <p>
                <b>
                  You bring {dash(BigInt(mine.amount))} as “{mine.label}”.
                </b>{' '}
                {coordinator ? `${coordinator.label} coordinates` : 'The coordinator runs the wizard'}; you check each message here and approve it in your own Dash-Qt.
              </p>
            ) : (
              <p className="muted">You are not a co-owner of this group. You can follow along and check messages, but there is nothing for you to sign.</p>
            )}
            <SessionMark bundle={bundle} started={started} onDone={refresh} />
          </section>

          <section className="form-section" aria-labelledby="setup-title">
            <details className="qt-sheet" open={iCoordinate}>
              <summary>
                <h2 id="setup-title">
                  Coordinator: set up Dash-Qt’s wizard {later}
                </h2>
                <span className="small muted">{coordinator ? `For ${coordinator.label}. ` : ''}What to type on each page, in order.</span>
              </summary>
              <SetupSheet pages={setupSheet(agreement.terms, { operatorName })} />
            </details>
          </section>

          <section className="form-section" aria-labelledby="rounds-title">
            <h2 id="rounds-title">Everyone: three rounds {later}</h2>
            <p className="muted">
              Each round the coordinator sends one message to everyone and everyone sends one reply back. Paste every message into the checker before you act on it.
            </p>
            <ParticipantRounds />
          </section>

          <section className="form-section" id="checker" aria-label="Message checker">
            <Checker
              network={coreNetwork(registry.network)}
              terms={agreement.terms}
              myLabel={mine?.label}
              title="Check a message against your approval"
              intro={`Compared with the terms all ${g.roster.length} members approved (revision ${g.revision}). Pick your row and paste your owner address so a moved row stops you.`}
            />
          </section>

          <section className="form-section" aria-labelledby="link-title">
            <h2 id="link-title">After broadcast: link the registration</h2>
            <p className="muted">
              Any co-owner can paste the ProTx hash from Dash-Qt. Cairn fetches the registration from the chain, proves it into a ChainLocked block and compares it with
              every approval before anyone sees it as live.
            </p>
            {regs.state.status === 'done' && primaryOf(regs.state.results) && <RegistrationCard j={primaryOf(regs.state.results)!} compact />}
            <LinkRegistration rec={bundle} seats={bundle.seats} agreement={agreement} onLinked={refresh} />
          </section>

          <section className="form-section">
            <Technical title="Technical: use dash-cli instead" testId="cli-drawer">
              <CliDrawer bundle={bundle} agreement={agreement} />
            </Technical>
          </section>

          <section className="never" aria-labelledby="never-title">
            <h2 id="never-title">Never share</h2>
            <ul className="crosses">
              <li>Your recovery phrase, wallet file or any private key. Nobody in a group, and nothing on Cairn, ever needs them.</li>
              <li>The operator’s BLS secret key, unless you are the operator. Only the public key goes into the terms.</li>
              <li>Coins. You never send DASH to anyone: your coins move only in the registration your own wallet signs.</li>
              <li>A signature for a message the checker stops. Ask for a fresh copy instead.</li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function StatusItem({ ok, pending = false, label }: { ok: boolean; pending?: boolean; label: ReactNode }) {
  return (
    <li className={ok ? 'st-ok' : pending ? 'st-wait' : 'st-no'}>
      <span className="st-mark" aria-hidden="true">
        {ok ? '✓' : pending ? '…' : '✕'}
      </span>
      {label}
    </li>
  );
}

function RegistrationStatus({ linked, state, id }: { linked: boolean; state: ReturnType<typeof useRegistrations>['state']; id: string }) {
  if (!linked) return <StatusItem ok={false} pending label="No registration linked yet" />;
  if (state.status === 'idle') return <StatusItem ok={false} pending label="Registration linked; checked once every member approved" />;
  if (state.status === 'error') return <StatusItem ok={false} label="The linked registration could not be checked" />;
  if (state.status !== 'done') return <StatusItem ok={false} pending label="Checking the linked registration…" />;
  const j = primaryOf(state.results)!;
  return <StatusItem ok={j.state === 'verified'} pending={j.state !== 'mismatch' && j.state !== 'not-found'} label={<Link to={`/g/${id}/live`}>{j.headline}</Link>} />;
}

function SessionMark({ bundle, started, onDone }: { bundle: GroupBundle; started: boolean; onDone(): void }) {
  const { registry } = useApp();
  const { session, write } = useAccount();
  const action = useAction();
  const me = session?.identityId;
  const g = bundle.group;
  if (started || !me || (me !== g.ownerId && me !== g.coordinatorId)) return null;
  const op = markStartedOp(registry, bundle, bundle.seats, me);
  if (!op) return null;
  return (
    <div className="session-mark">
      <button type="button" className="btn btn-s" disabled={action.busy} onClick={() => action.run(async () => (await write(op), onDone()))} data-testid="mark-started">
        {action.busy ? 'Saving…' : 'Mark the Dash-Qt session as started'}
      </button>
      <span className="small muted">Tells the group to watch for the invitation.</span>
      {action.error && (
        <p className="small error" role="alert">
          {action.error}
        </p>
      )}
    </div>
  );
}

function SetupSheet({ pages }: { pages: SetupPage[] }) {
  return (
    <ol className="setup" data-testid="setup-sheet">
      {pages.map((p) => (
        <li key={p.id} className="setup-page">
          <h3>{p.title}</h3>
          <p>{p.intro}</p>
          {p.rows && (
            <div className="table-wrap">
              <table className="setup-rows">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Name</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Me</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.n}>
                      <td className="num">{r.n}</td>
                      <td>
                        <span className="cell-copy">
                          {r.name} <CopyButton value={r.name} what={`name ${r.n}`} />
                        </span>
                      </td>
                      <td>
                        <span className="cell-copy num">
                          {r.amount} <CopyButton value={r.amount} what={`amount ${r.n}`} />
                        </span>
                      </td>
                      <td>{r.me ? '✓' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {p.fields.length > 0 && (
            <div className="setup-fields">
              {p.fields.map((f) => (
                <CopyValue key={f.label} label={f.label} value={f.value} copy={f.copy} hint={f.hint} />
              ))}
            </div>
          )}
          {p.notes.map((n) => (
            <p key={n} className="small muted">
              {n}
            </p>
          ))}
        </li>
      ))}
    </ol>
  );
}

const ROUNDS = [
  {
    title: 'Round 1 · Invitation → Details',
    steps: [
      'The coordinator sends one Invitation to everyone. Paste it into the checker below with your row picked: it should say “Safe to continue”.',
      'In Dash-Qt: Masternodes tab → Shared Masternode… → Paste From Clipboard (or Open File…).',
      'Under “This is me”, choose your row. Press “Use new address” for your owner, refund and reward addresses, and copy the owner address into the checker.',
      'Press “Reserve Coins and Copy Details” and send that reply to the coordinator. Your coins stay in your wallet, set aside.',
      'If a newer invitation arrives, check it too: Dash-Qt takes it only if your row is unchanged, and you reply again.',
    ],
  },
  {
    title: 'Round 2 · Locked Terms → Approval',
    steps: [
      'Once every row is filled the coordinator locks the terms and sends Locked Terms. Check it here, with your owner address.',
      'Paste it into Dash-Qt and read every line. If it matches, press “Approve and Copy Reply” and send the reply.',
    ],
  },
  {
    title: 'Round 3 · Signing Request → Signed Contribution',
    steps: [
      'With every approval in, the coordinator sends the Signing Request. Check it here.',
      'Paste it into Dash-Qt and press “Sign and Copy Reply”. Your wallet signs only your own coins, and refuses if your share or change was changed.',
      'The coordinator collects every Signed Contribution and presses “Broadcast Registration”.',
    ],
  },
];

function ParticipantRounds() {
  return (
    <ol className="rounds-guide" data-testid="participant-rounds">
      {ROUNDS.map((r) => (
        <li key={r.title}>
          <h3>{r.title}</h3>
          <ul className="small">
            {r.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </li>
      ))}
      <li>
        <h3>After broadcast</h3>
        <ul className="small">
          <li>Link the ProTx hash below, so the group sees it verified.</li>
          <li>After one confirmation, right-click the masternode in Dash-Qt → “Create Standby Dissolution…”, and keep the file offline with your refund-address backup.</li>
        </ul>
      </li>
    </ol>
  );
}

function CliDrawer({ bundle, agreement }: { bundle: GroupBundle; agreement: Agreement }) {
  const terms = agreement.terms!;
  const steps = cliPlan(terms);
  return (
    <div className="cli" data-testid="cli">
      <p className="small">
        The same formation with the <span className="num">protx shared_*</span> RPCs, for members who run dashd or prefer the console (Dash-Qt: Window → Console, without
        the <span className="num">dash-cli</span> prefix). Values from the approved terms are filled in; <span className="num">&lt;PLACEHOLDERS&gt;</span> are what each member
        fills in from their own wallet. Shares are integer duffs; the operator reward is a percent string.
      </p>
      {steps.map((s, i) => (
        <div key={s.id} className="cli-step">
          <h4>
            {i + 1}. {s.title} <span className="small muted">· {s.who}</span>
          </h4>
          <CodeBlock code={s.commands.map((c) => renderCommand(c, terms.network)).join('\n')} />
          {s.note && <p className="small muted">{s.note}</p>}
        </div>
      ))}
      <p className="small muted">Group {bundle.group.id}, terms revision {bundle.group.revision}.</p>
    </div>
  );
}

