import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../common/events/event-bus.service';
import { SalePaymentsService } from './sale-payments.service';

/**
 * Wires the sale-payment schedule to the rest of the system via the event bus
 * (no module-to-module imports). Mirrors the DrawEventHandlers pattern.
 *
 *   milestone.completed  → stamp effectiveDueDate + flip linked installments to DUE
 *   interior.handedOver  → flip the TI (ON_HANDOVER) installment to DUE
 */
@Injectable()
export class SalePaymentEventHandlers implements OnModuleInit {
  private readonly logger = new Logger(SalePaymentEventHandlers.name);

  constructor(private bus: EventBus, private payments: SalePaymentsService) {}

  onModuleInit() {
    this.bus.on('milestone.completed', (e) => this.onMilestoneCompleted(e));
    this.bus.on('interior.handedOver', (e) => this.onInteriorHandedOver(e));
  }

  private async onMilestoneCompleted(e: { milestoneId: string; completedAt: Date }) {
    const n = await this.payments.applyMilestoneCompletion(e.milestoneId, e.completedAt);
    if (n > 0) this.logger.log(`Milestone ${e.milestoneId} completed → ${n} sale payment(s) now DUE`);
  }

  private async onInteriorHandedOver(e: { interiorProjectId: string; at: Date }) {
    const n = await this.payments.applyInteriorHandover(e.interiorProjectId, e.at);
    if (n > 0) this.logger.log(`Interior ${e.interiorProjectId} handed over → ${n} TI payment(s) now DUE`);
  }
}
