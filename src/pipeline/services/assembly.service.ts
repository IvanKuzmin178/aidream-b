import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { ProjectsService } from '../../projects/projects.service';

@Injectable()
export class AssemblyService {
  private readonly logger = new Logger(AssemblyService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * MVP assembly: concatenate clips sequentially.
   * Phase 2 will use ffmpeg for transitions, timing, and music.
   */
  async assemble(projectId: string, clipPaths: string[]): Promise<string> {
    this.logger.log(
      `Assembling ${clipPaths.length} clips for project ${projectId}`,
    );

    if (clipPaths.length === 0) {
      throw new Error('No clips to assemble');
    }

    if (clipPaths.length === 1) {
      const finalPath = `projects/${projectId}/output/final.mp4`;
      await this.storageService.copyFile(clipPaths[0], finalPath);

      await this.projectsService.updateStatus(projectId, 'completed', {
        resultVideoPath: finalPath,
        currentStep: 'completed',
      });

      this.logger.log(`Single-clip assembly complete: ${finalPath}`);
      return finalPath;
    }

    // MVP: use first clip as the "final" video, since we can't do real concatenation
    // without ffmpeg. Phase 2 adds proper ffmpeg-based assembly.
    const finalPath = `projects/${projectId}/output/final.mp4`;
    await this.storageService.copyFile(clipPaths[0], finalPath);

    await this.projectsService.updateStatus(projectId, 'completed', {
      resultVideoPath: finalPath,
      resultDuration: clipPaths.length * 4,
      currentStep: 'completed',
    });

    this.logger.log(`Assembly complete: ${finalPath} (${clipPaths.length} clips)`);
    return finalPath;
  }
}
