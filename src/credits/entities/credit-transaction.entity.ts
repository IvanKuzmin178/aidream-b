export type TransactionType = 'deduction' | 'allocation' | 'purchase';

export interface CreditTransaction {
  id: string;
  type: TransactionType;
  amount: number;
  projectId?: string;
  createdAt: Date;
}
