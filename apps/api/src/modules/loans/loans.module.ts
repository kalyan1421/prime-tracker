import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { EncryptionModule } from '../../common/encryption/encryption.module';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  imports: [EncryptionModule],
  controllers: [LoansController],
  providers: [LoansService, AuditService],
  exports: [LoansService],
})
export class LoansModule {}
