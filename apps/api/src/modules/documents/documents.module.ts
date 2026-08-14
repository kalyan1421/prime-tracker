import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentRetentionService } from './document-retention.service';
import { DocumentsController } from './documents.controller';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentRetentionService, StorageService, AuditService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
