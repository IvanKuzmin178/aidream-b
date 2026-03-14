import { Injectable } from '@nestjs/common';
import { VERTEX_AI_MODELS, ModelInfo, OutputType } from './vertex-ai-models.constants';

@Injectable()
export class ModelsService {
  list(outputType?: OutputType): ModelInfo[] {
    if (outputType) {
      return VERTEX_AI_MODELS.filter((m) => m.outputType === outputType);
    }
    return [...VERTEX_AI_MODELS];
  }

  getDefault(outputType: OutputType): string {
    const def = VERTEX_AI_MODELS.find(
      (m) => m.outputType === outputType && m.isDefault,
    );
    return def?.id ?? VERTEX_AI_MODELS.filter((m) => m.outputType === outputType)[0]?.id ?? '';
  }
}
