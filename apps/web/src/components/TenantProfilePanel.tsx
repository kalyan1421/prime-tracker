/**
 * TenantProfilePanel — Richer tenant info panel on a lease.
 *
 * Surfaces tenantBrand, tenantLegalName, tenantContact, and notes
 * (trading hours / design guidelines) in a clean read/edit card.
 */

import { useState } from 'react';
import {
  Button, Input, Textarea, Chip, Select, SelectItem, addToast,
} from '@heroui/react';
import {
  FiEdit2, FiCheck, FiX, FiBriefcase, FiPhone,
  FiFileText, FiClock,
} from 'react-icons/fi';
import { useUpdateLease } from '../hooks/useApi';
import { errMsg } from '../utils/fmt';
import { FormError } from './FormError';

// ─── business type colours ────────────────────────────────────────────────────

const BUSINESS_TYPES = [
  'Coffee Shop', 'Restaurant', 'Retail', 'Medical', 'Gym',
  'Office', 'Co-Working', 'Pharmacy', 'Salon', 'Event Space', 'Other',
];

const BIZ_COLOR: Record<string, string> = {
  'Coffee Shop': 'bg-amber-100 text-amber-700',
  'Restaurant':  'bg-orange-100 text-orange-700',
  'Retail':      'bg-blue-100 text-blue-700',
  'Medical':     'bg-teal-100 text-teal-700',
  'Gym':         'bg-purple-100 text-purple-700',
  'Office':      'bg-indigo-100 text-indigo-700',
  'Co-Working':  'bg-cyan-100 text-cyan-700',
  'Pharmacy':    'bg-green-100 text-green-700',
  'Salon':       'bg-pink-100 text-pink-700',
  'Event Space': 'bg-rose-100 text-rose-700',
  'Other':       'bg-gray-100 text-gray-600',
};

// ─── trading hours presets ────────────────────────────────────────────────────

const PRESET_HOURS = [
  'Mon–Fri, 8am–5pm',
  'Mon–Fri, 9am–6pm',
  'Mon–Sat, 9am–6pm',
  'Mon–Sat, 8am–8pm',
  'Mon–Sun, 10am–9pm',
  '24/7',
];

// ─── parse / build helpers (module-level so useState lazy init can use them) ──

function parseNotes(raw?: string) {
  const lines    = (raw ?? '').split('\n');
  const extract  = (key: string) =>
    lines.find((l) => l.startsWith(`${key}: `))?.replace(`${key}: `, '') ?? '';
  const rest = lines
    .filter((l) => !l.startsWith('businessType: ') && !l.startsWith('tradingHours: ') && !l.startsWith('designNotes: '))
    .join('\n')
    .trim();
  return {
    businessType: extract('businessType'),
    tradingHours: extract('tradingHours'),
    designNotes:  extract('designNotes') || rest,
  };
}

function isCustomHours(value: string) {
  return !!value && !PRESET_HOURS.includes(value);
}

// ─── component ────────────────────────────────────────────────────────────────

interface TenantProfilePanelProps {
  lease: {
    id: string;
    projectId?: string;
    tenantName?: string;
    tenantLegalName?: string;
    tenantBrand?: string;
    tenantContact?: string;
    notes?: string;
  };
}

