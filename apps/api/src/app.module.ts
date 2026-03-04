import { Module } from '@nestjs/common';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { WebAuthGuard } from './auth/web-auth.guard';
import { DevicesController } from './devices/devices.controller';
import { DevicesService } from './devices/devices.service';
import { ExecutionController } from './execution/execution.controller';
import { ExecutionWorkerService } from './execution/execution-worker.service';
import { InMemoryBrokerAdapter } from './execution/broker.adapter';
import { PanicController } from './execution/panic.controller';
import { PanicService } from './execution/panic.service';
import { SafetyMonitorService } from './execution/safety-monitor.service';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { SignerAuthController } from './signer/signer-auth.controller';
import { SignerAuthService } from './signer/signer-auth.service';
import { SignerOauthController } from './signer/signer-oauth.controller';
import { SignerTestController } from './signer/signer-test.controller';
import { SignerTestService } from './signer/signer-test.service';
import { TradingController } from './trading/trading.controller';
import { TradingService } from './trading/trading.service';

@Module({
  controllers: [
    HealthController,
    AuthController,
    DevicesController,
    SignerOauthController,
    SignerAuthController,
    SignerTestController,
    TradingController,
    PanicController,
    ExecutionController,
  ],
  providers: [
    PrismaService,
    AuthService,
    WebAuthGuard,
    DevicesService,
    SignerAuthService,
    SignerTestService,
    TradingService,
    InMemoryBrokerAdapter,
    PanicService,
    ExecutionWorkerService,
    SafetyMonitorService,
  ],
})
export class AppModule {}
