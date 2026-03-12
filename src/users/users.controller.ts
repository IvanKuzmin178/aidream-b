import { Controller, Get, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

@Controller('api/users')
@UseGuards(FirebaseAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getProfile(@CurrentUser() user: AuthUser) {
    return this.usersService.getOrCreateUser(user.uid, user.email);
  }

  @Get('me/credits')
  async getCreditHistory(@CurrentUser() user: AuthUser) {
    const profile = await this.usersService.getOrCreateUser(user.uid, user.email);
    const snapshot = await this.usersService['db']
      .collection(`users/${user.uid}/transactions`)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const transactions = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return { credits: profile.credits, transactions };
  }
}
