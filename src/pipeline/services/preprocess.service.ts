import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { ProjectsService } from '../../projects/projects.service';
import { PhotoEntity } from '../../projects/entities/project.entity';

@Injectable()
export class PreprocessService {
  private readonly logger = new Logger(PreprocessService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly projectsService: ProjectsService,
  ) {}

  async preprocess(projectId: string): Promise<PhotoEntity[]> {
    this.logger.log(`Preprocessing project ${projectId}`);

    const photos = await this.projectsService.getPhotos(projectId);
    const validPhotos: PhotoEntity[] = [];

    for (const photo of photos) {
      const exists = await this.storageService.fileExists(photo.objectPath);
      if (!exists) {
        this.logger.warn(`Photo missing from GCS: ${photo.objectPath}`);
        continue;
      }

      const qualityScore = this.computeQualityScore(photo);
      validPhotos.push({ ...photo, qualityScore, isSelected: true });
    }

    if (validPhotos.length === 0) {
      throw new Error(`No valid photos found for project ${projectId}`);
    }

    this.logger.log(
      `Preprocessing complete: ${validPhotos.length}/${photos.length} photos valid`,
    );
    return validPhotos;
  }

  /**
   * MVP: basic quality scoring based on file size.
   * Phase 2 will add face detection and image analysis via Vision API.
   */
  private computeQualityScore(photo: PhotoEntity): number {
    const sizeMb = photo.size / (1024 * 1024);
    if (sizeMb >= 2) return 1.0;
    if (sizeMb >= 1) return 0.8;
    if (sizeMb >= 0.5) return 0.6;
    return 0.4;
  }
}
