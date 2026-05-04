import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { QuickbooksService } from './quickbooks.service';
import { QuickbooksController } from './quickbooks.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { EncryptionModule } from '../../common/encryption/encryption.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, ConfigModule, EncryptionModule, AuditModule],
  controllers: [QuickbooksController],
  providers: [QuickbooksService],
  exports: [QuickbooksService],
})
export class QuickbooksModule {}
