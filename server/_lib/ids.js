import { randomBytes, randomUUID } from 'node:crypto';

export function newId(prefix = '') {
  const value = randomUUID();
  return prefix ? `${prefix}_${value}` : value;
}

export function newToken(size = 32) {
  return randomBytes(size).toString('base64url');
}
