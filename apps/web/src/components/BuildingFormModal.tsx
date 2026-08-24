/**
 * Create / edit a building.
 *
 * Extracted from ProjectDetailPage's Construction tab so the building detail page can
 * reuse it rather than growing a second, subtly different form. A copy would drift the
 * moment either side gained a field — and the fields here are not cosmetic: `phase`
 * feeds the project's derived phase, and `acreage` is the figure LOT parcels are sold by.
 *
 * The cover-photo uploader travels with the form, so a page that opens this gets photo
 * upload without knowing anything about presigned URLs.
 */
import React, { useEffect, useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Select, SelectItem, addToast,
} from '@heroui/react';
import { FiPlus } from 'react-icons/fi';
import {
  useCreateBuilding, useUpdateBuilding, usePresignedUpload, useCustomOptions,
} from '../hooks/useApi';

/** LOT is a real BuildingType (raw-land parcel sold by acreage, usually no units). */
export const BUILDING_TYPES = [
  'RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE', 'INDUSTRIAL',
  'PARKING', 'AMENITY', 'RETAIL', 'OFFICE', 'LOT',
];

export const EMPTY_BUILDING = {
  name: '', llcName: '', totalSqft: '', acreage: '', stories: '',
  buildingType: '', phase: 'PRE_DEVELOPMENT', coverPhotoPath: '',
};

export type BuildingForm = typeof EMPTY_BUILDING;

function errMsg(err: any, fallback: string): string {
  const m = err?.response?.data?.message;
  if (Array.isArray(m)) return m[0] ?? fallback;
  if (typeof m === 'string') return m;
  return err?.message ?? fallback;
}

