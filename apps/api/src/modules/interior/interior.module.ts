import { Module } from '@nestjs/common';
import { InteriorService } from './interior.service';
import { InteriorController } from './interior.controller';
import { AuditService } from '../../common/utils/audit.service';

/**
 * Interior / Fit-Out module — the post-shell fit-out workflow (7 phases),
 * scope/BOQ, sub-contractor invoices, and snagging. Phase transitions are
 * gated by the shell-complete soft gate and document gates
 * (see interior-state-machine.ts + docs/client-discovery/TDD_Interior_and_SalePayment.md).
 *
 * SalePayment (the client-facing installment schedule coupled to this module)
 * lives under the sales module, since it is a child of Sale.
 */
@Module({
  controllers: [InteriorController],
  providers: [InteriorService, AuditService],
  exports: [InteriorService],
})
export class InteriorModule {}
