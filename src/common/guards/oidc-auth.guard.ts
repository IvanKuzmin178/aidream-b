import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Verifies OIDC tokens from Cloud Tasks.
 * In production, Cloud Tasks sends an OIDC token in the Authorization header
 * signed by Google. We verify the audience matches our backend URL.
 *
 * In development (NODE_ENV !== 'production'), this guard is permissive.
 */
@Injectable()
export class OidcAuthGuard implements CanActivate {
  private readonly logger = new Logger(OidcAuthGuard.name);

  constructor(private readonly configService: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const env = this.configService.get<string>('NODE_ENV', 'development');
    if (env !== 'production') {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing OIDC token');
    }

    const token = auth.split(' ')[1];
    const backendUrl = this.configService.get<string>('BACKEND_URL');

    try {
      const { OAuth2Client } = await import('google-auth-library');
      const client = new OAuth2Client();
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: backendUrl,
      });
      const payload = ticket.getPayload();
      if (!payload) {
        throw new Error('Empty OIDC payload');
      }
      this.logger.debug(`OIDC caller: ${payload.email}`);
      return true;
    } catch (err) {
      this.logger.warn(`OIDC verification failed: ${err}`);
      throw new UnauthorizedException('Invalid OIDC token');
    }
  }
}
