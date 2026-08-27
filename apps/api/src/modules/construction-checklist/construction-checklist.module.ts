import { Module } from '@nestjs/common';
import { ConstructionChecklistService } from './construction-checklist.service';
import { ConstructionChecklistController } from './construction-checklist.controller';
import { CustomOptionsModule } from '../custom-options/custom-options.module';
import { StorageService } from '../../common/storage/storage.service';

@Module({
  imports: [CustomOptionsModule],
  controllers: [ConstructionChecklistController],
  providers: [ConstructionChecklistService, StorageService],
  exports: [ConstructionChecklistService],
})
export class ConstructionChecklistModule {}
