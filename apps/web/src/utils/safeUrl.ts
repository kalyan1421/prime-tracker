/**
 * Schemes a user-entered link may be rendered with as an `<a href>`.
 *
 * The API refuses anything else on save (UpdateBoardService.normalizeLinks), so this is
 * defence in depth: rows stored before that check existed, or written by some other path,
 * must not turn into a clickable `javascript:` / `data:` link. Checked on the parsed URL,
 * which is how the browser itself reads an href — "JavaScript:", leading spaces and
 * embedded tabs all normalise to the same scheme there.
 */
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function isSafeLinkUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(url.trim()).protocol);
  } catch {
    return false;
  }
}
