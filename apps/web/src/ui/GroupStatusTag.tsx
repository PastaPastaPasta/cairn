// A group's status on a list card. The stored status is the organizer's claim: a locked group may already be ready to form, so
// past lock the card reads the group's approvals and says what its own page says (F-019).
import { GROUP_STATUS, type Group } from '@cairn/contract';
import { useApp } from '../app/context.tsx';
import { loadGroupBundle, useLoad } from '../data/cairn.ts';
import { groupView, isLockedStatus } from '../matching/group.ts';
import { stageOf, type Stage } from '../matching/stage.ts';
import { GROUP_STATUS_WORDS } from '../matching/words.ts';

/** Cards read their groups a few at a time, so a long list does not send every read at once. */
const LIMIT = 3;
let running = 0;
const queue: Array<() => void> = [];
async function limited<T>(read: () => Promise<T>): Promise<T> {
  if (running >= LIMIT) await new Promise<void>((go) => queue.push(go));
  running++;
  try {
    return await read();
  } finally {
    running--;
    queue.shift()?.();
  }
}

const STAGE_WORDS: Partial<Record<Stage, string>> = {
  ready: 'Ready to form',
  'session-started': 'Forming in Dash-Qt',
  linked: 'Registration linked',
  full: 'Full, agreeing terms',
  open: 'Taking co-owners',
};

export function GroupStatusTag({ g }: { g: Group }) {
  const { registry } = useApp();
  const past = isLockedStatus(g.status);
  const load = useLoad(past ? `group-status:${g.id}:${g.docRevision}` : null, (r) => limited(() => loadGroupBundle(r, g.id)));
  let text = GROUP_STATUS_WORDS[g.status] ?? 'Group';
  if (past && load.status === 'ready' && load.data) {
    const view = groupView(load.data, registry.network);
    const stage = stageOf(view, null);
    text = stage === 'locked' ? `Terms locked · ${view.approvedCount} of ${view.shares.length} approved` : (STAGE_WORDS[stage] ?? text);
  }
  return (
    <span className={`state state-${g.status === GROUP_STATUS.forming ? 'ok' : 'muted'}`} data-testid="group-status-tag">
      {text}
    </span>
  );
}
