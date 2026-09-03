/**
 * Create a unit from the Site Tracker.
 *
 * Adding a unit used to mean leaving the board, finding the project, opening its Units tab,
 * creating there, and coming back. The board is where you notice a unit is missing, so it is
 * where the unit should be creatable.
 *
 * The checklist is seeded from the BUILDING's stage list (ConstructionChecklistService.
 * applyTemplate), so a new unit inherits whatever its building uses and is recorded on the
 * drift report as having no template provenance. Work type — the field that used to select
 * a versioned template instead — has been removed from the system entirely.
 */
import { useEffect, useState } from 'react';
import {
  Button, Input, Select, SelectItem, Switch,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, addToast,
} from '@heroui/react';
import { FiAlertTriangle } from 'react-icons/fi';
import {
  useBuildings, useCreateUnit, useCustomOptions, useApplyConstructionTemplate,
} from '../hooks/useApi';
import { errMsg } from '../utils/fmt';

export function NewUnitModal({ projects, onClose }: {
  projects: any[]; onClose: () => void;
}) {
  const createUnit = useCreateUnit();
  const applyTemplate = useApplyConstructionTemplate();
  const { data: unitTypeData } = useCustomOptions('unit_type');
  const unitTypeOpts: any[] = Array.isArray(unitTypeData) ? unitTypeData : [];

  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const { data: buildingsData } = useBuildings(projectId);
  const buildings: any[] = Array.isArray(buildingsData) ? buildingsData : [];

  const [buildingId, setBuildingId] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [unitType, setUnitType] = useState('');
  const [seedChecklist, setSeedChecklist] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // A building from the previously selected project would be silently wrong, so the choice
  // resets whenever the project changes.
  useEffect(() => { setBuildingId(''); }, [projectId]);

  const submit = async () => {
    if (!projectId) { setErr('Pick a property.'); return; }
    if (!buildingId) { setErr('Pick a building.'); return; }
    if (!unitNumber.trim()) { setErr('Give the unit a number.'); return; }
    if (!unitType) { setErr('Pick a unit type.'); return; }
    setErr(null);
    try {
      const unit: any = await createUnit.mutateAsync({
        buildingId, unitNumber: unitNumber.trim(), unitType,
      });
      if (seedChecklist) {
        // Non-fatal: a unit with no checklist is recoverable from the board, and failing
        // the whole creation over it would throw away the unit that was just made. This
        // resolves against the building's stage list, so it legitimately fails when the
        // building has none — hence a warning, not an error.
        try { await applyTemplate.mutateAsync({ unitId: unit.id }); }
        catch { addToast({ title: 'Unit created, but its checklist could not be seeded', color: 'warning' }); }
      }
      addToast({ title: `Unit ${unit.unitNumber} created`, color: 'success' });
      onClose();
    } catch (e) {
      setErr(errMsg(e, 'Could not create the unit'));
    }
  };

  return (
    <Modal isOpen onOpenChange={onClose} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">New unit</span>
          <span className="text-[11px] font-normal text-gray-500">It appears on the tracker straight away.</span>
        </ModalHeader>
        <ModalBody className="pb-2">
          {err && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <FiAlertTriangle className="mt-0.5 shrink-0" />{err}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              size="sm" label="Property" selectedKeys={projectId ? new Set([projectId]) : new Set()}
              onSelectionChange={(k) => setProjectId((Array.from(k)[0] as string) ?? '')}
            >
              {projects.map((p: any) => (
                <SelectItem key={p.id} textValue={p.name}>{p.name}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm" label="Building" isDisabled={!projectId || buildings.length === 0}
              selectedKeys={buildingId ? new Set([buildingId]) : new Set()}
              onSelectionChange={(k) => setBuildingId((Array.from(k)[0] as string) ?? '')}
            >
              {buildings.map((b: any) => (
                <SelectItem key={b.id} textValue={b.name}>{b.name}</SelectItem>
              ))}
            </Select>
            <Input size="sm" label="Unit number" value={unitNumber} onValueChange={setUnitNumber} placeholder="512" />
            <Select
              size="sm" label="Unit type" selectedKeys={unitType ? new Set([unitType]) : new Set()}
              onSelectionChange={(k) => setUnitType((Array.from(k)[0] as string) ?? '')}
            >
              {unitTypeOpts.map((o: any) => (
                <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
              ))}
            </Select>
          </div>

          <Switch size="sm" isSelected={seedChecklist} onValueChange={setSeedChecklist}>
            <span className="text-xs text-gray-600">
              Create its checklist from the building's stage list
            </span>
          </Switch>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button size="sm" color="primary" onPress={submit} isLoading={createUnit.isPending}>Create unit</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
