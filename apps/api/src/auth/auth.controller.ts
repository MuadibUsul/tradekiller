import { Body, Controller, Post, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { WEB_ACCESS_TOKEN_TTL_SECONDS } from '../common/config';
import { AuthService } from './auth.service';

interface DevLoginBody {
  email?: unknown;
}

interface RefreshBody {
  refresh_token?: unknown;
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('dev-login')
  async devLogin(
    @Body() body: DevLoginBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (typeof body.email !== 'string') {
      throw new UnauthorizedException('email is required.');
    }

    const result = await this.authService.devLogin(body.email);

    response.cookie('web_access_token', result.access_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: WEB_ACCESS_TOKEN_TTL_SECONDS * 1000,
    });

    return result;
  }

  @Post('refresh')
  async refresh(
    @Body() body: RefreshBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (typeof body.refresh_token !== 'string') {
      throw new UnauthorizedException('refresh_token is required.');
    }

    const result = await this.authService.refreshWebSession(body.refresh_token);

    response.cookie('web_access_token', result.access_token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: WEB_ACCESS_TOKEN_TTL_SECONDS * 1000,
    });

    return result;
  }
}
