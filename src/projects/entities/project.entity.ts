export type ProjectStyle = 'memory' | 'cinematic' | 'dream';
export type GenerationType = 'image_to_video' | 'text_to_video';
export type OutputType = 'video' | 'image' | 'audio';
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
  outputType: OutputType;
  generationType?: GenerationType;
  modelId: string;
  status: ProjectStatus;
  photoCount: number;
  creditsCost: number;
  currentStep: string;
  prompt?: string;
  createdAt: Date;
  updatedAt: Date;
  storagePrefix?: string;
  resultVideoPath?: string;
  resultImagePath?: string;
  resultAudioPath?: string;
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
