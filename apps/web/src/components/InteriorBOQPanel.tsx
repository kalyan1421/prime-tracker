/**
 * InteriorBOQPanel — Bill of Quantities for an interior fit-out project.
 *
 * Shows line items (description, qty, unit, unit price, line total) with
 * a running total and an inline add form.
 */

import { useState } from 'react';
import {
  Button, Input, Select, SelectItem, addToast,
} from '@heroui/react';
import { FiPlus, FiTrash2, FiFileText } from 'react-icons/fi';
import { useAddInteriorScope, useDeleteInteriorScope } from '../hooks/useApi';
import { fmt } from '../utils/fmt';

// ─── types ────────────────────────────────────────────────────────────────────

export interface BOQItem {
  id: string;
  description: string;
  category?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
}

const UNITS = ['sqft', 'sqm', 'ea', 'hr', 'ls', 'm', 'set'];
const CATEGORIES = ['Flooring', 'Ceiling', 'Walls', 'MEP', 'Joinery', 'Furniture', 'Signage', 'Other'];

const EMPTY = { description: '', category: 'Other', qty: '', unit: 'sqft', unitPrice: '' };

const errMsg = (err: unknown, fallback: string) => {
  const msg = (err as any)?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : typeof msg === 'string' ? msg : fallback;
};

// ─── component ────────────────────────────────────────────────────────────────

