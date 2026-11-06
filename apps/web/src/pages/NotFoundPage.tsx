import { Link } from 'react-router-dom';
import { PageHead } from '../ui/states.tsx';

/** The cairn mark with its top stone fallen to the ground beside it. */
function FallenCairn() {
  return (
    <svg className="fallen-cairn" viewBox="0 0 48 34" width="168" height="119" aria-hidden="true" focusable="false">
      <path className="ground" d="M1 31.6h46" />
      <path className="mark-base" d="M4.9 23.6c4.1-2 17.6-2.1 22.1-.1 3.4 1.5 3.4 5.4.1 6.9-4.6 2.1-17.8 2-22.3 0-3.2-1.5-3.2-5.3.1-6.8z" />
      <path className="mark-mid" d="M8.6 14.3c3-1.4 10.4-1.5 13.9-.2 2.8 1.1 2.9 4.4.2 5.7-3.4 1.6-11.2 1.6-14.4 0-2.5-1.3-2.4-4.3.3-5.5z" />
      <path className="mark-top" transform="translate(23.4 21.2) rotate(14 16 6.5)" d="M12.4 4.2c2.2-.9 5.6-.8 7.4.3 1.6 1 1.5 3.3-.2 4.3-2 1.2-5.6 1.3-7.6.3-1.9-1-1.6-4 .4-4.9z" />
    </svg>
  );
}

export function NotFoundPage() {
  return (
    <div className="page not-found">
      <FallenCairn />
      <PageHead title="Nothing here" lede="This address does not match any page on Cairn. The link may be mistyped, or from a newer version of the site." />
      <p className="not-found-links">
        <Link className="btn btn-primary" to="/groups">
          Open groups
        </Link>
        <Link className="btn" to="/check">
          Check a message
        </Link>
        <Link className="btn" to="/learn">
          Learn how it works
        </Link>
      </p>
    </div>
  );
}
