// Loading, error and empty states for anything read from Platform, the same everywhere: never a blank page, never a spinner
// without words, and a way to try again.
import type { ReactNode } from 'react';
import type { Load } from '../data/cairn.ts';

export function Loaded<T>({ load, empty, isEmpty, children, what = 'Reading from Dash Platform…', retry }: { load: Load<T>; empty?: ReactNode; isEmpty?(d: T): boolean; children(d: T): ReactNode; what?: string; retry?(): void }) {
  if (load.status === 'loading')
    return (
      <p className="list-status muted" role="status">
        <span className="spinner" aria-hidden="true" /> {what}
      </p>
    );
  if (load.status === 'error')
    return (
      <div className="list-status" role="alert">
        <p className="error">{load.error}</p>
        {retry && (
          <button type="button" className="btn btn-s" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    );
  if (empty && isEmpty?.(load.data)) return <div className="empty-state">{empty}</div>;
  return <>{children(load.data)}</>;
}

/** A write's outcome under its button: busy, the error, or what was confirmed. */
export function WriteStatus({ busy, error, done, busyText = 'Signing and sending to Dash Platform…' }: { busy: boolean; error: string | null; done?: ReactNode; busyText?: string }) {
  if (busy)
    return (
      <p className="small muted write-status" role="status">
        <span className="spinner" aria-hidden="true" /> {busyText}
      </p>
    );
  if (error)
    return (
      <p className="error small write-status" role="alert">
        {error}
      </p>
    );
  if (done)
    return (
      <p className="notice-ok small write-status" role="status">
        {done}
      </p>
    );
  return null;
}
