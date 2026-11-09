// /g/:id/form (DESIGN.md M9-M10): forming a locked, fully approved group's masternode in Dash-Qt, as a trail of steps per role
// (formation/steps.ts): terms agreed, setting up, the three rounds, broadcast and linking the registration, with the message
// checker docked beside them. Where the group is comes from the same lifecycle as its group page (matching/stage.ts), with the
// chain's word on any linked registration.
import { coreNetwork } from '@cairn/contract';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAccount } from '../app/account.tsx';
import { useApp } from '../app/context.tsx';
import { useGroupBundle } from '../data/cairn.ts';
import { personName, useProfile } from '../data/profile.ts';
import type { Agreement } from '../matching/agreement.ts';
import { groupView, type GroupBundle, type GroupView } from '../matching/group.ts';
import { isFormed, stageOf } from '../matching/stage.ts';
import { useGroupOps, type GroupOps } from '../pages/group/ops.ts';
import { openSignIn } from '../ui/Account.tsx';
import { ActivationCard } from '../ui/Activation.tsx';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { PageHead } from '../ui/states.tsx';
import { useAction } from '../ui/useAction.ts';
import { useScrollToHash } from '../ui/useScrollToHash.ts';
import { Checker } from './Checker.tsx';
import { dashPlain as dash, outsiderOf } from './checker.ts';
import { cliPlan, renderCommand } from './cli.ts';
import { GroupGate, GroupTabs, LinkRegistration, RegistrationCard } from './parts.tsx';
import { setupSheet, type SetupPage } from './setup.ts';
import { SETUP_PAGES, STEP_IDS, openStep, stepCopy, stepStates, type FormRole, type StepId, type StepState } from './steps.ts';
import { CodeBlock, CopyButton, CopyValue, Technical } from './ui.tsx';
import { primaryOf, useGroupRegistrations, useV24Active, type RegState } from './useRegistration.ts';

export function GroupFormPage() {
  const { id = '' } = useParams();
  const load = useGroupBundle(id);
  return (
    <GroupGate title="Form the masternode" id={id} load={load}>
      {(bundle) => <FormBody bundle={bundle} refresh={load.reload} />}
    </GroupGate>
  );
}

