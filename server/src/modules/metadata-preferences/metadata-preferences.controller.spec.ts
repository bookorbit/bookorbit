import { BadRequestException } from '@nestjs/common';
import { MetadataProviderKey } from '@projectx/types';

import { MetadataPreferencesController } from './metadata-preferences.controller';
import { MetadataPreferencesService } from './metadata-preferences.service';

describe('MetadataPreferencesController', () => {
  let service: jest.Mocked<MetadataPreferencesService>;
  let controller: MetadataPreferencesController;

  beforeEach(() => {
    service = {
      getGlobal: jest.fn(),
      setGlobal: jest.fn(),
      getForLibrary: jest.fn(),
      setLibraryFieldOverride: jest.fn(),
      resetLibraryToGlobal: jest.fn(),
    } as unknown as jest.Mocked<MetadataPreferencesService>;

    controller = new MetadataPreferencesController(service);
  });

  it('returns global preferences from service', async () => {
    service.getGlobal.mockResolvedValue({ fields: {} } as never);

    const result = await controller.getGlobal();

    expect(service.getGlobal).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ fields: {} });
  });

  it('delegates global updates', async () => {
    const dto = {
      fields: {
        title: {
          enabled: true,
          providers: [MetadataProviderKey.GOOGLE],
          mergeStrategy: 'fillMissing',
        },
      },
    };

    await controller.setGlobal(dto as never);

    expect(service.setGlobal).toHaveBeenCalledWith(dto);
  });

  it('returns library-specific effective preferences', async () => {
    service.getForLibrary.mockResolvedValue({ libraryId: 1, overrides: null, effective: { fields: {} } } as never);

    const result = await controller.getForLibrary(1);

    expect(service.getForLibrary).toHaveBeenCalledWith(1);
    expect(result.libraryId).toBe(1);
  });

  it('writes a field override when the field key is valid', async () => {
    const dto = {
      enabled: true,
      providers: [MetadataProviderKey.OPEN_LIBRARY],
      mergeStrategy: 'overwriteIfProvided',
    };

    await controller.setLibraryFieldOverride(2, 'title', dto as never);

    expect(service.setLibraryFieldOverride).toHaveBeenCalledWith(2, 'title', dto);
  });

  it('rejects invalid field keys when writing a library override', () => {
    expect(() =>
      controller.setLibraryFieldOverride(2, 'not-a-field', {
        enabled: true,
        providers: [MetadataProviderKey.GOOGLE],
        mergeStrategy: 'fillMissing',
      } as never),
    ).toThrow(BadRequestException);

    expect(service.setLibraryFieldOverride).not.toHaveBeenCalled();
  });

  it('clears a valid field override', async () => {
    await controller.clearLibraryFieldOverride(4, 'authors');

    expect(service.setLibraryFieldOverride).toHaveBeenCalledWith(4, 'authors', null);
  });

  it('rejects invalid field keys when clearing a library override', () => {
    expect(() => controller.clearLibraryFieldOverride(4, 'invalid')).toThrow(BadRequestException);
    expect(service.setLibraryFieldOverride).not.toHaveBeenCalled();
  });

  it('delegates library reset to service', async () => {
    await controller.resetLibraryToGlobal(8);

    expect(service.resetLibraryToGlobal).toHaveBeenCalledWith(8);
  });
});
