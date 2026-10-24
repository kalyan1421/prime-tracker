import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { EncryptionModule } from '../../common/encryption/encryption.module';
import { AuditService } from '../../common/utils/audit.service';
import { DrawsModule } from '../draws/draws.module';

@Module({
  // DrawsModule for the legacy PATCH /loans/draws/:id/status, which now runs through the
  // draw state machine. DrawsModule does not import LoansModule, so there is no cycle.
  imports: [EncryptionModule, DrawsModule],
  controllers: [LoansController],
  providers: [LoansService, AuditService],
  exports: [LoansService],
})
export class LoansModule {}
