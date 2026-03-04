import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { DEVICE_ACCESS_TOKEN_TTL_SECONDS } from '../common/config';
import { SignerAuthService } from './signer-auth.service';

interface ExchangeBody {
  code?: unknown;
  state?: unknown;
}

interface RefreshBody {
  device_refresh_token?: unknown;
}

@Controller('api/signer')
export class SignerAuthController {
  constructor(private readonly signerAuthService: SignerAuthService) {}

  @Post('oauth/exchange')
  async exchange(@Body() body: ExchangeBody) {
    if (typeof body.code !== 'string' || typeof body.state !== 'string') {
      throw new UnauthorizedException('code and state are required.');
    }

    const result = await this.signerAuthService.exchange(body.code, body.state);

    return {
      device_access_token: result.deviceAccessToken,
      device_refresh_token: result.deviceRefreshToken,
      token_type: 'Bearer',
      expires_in: DEVICE_ACCESS_TOKEN_TTL_SECONDS,
      did: result.deviceId,
      uid: result.userId,
    };
  }

  @Post('token/refresh')
  async refresh(@Body() body: RefreshBody) {
    if (typeof body.device_refresh_token !== 'string') {
      throw new UnauthorizedException('device_refresh_token is required.');
    }

    return this.signerAuthService.refreshDeviceAccess(body.device_refresh_token);
  }
}
