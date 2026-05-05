import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import archiver from 'archiver';
import * as https from 'node:https';
import { PassThrough, Readable } from 'node:stream';

import {
  S3Config,
  StorageConfig,
  StorageOptions,
  StorageType,
} from './storage.interface';

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
        httpsAgent: new https.Agent({ family: 4 }),
        connectionTimeout: 30000,
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

    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  async getFolderAsZip(
    folder: string,
    storageType: StorageType = StorageType.S3,
  ): Promise<NodeJS.ReadableStream> {
    const config = this.getConfig(storageType) as S3Config;

    const prefix = folder.replace(/^\/+|\/+$/g, '') + '/';
    const list = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: config.bucketName,
        Prefix: prefix,
      }),
    );

    if (!list.Contents || list.Contents.length === 0) {
      throw new Error('Folder is empty or does not exist');
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

      archive.append(this.s3ToNodeStream(fileStream.Body), {
        name: key.replace(prefix, ''),
      });
    }

    void archive.finalize();

    return zipStream;
  }

  async getStreamFile(folder: string, filename: string): Promise<Readable> {
    const config = this.getConfig(StorageType.S3) as S3Config;

    const command = new GetObjectCommand({
      Bucket: config.bucketName,
      Key: folder + '/' + filename,
    });
    const response = await this.s3Client.send(command);

    if (!response.Body) throw new NotFoundException('File not found');

    return this.s3ToNodeStream(response.Body);
  }

  async getPrivateObjectStream(key: string): Promise<Readable> {
    const config = this.getConfig(StorageType.S3) as S3Config;
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: config.bucketName,
        Key: key,
      }),
    );

    if (!response.Body) throw new NotFoundException('File not found');

    return this.s3ToNodeStream(response.Body);
  }

  async uploadPrivateObjectStream(
    key: string,
    stream: Readable,
    contentType?: string,
  ): Promise<void> {
    const config = this.getConfig(StorageType.S3) as S3Config;
    const upload = new Upload({
      client: this.s3Client,
      params: {
        Bucket: config.bucketName,
        Key: key,
        Body: stream,
        ACL: 'private',
        ContentType: contentType,
      },
    });

    await upload.done();
  }

  async deletePrivateObject(key: string): Promise<void> {
    const config = this.getConfig(StorageType.S3) as S3Config;
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: config.bucketName,
        Key: key,
      }),
    );
  }

  async uploadFile(
    file: Buffer | Readable,
    filename: string,
    options: StorageOptions = {},
  ): Promise<string> {
    const { storageType = StorageType.S3, folder, contentType } = options;
    const config = this.getConfig(storageType);

    const s3Config = config as S3Config;
    const fullPath = this.getFullPath(filename, folder);

    try {
      if (file instanceof Readable) {
        const upload = new Upload({
          client: this.s3Client,
          params: {
            Bucket: s3Config.bucketName,
            Key: fullPath,
            Body: file,
            ACL: s3Config.isPublic ? 'public-read' : 'private',
            ContentType: contentType,
          },
        });

        await upload.done();
      } else {
        const command = new PutObjectCommand({
          Bucket: s3Config.bucketName,
          Key: fullPath,
          Body: file,
          ACL: s3Config.isPublic ? 'public-read' : 'private',
          ContentType: contentType,
        });

        await this.s3Client.send(command);
      }

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
    return await Promise.resolve(
      `https://${s3Config.bucketName}.storage.yandexcloud.net/${fullPath}`,
    );
  }

  private s3ToNodeStream(responseBody: any): Readable {
    if ((responseBody as ReadableStream)?.getReader) {
      const reader = (responseBody as ReadableStream<Uint8Array>).getReader();

      return Readable.from(
        (async function* () {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            yield Buffer.from(value);
          }
        })(),
      );
    }

    return responseBody as Readable;
  }

  private getFullPath(filename: string, folder?: string): string {
    if (!folder) return filename;
    const cleanFolder = folder.replace(/^\/+|\/+$/g, '');
    return `${cleanFolder}/${filename}`;
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
