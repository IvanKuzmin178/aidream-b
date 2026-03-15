import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { ProjectsService } from '../../projects/projects.service';
import { VertexAiService } from './vertex-ai.service';
import { PhotoEntity } from '../../projects/entities/project.entity';
import { PHOTO_PROMPT_RULES } from '../constants/photo-prompt-rules.constants';

@Injectable()
export class PreprocessService {
  private readonly logger = new Logger(PreprocessService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly projectsService: ProjectsService,
    private readonly vertexAiService: VertexAiService,
  ) {}

  async preprocess(projectId: string): Promise<PhotoEntity[]> {
    this.logger.log(`Preprocessing project ${projectId}`);

    const project = await this.projectsService.getById(projectId);
    const photos = await this.projectsService.getPhotos(projectId);
    const validPhotos: PhotoEntity[] = [];
    const rules = PHOTO_PROMPT_RULES[project.style] || PHOTO_PROMPT_RULES.memory;

    for (const photo of photos) {
      const exists = await this.storageService.fileExists(photo.objectPath);
      if (!exists) {
        this.logger.warn(`Photo missing from GCS: ${photo.objectPath}`);
        continue;
      }

      const qualityScore = this.computeQualityScore(photo);
      let aiDescription: string | undefined;

      try {
        aiDescription = await this.vertexAiService.analyzePhotoForVideo(
          photo.objectPath,
          rules.singleAnalysisPrompt,
        );
      } catch (err) {
        this.logger.warn(`Photo analysis failed for ${photo.id}: ${err}`);
      }

      await this.projectsService.updatePhoto(projectId, photo.id, {
        qualityScore,
        isSelected: true,
        ...(aiDescription ? { aiDescription } : {}),
      });

      validPhotos.push({
        ...photo,
        qualityScore,
        isSelected: true,
        ...(aiDescription ? { aiDescription } : {}),
      });
    }

    if (validPhotos.length === 0) {
      throw new Error(`No valid photos found for project ${projectId}`);
    }

    this.logger.log(
      `Preprocessing complete: ${validPhotos.length}/${photos.length} photos valid (${validPhotos.filter((p) => p.aiDescription).length} with AI descriptions)`,
    );
    return validPhotos;
  }

  /**
   * Basic quality scoring based on file size.
   */
  private computeQualityScore(photo: PhotoEntity): number {
    const sizeMb = photo.size / (1024 * 1024);
    if (sizeMb >= 2) return 1.0;
    if (sizeMb >= 1) return 0.8;
    if (sizeMb >= 0.5) return 0.6;
    return 0.4;
  }
}
