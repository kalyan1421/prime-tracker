/**
 * Create a unit inside a known building.
 *
 * Deliberately the CREATE subset of the Units-tab form, not a copy of it. The full form
 * carries fields that only exist once a unit does — "Current Tenant" writes through to
 * the unit's active lease, and the status control applies transition rules relative to
 * the unit's present status. Neither has meaning before the row exists, and a copy that
 * rendered them disabled would be a worse form, not a shared one.
 *
 * Editing stays on the unit detail page, which the building's unit grid links to.
 *
 * The building is context, not a choice: it comes from the page and is shown but not
 * selectable, which is the whole point of adding from here rather than from the
 * project-wide Units tab where the building has to be re-picked.
 */
import React, { useEffect, useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Select, SelectItem, Switch, addToast,
} from '@heroui/react';
import { useCreateUnit, useCustomOptions } from '../hooks/useApi';

const EMPTY = {
  unitNumber: '', unitType: 'RETAIL', sqft: '', status: 'AVAILABLE',
  askingRent: '', askingPrice: '', notes: '', primeOwned: 'false',
};

function errMsg(err: any, fallback: string): string {
  const m = err?.response?.data?.message;
  if (Array.isArray(m)) return m[0] ?? fallback;
  if (typeof m === 'string') return m;
  return err?.message ?? fallback;
}

export function AddUnitModal({ isOpen, onClose, building, onCreated }: {
  isOpen: boolean;
  onClose: () => void;
  building: { id: string; name: string };
  onCreated?: (unit: any) => void;
}) {
  const createUnit = useCreateUnit();
  const { data: unitTypeOpts = [] } = useCustomOptions('unit_type');
  const { data: unitStatusOpts = [] } = useCustomOptions('unit_status');

  const [form, setForm] = useState({ ...EMPTY });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setForm({ ...EMPTY });
    setErrors({});
  }, [isOpen]);

  const set = (field: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.unitNumber.trim()) errs.unitNumber = 'Unit number is required';
    else if (form.unitNumber.length > 40) errs.unitNumber = 'Max 40 characters';
    if (form.sqft) {
      const v = parseInt(form.sqft);
      if (isNaN(v) || v < 1) errs.sqft = 'Must be a positive whole number';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    try {
      const unit = await createUnit.mutateAsync({
        buildingId: building.id,
        unitNumber: form.unitNumber.trim(),
        unitType: form.unitType,
        status: form.status,
        sqft: form.sqft ? parseInt(form.sqft) : undefined,
        askingRent: form.askingRent ? parseFloat(form.askingRent) : undefined,
        askingPrice: form.askingPrice ? parseFloat(form.askingPrice) : undefined,
        primeOwned: form.primeOwned === 'true',
        notes: form.notes.trim() || undefined,
      });
      addToast({ title: `Unit ${form.unitNumber.trim()} added`, color: 'success' });
      onCreated?.(unit);
      onClose();
    } catch (e: any) {
      // A duplicate unit number is the common failure and it is about ONE field, so it
      // belongs on that field rather than in a toast the user has to map back themselves.
      const msg = errMsg(e, 'Failed to add unit');
      if (/already exists/i.test(msg)) setErrors({ unitNumber: msg });
      else addToast({ title: msg, color: 'danger' });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-0.5">
          <span>Add unit</span>
          <span className="text-xs font-normal text-gray-500">in {building.name}</span>
        </ModalHeader>
        <ModalBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              size="sm" label="Unit Number" isRequired autoFocus
              value={form.unitNumber}
              onChange={(e) => { set('unitNumber')(e); if (errors.unitNumber) setErrors({}); }}
              isInvalid={!!errors.unitNumber} errorMessage={errors.unitNumber}
            />
            <Select
              size="sm" label="Unit Type"
              selectedKeys={form.unitType ? [form.unitType] : []}
              onSelectionChange={(k) => {
                const v = Array.from(k)[0] as string;
                if (v) setForm((f) => ({ ...f, unitType: v }));
              }}
            >
              {(unitTypeOpts as any[]).map((o) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
            <Input
              size="sm" label="Sqft" type="number" min={1}
              value={form.sqft} onChange={set('sqft')}
              isInvalid={!!errors.sqft} errorMessage={errors.sqft}
            />
            <Select
              size="sm" label="Status"
              selectedKeys={form.status ? [form.status] : []}
              onSelectionChange={(k) => {
                const v = Array.from(k)[0] as string;
                if (v) setForm((f) => ({ ...f, status: v }));
              }}
            >
              {(unitStatusOpts as any[]).map((o) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
            <Input
              size="sm" label="Asking Rent ($/mo)" type="number" min={0}
              value={form.askingRent} onChange={set('askingRent')}
            />
            <Input
              size="sm" label="Asking Price ($)" type="number" min={0}
              value={form.askingPrice} onChange={set('askingPrice')}
            />
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                size="sm"
                isSelected={form.primeOwned === 'true'}
                onValueChange={(v) => setForm((f) => ({ ...f, primeOwned: v ? 'true' : 'false' }))}
              />
              <span className="text-sm">Prime Developer Owned</span>
            </div>
            <Input
              size="sm" label="Notes" className="sm:col-span-2"
              value={form.notes} onChange={set('notes')}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button size="sm" color="primary" onPress={handleSave} isLoading={createUnit.isPending}>
            Add unit
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
