/**
 * ConstructionTemplateEditor — a building's default stage template for the Unit
 * Construction Checklist. Append/remove only (no reordering, no schema for it yet).
 * Changing the template never touches units that already applied it — see
 * ConstructionChecklistService.applyTemplate.
 */
import { useState } from 'react';
import { Button, Chip, Input, addToast } from '@heroui/react';
import { FiPlus } from 'react-icons/fi';
import {
  useConstructionTemplate, useAddConstructionTemplateItem, useDeleteConstructionTemplateItem,
} from '../hooks/useApi';
import { errMsg } from '../utils/fmt';
import { LoadingState } from './ui';

export function ConstructionTemplateEditor({ buildingId, canEdit }: { buildingId: string; canEdit: boolean }) {
  const templateQ = useConstructionTemplate(buildingId);
  const addItem = useAddConstructionTemplateItem();
  const deleteItem = useDeleteConstructionTemplateItem();
  const [label, setLabel] = useState('');

  const items: any[] = Array.isArray(templateQ.data) ? templateQ.data : [];

  if (templateQ.isLoading) return <LoadingState message="Loading template…" />;

  const handleAdd = async () => {
    if (!label.trim()) return;
    try {
      await addItem.mutateAsync({ buildingId, label: label.trim() });
      setLabel('');
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to add the stage'), color: 'danger' });
    }
  };

  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">
          No template stages yet. Units under this building will start with an empty
          checklist until stages are added here.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((t) => (
            <Chip
              key={t.id}
              size="sm"
              variant="flat"
              onClose={canEdit ? () => deleteItem.mutate({ templateItemId: t.id, buildingId }) : undefined}
            >
              {t.sortOrder + 1}. {t.label}
            </Chip>
          ))}
        </div>
      )}
      {canEdit && (
        <div className="flex items-center gap-2 pt-1">
          <Input
            size="sm" placeholder="e.g. 01 - Contracts"
            value={label} onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          />
          <Button size="sm" variant="flat" startContent={<FiPlus size={13} />} onPress={handleAdd} isLoading={addItem.isPending}>
            Add stage
          </Button>
        </div>
      )}
    </div>
  );
}
