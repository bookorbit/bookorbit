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
    const bad = plainToInstance(CreateLibraryDto, { name: '', folders: [] });
    expect(await hasErrors(bad)).toBe(true);

    const good = plainToInstance(CreateLibraryDto, { name: 'Sci-Fi', folders: ['/books/scifi'] });
    expect(await hasErrors(good)).toBe(false);
  });

  it('CreateLibraryDto validates organization mode', async () => {
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { name: 'x', folders: ['/a'], organizationMode: 'bad' }))).toBe(true);
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { name: 'x', folders: ['/a'], organizationMode: 'book_per_folder' }))).toBe(false);
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { name: 'x', folders: ['/a'], organizationMode: 'book_per_file' }))).toBe(false);
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
    const base = { name: 'x', folders: ['/a'] };
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, readingThreshold: 0.04 }))).toBe(true);
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, readingThreshold: 5.01 }))).toBe(true);
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, readingThreshold: 0.05 }))).toBe(false);
    expect(await hasErrors(plainToInstance(CreateLibraryDto, { ...base, readingThreshold: 5 }))).toBe(false);
  });

  it('CreateLibraryDto validates markAsFinishedPercentComplete bounds', async () => {
    const base = { name: 'x', folders: ['/a'] };
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
});
