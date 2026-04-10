import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PreviewCountDto, UpdateBookMetadataFetchConfigDto, UpdateLibraryBookMetadataFetchConfigDto } from './dto/update-config.dto';

async function errorsFor<T extends object>(dtoClass: new () => T, value: Record<string, unknown>) {
  return validate(plainToInstance(dtoClass, value));
}

describe('Book metadata fetch config DTO validation', () => {
  it('accepts a fully-specified global config payload', async () => {
    const payload = {
      enabled: true,
      triggerOnImport: false,
      conditions: {
        scoreThreshold: { enabled: true, threshold: 60 },
        missingFields: { enabled: true, fields: ['description', 'narrators', 'duration'] },
        neverFetched: { enabled: true },
      },
    };

    expect((await errorsFor(UpdateBookMetadataFetchConfigDto, payload)).length).toBe(0);
  });

  it('rejects invalid threshold values and unknown metadata fields', async () => {
    const badThreshold = {
      enabled: true,
      triggerOnImport: true,
      conditions: {
        scoreThreshold: { enabled: true, threshold: 101 },
        missingFields: { enabled: true, fields: ['description'] },
        neverFetched: { enabled: true },
      },
    };
    const badField = {
      enabled: true,
      triggerOnImport: true,
      conditions: {
        scoreThreshold: { enabled: true, threshold: 50 },
        missingFields: { enabled: true, fields: ['not_a_field'] },
        neverFetched: { enabled: true },
      },
    };

    expect((await errorsFor(UpdateBookMetadataFetchConfigDto, badThreshold)).length).toBeGreaterThan(0);
    expect((await errorsFor(UpdateBookMetadataFetchConfigDto, badField)).length).toBeGreaterThan(0);
  });

  it('PreviewCountDto requires nested conditions and validates optional library id', async () => {
    const valid = {
      conditions: {
        scoreThreshold: { enabled: false, threshold: 60 },
        missingFields: { enabled: true, fields: ['cover'] },
        neverFetched: { enabled: true },
      },
      libraryId: 12,
    };

    expect((await errorsFor(PreviewCountDto, valid)).length).toBe(0);
    expect((await errorsFor(PreviewCountDto, { libraryId: 12 })).length).toBeGreaterThan(0);
    expect((await errorsFor(PreviewCountDto, { ...valid, libraryId: 'x' as never })).length).toBeGreaterThan(0);
  });

  it('UpdateLibraryBookMetadataFetchConfigDto allows partial override payloads', async () => {
    expect((await errorsFor(UpdateLibraryBookMetadataFetchConfigDto, { enabled: true })).length).toBe(0);
    expect(
      (
        await errorsFor(UpdateLibraryBookMetadataFetchConfigDto, {
          conditions: {
            scoreThreshold: { enabled: true, threshold: 45 },
            missingFields: { enabled: true, fields: ['publisher'] },
            neverFetched: { enabled: false },
          },
        })
      ).length,
    ).toBe(0);
  });
});
