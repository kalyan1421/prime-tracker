import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageService } from '../../common/storage/storage.service';

@Module({
    imports: [PrismaModule, NotificationsModule],
    controllers: [TasksController],
    providers: [TasksService, StorageService],
    exports: [TasksService],
})
export class TasksModule { }
