import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';

const STYLE_COSTS: Record<string, number> = {
  memory: 5,
  cinematic: 8,
  dream: 7,
};

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(private readonly firebaseService: FirebaseService) {}

  private get db() {
    return this.firebaseService.firestore;
  }

  calculateCost(style: string, photoCount: number): number {
    const baseCost = STYLE_COSTS[style] || 5;
    const sceneCost = Math.min(8, Math.ceil(photoCount * 0.6));
    return baseCost + sceneCost;
  }

  async getBalance(uid: string): Promise<number> {
    const doc = await this.db.doc(`users/${uid}`).get();
    return doc.data()?.credits ?? 0;
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

      if (!data || data.credits < amount) {
        throw new BadRequestException('Insufficient credits');
      }

      tx.update(userRef, { credits: data.credits - amount });

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
