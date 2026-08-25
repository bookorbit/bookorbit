import { createHash } from 'node:crypto';

/**
 * Identifiers for reading sessions estimated from sync-protocol pushes rather than measured
 * from a device's own page timings.
 *
 * A reading session carries no device column, so the id is the only place the device that
 * produced an estimate survives. That matters once the same device starts reporting real page
 * timings: it has to be able to find the estimates it is superseding, and a prefix on the id is
 * what makes that a bounded, indexed lookup instead of a scan.
 */
const PREFIX = 'ks';
const DEVICE_TAG_LENGTH = 12;

// codeql[js/weak-cryptographic-algorithm] - identifier derivation, not security
function digest(value: string, length: number): string {
  return createHash('md5').update(value).digest('hex').slice(0, length);
}

/** Everything an estimate from one device shares, as a literal `LIKE` prefix. */
export function syncEstimateSessionIdPrefix(deviceId: string): string {
  return `${PREFIX}-${digest(deviceId, DEVICE_TAG_LENGTH)}-`;
}

/**
 * Derived rather than random so that two pushes racing for the same file resolve the same
 * interval to the same id, and the second is dropped instead of counted again.
 */
export function syncEstimateSessionId(deviceId: string, bookFileId: number, intervalStartMs: number): string {
  return `${syncEstimateSessionIdPrefix(deviceId)}${digest(`${bookFileId}:${intervalStartMs}`, 32)}`;
}
