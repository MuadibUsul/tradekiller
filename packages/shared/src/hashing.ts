import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { keccak_256 } from '@noble/hashes/sha3';
import type { OrderIntentCanonical } from './order-intent';

export type Bytes32Hex = `0x${string}`;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function serializeCanonical(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON does not support non-finite numbers.');
    }

    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => serializeCanonical(item === undefined ? null : item));
    return `[${items.join(',')}]`;
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .filter(([, current]) => current !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    const serialized = entries.map(
      ([key, current]) => `${JSON.stringify(key)}:${serializeCanonical(current)}`,
    );

    return `{${serialized.join(',')}}`;
  }

  throw new TypeError(`Unsupported type for canonical JSON serialization: ${typeof value}`);
}

export function serializeCanonicalJson(value: unknown): string {
  return serializeCanonical(value);
}

export function keccak256Hex(input: string | Uint8Array): Bytes32Hex {
  const bytes = typeof input === 'string' ? utf8ToBytes(input) : input;
  const hash = keccak_256(bytes);
  return `0x${bytesToHex(hash)}` as Bytes32Hex;
}

export function hashCanonicalPayload(payload: unknown): Bytes32Hex {
  return keccak256Hex(serializeCanonicalJson(payload));
}

export function hashOrderIntentCanonical(payload: OrderIntentCanonical): Bytes32Hex {
  return hashCanonicalPayload(payload);
}
