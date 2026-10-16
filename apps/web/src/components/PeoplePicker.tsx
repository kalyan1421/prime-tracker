/**
 * The one people picker for the Site Tracker — unit owners (several) and checklist stage
 * owners (one).
 *
 * Built because of the 2026-10-13 meeting: Victor could not find his own name to assign
 * himself on his phone. Two causes, both fixed here. The stage Owner list loaded from an
 * admin-only endpoint, so for everyone but Super Admin and Founder it was EMPTY; and the
 * unit Owners dropdown was a long unsearchable menu that is hard to scroll on a phone.
 *
 * So: a search box, "Assign me" pinned at the top, rows tall enough to tap, and the list
 * always from `useAssignableUsers()` (every active person, any role).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Popover, PopoverTrigger, PopoverContent, Input } from '@heroui/react';
import { FiSearch, FiCheck, FiUserPlus, FiUserMinus } from 'react-icons/fi';
import { useAssignableUsers } from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';

export interface PickerUser { id: string; name: string | null; email: string }

export const personLabel = (u: PickerUser) => u.name ?? u.email;

interface Props {
  /** 'multi' toggles people in and out; 'single' picks one and closes. */
  mode: 'multi' | 'single';
  selected: string[];
  onChange: (ids: string[]) => void;
  /** The thing you tap to open it. */
  children: ReactNode;
  isDisabled?: boolean;
  /** A line under the list, e.g. "Owners are notified of every update". */
  footnote?: string;
  label?: string;
}

export function PeoplePicker({ mode, selected, onChange, children, isDisabled, footnote, label = 'Choose people' }: Props) {
  const { data = [] } = useAssignableUsers();
  const me = useAuthStore((s) => s.user?.id);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const users = data as PickerUser[];
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t
      ? users.filter((u) => `${u.name ?? ''} ${u.email}`.toLowerCase().includes(t))
      : users;
    // Selected people first, so what is already chosen is never scrolled off.
    return [...list].sort((a, b) => Number(selected.includes(b.id)) - Number(selected.includes(a.id)));
  }, [users, q, selected]);

  const toggle = (id: string) => {
    if (mode === 'single') {
      onChange(selected[0] === id ? [] : [id]);
      setOpen(false);
      return;
    }
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const meListed = !!me && users.some((u) => u.id === me);
  const meChosen = !!me && selected.includes(me);

  return (
    <Popover
      placement="bottom-start" isOpen={open}
      // Disabled stops it OPENING; it never snaps shut mid-pick while a save is in flight.
      onOpenChange={(o) => { if (o && isDisabled) return; setOpen(o); if (!o) setQ(''); }}
      shouldBlockScroll={false}
    >
      <PopoverTrigger>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-[min(18rem,calc(100vw-2rem))] p-2" aria-label={label}>
        <div className="flex w-full flex-col gap-1.5">
          <Input
            size="sm" autoFocus value={q} onValueChange={setQ} aria-label="Search people"
            placeholder="Search people" startContent={<FiSearch className="text-gray-500" />}
          />
          {meListed && (
            <button
              type="button"
              onClick={() => toggle(me!)}
              className="flex min-h-[40px] w-full items-center gap-2 rounded-md bg-blue-50 px-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-100"
            >
              {meChosen ? <FiUserMinus size={14} /> : <FiUserPlus size={14} />}
              {meChosen ? 'Remove me' : 'Assign me'}
            </button>
          )}
          <ul className="max-h-64 overflow-y-auto" role="listbox" aria-multiselectable={mode === 'multi'} aria-label={label}>
            {shown.length === 0 && (
              <li className="px-2 py-3 text-xs text-gray-500">Nobody matches “{q}”.</li>
            )}
            {shown.map((u) => {
              const on = selected.includes(u.id);
              return (
                <li key={u.id} role="option" aria-selected={on}>
                  <button
                    type="button" onClick={() => toggle(u.id)}
                    className={`flex min-h-[40px] w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-gray-100 ${on ? 'font-medium text-gray-900' : 'text-gray-700'}`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300'}`}>
                      {on && <FiCheck size={11} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{personLabel(u)}</span>
                    {u.id === me && <span className="text-[11px] text-gray-500">you</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {footnote && <p className="border-t border-gray-100 px-1 pt-1.5 text-[11px] text-gray-500">{footnote}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
