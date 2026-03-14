import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';

const STYLE_COSTS: Record<string, number> = {
  memory: 5,
  cinematic: 8,
  dream: 7,
};

const TEXT_TO_VIDEO_COST = 10;
const IMAGE_COST = 5;
const AUDIO_COST = 8;

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(private readonly firebaseService: FirebaseService) {}

  private get db() {
    return this.firebaseService.firestore;
  }

  calculateCost(
    style: string,
    photoCount: number,
    generationTypeOrOutput: 'image_to_video' | 'text_to_video' | 'image' | 'audio' = 'image_to_video',
  ): number {
    if (generationTypeOrOutput === 'text_to_video') return TEXT_TO_VIDEO_COST;
    if (generationTypeOrOutput === 'image') return IMAGE_COST;
    if (generationTypeOrOutput === 'audio') return AUDIO_COST;
    const baseCost = STYLE_COSTS[style] || 5;
    const sceneCost = Math.min(8, Math.ceil(photoCount * 0.6));
    return baseCost + sceneCost;
  }

  async getBalance(uid: string): Promise<number> {
    const doc = await this.db.doc(`users/${uid}`).get();
    return this.parseCredits(doc.data()?.credits);
  }

  private parseCredits(value: unknown): number {
    if (typeof value === 'number' && !Number.isNaN(value)) return Math.floor(value);
    if (typeof value === 'string') {
      const n = parseInt(value, 10);
      return Number.isNaN(n) ? 0 : n;
    }
    // Firestore REST / emulator may return { integerValue: "20" } or { doubleValue: 20 }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const v = value as Record<string, unknown>;
      if (typeof v.integerValue === 'string') {
        const n = parseInt(v.integerValue, 10);
        return Number.isNaN(n) ? 0 : n;
      }
      if (typeof v.doubleValue === 'number') return Math.floor(v.doubleValue);
    }
    return 0;
  }

  async deductCredits(
    uid: string,
    amount: number,
    projectId?: string,
  ): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      const userRef = this.db.doc(`users/${uid}`);
      const userDoc = await tx.get(userRef);
      const data = userDoc.data();
      const currentCredits = this.parseCredits(data?.credits);

      if (!userDoc.exists || currentCredits < amount) {
        this.logger.warn(
          `[deductCredits] uid=${uid} currentCredits=${currentCredits} amount=${amount} raw=${JSON.stringify(data?.credits)} exists=${userDoc.exists}`,
        );
        throw new BadRequestException(
          userDoc.exists
            ? `Insufficient credits (balance: ${currentCredits}, required: ${amount})`
            : 'User not initialized. Refresh the page and try again.',
        );
      }

      tx.update(userRef, { credits: currentCredits - amount });

      const txRef = this.db.collection(`users/${uid}/transactions`).doc();
      tx.create(txRef, {
        type: 'deduction',
        amount,
        projectId: projectId || null,
        createdAt: new Date(),
      });
    });

    this.logger.log(`Deducted ${amount} credits from user ${uid}`);
  }

  async getUsageHistory(uid: string, limit = 50) {
    const snap = await this.db
      .collection(`users/${uid}/transactions`)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}
