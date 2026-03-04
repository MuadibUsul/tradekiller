import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true,
    credentials: true,
  });
  await app.listen(4000);
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to bootstrap API', error);
  process.exit(1);
});
