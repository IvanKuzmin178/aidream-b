import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../../storage/storage.service';
import { SceneEntity } from '../entities/scene.entity';

export interface OperationResult {
  done: boolean;
  videoUri?: string;
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

    const body = this.buildRequestBody(scene);
    this.logger.log(`Veo request body: ${JSON.stringify(body, null, 2)}`);

    for (const photo of scene.inputPhotos) {
      const exists = await this.storageService.fileExists(photo);
      this.logger.log(`File check: ${photo} exists=${exists}`);
    }

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
      throw new Error(`Vertex AI request failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    this.logger.log(`Vertex AI operation started: ${data.name}`);
    return data.name;
  }

  async checkOperation(operationId: string): Promise<OperationResult> {
    const url = `https://${this.region}-aiplatform.googleapis.com/v1/${operationId}`;
    const token = await this.getAccessToken();

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Operation check failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      done: !!data.done,
      videoUri: data.response?.videoUri,
      error: data.error?.message,
    };
  }

  async saveClipToGcs(videoUri: string, destPath: string): Promise<void> {
    const token = await this.getAccessToken();
    const response = await fetch(videoUri, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const bucket = this.storageService.getBucket();
    const file = bucket.file(destPath);
    await file.save(buffer, { contentType: 'video/mp4' });

    this.logger.log(`Clip saved to GCS: ${destPath}`);
  }

  private buildRequestBody(scene: SceneEntity) {
    const inputImage = scene.inputPhotos[0];
    const lastImage = scene.inputPhotos.length > 1 ? scene.inputPhotos[1] : undefined;
    const bucket = this.configService.get('GCS_BUCKET');

    const request: Record<string, any> = {
      instances: [
        {
          prompt: scene.prompt,
          image: {
            gcsUri: `gs://${bucket}/${inputImage}`,
            mimeType: this.guessMimeType(inputImage),
          },
        },
      ],
      parameters: {
        sampleCount: 1,
        durationSeconds: scene.duration,
      },
    };

    if (lastImage && scene.generationMode === 'first_last_frame') {
      request.instances[0].lastFrame = {
        image: {
          gcsUri: `gs://${bucket}/${lastImage}`,
          mimeType: this.guessMimeType(lastImage),
        },
      };
    }

    return request;
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
