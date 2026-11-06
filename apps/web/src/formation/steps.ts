// The form page's trail: Dash-Qt's shared-masternode wizard as one row of steps per role (docs/research/core-shared-mn.md §5).
// The coordinator's pages are Participants → Settings → Exit terms → Contribution → Invite → Approvals → Signatures → Complete;
// a participant's are Contribution → Approvals → Signatures → Complete. Both meet in the three rounds (invitation and details,
// locked terms and approval, signing request and signed contribution), then the coordinator broadcasts and anyone links the hash.
//
// Cairn knows only what the group's documents and the chain say: agreed, session started, registration linked, registration
// matching. Between "session started" and "linked" the group is somewhere inside Dash-Qt, and Cairn cannot tell which round.

export type FormRole = 'coordinator' | 'member';
export type StepId = 'agree' | 'setup' | 'round1' | 'round2' | 'round3' | 'broadcast' | 'link';
/** done; current: the group's next step; in-qt: under way in Dash-Qt, round unknown to Cairn; todo: later. */
export type StepState = 'done' | 'current' | 'in-qt' | 'todo';

export const STEP_IDS: readonly StepId[] = ['agree', 'setup', 'round1', 'round2', 'round3', 'broadcast', 'link'];
const IN_QT: readonly StepId[] = ['round1', 'round2', 'round3', 'broadcast'];

export interface GroupProgress {
  /** Terms locked and approved by every member (or a registration already linked). */
  ready: boolean;
  /** The coordinator marked the Dash-Qt session as started, or a registration is linked. */
  started: boolean;
  linked: boolean;
  /** The linked registration matches what was agreed (or the masternode has since dissolved): nothing left to do here. */
  settled: boolean;
}

export function stepStates(p: GroupProgress): Record<StepId, StepState> {
  const at = (current: StepId | 'rounds' | null): Record<StepId, StepState> => {
    const i = current === 'rounds' ? STEP_IDS.indexOf('round1') : current ? STEP_IDS.indexOf(current) : STEP_IDS.length;
    return Object.fromEntries(
      STEP_IDS.map((id, k) => [id, k < i ? 'done' : current === 'rounds' && IN_QT.includes(id) ? 'in-qt' : k === i ? 'current' : 'todo']),
    ) as Record<StepId, StepState>;
  };
  if (!p.ready) return at('agree');
  if (p.linked) return at(p.settled ? null : 'link');
  return at(p.started ? 'rounds' : 'setup');
}

/** The step to open: the current one, the round the viewer last opened while the group is in Dash-Qt, or the link once done. */
export function openStep(states: Record<StepId, StepState>, remembered: StepId | null): StepId {
  if (remembered && states[remembered] === 'in-qt') return remembered;
  return STEP_IDS.find((id) => states[id] === 'current' || states[id] === 'in-qt') ?? 'link';
}

/** Which pages of the coordinator's setup sheet (formation/setup.ts, in Dash-Qt's own order) each step shows. */
export const SETUP_PAGES: Readonly<Partial<Record<StepId, readonly string[]>>> = {
  setup: ['start', 'participants', 'settings', 'exit', 'contribution'],
  round1: ['invite'],
  round2: ['approvals'],
  round3: ['signatures'],
  broadcast: ['complete'],
};

export interface StepCopy {
  title: string;
  /** One line under the title: what happens in this step. */
  sub: string;
}

const SHARED: Record<'round1' | 'round2' | 'round3' | 'link', Record<FormRole, StepCopy>> = {
  round1: {
    coordinator: { title: 'Round 1: invitation', sub: 'Send one invitation, collect everyone’s Details, then lock the terms.' },
    member: { title: 'Round 1: invitation', sub: 'Check the invitation, reserve your coins and send back your Details.' },
  },
  round2: {
    coordinator: { title: 'Round 2: locked terms', sub: 'Send the locked terms and collect every Approval.' },
    member: { title: 'Round 2: locked terms', sub: 'Check the locked terms and send back your Approval.' },
  },
  round3: {
    coordinator: { title: 'Round 3: signatures', sub: 'Send the signing request and collect every Signed Contribution.' },
    member: { title: 'Round 3: signatures', sub: 'Check the signing request and send back your Signed Contribution.' },
  },
  link: {
    coordinator: { title: 'Link the registration', sub: 'Paste the ProTx hash so everyone sees it checked against the terms.' },
    member: { title: 'Link the registration', sub: 'Paste the ProTx hash, then keep a standby dissolution offline.' },
  },
};

export function stepCopy(id: StepId, role: FormRole): StepCopy {
  switch (id) {
    case 'agree':
      return { title: 'Terms agreed', sub: 'Locked by the organizer and approved by every co-owner on Cairn.' };
    case 'setup':
      return role === 'coordinator'
        ? { title: 'Set up Dash-Qt', sub: 'Start the session and fill in the first wizard pages.' }
        : { title: 'Get ready', sub: 'Open Dash-Qt with the wallet that holds your share and wait for the invitation.' };
    case 'broadcast':
      return role === 'coordinator'
        ? { title: 'Broadcast', sub: 'Press “Broadcast Registration” and copy the ProTx hash.' }
        : { title: 'Broadcast', sub: 'The coordinator broadcasts the registration and shares its ProTx hash.' };
    default:
      return SHARED[id][role];
  }
}
