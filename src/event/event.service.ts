import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { PageDto } from 'common/dto/page.dto';
import { SuccessRdo } from 'common/rdo/success.rdo';
import { fillDto } from 'common/utils/fillDto';
import { PrismaService } from 'prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventRdo } from './rdo/event.rdo';
import { EventsRdo } from './rdo/events.rdo';

@Injectable()
export class EventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaService: MediaService,
    @InjectQueue('zip-processing') private readonly zipQueue: Queue
  ) {}

  async createEvent(dto: CreateEventDto): Promise<EventRdo> {
    const event = await this.prisma.event.create({
      data: dto,
    });

    return fillDto(EventRdo, event);
  }

  async processZip(zipPath: string, orderDeadline?: Date): Promise<SuccessRdo> {
    try {
      await this.zipQueue.add(
        'process-zip',
        { zipPath, orderDeadline },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );


      return fillDto(SuccessRdo, {
        success: true,
        message: 'Zip file approved and will be processed at background',
      });
    } catch (e) {
      console.error(e);
      throw new BadRequestException('Bad file');
    }
  }

  async updateEvent(id: string, dto: UpdateEventDto): Promise<EventRdo> {
    try {
      const event = await this.prisma.event.update({
        where: { id },
        data: dto,
      });

      return fillDto(EventRdo, event);
    } catch (e) {
      console.error(e);
      throw new NotFoundException('Event not found');
    }
  }

  async deleteEvent(id: string): Promise<SuccessRdo> {
    try {
      await this.prisma.event.delete({ where: { id } });

      return fillDto(SuccessRdo, { success: true });
    } catch (e) {
      console.error(e);
      throw new NotFoundException('Event not found');
    }
  }

  async fetchEvents(dto: PageDto): Promise<EventsRdo> {
    const { page = '1', limit = '15' } = dto;
    const where = {};

    const [total, events] = await Promise.all([
      this.prisma.event.count({ where }),
      this.prisma.event.findMany({
        where,
        skip: (+page - 1) * +limit,
        take: +limit,
        include: {
          flows: {
            take: 1,
            include: {
              speeches: {
                take: 1,
                include: {
                  members: {
                    take: 1,
                    include: {
                      media: {
                        take: 1,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    return fillDto(EventsRdo, {
      events: events.map((event) => ({
        ...event,
        lastPhoto: event.flows[0]?.speeches?.[0]?.members?.[0]?.media,
      })),
      total,
    });
  }

  async fetchEvent(id: string): Promise<EventRdo> {
    const where = { id };

    const event = await this.prisma.event.findUnique({
      where,
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return fillDto(EventRdo, event);
  }
}
