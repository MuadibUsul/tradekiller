import { createHash, randomBytes } from 'node:crypto';

export function createOpaqueToken(size = 32): string {
  return randomBytes(size).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
