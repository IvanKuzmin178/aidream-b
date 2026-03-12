import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { FirebaseModule } from './firebase/firebase.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { UploadModule } from './upload/upload.module';
import { StorageModule } from './storage/storage.module';
import { CreditsModule } from './credits/credits.module';
import { QueueModule } from './queue/queue.module';
import { PipelineModule } from './pipeline/pipeline.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    FirebaseModule,
    UsersModule,
    ProjectsModule,
    UploadModule,
    StorageModule,
    CreditsModule,
    QueueModule,
    PipelineModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
