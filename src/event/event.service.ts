import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { PageDto } from 'common/dto/page.dto';
import { SuccessRdo } from 'common/rdo/success.rdo';
import { fillDto } from 'common/utils/fillDto';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PrismaService } from 'prisma/prisma.service';
import { StorageService } from 'src/storage/storage.service';
import { CreateEventDto } from './dto/create-event.dto';
import { InitEventZipUploadDto } from './dto/process-event-zip.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventRdo } from './rdo/event.rdo';
import { EventsRdo } from './rdo/events.rdo';

type ZipUploadStatus =
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

type ZipUploadChunk = {
  key: string;
  offset: number;
  size: number;
};

type ZipUploadMetadata = {
  uploadId: string;
  filename?: string;
  offset: number;
  size?: number;
  orderDeadline?: string;
  status: ZipUploadStatus;
  chunks: ZipUploadChunk[];
  jobId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class EventService {
  private readonly metadataDir = path.join(
    process.cwd(),
    'common',
    'tmp',
    'event-zip-upload-metadata',
  );
  private readonly chunkPrefix = 'archive-chunks';
  private readonly activeZipUploads = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    @InjectQueue('zip-processing') private readonly zipQueue: Queue,
  ) {}

  async createEvent(dto: CreateEventDto): Promise<EventRdo> {
    const event = await this.prisma.event.create({
      data: dto,
    });

    return fillDto(EventRdo, event);
  }

  async initZipUpload(dto: InitEventZipUploadDto): Promise<{
    uploadId: string;
    offset: number;
    size?: number;
    status: ZipUploadStatus;
  }> {
    const uploadId = randomUUID();
    const now = new Date().toISOString();
    const metadata: ZipUploadMetadata = {
      uploadId,
      filename: dto.filename,
      offset: 0,
      size: dto.size,
      orderDeadline: dto.orderDeadline?.toISOString(),
      status: 'uploading',
      chunks: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.writeZipUploadMetadata(metadata);

    return {
      uploadId,
      offset: metadata.offset,
      size: metadata.size,
      status: metadata.status,
    };
  }

  async fetchZipUpload(uploadId: string): Promise<ZipUploadMetadata> {
    return this.readZipUploadMetadata(uploadId);
  }

  async appendZipUpload(
    uploadId: string,
    stream: Readable,
    offset: number,
    contentLength?: number,
  ): Promise<{ uploadId: string; offset: number; status: ZipUploadStatus }> {
    const metadata = await this.readZipUploadMetadata(uploadId);

    if (metadata.status !== 'uploading') {
      throw new ConflictException(`Upload is ${metadata.status}`);
    }

    if (offset !== metadata.offset) {
      throw new ConflictException({
        message: 'Invalid upload offset',
        expectedOffset: metadata.offset,
      });
    }

    if (this.activeZipUploads.has(uploadId)) {
      throw new ConflictException('Upload chunk is already being written');
    }

    if (
      metadata.size !== undefined &&
      contentLength !== undefined &&
      offset + contentLength > metadata.size
    ) {
      throw new BadRequestException('Chunk exceeds expected upload size');
    }

    this.activeZipUploads.add(uploadId);

    const chunkKey = this.getChunkKey(uploadId, metadata.chunks.length);
    let bytesWritten = 0;
    const counter = new Transform({
      transform(chunk: Buffer, encoding, callback) {
        bytesWritten += chunk.length;
        callback(null, chunk);
      },
    });

    try {
      const uploadPromise = this.storageService.uploadPrivateObjectStream(
        chunkKey,
        counter,
        'application/octet-stream',
      );

      await pipeline(stream, counter);
      await uploadPromise;
    } catch (error) {
      await this.storageService.deletePrivateObject(chunkKey).catch(() => {});
      throw error;
    } finally {
      this.activeZipUploads.delete(uploadId);
    }

    if (contentLength !== undefined && bytesWritten !== contentLength) {
      await this.storageService.deletePrivateObject(chunkKey).catch(() => {});
      throw new BadRequestException('Chunk content-length mismatch');
    }

    metadata.chunks.push({
      key: chunkKey,
      offset: metadata.offset,
      size: bytesWritten,
    });
    metadata.offset += bytesWritten;
    metadata.updatedAt = new Date().toISOString();

    if (metadata.size !== undefined && metadata.offset > metadata.size) {
      throw new BadRequestException('Upload exceeds expected size');
    }

    await this.writeZipUploadMetadata(metadata);

    return {
      uploadId,
      offset: metadata.offset,
      status: metadata.status,
    };
  }

  async completeZipUpload(uploadId: string): Promise<SuccessRdo> {
    const metadata = await this.readZipUploadMetadata(uploadId);

    if (metadata.status !== 'uploading') {
      throw new ConflictException(`Upload is ${metadata.status}`);
    }

    if (metadata.size !== undefined && metadata.offset !== metadata.size) {
      throw new ConflictException({
        message: 'Upload is incomplete',
        offset: metadata.offset,
        size: metadata.size,
      });
    }

    const job = await this.zipQueue.add(
      'process-zip',
      {
        uploadId: metadata.uploadId,
        chunks: metadata.chunks,
        metadataPath: this.getMetadataPath(metadata.uploadId),
        orderDeadline: metadata.orderDeadline,
      },
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

    metadata.status = 'queued';
    metadata.jobId = job.id;
    metadata.updatedAt = new Date().toISOString();
    await this.writeZipUploadMetadata(metadata);

    return fillDto(SuccessRdo, {
      success: true,
      message: 'Zip file uploaded and queued for background processing',
    });
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

  private getChunkKey(uploadId: string, index: number): string {
    return `${this.chunkPrefix}/${uploadId}/${index.toString().padStart(12, '0')}.bin`;
  }

  private ensureMetadataDir(): void {
    if (!existsSync(this.metadataDir)) {
      mkdirSync(this.metadataDir, { recursive: true });
    }
  }

  private getMetadataPath(uploadId: string): string {
    return path.join(this.metadataDir, `${uploadId}.json`);
  }

  private async readZipUploadMetadata(
    uploadId: string,
  ): Promise<ZipUploadMetadata> {
    this.ensureMetadataDir();

    try {
      return JSON.parse(
        await readFile(this.getMetadataPath(uploadId), 'utf8'),
      ) as ZipUploadMetadata;
    } catch {
      throw new NotFoundException('Zip upload not found');
    }
  }

  private async writeZipUploadMetadata(
    metadata: ZipUploadMetadata,
  ): Promise<void> {
    this.ensureMetadataDir();
    await writeFile(
      this.getMetadataPath(metadata.uploadId),
      JSON.stringify(metadata, null, 2),
    );
  }
}
