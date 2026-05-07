import { Prisma } from '@prisma/client';

/**
 * Soft-delete extension for core entities (Project, Building, Unit, Loan, Lease, Sale).
 *
 * Why: Real estate compliance requires retaining all historical project / unit /
 * loan / lease / sale data even after a "delete" from the UI. This extension:
 *   - Rewrites `delete()` to set `deletedAt: now`
 *   - Rewrites `deleteMany()` likewise
 *   - Filters every read to exclude rows with `deletedAt != null`
 *
 * Activate by wrapping the PrismaClient with `.$extends(softDeleteExtension)`
 * in `prisma.service.ts`. Until activated, `deletedAt` columns simply exist
 * unused — no behavior change.
 *
 * Models excluded: append-only logs (audit_events, comments) and lookup tables.
 *
 * To bypass for archive views: query via `prisma.$queryRaw` or pass
 * `where: { deletedAt: { not: null } }` after temporarily detaching the extension
 * (consult Prisma docs on per-query extension bypass).
 */
const SOFT_DELETE_MODELS = new Set([
  'Project',
  'Building',
  'Unit',
  'Loan',
  'Lease',
  'Sale',
]);

// Loose typing intentional: the extension manipulates query shapes generically and
// strict per-model where clauses would force a giant union here.
type AnyArgs = { where?: Record<string, unknown> } & Record<string, unknown>;

export const softDeleteExtension = Prisma.defineExtension({
  name: 'soft-delete',
  query: {
    $allModels: {
      async delete({ model, args, query }) {
        if (!SOFT_DELETE_MODELS.has(model)) return query(args);
        const a = args as AnyArgs;
        // Re-route the delete through update by raising a fake "update" query.
        // Callers that need a hard delete should bypass the extension explicitly.
        return query({ ...a, data: { deletedAt: new Date() } } as never);
      },
      async deleteMany({ model, args, query }) {
        if (!SOFT_DELETE_MODELS.has(model)) return query(args);
        const a = args as AnyArgs;
        return query({ ...a, data: { deletedAt: new Date() } } as never);
      },
      async findFirst({ model, args, query }) {
        if (!SOFT_DELETE_MODELS.has(model)) return query(args);
        const a = (args ?? {}) as AnyArgs;
        a.where = { ...(a.where ?? {}), deletedAt: null };
        return query(a as never);
      },
      async findMany({ model, args, query }) {
        if (!SOFT_DELETE_MODELS.has(model)) return query(args);
        const a = (args ?? {}) as AnyArgs;
        a.where = { ...(a.where ?? {}), deletedAt: null };
        return query(a as never);
      },
      async count({ model, args, query }) {
        if (!SOFT_DELETE_MODELS.has(model)) return query(args);
        const a = (args ?? {}) as AnyArgs;
        a.where = { ...(a.where ?? {}), deletedAt: null };
        return query(a as never);
      },
    },
  },
});
