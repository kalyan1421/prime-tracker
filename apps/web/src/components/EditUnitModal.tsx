/**
 * Edit a unit's own details from the Site Tracker.
 *
 * The board is where you notice a unit's number or size is wrong, and until now fixing it
 * meant opening the unit page to find the same form. This is that form, reachable from the
 * row.
 *
 * Opening it needs `unit:editBuild`; the commercial fields inside it (asking price, asking
 * rent) additionally need `unit:edit` and are not rendered without it. Construction holds
 * the former and not the latter, so a site lead can fix a wrong unit number or size from
 * the row but never sets a price or a rent. The API enforces the same split, so hiding the
 * inputs is presentation, not the control.
 */
import { useState } from 'react';
import {
  Button, Input, Select, SelectItem, Textarea,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, addToast,
} from '@heroui/react';
import { FiAlertTriangle } from 'react-icons/fi';
import { useUpdateUnit, useCustomOptions } from '../hooks/useApi';
import { useAuthStore } from '../store/authStore';
import { errMsg } from '../utils/fmt';

export function EditUnitModal({ unit, onClose }: { unit: any; onClose: () => void }) {
  const update = useUpdateUnit();
  const canEditCommercial = useAuthStore((st) => st.hasPermission('unit:edit'));
  const { data: unitTypeData } = useCustomOptions('unit_type');
  const unitTypeOpts: any[] = Array.isArray(unitTypeData) ? unitTypeData : [];

  const [form, setForm] = useState({
    unitNumber: unit.unitNumber ?? '',
    unitType: unit.unitType ?? '',
    sqft: unit.sqft != null ? String(unit.sqft) : '',
    askingPrice: unit.askingPrice != null ? String(unit.askingPrice) : '',
    askingRent: unit.askingRent != null ? String(unit.askingRent) : '',
    notes: unit.notes ?? '',
  });
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!form.unitNumber.trim()) { setErr('A unit needs a number.'); return; }
    setErr(null);
    try {
      await update.mutateAsync({
        id: unit.id,
        data: {
          unitNumber: form.unitNumber.trim(),
          unitType: form.unitType || undefined,
          // Empty clears the field rather than leaving the old value behind, which is what
          // someone deleting the contents of the box means.
          sqft: form.sqft ? parseInt(form.sqft, 10) : null,
          // Omitted entirely without the permission. Sending them as null would not be a
          // no-op — the API refuses the request outright rather than dropping fields.
          ...(canEditCommercial ? {
            askingPrice: form.askingPrice ? parseFloat(form.askingPrice) : null,
            askingRent: form.askingRent ? parseFloat(form.askingRent) : null,
          } : {}),
          notes: form.notes.trim() || null,
        },
      });
      addToast({ title: `Unit ${form.unitNumber.trim()} updated`, color: 'success' });
      onClose();
    } catch (e) {
      setErr(errMsg(e, 'Could not save the unit'));
    }
  };

  return (
    <Modal isOpen onOpenChange={onClose} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Edit Unit {unit.unitNumber}</span>
          <span className="text-[11px] font-normal text-gray-500">
            {unit.building?.name} · {unit.project?.name}
          </span>
        </ModalHeader>
        <ModalBody className="pb-2">
          {err && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <FiAlertTriangle className="mt-0.5 shrink-0" />{err}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input size="sm" label="Unit number" value={form.unitNumber} onValueChange={set('unitNumber')} />
            <Select
              size="sm" label="Unit type" selectedKeys={form.unitType ? new Set([form.unitType]) : new Set()}
              onSelectionChange={(k) => set('unitType')((Array.from(k)[0] as string) ?? '')}
            >
              {unitTypeOpts.map((o: any) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
            <Input size="sm" type="number" label="Size (sqft)" value={form.sqft} onValueChange={set('sqft')} />
            {canEditCommercial && (
              <>
                <Input size="sm" type="number" label="Asking price" value={form.askingPrice} onValueChange={set('askingPrice')} />
                <Input size="sm" type="number" label="Asking rent ($/mo)" value={form.askingRent} onValueChange={set('askingRent')} />
              </>
            )}
          </div>
          <Textarea size="sm" minRows={2} label="Notes" value={form.notes} onValueChange={set('notes')} />
          <p className="text-[11px] text-gray-500">
            Status, blocker and priority are set on the board itself, not here.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button size="sm" color="primary" onPress={submit} isLoading={update.isPending}>Save</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
