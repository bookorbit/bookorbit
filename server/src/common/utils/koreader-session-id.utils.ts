/**
 * Identity of a reading session derived from KOReader page events:
 * `kor:<device key>:<book file id>:<cluster start>`. Derivation builds it and the session delete
 * path reads it back, so both sides share one definition of the format.
 */

const KOREADER_SESSION_ID_PATTERN = /^kor:([A-Za-z0-9-]{1,8}):([1-9]\d*):(\d+)$/;

/** The part of a device id a session id keeps. Two devices sharing it share session identities. */
export function koreaderSessionDeviceKey(deviceId: string): string {
  return deviceId.slice(0, 8);
}

/** Everything one device's derived sessions share, across every book it has read. */
export function buildDeviceSessionIdPrefix(deviceId: string): string {
  return `kor:${koreaderSessionDeviceKey(deviceId)}:`;
}

export function buildSessionIdPrefix(deviceId: string, bookFileId: number): string {
  return `${buildDeviceSessionIdPrefix(deviceId)}${bookFileId}:`;
}

export function buildSessionId(deviceId: string, bookFileId: number, clusterStartEpoch: number): string {
  return `${buildSessionIdPrefix(deviceId, bookFileId)}${clusterStartEpoch}`;
}

export interface ParsedKoreaderSessionId {
  deviceKey: string;
  bookFileId: number;
  clusterStartEpoch: number;
}

/** Null for anything that is not a derived KOReader session id, including legacy estimator ids. */
export function parseKoreaderSessionId(sessionId: string | null | undefined): ParsedKoreaderSessionId | null {
  const match = sessionId ? KOREADER_SESSION_ID_PATTERN.exec(sessionId) : null;
  if (!match) return null;
  return { deviceKey: match[1]!, bookFileId: Number(match[2]), clusterStartEpoch: Number(match[3]) };
}
