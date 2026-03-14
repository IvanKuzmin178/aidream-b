import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../firebase/firebase.service';
import { StorageService } from '../storage/storage.service';
import { ProjectEntity, PhotoEntity, ProjectStatus } from './entities/project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {}

  private get db() {
    return this.firebaseService.firestore;
  }

  async create(userId: string, dto: CreateProjectDto): Promise<ProjectEntity> {
    const maxConcurrent = this.configService.get<number>('MAX_CONCURRENT_PROJECTS', 3);
    const activeSnap = await this.db
      .collection('projects')
      .where('userId', '==', userId)
      .where('status', 'in', ['draft', 'uploaded', 'processing'])
      .get();

    if (activeSnap.size >= maxConcurrent) {
      throw new BadRequestException(
        `Maximum ${maxConcurrent} active projects allowed`,
      );
    }

    if (dto.outputType === 'video' && !dto.generationType) {
      throw new BadRequestException('generationType is required when outputType is video');
    }

    const ref = this.db.collection('projects').doc();
    const now = new Date();
    const project: Omit<ProjectEntity, 'id'> = {
      userId,
      title: dto.title,
      style: dto.style,
      outputType: dto.outputType,
      modelId: dto.modelId,
      ...(dto.outputType === 'video' && dto.generationType
        ? { generationType: dto.generationType }
        : {}),
      status: 'draft',
      photoCount: 0,
      creditsCost: 0,
      currentStep: '',
      ...(dto.prompt ? { prompt: dto.prompt } : {}),
      createdAt: now,
      updatedAt: now,
    };

    await ref.set(project);
    return { id: ref.id, ...project };
  }

  async list(userId: string): Promise<ProjectEntity[]> {
    const snap = await this.db
      .collection('projects')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ProjectEntity);
  }

  async get(projectId: string, userId: string): Promise<ProjectEntity> {
    const doc = await this.db.doc(`projects/${projectId}`).get();
    if (!doc.exists) throw new NotFoundException('Project not found');
    const data = doc.data() as Omit<ProjectEntity, 'id'>;
    if (data.userId !== userId) throw new ForbiddenException();
    return { id: doc.id, ...data };
  }

  async getById(projectId: string): Promise<ProjectEntity> {
    const doc = await this.db.doc(`projects/${projectId}`).get();
    if (!doc.exists) throw new NotFoundException('Project not found');
    return { id: doc.id, ...doc.data() } as ProjectEntity;
  }

  async update(
    projectId: string,
    userId: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectEntity> {
    const project = await this.get(projectId, userId);
    if (project.status !== 'draft' && project.status !== 'uploaded') {
      throw new BadRequestException('Cannot update a project that is already processing');
    }

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (dto.title !== undefined) updates.title = dto.title;
    if (dto.style !== undefined) updates.style = dto.style;

    await this.db.doc(`projects/${projectId}`).update(updates);
    return { ...project, ...updates };
  }

  async delete(projectId: string, userId: string): Promise<void> {
    const project = await this.get(projectId, userId);
    if (project.status === 'processing') {
      throw new BadRequestException('Cannot delete a project that is currently processing');
    }

    await Promise.all([
      this.storageService.deleteByPrefix(`projects/${projectId}/`),
      this.deleteSubcollection(`projects/${projectId}/photos`),
      this.deleteSubcollection(`projects/${projectId}/jobs`),
    ]);

    await this.db.doc(`projects/${projectId}`).delete();
    this.logger.log(`Project ${projectId} deleted (including GCS files and subcollections)`);
  }

  private async deleteSubcollection(path: string): Promise<void> {
    const snap = await this.db.collection(path).limit(500).get();
    if (snap.empty) return;
    const batch = this.db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    if (snap.size === 500) await this.deleteSubcollection(path);
  }

  async updateStatus(
    projectId: string,
    status: ProjectStatus,
    extra: Record<string, any> = {},
  ): Promise<void> {
    await this.db.doc(`projects/${projectId}`).update({
      status,
      updatedAt: new Date(),
      ...extra,
    });
  }

  async getPhotos(projectId: string): Promise<PhotoEntity[]> {
    const snap = await this.db
      .collection(`projects/${projectId}/photos`)
      .orderBy('order')
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PhotoEntity);
  }

  async addPhoto(projectId: string, photo: Omit<PhotoEntity, 'id'>): Promise<string> {
    const ref = this.db.collection(`projects/${projectId}/photos`).doc();
    await ref.set(photo);

    const snap = await this.db.collection(`projects/${projectId}/photos`).count().get();
    await this.db.doc(`projects/${projectId}`).update({
      photoCount: snap.data().count,
      updatedAt: new Date(),
    });

    return ref.id;
  }

  async reorderPhotos(
    projectId: string,
    photoIds: string[],
  ): Promise<void> {
    const batch = this.db.batch();
    photoIds.forEach((id, index) => {
      batch.update(this.db.doc(`projects/${projectId}/photos/${id}`), {
        order: index,
      });
    });
    await batch.commit();
  }
}
