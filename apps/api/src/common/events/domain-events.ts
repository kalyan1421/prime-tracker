/**
 * Domain events — the connective tissue between feature modules.
 *
 * Why this exists: feature modules (Milestones, Draws, Budgets, Sales) need to
 * react to each other's state changes WITHOUT importing each other. A milestone
 * being completed should auto-draft a draw request — but milestones.module
 * shouldn't import draws.module (creates a circular dep). Instead, milestones
 * emits an event; a handler subscribes; loose coupling.
 *
 * Implementation: in-process emitter (Node EventEmitter) so events fire on the
 * SAME request thread before the response goes out. Async handlers (cron, queue)
 * still get triggered for follow-up work that can be deferred.
 */

export type DomainEvent =
  // Slice 4 — Units
  | { type: 'unit.becameAvailable'; unitId: string; at: Date }
  | { type: 'unit.staleAvailable'; unitId: string; days: number; projectId: string }
  // Slice 5 — Budgets
  | { type: 'budget.varianceExceeded'; projectId: string; budgetLineId: string; pct: number }
  | { type: 'budget.revisionCreated'; budgetLineId: string; revisionNumber: number; createdById: string }
  // Slice 6 — Sales
  | { type: 'sale.activityDrought'; saleId: string; days: number }
  | { type: 'sale.staleStage'; saleId: string; status: string; days: number }
  | { type: 'sale.statusChanged'; saleId: string; from: string; to: string }
  // Slice 7 — Milestones
  | { type: 'milestone.completed'; milestoneId: string; projectId: string; completedAt: Date }
  | { type: 'milestone.slipped'; milestoneId: string; oldDueDate: Date; newDueDate: Date; daysSlipped: number }
  // Slice 8 — Draws
  | { type: 'drawRequest.submitted'; drawId: string; step: string }
  | { type: 'drawRequest.approved'; drawId: string; approverId: string }
  | { type: 'drawRequest.funded'; drawId: string; loanId: string; projectId: string; amount: number }
  | { type: 'drawRequest.fundingOverdue'; drawId: string; daysOverdue: number }
  // Phase 1 — Interior / Fit-Out
  | { type: 'interior.phaseChanged'; interiorProjectId: string; from: string; to: string }
  | { type: 'interior.handedOver'; interiorProjectId: string; unitId?: string; at: Date }
  | { type: 'snag.overdue'; snagId: string; interiorProjectId: string; daysOverdue: number }
  // Phase 1 — Sale Payment Schedule
  | { type: 'salePayment.due'; salePaymentId: string; saleId: string }
  | { type: 'salePayment.paid'; salePaymentId: string; saleId: string; amount: number }
  | { type: 'salePayment.overdue'; salePaymentId: string; saleId: string; daysOverdue: number };

export type DomainEventType = DomainEvent['type'];
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;
