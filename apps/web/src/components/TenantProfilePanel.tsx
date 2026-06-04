/**
 * TenantProfilePanel — Richer tenant info panel on a lease.
 *
 * Surfaces tenantBrand, tenantLegalName, tenantContact, and notes
 * (trading hours / design guidelines) in a clean read/edit card.
 */

import { useState } from 'react';
import {
  Button, Input, Textarea, Chip, addToast,
} from '@heroui/react';
import {
  FiEdit2, FiCheck, FiX, FiBriefcase, FiPhone,
  FiFileText, FiUser, FiClock,
} from 'react-icons/fi';
import { useUpdateLease } from '../hooks/useApi';

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

const errMsg = (err: unknown, fallback: string) => {
  const msg = (err as any)?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : typeof msg === 'string' ? msg : fallback;
};

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

  const [form, setForm] = useState({
    tenantBrand:     lease.tenantBrand     ?? '',
    tenantLegalName: lease.tenantLegalName ?? '',
    tenantContact:   lease.tenantContact   ?? '',
    businessType:    '',          // stored in notes as "businessType: Coffee Shop\n..."
    tradingHours:    '',          // stored in notes
    designNotes:     '',          // stored in notes
  });

  // Parse structured fields from notes on mount
  const parseNotes = (raw?: string) => {
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
  };

  const parsed = parseNotes(lease.notes);

  const buildNotes = () => {
    const parts: string[] = [];
    if (form.businessType) parts.push(`businessType: ${form.businessType}`);
    if (form.tradingHours) parts.push(`tradingHours: ${form.tradingHours}`);
    if (form.designNotes)  parts.push(`designNotes: ${form.designNotes}`);
    return parts.join('\n');
  };

  const handleEdit = () => {
    setForm({
      tenantBrand:     lease.tenantBrand     ?? '',
      tenantLegalName: lease.tenantLegalName ?? '',
      tenantContact:   lease.tenantContact   ?? '',
      businessType:    parsed.businessType,
      tradingHours:    parsed.tradingHours,
      designNotes:     parsed.designNotes,
    });
    setEditing(true);
  };

  const handleSave = async () => {
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
      addToast({ title: errMsg(e, 'Failed to update'), color: 'danger' });
    }
  };

  const set = (f: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [f]: e.target.value }));

  const displayBizType = parsed.businessType;
  const displayColor   = BIZ_COLOR[displayBizType] ?? BIZ_COLOR['Other'];

  // ── view mode ────────────────────────────────────────────────────────────────
  if (!editing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FiBriefcase size={14} className="text-blue-500" />
            <span className="text-sm font-semibold text-gray-700">Tenant Profile</span>
          </div>
          <Button size="sm" variant="light" startContent={<FiEdit2 size={12} />} onPress={handleEdit}>
            Edit
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* brand / DBA */}
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Brand / DBA</p>
            <p className="text-sm font-semibold text-gray-800">{lease.tenantBrand || lease.tenantName || '—'}</p>
          </div>

          {/* legal entity */}
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <FiUser size={10} /> Legal Entity
            </p>
            <p className="text-sm text-gray-700">{lease.tenantLegalName || '—'}</p>
          </div>

          {/* contact */}
          {lease.tenantContact && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1">
                <FiPhone size={10} /> Contact
              </p>
              <p className="text-sm text-gray-700">{lease.tenantContact}</p>
            </div>
          )}

          {/* business type */}
          {displayBizType && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Business Type</p>
              <Chip size="sm" className={`text-xs ${displayColor}`}>{displayBizType}</Chip>
            </div>
          )}

          {/* trading hours */}
          {parsed.tradingHours && (
            <div className="space-y-1 col-span-2 sm:col-span-1">
              <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1">
                <FiClock size={10} /> Trading Hours
              </p>
              <p className="text-sm text-gray-600">{parsed.tradingHours}</p>
            </div>
          )}
        </div>

        {/* design guidelines */}
        {parsed.designNotes && (
          <div className="space-y-1 pt-1">
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1">
              <FiFileText size={10} /> Design / Fit-out Notes
            </p>
            <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-2.5 leading-relaxed">
              {parsed.designNotes}
            </p>
          </div>
        )}

        {/* empty nudge */}
        {!lease.tenantBrand && !lease.tenantContact && !displayBizType && (
          <p className="text-xs text-gray-400 italic">
            No profile yet — click Edit to add business type, trading hours, and design guidelines.
          </p>
        )}
      </div>
    );
  }

  // ── edit mode ────────────────────────────────────────────────────────────────
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

      <div className="space-y-2.5">
        <div className="flex gap-2">
          <Input size="sm" label="Brand / DBA name" value={form.tenantBrand} onChange={set('tenantBrand')} />
          <Input size="sm" label="Legal entity (LLC name)" value={form.tenantLegalName} onChange={set('tenantLegalName')} />
        </div>
        <div className="flex gap-2">
          <Input size="sm" label="Contact (phone / email)" value={form.tenantContact} onChange={set('tenantContact')} />
          {/* business type as button group */}
          <div className="flex-1">
            <p className="text-xs text-gray-500 mb-1">Business type</p>
            <div className="flex flex-wrap gap-1">
              {BUSINESS_TYPES.map((bt) => (
                <button
                  key={bt}
                  onClick={() => setForm((p) => ({ ...p, businessType: bt }))}
                  className={`px-2 py-0.5 rounded-full text-xs transition-colors ${
                    form.businessType === bt
                      ? BIZ_COLOR[bt] + ' ring-1 ring-current font-semibold'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {bt}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Input
          size="sm" label="Trading hours"
          placeholder="e.g. Mon–Fri 8am–6pm, Sat 9am–3pm"
          value={form.tradingHours} onChange={set('tradingHours')}
        />
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
