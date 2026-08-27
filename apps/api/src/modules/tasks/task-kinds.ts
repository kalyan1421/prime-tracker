/** Work-item kinds. See the note on Task.kind for why they share one table.
 * Lives in its own file (not tasks.service.ts) so both the service and the DTOs can
 * import it without a service<->dto circular import. */
export const TASK_KINDS = ['TASK', 'CONSTRUCTION'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
