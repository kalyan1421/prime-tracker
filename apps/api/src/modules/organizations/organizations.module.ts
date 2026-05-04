import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { AuditService } from '../../common/utils/audit.service';

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, AuditService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
