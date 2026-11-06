// DESIGN S4: profiles this viewer chose to hide. A list in this browser only (v1 has no central moderation; reports go to the
// group's chat), one per network because identities differ between networks. Hidden people's posts and listings drop out of the
// lists, their seat requests fold away, and they are not suggested for invites or combinations.
import { useMemo, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../app/context.tsx';
import { usePeople } from '../data/people.ts';
import { PersonName } from './Person.tsx';

const PREFIX = 'cairn.hidden.v1.';
const NONE: readonly string[] = [];
// parsed once per stored string, so useSyncExternalStore gets the same array until the list really changes
const parsed = new Map<string, { raw: string | null; ids: readonly string[] }>();
// used when storage is blocked, so hiding still works on this page
const memory = new Map<string, readonly string[]>();
const listeners = new Set<() => void>();

function stored(network: string): string | null {
  try {
    return localStorage.getItem(PREFIX + network);
  } catch {
    return null;
  }
}

function read(network: string): readonly string[] {
  if (memory.has(network)) return memory.get(network)!;
  const raw = stored(network);
  const known = parsed.get(network);
  if (known && known.raw === raw) return known.ids;
  let ids = NONE;
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    if (Array.isArray(v)) ids = v.filter((x): x is string => typeof x === 'string');
  } catch {
    // garbled: nothing hidden
  }
  parsed.set(network, { raw, ids });
  return ids;
}

function write(network: string, ids: readonly string[]) {
  try {
    localStorage.setItem(PREFIX + network, JSON.stringify(ids));
    memory.delete(network);
  } catch {
    memory.set(network, ids);
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(PREFIX)) l();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
}

export interface Hidden {
  ids: readonly string[];
  has(id: string): boolean;
  hide(id: string): void;
  show(id: string): void;
}

export function useHidden(): Hidden {
  const { registry } = useApp();
  const net = registry.network;
  const ids = useSyncExternalStore(subscribe, () => read(net), () => read(net));
  return useMemo(() => {
    const set = new Set(ids);
    return {
      ids,
      has: (id: string) => set.has(id),
      hide: (id: string) => write(net, [...read(net).filter((x) => x !== id), id]),
      show: (id: string) => write(net, read(net).filter((x) => x !== id)),
    };
  }, [ids, net]);
}

export function HideButton({ id, name, hidden }: { id: string; name?: string | null; hidden: Hidden }) {
  return (
    <button type="button" className="btn btn-s btn-quiet" onClick={() => hidden.hide(id)} aria-label={`Hide ${name ?? 'this profile'}`} title="Hide this profile in this browser" data-testid="hide-profile">
      Hide
    </button>
  );
}

/** Under a list that left hidden people out. */
export function HiddenNote({ count }: { count: number }) {
  if (!count) return null;
  return (
    <p className="small muted" data-testid="hidden-note">
      {count === 1 ? 'One profile you hid is' : `${count} profiles you hid are`} not shown. <Link to="/settings#hidden">Hidden profiles</Link>
    </p>
  );
}

/** Settings: everyone hidden on this network, each with "Show again". */
export function HiddenProfiles() {
  const hidden = useHidden();
  const people = usePeople(hidden.ids);
  return (
    <section className="settings-block" id="hidden" aria-labelledby="hidden-title" data-testid="hidden-profiles">
      <h2 id="hidden-title">Hidden profiles</h2>
      <p className="muted">
        Hide someone from their profile, a list or a seat request, and Cairn stops showing their posts and listings and stops suggesting them, in this browser only.
        Nobody is told. To report someone, tell their group in its chat: Cairn has no central moderation.
      </p>
      {hidden.ids.length ? (
        <ul className="fit-people">
          {hidden.ids.map((id) => (
            <li key={id} className="fit-person">
              <PersonName id={id} person={people.get(id)} />
              <button type="button" className="btn btn-s" onClick={() => hidden.show(id)} data-testid="unhide-profile">
                Show again
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">You have not hidden anyone.</p>
      )}
    </section>
  );
}
