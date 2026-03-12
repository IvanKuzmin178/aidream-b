import { Injectable, Logger } from '@nestjs/common';
import { PhotoEntity } from '../../projects/entities/project.entity';
import { ProjectEntity } from '../../projects/entities/project.entity';
import { SceneEntity } from '../entities/scene.entity';

interface StylePreset {
  sceneDuration: number;
  promptPrefix: string;
  cameraMotion: string;
  colorGrade: string;
}

const STYLE_PRESETS: Record<string, StylePreset> = {
  memory: {
    sceneDuration: 4,
    promptPrefix: 'A warm, nostalgic memory of',
    cameraMotion: 'slow gentle pan',
    colorGrade: 'warm vintage tones, soft golden light',
  },
  cinematic: {
    sceneDuration: 5,
    promptPrefix: 'A cinematic, dramatic shot of',
    cameraMotion: 'smooth dolly forward',
    colorGrade: 'high contrast, cool shadows, cinematic color grading',
  },
  dream: {
    sceneDuration: 4,
    promptPrefix: 'A dreamy, ethereal sequence of',
    cameraMotion: 'floating, slow orbit',
    colorGrade: 'soft focus, pastel tones, light bloom',
  },
};

@Injectable()
export class StoryboardService {
  private readonly logger = new Logger(StoryboardService.name);

  buildStoryboard(project: ProjectEntity, photos: PhotoEntity[]): SceneEntity[] {
    const sorted = this.rankAndOrder(photos);
    const selected = sorted.slice(0, Math.min(8, sorted.length));
    const style = STYLE_PRESETS[project.style] || STYLE_PRESETS.memory;

    this.logger.log(
      `Building storyboard: ${selected.length} scenes, style=${project.style}`,
    );

    return selected.map((photo, i) => {
      const nextPhoto = selected[i + 1];
      return {
        index: i,
        type: nextPhoto ? 'transition' as const : 'single' as const,
        inputPhotos: nextPhoto
          ? [photo.objectPath, nextPhoto.objectPath]
          : [photo.objectPath],
        prompt: this.buildPrompt(photo, nextPhoto, style),
        generationMode: nextPhoto
          ? 'first_last_frame' as const
          : 'image_to_video' as const,
        duration: style.sceneDuration,
      };
    });
  }

  private rankAndOrder(photos: PhotoEntity[]): PhotoEntity[] {
    return [...photos].sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return (b.qualityScore || 0) - (a.qualityScore || 0);
    });
  }

  private buildPrompt(
    photo: PhotoEntity,
    nextPhoto: PhotoEntity | undefined,
    style: StylePreset,
  ): string {
    const base = `${style.promptPrefix} the scene. ${style.cameraMotion}. ${style.colorGrade}.`;
    if (nextPhoto) {
      return `${base} Smooth transition between two moments. Gentle camera movement.`;
    }
    return `${base} Focus on the subject, bringing the still photo to life with subtle movement.`;
  }
}
