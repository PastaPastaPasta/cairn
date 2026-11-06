// Scrolls to the URL's #fragment once that element is on the page: sections of a group's pages appear only after Platform and the
// chain are read, so the browser's own jump on navigation finds nothing.
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/** `content` changes whenever new sections may have appeared (for example the group's stage). */
export function useScrollToHash(content: unknown): void {
  const { hash } = useLocation();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!hash || done.current === hash) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!el) return;
    done.current = hash;
    el.scrollIntoView();
  }, [hash, content]);
}
