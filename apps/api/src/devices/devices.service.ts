import { Injectable } from '@nestjs/common';
import { EnrollSessionStatus } from '@prisma/client';
import { ENROLL_SESSION_TTL_MINUTES, getApiBaseUrl } from '../common/config';
import { createOpaqueToken, hashOpaqueToken } from '../common/tokens';
import { PrismaService } from '../prisma.service';

@Injectable()
export class DevicesService {
  private readonly apiBaseUrl = getApiBaseUrl();

  constructor(private readonly prisma: PrismaService) {}

  async createEnrollSession(userId: string, deviceName?: string) {
    const code = createOpaqueToken(24);
    const state = createOpaqueToken(24);
    const expiresAt = new Date(Date.now() + ENROLL_SESSION_TTL_MINUTES * 60 * 1000);

    const session = await this.prisma.enrollSession.create({
      data: {
        userId,
        code,
        status: EnrollSessionStatus.PENDING,
        deviceName,
        verifierHash: hashOpaqueToken(state),
        expiresAt,
      },
    });

    const oauthStartUrl = `${this.apiBaseUrl}/signer/oauth/start?es=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

    return {
      enroll_session_id: session.id,
      code,
      state,
      expires_at: session.expiresAt.toISOString(),
      oauth_start_url: oauthStartUrl,
    };
  }
}
