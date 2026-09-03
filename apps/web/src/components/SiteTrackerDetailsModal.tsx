/**
 * Edit a unit's SITE-TRACKER fields — blocker, priority and owners.
 *
 * The pencil on a Site Tracker row used to open EditUnitModal, which edits the unit
 * itself: its number, type, size, asking price. Those are the details of the asset, not of
 * the work — and on a board about what is happening on site this week, "edit" meaning
 * "rename the unit" is the wrong verb. The board's own fields were editable only through
 * four separate inline controls scattered across the row, with no single place that showed
 * them together (client, 2026-09-02).
 *
 * Unit details are still reachable, from a secondary action at the foot of this dialog, so
 * the row keeps both jobs rather than trading one for the other.
 */
import { useState } from 'react';
import {
  Button, Input, Select, SelectItem, Textarea, Chip,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, addToast,
} from '@heroui/react';
import { FiEdit2 } from 'react-icons/fi';
import {
  useUpdateSiteTracker, useSetUnitAssignees, useAssignableUsers, useCustomOptions,
} from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { errMsg } from '../utils/fmt';

const BLOCKER_CHOICES = [
  { key: 'NONE', label: 'Not assessed' },
  { key: 'NO', label: 'Not blocked' },
  { key: 'YES', label: 'Blocked' },
];

export function SiteTrackerDetailsModal({ unit, canEdit, onClose, onEditUnitDetails }: {
  unit: any;
  canEdit: boolean;
  onClose: () => void;
  /** Absent when the viewer may not edit the unit itself — the button is then not shown. */
  onEditUnitDetails?: () => void;
}) {
  const update = useUpdateSiteTracker();
  const setAssignees = useSetUnitAssignees();
  const { data: users = [] } = useAssignableUsers();
  const { data: priorityOpts = [] } = useCustomOptions('site_priority');
  const canAssign = useAuthStore((s) => s.hasPermission('siteTracker:edit'));

  const [form, setForm] = useState({
    blockerStatus: unit.blockerStatus ?? 'NONE',
    blockerReason: unit.blockerReason ?? '',
    sitePriority: unit.sitePriority ?? '',
  });
  const [owners, setOwners] = useState<string[]>((unit.assignees ?? []).map((a: any) => a.id));
  const [err, setErr] = useState<string | null>(null);

  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setErr(null);
    // A blocker with no reason is the entry everybody has to chase down later.
    if (form.blockerStatus === 'YES' && !form.blockerReason.trim()) {
      setErr('Say what is blocking it — a blocker with no reason is one someone has to chase.');
      return;
    }
    try {
      await update.mutateAsync({
        unitId: unit.id,
        data: {
          // 'NONE' is the UI's word for "nobody has assessed this", which the API stores
          // as null — a real third state that an empty string cannot express.
          blockerStatus: form.blockerStatus === 'NONE' ? null : form.blockerStatus,
          blockerReason: form.blockerStatus === 'YES' ? form.blockerReason.trim() : null,
          sitePriority: form.sitePriority || null,
        },
      });
      // One PUT with the whole set, never a write per person: the API throttles at
      // 10 req/sec and a per-owner loop silently drops assignees past the cap.
      const before = (unit.assignees ?? []).map((a: any) => a.id).sort().join(',');
      if (canAssign && owners.slice().sort().join(',') !== before) {
        await setAssignees.mutateAsync({ unitId: unit.id, userIds: owners });
      }
      addToast({ title: 'Tracker details saved', color: 'success' });
      onClose();
    } catch (e) {
      setErr(errMsg(e, 'Could not save the tracker details'));
    }
  };

  const pending = update.isPending || setAssignees.isPending;

  return (
    <Modal isOpen onOpenChange={onClose} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Unit {unit.unitNumber} — site details</span>
          <span className="text-[11px] font-normal text-gray-500">
            {unit.building?.name}{unit.project?.name ? ` · ${unit.project.name}` : ''}
          </span>
        </ModalHeader>
        <ModalBody className="pb-2">
          {err && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              size="sm" label="Blocker" labelPlacement="outside" isDisabled={!canEdit}
              selectedKeys={new Set([form.blockerStatus])}
              onSelectionChange={(k) => set('blockerStatus')((Array.from(k)[0] as string) ?? 'NONE')}
            >
              {BLOCKER_CHOICES.map((c) => (
                <SelectItem key={c.key} textValue={c.label}>{c.label}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm" label="Priority" labelPlacement="outside" placeholder="Not set"
              isDisabled={!canEdit}
              selectedKeys={form.sitePriority ? new Set([form.sitePriority]) : new Set()}
              onSelectionChange={(k) => set('sitePriority')((Array.from(k)[0] as string) ?? '')}
            >
              {(priorityOpts as any[]).map((o) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
          </div>

          {form.blockerStatus === 'YES' && (
            <Textarea
              size="sm" label="What is blocking it?" labelPlacement="outside"
              minRows={2} isDisabled={!canEdit}
              value={form.blockerReason}
              onValueChange={(v) => setForm((f) => ({ ...f, blockerReason: v }))}
            />
          )}

          <Select
            size="sm" label="Owners" labelPlacement="outside" selectionMode="multiple"
            placeholder="Unassigned" isDisabled={!canEdit || !canAssign}
            selectedKeys={new Set(owners)}
            onSelectionChange={(k) => setOwners(Array.from(k as Set<string>))}
          >
            {(users as any[]).map((usr) => (
              <SelectItem key={usr.id} textValue={usr.name ?? usr.email}>{usr.name ?? usr.email}</SelectItem>
            ))}
          </Select>

          {/* The asset, not the work. Kept as a secondary route rather than removed: the
              row used to open exactly this form and somebody relies on it. */}
          {onEditUnitDetails && (
            <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2">
              <div>
                <p className="text-xs font-medium text-gray-700">Unit details</p>
                <p className="text-[11px] text-gray-500">Number, type, size — the asset, not the site work.</p>
              </div>
              <Button
                size="sm" variant="flat" startContent={<FiEdit2 className="w-3 h-3" />}
                onPress={onEditUnitDetails}
              >
                Edit unit
              </Button>
            </div>
          )}

          {!canEdit && (
            <Chip size="sm" variant="flat" className="text-[11px]">Read-only — you cannot edit the tracker</Chip>
          )}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose} isDisabled={pending}>Cancel</Button>
          {canEdit && (
            <Button size="sm" color="primary" onPress={submit} isLoading={pending}>Save</Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
