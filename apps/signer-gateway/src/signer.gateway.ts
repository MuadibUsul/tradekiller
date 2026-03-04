import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import { WS_CLOSE_CODES, WS_SIGNER_PATH } from '@pm-quant/shared';
import type { IncomingMessage } from 'node:http';
import WebSocket, { type RawData } from 'ws';
import { SignerGatewayService } from './signer.gateway.service';
import { WsCloseError } from './ws-close.error';

function getAccessToken(request: IncomingMessage | undefined): string | null {
  const requestUrl = request?.url;

  if (!requestUrl) {
    return null;
  }

  const parsed = new URL(requestUrl, 'http://localhost');
  return parsed.searchParams.get('access_token');
}

@WebSocketGateway({
  path: WS_SIGNER_PATH,
})
export class SignerGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(SignerGateway.name);

  constructor(private readonly service: SignerGatewayService) {}

  handleConnection = async (client: WebSocket, ...args: unknown[]): Promise<void> => {
    const request = args[0] as IncomingMessage | undefined;
    const accessToken = getAccessToken(request);

    if (!accessToken) {
      client.close(WS_CLOSE_CODES.UNAUTHORIZED, 'missing_access_token');
      return;
    }

    try {
      const claims = this.service.verifyDeviceAccessToken(accessToken);
      await this.service.registerConnection(client, claims);

      client.on('message', (data: RawData) => {
        void this.service
          .handleInboundMessage(client, data)
          .catch((error: unknown) => {
            this.logger.error('Failed to handle signer inbound message', error as Error);
            client.close(WS_CLOSE_CODES.INTERNAL, 'handler_error');
          });
      });
    } catch (error: unknown) {
      if (error instanceof WsCloseError) {
        client.close(error.closeCode, error.message);
        return;
      }

      this.logger.error('Failed to register signer connection', error as Error);
      client.close(WS_CLOSE_CODES.UNAUTHORIZED, 'invalid_token');
    }
  };

  handleDisconnect = async (client: WebSocket): Promise<void> => {
    await this.service.unregisterConnection(client);
  };
}
