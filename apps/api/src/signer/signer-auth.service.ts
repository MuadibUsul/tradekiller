import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  DeviceRole,
  DeviceStatus,
  EnrollSession,
  EnrollSessionStatus,
} from '@prisma/client';
import {
  DEVICE_ACCESS_TOKEN_AUDIENCE,
  DEVICE_ACCESS_TOKEN_ISSUER,
  DEVICE_SCOPES,
  type DeviceAccessTokenClaims,
} from '@pm-quant/shared';
import jwt from 'jsonwebtoken';
import {
  DEVICE_ACCESS_TOKEN_TTL_SECONDS,
  DEVICE_REFRESH_TOKEN_TTL_DAYS,
  getDeviceJwtSecret,
  getSignerCallbackUri,
} from '../common/config';
import { createOpaqueToken, hashOpaqueToken } from '../common/tokens';
import { PrismaService } from '../prisma.service';

interface OauthStartResult {
  code: string;
  state: string;
  expiresAt: string;
  continueUrl: string;
}

interface ExchangeResult {
  deviceAccessToken: string;
  deviceRefreshToken: string;
  deviceId: string;
  userId: string;
}

interface RefreshLookup {
  deviceId: string;
  userId: string;
  deviceStatus: DeviceStatus;
}

@Injectable()
export class SignerAuthService {
  private readonly deviceJwtSecret = getDeviceJwtSecret();
  private readonly signerCallbackUri = getSignerCallbackUri();

  constructor(private readonly prisma: PrismaService) {}

  async getOauthStartDetails(userId: string, code: string, state: string): Promise<OauthStartResult> {
    if (!code || !state) {
      throw new BadRequestException('es and state are required.');
    }

    const session = await this.prisma.enrollSession.findUnique({
      where: { code },
    });

    this.assertEnrollSessionForStart(session, userId, state);

    const continueUrl = `${this.signerCallbackUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

    return {
      code,
      state,
      expiresAt: session.expiresAt.toISOString(),
      continueUrl,
    };
  }

  async exchange(code: string, state: string): Promise<ExchangeResult> {
    if (!code || !state) {
      throw new BadRequestException('code and state are required.');
    }

    const stateHash = hashOpaqueToken(state);

    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.enrollSession.findUnique({
        where: { code },
      });

      this.assertEnrollSessionForExchange(session, stateHash);

      const now = new Date();

      await tx.enrollSession.update({
        where: { id: session.id },
        data: {
          status: EnrollSessionStatus.EXCHANGED,
          approvedAt: session.approvedAt ?? now,
          exchangedAt: now,
        },
      });

      const device = await tx.device.create({
        data: {
          userId: session.userId,
          name: session.deviceName ?? `Signer Device ${now.toISOString()}`,
          status: DeviceStatus.ACTIVE,
          role: DeviceRole.SECONDARY,
          enrolledAt: now,
          lastSeenAt: now,
        },
      });

      const deviceRefreshToken = createOpaqueToken(48);
      const refreshTokenHash = hashOpaqueToken(deviceRefreshToken);
      const refreshExpiresAt = new Date(
        Date.now() + DEVICE_REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
      );

      await tx.deviceToken.create({
        data: {
          deviceId: device.id,
          refreshTokenHash,
          expiresAt: refreshExpiresAt,
        },
      });

      return {
        userId: session.userId,
        deviceId: device.id,
        deviceRefreshToken,
      };
    });

    const deviceAccessToken = this.issueDeviceAccessToken(result.userId, result.deviceId);

    return {
      deviceAccessToken,
      deviceRefreshToken: result.deviceRefreshToken,
      deviceId: result.deviceId,
      userId: result.userId,
    };
  }

  async refreshDeviceAccess(deviceRefreshToken: string) {
    if (!deviceRefreshToken) {
      throw new BadRequestException('device_refresh_token is required.');
    }

    const lookup = await this.lookupDeviceToken(deviceRefreshToken);

    if (
      !lookup ||
      (lookup.deviceStatus !== DeviceStatus.ACTIVE && lookup.deviceStatus !== DeviceStatus.ONLINE)
    ) {
      throw new UnauthorizedException('Invalid device refresh token.');
    }

    await this.prisma.device.update({
      where: { id: lookup.deviceId },
      data: { lastSeenAt: new Date() },
    });

    return {
      device_access_token: this.issueDeviceAccessToken(lookup.userId, lookup.deviceId),
      token_type: 'Bearer',
      expires_in: DEVICE_ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  private issueDeviceAccessToken(userId: string, deviceId: string): string {
    const payload: Omit<DeviceAccessTokenClaims, 'iss' | 'aud' | 'exp'> = {
      uid: userId,
      did: deviceId,
      scope: [DEVICE_SCOPES.WS, DEVICE_SCOPES.SIGN_RESULT],
    };

    return jwt.sign(payload, this.deviceJwtSecret, {
      algorithm: 'HS256',
      issuer: DEVICE_ACCESS_TOKEN_ISSUER,
      audience: DEVICE_ACCESS_TOKEN_AUDIENCE,
      expiresIn: `${DEVICE_ACCESS_TOKEN_TTL_SECONDS}s`,
    });
  }

  private async lookupDeviceToken(rawRefreshToken: string): Promise<RefreshLookup | null> {
    const refreshTokenHash = hashOpaqueToken(rawRefreshToken);

    const record = await this.prisma.deviceToken.findFirst({
      where: {
        refreshTokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        device: {
          select: {
            id: true,
            userId: true,
            status: true,
          },
        },
      },
    });

    if (!record) {
      return null;
    }

    return {
      deviceId: record.device.id,
      userId: record.device.userId,
      deviceStatus: record.device.status,
    };
  }

  private assertEnrollSessionForStart(
    session: EnrollSession | null,
    userId: string,
    state: string,
  ): asserts session is EnrollSession {
    if (!session) {
      throw new BadRequestException('Invalid enroll session.');
    }

    if (session.userId !== userId) {
      throw new ForbiddenException('Enroll session does not belong to this user.');
    }

    if (session.status !== EnrollSessionStatus.PENDING) {
      throw new BadRequestException('Enroll session is no longer pending.');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Enroll session is expired.');
    }

    if (!session.verifierHash || session.verifierHash !== hashOpaqueToken(state)) {
      throw new UnauthorizedException('Invalid state.');
    }
  }

  private assertEnrollSessionForExchange(
    session: EnrollSession | null,
    expectedStateHash: string,
  ): asserts session is EnrollSession {
    if (!session) {
      throw new BadRequestException('Invalid code.');
    }

    if (session.status !== EnrollSessionStatus.PENDING) {
      throw new BadRequestException('Enroll session already consumed.');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Enroll session expired.');
    }

    if (!session.verifierHash || session.verifierHash !== expectedStateHash) {
      throw new UnauthorizedException('State validation failed.');
    }
  }
}
