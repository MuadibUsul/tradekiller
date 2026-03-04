import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  WEB_ACCESS_TOKEN_TTL_SECONDS,
  WEB_REFRESH_TOKEN_TTL_DAYS,
  getWebJwtSecret,
} from '../common/config';
import { createOpaqueToken, hashOpaqueToken } from '../common/tokens';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { WebAccessClaims } from './auth.types';

function getFutureDate(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function assertJwtPayload(payload: string | JwtPayload): JwtPayload {
  if (typeof payload === 'string') {
    throw new UnauthorizedException('Invalid token payload.');
  }

  return payload;
}

@Injectable()
export class AuthService {
  private readonly webJwtSecret = getWebJwtSecret();

  constructor(private readonly prisma: PrismaService) {}

  async devLogin(emailRaw: string) {
    const email = emailRaw.trim().toLowerCase();

    if (!email || !email.includes('@')) {
      throw new UnauthorizedException('Invalid email.');
    }

    const user = await this.prisma.user.upsert({
      where: { email },
      update: {},
      create: { email },
    });

    const refreshToken = createOpaqueToken(48);
    const refreshTokenHash = hashOpaqueToken(refreshToken);
    const refreshExpiresAt = getFutureDate(WEB_REFRESH_TOKEN_TTL_DAYS);

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash,
        expiresAt: refreshExpiresAt,
      },
    });

    const accessToken = this.issueWebAccessToken(user.id, user.email, session.id);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: WEB_ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async refreshWebSession(refreshToken: string) {
    const refreshTokenHash = hashOpaqueToken(refreshToken);

    const session = await this.prisma.session.findFirst({
      where: {
        refreshTokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: true,
      },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const nextRefreshToken = createOpaqueToken(48);
    const nextRefreshTokenHash = hashOpaqueToken(nextRefreshToken);
    const nextRefreshExpiresAt = getFutureDate(WEB_REFRESH_TOKEN_TTL_DAYS);

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: nextRefreshTokenHash,
        expiresAt: nextRefreshExpiresAt,
      },
    });

    const accessToken = this.issueWebAccessToken(session.user.id, session.user.email, session.id);

    return {
      access_token: accessToken,
      refresh_token: nextRefreshToken,
      token_type: 'Bearer',
      expires_in: WEB_ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  verifyWebAccessToken(token: string): WebAccessClaims {
    try {
      const payload = assertJwtPayload(
        jwt.verify(token, this.webJwtSecret, {
          algorithms: ['HS256'],
          issuer: 'pm-quant-api',
          audience: 'pm-web',
        }),
      );

      const uid = payload.uid;
      const email = payload.email;
      const sid = payload.sid;

      if (typeof uid !== 'string' || typeof email !== 'string' || typeof sid !== 'string') {
        throw new UnauthorizedException('Invalid token claims.');
      }

      return {
        uid,
        email,
        sid,
        iat: typeof payload.iat === 'number' ? payload.iat : undefined,
        exp: typeof payload.exp === 'number' ? payload.exp : undefined,
      };
    } catch {
      throw new UnauthorizedException('Invalid access token.');
    }
  }

  private issueWebAccessToken(userId: string, email: string, sessionId: string): string {
    return jwt.sign(
      {
        uid: userId,
        email,
        sid: sessionId,
      },
      this.webJwtSecret,
      {
        algorithm: 'HS256',
        issuer: 'pm-quant-api',
        audience: 'pm-web',
        expiresIn: `${WEB_ACCESS_TOKEN_TTL_SECONDS}s`,
      },
    );
  }
}
