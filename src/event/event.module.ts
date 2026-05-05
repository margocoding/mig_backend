import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { EventController } from './event.controller';
import { EventService } from './event.service';
import { MediaModule } from '../media/media.module';
import { AuthModule } from 'src/auth/auth.module';
import { EventZipProcessor } from './event-zip.processor';
import { BullModule } from '@nestjs/bullmq';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    PrismaModule,
    MediaModule,
    AuthModule,
    StorageModule,
    BullModule.registerQueue({ name: 'zip-processing' }),
  ],
  controllers: [EventController],
  providers: [EventService, EventZipProcessor],
})
export class EventModule {}
