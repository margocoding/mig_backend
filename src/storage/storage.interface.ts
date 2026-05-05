import { Readable } from 'node:stream';

export const STORAGE_SERVICE = 'STORAGE_SERVICE';

export enum StorageType {
  S3 = 's3',
  S3_PUBLIC = 's3_public',
}

export interface S3Config {
  region: string;
  endpoint: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  isPublic?: boolean;
}

export interface LocalConfig {
  basePath: string;
  baseUrl: string;
}

export type StorageConfig = S3Config | LocalConfig;

export interface StorageOptions {
  folder?: string;
  storageType?: StorageType;
  contentType?: string;
}

export interface IStorageService {
  uploadFile(
    file: Buffer | Readable,
    filename: string,
    options?: StorageOptions,
  ): Promise<string>;
  getFileUrl(filename: string, options?: StorageOptions): Promise<string>;
  deleteFile(filename: string, options?: StorageOptions): Promise<void>;
  getFile(filename: string, options?: StorageOptions): Promise<Buffer>;
}
