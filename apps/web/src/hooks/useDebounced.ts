import { useEffect, useState } from 'react';

/**
 * Debounced mirror of a rapidly-changing value — typically a search box, so a filtered
 * query fires once the user stops typing rather than once per keystroke.
 *
 * LeadsPage and ProjectsPage each hand-roll this with a timeout hung off a useCallback.
 * Those still work and are left alone; new callers should use this instead of adding a
 * fourth copy. Same 300ms both of them settled on.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    // Clears on every change AND on unmount, so a pending timer can never fire into an
    // unmounted component.
    return () => clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
