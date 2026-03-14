import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket } from '@google-cloud/storage';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private storage!: Storage;
  private bucket!: Bucket;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.storage = new Storage({
      projectId: this.configService.get<string>('GCP_PROJECT_ID'),
    });
    const bucketName = this.configService.get<string>('GCS_BUCKET', 'aidream-media');
    this.bucket = this.storage.bucket(bucketName);
    this.logger.log(`GCS configured for bucket: ${bucketName}`);
  }

  async generateSignedUploadUrl(
    objectPath: string,
    contentType: string,
    expiresInMinutes = 15,
  ): Promise<string> {
    const [url] = await this.bucket.file(objectPath).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + expiresInMinutes * 60 * 1000,
      contentType,
    });
    return url;
  }

  async generateSignedDownloadUrl(
    objectPath: string,
    expiresInMinutes = 60,
  ): Promise<string> {
    const [url] = await this.bucket.file(objectPath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresInMinutes * 60 * 1000,
    });
    return url;
  }

  async fileExists(objectPath: string): Promise<boolean> {
    const [exists] = await this.bucket.file(objectPath).exists();
    return exists;
  }

  async deleteFile(objectPath: string): Promise<void> {
    await this.bucket.file(objectPath).delete({ ignoreNotFound: true });
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const files = await this.listFiles(prefix);
    if (files.length === 0) return 0;
    await Promise.all(files.map((f) => this.deleteFile(f)));
    this.logger.log(`Deleted ${files.length} files with prefix: ${prefix}`);
    return files.length;
  }

  async listFiles(prefix: string): Promise<string[]> {
    const [files] = await this.bucket.getFiles({ prefix });
    return files.map((f) => f.name);
  }

  async copyFile(srcPath: string, destPath: string): Promise<void> {
    await this.bucket.file(srcPath).copy(this.bucket.file(destPath));
  }

  getBucket(): Bucket {
    return this.bucket;
  }
}
