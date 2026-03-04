import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('/healthz')
  async healthz() {
    const healthy = await this.prisma.healthcheck();

    if (!healthy) {
      throw new ServiceUnavailableException({ ok: false });
    }

    return { ok: true };
  }
}
