import { Link } from 'react-router-dom';
import { PageHead } from '../ui/states.tsx';

export function NotFoundPage() {
  return (
    <div className="page">
      <PageHead title="Nothing here" lede="This address does not match any page on Cairn. The link may be mistyped, or from a newer version of the site." />
      <p>
        <Link className="btn" to="/">
          Go to the start
        </Link>
      </p>
    </div>
  );
}