function BuildingCoverPhotoUploader({ storagePath, onChange }: {
  storagePath: string; onChange: (path: string) => void;
}) {
  const presigned = usePresignedUpload();
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string>('');

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    try {
      const { storagePath: path } = await presigned.mutateAsync({ file, category: 'buildings' });
      setPreviewSrc(objectUrl);
      onChange(path);
      addToast({ title: `Uploaded ${file.name}`, color: 'success' });
    } catch (err: any) {
      URL.revokeObjectURL(objectUrl);
      addToast({ title: err?.message || 'Upload failed', color: 'danger' });
    }
  };

  const showPreview = previewSrc || storagePath;

  return (
    <div>
      <p className="text-xs font-medium text-gray-700 mb-1.5">Cover photo</p>
      <div className="flex items-center gap-3">
        {showPreview ? (
          <div className="relative w-32 h-20 rounded border border-gray-200 overflow-hidden bg-gray-100">
            {previewSrc ? (
              <img src={previewSrc} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">Photo saved</div>
            )}
          </div>
        ) : (
          <div className="w-32 h-20 rounded border border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-500">
            No photo
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Button
            size="sm" variant="flat"
            onPress={() => fileRef.current?.click()}
            isLoading={presigned.isPending}
            startContent={<FiPlus className="text-xs" />}
          >
            {storagePath ? 'Replace' : 'Upload'}
          </Button>
          {storagePath && (
            <Button size="sm" variant="light" color="danger" onPress={() => { setPreviewSrc(''); onChange(''); }}>
              Remove
            </Button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
    </div>
  );
}

export function BuildingFormModal({
  isOpen, onClose, projectId, building, onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  /** Omit to create; pass a building row to edit it. */
  building?: any;
  onSaved?: (saved: any) => void;
}) {
  const createBuilding = useCreateBuilding();
  const updateBuilding = useUpdateBuilding();
  const { data: projectPhaseOpts = [] } = useCustomOptions('project_phase');

  const [form, setForm] = useState<BuildingForm>({ ...EMPTY_BUILDING });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const editId = building?.id as string | undefined;

  // Re-seed whenever the modal opens, so reopening after a cancel does not show the
  // abandoned edit, and switching buildings without unmounting cannot show the previous one.
  useEffect(() => {
    if (!isOpen) return;
    setFormErrors({});
    setForm(building ? {
      name: building.name ?? '',
      llcName: building.llcName ?? '',
      totalSqft: building.totalSqft != null ? String(building.totalSqft) : '',
      acreage: building.acreage != null ? String(building.acreage) : '',
      stories: building.stories != null ? String(building.stories) : '',
      buildingType: building.buildingType ?? '',
      phase: building.phase ?? 'PRE_DEVELOPMENT',
      coverPhotoPath: building.coverPhotoPath ?? '',
    } : { ...EMPTY_BUILDING });
  }, [isOpen, building]);

  const set = (field: keyof BuildingForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Building name is required';
    else if (form.name.length > 120) errs.name = 'Max 120 characters';
    if (form.totalSqft) {
      const v = parseFloat(form.totalSqft);
      if (isNaN(v) || v <= 0) errs.totalSqft = 'Must be a positive number';
    }
    if (form.stories) {
      const v = parseInt(form.stories);
      if (isNaN(v) || v < 1 || v > 200) errs.stories = 'Must be between 1 and 200';
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    try {
      const payload: Record<string, unknown> = {
        projectId,
        name: form.name.trim(),
        llcName: form.llcName.trim() || undefined,
        totalSqft: form.totalSqft ? parseFloat(form.totalSqft) : undefined,
        acreage: form.acreage ? parseFloat(form.acreage) : undefined,
        stories: form.stories ? parseInt(form.stories) : undefined,
        buildingType: form.buildingType.trim() || undefined,
        phase: form.phase || undefined,
        coverPhotoPath: form.coverPhotoPath || undefined,
      };
      let saved;
      if (editId) {
        // projectId is omitted on update — the API DTO rejects it.
        const { projectId: _omit, ...updateData } = payload;
        saved = await updateBuilding.mutateAsync({ id: editId, data: updateData });
        addToast({ title: 'Building updated', color: 'success' });
      } else {
        saved = await createBuilding.mutateAsync(payload);
        addToast({ title: 'Building created', color: 'success' });
      }
      onSaved?.(saved);
      onClose();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to save building'), color: 'danger' });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader>{editId ? 'Edit Building' : 'Add Building'}</ModalHeader>
        <ModalBody>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Input
                size="sm" label="Building Name" isRequired
                value={form.name} onChange={set('name')}
                isInvalid={!!formErrors.name} errorMessage={formErrors.name}
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                size="sm" label="LLC Name"
                placeholder="e.g. Prime Leander I LLC"
                description="Legal entity that owns this building"
                value={form.llcName} onChange={set('llcName')}
              />
            </div>
            <Select
              size="sm" label="Building Type"
              selectedKeys={form.buildingType ? [form.buildingType] : []}
              onSelectionChange={(k) => {
                const val = Array.from(k)[0] as string;
                setForm((f) => ({ ...f, buildingType: val || '' }));
              }}
            >
              {BUILDING_TYPES.map((v) => (
                <SelectItem key={v} textValue={v.replace(/_/g, ' ')}>{v.replace(/_/g, ' ')}</SelectItem>
              ))}
            </Select>
            <Input
              size="sm" label="Total Sqft" type="number" step="1"
              value={form.totalSqft} onChange={set('totalSqft')}
              isInvalid={!!formErrors.totalSqft} errorMessage={formErrors.totalSqft}
            />
            <Input
              size="sm" label="Acreage" type="number" step="0.01" min={0}
              value={form.acreage} onChange={set('acreage')}
              description="Land area — the key figure for LOT parcels"
            />
            <Input
              size="sm" label="Stories" type="number" min={1} max={200}
              value={form.stories} onChange={set('stories')}
              isInvalid={!!formErrors.stories} errorMessage={formErrors.stories}
            />
            <div className="sm:col-span-2">
              <Select
                size="sm" label="Phase"
                description="Project phase is automatically the most-advanced building"
                selectedKeys={form.phase ? [form.phase] : []}
                onSelectionChange={(k) => {
                  const val = Array.from(k)[0] as string;
                  if (val) setForm((f) => ({ ...f, phase: val }));
                }}
              >
                {(projectPhaseOpts as any[]).map((o) => (
                  <SelectItem key={o.value} textValue={o.label}>{o.label}</SelectItem>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <BuildingCoverPhotoUploader
                storagePath={form.coverPhotoPath}
                onChange={(path) => setForm((f) => ({ ...f, coverPhotoPath: path }))}
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Cancel</Button>
          <Button
            size="sm" color="primary" onPress={handleSave}
            isLoading={createBuilding.isPending || updateBuilding.isPending}
          >
            {editId ? 'Save Changes' : 'Add Building'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
