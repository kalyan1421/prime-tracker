import { useMemo, useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Select, SelectItem, Input, Checkbox, addToast,
} from '@heroui/react';
import { useCombineUnits } from '../hooks/useApi';

const errMsg = (err: unknown, fallback: string) => {
  const msg = (err as any)?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : typeof msg === 'string' ? msg : fallback;
};

/**
 * Combine 2+ adjacent units in one building into a single legal unit.
 * The source units are archived (history retained); a new combined unit is created.
 */
export function CombineUnitsModal({
  isOpen, onClose, units, buildings,
}: {
  isOpen: boolean;
  onClose: () => void;
  units: any[];
  buildings: any[];
}) {
  const combine = useCombineUnits();
  const [buildingId, setBuildingId] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [unitNumber, setUnitNumber] = useState('');

  // Only active (non-merged) units in the chosen building are combinable.
  const candidates = useMemo(
    () => units.filter((u) => (u.buildingId || u.building?.id) === buildingId),
    [units, buildingId],
  );
  const chosen = candidates.filter((u) => selected[u.id]);
  const suggested = chosen.map((u) => u.unitNumber).join('+');

  const reset = () => { setBuildingId(''); setSelected({}); setUnitNumber(''); };
  const close = () => { reset(); onClose(); };

  const toggle = (id: string) => setSelected((s) => ({ ...s, [id]: !s[id] }));

  const submit = async () => {
    const ids = chosen.map((u) => u.id);
    if (ids.length < 2) return addToast({ title: 'Select at least two units', color: 'warning' });
    const number = (unitNumber || suggested).trim();
    if (!number) return addToast({ title: 'Enter a number for the combined unit', color: 'warning' });
    try {
      await combine.mutateAsync({ buildingId, sourceUnitIds: ids, unitNumber: number });
      addToast({ title: `Combined ${ids.length} units into ${number}`, color: 'success' });
      close();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to combine units'), color: 'danger' });
    }
  };

  const totalSqft = chosen.reduce((s, u) => s + (u.sqft ? Number(u.sqft) : 0), 0);

  return (
    <Modal isOpen={isOpen} onClose={close} size="lg">
      <ModalContent>
        <ModalHeader>Combine units</ModalHeader>
        <ModalBody className="space-y-3">
          <p className="text-xs text-gray-500">
            Merge adjacent units into one legal unit. The originals are archived (their sales/lease history is kept)
            and a new combined unit is created.
          </p>
          <Select
            size="sm" label="Building"
            selectedKeys={buildingId ? [buildingId] : []}
            onSelectionChange={(k) => { setBuildingId((Array.from(k)[0] as string) || ''); setSelected({}); }}
          >
            {buildings.map((b: any) => <SelectItem key={b.id}>{b.name}</SelectItem>)}
          </Select>

          {buildingId && (
            <div className="rounded-lg border border-gray-100 p-2 max-h-56 overflow-y-auto space-y-1">
              {candidates.length === 0 && <p className="text-xs text-gray-400">No units in this building.</p>}
              {candidates.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                  <Checkbox isSelected={!!selected[u.id]} onValueChange={() => toggle(u.id)} />
                  <span className="font-medium">Unit {u.unitNumber}</span>
                  <span className="text-xs text-gray-400">
                    {u.unitType}{u.sqft ? ` · ${u.sqft} sqft` : ''} · {u.status}
                  </span>
                </label>
              ))}
            </div>
          )}

          {chosen.length >= 2 && (
            <>
              <Input
                size="sm" label="Combined unit number"
                value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)}
                placeholder={suggested}
                description={`Must be distinct from existing units. Combined area ≈ ${totalSqft || '—'} sqft`}
              />
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={close}>Cancel</Button>
          <Button color="primary" onPress={submit} isLoading={combine.isPending} isDisabled={chosen.length < 2}>
            Combine {chosen.length > 0 ? `(${chosen.length})` : ''}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
