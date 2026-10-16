import { useEffect, useState } from 'react';

/**
 * True while the media query matches. For choosing WHICH layout to mount, not just which
 * to show: hiding a layout with CSS still mounts it, and the Site Tracker's two layouts
 * each hold a full checklist per expanded row.
 */
export function useMediaQuery(query: string) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia(query);
    const on = () => setMatches(mql.matches);
    on();
    mql.addEventListener('change', on);
    return () => mql.removeEventListener('change', on);
  }, [query]);
  return matches;
}
