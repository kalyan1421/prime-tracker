import { Module } from '@nestjs/common';
import { ExceptionsService } from './exceptions.service';
import { ExceptionsController } from './exceptions.controller';
import { UnitStatusEventService } from '../../common/utils/unit-status-event.service';

@Module({
  controllers: [ExceptionsController],
  providers: [ExceptionsService, UnitStatusEventService],
  exports: [ExceptionsService],
})
export class ExceptionsModule {}
