import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SuccessRdo } from 'common/rdo/success.rdo';
import { fillDto } from 'common/utils/fillDto';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { Readable, PassThrough } from 'node:stream';
import path from 'path';
import { PrismaService } from 'prisma/prisma.service';
import sharp from 'sharp';
import { StorageType } from 'src/storage/storage.interface';
import { StorageService } from 'src/storage/storage.service';
import { v4 as uuid } from 'uuid';
import { MediaRdo } from './rdo/media.rdo';
import { OrderMediaRdo } from '../order/rdo/order-media.rdo';

type UploadMediaFile = {
  stream: Readable;
  originalname: string;
  mimetype?: string;
};

@Injectable()
export class MediaService {
  private readonly mediaPrice: number = 400;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async changeOrder(id: string, newOrder: number): Promise<MediaRdo> {
    const media = await this.prisma.media.findUnique({ where: { id } });

    if (!media) throw new NotFoundException('Media not found');

    const oldOrder = media.order;

    if (newOrder === oldOrder) return fillDto(MediaRdo, media);

    const direction = newOrder > oldOrder ? 'down' : 'up';

    const memberId = media.memberId;

    const shiftRange =
      direction === 'down'
        ? { gte: oldOrder + 1, lte: newOrder }
        : { gte: newOrder, lte: oldOrder - 1 };

    const shiftDelta = direction === 'down' ? -1 : 1;

    const [, updatedMedia] = await this.prisma.$transaction([
      this.prisma.media.updateMany({
        where: {
          memberId,
          order: shiftRange,
        },
        data: {
          order: {
            increment: shiftDelta,
          },
        },
      }),

      this.prisma.media.update({
        where: { id },
        data: { order: newOrder },
      }),
    ]);

    return fillDto(MediaRdo, updatedMedia);
  }

  async addMedia(
    memberId: string,
    file: Express.Multer.File,
  ): Promise<MediaRdo> {
    try {
      const lastMedia = await this.prisma.media.findFirst({
        where: { memberId },
        orderBy: {
          createdAt: 'desc',
        },
      });

      const fileData = await this.uploadFile(memberId, 1, {
        stream: this.createUploadStream(file),
        originalname: file.originalname,
        mimetype: file.mimetype,
      });
      const media = await this.prisma.media.create({
        data: {
          preview: fileData.preview,
          filename: fileData.filename,
          memberId,
          order: (lastMedia?.order || 0) + 1,
        },
      });

      return fillDto(MediaRdo, media);
    } catch (e) {
      console.error(e);
      throw new NotFoundException('Member not found');
    } finally {
      await this.removeTempFile(file);
    }
  }

  async deleteMedia(id: string): Promise<SuccessRdo> {
    try {
      const media = await this.prisma.media.findUnique({ where: { id } });

      if (!media) throw new NotFoundException('Media not found');

      const { memberId, order } = media;

      await this.prisma.$transaction([
        this.prisma.media.delete({ where: { id } }),

        this.prisma.media.updateMany({
          where: {
            memberId,
            order: { gt: order },
          },
          data: {
            order: {
              decrement: 1,
            },
          },
        }),
      ]);
      return fillDto(SuccessRdo, { success: true });
    } catch {
      throw new NotFoundException('Media not found');
    }
  }

  async processPreviewImage(fileStream: Readable): Promise<Readable> {
    const watermarkPath = path.join(
      process.cwd(),
      'common',
      'assets',
      'watermark.png',
    );
    const image = sharp();
    const output = image.clone();

    fileStream.pipe(image);

    const metadata = await image.metadata();
    const imgHeight = metadata.height || 1024;
    const watermarkHeight = Math.max(32, Math.floor(imgHeight / 16));

    const tiledWatermark = await sharp(watermarkPath)
      .resize({ height: watermarkHeight })
      .modulate({ brightness: 1.35, saturation: 1.15 })
      .png()
      .toBuffer();
    const centerWatermark = await sharp(watermarkPath)
      .resize({ height: watermarkHeight * 2 })
      .modulate({ brightness: 1.35, saturation: 1.15 })
      .png()
      .toBuffer();

    return output.composite([
      { input: tiledWatermark, tile: true, blend: 'over' },
      { input: tiledWatermark, tile: true, blend: 'over' },
      { input: centerWatermark, gravity: 'center', blend: 'over' },
      { input: centerWatermark, gravity: 'center', blend: 'over' },
    ]);
  }

