/**
 * Comment box with @mention autocomplete.
 *
 * The backend resolves mentions by matching the typed text against real user names
 * (see apps/api/src/modules/comments/mentions.ts), so nothing here is required for a
 * mention to work — typing "@Sarah Chen" by hand is enough. This exists for the two
 * things free-text cannot give you: discovery (people do not try "@" unless something
 * suggests it) and exactness (the resolver needs the name spelled as it is stored, and
 * "@Sara" vs "@Sarah" silently notifies the wrong person or nobody).
 *
 * Deliberately inserts the plain name rather than a token like `@[Name](id)`: the
 * comment body is displayed as-is everywhere, and a raw token in the thread would be
 * worse than the ambiguity it removes.
 */
import { forwardRef, useImperativeHandle, useState, useRef, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Textarea, Avatar } from '@heroui/react';

export interface MentionUser {
  id: string;
  name?: string | null;
  email: string;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  users: MentionUser[];
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Accessible name; a placeholder alone is not one. */
  ariaLabel?: string;
  /**
   * What fires `onSubmit`. 'enter' (default): Enter, with Shift+Enter for a newline — right
   * for a one-line comment bar. 'mod-enter': only Cmd/Ctrl+Enter, so plain Enter stays a
   * newline — right for a multi-line discussion box where losing a note mid-sentence to a
   * stray Enter is worse than one extra keystroke to post.
   */
  submitOn?: 'enter' | 'mod-enter';
}

/** For a "Mention" button that lives outside this component. */
export interface MentionTextareaHandle {
  /** Put an "@" at the caret, focus the box and open the list. */
  startMention: () => void;
}

/** The partial word being typed after an "@", or null when the caret is not in one. */
function activeMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const upTo = text.slice(0, caret);
  const at = upTo.lastIndexOf('@');
  if (at === -1) return null;
  // Must start a word, else "bob@example.com" opens the picker mid-address.
  if (at > 0 && !/\s/.test(upTo[at - 1])) return null;
  const query = upTo.slice(at + 1);
  // A newline ends it, and so does a long run — a mention is a name, not a sentence.
  if (/\n/.test(query) || query.length > 40) return null;
  return { query, start: at };
}

export const MentionTextarea = forwardRef<MentionTextareaHandle, Props>(function MentionTextarea({
  value, onChange, onSubmit, users,
  placeholder, minRows = 1, maxRows = 4, className, size = 'sm', ariaLabel, submitOn = 'enter',
}, handle) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // A textarea's selectionStart is only meaningful once the person has been in it. Until
  // then startMention appends at the end instead of trusting a caret they never placed.
  const everFocused = useRef(false);

  const mention = useMemo(() => activeMentionQuery(value, caret), [value, caret]);

  const matches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase().trim();
    return users
      .filter((u) => {
        const name = (u.name || '').toLowerCase();
        const email = u.email.toLowerCase();
        return !q || name.includes(q) || email.includes(q);
      })
      .slice(0, 6);
  }, [mention, users]);

  const showList = open && !!mention && matches.length > 0;

  // The list is portalled to <body> and positioned in viewport coordinates.
  //
  // Absolute positioning inside the component does not survive its surroundings: every
  // comment box sits in a HeroUI CardBody, which is overflow-hidden, so the dropdown was
  // sliced down to a single visible row. A portal is the only placement that is immune
  // to whatever ancestor happens to clip.
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!showList || !ref.current) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    const width = Math.max(240, Math.min(320, r.width));
    const height = Math.min(220, matches.length * 40 + 8);
    // Prefer above the box (comment inputs sit near the bottom of the page); flip below
    // when there is not room, so the list is never off-screen.
    const above = r.top - height - 4;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: above >= 8 ? above : r.bottom + 4,
      width,
    });
  }, [showList, matches.length, value, caret]);

  const insert = (u: MentionUser) => {
    if (!mention) return;
    const label = u.name || u.email.split('@')[0];
    const next = `${value.slice(0, mention.start)}@${label} ${value.slice(caret)}`;
    onChange(next);
    setOpen(false);
    // Put the caret just after what we inserted, not at the end of the whole box.
    const pos = mention.start + label.length + 2;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const syncCaret = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart ?? 0);
    setOpen(true);
  };

  useImperativeHandle(handle, () => ({
    startMention: () => {
      const el = ref.current;
      const at = everFocused.current ? (el?.selectionStart ?? value.length) : value.length;
      // An "@" glued to the previous word ("hi@") would not start a mention.
      const lead = at > 0 && !/\s/.test(value[at - 1]) ? ' ' : '';
      onChange(`${value.slice(0, at)}${lead}@${value.slice(at)}`);
      const caretAt = at + lead.length + 1;
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(caretAt, caretAt);
        setCaret(caretAt);
        setOpen(true);
      });
    },
  }));

  return (
    <div className={`relative ${className ?? ''}`}>
      {showList && pos && createPortal(
        <div
          style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, zIndex: 9999 }}
          className="max-h-[220px] overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {matches.map((u, i) => (
            <button
              key={u.id}
              type="button"
              // onMouseDown, not onClick: click fires after blur, by which time the
              // caret position this insert depends on is already gone.
              onMouseDown={(e) => { e.preventDefault(); insert(u); }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left ${
                i === highlight ? 'bg-blue-50' : 'hover:bg-gray-50'
              }`}
            >
              <Avatar size="sm" name={u.name || u.email} className="w-5 h-5 shrink-0 text-[11px]" />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-gray-800 truncate">{u.name || u.email}</span>
                <span className="block text-[11px] text-gray-500 truncate">{u.email}</span>
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
      <Textarea
        ref={ref}
        size={size}
        minRows={minRows}
        maxRows={maxRows}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => { onChange(e.target.value); syncCaret(e.target as unknown as HTMLTextAreaElement); }}
        // HeroUI types Textarea's click target as HTMLInputElement; the runtime element
        // is the textarea, so the double cast is the accurate one.
        onClick={(e) => syncCaret(e.target as unknown as HTMLTextAreaElement)}
        onKeyUp={(e) => {
          // Arrows/Home/End move the caret without changing the value, so the query
          // must be recomputed on key-up too or the list goes stale.
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0);
          }
        }}
        onFocus={() => { everFocused.current = true; }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (showList) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => (h + 1) % matches.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => (h - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(matches[highlight]); return; }
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
          }
          const wantsSubmit = submitOn === 'mod-enter' ? (e.metaKey || e.ctrlKey) : !e.shiftKey;
          if (e.key === 'Enter' && wantsSubmit && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
  );
});
