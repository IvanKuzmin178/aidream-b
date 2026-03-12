export type ProjectStyle = 'memory' | 'cinematic' | 'dream';
export type ProjectStatus =
  | 'draft'
  | 'uploaded'
  | 'processing'
  | 'completed'
  | 'failed';

export interface ProjectEntity {
  id: string;
  userId: string;
  title: string;
  style: ProjectStyle;
  status: ProjectStatus;
  photoCount: number;
  creditsCost: number;
  currentStep: string;
  createdAt: Date;
  updatedAt: Date;
  resultVideoPath?: string;
  resultDuration?: number;
  error?: string;
}

export interface PhotoEntity {
  id: string;
  objectPath: string;
  originalName: string;
  contentType: string;
  size: number;
  order: number;
  qualityScore?: number;
  isSelected?: boolean;
}
