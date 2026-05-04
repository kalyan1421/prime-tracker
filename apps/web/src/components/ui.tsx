import React from 'react';
import { Card, CardBody, Chip, Progress, Spinner, Button } from '@heroui/react';
import { useAuthStore } from '../store/authStore';

// ---- Currency / Number Formatting ----
export function fmt(n: number | null | undefined): string {
  if (n == null) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null) return '0%';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---- Stat Card ----
export function StatCard({
  label, value, helpText, trend, colorScheme = 'gray', variant,
}: {
  label: string;
  value: string;
  helpText?: string;
  trend?: 'increase' | 'decrease';
  colorScheme?: string;
  variant?: 'construction' | 'revenue' | 'neutral' | 'marketing';
}) {
  const colorMap: Record<string, string> = {
    brand: 'text-blue-600',
    blue: 'text-blue-600',
    green: 'text-green-600',
    orange: 'text-orange-600',
    purple: 'text-purple-600',
    red: 'text-red-600',
    gray: 'text-gray-600',
    cyan: 'text-cyan-600',
    teal: 'text-teal-600',
  };

  const variantClass = variant === 'construction'
    ? 'bg-amber-50 border border-amber-100'
    : variant === 'revenue'
    ? 'bg-blue-50 border border-blue-100'
    : variant === 'marketing'
    ? 'bg-purple-50 border border-purple-100'
    : 'border border-gray-100';

  return (
    <Card shadow="sm" className={variantClass}>
      <CardBody className="p-5">
        <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
        <p className={`text-2xl font-semibold ${colorMap[colorScheme] || 'text-gray-600'}`}>{value}</p>
        {helpText && (
          <p className="text-sm text-gray-500 mt-1">
            {trend === 'increase' && <span className="text-green-500">&#9650; </span>}
            {trend === 'decrease' && <span className="text-red-500">&#9660; </span>}
            {helpText}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

// ---- Status Badge ----
const STATUS_COLORS: Record<string, 'success' | 'primary' | 'warning' | 'danger' | 'secondary' | 'default'> = {
  ACTIVE: 'success', COMPLETED: 'primary', ON_HOLD: 'warning', CANCELLED: 'danger',
  AVAILABLE: 'default', UNDER_CONTRACT: 'warning', LEASED: 'success', SOLD: 'primary',
  OCCUPIED: 'success', UNDER_CONSTRUCTION: 'warning',
  NOT_STARTED: 'default', IN_PROGRESS: 'primary', OVERDUE: 'danger', BLOCKED: 'danger',
  DRAFT: 'default', EXPIRED: 'danger', TERMINATED: 'danger',
  PROSPECT: 'default', LOI_SIGNED: 'warning', CLOSED: 'success',
  SYNCED: 'success', PENDING: 'warning', ERROR: 'danger', UNMAPPED: 'warning',
  PRE_DEVELOPMENT: 'secondary', PERMITTING: 'warning', CONSTRUCTION: 'primary',
  LEASE_UP: 'success', STABILIZED: 'success', SOLD_REFI: 'primary',
  CRITICAL: 'danger', HIGH: 'warning', MEDIUM: 'warning', LOW: 'primary',
  CREATE: 'success', UPDATE: 'primary', DELETE: 'danger', LOGIN: 'success',
  LOGOUT: 'default', MFA_VERIFY: 'secondary', QB_SYNC: 'primary', ROLE_CHANGE: 'warning',
  RESIDENTIAL: 'primary', COMMERCIAL: 'success', MIXED_USE: 'secondary', INDUSTRIAL: 'warning',
  RETAIL: 'primary', MEDICAL: 'success', FLEX: 'secondary', RESIDENTIAL_LOT: 'primary',
  OFFICE: 'default', RESTAURANT: 'warning', EVENT_CENTER: 'secondary',
  BRIDGE: 'warning', MEZZANINE: 'secondary', SBA: 'primary', PERMANENT: 'success',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Chip
      size="sm"
      variant="flat"
      color={STATUS_COLORS[status] || 'default'}
    >
      {status.replace(/_/g, ' ')}
    </Chip>
  );
}

// ---- Phase Progress Bar ----
const PHASES = ['PRE_DEVELOPMENT', 'PERMITTING', 'CONSTRUCTION', 'LEASE_UP', 'STABILIZED', 'SOLD_REFI'];

export function PhaseProgress({ current }: { current: string }) {
  const idx = PHASES.indexOf(current);
  return (
    <div className="flex gap-1 items-center">
      {PHASES.map((phase, i) => (
        <div
          key={phase}
          className={`h-1.5 flex-1 rounded-full ${i <= idx ? 'bg-blue-500' : 'bg-gray-200'}`}
          title={phase.replace(/_/g, ' ')}
        />
      ))}
    </div>
  );
}

// ---- Permission Gate ----
export function PermissionGate({
  permission, children, fallback = null,
}: {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { hasPermission } = useAuthStore();
  return hasPermission(permission) ? <>{children}</> : <>{fallback}</>;
}

// ---- Loading / Error States ----
export function LoadingState({ message = 'Loading\u2026' }: { message?: string }) {
  return (
    <div className="flex justify-center py-20">
      <div className="flex flex-col items-center gap-3">
        <Spinner size="lg" color="primary" />
        <p className="text-sm text-gray-500">{message}</p>
      </div>
    </div>
  );
}

export function ErrorState({ message = 'Something went wrong' }: { message?: string }) {
  return (
    <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
      {message}
    </div>
  );
}

// ---- Empty State ----
export function EmptyState({ title, message, action }: { title?: string; message?: string; action?: React.ReactNode }) {
  return (
    <div className="flex justify-center py-16">
      <div className="flex flex-col items-center gap-2">
        {title && <p className="font-semibold text-gray-500">{title}</p>}
        {message && <p className="text-sm text-gray-400">{message}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
