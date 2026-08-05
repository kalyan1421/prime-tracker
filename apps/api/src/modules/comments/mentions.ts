/**
 * @mention parsing for comment bodies.
 *
 * Comments are stored as plain text typed into a textarea, so there is no structured
 * mention token to read — the text really does just contain "@Sarah Chen". Resolution is
 * therefore done against the actual user list rather than by pattern alone, which avoids
 * turning "@here", "@2pm" or an email address into a phantom recipient.
 *
 * Names are multi-word, so a greedy longest-match is required: with both "Sarah" and
 * "Sarah Chen" on the roster, "@Sarah Chen" must resolve to the latter. Candidates are
 * generated from 1..MAX_NAME_WORDS words after the "@" and tried longest first.
 *
 * Matching is case-insensitive and ignores internal punctuation so "@sarah chen,"
 * resolves. A trailing comma/period is common and must not defeat the match.
 */

/** Longest full name we will try to match. Four covers "Maria del Carmen Rodriguez". */
const MAX_NAME_WORDS = 4;

export interface MentionCandidate {
  id: string;
  name: string | null;
  email: string;
}

/** Strip punctuation that commonly trails a mention, and collapse whitespace. */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,;:!?'")\]]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve @mentions in `content` to user ids.
 *
 * Returns ids only — deduplicated, and in first-appearance order so a caller can show
 * "you and 2 others" sensibly. Unresolvable mentions are ignored rather than reported:
 * a typo'd name should post the comment, not reject it.
 */
export function resolveMentions(content: string, users: MentionCandidate[]): string[] {
  if (!content.includes('@') || users.length === 0) return [];

  // Index every way a user can be addressed. Email local-part is included because
  // "@sarah.chen" is a natural thing to type for someone whose display name is unknown.
  const byHandle = new Map<string, string>();
  for (const u of users) {
    if (u.name) byHandle.set(normalise(u.name), u.id);
    const local = u.email?.split('@')[0];
    if (local) byHandle.set(normalise(local), u.id);
    if (u.email) byHandle.set(normalise(u.email), u.id);
  }

  const found: string[] = [];
  const seen = new Set<string>();

  // Walk each "@" and try progressively shorter word-runs after it.
  //
  // Deliberately an index scan, not a /@(...)/g exec loop: any regex whose body can span
  // the rest of the line advances lastIndex past every later "@", so only the first
  // mention on a line is ever examined. "@James and @Emily" must find both.
  for (let i = content.indexOf('@'); i !== -1; i = content.indexOf('@', i + 1)) {
    // "bob@example.com" is an address, not a mention — require the @ to start a word.
    if (i > 0 && !/\s/.test(content[i - 1])) continue;

    const lineEnd = content.indexOf('\n', i);
    const rest = content.slice(i + 1, lineEnd === -1 ? undefined : lineEnd);
    if (!rest.trim()) continue;
    const words = rest.trim().split(/\s+/).slice(0, MAX_NAME_WORDS);

    for (let n = words.length; n >= 1; n--) {
      const candidate = normalise(words.slice(0, n).join(' '));
      const id = byHandle.get(candidate);
      if (id) {
        if (!seen.has(id)) {
          seen.add(id);
          found.push(id);
        }
        break; // longest match wins; do not also match its prefix
      }
    }
  }

  return found;
}
