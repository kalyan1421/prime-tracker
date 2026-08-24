import React from 'react';
import { Card, CardBody, Chip, Progress, Spinner, Button } from '@heroui/react';
import { FiArrowRight } from 'react-icons/fi';
import { useAuthStore } from '../store/authStore';

// ---- Stat Card ----
export function StatCard({
  label, value, helpText, trend, colorScheme = 'gray', variant, onClick,
}: {
  label: string;
  value: string;
  helpText?: string;
  trend?: 'increase' | 'decrease';
  colorScheme?: string;
  variant?: 'construction' | 'revenue' | 'neutral' | 'marketing';
  /** When provided, the card becomes clickable and navigates/acts on press. */
  onClick?: () => void;
}) {
  // -700 rather than -600: these sit on the tinted variant backgrounds below
  // (bg-blue-50 / bg-amber-50 / bg-purple-50), where the -600 shades measured 2.96:1
  // against a 3.0 requirement. Same hue, same meaning, one step darker.
  const colorMap: Record<string, string> = {
    brand: 'text-blue-700',
    blue: 'text-blue-700',
    green: 'text-green-700',
    orange: 'text-orange-700',
    purple: 'text-purple-700',
    red: 'text-red-700',
    gray: 'text-gray-700',
    cyan: 'text-cyan-700',
    teal: 'text-teal-700',
  };

  const variantClass = variant === 'construction'
    ? 'bg-amber-50 border border-amber-100'
    : variant === 'revenue'
    ? 'bg-blue-50 border border-blue-100'
    : variant === 'marketing'
    ? 'bg-purple-50 border border-purple-100'
    : 'border border-gray-100';

  const clickable = !!onClick;
  return (
    <Card
      shadow="sm"
      isPressable={clickable}
      onPress={onClick}
      className={`${variantClass} ${clickable ? 'w-full text-left transition-shadow hover:shadow-md cursor-pointer' : ''}`}
    >
      <CardBody className="p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-gray-600">{label}</p>
          {clickable && <FiArrowRight className="text-gray-300 shrink-0 mt-0.5" aria-hidden />}
        </div>
        <p className={`text-2xl font-semibold ${colorMap[colorScheme] || 'text-gray-700'}`}>{value}</p>
        {helpText && (
          <p className="text-sm text-gray-600 mt-1">
            {/* -700, not -500. These glyphs are text, and they are the only thing
                distinguishing "up" from "down" — at -500 they measured 2.04:1. */}
            {trend === 'increase' && <span className="text-green-700">&#9650; </span>}
            {trend === 'decrease' && <span className="text-red-700">&#9660; </span>}
            {helpText}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

// ---- Status Badge ----
export const STATUS_COLORS: Record<string, 'success' | 'primary' | 'warning' | 'danger' | 'secondary' | 'default'> = {
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
        {message && <p className="text-sm text-gray-500">{message}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

// ---- Pagination footer ----
// One canonical "Previous / Page X of Y / Next" control, paired with the usePagination hook.
export function Pagination({
  page, totalPages, onPrev, onNext, total, pageSize, itemLabel = 'items',
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  total: number;
  pageSize: number;
  itemLabel?: string;
}) {
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-t border-gray-100">
      <span className="text-xs text-gray-500">
        {start}–{end} of {total} {itemLabel}
      </span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="flat" isDisabled={page === 1} onPress={onPrev}>Previous</Button>
        <span className="text-xs text-gray-500 px-2 tabular-nums">Page {page} / {totalPages}</span>
        <Button size="sm" variant="flat" isDisabled={page === totalPages} onPress={onNext}>Next</Button>
      </div>
    </div>
  );
}

// ---- Shared HeroUI color-token normalizer ----
// Validates a CustomOption.color string against HeroUI's known chip/progress colors,
// falling back to 'default' for anything unrecognized (a relabeled/custom token, null,
// or a stale value). One canonical copy — every status/priority chip in the app should
// read its color through this instead of hand-rolling the same 6-item allowlist.
export type HeroColor = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
const HERO_COLORS: HeroColor[] = ['default', 'primary', 'secondary', 'success', 'warning', 'danger'];
export function chipColor(color?: string | null): HeroColor {
  return (HERO_COLORS as string[]).includes(color ?? '') ? (color as HeroColor) : 'default';
}
