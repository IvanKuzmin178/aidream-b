import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../firebase/firebase.service';
import { StorageService } from '../storage/storage.service';
import { ProjectsService } from '../projects/projects.service';
import { CreditsService } from '../credits/credits.service';
import { UsersService } from '../users/users.service';
import { QueueService } from '../queue/queue.service';
import { PreprocessService } from './services/preprocess.service';
import { StoryboardService } from './services/storyboard.service';
import { VertexAiService } from './services/vertex-ai.service';
import { AssemblyService } from './services/assembly.service';
import { JobEntity, JobStatus } from './entities/job.entity';
import { getStoragePrefix } from '../projects/utils/storage-path.util';

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly storageService: StorageService,
    private readonly projectsService: ProjectsService,
    private readonly creditsService: CreditsService,
    private readonly usersService: UsersService,
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

    const outputType = project.outputType || 'video';
    const genType = project.generationType || 'image_to_video';

    if (outputType === 'image') {
      return this.startImageGeneration(projectId, userId, project);
    }
    if (outputType === 'audio') {
      return this.startAudioGeneration(projectId, userId, project);
    }
    if (genType === 'text_to_video') {
      return this.startTextToVideo(projectId, userId, project);
    }
    return this.startImageToVideo(projectId, userId, project);
  }

  private async startImageToVideo(
    projectId: string,
    userId: string,
    project: Awaited<ReturnType<ProjectsService['get']>>,
  ): Promise<{ jobId: string }> {
    await this.usersService.getOrCreateUser(userId);
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

    const cost = this.creditsService.calculateCost(project.style, project.photoCount, 'image_to_video');
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

    this.logger.log(`[${projectId}] Pipeline queued (image_to_video), first job=${jobRef.id}`);
    return { jobId: jobRef.id };
  }

  private async startTextToVideo(
    projectId: string,
    userId: string,
    project: Awaited<ReturnType<ProjectsService['get']>>,
  ): Promise<{ jobId: string }> {
    await this.usersService.getOrCreateUser(userId);
    if (!project.prompt?.trim()) {
      throw new BadRequestException('A text prompt is required for text-to-video generation');
    }

    if (project.status !== 'draft') {
      throw new BadRequestException('Project must be in draft status to generate');
    }

    const cost = this.creditsService.calculateCost(project.style, 0, 'text_to_video');
    await this.creditsService.deductCredits(userId, cost, projectId);
    this.logger.log(`[${projectId}] Credits deducted: ${cost} (text_to_video, style=${project.style})`);

    await this.projectsService.updateStatus(projectId, 'processing', {
      creditsCost: cost,
      currentStep: 'generating 0/1',
    });

    const style = { memory: 5, cinematic: 6, dream: 5 }[project.style] || 5;

    const jobRef = this.db.collection(`projects/${projectId}/jobs`).doc();
    await jobRef.set({
      type: 'generate_scene',
      status: 'queued',
      sceneIndex: 0,
      prompt: project.prompt,
      duration: style,
      inputPaths: [],
      modelId: project.modelId,
      retryCount: 0,
      createdAt: new Date(),
    });

    await this.queueService.enqueue({
      url: '/internal/pipeline/generate-scene',
      body: { projectId, jobId: jobRef.id, sceneIndex: 0 },
    });

    this.logger.log(`[${projectId}] Pipeline queued (text_to_video), job=${jobRef.id}`);
    return { jobId: jobRef.id };
  }

  private async startImageGeneration(
    projectId: string,
    userId: string,
    project: Awaited<ReturnType<ProjectsService['get']>>,
  ): Promise<{ jobId: string }> {
    await this.usersService.getOrCreateUser(userId);
    if (!project.prompt?.trim()) {
      throw new BadRequestException('A text prompt is required for image generation');
    }
    if (project.status !== 'draft') {
      throw new BadRequestException('Project must be in draft status');
    }
    const cost = this.creditsService.calculateCost(project.style, 0, 'image');
    await this.creditsService.deductCredits(userId, cost, projectId);
    await this.projectsService.updateStatus(projectId, 'processing', {
      creditsCost: cost,
      currentStep: 'generating image',
    });
    const jobRef = this.db.collection(`projects/${projectId}/jobs`).doc();
    await jobRef.set({
      type: 'generate_image',
      status: 'queued',
      prompt: project.prompt,
      modelId: project.modelId,
      retryCount: 0,
      createdAt: new Date(),
    });
    await this.queueService.enqueue({
      url: '/internal/pipeline/generate-image',
      body: { projectId, jobId: jobRef.id },
    });
    this.logger.log(`[${projectId}] Pipeline queued (image), job=${jobRef.id}`);
    return { jobId: jobRef.id };
  }

  private async startAudioGeneration(
    projectId: string,
    userId: string,
    project: Awaited<ReturnType<ProjectsService['get']>>,
  ): Promise<{ jobId: string }> {
    await this.usersService.getOrCreateUser(userId);
    if (!project.prompt?.trim()) {
      throw new BadRequestException('A text prompt is required for audio generation');
    }
    if (project.status !== 'draft') {
      throw new BadRequestException('Project must be in draft status');
    }
    const cost = this.creditsService.calculateCost(project.style, 0, 'audio');
    await this.creditsService.deductCredits(userId, cost, projectId);
    await this.projectsService.updateStatus(projectId, 'processing', {
      creditsCost: cost,
      currentStep: 'generating audio',
    });
    const jobRef = this.db.collection(`projects/${projectId}/jobs`).doc();
    await jobRef.set({
      type: 'generate_audio',
      status: 'queued',
      prompt: project.prompt,
      modelId: project.modelId,
      retryCount: 0,
      createdAt: new Date(),
    });
    await this.queueService.enqueue({
      url: '/internal/pipeline/generate-audio',
      body: { projectId, jobId: jobRef.id },
    });
    this.logger.log(`[${projectId}] Pipeline queued (audio), job=${jobRef.id}`);
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
          modelId: project.modelId,
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
      const hasPhotos = jobData.inputPaths && jobData.inputPaths.length > 0;
      const mode = !hasPhotos
        ? 'text_to_video' as const
        : jobData.inputPaths.length > 1
          ? 'first_last_frame' as const
          : 'image_to_video' as const;
      const duration = jobData.duration || 5;

      this.logger.log(`[${projectId}]   mode=${mode}, duration=${duration}s, prompt="${(jobData.prompt || '').slice(0, 80)}..."`);

      const project = await this.projectsService.getById(projectId);
      const modelId = jobData.modelId || project.modelId;
      const storagePrefix = getStoragePrefix(project);

      const operationId = await this.vertexAiService.generateVideo(
        {
          index: sceneIndex,
          type: hasPhotos && jobData.inputPaths.length > 1 ? 'transition' : 'single',
          inputPhotos: jobData.inputPaths || [],
          prompt: jobData.prompt || '',
          generationMode: mode,
          duration,
        },
        modelId,
        storagePrefix,
      );

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
        modelId,
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

      const project = await this.projectsService.getById(projectId);
      const modelId = jobData.modelId || project.modelId;

      const result = await this.vertexAiService.checkOperation(
        jobData.vertexOperationId,
        modelId,
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

      const prefix = getStoragePrefix(project);
      const clipPath = `${prefix}/clips/scene-${jobData.sceneIndex}.mp4`;
      await this.vertexAiService.saveClipToGcs(result.videoGcsUri!, clipPath);
      this.logger.log(`[${projectId}]   Clip saved: ${clipPath}`);

      await this.db.doc(`projects/${projectId}/jobs/${jobId}`).update({
        status: 'completed',
        outputPath: clipPath,
        completedAt: new Date(),
      });

      await this.updateGenerationProgress(projectId);

      const proj = await this.projectsService.getById(projectId);
      if (proj.generationType === 'text_to_video') {
        const finalPath = `${getStoragePrefix(proj)}/output/final.mp4`;
        await this.storageService.copyFile(clipPath, finalPath);
        await this.projectsService.updateStatus(projectId, 'completed', {
          resultVideoPath: finalPath,
          currentStep: 'completed',
        });
        this.logger.log(`[${projectId}] === TEXT-TO-VIDEO COMPLETE === ${finalPath}`);
      } else {
        const allDone = await this.areAllScenesComplete(projectId);
        if (allDone) {
          this.logger.log(`[${projectId}]   All scenes complete! Starting assembly...`);
          await this.enqueueAssembly(projectId);
        }
      }
    } catch (err) {
      await this.handleStepError(projectId, jobId, err);
    }
  }

  async runGenerateImage(projectId: string, jobId: string): Promise<void> {
    this.logger.log(`[${projectId}] Step: GENERATE IMAGE (job=${jobId})`);
    await this.updateJob(projectId, jobId, 'running');

    try {
      const jobDoc = await this.db.doc(`projects/${projectId}/jobs/${jobId}`).get();
      const jobData = jobDoc.data() as JobEntity;
      const { prompt, modelId } = jobData;

      if (!prompt?.trim() || !modelId) {
        throw new Error('Missing prompt or modelId for image generation');
      }

      const project = await this.projectsService.getById(projectId);
      const prefix = getStoragePrefix(project);
      const result = await this.vertexAiService.generateImage(prompt, modelId);
      const destPath = `${prefix}/output/image.png`;
      await this.vertexAiService.saveMediaToGcs(
        result.bytesBase64,
        destPath,
        result.mimeType,
      );

      await this.db.doc(`projects/${projectId}/jobs/${jobId}`).update({
        status: 'completed',
        outputPath: destPath,
        completedAt: new Date(),
      });

      await this.projectsService.updateStatus(projectId, 'completed', {
        resultImagePath: destPath,
        currentStep: 'completed',
      });
      this.logger.log(`[${projectId}] === IMAGE GENERATION COMPLETE === ${destPath}`);
    } catch (err) {
      await this.handleStepError(projectId, jobId, err);
    }
  }

  async runGenerateAudio(projectId: string, jobId: string): Promise<void> {
    this.logger.log(`[${projectId}] Step: GENERATE AUDIO (job=${jobId})`);
    await this.updateJob(projectId, jobId, 'running');

    try {
      const jobDoc = await this.db.doc(`projects/${projectId}/jobs/${jobId}`).get();
      const jobData = jobDoc.data() as JobEntity;
      const { prompt, modelId } = jobData;

      if (!prompt?.trim() || !modelId) {
        throw new Error('Missing prompt or modelId for audio generation');
      }

      const project = await this.projectsService.getById(projectId);
      const prefix = getStoragePrefix(project);
      const result = await this.vertexAiService.generateAudio(prompt, modelId);
      const destPath = `${prefix}/output/audio.wav`;
      await this.vertexAiService.saveMediaToGcs(
        result.bytesBase64,
        destPath,
        result.mimeType,
      );

      await this.db.doc(`projects/${projectId}/jobs/${jobId}`).update({
        status: 'completed',
        outputPath: destPath,
        completedAt: new Date(),
      });

      await this.projectsService.updateStatus(projectId, 'completed', {
        resultAudioPath: destPath,
        currentStep: 'completed',
      });
      this.logger.log(`[${projectId}] === AUDIO GENERATION COMPLETE === ${destPath}`);
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
    if (project.status !== 'completed') {
      return { status: project.status, currentStep: project.currentStep };
    }
    if (project.resultVideoPath) {
      const downloadUrl = await this.storageService.generateSignedDownloadUrl(
        project.resultVideoPath,
      );
      return {
        status: project.status,
        videoUrl: downloadUrl,
        duration: project.resultDuration,
      };
    }
    if (project.resultImagePath) {
      const imageUrl = await this.storageService.generateSignedDownloadUrl(
        project.resultImagePath,
      );
      return { status: project.status, imageUrl };
    }
    if (project.resultAudioPath) {
      const audioUrl = await this.storageService.generateSignedDownloadUrl(
        project.resultAudioPath,
      );
      return { status: project.status, audioUrl };
    }
    return { status: project.status, currentStep: project.currentStep };
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

    const checkJobsSnap = await this.db
      .collection(`projects/${projectId}/jobs`)
      .where('type', '==', 'check_generation')
      .get();

    const completedCount = checkJobsSnap.docs.filter(
      (d) => d.data().status === 'completed',
    ).length;

    await this.projectsService.updateStatus(projectId, 'processing', {
      currentStep: `generating ${completedCount}/${genJobs.size}`,
    });
  }

  private async getCompletedClipPaths(projectId: string): Promise<string[]> {
    const checkJobs = await this.db
      .collection(`projects/${projectId}/jobs`)
      .where('type', '==', 'check_generation')
      .get();

    return checkJobs.docs
      .filter((d) => d.data().status === 'completed')
      .map((d) => ({ sceneIndex: d.data().sceneIndex as number, path: d.data().outputPath as string }))
      .filter((x) => x.path)
      .sort((a, b) => a.sceneIndex - b.sceneIndex)
      .map((x) => x.path);
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
