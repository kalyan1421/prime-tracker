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
  | { type: 'interior.cancelled'; interiorProjectId: string }
  | { type: 'snag.overdue'; snagId: string; interiorProjectId: string; daysOverdue: number }
  // Phase 1 — Sale Payment Schedule
  | { type: 'salePayment.due'; salePaymentId: string; saleId: string }
  | { type: 'salePayment.paid'; salePaymentId: string; saleId: string; amount: number }
  | { type: 'salePayment.overdue'; salePaymentId: string; saleId: string; daysOverdue: number }
  // Leasing depth — rent timeline, deposits/TI, rent collection.
  // Every one carries projectId because notification routing is project-scoped:
  // leadership sees everything, everyone else only projects they're a member of.
  | { type: 'unit.sold'; unitId: string; saleId: string; projectId: string }
  | { type: 'lease.created'; leaseId: string; projectId: string; tenantName: string }
  | { type: 'lease.activated'; leaseId: string; projectId: string; tenantName: string }
  | { type: 'lease.terminated'; leaseId: string; projectId: string; tenantName: string; reason?: string }
  | { type: 'lease.rentChanged'; leaseId: string; projectId: string; from: number; to: number; effectiveAt: Date; source: 'AUTO' | 'MANUAL' }
  | { type: 'lease.freeRentEnding'; leaseId: string; projectId: string; firstPayingMonth: Date }
  | { type: 'lease.depositOutstanding'; leaseId: string; projectId: string; outstanding: number; daysLate: number }
  | { type: 'lease.tiDisbursed'; leaseId: string; projectId: string; amount: number; pending: number }
  // R27 — the Founder gate on erasing a backfilled tenancy. `projectId` may be null: the
  // request is about a record, and routing it must not depend on resolving a project.
  | {
      type: 'history.deletionRequested';
      requestId: string;
      leaseId: string;
      projectId: string | null;
      tenantName: string;
      reason: string;
      requestedById: string;
    }
  | {
      type: 'history.deletionDecided';
      requestId: string;
      leaseId: string;
      tenantName: string;
      approved: boolean;
      note?: string;
      requestedById: string;
      decidedById: string;
    }
  | { type: 'rent.overdue'; invoiceId: string; leaseId: string; projectId: string; unitId?: string; daysOverdue: number };

export type DomainEventType = DomainEvent['type'];
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;
