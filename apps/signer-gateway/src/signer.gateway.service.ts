import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  AuditAction,
  AuditActorType,
  DeviceRole,
  DeviceStatus,
  Prisma,
  SignerRequestStatus,
} from '@prisma/client';
import {
  type AnomalyFlag,
  type Bytes32Hex,
  type ConfirmReason,
  DEVICE_ACCESS_TOKEN_AUDIENCE,
  DEVICE_ACCESS_TOKEN_ISSUER,
  DEVICE_SCOPES,
  type OrderIntentCanonical,
  PROTO_VER,
  WS_CLOSE_CODES,
  WS_MESSAGE_TYPES,
  signerInboundMessageSchema,
  signerOutboundMessageSchema,
  type DeviceAccessTokenClaims,
  type SignDenyMessage,
  type SignResultMessage,
  type SignerInboundMessage,
  type SignerOutboundMessage,
} from '@pm-quant/shared';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import WebSocket, { type RawData } from 'ws';
import { PrismaService } from './prisma.service';
import { WsCloseError } from './ws-close.error';

interface ConnectionContext {
  uid: string;
  did: string;
  role: DeviceRole;
  socket: WebSocket;
}

const PUSH_INTERVAL_MS = 1000;
const PUSH_DEDUP_MS = 3000;

function getDeviceJwtSecret(): string {
  const secret = process.env.DEVICE_JWT_SECRET;

  if (!secret || secret.trim().length === 0) {
    return 'dev-device-jwt-secret';
  }

  return secret;
}

function asJwtPayload(token: string | JwtPayload): JwtPayload {
  if (typeof token === 'string') {
    throw new WsCloseError(WS_CLOSE_CODES.UNAUTHORIZED, 'invalid_token_payload');
  }

  return token;
}

function rawDataToString(data: RawData): string {
  if (typeof data === 'string') {
    return data;
  }

  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }

  return Buffer.from(data).toString('utf8');
}

