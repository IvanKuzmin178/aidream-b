import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../firebase/firebase.service';
import { UserEntity } from './entities/user.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly firebaseService: FirebaseService,
    private readonly configService: ConfigService,
  ) {}

  private get db() {
    return this.firebaseService.firestore;
  }

  async getOrCreateUser(uid: string, email?: string): Promise<UserEntity> {
    const ref = this.db.doc(`users/${uid}`);
    const doc = await ref.get();

    if (doc.exists) {
      return { uid, ...doc.data() } as UserEntity;
    }

    const freeCredits = this.configService.get<number>('FREE_CREDITS', 20);
    const user: Omit<UserEntity, 'uid'> = {
      email: email || '',
      displayName: email?.split('@')[0] || '',
      credits: freeCredits,
      createdAt: new Date(),
    };

    await ref.set(user);
    this.logger.log(`New user created: ${uid} with ${freeCredits} credits`);

    const txRef = this.db.collection(`users/${uid}/transactions`).doc();
    await txRef.set({
      type: 'allocation',
      amount: freeCredits,
      createdAt: new Date(),
    });

    return { uid, ...user };
  }

  async getUser(uid: string): Promise<UserEntity | null> {
    const doc = await this.db.doc(`users/${uid}`).get();
    if (!doc.exists) return null;
    return { uid, ...doc.data() } as UserEntity;
  }

  async updateCredits(uid: string, newBalance: number): Promise<void> {
    await this.db.doc(`users/${uid}`).update({ credits: newBalance });
  }
}
