import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import archiver from 'archiver';
import { PassThrough, Readable } from 'stream';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';

import {
  S3Config,
  StorageConfig,
  StorageOptions,
  StorageType,
} from './storage.interface';
import * as https from 'node:https';

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly configs: Map<StorageType, StorageConfig>;

  constructor(private readonly configService: ConfigService) {
    this.configs = new Map();

    const privateConfig = {
      region: this.configService.get<string>('S3_REGION', 'ru-central1'),
      endpoint: this.configService.get<string>(
        'S3_ENDPOINT',
        'https://storage.yandexcloud.net',
      ),
      bucketName: this.configService.get<string>('S3_PRIVATE_BUCKET_NAME', ''),
      accessKeyId: this.configService.get<string>('S3_ACCESS_KEY_ID', ''),
      secretAccessKey: this.configService.get<string>(
        'S3_SECRET_ACCESS_KEY',
        '',
      ),
      isPublic: false,
    };

    const publicConfig = {
      region: this.configService.get<string>('S3_REGION', 'ru-central1'),
      endpoint: this.configService.get<string>(
        'S3_ENDPOINT',
        'https://storage.yandexcloud.net',
      ),
      bucketName: this.configService.get<string>('S3_PUBLIC_BUCKET_NAME', ''),
      accessKeyId: this.configService.get<string>('S3_ACCESS_KEY_ID', ''),
      secretAccessKey: this.configService.get<string>(
        'S3_SECRET_ACCESS_KEY',
        '',
      ),
      isPublic: true,
    };
    this.configs.set(StorageType.S3, privateConfig);
    this.configs.set(StorageType.S3_PUBLIC, publicConfig);

    this.s3Client = new S3Client({
      region: privateConfig.region,
      endpoint: privateConfig.endpoint,
      credentials: {
        accessKeyId: privateConfig.accessKeyId,
        secretAccessKey: privateConfig.secretAccessKey,
      },
      forcePathStyle: true,
      requestHandler: new NodeHttpHandler({
        httpsAgent: new https.Agent({ family: 4 }), // force IPv4
        connectionTimeout: 30000, // 30 секунд
        socketTimeout: 30000,
      }),
    });
  }

  async getPresignedUrl(
    filename: string,
    options: StorageOptions = {},
    expiresIn = 3600,
  ): Promise<string> {
    const { storageType = StorageType.S3, folder } = options;
    const config = this.getConfig(storageType);

    const s3Config = config as S3Config;
    const fullPath = this.getFullPath(filename, folder);

    const command = new GetObjectCommand({
      Bucket: s3Config.bucketName,
      Key: fullPath,
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn,
    });

    return url;
  }

  async getFolderAsZip(
    folder: string,
    storageType: StorageType = StorageType.S3,
  ): Promise<NodeJS.ReadableStream> {
    const config = this.getConfig(storageType) as S3Config;

    const prefix = folder.replace(/^\/+|\/+$/g, '') + '/';
    console.log(prefix);

    const list = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: config.bucketName,
        Prefix: prefix,
      }),
    );

    if (!list.Contents || list.Contents.length === 0) {
      throw new Error('Папка пуста или не существует');
    }

    const zipStream = new PassThrough();
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.pipe(zipStream);

    for (const file of list.Contents) {
      const key = file.Key!;
      const fileStream = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: config.bucketName,
          Key: key,
        }),
      );

      archive.append(fileStream.Body as Readable, {
        name: key.replace(prefix, ''),
      });
    }

    archive.finalize();

    return zipStream;
  }

  async getPresignedUrlForUploading(folder: string, filename: string) {
    const config = this.getConfig(StorageType.S3) as S3Config;
    const command = new PutObjectCommand({
      Bucket: config.bucketName,
      Key: folder + '/' + filename,
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: 1 * 60 * 60,
    });

    return url;
  }

  async getStreamFile(folder: string, filename: string): Promise<Readable> {
    const config = this.getConfig(StorageType.S3) as S3Config;

    const command = new GetObjectCommand({
      Bucket: config.bucketName,
      Key: folder + '/' + filename,
    });
    const response = await this.s3Client.send(command);

    if (!response.Body) throw new NotFoundException('File not found');

    console.log(response.Body instanceof Readable);

    if ((response.Body as any)?.getReader) {
      const reader = (response.Body as any).getReader();
      const chunks: Buffer[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }

      return Readable.from(chunks);
    }

    // Уже Node stream
    return response.Body as Readable;
  }

  async uploadFile(
    file: Buffer,
    filename: string,
    options: StorageOptions = {},
  ): Promise<string> {
    const { storageType = StorageType.S3, folder, contentType } = options;
    const config = this.getConfig(storageType);

    const s3Config = config as S3Config;
    const fullPath = this.getFullPath(filename, folder);

    try {
      const command = new PutObjectCommand({
        Bucket: s3Config.bucketName,
        Key: fullPath,
        Body: file,
        ACL: s3Config.isPublic ? 'public-read' : 'private',
        ContentType: contentType,
      });

      await this.s3Client.send(command);

      return this.getFileUrl(filename, options);
    } catch (error) {
      console.log(filename);
      console.log(error);
      throw new Error(
        `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async getFileUrl(
    filename: string,
    options: StorageOptions = {},
  ): Promise<string> {
    const { storageType = StorageType.S3, folder } = options;
    const config = this.getConfig(storageType);

    const s3Config = config as S3Config;
    const fullPath = this.getFullPath(filename, folder);
    return `https://${s3Config.bucketName}.storage.yandexcloud.net/${fullPath}`;
  }

  private async s3ToNodeStream(responseBody: any): Promise<Readable> {
    if ((responseBody as ReadableStream)?.getReader) {
      const reader = (responseBody as ReadableStream).getReader();
      const chunks: Buffer[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }

      return Readable.from(chunks);
    }

    // Уже Node stream
    return responseBody as Readable;
  }

  private getFullPath(filename: string, folder?: string): string {
    if (!folder) return filename;
    const cleanFolder = folder.replace(/^\/+|\/+$/g, '');
    return `${cleanFolder}/${filename}`;
  }

  private validateConfig(config: S3Config): void {
    if (!config.bucketName || !config.accessKeyId || !config.secretAccessKey) {
      throw new Error('S3 configuration is incomplete');
    }
  }

  private getConfig(storageType: StorageType = StorageType.S3): StorageConfig {
    const config = this.configs.get(storageType);
    if (!config) {
      throw new Error(
        `No configuration found for storage type: ${storageType}`,
      );
    }
    return config;
  }
}
