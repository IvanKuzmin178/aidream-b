/**
 * Vertex AI generative models catalog.
 * https://cloud.google.com/vertex-ai/generative-ai/docs/models
 */
export type OutputType = 'video' | 'image' | 'audio';

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  outputType: OutputType;
  isDefault?: boolean;
}

export const DEFAULT_VIDEO_MODEL = 'veo-2.0-generate-001';

export const VERTEX_AI_MODELS: ModelInfo[] = [
  // Video (Veo)
  {
    id: 'veo-2.0-generate-001',
    name: 'Veo 2',
    description: '720p, 5–8s, stable video generation',
    outputType: 'video',
    isDefault: true,
  },
  {
    id: 'veo-2.0-generate-exp',
    name: 'Veo 2 Experimental',
    description: 'Experimental features under test',
    outputType: 'video',
  },
  {
    id: 'veo-2.0-generate-preview',
    name: 'Veo 2 Preview',
    description: 'Preview with inpaint/outpaint support',
    outputType: 'video',
  },
  {
    id: 'veo-3.0-generate-001',
    name: 'Veo 3',
    description: '1080p, high quality, with audio',
    outputType: 'video',
  },
  {
    id: 'veo-3.0-fast-generate-001',
    name: 'Veo 3 Fast',
    description: '1080p, fast generation',
    outputType: 'video',
  },
  {
    id: 'veo-3.1-generate-001',
    name: 'Veo 3.1',
    description: 'Latest high quality',
    outputType: 'video',
  },
  {
    id: 'veo-3.1-fast-generate-001',
    name: 'Veo 3.1 Fast',
    description: 'Latest fast generation',
    outputType: 'video',
  },
  // Image (Imagen)
  {
    id: 'imagen-4.0-generate-001',
    name: 'Imagen 4',
    description: 'Highest quality text-to-image',
    outputType: 'image',
    isDefault: true,
  },
  {
    id: 'imagen-4.0-fast-generate-001',
    name: 'Imagen 4 Fast',
    description: 'Fast image generation',
    outputType: 'image',
  },
  {
    id: 'imagen-4.0-ultra-generate-001',
    name: 'Imagen 4 Ultra',
    description: 'Best prompt adherence',
    outputType: 'image',
  },
  {
    id: 'imagen-3.0-generate-002',
    name: 'Imagen 3 (002)',
    description: 'Stable image generation',
    outputType: 'image',
  },
  {
    id: 'imagen-3.0-generate-001',
    name: 'Imagen 3 (001)',
    description: 'Text-to-image',
    outputType: 'image',
  },
  {
    id: 'imagen-3.0-fast-generate-001',
    name: 'Imagen 3 Fast',
    description: 'Lower latency',
    outputType: 'image',
  },
  // Audio (Lyria)
  {
    id: 'lyria-002',
    name: 'Lyria 2',
    description: 'Instrumental music from text (30s WAV)',
    outputType: 'audio',
    isDefault: true,
  },
];
