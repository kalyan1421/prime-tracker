import { Module } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [CommentsController],
  providers: [CommentsService, AuditService],
  exports: [CommentsService],
})
export class CommentsModule {}
