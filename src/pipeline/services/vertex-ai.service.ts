import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../../storage/storage.service';
import { SceneEntity } from '../entities/scene.entity';

export interface OperationResult {
  done: boolean;
  videoGcsUri?: string;
  error?: string;
}

@Injectable()
export class VertexAiService implements OnModuleInit {
  private readonly logger = new Logger(VertexAiService.name);
  private projectId!: string;
  private region!: string;
  private model!: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {}

  onModuleInit() {
    this.projectId = this.configService.get<string>('GCP_PROJECT_ID')!;
    this.region = this.configService.get<string>('GCP_REGION', 'us-central1');
    this.model = this.configService.get<string>('VERTEX_AI_MODEL', 'veo-2.0-generate-001');
  }

  async generateVideo(scene: SceneEntity): Promise<string> {
    const endpoint = `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${this.model}:predictLongRunning`;

    this.logger.log(`[Veo] Preparing scene ${scene.index}: mode=${scene.generationMode}, duration=${scene.duration}s`);
    for (const photo of scene.inputPhotos) {
      const exists = await this.storageService.fileExists(photo);
      this.logger.log(`[Veo]   Photo: ${photo} (exists=${exists})`);
      if (!exists) {
        throw new Error(`Photo not found in GCS: ${photo}`);
      }
    }

    const body = await this.buildRequestBody(scene);
    this.logger.log(`[Veo] Sending predictLongRunning request to ${this.model}...`);
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
    this.logger.log(`[Veo]   Manual check: curl -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" -d '{"operationName":"${data.name}"}' "https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${this.model}:fetchPredictOperation"`);
    return data.name;
  }

  async checkOperation(operationId: string): Promise<OperationResult> {
    const endpoint = `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${this.model}:fetchPredictOperation`;
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

  private async buildRequestBody(scene: SceneEntity) {
    const firstImageBase64 = await this.downloadAsBase64(scene.inputPhotos[0]);
    const bucket = this.configService.get('GCS_BUCKET');
    const storageUri = `gs://${bucket}/veo-output`;

    const request: Record<string, any> = {
      instances: [
        {
          prompt: scene.prompt,
          image: {
            bytesBase64Encoded: firstImageBase64,
            mimeType: this.guessMimeType(scene.inputPhotos[0]),
          },
        },
      ],
      parameters: {
        sampleCount: 1,
        durationSeconds: scene.duration,
        storageUri,
      },
    };

    if (scene.inputPhotos.length > 1 && scene.generationMode === 'first_last_frame') {
      const lastImageBase64 = await this.downloadAsBase64(scene.inputPhotos[1]);
      request.instances[0].lastFrame = {
        bytesBase64Encoded: lastImageBase64,
        mimeType: this.guessMimeType(scene.inputPhotos[1]),
      };
    }

    return request;
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
