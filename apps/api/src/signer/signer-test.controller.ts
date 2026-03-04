import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { WebAuthGuard } from '../auth/web-auth.guard';
import type { WebAccessClaims } from '../auth/auth.types';
import { WebUser } from '../auth/web-user.decorator';
import { SignerTestService } from './signer-test.service';

interface CreateTestSignerRequestBody {
  market_id?: unknown;
  outcome_id?: unknown;
  side?: unknown;
  quantity?: unknown;
  price?: unknown;
  requires_confirm?: unknown;
}

@Controller('api/signer')
export class SignerTestController {
  constructor(private readonly signerTestService: SignerTestService) {}

  @Post('test-request')
  @UseGuards(WebAuthGuard)
  async createTestRequest(
    @Body() body: CreateTestSignerRequestBody,
    @WebUser() user: WebAccessClaims,
  ) {
    return this.signerTestService.createTestSignerRequest(user.uid, body);
  }
}
