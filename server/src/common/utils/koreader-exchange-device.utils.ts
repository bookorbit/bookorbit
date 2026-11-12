import { createHash } from 'crypto';

export const EXCHANGE_DEVICE_ID_PREFIX = 'rendition:';

// Each rendition has its own sidecar. An empty sidecar must not delete another
// rendition's annotations or acknowledge changes that it has never applied.
export function exchangeDeviceId(deviceId: string, hash: string): string {
  return `${EXCHANGE_DEVICE_ID_PREFIX}${createHash('sha256')
    .update(JSON.stringify([deviceId, hash.toLowerCase()]))
    .digest('hex')}`;
}
