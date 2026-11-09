// A person as Cairn shows them: Dash username first (proved by Platform), else their own display name, else a short identity;
// and the contact handles they chose to publish.
import type { Contacts } from '@cairn/contract';
import type { Person } from '../data/people.ts';
import { shortId } from '../matching/money.ts';

/** `fallback`: a name to show when the person has no profile name (a share's label in Dash-Qt). */
export function PersonName({ id, person, you, fallback }: { id: string; person?: Person; you?: boolean; fallback?: string }) {
  const name = person?.name ?? fallback;
  const other = person?.dpns && person.profile?.displayName && person.profile.displayName !== person.dpns ? person.profile.displayName : null;
  return (
    <span className="person" title={id}>
      {name ? <span className="person-name">{name}</span> : <span className="person-name mono-ish">{shortId(id)}</span>}
      {other && <span className="person-alt small muted"> · {person!.profile!.nameSuspect ? `“${other}”` : other}</span>}
      {you && <span className="you-tag">you</span>}
    </span>
  );
}

const LINKS: Partial<Record<keyof Contacts, (h: string) => string | null>> = {
  telegram: (h) => (/^@?[A-Za-z0-9_]{5,32}$/.test(h) ? `https://t.me/${h.replace(/^@/, '')}` : null),
  matrix: (h) => (/^@[^:\s]+:[^\s]+$/.test(h) ? `https://matrix.to/#/${h}` : null),
  website: (h) => h,
};
const LABEL: Record<keyof Contacts, string> = { discord: 'Discord', yappr: 'Yappr', telegram: 'Telegram', matrix: 'Matrix', dashpay: 'DashPay', website: 'Website' };

export function ContactList({ contacts, emptyClass = 'small muted' }: { contacts: Contacts; emptyClass?: string }) {
  const entries = (Object.keys(LABEL) as Array<keyof Contacts>).filter((k) => contacts[k]);
  if (!entries.length) return <span className={emptyClass}>No public contact</span>;
  return (
    <ul className="contacts-inline">
      {entries.map((k) => {
        const h = contacts[k]!;
        const href = LINKS[k]?.(h) ?? null;
        return (
          <li key={k}>
            <span className="muted">{LABEL[k]}</span>{' '}
            {href ? (
              <a href={href} rel="noopener noreferrer nofollow" target="_blank" className="break">
                {k === 'website' ? new URL(h).host : h}
              </a>
            ) : (
              <span className="break">{h}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
