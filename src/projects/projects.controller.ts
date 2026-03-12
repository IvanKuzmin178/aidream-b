import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ProjectsService } from './projects.service';
import { StorageService } from '../storage/storage.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Controller('api/projects')
@UseGuards(FirebaseAuthGuard)
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly storageService: StorageService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(user.uid, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.projectsService.list(user.uid);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projectsService.get(id, user.uid);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(id, user.uid, dto);
  }

  @Delete(':id')
  delete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projectsService.delete(id, user.uid);
  }

  @Get(':id/photos')
  async getPhotos(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.projectsService.get(id, user.uid);
    const photos = await this.projectsService.getPhotos(id);

    const photosWithUrls = await Promise.all(
      photos.map(async (photo) => ({
        ...photo,
        thumbnailUrl: await this.storageService.generateSignedDownloadUrl(
          photo.objectPath,
          30,
        ),
      })),
    );

    return photosWithUrls;
  }
}
