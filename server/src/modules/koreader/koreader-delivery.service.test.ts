import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { KoreaderDeliveryService } from './koreader-delivery.service';
import { KoreaderRepository } from './koreader.repository';
import { UpdateKoreaderDeliverySettingsDto } from './dto/koreader-delivery-settings.dto';
import { UpdateKoreaderUserDto } from './dto/koreader-user.dto';

describe('KOReader server delivery settings', () => {
  const repo = { findKoreaderUser: vi.fn(), getDeviceDeliverySettings: vi.fn(), setDeviceDeliverySettings: vi.fn() };
  let service: KoreaderDeliveryService;
  beforeEach(async () => {
    vi.resetAllMocks();
    repo.findKoreaderUser.mockResolvedValue({ readAloudDelivery: null });
    const module = await Test.createTestingModule({
      providers: [KoreaderDeliveryService, { provide: KoreaderRepository, useValue: repo }],
    }).compile();
    service = module.get(KoreaderDeliveryService);
  });
  it('inherits text-only for an existing unconfigured credential', async () => {
    await expect(service.getSettings(7, 'device-a')).resolves.toEqual({
      readAloudDelivery: 'audioless_epub',
      credentialDefault: null,
      deviceOverride: null,
      deviceConfigured: false,
    });
    expect(repo.findKoreaderUser).toHaveBeenCalledWith(7);
    expect(repo.getDeviceDeliverySettings).toHaveBeenCalledWith(7, 'device-a');
  });
  it('resolves device choice ahead of credential default', async () => {
    repo.findKoreaderUser.mockResolvedValue({ readAloudDelivery: 'original' });
    repo.getDeviceDeliverySettings.mockResolvedValue({ readAloudDelivery: 'audioless_epub' });
    expect((await service.getSettings(7, 'device-a')).readAloudDelivery).toBe('audioless_epub');
  });
  it('resetting a device uses the current credential default and retains configuration', async () => {
    repo.findKoreaderUser.mockResolvedValue({ readAloudDelivery: 'original' });
    repo.getDeviceDeliverySettings.mockResolvedValue({ readAloudDelivery: null });
    expect((await service.updateSettings(7, 'device-a', null)).readAloudDelivery).toBe('original');
    expect(repo.setDeviceDeliverySettings).toHaveBeenCalledWith(7, 'device-a', null, false);
  });
  it('passes migration-only updates to the atomic repository operation', async () => {
    await service.updateSettings(7, 'device-a', 'original', true);
    expect(repo.setDeviceDeliverySettings).toHaveBeenCalledWith(7, 'device-a', 'original', true);
  });
  it('rejects missing credentials', async () => {
    repo.findKoreaderUser.mockResolvedValue(undefined);
    await expect(service.getSettings(7, 'device-a')).rejects.toThrow(NotFoundException);
  });
  it('requires a device preference but accepts null reset, and rejects unknown variants', async () => {
    for (const value of ['original', 'audioless_epub', null]) {
      expect(await validate(plainToInstance(UpdateKoreaderDeliverySettingsDto, { readAloudDelivery: value }))).toHaveLength(0);
    }
    for (const body of [{}, { readAloudDelivery: 'unknown' }]) {
      expect((await validate(plainToInstance(UpdateKoreaderDeliverySettingsDto, body))).length).toBeGreaterThan(0);
    }
  });
  it('keeps credential fields optional and permits explicit inheritance', async () => {
    for (const body of [{}, { syncEnabled: false }, { readAloudDelivery: null }]) {
      expect(await validate(plainToInstance(UpdateKoreaderUserDto, body))).toHaveLength(0);
    }
    expect((await validate(plainToInstance(UpdateKoreaderUserDto, { readAloudDelivery: 'unknown' }))).length).toBeGreaterThan(0);
  });
});
