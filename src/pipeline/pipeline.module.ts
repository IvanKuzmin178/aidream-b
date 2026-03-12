import { Module } from '@nestjs/common';
import { PipelineController } from './pipeline.controller';
import { PipelineService } from './pipeline.service';
import { PreprocessService } from './services/preprocess.service';
import { StoryboardService } from './services/storyboard.service';
import { VertexAiService } from './services/vertex-ai.service';
import { AssemblyService } from './services/assembly.service';
import { ProjectsModule } from '../projects/projects.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [ProjectsModule, CreditsModule],
  controllers: [PipelineController],
  providers: [
    PipelineService,
    PreprocessService,
    StoryboardService,
    VertexAiService,
    AssemblyService,
  ],
})
export class PipelineModule {}
