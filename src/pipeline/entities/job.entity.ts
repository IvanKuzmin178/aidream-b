export type JobType =
  | 'preprocess'
  | 'storyboard'
  | 'generate_scene'
  | 'check_generation'
  | 'assemble';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface JobEntity {
  id: string;
  type: JobType;
  status: JobStatus;
  sceneIndex?: number;
  prompt?: string;
  duration?: number;
  inputPaths: string[];
  outputPath?: string;
  vertexOperationId?: string;
  retryCount: number;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}
