import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma.module';
import { EventController } from './event.controller';
import { EventService } from './event.service';
import { MediaModule } from '../media/media.module';
import { AuthModule } from 'src/auth/auth.module';
import { BullModule } from '@nestjs/bullmq';
import { EventZipProcessor } from './event-zip.processor';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    PrismaModule,
    MediaModule,
    AuthModule,
    BullModule.registerQueue({ name: 'zip-processing' }),
    StorageModule,
  ],
  controllers: [EventController],
  providers: [EventService, MediaModule, EventZipProcessor],
})
export class EventModule {}
