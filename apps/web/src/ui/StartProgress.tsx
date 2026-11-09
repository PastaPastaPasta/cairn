import { Link } from 'react-router-dom';

/** What a started group has confirmed so far, and the error with a way on when the group exists but a later step failed. */
export function StartProgress({ busy, progress, error, createdId, finish }: { busy: boolean; progress: string[]; error: string | null; createdId: string | null; finish: string }) {
  return (
    <>
      {(busy || progress.length > 0) && (
        <ol className="progress-list small" aria-live="polite">
          {progress.map((p) => (
            <li key={p}>{p}</li>
          ))}
          {busy && (
            <li>
              <span className="spinner" aria-hidden="true" /> Signing and confirming on Dash Platform…
            </li>
          )}
        </ol>
      )}
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          {createdId && (
            <p>
              The group itself was created. <Link to={`/g/${createdId}`}>Open it</Link>, or press Finish {finish}.
            </p>
          )}
        </div>
      )}
    </>
  );
}