  async uploadProcessedMedia(
    orderId: string,
    mediaId: string,
    file: Express.Multer.File,
  ): Promise<OrderMediaRdo> {
    // 1. Проверить существование order_media
    const orderMedia = await this.prisma.orderMedia.findUnique({
      where: {
        orderId_mediaId: {
          orderId,
          mediaId,
        },
      },
    });

    if (!orderMedia) {
      throw new NotFoundException('Order media not found');
    }

    if (!orderMedia.requiresProcessing) {
      throw new BadRequestException('This media does not require processing');
    }

    const filename = `processed-${orderMedia.mediaId}-${uuid()}.png`;

    const previewInputStream = this.createUploadStream(file);
    const fullVersionStream = this.createUploadStream(file);

    try {
      const [processedPreview, processedFullVersion] = await Promise.all([
        this.storageService.uploadFile(
          await this.processPreviewImage(previewInputStream),
          filename,
          {
            folder: `/processed/preview/${orderMedia.orderId}`,
            storageType: StorageType.S3_PUBLIC,
            contentType: file.mimetype,
          },
        ),
        this.storageService.uploadFile(fullVersionStream, filename, {
          folder: `/processed/full/${orderMedia.orderId}`,
          storageType: StorageType.S3_PUBLIC,
          contentType: file.mimetype,
        }),
      ]);

      const updated = await this.prisma.orderMedia.update({
        where: {
          orderId_mediaId: {
            orderId,
            mediaId,
          },
        },
        data: {
          processedPreview,
          processedFullVersion,
          processedAt: new Date(),
        },
        include: {
          media: true,
        },
      });

      return fillDto(OrderMediaRdo, {
        ...updated.media,
        requiresProcessing: updated.requiresProcessing,
        processedPreview: updated.processedPreview,
        processedFullVersion: updated.processedFullVersion,
        processedAt: updated.processedAt,
      });
    } finally {
      await this.removeTempFile(file);
    }
  }

  async uploadFile(id: string, index: number, file: UploadMediaFile) {
    const [previewStream, fullVersionStream] = this.forkStream(file.stream, 2);

    const [preview, fullVersion] = await Promise.all([
      this.storageService.uploadFile(
        await this.processPreviewImage(previewStream),
        file.originalname,
        {
          folder: `/preview/${id}`,
          storageType: StorageType.S3_PUBLIC,
          contentType: file.mimetype,
        },
      ),
      this.storageService.uploadFile(fullVersionStream, file.originalname, {
        folder: `/original/${id}`,
        storageType: StorageType.S3,
        contentType: file.mimetype,
      }),
    ]);
    return {
      filename: file.originalname,
      fullVersion,
      order: index,
      preview,
    };
  }

  private forkStream(source: Readable, count: number): Readable[] {
    const streams = Array.from(
      { length: count },
      () => new PassThrough({ highWaterMark: 16 * 1024 * 1024 }),
    );

    for (const stream of streams) {
      source.pipe(stream);
    }

    source.on('error', (error) => {
      for (const stream of streams) {
        stream.destroy(error);
      }
    });

    return streams;
  }

  private createUploadStream(file: Express.Multer.File): Readable {
    if (!file.path) {
      throw new BadRequestException('Uploaded file is not available as stream');
    }

    return createReadStream(file.path);
  }

  private async removeTempFile(file: Express.Multer.File): Promise<void> {
    if (!file.path) return;

    await unlink(file.path).catch(() => undefined);
  }
}
