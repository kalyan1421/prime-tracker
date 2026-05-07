import React from 'react';
import { Card, CardBody, CardHeader, Chip } from '@heroui/react';
import { FiAlertTriangle, FiAlertCircle, FiClock } from 'react-icons/fi';

/**
 * Generic exception/alert row. Used by Dashboard ExceptionFeed and the per-project
 * Health tab. Gives every dashboard a consistent way to surface "things needing attention".
 *
 * Severity drives color and icon. The action prop is optional — many exceptions are
 * informational (lease expiring soon) rather than actionable.
 */

export type ExceptionSeverity = 'critical' | 'warning' | 'info';

export interface ExceptionItem {
  id: string;
  severity: ExceptionSeverity;
  title: string;
  detail?: string;
  meta?: string; // e.g. "Project: Trinity Square" or a date
  href?: string; // navigation target if clickable
}

const SEV_STYLES: Record<ExceptionSeverity, { className: string; Icon: React.ComponentType<any> }> = {
  critical: { className: 'bg-red-50 border-red-200 text-red-800',       Icon: FiAlertTriangle },
  warning:  { className: 'bg-amber-50 border-amber-200 text-amber-800', Icon: FiAlertCircle },
  info:     { className: 'bg-blue-50 border-blue-200 text-blue-800',    Icon: FiClock },
};

export function ExceptionRow({ item, onClick }: { item: ExceptionItem; onClick?: () => void }) {
  const { className, Icon } = SEV_STYLES[item.severity];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border ${className} hover:opacity-90 transition`}
    >
      <Icon className="mt-0.5 flex-shrink-0" size={18} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{item.title}</span>
          {item.meta && <Chip size="sm" variant="flat" className="bg-white/60">{item.meta}</Chip>}
        </div>
        {item.detail && <p className="text-sm mt-0.5 opacity-80">{item.detail}</p>}
      </div>
    </button>
  );
}

export function ExceptionFeed({
  items,
  emptyText = 'No exceptions — all clear.',
  onItemClick,
}: {
  items: ExceptionItem[];
  emptyText?: string;
  onItemClick?: (item: ExceptionItem) => void;
}) {
  return (
    <Card shadow="sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between w-full">
          <span className="font-semibold">Needs Attention</span>
          <Chip size="sm" variant="flat">{items.length}</Chip>
        </div>
      </CardHeader>
      <CardBody className="space-y-2 pt-0">
        {items.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">{emptyText}</p>
        ) : (
          items.map((item) => (
            <ExceptionRow key={item.id} item={item} onClick={() => onItemClick?.(item)} />
          ))
        )}
      </CardBody>
    </Card>
  );
}