function FormBody({ bundle, refresh }: { bundle: GroupBundle; refresh(): void }) {
  const { registry } = useApp();
  const { session } = useAccount();
  const view = useMemo(() => groupView(bundle, registry.network), [bundle, registry.network]);
  const { group: g, agreement } = view;
  const me = session?.identityId ?? null;
  const ops = useGroupOps(bundle, me, refresh);
  const mine = g.roster.find((r) => r.id === me);
  const coordinator = g.roster.find((r) => r.id === g.coordinatorId);
  const iCoordinate = !!me && me === g.coordinatorId;
  const active = useV24Active(registry.network);
  const waiting = active === false || (registry.network === 'mainnet' && active !== true);
  const operator = useProfile(g.operatorId);
  const operatorName = personName(operator.profile, operator.dpns) ?? undefined;
  const regs = useGroupRegistrations(view);
  const stage = stageOf(view, regs.primary);
  const started = view.sessionStarted || isFormed(stage);
  // the tools need terms every member approved; once a registration is linked they stay, whatever the documents say since
  const ready = agreement.anchored && (view.ready || view.linked.length > 0);
  const reasons = view.locked ? view.waitingFor : agreement.problems;
  useScrollToHash(ready);

  const [role, setRole] = useState<FormRole>(iCoordinate ? 'coordinator' : 'member');
  useEffect(() => setRole(iCoordinate ? 'coordinator' : 'member'), [iCoordinate]);
  const states = stepStates({ ready, started, linked: view.linked.length > 0, settled: stage === 'live' || stage === 'dissolved' });
  const statesKey = STEP_IDS.map((id) => states[id]).join();
  const [open, setOpen] = useState<StepId>(() => openStep(states, rememberedStep(g.id)));
  // the group moved on (session marked started, registration linked): follow it
  useEffect(() => setOpen(openStep(states, rememberedStep(g.id))), [statesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (id: StepId) => {
    setOpen(id);
    if (states[id] === 'in-qt') rememberStep(g.id, id);
  };

  const sheet = ready && agreement.terms ? setupSheet(agreement.terms, { operatorName }) : [];
  const pages = (id: StepId) => sheet.filter((p) => SETUP_PAGES[id]?.includes(p.id));
  const later = waiting ? <span className="tag tag-later">available once v24 activates</span> : null;
  const approved = agreement.members.filter((m) => m.state === 'approved').length;

  const body = (id: StepId): ReactNode => {
    switch (id) {
      case 'agree':
        return ready ? (
          <ul className="trail-facts">
            <Fact ok={agreement.lockedHashOk}>{agreement.lockedHashOk ? `Terms locked, revision ${g.termsRevision}` : 'Terms not locked'}</Fact>
            <Fact ok={agreement.allApproved}>
              {approved} of {agreement.members.length} approved these exact terms
            </Fact>
            <Fact ok>Ready to form: every message below is checked against these terms.</Fact>
          </ul>
        ) : (
          <div className="not-ready" data-testid="not-ready">
            <p>
              <b>Not ready to form yet.</b> Forming starts once the organizer has locked the terms, every member has approved them on Cairn and the group page says
              “Ready to form”: that approval is what every message is checked against.
            </p>
            <ul className="small">
              {reasons.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p>
              <Link to={`/g/${g.id}`}>Back to the group</Link>
              {agreement.anchored && (
                <>
                  {' · '}
                  <Link to={`/check?group=${g.id}`}>Check a message against the approved terms</Link>
                </>
              )}
            </p>
          </div>
        );
      case 'setup':
        return (
          <>
            {role === 'coordinator' ? (
              <SetupSheet pages={pages('setup')} all={sheet} />
            ) : (
              <ul className="trail-list">
                <li>Dash-Qt version 24 or later, with the wallet that holds the coins for {mine ? `your ${dash(BigInt(mine.amount))} as “${mine.label}”` : 'your share'}.</li>
                <li>Those coins confirmed: in round 1 Dash-Qt sets them aside for this masternode, and they never leave your wallet before you sign.</li>
                <li>
                  {coordinator ? `${coordinator.label} sends` : 'The coordinator sends'} one invitation to everyone, usually in your group chat. This page shows when the session
                  has started.
                </li>
              </ul>
            )}
            {started ? (
              <p className="trail-done-line">
                <Icon name="check" /> The Dash-Qt session is marked as started.
              </p>
            ) : (
              <SessionMark ops={ops} onDone={refresh} />
            )}
          </>
        );
      case 'round1':
      case 'round2':
      case 'round3':
        return (
          <>
            {role === 'coordinator' ? <SetupSheet pages={pages(id)} all={sheet} /> : <RoundSteps steps={ROUNDS[id]} />}
            <CheckButton />
          </>
        );
      case 'broadcast':
        return role === 'coordinator' ? (
          <SetupSheet pages={pages('broadcast')} all={sheet} />
        ) : (
          <RoundSteps steps={['The coordinator pastes every Signed Contribution and presses “Broadcast Registration”.', 'They share the ProTx hash Dash-Qt shows next, so anyone can link it here.']} />
        );
      case 'link':
        return (
          <>
            <p className="muted">
              Any co-owner can paste the ProTx hash from Dash-Qt. Cairn fetches the registration from the chain, proves it into a ChainLocked block and compares it with
              every approval before anyone sees it as live.
            </p>
            {regs.primary && <RegistrationCard j={regs.primary} compact />}
            <LinkRegistration view={view} ops={ops} onLinked={refresh} />
            <p className="small muted">
              After one confirmation, right-click the masternode in Dash-Qt → “Create Standby Dissolution…”, and keep the file offline with your refund-address backup.
            </p>
          </>
        );
    }
  };

  const sub = (id: StepId): ReactNode => {
    if (id === 'agree' && ready) return `Revision ${g.termsRevision}, approved by ${approved} of ${agreement.members.length}. Ready to form.`;
    return stepCopy(id, role).sub;
  };

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
      <GroupTabs id={g.id} linked={view.linked.length > 0} />

      {ready && waiting && (
        <div className="form-waiting">
          <p className="notice-box">
            <b>Shared masternodes are not active on {registry.label} yet.</b> Dash-Qt refuses to start a session until Dash Core v24 activates. Everything below is ready
            for that day; the steps are marked “available once v24 activates”.
          </p>
          <ActivationCard />
        </div>
      )}

      <div className={ready ? 'form-layout' : 'form-layout form-layout-solo'}>
        <div className="form-main">
          <section className="form-role" aria-label="Your part">
            {iCoordinate ? (
              <p>
                <b>You coordinate.</b> You run Dash-Qt’s wizard, pay the network fee (about 0.001 DASH) and broadcast.
              </p>
            ) : mine ? (
              <p>
                <b>
                  You bring {dash(BigInt(mine.amount))} as “{mine.label}”.
                </b>{' '}
                {coordinator ? `${coordinator.label} coordinates` : 'The coordinator runs the wizard'}; you check each message here and approve it in your own Dash-Qt.
              </p>
            ) : !session ? (
              <p className="form-signin" data-testid="form-signed-out">
                <span>
                  <b>Are you in this group?</b> Sign in to see your row and what to do next.
                </span>{' '}
                <button type="button" className="btn btn-s btn-primary" onClick={openSignIn}>
                  Sign in
                </button>
              </p>
            ) : (
              <p className="muted">You are not a co-owner of this group. You can follow along and check messages, but there is nothing for you to sign.</p>
            )}
            {ready && <RoleSwitch role={role} onChange={setRole} />}
          </section>

          <ol className="trail" aria-label="Where this group is" data-testid="form-status">
            {STEP_IDS.map((id) => {
              const copy = stepCopy(id, role);
              const locked = !ready && id !== 'agree';
              return (
                <TrailStep
                  key={id}
                  id={id}
                  state={states[id]}
                  title={copy.title}
                  sub={sub(id)}
                  tag={id !== 'agree' && id !== 'link' ? later : null}
                  status={id === 'link' && view.linked.length > 0 ? <RegistrationLine state={regs.state} id={g.id} /> : null}
                  open={open === id && !locked}
                  locked={locked}
                  onOpen={() => choose(id)}
                >
                  {body(id)}
                </TrailStep>
              );
            })}
          </ol>

          {ready && agreement.terms && (
            <>
              <section className="form-section">
                <Technical title="Technical: use dash-cli instead" testId="cli-drawer">
                  <CliDrawer view={view} agreement={agreement} />
                </Technical>
              </section>

              <section className="never" aria-labelledby="never-title">
                <h2 id="never-title">Never share</h2>
                <ul className="crosses">
                  <li>Your Dash Core wallet’s recovery phrase, wallet file or any private key. Nobody in a group, and nothing on Cairn, ever needs them.</li>
                  <li>The operator’s BLS secret key, unless you are the operator. Only the public key goes into the terms.</li>
                  <li>Coins. You never send DASH to anyone: your coins move only in the registration your own wallet signs.</li>
                  <li>A signature for a message the checker stops. Ask for a fresh copy instead.</li>
                </ul>
              </section>
            </>
          )}
        </div>

        {ready && agreement.terms && (
          <aside className="form-aside" id="checker" aria-label="Message checker">
            <Checker
              network={coreNetwork(registry.network)}
              terms={agreement.terms}
              myLabel={mine?.label}
              outsider={outsiderOf(g, me)}
              title="Check a message against your approval"
              intro={`Compared with the terms all ${g.roster.length} members approved (revision ${g.termsRevision}). Pick your row and paste your owner address so a moved row stops you.`}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

const STEP_KEY = (groupId: string) => `cairn.form-step.${groupId}`;

function rememberedStep(groupId: string): StepId | null {
  try {
    const v = localStorage.getItem(STEP_KEY(groupId));
    return STEP_IDS.includes(v as StepId) ? (v as StepId) : null;
  } catch {
    return null;
  }
}

function rememberStep(groupId: string, id: StepId): void {
  try {
    localStorage.setItem(STEP_KEY(groupId), id);
  } catch {
    // a convenience only: without storage the page opens the group's current step
  }
}

const STATE_WORD: Record<StepState, string> = { done: 'Done', current: 'You are here', 'in-qt': 'In Dash-Qt', todo: '' };
const STATE_ICON: Record<StepState, IconName | null> = { done: 'check', current: null, 'in-qt': 'pending', todo: null };

function TrailStep(props: {
  id: StepId;
  state: StepState;
  title: string;
  sub: ReactNode;
  tag: ReactNode;
  /** A live line under the heading (it may hold a link, so it sits outside the button). */
  status?: ReactNode;
  open: boolean;
  locked: boolean;
  onOpen(): void;
  children: ReactNode;
}) {
  const { id, state, title, sub, tag, status, open, locked, onOpen, children } = props;
  const n = STEP_IDS.indexOf(id) + 1;
  const icon = STATE_ICON[state];
  // mounted on first open and kept, so switching steps keeps what was typed (a ProTx hash, say)
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  return (
    <li className={`trail-step is-${state}${open ? ' is-open' : ''}`} data-step={id} aria-current={state === 'current' ? 'step' : undefined}>
      <h2 className="trail-h">
        <button type="button" className="trail-btn" aria-expanded={open} aria-controls={`step-${id}`} disabled={locked} onClick={onOpen}>
          <span className="trail-mark" aria-hidden="true">
            {icon ? <Icon name={icon} size={14} /> : n}
          </span>
          <span className="trail-text">
            <span className="trail-title">
              {title} {tag}
            </span>
            <span className="trail-sub">{locked ? 'Opens once every co-owner has approved the terms.' : sub}</span>
          </span>
          {STATE_WORD[state] && <span className={`trail-state trail-state-${state}`}>{STATE_WORD[state]}</span>}
          <Icon name="chevron" size={18} className="trail-chev" />
        </button>
      </h2>
      {status && <p className="trail-status small">{status}</p>}
      <div className="trail-body" id={`step-${id}`} hidden={!open}>
        {mounted && children}
      </div>
    </li>
  );
}

function Fact({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={ok ? 'fact-ok' : 'fact-no'}>
      <Icon name={ok ? 'check' : 'x'} />
      {children}
    </li>
  );
}

const ROLES = [
  ['coordinator', 'The coordinator'],
  ['member', 'A co-owner'],
] as const;

function RoleSwitch({ role, onChange }: { role: FormRole; onChange(r: FormRole): void }) {
  const name = useId();
  return (
    <fieldset className="role-switch">
      <legend>Steps for</legend>
      <span className="seg">
        {ROLES.map(([id, label]) => (
          <label key={id} className={role === id ? 'on' : ''}>
            <input type="radio" name={name} value={id} checked={role === id} onChange={() => onChange(id)} />
            {label}
          </label>
        ))}
      </span>
    </fieldset>
  );
}

/** Jumps to the checker beside (or, on a phone, below) the steps, ready for a paste. */
function CheckButton() {
  const go = () => {
    const input = document.querySelector<HTMLTextAreaElement>('#checker textarea');
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input?.focus({ preventScroll: true });
  };
  return (
    <button type="button" className="btn btn-s trail-check" onClick={go}>
      <Icon name="search" /> Check this round’s message
    </button>
  );
}

function RegistrationLine({ state, id }: { state: RegState; id: string }) {
  if (state.status === 'idle') return 'Registration linked; checked once every member approved.';
  if (state.status === 'error') return 'The linked registration could not be checked.';
  if (state.status !== 'done') return 'Checking the linked registration…';
  return <Link to={`/g/${id}/live`}>{primaryOf(state.results)!.headline}</Link>;
}

function SessionMark({ ops, onDone }: { ops: GroupOps; onDone(): void }) {
  const action = useAction();
  if (!ops.canMarkStarted) return null;
  return (
    <div className="session-mark">
      <button type="button" className="btn btn-primary" disabled={action.busy} onClick={() => action.run(async () => (await ops.markStarted(), onDone()))} data-testid="mark-started">
        {action.busy ? 'Saving…' : 'Mark the Dash-Qt session as started'}
      </button>
      <span className="small muted">Once Dash-Qt shows “Invite participants”. Tells the group to watch for the invitation.</span>
      {action.error && (
        <p className="small error" role="alert">
          {action.error}
        </p>
      )}
    </div>
  );
}

function SetupSheet({ pages, all }: { pages: SetupPage[]; all: SetupPage[] }) {
  return (
    <ol className="setup" data-testid="setup-sheet">
      {pages.map((p) => (
        <li key={p.id} className="setup-page">
          <span className="setup-n" aria-hidden="true">
            {all.indexOf(p) + 1}
          </span>
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
                      <td>
                        {r.me && (
                          <>
                            <Icon name="check" />
                            <span className="visually-hidden">you</span>
                          </>
                        )}
                      </td>
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

/** A co-owner's part of each round, in Dash-Qt's own button names. */
const ROUNDS = {
  round1: [
    'The coordinator sends one Invitation to everyone. Paste it into the checker with your row picked: it should say “Safe to continue”.',
    'In Dash-Qt: Masternodes tab → Shared Masternode… → Paste From Clipboard (or Open File…).',
    'Under “This is me”, choose your row. Press “Use new address” for your owner, refund and reward addresses, and copy the owner address into the checker.',
    'Press “Reserve Coins and Copy Details” and send that reply to the coordinator. Your coins stay in your wallet, set aside.',
    'If a newer invitation arrives, check it too: Dash-Qt takes it only if your row is unchanged, and you reply again.',
  ],
  round2: [
    'Once every row is filled the coordinator locks the terms and sends Locked Terms. Check it, with your owner address.',
    'Paste it into Dash-Qt and read every line. If it matches, press “Approve and Copy Reply” and send the reply.',
  ],
  round3: [
    'With every approval in, the coordinator sends the Signing Request. Check it.',
    'Paste it into Dash-Qt and press “Sign and Copy Reply”. Your wallet signs only your own coins, and refuses if your share or change was changed.',
  ],
} as const satisfies Record<'round1' | 'round2' | 'round3', readonly string[]>;

function RoundSteps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="trail-list trail-list-n" data-testid="participant-rounds">
      {steps.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );
}

function CliDrawer({ view, agreement }: { view: GroupView; agreement: Agreement }) {
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
      <p className="small muted">Group {view.group.id}, terms revision {view.group.termsRevision}.</p>
    </div>
  );
}

