import { Controller, Get, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CreditsService } from './credits.service';

@Controller('api/users/me/credits')
@UseGuards(FirebaseAuthGuard)
export class CreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  @Get()
  async getCredits(@CurrentUser() user: AuthUser) {
    const [balance, transactions] = await Promise.all([
      this.creditsService.getBalance(user.uid),
      this.creditsService.getUsageHistory(user.uid),
    ]);
    return { credits: balance, transactions };
  }
}