@Injectable()
export class SignerGatewayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SignerGatewayService.name);
  private readonly deviceJwtSecret = getDeviceJwtSecret();
  private readonly connections = new Map<WebSocket, ConnectionContext>();
  private readonly recentlyPushedByRequestId = new Map<string, number>();
  private pushLoop: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const parseExample = signerInboundMessageSchema.safeParse({
      proto_ver: PROTO_VER,
      type: WS_MESSAGE_TYPES.PING,
      ts: new Date().toISOString(),
    });
    this.logger.log(`ws zod parse example success=${parseExample.success}`);

    this.pushLoop = setInterval(() => {
      void this.dispatchPendingSignerRequests().catch((error: unknown) => {
        this.logger.error('Failed dispatch loop tick', error as Error);
      });
    }, PUSH_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.pushLoop) {
      clearInterval(this.pushLoop);
      this.pushLoop = null;
    }
  }

  verifyDeviceAccessToken(accessToken: string): DeviceAccessTokenClaims {
    let payload: JwtPayload;

    try {
      payload = asJwtPayload(
        jwt.verify(accessToken, this.deviceJwtSecret, {
          algorithms: ['HS256'],
          issuer: DEVICE_ACCESS_TOKEN_ISSUER,
          audience: DEVICE_ACCESS_TOKEN_AUDIENCE,
        }),
      );
    } catch {
      throw new WsCloseError(WS_CLOSE_CODES.UNAUTHORIZED, 'invalid_access_token');
    }

    const uid = payload.uid;
    const did = payload.did;
    const scope = payload.scope;
    const exp = payload.exp;

    if (typeof uid !== 'string' || typeof did !== 'string' || typeof exp !== 'number') {
      throw new WsCloseError(WS_CLOSE_CODES.UNAUTHORIZED, 'invalid_token_claims');
    }

    if (!Array.isArray(scope) || !scope.every((item) => typeof item === 'string')) {
      throw new WsCloseError(WS_CLOSE_CODES.FORBIDDEN, 'missing_scope');
    }

    const hasWsScope = scope.includes(DEVICE_SCOPES.WS);
    const hasSignResultScope = scope.includes(DEVICE_SCOPES.SIGN_RESULT);

    if (!hasWsScope || !hasSignResultScope) {
      throw new WsCloseError(WS_CLOSE_CODES.FORBIDDEN, 'insufficient_scope');
    }

    const normalizedScope: DeviceAccessTokenClaims['scope'] = [
      DEVICE_SCOPES.WS,
      DEVICE_SCOPES.SIGN_RESULT,
    ];

    return {
      iss: DEVICE_ACCESS_TOKEN_ISSUER,
      aud: DEVICE_ACCESS_TOKEN_AUDIENCE,
      uid,
      did,
      scope: normalizedScope,
      exp,
      iat: typeof payload.iat === 'number' ? payload.iat : undefined,
    };
  }

  async registerConnection(client: WebSocket, claims: DeviceAccessTokenClaims): Promise<void> {
    const device = await this.prisma.device.findUnique({
      where: { id: claims.did },
      select: {
        id: true,
        userId: true,
        role: true,
      },
    });

    if (!device || device.userId !== claims.uid) {
      throw new WsCloseError(WS_CLOSE_CODES.UNAUTHORIZED, 'device_not_found');
    }

    this.connections.set(client, {
      uid: claims.uid,
      did: claims.did,
      role: device.role,
      socket: client,
    });

    await this.prisma.device.update({
      where: { id: claims.did },
      data: {
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date(),
      },
    });

    await this.writeAudit(
      AuditAction.SIGNER_ONLINE,
      claims.uid,
      claims.did,
      'device',
      claims.did,
      { source: 'signer-gateway' },
    );

    await this.dispatchPendingSignerRequestsForUser(claims.uid);
  }

  async unregisterConnection(client: WebSocket): Promise<void> {
    const existing = this.connections.get(client);

    if (!existing) {
      return;
    }

    this.connections.delete(client);

    const stillConnected = Array.from(this.connections.values()).some(
      (connection) => connection.did === existing.did,
    );

    if (!stillConnected) {
      await this.prisma.device.update({
        where: { id: existing.did },
        data: {
          status: DeviceStatus.ACTIVE,
          lastSeenAt: new Date(),
        },
      });

      await this.writeAudit(
        AuditAction.SIGNER_OFFLINE,
        existing.uid,
        existing.did,
        'device',
        existing.did,
        { source: 'signer-gateway' },
      );
    }
  }

  async handleInboundMessage(client: WebSocket, rawData: RawData): Promise<void> {
    const connection = this.connections.get(client);

    if (!connection) {
      client.close(WS_CLOSE_CODES.UNAUTHORIZED, 'connection_not_registered');
      return;
    }

    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(rawDataToString(rawData));
    } catch {
      client.close(WS_CLOSE_CODES.INVALID, 'invalid_json');
      return;
    }

    const parsed = signerInboundMessageSchema.safeParse(parsedJson);

    if (!parsed.success) {
      client.close(WS_CLOSE_CODES.INVALID, 'invalid_message');
      return;
    }

    const message = parsed.data as SignerInboundMessage;

    if (message.type === WS_MESSAGE_TYPES.PING) {
      await this.touchDevice(connection.did);
      this.sendMessage(connection.socket, {
        proto_ver: PROTO_VER,
        type: WS_MESSAGE_TYPES.PONG,
        ts: new Date().toISOString(),
      });
      return;
    }

    if (message.type === WS_MESSAGE_TYPES.SIGN_RESULT) {
      await this.handleSignResult(connection, message);
      return;
    }

    if (message.type === WS_MESSAGE_TYPES.SIGN_DENY) {
      await this.handleSignDeny(connection, message);
      return;
    }

    client.close(WS_CLOSE_CODES.INVALID, 'unsupported_message');
  }

  private async handleSignResult(
    connection: ConnectionContext,
    message: SignResultMessage,
  ): Promise<void> {
    const now = new Date();

    const updated = await this.prisma.signerRequest.updateMany({
      where: {
        requestId: message.request_id,
        status: SignerRequestStatus.PENDING,
        expiresAt: { gt: now },
        deviceId: connection.did,
      },
      data: {
        status: SignerRequestStatus.SIGNED,
        signature: message.signature,
        deviceSig: message.device_sig,
        signedAt: now,
        respondedAt: now,
      },
    });

    if (updated.count !== 1) {
      connection.socket.close(WS_CLOSE_CODES.INVALID, 'invalid_request_state');
      return;
    }

    await this.touchDevice(connection.did);
    await this.writeAudit(
      AuditAction.SIGNER_SIGNED,
      connection.uid,
      connection.did,
      'signer_request',
      message.request_id,
      { ts: message.ts },
    );
  }

  private async handleSignDeny(connection: ConnectionContext, message: SignDenyMessage): Promise<void> {
    const now = new Date();

    const updated = await this.prisma.signerRequest.updateMany({
      where: {
        requestId: message.request_id,
        status: SignerRequestStatus.PENDING,
        expiresAt: { gt: now },
        deviceId: connection.did,
      },
      data: {
        status: SignerRequestStatus.DENIED,
        denyReason: message.reason,
        signedAt: now,
        respondedAt: now,
      },
    });

    if (updated.count !== 1) {
      connection.socket.close(WS_CLOSE_CODES.INVALID, 'invalid_request_state');
      return;
    }

    await this.touchDevice(connection.did);
    await this.writeAudit(
      AuditAction.SIGNER_DENIED,
      connection.uid,
      connection.did,
      'signer_request',
      message.request_id,
      { reason: message.reason, ts: message.ts },
    );
  }

  private async dispatchPendingSignerRequests(): Promise<void> {
    this.cleanupRecentlyPushed();

    const byUserId = new Map<string, ConnectionContext[]>();

    for (const connection of this.connections.values()) {
      if (connection.socket.readyState !== WebSocket.OPEN) {
        continue;
      }

      const bucket = byUserId.get(connection.uid);

      if (bucket) {
        bucket.push(connection);
      } else {
        byUserId.set(connection.uid, [connection]);
      }
    }

    for (const [userId, userConnections] of byUserId.entries()) {
      const target =
        userConnections.find((connection) => connection.role === DeviceRole.PRIMARY) ??
        userConnections[0];

      await this.dispatchPendingSignerRequestsForUser(userId, target);
    }
  }

  private async dispatchPendingSignerRequestsForUser(
    userId: string,
    overrideTarget?: ConnectionContext,
  ): Promise<void> {
    const target =
      overrideTarget ??
      (this.getConnectionsForUser(userId).find((connection) => connection.role === DeviceRole.PRIMARY) ??
        this.getConnectionsForUser(userId)[0]);

    if (!target || target.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const pendingRequests = await this.prisma.signerRequest.findMany({
      where: {
        userId,
        status: SignerRequestStatus.PENDING,
        expiresAt: { gt: new Date() },
        OR: [{ deviceId: null }, { deviceId: target.did }],
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    for (const request of pendingRequests) {
      if (this.wasPushedRecently(request.requestId)) {
        continue;
      }

      let canPush = request.deviceId === target.did;

      if (!request.deviceId) {
        const claimResult = await this.prisma.signerRequest.updateMany({
          where: {
            id: request.id,
            status: SignerRequestStatus.PENDING,
            expiresAt: { gt: new Date() },
            deviceId: null,
          },
          data: {
            deviceId: target.did,
          },
        });

        // Atomic assignment: only one device can claim null deviceId -> did.
        canPush = claimResult.count === 1;
      }

      if (!canPush) {
        continue;
      }

      const outbound = {
        proto_ver: PROTO_VER,
        type: WS_MESSAGE_TYPES.SIGN_REQUEST,
        request_id: request.requestId,
        expires_at: request.expiresAt.toISOString(),
        requires_confirm: request.requiresConfirm,
        confirm_reason: request.confirmReasons as ConfirmReason[],
        anomaly_flags: request.anomalyFlags as AnomalyFlag[],
        display: (request.display as Record<string, unknown> | null) ?? {},
        payload: request.payload as unknown as OrderIntentCanonical,
        payload_hash: request.payloadHash as Bytes32Hex,
      } satisfies SignerOutboundMessage;

      const validated = signerOutboundMessageSchema.safeParse(outbound);

      if (!validated.success) {
        this.logger.error(`Skipping invalid outbound SIGN_REQUEST request_id=${request.requestId}`);
        continue;
      }

      this.sendMessage(target.socket, outbound);
      this.markPushed(request.requestId);
    }
  }

  private sendMessage(socket: WebSocket, payload: SignerOutboundMessage): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(payload));
  }

  private getConnectionsForUser(userId: string): ConnectionContext[] {
    return Array.from(this.connections.values()).filter(
      (connection) => connection.uid === userId && connection.socket.readyState === WebSocket.OPEN,
    );
  }

  private wasPushedRecently(requestId: string): boolean {
    const pushedAt = this.recentlyPushedByRequestId.get(requestId);

    if (!pushedAt) {
      return false;
    }

    return Date.now() - pushedAt < PUSH_DEDUP_MS;
  }

  private markPushed(requestId: string): void {
    this.recentlyPushedByRequestId.set(requestId, Date.now());
  }

  private cleanupRecentlyPushed(): void {
    const now = Date.now();

    for (const [requestId, pushedAt] of this.recentlyPushedByRequestId.entries()) {
      if (now - pushedAt > PUSH_DEDUP_MS * 2) {
        this.recentlyPushedByRequestId.delete(requestId);
      }
    }
  }

  private async touchDevice(deviceId: string): Promise<void> {
    await this.prisma.device.update({
      where: { id: deviceId },
      data: {
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date(),
      },
    });
  }

  private async writeAudit(
    action: AuditAction,
    userId: string,
    deviceId: string,
    resourceType: string,
    resourceId: string,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId,
        deviceId,
        actorType: AuditActorType.DEVICE,
        action,
        resourceType,
        resourceId,
        metadata,
      },
    });
  }
}