export function InteriorBOQPanel({
  projectId,
  items = [],
  contractValue,
}: {
  projectId: string;
  items: BOQItem[];
  contractValue?: number;
}) {
  const addScope    = useAddInteriorScope();
  const deleteScope = useDeleteInteriorScope();

  const [adding, setAdding] = useState(false);
  const [form, setForm]     = useState(EMPTY);
  const set = (f: keyof typeof EMPTY, v: string) =>
    setForm((p) => ({ ...p, [f]: v }));

  const boqTotal = items.reduce((s, i) => s + Number(i.total), 0);
  const variance = contractValue !== undefined ? boqTotal - contractValue : undefined;

  const handleAdd = async () => {
    if (!form.description.trim()) return addToast({ title: 'Description is required', color: 'warning' });
    const qty = parseFloat(form.qty);
    const up  = parseFloat(form.unitPrice);
    if (!(qty > 0) || !(up > 0)) return addToast({ title: 'Qty and unit price must be positive', color: 'warning' });

    try {
      await addScope.mutateAsync({
        id: projectId,
        data: {
          description: form.description.trim(),
          category:    form.category,
          quantity:    qty,
          unit:        form.unit,
          unitPrice:   up,
        },
      });
      setForm(EMPTY);
      setAdding(false);
      addToast({ title: 'Line item added', color: 'success' });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to add line item'), color: 'danger' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteScope.mutateAsync({ projectId, scopeId: id });
    } catch (e) {
      addToast({ title: errMsg(e, 'Failed to delete'), color: 'danger' });
    }
  };

  const preview = (() => {
    const q = parseFloat(form.qty);
    const u = parseFloat(form.unitPrice);
    return q > 0 && u > 0 ? q * u : null;
  })();

  return (
    <div className="space-y-3">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FiFileText className="text-blue-500" size={14} />
          <span className="text-sm font-semibold text-gray-700">Bill of Quantities</span>
          {items.length > 0 && (
            <span className="text-xs text-gray-400">({items.length} items)</span>
          )}
        </div>
        <Button
          size="sm" variant="flat" color="primary"
          startContent={<FiPlus size={13} />}
          onPress={() => setAdding((v) => !v)}
        >
          Add item
        </Button>
      </div>

      {/* add form */}
      {adding && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-2.5">
          <div className="flex gap-2">
            <Input
              size="sm" label="Description" placeholder="e.g. Vinyl plank flooring"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              className="flex-[2]"
            />
            <Select
              size="sm" label="Category"
              selectedKeys={[form.category]}
              onSelectionChange={(k) => set('category', Array.from(k)[0] as string)}
              className="flex-1"
            >
              {CATEGORIES.map((c) => <SelectItem key={c}>{c}</SelectItem>)}
            </Select>
          </div>
          <div className="flex gap-2 items-end">
            <Input
              size="sm" type="number" label="Qty"
              value={form.qty} onChange={(e) => set('qty', e.target.value)}
              className="flex-1"
            />
            <Select
              size="sm" label="Unit"
              selectedKeys={[form.unit]}
              onSelectionChange={(k) => set('unit', Array.from(k)[0] as string)}
              className="flex-1"
            >
              {UNITS.map((u) => <SelectItem key={u}>{u}</SelectItem>)}
            </Select>
            <Input
              size="sm" type="number" label="Unit price ($)"
              value={form.unitPrice} onChange={(e) => set('unitPrice', e.target.value)}
              className="flex-1"
            />
            <div className="flex-1 flex flex-col justify-end">
              {preview !== null && (
                <p className="text-xs text-gray-500 mb-1.5 text-right">= {fmt(preview)}</p>
              )}
              <Button
                size="sm" color="primary" onPress={handleAdd}
                isLoading={addScope.isPending}
              >
                Add
              </Button>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm" variant="light"
              onPress={() => { setAdding(false); setForm(EMPTY); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* empty state */}
      {items.length === 0 && !adding && (
        <div className="rounded-xl border border-dashed border-gray-200 py-6 text-center">
          <FiFileText className="mx-auto mb-2 text-xl text-gray-300" />
          <p className="text-sm text-gray-400">No scope items yet.</p>
          <p className="text-xs text-gray-300 mt-0.5">Add line items to track quantities and costs.</p>
        </div>
      )}

      {/* table */}
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide text-[10px]">
                <th className="text-left px-3 py-2 font-medium">Description</th>
                <th className="text-left px-3 py-2 font-medium">Category</th>
                <th className="text-right px-3 py-2 font-medium">Qty</th>
                <th className="text-left px-2 py-2 font-medium">Unit</th>
                <th className="text-right px-3 py-2 font-medium">Unit Price</th>
                <th className="text-right px-3 py-2 font-medium">Total</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr
                  key={item.id}
                  className={`border-t border-gray-100 hover:bg-gray-50 transition-colors ${i % 2 === 1 ? 'bg-gray-50/40' : ''}`}
                >
                  <td className="px-3 py-2 text-gray-800 font-medium">{item.description}</td>
                  <td className="px-3 py-2 text-gray-400">{item.category || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{item.quantity}</td>
                  <td className="px-2 py-2 text-gray-400">{item.unit}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(item.unitPrice)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-800">{fmt(item.total)}</td>
                  <td className="px-2 py-2">
                    <Button
                      size="sm" isIconOnly variant="light" color="danger"
                      onPress={() => handleDelete(item.id)}
                      aria-label="Delete line item"
                    >
                      <FiTrash2 size={12} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50">
                <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold text-gray-600">
                  BOQ Total
                </td>
                <td className="px-3 py-2 text-right font-bold text-gray-900 tabular-nums">
                  {fmt(boqTotal)}
                </td>
                <td />
              </tr>
              {contractValue !== undefined && (
                <tr className="border-t border-gray-100 bg-white">
                  <td colSpan={5} className="px-3 py-1.5 text-right text-xs text-gray-400">
                    Contract value
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs text-gray-500 tabular-nums">
                    {fmt(contractValue)}
                  </td>
                  <td />
                </tr>
              )}
              {variance !== undefined && (
                <tr className="border-t border-gray-100 bg-white">
                  <td colSpan={5} className="px-3 py-1.5 text-right text-xs text-gray-400">
                    Variance
                  </td>
                  <td className={`px-3 py-1.5 text-right text-xs font-semibold tabular-nums ${
                    variance > 0 ? 'text-red-600' : variance < 0 ? 'text-green-600' : 'text-gray-500'
                  }`}>
                    {variance > 0 ? '+' : ''}{fmt(variance)}
                  </td>
                  <td />
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
