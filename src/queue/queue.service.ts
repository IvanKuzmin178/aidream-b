import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudTasksClient } from '@google-cloud/tasks';

export interface TaskPayload {
  url: string;
  body: Record<string, any>;
  delaySeconds?: number;
}

@Injectable()
export class QueueService implements OnModuleInit {
  private readonly logger = new Logger(QueueService.name);
  private client!: CloudTasksClient;
  private queuePath!: string;
  private backendUrl!: string;
  private serviceAccountEmail: string | undefined;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.client = new CloudTasksClient();

    const projectId = this.configService.get<string>('GCP_PROJECT_ID')!;
    const location = this.configService.get<string>('CLOUD_TASKS_LOCATION', 'us-central1');
    const queue = this.configService.get<string>('CLOUD_TASKS_QUEUE', 'aidream-pipeline');

    this.queuePath = this.client.queuePath(projectId, location, queue);
    this.backendUrl = this.configService.get<string>('BACKEND_URL', 'http://localhost:8080');
    this.serviceAccountEmail = this.configService.get<string>('CLOUD_TASKS_SA_EMAIL');

    this.logger.log(`Cloud Tasks queue: ${this.queuePath}`);
  }

  async enqueue(task: TaskPayload): Promise<string> {
    const env = this.configService.get<string>('NODE_ENV', 'development');

    if (env !== 'production') {
      return this.enqueueLocal(task);
    }

    const fullUrl = `${this.backendUrl}${task.url}`;
    const body = Buffer.from(JSON.stringify(task.body)).toString('base64');

    const request: any = {
      parent: this.queuePath,
      task: {
        httpRequest: {
          httpMethod: 'POST' as const,
          url: fullUrl,
          headers: { 'Content-Type': 'application/json' },
          body,
        },
      },
    };

    if (this.serviceAccountEmail) {
      request.task.httpRequest.oidcToken = {
        serviceAccountEmail: this.serviceAccountEmail,
        audience: this.backendUrl,
      };
    }

    if (task.delaySeconds) {
      request.task.scheduleTime = {
        seconds: Math.floor(Date.now() / 1000) + task.delaySeconds,
      };
    }

    const [response] = await this.client.createTask(request);
    this.logger.log(`Task enqueued: ${response.name}`);
    return response.name!;
  }

  /**
   * Local dev: call the internal endpoint directly via HTTP instead of Cloud Tasks.
   */
  private async enqueueLocal(task: TaskPayload): Promise<string> {
    const fullUrl = `${this.backendUrl}${task.url}`;
    this.logger.log(`[DEV] Calling local endpoint: ${fullUrl}`);

    const delay = (task.delaySeconds || 0) * 1000;

    setTimeout(async () => {
      try {
        const response = await fetch(fullUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(task.body),
        });
        if (!response.ok) {
          this.logger.error(`[DEV] Task failed: ${response.status} ${await response.text()}`);
        }
      } catch (err) {
        this.logger.error(`[DEV] Task call failed: ${err}`);
      }
    }, delay);

    return `local-task-${Date.now()}`;
  }
}
