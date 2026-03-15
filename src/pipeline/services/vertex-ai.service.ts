import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../../storage/storage.service';
import { SceneEntity } from '../entities/scene.entity';
import { DEFAULT_VIDEO_MODEL } from '../../models/vertex-ai-models.constants';

export interface OperationResult {
  done: boolean;
  videoGcsUri?: string;
  error?: string;
}

export interface ImageGenerationResult {
  bytesBase64: string;
  mimeType: string;
}

export interface AudioGenerationResult {
  bytesBase64: string;
  mimeType: string;
}

@Injectable()
export class VertexAiService implements OnModuleInit {
  private readonly logger = new Logger(VertexAiService.name);
  private projectId!: string;
  private region!: string;
  private defaultModel!: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {}

  onModuleInit() {
    this.projectId = this.configService.get<string>('GCP_PROJECT_ID')!;
    this.region = this.configService.get<string>('GCP_REGION', 'us-central1');
    this.defaultModel = DEFAULT_VIDEO_MODEL;
  }

  private modelOrDefault(modelId?: string): string {
    return modelId || this.defaultModel;
  }

  private get visionModel(): string {
    return this.configService.get<string>(
      'PHOTO_ANALYSIS_MODEL',
      'gemini-2.0-flash-001',
    );
  }

  /**
   * Analyzes a photo with Gemini Vision and returns a short description
   * for use in video prompt generation.
   */
  async analyzePhotoForVideo(
    imageGcsPath: string,
    analysisPrompt: string,
  ): Promise<string> {
    const model = this.visionModel;
    const endpoint = `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${model}:generateContent`;

    const imageBase64 = await this.downloadAsBase64(imageGcsPath);
    const mimeType = this.guessMimeType(imageGcsPath);

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
            { text: analysisPrompt },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 256,
      },
    };

    this.logger.log(`[Gemini] Analyzing photo for video prompt: ${imageGcsPath}`);
    const token = await this.getAccessToken();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`[Gemini] Analysis FAILED: ${response.status} ${text.slice(0, 300)}`);
      throw new Error(`Photo analysis failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      throw new Error('No text in Gemini response');
    }
    this.logger.log(`[Gemini] Description: "${text.slice(0, 80)}..."`);
    return text;
  }

  async generateVideo(
    scene: SceneEntity,
    modelId?: string,
    storagePrefix?: string,
  ): Promise<string> {
    const model = this.modelOrDefault(modelId);
    const endpoint = `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${model}:predictLongRunning`;

    this.logger.log(`[Veo] Preparing scene ${scene.index}: mode=${scene.generationMode}, duration=${scene.duration}s, model=${model}`);
    if (scene.generationMode !== 'text_to_video') {
      for (const photo of scene.inputPhotos) {
        const exists = await this.storageService.fileExists(photo);
        this.logger.log(`[Veo]   Photo: ${photo} (exists=${exists})`);
        if (!exists) {
          throw new Error(`Photo not found in GCS: ${photo}`);
        }
      }
    }

    const body = await this.buildRequestBody(scene, storagePrefix);
    this.logger.log(`[Veo] Sending predictLongRunning request to ${model}...`);
    this.logger.log(`[Veo]   prompt: "${scene.prompt.slice(0, 100)}..."`);
    this.logger.log(`[Veo]   params: sampleCount=${body.parameters.sampleCount}, duration=${body.parameters.durationSeconds}s, storageUri=${body.parameters.storageUri}`);

    const token = await this.getAccessToken();

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`[Veo] Request FAILED: ${response.status}`);
      this.logger.error(`[Veo]   Response: ${text.slice(0, 500)}`);
      throw new Error(`Vertex AI request failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    this.logger.log(`[Veo] Operation CREATED: ${data.name}`);
    this.logger.log(`[Veo]   Manual check: curl -X POST ... models/${model}:fetchPredictOperation"`);
    return data.name;
  }

  async checkOperation(operationId: string, modelId?: string): Promise<OperationResult> {
    const model = this.modelOrDefault(modelId);
    const endpoint = `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${model}:fetchPredictOperation`;
    const token = await this.getAccessToken();

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ operationName: operationId }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Operation check failed: ${response.status} ${text}`);
    }

    const data = await response.json();

    if (data.error) {
      this.logger.error(`[Veo] Operation error: ${JSON.stringify(data.error)}`);
    } else if (data.done) {
      const videos = data.response?.videos || [];
      this.logger.log(`[Veo] Operation COMPLETE: ${videos.length} video(s) generated`);
      for (const v of videos) {
        this.logger.log(`[Veo]   Video: ${v.gcsUri} (${v.mimeType})`);
      }
      if (data.response?.raiMediaFilteredCount > 0) {
        this.logger.warn(`[Veo]   RAI filtered: ${data.response.raiMediaFilteredCount} video(s) blocked by content policy`);
      }
    } else {
      this.logger.log(`[Veo] Operation in progress...`);
    }

    return {
      done: !!data.done,
      videoGcsUri: data.response?.videos?.[0]?.gcsUri,
      error: data.error?.message,
    };
  }

  async saveClipToGcs(videoGcsUri: string, destPath: string): Promise<void> {
    const bucket = this.storageService.getBucket();
    const bucketName = this.configService.get('GCS_BUCKET');

    if (videoGcsUri.startsWith(`gs://${bucketName}/`)) {
      const srcPath = videoGcsUri.replace(`gs://${bucketName}/`, '');
      await this.storageService.copyFile(srcPath, destPath);
      this.logger.log(`Clip copied within bucket: ${srcPath} -> ${destPath}`);
      return;
    }

    const match = videoGcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (match) {
      const [, srcBucket, srcPath] = match;
      const storage = bucket.storage;
      const srcFile = storage.bucket(srcBucket).file(srcPath);
      await srcFile.copy(bucket.file(destPath));
      this.logger.log(`Clip copied cross-bucket: ${videoGcsUri} -> ${destPath}`);
      return;
    }

    throw new Error(`Unexpected video URI format: ${videoGcsUri}`);
  }

  async generateImage(prompt: string, modelId: string): Promise<ImageGenerationResult> {
    const endpoint = `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${modelId}:predict`;
    this.logger.log(`[Imagen] Generating image with model ${modelId}`);

    const token = await this.getAccessToken();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1 },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`[Imagen] Request FAILED: ${response.status} ${text.slice(0, 500)}`);
      throw new Error(`Imagen request failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    const pred = data.predictions?.[0];
    if (!pred?.bytesBase64Encoded) {
      throw new Error('No image in Imagen response');
    }
    this.logger.log(`[Imagen] Image generated (${pred.mimeType || 'image/png'})`);
    return {
      bytesBase64: pred.bytesBase64Encoded,
      mimeType: pred.mimeType || 'image/png',
    };
  }

  async generateAudio(prompt: string, modelId: string): Promise<AudioGenerationResult> {
    const endpoint = `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${modelId}:predict`;
    this.logger.log(`[Lyria] Generating audio with model ${modelId}`);

    const token = await this.getAccessToken();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {},
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`[Lyria] Request FAILED: ${response.status} ${text.slice(0, 500)}`);
      throw new Error(`Lyria request failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    const pred = data.predictions?.[0];
    if (!pred?.audioContent) {
      throw new Error('No audio in Lyria response');
    }
    this.logger.log(`[Lyria] Audio generated (${pred.mimeType || 'audio/wav'})`);
    return {
      bytesBase64: pred.audioContent,
      mimeType: pred.mimeType || 'audio/wav',
    };
  }

  async saveMediaToGcs(
    bytesBase64: string,
    destPath: string,
    mimeType: string,
  ): Promise<void> {
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('wav') ? 'wav' : 'jpg';
    const bucket = this.storageService.getBucket();
    const file = bucket.file(destPath.endsWith(`.${ext}`) ? destPath : `${destPath}.${ext}`);
    const buf = Buffer.from(bytesBase64, 'base64');
    await file.save(buf, { contentType: mimeType });
    this.logger.log(`Media saved: ${file.name}`);
  }

  private async buildRequestBody(scene: SceneEntity, storagePrefix?: string) {
    const bucket = this.configService.get('GCS_BUCKET');
    const storageUri = storagePrefix
      ? `gs://${bucket}/${storagePrefix}/veo-output/`
      : `gs://${bucket}/veo-output`;

    const instance: Record<string, any> = {
      prompt: scene.prompt,
    };

    if (scene.generationMode !== 'text_to_video' && scene.inputPhotos.length > 0) {
      const firstImageBase64 = await this.downloadAsBase64(scene.inputPhotos[0]);
      instance.image = {
        bytesBase64Encoded: firstImageBase64,
        mimeType: this.guessMimeType(scene.inputPhotos[0]),
      };

      if (scene.inputPhotos.length > 1 && scene.generationMode === 'first_last_frame') {
        const lastImageBase64 = await this.downloadAsBase64(scene.inputPhotos[1]);
        instance.lastFrame = {
          bytesBase64Encoded: lastImageBase64,
          mimeType: this.guessMimeType(scene.inputPhotos[1]),
        };
      }
    }

    return {
      instances: [instance],
      parameters: {
        sampleCount: 1,
        durationSeconds: scene.duration,
        storageUri,
      },
    };
  }

  private async downloadAsBase64(objectPath: string): Promise<string> {
    const bucket = this.storageService.getBucket();
    const [buffer] = await bucket.file(objectPath).download();
    return buffer.toString('base64');
  }

  private guessMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
    };
    return mimeTypes[ext || ''] || 'image/jpeg';
  }

  private async getAccessToken(): Promise<string> {
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token.token!;
  }
}
