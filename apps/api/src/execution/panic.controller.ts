import { Controller, Post, UseGuards } from '@nestjs/common';
import type { WebAccessClaims } from '../auth/auth.types';
import { WebAuthGuard } from '../auth/web-auth.guard';
import { WebUser } from '../auth/web-user.decorator';
import { PanicService } from './panic.service';

@Controller('api/panic')
@UseGuards(WebAuthGuard)
export class PanicController {
  constructor(private readonly panicService: PanicService) {}

  @Post('stop-all')
  async stopAll(@WebUser() user: WebAccessClaims) {
    return this.panicService.stopAll(user.uid, 'manual_panic_stop');
  }
}

