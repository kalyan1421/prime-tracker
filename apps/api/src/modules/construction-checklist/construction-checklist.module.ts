import { Module } from '@nestjs/common';
import { ConstructionChecklistService } from './construction-checklist.service';
import { ConstructionChecklistController } from './construction-checklist.controller';

@Module({
  controllers: [ConstructionChecklistController],
  providers: [ConstructionChecklistService],
  exports: [ConstructionChecklistService],
})
export class ConstructionChecklistModule {}
