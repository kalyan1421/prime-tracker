/**
 * TenantProfilePanel — Richer tenant info panel on a lease.
 *
 * Surfaces tenantBrand, tenantLegalName, tenantContact, and notes
 * (trading hours / design guidelines) in a clean read/edit card.
 */

import { useState } from 'react';
import {
  Button, Input, Textarea, Select, SelectItem, addToast,
} from '@heroui/react';
import {
  FiEdit2, FiCheck, FiX, FiBriefcase, FiPhone,
  FiFileText, FiClock, FiCoffee, FiShoppingBag, FiActivity,
  FiZap, FiUsers, FiScissors, FiStar, FiMoreHorizontal,
  FiPlus, FiGrid,
} from 'react-icons/fi';
import { useUpdateLease } from '../hooks/useApi';
import { errMsg } from '../utils/fmt';
import { FormError } from './FormError';

// ─── business type config ──────────────────────────────────────────────────────

const BUSINESS_TYPES: Array<{
  label: string;
  icon: React.ReactNode;
  color: string;       // selected: bg + text
  dot: string;         // view-mode dot color
}> = [
  { label: 'Coffee Shop', icon: <FiCoffee size={13} />,        color: 'bg-amber-100 text-amber-700 border-amber-300',    dot: 'bg-amber-500' },
  { label: 'Restaurant',  icon: <FiGrid size={13} />,           color: 'bg-orange-100 text-orange-700 border-orange-300', dot: 'bg-orange-500' },
  { label: 'Retail',      icon: <FiShoppingBag size={13} />,    color: 'bg-blue-100 text-blue-700 border-blue-300',       dot: 'bg-blue-500' },
  { label: 'Medical',     icon: <FiActivity size={13} />,       color: 'bg-teal-100 text-teal-700 border-teal-300',       dot: 'bg-teal-500' },
  { label: 'Gym',         icon: <FiZap size={13} />,            color: 'bg-purple-100 text-purple-700 border-purple-300', dot: 'bg-purple-500' },
  { label: 'Office',      icon: <FiBriefcase size={13} />,      color: 'bg-indigo-100 text-indigo-700 border-indigo-300', dot: 'bg-indigo-500' },
  { label: 'Co-Working',  icon: <FiUsers size={13} />,          color: 'bg-cyan-100 text-cyan-700 border-cyan-300',       dot: 'bg-cyan-500' },
  { label: 'Pharmacy',    icon: <FiPlus size={13} />,           color: 'bg-green-100 text-green-700 border-green-300',    dot: 'bg-green-500' },
  { label: 'Salon',       icon: <FiScissors size={13} />,       color: 'bg-pink-100 text-pink-700 border-pink-300',       dot: 'bg-pink-500' },
  { label: 'Event Space', icon: <FiStar size={13} />,           color: 'bg-rose-100 text-rose-700 border-rose-300',       dot: 'bg-rose-500' },
  { label: 'Other',       icon: <FiMoreHorizontal size={13} />, color: 'bg-gray-100 text-gray-600 border-gray-300',       dot: 'bg-gray-400' },
];

const BIZ_MAP = Object.fromEntries(BUSINESS_TYPES.map((b) => [b.label, b]));

// ─── trading hours presets ────────────────────────────────────────────────────

const PRESET_HOURS = [
  'Mon–Fri, 8am–5pm',
  'Mon–Fri, 9am–6pm',
  'Mon–Sat, 9am–6pm',
  'Mon–Sat, 8am–8pm',
  'Mon–Sun, 10am–9pm',
  '24/7',
];

// ─── parse / build helpers ────────────────────────────────────────────────────

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
    // tenantContact is the contact PERSON's name; email/phone are separate structured
    // fields so they can be validated and rendered as mailto:/tel: links.
    tenantContact?: string;
    tenantEmail?: string;
    tenantPhone?: string;
    notes?: string;
  };
  unitNumber?: string;
}

export function TenantProfilePanel({ lease, unitNumber }: TenantProfilePanelProps) {
  const updateLease = useUpdateLease();
  const [editing, setEditing] = useState(false);
  const [tenantErr, setTenantErr] = useState<string | null>(null);

  const [form, setForm] = useState(() => {
    const p = parseNotes(lease.notes);
    return {
      tenantBrand:     lease.tenantBrand     ?? '',
      tenantLegalName: lease.tenantLegalName ?? '',
      tenantContact:   lease.tenantContact   ?? '',
      tenantEmail:     lease.tenantEmail     ?? '',
      tenantPhone:     lease.tenantPhone     ?? '',
      businessType:    p.businessType,
      tradingHours:    p.tradingHours,
      designNotes:     p.designNotes,
    };
  });

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
      tenantEmail:     lease.tenantEmail     ?? '',
      tenantPhone:     lease.tenantPhone     ?? '',
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
          tenantEmail:     form.tenantEmail     || undefined,
          tenantPhone:     form.tenantPhone     || undefined,
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
  const bizConfig = BIZ_MAP[displayBizType];

  // ── view mode ─────────────────────────────────────────────────────────────
  if (!editing) {
    const brand = lease.tenantBrand || lease.tenantName || 'Tenant';
    const initials = brand.trim().split(/\s+/).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();
    const isEmpty = !lease.tenantBrand && !lease.tenantContact && !displayBizType;

    return (
      <div className="space-y-3">
        {unitNumber && (
          <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 mb-1">
            Unit {unitNumber}
          </span>
        )}
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
            {bizConfig && (
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border ${bizConfig.color}`}>
                {bizConfig.icon}
                {displayBizType}
              </span>
            )}
            <Button size="sm" variant="light" isIconOnly onPress={handleEdit} aria-label="Edit tenant profile">
              <FiEdit2 size={13} />
            </Button>
          </div>
        </div>

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

        {parsed.designNotes && (
          <div className="rounded-lg border border-gray-100 bg-white p-2.5">
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1 mb-1">
              <FiFileText size={10} /> Design / Fit-out Notes
            </p>
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{parsed.designNotes}</p>
          </div>
        )}

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

  // ── edit mode ─────────────────────────────────────────────────────────────
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

        <Input size="sm" label="Contact person" value={form.tenantContact} onChange={set('tenantContact')} />

        <div className="flex gap-2">
          <Input size="sm" type="email" label="Email" value={form.tenantEmail} onChange={set('tenantEmail')} />
          <Input size="sm" type="tel" label="Phone" value={form.tenantPhone} onChange={set('tenantPhone')} />
        </div>

        {/* ── Business type tiles ─────────────────────────────────────── */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Business type</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {BUSINESS_TYPES.map((bt) => {
              const selected = form.businessType === bt.label;
              return (
                <button
                  key={bt.label}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, businessType: bt.label === p.businessType ? '' : bt.label }))}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs font-medium transition-all duration-150 text-left ${
                    selected
                      ? `${bt.color} shadow-sm scale-[1.02]`
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <span className={`shrink-0 ${selected ? '' : 'text-gray-400'}`}>{bt.icon}</span>
                  <span className="truncate leading-tight">{bt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Trading hours */}
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
