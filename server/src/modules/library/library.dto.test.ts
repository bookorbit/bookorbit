import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateLibraryDto } from './dto/create-library.dto';
import { GrantLibraryAccessDto } from './dto/grant-library-access.dto';
import { PrescanLibraryDto } from './dto/prescan-library.dto';
import { ReorderLibrariesDto } from './dto/reorder-libraries.dto';
import { UpdateLibraryAccessDto } from './dto/update-library-access.dto';
import { UpdateLibraryDto } from './dto/update-library.dto';

async function hasErrors(dto: object): Promise<boolean> {
  return (await validate(dto as any)).length > 0;
}

describe('Library DTO validation', () => {
  it('CreateLibraryDto requires non-empty name and at least one folder', async () => {
    const bad = plainToInstance(CreateLibraryDto, { name: '', icon: 'BookOpen', folders: [] });
    expect(await hasErrors(bad)).toBe(true);

    const good = plainToInstance(CreateLibraryDto, { name: 'Sci-Fi', icon: 'BookOpen', folders: ['/books/scifi'] });
    expect(await hasErrors(good)).toBe(false);
  });

  it('CreateLibraryDto validates organization mode', async () => {
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { name: 'x', icon: 'BookOpen', folders: ['/a'], organizationMode: 'bad' }))).toBe(true);
    expect(
      await hasErrors(plainToInstance(CreateLibraryDto, { name: 'x', icon: 'BookOpen', folders: ['/a'], organizationMode: 'book_per_folder' })),
    ).toBe(false);
    expect(
      await hasErrors(plainToInstance(CreateLibraryDto, { name: 'x', icon: 'BookOpen', folders: ['/a'], organizationMode: 'book_per_file' })),
    ).toBe(false);
  });

  it('CreateLibraryDto requires a non-empty icon and UpdateLibraryDto rejects empty icons when provided', async () => {
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { name: 'Sci-Fi', folders: ['/books/scifi'] }))).toBe(true);
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { name: 'Sci-Fi', icon: '   ', folders: ['/books/scifi'] }))).toBe(true);
    expect(await hasErrors(plainToInstance(UpdateLibraryDto, { icon: '   ' }))).toBe(true);
    expect(await hasErrors(plainToInstance(UpdateLibraryDto, { icon: null }))).toBe(true);
    expect(await hasErrors(plainToInstance(UpdateLibraryDto, { icon: 'BookOpen' }))).toBe(false);
  });

  it('UpdateLibraryDto allows explicit null fileNamingPattern while validating string values', async () => {
    expect(await hasErrors(plainToInstance(UpdateLibraryDto, { fileNamingPattern: null }))).toBe(false);
    expect(await hasErrors(plainToInstance(UpdateLibraryDto, { fileNamingPattern: 123 }))).toBe(true);
  });

  it('GrantLibraryAccessDto and UpdateLibraryAccessDto enforce allowed access levels', async () => {
    expect(await hasErrors(plainToInstance(GrantLibraryAccessDto, { userId: 2, accessLevel: 'admin' }))).toBe(true);
    expect(await hasErrors(plainToInstance(UpdateLibraryAccessDto, { accessLevel: 'owner' }))).toBe(false);
  });

  it('PrescanLibraryDto requires at least one non-empty path', async () => {
    expect(await hasErrors(plainToInstance(PrescanLibraryDto, { paths: [''] }))).toBe(true);
    expect(await hasErrors(plainToInstance(PrescanLibraryDto, { paths: ['/books'] }))).toBe(false);
  });

  it('ReorderLibrariesDto validates nested order items', async () => {
    const bad = plainToInstance(ReorderLibrariesDto, { order: [{ id: 0, displayOrder: -1 }] });
    expect(await hasErrors(bad)).toBe(true);

    const good = plainToInstance(ReorderLibrariesDto, { order: [{ id: 1, displayOrder: 0 }] });
    expect(await hasErrors(good)).toBe(false);
  });

  it('CreateLibraryDto validates readingThreshold bounds', async () => {
    const base = { name: 'x', icon: 'BookOpen', folders: ['/a'] };
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, readingThreshold: 0.04 }))).toBe(true);
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, readingThreshold: 5.01 }))).toBe(true);
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, readingThreshold: 0.05 }))).toBe(false);
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, readingThreshold: 5 }))).toBe(false);
  });

  it('CreateLibraryDto validates markAsFinishedPercentComplete bounds', async () => {
    const base = { name: 'x', icon: 'BookOpen', folders: ['/a'] };
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, markAsFinishedPercentComplete: 89 }))).toBe(true);
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, markAsFinishedPercentComplete: 101 }))).toBe(true);
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, markAsFinishedPercentComplete: 90.5 }))).toBe(true);
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, markAsFinishedPercentComplete: 90 }))).toBe(false);
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, markAsFinishedPercentComplete: 100 }))).toBe(false);
  });

  it('UpdateLibraryDto validates readingThreshold and markAsFinishedPercentComplete bounds', async () => {
    expect(await hasErrors(plainToInstance(UpdateLibraryDto, { readingThreshold: 0.04 }))).toBe(true);
    expect(await hasErrors(plainToInstance(UpdateLibraryDto, { readingThreshold: 2.5 }))).toBe(false);
    expect(await hasErrors(plainToInstance(UpdateLibraryDto, { markAsFinishedPercentComplete: 89 }))).toBe(true);
    expect(await hasErrors(plainToInstance(UpdateLibraryDto, { markAsFinishedPercentComplete: 95 }))).toBe(false);
  });

  describe('file write settings validation', () => {
    const base = { name: 'x', icon: 'BookOpen', folders: ['/a'] };

    it('CreateLibraryDto accepts valid boolean file write flags', async () => {
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteEnabled: true }))).toBe(false);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteEnabled: false }))).toBe(false);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteWriteCover: true }))).toBe(false);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteEpubEnabled: false }))).toBe(false);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWritePdfEnabled: false }))).toBe(false);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteCbxEnabled: true }))).toBe(false);
    });

    it('CreateLibraryDto rejects non-boolean file write flags', async () => {
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteEnabled: 'yes' }))).toBe(true);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteWriteCover: 1 }))).toBe(true);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteEpubEnabled: 'true' }))).toBe(true);
    });

    it('CreateLibraryDto validates fileWriteEpubMaxFileSizeMb bounds', async () => {
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteEpubMaxFileSizeMb: 0 }))).toBe(true);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteEpubMaxFileSizeMb: 1 }))).toBe(false);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteEpubMaxFileSizeMb: 10000 }))).toBe(false);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteEpubMaxFileSizeMb: 10001 }))).toBe(true);
    });

    it('CreateLibraryDto validates fileWritePdfMaxFileSizeMb bounds', async () => {
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWritePdfMaxFileSizeMb: 0 }))).toBe(true);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWritePdfMaxFileSizeMb: 1 }))).toBe(false);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWritePdfMaxFileSizeMb: 10000 }))).toBe(false);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWritePdfMaxFileSizeMb: 10001 }))).toBe(true);
    });

    it('CreateLibraryDto validates fileWriteCbxMaxFileSizeMb bounds', async () => {
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteCbxMaxFileSizeMb: 0 }))).toBe(true);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteCbxMaxFileSizeMb: 1 }))).toBe(false);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteCbxMaxFileSizeMb: 10000 }))).toBe(false);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteCbxMaxFileSizeMb: 10001 }))).toBe(true);
    });

    it('CreateLibraryDto rejects non-integer max size values', async () => {
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteEpubMaxFileSizeMb: 1.5 }))).toBe(true);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWritePdfMaxFileSizeMb: 100.9 }))).toBe(true);
      expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, fileWriteCbxMaxFileSizeMb: 0.5 }))).toBe(true);
    });

    it('UpdateLibraryDto applies the same max size constraints', async () => {
      expect(await hasErrors(plainToInstance(UpdateLibraryDto, { fileWriteEpubMaxFileSizeMb: 0 }))).toBe(true);
      expect(await hasErrors(plainToInstance(UpdateLibraryDto, { fileWriteEpubMaxFileSizeMb: 1 }))).toBe(false);
      expect(await hasErrors(plainToInstance(UpdateLibraryDto, { fileWritePdfMaxFileSizeMb: 10001 }))).toBe(true);
      expect(await hasErrors(plainToInstance(UpdateLibraryDto, { fileWritePdfMaxFileSizeMb: 10000 }))).toBe(false);
      expect(await hasErrors(plainToInstance(UpdateLibraryDto, { fileWriteCbxMaxFileSizeMb: 0 }))).toBe(true);
      expect(await hasErrors(plainToInstance(UpdateLibraryDto, { fileWriteCbxMaxFileSizeMb: 500 }))).toBe(false);
    });

    it('UpdateLibraryDto accepts all 8 file write fields simultaneously', async () => {
      const dto = plainToInstance(UpdateLibraryDto, {
        fileWriteEnabled: true,
        fileWriteWriteCover: false,
        fileWriteEpubEnabled: true,
        fileWriteEpubMaxFileSizeMb: 200,
        fileWritePdfEnabled: false,
        fileWritePdfMaxFileSizeMb: 50,
        fileWriteCbxEnabled: true,
        fileWriteCbxMaxFileSizeMb: 1000,
      });
      expect(await hasErrors(dto)).toBe(false);
    });
  });
});
