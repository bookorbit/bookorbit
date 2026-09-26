import { createHash, createHmac } from 'crypto';

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function nextRefreshToken(token: string, secret: string): string {
  // Domain separation keeps this independent of JWT signing. A lost response can be recovered
  // from the presented credential without persisting any recoverable secret in the database.
  return createHmac('sha256', secret).update('bookorbit:refresh:v1:').update(token).digest('hex');
}
