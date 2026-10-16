import { ForbiddenException } from '@nestjs/common';

/** Who is asking to delete — the creator check needs both halves. */
export interface DeleteActor {
  userId: string;
  permissions: string[];
}

/**
 * The Site Tracker delete rule (client, 2026-10-16: "delete — owner, founder, super admin").
 *
 * You may delete what you created — your update, a photo you uploaded, a stage you added.
 * Deleting anybody else's needs `siteTracker:manage`, which only SUPER_ADMIN and FOUNDER
 * hold. Before this, anyone holding dailylog:edit or checklist:edit could delete anyone's
 * work with one click.
 *
 * `actor` is optional so internal callers (imports, cascades) are not subject to it; every
 * HTTP route passes one.
 */
export function assertMayDelete(actor: DeleteActor | undefined, ownerId: string | null | undefined, what: string) {
  if (!actor) return;
  if (ownerId && ownerId === actor.userId) return;
  if (actor.permissions?.includes('siteTracker:manage')) return;
  throw new ForbiddenException(`Only the person who added this ${what}, a Founder or a Super Admin can delete it.`);
}
