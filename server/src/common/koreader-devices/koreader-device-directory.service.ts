import { Injectable } from '@nestjs/common';
import type { BookReadingSessionDevice } from '@bookorbit/types';

import { EXCHANGE_DEVICE_ID_PREFIX, exchangeDeviceId } from '../utils/koreader-exchange-device.utils';
import { matchKoreaderSessionDevice, parseKoreaderSessionId } from '../utils/koreader-session-id.utils';
import { KoreaderDeviceDirectoryRepository } from './koreader-device-directory.repository';

export type KoreaderDeviceDescription = BookReadingSessionDevice;

/** Who a KOReader device is to its owner: the name they gave it and the model it reports. */
@Injectable()
export class KoreaderDeviceDirectoryService {
  constructor(private readonly repo: KoreaderDeviceDirectoryRepository) {}

  async describeDevices(userId: number, deviceIds: readonly string[]): Promise<Map<string, KoreaderDeviceDescription>> {
    const unique = [...new Set(deviceIds)];
    if (unique.length === 0) return new Map();
    const [names, progressModels, sweepModels] = await Promise.all([
      this.repo.findNames(userId, unique),
      this.repo.findProgressModels(userId, unique),
      this.repo.findSweepModels(userId, unique),
    ]);
    const models = new Map(sweepModels.map((row) => [row.deviceId, row.model]));
    for (const row of progressModels) models.set(row.deviceId, row.model);
    return new Map(unique.map((deviceId) => [deviceId, { deviceId, model: models.get(deviceId) ?? null, name: names.get(deviceId) ?? null }]));
  }

  /**
   * The device behind each derived KOReader session id, keyed by that id. A session is left out
   * when its id is not a derived one, or when no single device that read the file matches it.
   */
  async describeSessionDevices(userId: number, sessionIds: readonly string[]): Promise<Map<string, KoreaderDeviceDescription>> {
    const parsed = sessionIds.flatMap((sessionId) => {
      const id = parseKoreaderSessionId(sessionId);
      return id ? [{ sessionId, ...id }] : [];
    });
    if (parsed.length === 0) return new Map();

    const pageStatDevices = await this.repo.findPageStatDevices(userId, [...new Set(parsed.map((id) => id.bookFileId))]);
    const candidatesByFile = new Map<number, string[]>();
    for (const row of pageStatDevices) {
      const candidates = candidatesByFile.get(row.bookFileId);
      if (candidates) candidates.push(row.deviceId);
      else candidatesByFile.set(row.bookFileId, [row.deviceId]);
    }

    const deviceBySession = new Map<string, string>();
    for (const id of parsed) {
      const deviceId = matchKoreaderSessionDevice(id.deviceKey, candidatesByFile.get(id.bookFileId) ?? []);
      if (deviceId) deviceBySession.set(id.sessionId, deviceId);
    }

    const descriptions = await this.describeDevices(userId, [...deviceBySession.values()]);
    const result = new Map<string, KoreaderDeviceDescription>();
    for (const [sessionId, deviceId] of deviceBySession) {
      const description = descriptions.get(deviceId);
      if (description) result.set(sessionId, description);
    }
    return result;
  }

  /**
   * The device behind each annotation-exchange id on one book, keyed by that id. An exchange id is a
   * one-way digest of a device id and the hash the device knew the book by, so it is rebuilt from
   * the user's known devices and the book's hashes. Ids that are not exchange ids, or that no known
   * device produced, are left out.
   */
  async describeExchangeDevices(userId: number, bookId: number, exchangeIds: readonly string[]): Promise<Map<string, KoreaderDeviceDescription>> {
    const wanted = new Set(exchangeIds.filter((id) => id.startsWith(EXCHANGE_DEVICE_ID_PREFIX)));
    if (wanted.size === 0) return new Map();

    const [deviceIds, hashes] = await Promise.all([this.repo.findKnownDeviceIds(userId), this.repo.findBookHashes(userId, bookId)]);
    const deviceByExchangeId = new Map<string, string>();
    for (const deviceId of deviceIds) {
      for (const hash of hashes) {
        const id = exchangeDeviceId(deviceId, hash);
        if (wanted.has(id)) deviceByExchangeId.set(id, deviceId);
      }
    }
    if (deviceByExchangeId.size === 0) return new Map();

    const descriptions = await this.describeDevices(userId, [...deviceByExchangeId.values()]);
    const result = new Map<string, KoreaderDeviceDescription>();
    for (const [exchangeId, deviceId] of deviceByExchangeId) {
      const description = descriptions.get(deviceId);
      if (description) result.set(exchangeId, description);
    }
    return result;
  }
}