export function TenantProfilePanel({ lease }: TenantProfilePanelProps) {
  const updateLease = useUpdateLease();
  const [editing, setEditing] = useState(false);
  const [tenantErr, setTenantErr] = useState<string | null>(null);

  // Lazy initializer parses notes immediately so businessType/tradingHours are
  // populated from the first render — avoids pills being all-gray on open.
  const [form, setForm] = useState(() => {
    const p = parseNotes(lease.notes);
    return {
      tenantBrand:     lease.tenantBrand     ?? '',
      tenantLegalName: lease.tenantLegalName ?? '',
      tenantContact:   lease.tenantContact   ?? '',
      businessType:    p.businessType,
      tradingHours:    p.tradingHours,
      designNotes:     p.designNotes,
    };
  });

  // Tracks whether the user has selected "Custom..." mode for trading hours.
  const [customHoursMode, setCustomHoursMode] = useState(() => {
    const p = parseNotes(lease.notes);
    return isCustomHours(p.tradingHours);
  });

  const buildNotes = () => {
    const parts: string[] = [];
    if (form.businessType) parts.push(`businessType: ${form.businessType}`);
    if (form.tradingHours) parts.push(`tradingHours: ${form.tradingHours}`);
    if (form.designNotes)  parts.push(`designNotes: ${form.designNotes}`);
    return parts.join('\n');
  };

  const handleEdit = () => {
    const p = parseNotes(lease.notes);
    setForm({
      tenantBrand:     lease.tenantBrand     ?? '',
      tenantLegalName: lease.tenantLegalName ?? '',
      tenantContact:   lease.tenantContact   ?? '',
      businessType:    p.businessType,
      tradingHours:    p.tradingHours,
      designNotes:     p.designNotes,
    });
    setCustomHoursMode(isCustomHours(p.tradingHours));
    setTenantErr(null);
    setEditing(true);
  };

  const handleSave = async () => {
    setTenantErr(null);
    try {
      await updateLease.mutateAsync({
        id: lease.id,
        data: {
          tenantBrand:     form.tenantBrand     || undefined,
          tenantLegalName: form.tenantLegalName || undefined,
          tenantContact:   form.tenantContact   || undefined,
          notes:           buildNotes() || undefined,
        },
      });
      addToast({ title: 'Tenant profile updated', color: 'success' });
      setEditing(false);
    } catch (e) {
      setTenantErr(errMsg(e, 'Failed to update'));
      addToast({ title: errMsg(e, 'Failed to update'), color: 'danger' });
    }
  };

  const set = (f: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [f]: e.target.value }));

  const parsed = parseNotes(lease.notes);
  const displayBizType = parsed.businessType;
  const displayColor   = BIZ_COLOR[displayBizType] ?? BIZ_COLOR['Other'];

  // ── view mode ────────────────────────────────────────────────────────────────
  if (!editing) {
    const brand = lease.tenantBrand || lease.tenantName || 'Tenant';
    const initials = brand.trim().split(/\s+/).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();
    const isEmpty = !lease.tenantBrand && !lease.tenantContact && !displayBizType;

    return (
      <div className="space-y-3">
        {/* identity header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-xs font-bold text-white">
              {initials || <FiBriefcase size={14} />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{brand}</p>
              <p className="text-xs text-gray-400 truncate">
                {lease.tenantLegalName || 'No legal entity on file'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {displayBizType && (
              <Chip size="sm" className={`text-[11px] ${displayColor}`}>{displayBizType}</Chip>
            )}
            <Button size="sm" variant="light" isIconOnly onPress={handleEdit} aria-label="Edit tenant profile">
              <FiEdit2 size={13} />
            </Button>
          </div>
        </div>

        {/* contact + trading hours */}
        {(lease.tenantContact || parsed.tradingHours) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm">
            {lease.tenantContact && (
              <div className="flex items-center gap-2 text-gray-700">
                <FiPhone size={13} className="text-gray-400 shrink-0" />
                <span className="truncate">{lease.tenantContact}</span>
              </div>
            )}
            {parsed.tradingHours && (
              <div className="flex items-center gap-2 text-gray-700">
                <FiClock size={13} className="text-gray-400 shrink-0" />
                <span className="truncate">{parsed.tradingHours}</span>
              </div>
            )}
          </div>
        )}

        {/* design guidelines */}
        {parsed.designNotes && (
          <div className="rounded-lg border border-gray-100 bg-white p-2.5">
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1 mb-1">
              <FiFileText size={10} /> Design / Fit-out Notes
            </p>
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{parsed.designNotes}</p>
          </div>
        )}

        {/* empty nudge */}
        {isEmpty && (
          <button
            onClick={handleEdit}
            className="w-full rounded-lg border border-dashed border-gray-200 py-3 text-xs text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
          >
            No profile yet — add business type, trading hours, and design guidelines.
          </button>
        )}
      </div>
    );
  }

  // ── edit mode ────────────────────────────────────────────────────────────────
  const selectHoursKey = customHoursMode ? '__custom__' : (form.tradingHours || '');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">Edit Tenant Profile</span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="light" isIconOnly onPress={() => setEditing(false)} aria-label="Cancel">
            <FiX size={14} />
          </Button>
          <Button size="sm" color="primary" isIconOnly onPress={handleSave} isLoading={updateLease.isPending} aria-label="Save">
            <FiCheck size={14} />
          </Button>
        </div>
      </div>

      <FormError message={tenantErr} />

      <div className="space-y-2.5">
        <div className="flex gap-2">
          <Input size="sm" label="Brand / DBA name" value={form.tenantBrand} onChange={set('tenantBrand')} />
          <Input size="sm" label="Legal entity (LLC name)" value={form.tenantLegalName} onChange={set('tenantLegalName')} />
        </div>
        <div className="flex gap-2">
          <Input size="sm" label="Contact (phone / email)" value={form.tenantContact} onChange={set('tenantContact')} />
          {/* business type as button group */}
          <div className="flex-1">
            <p className="text-xs text-gray-500 mb-1.5">Business type</p>
            <div className="flex flex-wrap gap-1.5">
              {BUSINESS_TYPES.map((bt) => (
                <button
                  key={bt}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, businessType: bt === p.businessType ? '' : bt }))}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                    form.businessType === bt
                      ? `${BIZ_COLOR[bt]} border-current shadow-sm scale-105`
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {bt}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Trading hours: predefined presets or custom entry */}
        <div className="space-y-1.5">
          <Select
            size="sm"
            label="Trading hours"
            placeholder="Select hours or choose Custom…"
            selectedKeys={selectHoursKey ? [selectHoursKey] : []}
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0] as string;
              if (val === '__custom__') {
                setCustomHoursMode(true);
                // keep current tradingHours as starting text for custom input
              } else if (val) {
                setCustomHoursMode(false);
                setForm((p) => ({ ...p, tradingHours: val }));
              }
            }}
          >
            {([...PRESET_HOURS, 'Custom…'] as string[]).map((h) => (
              <SelectItem key={h === 'Custom…' ? '__custom__' : h} textValue={h}>{h}</SelectItem>
            ))}
          </Select>
          {customHoursMode && (
            <Input
              size="sm"
              placeholder="e.g. Mon–Fri 8am–6pm, Sat 9am–3pm"
              value={form.tradingHours}
              onChange={set('tradingHours')}
              startContent={<FiClock size={13} className="text-gray-400 shrink-0" />}
            />
          )}
        </div>

        <Textarea
          size="sm" label="Design / fit-out guidelines"
          placeholder="e.g. Requires 3-phase power, grease trap, ventilation to exterior…"
          value={form.designNotes} onChange={set('designNotes')}
          minRows={2}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="light" onPress={() => setEditing(false)}>Cancel</Button>
        <Button size="sm" color="primary" onPress={handleSave} isLoading={updateLease.isPending}>
          Save profile
        </Button>
      </div>
    </div>
  );
}
