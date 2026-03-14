export interface SceneEntity {
  index: number;
  type: 'transition' | 'single';
  inputPhotos: string[];
  prompt: string;
  generationMode: 'first_last_frame' | 'image_to_video' | 'text_to_video';
  duration: number;
}
