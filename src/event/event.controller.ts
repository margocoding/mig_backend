import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { EventService } from './event.service';
import { CreateEventDto } from './dto/create-event.dto';
import {
  ApiNotFoundResponse,
  ApiConsumes,
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
import { InitEventZipUploadDto } from './dto/process-event-zip.dto';
import type { Request } from 'express';

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

  @ApiOperation({ summary: 'Initialize resumable event zip upload' })
  @ApiOkResponse({
    example: {
      uploadId: 'uuid',
      offset: 0,
      size: 214748364800,
      status: 'uploading',
    },
  })
  @UseGuards(AuthJwtGuard, AdminGuard)
  @Post('/process/upload')
  initZipUpload(@Body() dto: InitEventZipUploadDto) {
    return this.eventService.initZipUpload(dto);
  }

  @ApiOperation({ summary: 'Get resumable event zip upload status' })
  @ApiOkResponse({
    example: {
      uploadId: 'uuid',
      offset: 104857600,
      size: 214748364800,
      status: 'uploading',
    },
  })
  @UseGuards(AuthJwtGuard, AdminGuard)
  @Get('/process/upload/:uploadId')
  getZipUpload(@Param('uploadId') uploadId: string) {
    return this.eventService.fetchZipUpload(uploadId);
  }

  @ApiOperation({ summary: 'Append chunk to resumable event zip upload' })
  @ApiConsumes('application/octet-stream')
  @ApiOkResponse({
    example: {
      uploadId: 'uuid',
      offset: 209715200,
      status: 'uploading',
    },
  })
  @UseGuards(AuthJwtGuard, AdminGuard)
  @Patch('/process/upload/:uploadId')
  appendZipUpload(
    @Param('uploadId') uploadId: string,
    @Req() request: Request,
    @Headers('upload-offset') uploadOffset: string,
    @Headers('content-length') contentLength?: string,
  ) {
    const offset = Number(uploadOffset);

    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new BadRequestException('Invalid upload-offset header');
    }

    const parsedContentLength =
      contentLength === undefined ? undefined : Number(contentLength);

    if (
      parsedContentLength !== undefined &&
      (!Number.isSafeInteger(parsedContentLength) || parsedContentLength < 0)
    ) {
      throw new BadRequestException('Invalid content-length header');
    }

    return this.eventService.appendZipUpload(
      uploadId,
      request,
      offset,
      parsedContentLength,
    );
  }

  @ApiOperation({ summary: 'Complete event zip upload and queue processing' })
  @ApiOkResponse({ type: SuccessRdo })
  @UseGuards(AuthJwtGuard, AdminGuard)
  @Post('/process/upload/:uploadId/complete')
  completeZipUpload(@Param('uploadId') uploadId: string): Promise<SuccessRdo> {
    return this.eventService.completeZipUpload(uploadId);
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
