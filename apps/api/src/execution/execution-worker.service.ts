import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { InMemoryBrokerAdapter } from './broker.adapter';
import { executeSignedRequestsOnce } from './execute-once';

const EXECUTION_INTERVAL_MS = 1000;

@Injectable()
export class ExecutionWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExecutionWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly broker: InMemoryBrokerAdapter,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runOnce();
    }, EXECUTION_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce() {
    if (this.running) {
      return {
        tick_skipped: true,
      };
    }

    this.running = true;

    try {
      const result = await executeSignedRequestsOnce(this.prisma, this.broker, this.logger);
      return {
        tick_skipped: false,
        ...result,
      };
    } finally {
      this.running = false;
    }
  }
}
