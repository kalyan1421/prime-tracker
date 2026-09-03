/**
 * ConstructionTemplateEditor — a building's default stage template for the Unit
 * Construction Checklist. Append/remove only (no reordering, no schema for it yet).
 * Changing the template never touches units that already applied it — see
 * ConstructionChecklistService.applyTemplate.
 */
import { useState } from 'react';
import { Button, Chip, Select, SelectItem, addToast } from '@heroui/react';
import { FiPlus } from 'react-icons/fi';
import {
  useConstructionTemplate, useAddConstructionTemplateItem, useDeleteConstructionTemplateItem,
  useStageCatalogue,
} from '../hooks/useApi';
import { errMsg } from '../utils/fmt';
import { LoadingState } from './ui';

export function ConstructionTemplateEditor({ buildingId, canEdit }: { buildingId: string; canEdit: boolean }) {
  const templateQ = useConstructionTemplate(buildingId);
  const addItem = useAddConstructionTemplateItem();
  const deleteItem = useDeleteConstructionTemplateItem();
  const [label, setLabel] = useState('');

  // Picked from the same catalogue the checklist picks from. A template that could invent
  // its own wording would put names on units that no picker offers and no report groups —
  // the template is a SUBSET of the standard stages, not a second list of them.
  const catalogueQ = useStageCatalogue();
  const catalogue: any[] = Array.isArray(catalogueQ.data) ? catalogueQ.data : [];

  const items: any[] = Array.isArray(templateQ.data) ? templateQ.data : [];
  const taken = new Set(items.map((t) => String(t.label).trim().toLowerCase()));
  const available = catalogue.filter((o) => !taken.has(String(o.label).trim().toLowerCase()));

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
        <p className="text-xs text-gray-500">
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
          <Select
            size="sm" aria-label="Stage to add to this template"
            placeholder={available.length === 0 ? 'Every stage is already here' : 'Pick a stage'}
            isDisabled={available.length === 0}
            selectedKeys={label ? [label] : []}
            onChange={(e) => setLabel(e.target.value)}
          >
            {available.map((o: any) => (
              <SelectItem key={o.label} textValue={o.label}>{o.label}</SelectItem>
            ))}
          </Select>
          <Button
            size="sm" variant="flat" startContent={<FiPlus size={13} />}
            onPress={handleAdd} isLoading={addItem.isPending} isDisabled={!label}
          >
            Add stage
          </Button>
        </div>
      )}
    </div>
  );
}
