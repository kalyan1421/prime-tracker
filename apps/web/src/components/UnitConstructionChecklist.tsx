/**
 * UnitConstructionChecklist — the fixed, ordered per-unit stage checklist (e.g.
 * "01 - Contracts" .. "22 - Final Inspection"), separate from the Task/kind=CONSTRUCTION
 * "Updates Board" (see ConstructionBoard.tsx / UnitConstructionPanel). That board is
 * ad-hoc work items with day-wise updates; this is a template-driven progress checklist
 * with its own Status + Inspection Status + Inspection Date per stage, matching the
 * client's Monday.com board shape (client-confirmed 2026-08-21 as a NEW, separate system).
 *
 * A unit with no stages yet offers "Apply template" (one-time — refused server-side if
 * the unit already has any stages) or, if the building has no template either, just
 * "Add stage" to build one from scratch.
 */
import { useMemo, useState } from 'react';
import {
  Button, Chip, Input, Select, SelectItem, Tooltip, addToast,
} from '@heroui/react';
import { FiPlus, FiTrash2, FiZap } from 'react-icons/fi';
import {
  useUnitConstructionStages, useConstructionTemplate, useApplyConstructionTemplate,
  useAddUnitConstructionStage, useUpdateConstructionStage, useDeleteConstructionStage,
  useCustomOptions, useUsers,
} from '../hooks/useApi';
import { errMsg, fmtDate } from '../utils/fmt';
import { LoadingState, EmptyState, chipColor } from './ui';

interface OptionLike { value: string; label: string; color?: string | null }

function useOptionList(category: string) {
  const { data } = useCustomOptions(category);
  return useMemo(() => (Array.isArray(data) ? (data as OptionLike[]) : []), [data]);
}

