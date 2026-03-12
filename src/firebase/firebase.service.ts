import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { Firestore } from '@google-cloud/firestore';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private app!: admin.app.App;
  private firestoreInstance!: Firestore;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const projectId = this.configService.get<string>('GCP_PROJECT_ID');

    if (admin.apps.length === 0) {
      this.app = admin.initializeApp({ projectId });
    } else {
      this.app = admin.apps[0]!;
    }

    this.firestoreInstance = new Firestore({ projectId });
    this.logger.log(`Firebase Admin SDK initialized for project: ${projectId}`);
  }

  async verifyIdToken(token: string): Promise<admin.auth.DecodedIdToken> {
    return this.app.auth().verifyIdToken(token);
  }

  get firestore(): Firestore {
    return this.firestoreInstance;
  }
}
