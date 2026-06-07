import { useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Chip, addToast,
} from '@heroui/react';
import { FiPlus, FiTrash2, FiPackage } from 'react-icons/fi';
import { useInteriorTemplates, useCreateInteriorTemplate, useDeleteInteriorTemplate } from '../hooks/useApi';
import { fmt } from './ui';
import { useAuthStore } from '../store/authStore';

const errMsg = (err: unknown, fallback: string) => {
  const msg = (err as any)?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : typeof msg === 'string' ? msg : fallback;
};

type ItemRow = { description: string; category: string; quantity: string; unit: string; unitPrice: string };
const EMPTY_ITEM: ItemRow = { description: '', category: '', quantity: '', unit: '', unitPrice: '' };

/** Manage reusable fit-out packages (the "2-3 generic options") + their preset BOQ lines. */
export function InteriorPackagesModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { hasPermission } = useAuthStore();
  const canEdit = hasPermission('interior:edit');
  const { data, isLoading } = useInteriorTemplates();
  const createTpl = useCreateInteriorTemplate();
  const delTpl = useDeleteInteriorTemplate();
  const templates: any[] = Array.isArray(data) ? data : [];

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', defaultRatePerSqft: '' });
  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ITEM }]);

  const setItem = (i: number, k: keyof ItemRow, v: string) =>
    setItems((rows) => rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  const reset = () => { setForm({ name: '', description: '', defaultRatePerSqft: '' }); setItems([{ ...EMPTY_ITEM }]); setCreating(false); };

  const submit = async () => {
    if (!form.name.trim()) return addToast({ title: 'Package name is required', color: 'warning' });
    const cleanItems = items
      .filter((it) => it.description.trim())
      .map((it) => ({
        description: it.description.trim(),
        category: it.category.trim() || undefined,
        quantity: it.quantity ? Number(it.quantity) : undefined,
        unit: it.unit.trim() || undefined,
        unitPrice: it.unitPrice ? Number(it.unitPrice) : undefined,
      }));
    try {
      await createTpl.mutateAsync({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        defaultRatePerSqft: form.defaultRatePerSqft ? Number(form.defaultRatePerSqft) : undefined,
        items: cleanItems,
      });
      addToast({ title: 'Package created', color: 'success' });
      reset();
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to create package'), color: 'danger' });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2"><FiPackage className="text-amber-600" /> Fit-out packages</ModalHeader>
        <ModalBody className="space-y-4">
          {/* Existing templates */}
          {isLoading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-gray-400">No packages yet. Create 2-3 generic options clients can pick from.</p>
          ) : (
            <div className="space-y-2">
              {templates.map((t) => (
                <div key={t.id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{t.name}</p>
                    {t.description && <p className="text-xs text-gray-500">{t.description}</p>}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Chip size="sm" variant="flat">{t.items?.length ?? 0} BOQ items</Chip>
                      {t.defaultRatePerSqft != null && <Chip size="sm" variant="flat" color="primary">{fmt(Number(t.defaultRatePerSqft))}/sqft</Chip>}
                      {t._count?.interiorProjects > 0 && <span className="text-[11px] text-gray-400">used by {t._count.interiorProjects}</span>}
                    </div>
                  </div>
                  {canEdit && (
                    <Button size="sm" isIconOnly variant="light" color="danger" aria-label="Delete package"
                      isLoading={delTpl.isPending}
                      onPress={async () => {
                        try { await delTpl.mutateAsync(t.id); addToast({ title: 'Package deleted', color: 'success' }); }
                        catch (e) { addToast({ title: errMsg(e, 'Failed to delete'), color: 'danger' }); }
                      }}>
                      <FiTrash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Create form */}
          {canEdit && (creating ? (
            <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <Input size="sm" label="Package name" placeholder="e.g. Standard Retail Fit-out" value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="flex-1" />
                <Input size="sm" type="number" label="Default rate / sqft" value={form.defaultRatePerSqft}
                  onChange={(e) => setForm((f) => ({ ...f, defaultRatePerSqft: e.target.value }))} className="sm:w-40" />
              </div>
              <Input size="sm" label="Description (optional)" value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />

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
              <Button size="sm" variant="light" startContent={<FiPlus />} onPress={() => setItems((r) => [...r, { ...EMPTY_ITEM }])}>
                Add BOQ line
              </Button>

              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="light" onPress={reset}>Cancel</Button>
                <Button size="sm" color="primary" isLoading={createTpl.isPending} onPress={submit}>Save package</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="flat" color="primary" startContent={<FiPlus />} onPress={() => setCreating(true)}>
              New package
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
