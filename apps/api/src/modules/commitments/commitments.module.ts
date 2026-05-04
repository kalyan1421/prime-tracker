import { Module } from '@nestjs/common';
import { CommitmentsService } from './commitments.service';
import { CommitmentsController } from './commitments.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [CommitmentsController],
  providers: [CommitmentsService, AuditService],
  exports: [CommitmentsService],
})
export class CommitmentsModule {}
