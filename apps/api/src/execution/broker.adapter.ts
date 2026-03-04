import { Injectable } from '@nestjs/common';
import { ORDER_STATUSES, type OrderIntentCanonical, type OrderStatus } from '@pm-quant/shared';
import { randomUUID } from 'node:crypto';

export interface BrokerPlaceOrderResult {
  external_order_id: string;
  status: OrderStatus;
}

export interface BrokerAdapter {
  placeOrder(payload: OrderIntentCanonical, signature: string): Promise<BrokerPlaceOrderResult>;
  cancelAll(userId: string): Promise<{ canceled_count: number }>;
}

interface InMemoryOrderRecord {
  externalOrderId: string;
  userId: string;
  requestId: string;
  signature: string;
  status: OrderStatus;
  createdAt: Date;
}

@Injectable()
export class InMemoryBrokerAdapter implements BrokerAdapter {
  private readonly records = new Map<string, InMemoryOrderRecord>();

  async placeOrder(payload: OrderIntentCanonical, signature: string): Promise<BrokerPlaceOrderResult> {
    const externalOrderId = `fake-${randomUUID()}`;
    const lastChar = payload.request_id[payload.request_id.length - 1] ?? '0';
    const markFilled = lastChar.charCodeAt(0) % 2 === 0;
    const status: OrderStatus = markFilled ? ORDER_STATUSES.FILLED : ORDER_STATUSES.ACK;

    this.records.set(externalOrderId, {
      externalOrderId,
      userId: payload.user_id,
      requestId: payload.request_id,
      signature,
      status,
      createdAt: new Date(),
    });

    return {
      external_order_id: externalOrderId,
      status,
    };
  }

  async cancelAll(userId: string): Promise<{ canceled_count: number }> {
    let canceledCount = 0;

    for (const record of this.records.values()) {
      if (record.userId !== userId) {
        continue;
      }

      if (record.status === ORDER_STATUSES.FILLED || record.status === ORDER_STATUSES.CANCELED) {
        continue;
      }

      record.status = ORDER_STATUSES.CANCELED;
      canceledCount += 1;
    }

    return { canceled_count: canceledCount };
  }
}

