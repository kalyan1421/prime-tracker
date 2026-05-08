import React, { useState } from 'react';
import { Card, CardBody, CardHeader, Chip, Button } from '@heroui/react';
import { FiAlertTriangle, FiAlertCircle, FiClock, FiChevronDown, FiChevronUp } from 'react-icons/fi';

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
  critical: { className: 'bg-red-50 border-red-200 text-red-800', Icon: FiAlertTriangle },
  warning: { className: 'bg-amber-50 border-amber-200 text-amber-800', Icon: FiAlertCircle },
  info: { className: 'bg-blue-50 border-blue-200 text-blue-800', Icon: FiClock },
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
  const [isExpanded, setIsExpanded] = useState(false);
  const limit = 5;
  const showMoreButton = items.length > limit;
  const visibleItems = isExpanded ? items : items.slice(0, limit);

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
          <>
            {visibleItems.map((item) => (
              <ExceptionRow key={item.id} item={item} onClick={() => onItemClick?.(item)} />
            ))}
            {showMoreButton && (
              <Button
                variant="light"
                size="sm"
                className="w-full mt-2 text-gray-500"
                onPress={() => setIsExpanded(!isExpanded)}
                endContent={isExpanded ? <FiChevronUp /> : <FiChevronDown />}
              >
                {isExpanded ? 'Show Less' : `View All (${items.length})`}
              </Button>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
