import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OrderStatus, SignerRequestStatus } from '@prisma/client';
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
      await this.expireStaleRequests();
      const result = await executeSignedRequestsOnce(this.prisma, this.broker, this.logger);
      return {
        tick_skipped: false,
        ...result,
      };
    } finally {
      this.running = false;
    }
  }

  private async expireStaleRequests(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.signerRequest.updateMany({
      where: {
        status: {
          in: [SignerRequestStatus.PENDING, SignerRequestStatus.DELIVERED],
        },
        expiresAt: {
          lte: now,
        },
      },
      data: {
        status: SignerRequestStatus.EXPIRED,
        respondedAt: now,
      },
    });

    if (expired.count === 0) {
      return;
    }

    await this.prisma.order.updateMany({
      where: {
        signerRequest: {
          status: SignerRequestStatus.EXPIRED,
        },
        status: {
          in: [OrderStatus.PENDING_SIGN, OrderStatus.SIGNED],
        },
      },
      data: {
        status: OrderStatus.CANCELED,
        rejectReason: 'signer_request_expired',
      },
    });
  }
}
