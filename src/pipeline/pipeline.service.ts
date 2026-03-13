import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../firebase/firebase.service';
import { StorageService } from '../storage/storage.service';
import { ProjectsService } from '../projects/projects.service';
import { CreditsService } from '../credits/credits.service';
import { QueueService } from '../queue/queue.service';
import { PreprocessService } from './services/preprocess.service';
import { StoryboardService } from './services/storyboard.service';
import { VertexAiService } from './services/vertex-ai.service';
import { AssemblyService } from './services/assembly.service';
import { JobEntity, JobStatus } from './entities/job.entity';

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly storageService: StorageService,
    private readonly projectsService: ProjectsService,
    private readonly creditsService: CreditsService,
    private readonly queueService: QueueService,
    private readonly preprocessService: PreprocessService,
    private readonly storyboardService: StoryboardService,
    private readonly vertexAiService: VertexAiService,
    private readonly assemblyService: AssemblyService,
    private readonly configService: ConfigService,
  ) {}

  private get db() {
    return this.firebaseService.firestore;
  }

  async startGeneration(projectId: string, userId: string): Promise<{ jobId: string }> {
    this.logger.log(`[${projectId}] === GENERATION START === user=${userId}`);
    const project = await this.projectsService.get(projectId, userId);

    if (project.status !== 'uploaded') {
      throw new BadRequestException(
        'Project must have uploaded photos before generating',
      );
    }

    const minPhotos = this.configService.get<number>('MIN_PHOTOS_PER_PROJECT', 2);
    if (project.photoCount < minPhotos) {
      throw new BadRequestException(
        `At least ${minPhotos} photos required. Current: ${project.photoCount}`,
      );
    }

    const cost = this.creditsService.calculateCost(project.style, project.photoCount);
    await this.creditsService.deductCredits(userId, cost, projectId);
    this.logger.log(`[${projectId}] Credits deducted: ${cost} (style=${project.style}, photos=${project.photoCount})`);

    await this.projectsService.updateStatus(projectId, 'processing', {
      creditsCost: cost,
      currentStep: 'queued',
    });

    const jobRef = this.db.collection(`projects/${projectId}/jobs`).doc();
    await jobRef.set({
      type: 'preprocess',
      status: 'queued',
      inputPaths: [],
      retryCount: 0,
      createdAt: new Date(),
    });

    await this.queueService.enqueue({
      url: '/internal/pipeline/preprocess',
      body: { projectId, jobId: jobRef.id },
    });

    this.logger.log(`[${projectId}] Pipeline queued, first job=${jobRef.id}`);
    return { jobId: jobRef.id };
  }

  async runPreprocess(projectId: string, jobId: string): Promise<void> {
    this.logger.log(`[${projectId}] Step: PREPROCESS (job=${jobId})`);
    await this.updateJob(projectId, jobId, 'running');
    await this.projectsService.updateStatus(projectId, 'processing', {
      currentStep: 'preprocessing',
    });

    try {
      const photos = await this.preprocessService.preprocess(projectId);
      this.logger.log(`[${projectId}] Preprocess complete: ${photos.length} valid photos`);
      await this.updateJob(projectId, jobId, 'completed');

      const storyJobRef = this.db.collection(`projects/${projectId}/jobs`).doc();
      await storyJobRef.set({
        type: 'storyboard',
        status: 'queued',
        inputPaths: photos.map((p) => p.objectPath),
        retryCount: 0,
        createdAt: new Date(),
      });

      await this.queueService.enqueue({
        url: '/internal/pipeline/storyboard',
        body: { projectId, jobId: storyJobRef.id },
      });
    } catch (err) {
      await this.handleStepError(projectId, jobId, err);
    }
  }

  async runStoryboard(projectId: string, jobId: string): Promise<void> {
    this.logger.log(`[${projectId}] Step: STORYBOARD (job=${jobId})`);
    await this.updateJob(projectId, jobId, 'running');
    await this.projectsService.updateStatus(projectId, 'processing', {
      currentStep: 'building storyboard',
    });

    try {
      const project = await this.projectsService.getById(projectId);
      const photos = await this.projectsService.getPhotos(projectId);
      const scenes = this.storyboardService.buildStoryboard(project, photos);

      this.logger.log(`[${projectId}] Storyboard: ${scenes.length} scenes planned`);
      for (const scene of scenes) {
        this.logger.log(
          `[${projectId}]   Scene ${scene.index}: type=${scene.type}, mode=${scene.generationMode}, duration=${scene.duration}s, photos=${scene.inputPhotos.length}`,
        );
      }

      await this.updateJob(projectId, jobId, 'completed');

      for (const scene of scenes) {
        const sceneJobRef = this.db.collection(`projects/${projectId}/jobs`).doc();
        await sceneJobRef.set({
          type: 'generate_scene',
          status: 'queued',
          sceneIndex: scene.index,
          prompt: scene.prompt,
          duration: scene.duration,
          inputPaths: scene.inputPhotos,
          retryCount: 0,
          createdAt: new Date(),
        });

        await this.queueService.enqueue({
          url: '/internal/pipeline/generate-scene',
          body: { projectId, jobId: sceneJobRef.id, sceneIndex: scene.index },
        });
      }

      await this.projectsService.updateStatus(projectId, 'processing', {
        currentStep: `generating 0/${scenes.length}`,
      });
    } catch (err) {
      await this.handleStepError(projectId, jobId, err);
    }
  }

  async runGenerateScene(
    projectId: string,
    jobId: string,
    sceneIndex: number,
  ): Promise<void> {
    this.logger.log(`[${projectId}] Step: GENERATE SCENE ${sceneIndex} (job=${jobId})`);
    await this.updateJob(projectId, jobId, 'running');

    try {
      const jobDoc = await this.db.doc(`projects/${projectId}/jobs/${jobId}`).get();
      const jobData = jobDoc.data() as JobEntity;
      const mode = jobData.inputPaths.length > 1 ? 'first_last_frame' : 'image_to_video';
      const duration = jobData.duration || 5;

      this.logger.log(`[${projectId}]   mode=${mode}, duration=${duration}s, prompt="${(jobData.prompt || '').slice(0, 80)}..."`);

      const operationId = await this.vertexAiService.generateVideo({
        index: sceneIndex,
        type: jobData.inputPaths.length > 1 ? 'transition' : 'single',
        inputPhotos: jobData.inputPaths,
        prompt: jobData.prompt || '',
        generationMode: mode,
        duration,
      });

      this.logger.log(`[${projectId}]   Veo operation ID: ${operationId}`);
      this.logger.log(`[${projectId}]   Check in GCP Console: https://console.cloud.google.com/vertex-ai/studio/media?project=${this.configService.get('GCP_PROJECT_ID')}`);

      await this.db.doc(`projects/${projectId}/jobs/${jobId}`).update({
        vertexOperationId: operationId,
      });

      const checkJobRef = this.db.collection(`projects/${projectId}/jobs`).doc();
      await checkJobRef.set({
        type: 'check_generation',
        status: 'queued',
        sceneIndex,
        vertexOperationId: operationId,
        inputPaths: jobData.inputPaths,
        retryCount: 0,
        createdAt: new Date(),
      });

      await this.queueService.enqueue({
        url: '/internal/pipeline/check-generation',
        body: { projectId, jobId: checkJobRef.id },
        delaySeconds: 30,
      });
      this.logger.log(`[${projectId}]   Polling scheduled in 30s (checkJob=${checkJobRef.id})`);
    } catch (err) {
      await this.handleStepError(projectId, jobId, err);
    }
  }

  async runCheckGeneration(projectId: string, jobId: string): Promise<void> {
    await this.updateJob(projectId, jobId, 'running');

    try {
      const jobDoc = await this.db.doc(`projects/${projectId}/jobs/${jobId}`).get();
      const jobData = jobDoc.data() as JobEntity;

      if (!jobData.vertexOperationId) {
        throw new Error('Missing vertexOperationId');
      }

      this.logger.log(`[${projectId}] Step: CHECK GENERATION scene=${jobData.sceneIndex} (operation=${jobData.vertexOperationId})`);

      const result = await this.vertexAiService.checkOperation(
        jobData.vertexOperationId,
      );

      if (result.error) {
        throw new Error(`Vertex AI error: ${result.error}`);
      }

      if (!result.done) {
        this.logger.log(`[${projectId}]   Scene ${jobData.sceneIndex}: still generating, re-check in 30s`);
        await this.updateJob(projectId, jobId, 'queued');
        await this.queueService.enqueue({
          url: '/internal/pipeline/check-generation',
          body: { projectId, jobId },
          delaySeconds: 30,
        });
        return;
      }

      this.logger.log(`[${projectId}]   Scene ${jobData.sceneIndex}: DONE! videoUri=${result.videoGcsUri}`);

      const clipPath = `projects/${projectId}/clips/scene-${jobData.sceneIndex}.mp4`;
      await this.vertexAiService.saveClipToGcs(result.videoGcsUri!, clipPath);
      this.logger.log(`[${projectId}]   Clip saved: ${clipPath}`);

      await this.db.doc(`projects/${projectId}/jobs/${jobId}`).update({
        status: 'completed',
        outputPath: clipPath,
        completedAt: new Date(),
      });

      await this.updateGenerationProgress(projectId);

      const allDone = await this.areAllScenesComplete(projectId);
      if (allDone) {
        this.logger.log(`[${projectId}]   All scenes complete! Starting assembly...`);
        await this.enqueueAssembly(projectId);
      }
    } catch (err) {
      await this.handleStepError(projectId, jobId, err);
    }
  }

  async runAssemble(projectId: string, jobId: string): Promise<void> {
    this.logger.log(`[${projectId}] Step: ASSEMBLE (job=${jobId})`);
    await this.updateJob(projectId, jobId, 'running');
    await this.projectsService.updateStatus(projectId, 'processing', {
      currentStep: 'assembling',
    });

    try {
      const clipPaths = await this.getCompletedClipPaths(projectId);
      this.logger.log(`[${projectId}]   Assembling ${clipPaths.length} clips: ${clipPaths.join(', ')}`);
      await this.assemblyService.assemble(projectId, clipPaths);
      await this.updateJob(projectId, jobId, 'completed');
      this.logger.log(`[${projectId}] === GENERATION COMPLETE ===`);
    } catch (err) {
      await this.handleStepError(projectId, jobId, err);
    }
  }

  async getResult(projectId: string, userId: string) {
    const project = await this.projectsService.get(projectId, userId);
    if (project.status !== 'completed' || !project.resultVideoPath) {
      return { status: project.status, currentStep: project.currentStep };
    }

    const downloadUrl = await this.storageService.generateSignedDownloadUrl(
      project.resultVideoPath,
    );

    return {
      status: project.status,
      videoUrl: downloadUrl,
      duration: project.resultDuration,
    };
  }

  private async updateJob(
    projectId: string,
    jobId: string,
    status: JobStatus,
  ): Promise<void> {
    const updates: Record<string, any> = { status };
    if (status === 'completed') updates.completedAt = new Date();
    await this.db.doc(`projects/${projectId}/jobs/${jobId}`).update(updates);
  }

  private async handleStepError(
    projectId: string,
    jobId: string,
    err: unknown,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    this.logger.error(`[${projectId}] === PIPELINE FAILED === job=${jobId}`);
    this.logger.error(`[${projectId}]   Error: ${message}`);
    if (stack) {
      this.logger.error(`[${projectId}]   Stack: ${stack.split('\n').slice(1, 4).join(' | ')}`);
    }

    await this.db.doc(`projects/${projectId}/jobs/${jobId}`).update({
      status: 'failed',
      error: message,
      completedAt: new Date(),
    });

    await this.projectsService.updateStatus(projectId, 'failed', {
      error: message,
      currentStep: 'failed',
    });
  }

  private async areAllScenesComplete(projectId: string): Promise<boolean> {
    const genJobs = await this.db
      .collection(`projects/${projectId}/jobs`)
      .where('type', '==', 'generate_scene')
      .get();

    const checkJobs = await this.db
      .collection(`projects/${projectId}/jobs`)
      .where('type', '==', 'check_generation')
      .get();

    const totalScenes = genJobs.size;
    const completedChecks = checkJobs.docs.filter(
      (d) => d.data().status === 'completed',
    ).length;

    return completedChecks >= totalScenes;
  }

  private async updateGenerationProgress(projectId: string): Promise<void> {
    const genJobs = await this.db
      .collection(`projects/${projectId}/jobs`)
      .where('type', '==', 'generate_scene')
      .get();

    const checkJobs = await this.db
      .collection(`projects/${projectId}/jobs`)
      .where('type', '==', 'check_generation')
      .where('status', '==', 'completed')
      .get();

    await this.projectsService.updateStatus(projectId, 'processing', {
      currentStep: `generating ${checkJobs.size}/${genJobs.size}`,
    });
  }

  private async getCompletedClipPaths(projectId: string): Promise<string[]> {
    const checkJobs = await this.db
      .collection(`projects/${projectId}/jobs`)
      .where('type', '==', 'check_generation')
      .where('status', '==', 'completed')
      .orderBy('sceneIndex')
      .get();

    return checkJobs.docs
      .map((d) => d.data().outputPath as string)
      .filter(Boolean);
  }

  private async enqueueAssembly(projectId: string): Promise<void> {
    const jobRef = this.db.collection(`projects/${projectId}/jobs`).doc();
    await jobRef.set({
      type: 'assemble',
      status: 'queued',
      inputPaths: [],
      retryCount: 0,
      createdAt: new Date(),
    });

    await this.queueService.enqueue({
      url: '/internal/pipeline/assemble',
      body: { projectId, jobId: jobRef.id },
    });
  }
}
