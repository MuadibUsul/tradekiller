import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SignerGateway } from './signer.gateway';
import { SignerGatewayService } from './signer.gateway.service';

@Module({
  providers: [PrismaService, SignerGatewayService, SignerGateway],
})
export class AppModule {}
