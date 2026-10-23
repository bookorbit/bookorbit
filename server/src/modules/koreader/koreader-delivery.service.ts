import { Injectable, NotFoundException } from '@nestjs/common';
import type { KoreaderDeliverySettings, ReadAloudDeliveryPreference } from '@bookorbit/types';
import { KoreaderRepository } from './koreader.repository';

@Injectable()
export class KoreaderDeliveryService {
  constructor(private readonly repo: KoreaderRepository) {}

  async getSettings(userId: number, deviceId: string): Promise<KoreaderDeliverySettings> {
    const [credential, device] = await Promise.all([this.repo.findKoreaderUser(userId), this.repo.getDeviceDeliverySettings(userId, deviceId)]);
    if (!credential) throw new NotFoundException('KOReader credentials not found');
    const deviceOverride = device?.readAloudDelivery ?? null;
    const credentialDefault = credential.readAloudDelivery ?? null;
    return {
      readAloudDelivery: deviceOverride ?? credentialDefault ?? 'audioless_epub',
      credentialDefault,
      deviceOverride,
      deviceConfigured: !!device,
    };
  }

  async updateSettings(userId: number, deviceId: string, variant: ReadAloudDeliveryPreference, migrateOnly = false) {
    await this.repo.setDeviceDeliverySettings(userId, deviceId, variant, migrateOnly);
    return this.getSettings(userId, deviceId);
  }
}
