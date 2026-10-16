import { useEffect, useRef, useState } from 'react';
import { addToast } from '@heroui/react';
import { useUpdateSiteTracker } from '../hooks/useApi';
import { errMsg, fmtDateShort } from '../utils/fmt';

/**
 * monday's "Next action" column — typed by the team, since the AI-written version was cut
 * (client, 2026-10-16). Click to edit in place; Enter or click away saves, Escape cancels,
 * an empty box clears it. Who wrote it and when ride underneath, amber once it is a week
 * old: a plan nobody has touched in a fortnight is itself something to chase.
 */
export interface NextActionRow {
  id: string;
  label: string;
  nextAction?: { text: string; at: string | null; by: { id: string; name: string | null } | null } | null;
}

export function NextActionCell({ row, canEdit, roomy = false }: { row: NextActionRow; canEdit: boolean; roomy?: boolean }) {
  const update = useUpdateSiteTracker();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const na = row.nextAction ?? null;
  // Select on open, like every other inline cell on the board (InlineText): typing replaces,
  // an arrow key keeps the text and moves the caret to amend it.
  useEffect(() => { if (editing) box.current?.select(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next === (na?.text ?? '')) return;
    update.mutate({ unitId: row.id, data: { siteNextAction: next || null } }, {
      onError: (e) => addToast({ title: errMsg(e, 'Could not save the next action'), color: 'danger' }),
    });
  };

  if (editing) {
    return (
      <textarea
        ref={box} autoFocus rows={roomy ? 3 : 2} value={draft} maxLength={500}
        aria-label={`Next action for ${row.label}`} placeholder="What happens next, and who does it"
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
        }}
        className="w-full resize-none rounded border border-blue-500 bg-white px-2 py-1 text-xs text-gray-900 outline-none"
      />
    );
  }

  const days = na?.at ? Math.floor((Date.now() - new Date(na.at).getTime()) / 86_400_000) : null;
  const body = na ? (
    <>
      <p className={`${roomy ? 'line-clamp-3' : 'line-clamp-2'} text-xs text-gray-800`} title={na.text}>{na.text}</p>
      <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-gray-500">
        {na.by?.name && <span>{na.by.name}</span>}
        {na.at && (
          <span className={days !== null && days >= 7 ? 'text-amber-700' : ''}>
            {days !== null && days >= 7 ? `${days}d old` : fmtDateShort(na.at)}
          </span>
        )}
      </span>
    </>
  ) : (
    <span className="text-[11px] text-gray-500">{canEdit ? '+ Add next action' : '—'}</span>
  );

  if (!canEdit) return <div className="text-left">{body}</div>;
  return (
    <button
      type="button" onClick={() => { setDraft(na?.text ?? ''); setEditing(true); }}
      aria-label={na ? `Next action for ${row.label}: ${na.text} — edit` : `Add a next action for ${row.label}`}
      className="block w-full rounded px-1 py-0.5 text-left hover:ring-1 hover:ring-gray-300"
    >
      {body}
    </button>
  );
}
