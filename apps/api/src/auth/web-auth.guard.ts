import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import type { RequestWithWebUser } from './auth.types';

function extractCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(';');

  for (const part of parts) {
    const [rawKey, ...rawValue] = part.trim().split('=');

    if (rawKey === name) {
      return decodeURIComponent(rawValue.join('='));
    }
  }

  return null;
}

function extractAccessToken(request: Request): string | null {
  const authHeader = request.header('authorization');

  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }

  return extractCookieValue(request.header('cookie'), 'web_access_token');
}

@Injectable()
export class WebAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithWebUser>();
    const token = extractAccessToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing web access token.');
    }

    request.webUser = this.authService.verifyWebAccessToken(token);
    return true;
  }
}
