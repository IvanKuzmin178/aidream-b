import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { StorageService } from '../storage/storage.service';
import { ProjectsService } from '../projects/projects.service';
import { FileRequest } from './dto/request-upload-urls.dto';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface UploadUrlResult {
  filename: string;
  signedUrl: string;
  objectPath: string;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly projectsService: ProjectsService,
    private readonly configService: ConfigService,
  ) {}

  async generateUploadUrls(
    projectId: string,
    files: FileRequest[],
  ): Promise<UploadUrlResult[]> {
    const maxPhotos = this.configService.get<number>('MAX_PHOTOS_PER_PROJECT', 20);

    if (files.length > maxPhotos) {
      throw new BadRequestException(`Maximum ${maxPhotos} photos per project`);
    }

    for (const file of files) {
      if (!ACCEPTED_TYPES.includes(file.contentType)) {
        throw new BadRequestException(
          `Unsupported file type: ${file.contentType}. Accepted: JPEG, PNG, WebP`,
        );
      }
    }

    return Promise.all(
      files.map(async (file) => {
        const objectPath = `projects/${projectId}/photos/${uuidv4()}-${file.filename}`;
        const signedUrl = await this.storageService.generateSignedUploadUrl(
          objectPath,
          file.contentType,
        );
        return { filename: file.filename, signedUrl, objectPath };
      }),
    );
  }

  async confirmUpload(
    projectId: string,
    objectPaths: string[],
    files: FileRequest[],
  ): Promise<void> {
    const existing = await this.projectsService.getPhotos(projectId);
    const maxPhotos = this.configService.get<number>('MAX_PHOTOS_PER_PROJECT', 20);

    if (existing.length + objectPaths.length > maxPhotos) {
      throw new BadRequestException(`Maximum ${maxPhotos} photos per project`);
    }

    for (const path of objectPaths) {
      const exists = await this.storageService.fileExists(path);
      if (!exists) {
        throw new BadRequestException(`File not found in storage: ${path}`);
      }
    }

    let order = existing.length;
    for (let i = 0; i < objectPaths.length; i++) {
      const file = files[i];
      await this.projectsService.addPhoto(projectId, {
        objectPath: objectPaths[i],
        originalName: file?.filename || objectPaths[i].split('/').pop() || '',
        contentType: file?.contentType || 'image/jpeg',
        size: file?.size || 0,
        order: order++,
      });
    }

    await this.projectsService.updateStatus(projectId, 'uploaded');
    this.logger.log(`Upload confirmed for project ${projectId}: ${objectPaths.length} files`);
  }
}