export function UnitConstructionChecklist({
  unitId,
  buildingId,
  canEdit,
}: {
  unitId: string;
  buildingId?: string;
  canEdit: boolean;
}) {
  const stagesQ = useUnitConstructionStages(unitId);
  const templateQ = useConstructionTemplate(buildingId);
  const statusOptions = useOptionList('construction_stage_status');
  const inspectionOptions = useOptionList('construction_inspection_status');
  const { data: usersData } = useUsers();
  const users: any[] = Array.isArray(usersData) ? usersData : [];

  const applyTemplate = useApplyConstructionTemplate();
  const addStage = useAddUnitConstructionStage();
  const updateStage = useUpdateConstructionStage();
  const deleteStage = useDeleteConstructionStage();

  const [addingLabel, setAddingLabel] = useState('');
  const [adding, setAdding] = useState(false);

  const stages: any[] = Array.isArray(stagesQ.data) ? stagesQ.data : [];
  const template: any[] = Array.isArray(templateQ.data) ? templateQ.data : [];

  if (stagesQ.isLoading) return <LoadingState message="Loading checklist…" />;

  const patch = async (stageId: string, data: Record<string, unknown>) => {
    try {
      await updateStage.mutateAsync({ stageId, unitId, data });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to update the stage'), color: 'danger' });
    }
  };

  const handleAdd = async () => {
    if (!addingLabel.trim()) return;
    try {
      await addStage.mutateAsync({ unitId, label: addingLabel.trim() });
      setAddingLabel('');
      setAdding(false);
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to add the stage'), color: 'danger' });
    }
  };

  const handleApplyTemplate = async () => {
    try {
      await applyTemplate.mutateAsync({ unitId });
      addToast({ title: 'Checklist created from the building template', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to apply the template'), color: 'danger' });
    }
  };

  const addStageForm = adding && (
    <div className="flex items-center gap-2">
      <Input
        size="sm" placeholder="e.g. 01 - Contracts"
        value={addingLabel}
        onChange={(e) => setAddingLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
        autoFocus
      />
      <Button size="sm" color="primary" onPress={handleAdd} isLoading={addStage.isPending}>Add</Button>
      <Button size="sm" variant="light" onPress={() => { setAdding(false); setAddingLabel(''); }}>Cancel</Button>
    </div>
  );

  if (stages.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          title="No construction checklist yet"
          message={
            template.length > 0
              ? `Copy this building's ${template.length}-stage template to start tracking this unit.`
              : "This unit's building has no template yet — add stages to start one, or set the template up from the building."
          }
          action={canEdit && !adding ? (
            <div className="flex items-center gap-2">
              {template.length > 0 && (
                <Button
                  size="sm" color="primary" startContent={<FiZap size={13} />}
                  onPress={handleApplyTemplate} isLoading={applyTemplate.isPending}
                >
                  Apply template
                </Button>
              )}
              <Button
                size="sm" variant="flat" startContent={<FiPlus size={13} />}
                onPress={() => setAdding(true)}
              >
                Add stage
              </Button>
            </div>
          ) : undefined}
        />
        {canEdit && addStageForm}
      </div>
    );
  }

  const doneCount = stages.filter((s) => s.status === 'DONE').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{doneCount} of {stages.length} stages done</span>
        {canEdit && (
          <Button size="sm" variant="light" startContent={<FiPlus size={13} />} onPress={() => setAdding(true)}>
            Add stage
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-100">
        <table className="w-full text-xs min-w-[720px]">
          <thead>
            <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide text-[11px]">
              <th className="text-left px-3 py-2 font-medium w-8">#</th>
              <th className="text-left px-3 py-2 font-medium">Subitem</th>
              <th className="text-left px-3 py-2 font-medium">Owner</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Inspection Status</th>
              <th className="text-left px-3 py-2 font-medium">Inspection Date</th>
              {canEdit && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.id} className="border-t border-gray-100">
                <td className="px-3 py-2 tabular-nums text-gray-500">{s.sortOrder + 1}</td>
                <td className="px-3 py-2 font-medium text-gray-800">{s.label}</td>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <Select
                      size="sm" aria-label="Owner" className="min-w-[140px]"
                      selectedKeys={s.ownerId ? [s.ownerId] : []}
                      onSelectionChange={(keys) => {
                        const v = (Array.from(keys)[0] as string) ?? null;
                        patch(s.id, { ownerId: v || null });
                      }}
                    >
                      {users.map((u: any) => (
                        <SelectItem key={u.id} textValue={u.name || u.email}>{u.name || u.email}</SelectItem>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-gray-600">{s.owner?.name ?? '—'}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <Select
                      size="sm" aria-label="Status" className="min-w-[130px]"
                      selectedKeys={s.status ? [s.status] : []}
                      onSelectionChange={(keys) => {
                        const v = Array.from(keys)[0] as string;
                        if (v) patch(s.id, { status: v });
                      }}
                    >
                      {statusOptions.map((o) => (
                        <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
                      ))}
                    </Select>
                  ) : (
                    <Chip size="sm" variant="flat" color={chipColor(statusOptions.find((o) => o.value === s.status)?.color)}>
                      {statusOptions.find((o) => o.value === s.status)?.label ?? s.status}
                    </Chip>
                  )}
                </td>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <Select
                      size="sm" aria-label="Inspection status" className="min-w-[130px]"
                      selectedKeys={s.inspectionStatus ? [s.inspectionStatus] : []}
                      onSelectionChange={(keys) => {
                        const v = (Array.from(keys)[0] as string) ?? null;
                        patch(s.id, { inspectionStatus: v || null });
                      }}
                    >
                      {inspectionOptions.map((o) => (
                        <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
                      ))}
                    </Select>
                  ) : (
                    s.inspectionStatus ? (
                      <Chip size="sm" variant="flat" color={chipColor(inspectionOptions.find((o) => o.value === s.inspectionStatus)?.color)}>
                        {inspectionOptions.find((o) => o.value === s.inspectionStatus)?.label ?? s.inspectionStatus}
                      </Chip>
                    ) : <span className="text-gray-500">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {canEdit ? (
                    <Input
                      size="sm" type="date" aria-label="Inspection date" className="min-w-[140px]"
                      value={s.inspectionDate ? s.inspectionDate.slice(0, 10) : ''}
                      onChange={(e) => patch(s.id, { inspectionDate: e.target.value || null })}
                    />
                  ) : (
                    <span className="text-gray-600">{s.inspectionDate ? fmtDate(s.inspectionDate) : '—'}</span>
                  )}
                </td>
                {canEdit && (
                  <td className="px-3 py-2">
                    <Tooltip content="Remove this stage" size="sm">
                      <button
                        type="button"
                        onClick={() => deleteStage.mutate({ stageId: s.id, unitId })}
                        className="text-gray-300 hover:text-red-700 transition-colors"
                      >
                        <FiTrash2 size={13} />
                      </button>
                    </Tooltip>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && addStageForm}
    </div>
  );
}
