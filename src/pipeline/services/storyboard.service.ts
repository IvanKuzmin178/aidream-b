import { Injectable, Logger } from '@nestjs/common';
import { PhotoEntity } from '../../projects/entities/project.entity';
import { ProjectEntity } from '../../projects/entities/project.entity';
import { SceneEntity } from '../entities/scene.entity';
import { PHOTO_PROMPT_RULES } from '../constants/photo-prompt-rules.constants';

interface StylePreset {
  sceneDuration: number;
  promptPrefix: string;
  cameraMotion: string;
  colorGrade: string;
}

const STYLE_PRESETS: Record<string, StylePreset> = {
  memory: {
    sceneDuration: 5,
    promptPrefix: 'A warm, nostalgic memory of',
    cameraMotion: 'slow gentle pan',
    colorGrade: 'warm vintage tones, soft golden light',
  },
  cinematic: {
    sceneDuration: 6,
    promptPrefix: 'A cinematic, dramatic shot of',
    cameraMotion: 'smooth dolly forward',
    colorGrade: 'high contrast, cool shadows, cinematic color grading',
  },
  dream: {
    sceneDuration: 5,
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
    const rules = PHOTO_PROMPT_RULES[project.style] || PHOTO_PROMPT_RULES.memory;

    this.logger.log(
      `Building storyboard: ${selected.length} photos, style=${project.style}`,
    );

    // For exactly 2 photos: single transition scene (start frame → end frame)
    if (selected.length === 2) {
      return [
        {
          index: 0,
          type: 'transition' as const,
          inputPhotos: [selected[0].objectPath, selected[1].objectPath],
          prompt: this.buildPrompt(selected[0], selected[1], style, rules),
          generationMode: 'first_last_frame' as const,
          duration: style.sceneDuration,
        },
      ];
    }

    return selected.map((photo, i) => {
      const nextPhoto = selected[i + 1];
      return {
        index: i,
        type: nextPhoto ? 'transition' as const : 'single' as const,
        inputPhotos: nextPhoto
          ? [photo.objectPath, nextPhoto.objectPath]
          : [photo.objectPath],
        prompt: this.buildPrompt(photo, nextPhoto, style, rules),
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
    rules: { singleSceneSuffix: string; transitionSceneSuffix: string },
  ): string {
    const desc1 = photo.aiDescription?.trim();
    const desc2 = nextPhoto?.aiDescription?.trim();

    if (nextPhoto && (desc1 || desc2)) {
      const d1 = desc1 || 'the first moment';
      const d2 = desc2 || 'the second moment';
      return rules.transitionSceneSuffix
        .replace('{description1}', d1)
        .replace('{description2}', d2);
    }
    if (!nextPhoto && desc1) {
      return rules.singleSceneSuffix.replace('{description}', desc1);
    }

    const base = `${style.promptPrefix} the scene. ${style.cameraMotion}. ${style.colorGrade}.`;
    if (nextPhoto) {
      return `${base} Smooth transition between two moments. Gentle camera movement.`;
    }
    return `${base} Focus on the subject, bringing the still photo to life with subtle movement.`;
  }
}
