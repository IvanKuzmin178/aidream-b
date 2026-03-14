import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { OidcAuthGuard } from '../common/guards/oidc-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { PipelineService } from './pipeline.service';
import { PipelineTaskDto } from './dto/pipeline-task.dto';

@Controller()
export class PipelineController {
  constructor(private readonly pipelineService: PipelineService) {}

  @Post('api/projects/:id/generate')
  @UseGuards(FirebaseAuthGuard)
  startGeneration(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.pipelineService.startGeneration(id, user.uid);
  }

  @Get('api/projects/:id/result')
  @UseGuards(FirebaseAuthGuard)
  getResult(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.pipelineService.getResult(id, user.uid);
  }

  // --- Internal endpoints (called by Cloud Tasks) ---

  @Post('internal/pipeline/preprocess')
  @UseGuards(OidcAuthGuard)
  preprocess(@Body() dto: PipelineTaskDto) {
    return this.pipelineService.runPreprocess(dto.projectId, dto.jobId!);
  }

  @Post('internal/pipeline/storyboard')
  @UseGuards(OidcAuthGuard)
  storyboard(@Body() dto: PipelineTaskDto) {
    return this.pipelineService.runStoryboard(dto.projectId, dto.jobId!);
  }

  @Post('internal/pipeline/generate-scene')
  @UseGuards(OidcAuthGuard)
  generateScene(@Body() dto: PipelineTaskDto) {
    return this.pipelineService.runGenerateScene(
      dto.projectId,
      dto.jobId!,
      dto.sceneIndex!,
    );
  }

  @Post('internal/pipeline/check-generation')
  @UseGuards(OidcAuthGuard)
  checkGeneration(@Body() dto: PipelineTaskDto) {
    return this.pipelineService.runCheckGeneration(dto.projectId, dto.jobId!);
  }

  @Post('internal/pipeline/assemble')
  @UseGuards(OidcAuthGuard)
  assemble(@Body() dto: PipelineTaskDto) {
    return this.pipelineService.runAssemble(dto.projectId, dto.jobId!);
  }

  @Post('internal/pipeline/generate-image')
  @UseGuards(OidcAuthGuard)
  generateImage(@Body() dto: PipelineTaskDto) {
    return this.pipelineService.runGenerateImage(dto.projectId, dto.jobId!);
  }

  @Post('internal/pipeline/generate-audio')
  @UseGuards(OidcAuthGuard)
  generateAudio(@Body() dto: PipelineTaskDto) {
    return this.pipelineService.runGenerateAudio(dto.projectId, dto.jobId!);
  }
}
