import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { RequestWithWebUser, WebAccessClaims } from './auth.types';

export const WebUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): WebAccessClaims => {
    const request = context.switchToHttp().getRequest<RequestWithWebUser>();

    if (!request.webUser) {
      throw new UnauthorizedException('Web user context is missing.');
    }

    return request.webUser;
  },
);
