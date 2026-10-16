/**
 * Plain text with @mentions highlighted, for site updates (ST-10).
 *
 * Mentions are stored as plain text ("@Ana P") and resolved on the server against the live
 * roster, so the display does the same: only "@" followed by a real person's name is
 * highlighted, which keeps "@2pm" or an email address looking like ordinary text.
 */
import { useMemo } from 'react';
import { MentionTextarea, type MentionUser } from './MentionTextarea';

export function MentionText({ text, names }: { text: string; names: string[] }) {
  const parts = useMemo(() => {
    const clean = names.filter(Boolean);
    if (!text.includes('@') || clean.length === 0) return [text];
    // Longest first so "@Ana Perez" wins over "@Ana".
    const escaped = [...clean].sort((a, b) => b.length - a.length)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`@(${escaped.join('|')})`, 'gi');
    const out: Array<string | JSX.Element> = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(
        <span key={`${m.index}-${m[0]}`} className="rounded bg-blue-50 px-0.5 font-medium text-blue-700">{m[0]}</span>,
      );
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }, [text, names]);
  return <>{parts}</>;
}

/**
 * A site-update box that offers @mentions. The wrapping <label> names the textarea for
 * screen readers (and tests) without needing anything from MentionTextarea beyond its
 * committed props. `hideLabel` keeps the name but drops it from view.
 */
export function MentionBox({
  label, hideLabel = false, value, onChange, users, placeholder, minRows = 2, maxRows = 8, onSubmit, className = '',
}: {
  label: string; hideLabel?: boolean; value: string; onChange: (v: string) => void;
  users: MentionUser[]; placeholder?: string; minRows?: number; maxRows?: number;
  /** Enter posts (Shift+Enter for a newline). Leave unset for a box where Enter is a newline. */
  onSubmit?: () => void; className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className={hideLabel ? 'sr-only' : 'mb-1 block text-xs text-gray-700'}>{label}</span>
      <MentionTextarea
        value={value} onChange={onChange} users={users} placeholder={placeholder}
        minRows={minRows} maxRows={maxRows} onSubmit={onSubmit}
      />
    </label>
  );
}
