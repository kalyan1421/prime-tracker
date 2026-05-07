import React from 'react';
import { Chip } from '@heroui/react';

/**
 * Single source of truth for comment-type styling. Used on Dashboard, Project Comments tab,
 * Unit comment modal, and Unit Detail thread. Change colors here to update everywhere.
 *
 * Sort order convention: MARKETING → SALES → FINANCIAL, then createdAt desc within each group.
 */

export type CommentType = 'MARKETING' | 'SALES' | 'FINANCIAL';

const STYLES: Record<CommentType, { label: string; className: string }> = {
  MARKETING: { label: 'Marketing', className: 'bg-purple-100 text-purple-700' },
  SALES:     { label: 'Sales',     className: 'bg-blue-100 text-blue-700' },
  FINANCIAL: { label: 'Financial', className: 'bg-green-100 text-green-700' },
};

export const COMMENT_TYPE_ORDER: CommentType[] = ['MARKETING', 'SALES', 'FINANCIAL'];

export function CommentChip({ type, size = 'sm' }: { type: CommentType; size?: 'sm' | 'md' }) {
  const s = STYLES[type] ?? STYLES.MARKETING;
  return (
    <Chip size={size} className={s.className} variant="flat">
      {s.label}
    </Chip>
  );
}

/** Sort an array of comment-like objects by type-then-recency. */
export function sortByCommentType<T extends { commentType?: CommentType; createdAt?: string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const ai = COMMENT_TYPE_ORDER.indexOf(a.commentType ?? 'MARKETING');
    const bi = COMMENT_TYPE_ORDER.indexOf(b.commentType ?? 'MARKETING');
    if (ai !== bi) return ai - bi;
    return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
  });
}
