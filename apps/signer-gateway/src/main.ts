import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

function getPort(): number {
  const raw = process.env.SIGNER_GATEWAY_PORT;

  if (!raw) {
    return 4100;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4100;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(getPort());

  const logger = new Logger('SignerGatewayBootstrap');
  logger.log(`Signer gateway listening on port ${getPort()} path /ws/signer`);
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('SignerGatewayBootstrap');
  logger.error('Failed to bootstrap signer gateway', error as Error);
  process.exit(1);
});
