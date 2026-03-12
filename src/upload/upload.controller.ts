import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { UploadService } from './upload.service';
import { RequestUploadUrlsDto } from './dto/request-upload-urls.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { ReorderPhotosDto } from './dto/reorder-photos.dto';

@Controller('api/projects/:projectId')
@UseGuards(FirebaseAuthGuard)
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post('upload-urls')
  async getUploadUrls(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: RequestUploadUrlsDto,
  ) {
    await this.projectsService.get(projectId, user.uid);
    return this.uploadService.generateUploadUrls(projectId, dto.files);
  }

  @Post('upload-complete')
  async confirmUpload(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: ConfirmUploadDto,
  ) {
    await this.projectsService.get(projectId, user.uid);
    await this.uploadService.confirmUpload(projectId, dto.objectPaths, []);
    return { success: true };
  }

  @Post('photos/reorder')
  async reorderPhotos(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Body() dto: ReorderPhotosDto,
  ) {
    await this.projectsService.get(projectId, user.uid);
    await this.projectsService.reorderPhotos(projectId, dto.photoIds);
    return { success: true };
  }
}
