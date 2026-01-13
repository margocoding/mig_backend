import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { EventService } from './event.service';
import { CreateEventDto } from './dto/create-event.dto';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { EventRdo } from './rdo/event.rdo';
import { PageDto } from 'common/dto/page.dto';
import { EventsRdo } from './rdo/events.rdo';
import { UpdateEventDto } from './dto/update-event.dto';
import { SuccessRdo } from 'common/rdo/success.rdo';
import { AuthJwtGuard } from 'src/auth/auth.guard';
import { AdminGuard } from '../user/admin.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import path from 'path';
import { diskStorage } from 'multer';
import { fillDto } from 'common/utils/fillDto';
import { ProcessEventZipDto } from './dto/process-event-zip.dto';

@Controller('event')
export class EventController {
  constructor(private readonly eventService: EventService) {}

  @ApiOperation({ summary: 'Create an event' })
  @ApiOkResponse({ type: EventRdo })
  @UseGuards(AuthJwtGuard, AdminGuard)
  @Post('/')
  createEvent(@Body() dto: CreateEventDto): Promise<EventRdo> {
    return this.eventService.createEvent(dto);
  }

  @ApiOperation({ summary: 'Get event by id' })
  @ApiOkResponse({ type: EventRdo })
  @Get('/:id')
  getEvent(@Param('id') id: string): Promise<EventRdo> {
    return this.eventService.fetchEvent(id);
  }

  @ApiOperation({ summary: 'Update an event by id' })
  @ApiOkResponse({ type: EventRdo })
  @UseGuards(AuthJwtGuard, AdminGuard)
  @Put('/:id')
  updateEvent(
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
  ): Promise<EventRdo> {
    return this.eventService.updateEvent(id, dto);
  }

  @ApiOperation({ summary: 'Process zip file' })
  @ApiOkResponse({ type: SuccessRdo })
  @UseGuards(AuthJwtGuard, AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 10 * 1024 * 1024 * 1024,
      },
      storage: diskStorage({
        destination: './common/tmp',
        filename: (req, file, callback) => {
          console.log('file', file);
          const ext = path.extname(file.originalname);

          if (!ext) {
            return callback(null, file.originalname + '.zip');
          }

          callback(null, file.originalname);
        },
      }),
      fileFilter: (req, file, callback) => {
        console.log('file filter', file);
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.zip') {
          return callback(new Error('Only .zip files are allowed'), false);
        }
        callback(null, true);
      },
    }),
  )
  @Post('/process')
  async processZip(@UploadedFile() file: Express.Multer.File, @Body() dto: ProcessEventZipDto): Promise<SuccessRdo> {
    return this.eventService.processZip(file.path, dto.orderDeadline);
  }

  @ApiOperation({ summary: 'Delete an event' })
  @ApiOkResponse({ type: SuccessRdo })
  @ApiNotFoundResponse({
    example: new NotFoundException('Event not found').getResponse(),
  })
  @UseGuards(AuthJwtGuard, AdminGuard)
  @Delete('/:id')
  deleteEvent(@Param('id') id: string): Promise<SuccessRdo> {
    return this.eventService.deleteEvent(id);
  }

  @ApiOperation({ summary: 'Fetch events by page' })
  @ApiOkResponse({ type: EventsRdo })
  @Get('/')
  fetchEvents(@Query() dto: PageDto): Promise<EventsRdo> {
    return this.eventService.fetchEvents(dto);
  }
}
