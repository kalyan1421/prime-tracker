import { Module } from '@nestjs/common';
import { UpdateBoardService } from './update-board.service';
import { UpdateBoardController } from './update-board.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
    imports: [PrismaModule, NotificationsModule],
    controllers: [UpdateBoardController],
    providers: [UpdateBoardService, StorageService],
    exports: [UpdateBoardService],
})
export class UpdateBoardModule { }
