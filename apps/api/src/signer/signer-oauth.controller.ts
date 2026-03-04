import {
  Controller,
  Get,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { WebAuthGuard } from '../auth/web-auth.guard';
import { WebUser } from '../auth/web-user.decorator';
import type { WebAccessClaims } from '../auth/auth.types';
import { SignerAuthService } from './signer-auth.service';

interface OauthStartQuery {
  es?: string;
  state?: string;
  format?: string;
}

@Controller('signer/oauth')
export class SignerOauthController {
  constructor(private readonly signerAuthService: SignerAuthService) {}

  @Get('start')
  @UseGuards(WebAuthGuard)
  async start(
    @Query() query: OauthStartQuery,
    @WebUser() user: WebAccessClaims,
    @Res() response: Response,
  ) {
    const enrollCode = query.es;
    const state = query.state;

    if (typeof enrollCode !== 'string' || typeof state !== 'string') {
      throw new UnauthorizedException('es and state query params are required.');
    }

    const result = await this.signerAuthService.getOauthStartDetails(user.uid, enrollCode, state);

    if (query.format === 'json') {
      return response.json({
        code: result.code,
        state: result.state,
        expires_at: result.expiresAt,
        continue_url: result.continueUrl,
      });
    }

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Signer OAuth Start</title>
    <style>
      body { font-family: sans-serif; padding: 32px; }
      a { display: inline-block; padding: 10px 14px; background: #111; color: #fff; text-decoration: none; border-radius: 6px; }
      code { background: #f3f3f3; padding: 2px 4px; }
    </style>
  </head>
  <body>
    <h1>Authorize Signer Device</h1>
    <p>Enroll session: <code>${result.code}</code></p>
    <p>Expires at: <code>${result.expiresAt}</code></p>
    <a href="${result.continueUrl}">Continue</a>
  </body>
</html>`;

    response.setHeader('content-type', 'text/html; charset=utf-8');
    return response.send(html);
  }
}
