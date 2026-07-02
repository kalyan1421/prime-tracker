import { Module } from '@nestjs/common';
import { CustomOptionsService } from './custom-options.service';
import { CustomOptionsController } from './custom-options.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CustomOptionsController],
  providers: [CustomOptionsService],
  exports: [CustomOptionsService],
})
export class CustomOptionsModule {}
