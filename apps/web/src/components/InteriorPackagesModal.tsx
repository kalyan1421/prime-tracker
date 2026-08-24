import { useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Chip, addToast,
} from '@heroui/react';
import { FiPlus, FiTrash2, FiPackage, FiEdit2, FiCheck, FiX } from 'react-icons/fi';
import {
  useInteriorTemplates, useCreateInteriorTemplate,
  useUpdateInteriorTemplate, useDeleteInteriorTemplate,
} from '../hooks/useApi';
import { fmt, errMsg } from '../utils/fmt';
import { useAuthStore } from '../store/authStore';
import { FormError } from './FormError';

type ItemRow = { description: string; category: string; quantity: string; unit: string; unitPrice: string };
const EMPTY_ITEM: ItemRow = { description: '', category: '', quantity: '', unit: '', unitPrice: '' };

type EditForm = { name: string; description: string; defaultRatePerSqft: string };

function TemplateCard({
  t, canEdit, onEdit, onDelete, isDeleting,
}: {
  t: any; canEdit: boolean;
  onEdit: (t: any) => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 p-3 hover:border-gray-200 transition-colors">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{t.name}</p>
        {t.description && <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <Chip size="sm" variant="flat">{t.items?.length ?? 0} BOQ items</Chip>
          {t.defaultRatePerSqft != null && (
            <Chip size="sm" variant="flat" color="primary">{fmt(Number(t.defaultRatePerSqft))}/sqft</Chip>
          )}
          {t._count?.interiorProjects > 0 && (
            <span className="text-[11px] text-gray-500">used by {t._count.interiorProjects} project{t._count.interiorProjects !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm" isIconOnly variant="light" color="default"
            aria-label="Edit package" onPress={() => onEdit(t)}
          >
            <FiEdit2 className="w-3.5 h-3.5 text-gray-400" />
          </Button>
          <Button
            size="sm" isIconOnly variant="light" color="danger"
            aria-label="Delete package" isLoading={isDeleting}
            onPress={() => onDelete(t.id)}
          >
            <FiTrash2 className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

/** Manage reusable fit-out packages + their preset BOQ lines. */
export function InteriorPackagesModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { hasPermission } = useAuthStore();
  const canEdit = hasPermission('interior:edit');
  const { data, isLoading } = useInteriorTemplates();
  const createTpl = useCreateInteriorTemplate();
  const updateTpl = useUpdateInteriorTemplate();
  const delTpl = useDeleteInteriorTemplate();
  const templates: any[] = Array.isArray(data) ? data : [];

  // ── create state ──────────────────────────────────────────────────────────
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '', defaultRatePerSqft: '' });
  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ITEM }]);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // ── edit state ────────────────────────────────────────────────────────────
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: '', description: '', defaultRatePerSqft: '' });
  const [editErr, setEditErr] = useState<string | null>(null);

  const setItem = (i: number, k: keyof ItemRow, v: string) =>
    setItems((rows) => rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  const resetCreate = () => {
    setCreateForm({ name: '', description: '', defaultRatePerSqft: '' });
    setItems([{ ...EMPTY_ITEM }]);
    setCreating(false);
    setCreateErr(null);
  };

  const openEdit = (t: any) => {
    setEditId(t.id);
    setEditForm({
      name: t.name ?? '',
      description: t.description ?? '',
      defaultRatePerSqft: t.defaultRatePerSqft != null ? String(t.defaultRatePerSqft) : '',
    });
    setEditErr(null);
    setCreating(false); // close create form if open
  };

  const cancelEdit = () => { setEditId(null); setEditErr(null); };

  const handleCreate = async () => {
    if (!createForm.name.trim()) { setCreateErr('Package name is required'); return; }
    setCreateErr(null);
    const cleanItems = items
      .filter((it) => it.description.trim())
      .map((it, i) => ({
        description: it.description.trim(),
        category: it.category.trim() || undefined,
        quantity: it.quantity ? Number(it.quantity) : undefined,
        unit: it.unit.trim() || undefined,
        unitPrice: it.unitPrice ? Number(it.unitPrice) : undefined,
        sequence: i,
      }));
    try {
      await createTpl.mutateAsync({
        name: createForm.name.trim(),
        description: createForm.description.trim() || undefined,
        defaultRatePerSqft: createForm.defaultRatePerSqft ? Number(createForm.defaultRatePerSqft) : undefined,
        items: cleanItems,
      });
      addToast({ title: 'Package created', color: 'success' });
      resetCreate();
    } catch (e) {
      setCreateErr(errMsg(e, 'Failed to create package'));
    }
  };

  const handleUpdate = async () => {
    if (!editForm.name.trim()) { setEditErr('Package name is required'); return; }
    setEditErr(null);
    try {
      await updateTpl.mutateAsync({
        id: editId!,
        data: {
          name: editForm.name.trim(),
          description: editForm.description.trim() || '',
          defaultRatePerSqft: editForm.defaultRatePerSqft ? Number(editForm.defaultRatePerSqft) : null,
        },
      });
      addToast({ title: 'Package updated', color: 'success' });
      cancelEdit();
    } catch (e) {
      setEditErr(errMsg(e, 'Failed to update package'));
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <FiPackage className="text-amber-600" /> Fit-out packages
        </ModalHeader>

        <ModalBody className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : templates.length === 0 && !creating ? (
            <p className="text-sm text-gray-500">No packages yet. Create 2–3 generic options clients can pick from.</p>
          ) : (
            <div className="space-y-2">
              {templates.map((t) =>
                editId === t.id ? (
                  // ── inline edit form ───────────────────────────────────────
                  <div key={t.id} className="rounded-xl border border-amber-100 bg-amber-50/40 p-3 space-y-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Edit package</span>
                      <div className="flex gap-1">
                        <Button size="sm" isIconOnly variant="light" aria-label="Cancel edit" onPress={cancelEdit}>
                          <FiX className="w-3.5 h-3.5 text-gray-400" />
                        </Button>
                        <Button size="sm" isIconOnly color="primary" aria-label="Save" isLoading={updateTpl.isPending} onPress={handleUpdate}>
                          <FiCheck className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <FormError message={editErr} />
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        size="sm" label="Package name" value={editForm.name}
                        onChange={(e) => { setEditForm((f) => ({ ...f, name: e.target.value })); setEditErr(null); }}
                        isInvalid={!!editErr && editErr.includes('name')}
                        className="flex-1"
                      />
                      <Input
                        size="sm" type="number" label="Rate / sqft"
                        value={editForm.defaultRatePerSqft}
                        onChange={(e) => setEditForm((f) => ({ ...f, defaultRatePerSqft: e.target.value }))}
                        className="sm:w-36"
                      />
                    </div>
                    <Input
                      size="sm" label="Description (optional)"
                      value={editForm.description}
                      onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                    />
                    <p className="text-[11px] text-gray-500">BOQ items are not changed — delete and recreate to update line items.</p>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button size="sm" variant="light" onPress={cancelEdit}>Cancel</Button>
                      <Button size="sm" color="primary" isLoading={updateTpl.isPending} onPress={handleUpdate}>
                        Save changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <TemplateCard
                    key={t.id} t={t} canEdit={canEdit}
                    onEdit={openEdit}
                    onDelete={async (id) => {
                      try { await delTpl.mutateAsync(id); addToast({ title: 'Package deleted', color: 'success' }); }
                      catch (e) { addToast({ title: errMsg(e, 'Failed to delete'), color: 'danger' }); }
                    }}
                    isDeleting={delTpl.isPending}
                  />
                ),
              )}
            </div>
          )}

          {/* ── create form ─────────────────────────────────────────────── */}
          {canEdit && (creating ? (
            <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-3">
              <FormError message={createErr} />
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  size="sm" label="Package name" placeholder="e.g. Standard Retail Fit-out"
                  value={createForm.name}
                  onChange={(e) => { setCreateForm((f) => ({ ...f, name: e.target.value })); setCreateErr(null); }}
                  isInvalid={!!createErr && createErr.includes('name')}
                  className="flex-1"
                />
                <Input
                  size="sm" type="number" label="Default rate / sqft"
                  value={createForm.defaultRatePerSqft}
                  onChange={(e) => setCreateForm((f) => ({ ...f, defaultRatePerSqft: e.target.value }))}
                  className="sm:w-40"
                />
              </div>
              <Input
                size="sm" label="Description (optional)"
                value={createForm.description}
                onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              />

              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">BOQ lines</p>
              {items.map((it, i) => (
                <div key={i} className="flex flex-wrap gap-2 items-end">
                  <Input size="sm" label="Description" placeholder="e.g. Vinyl flooring" value={it.description}
                    onChange={(e) => setItem(i, 'description', e.target.value)} className="flex-1 min-w-[140px]" />
                  <Input size="sm" label="Category" placeholder="flooring" value={it.category}
                    onChange={(e) => setItem(i, 'category', e.target.value)} className="w-28" />
                  <Input size="sm" type="number" label="Qty" value={it.quantity}
                    onChange={(e) => setItem(i, 'quantity', e.target.value)} className="w-20" />
                  <Input size="sm" label="Unit" placeholder="sqft" value={it.unit}
                    onChange={(e) => setItem(i, 'unit', e.target.value)} className="w-20" />
                  <Input size="sm" type="number" label="Unit price" value={it.unitPrice}
                    onChange={(e) => setItem(i, 'unitPrice', e.target.value)} className="w-24" />
                  <Button size="sm" isIconOnly variant="light" aria-label="Remove line"
                    onPress={() => setItems((rows) => rows.filter((_, idx) => idx !== i))}>
                    <FiTrash2 className="w-4 h-4 text-gray-400" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="light" startContent={<FiPlus />}
                onPress={() => setItems((r) => [...r, { ...EMPTY_ITEM }])}>
                Add BOQ line
              </Button>

              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="light" onPress={resetCreate}>Cancel</Button>
                <Button size="sm" color="primary" isLoading={createTpl.isPending} onPress={handleCreate}>
                  Save package
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm" variant="flat" color="primary"
              startContent={<FiPlus />}
              onPress={() => { setCreating(true); cancelEdit(); }}
              className="w-full"
            >
              + New package
            </Button>
          ))}
        </ModalBody>

        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>Close</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
