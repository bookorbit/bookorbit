import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CollectionBooksDto } from './dto/collection-books.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { ReorderCollectionsDto } from './dto/reorder-collections.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';

async function errorsFor<T extends object>(dtoClass: new () => T, value: Record<string, unknown>) {
  return validate(plainToInstance(dtoClass, value));
}

describe('Collection DTO validation', () => {
  describe('CreateCollectionDto', () => {
    it('accepts valid payloads and rejects empty names or missing icons', async () => {
      expect((await errorsFor(CreateCollectionDto, { name: 'Favorites', icon: '⭐', description: 'Best books', syncToKobo: true })).length).toBe(0);
      expect((await errorsFor(CreateCollectionDto, { name: '' })).length).toBeGreaterThan(0);
      expect((await errorsFor(CreateCollectionDto, {})).length).toBeGreaterThan(0);
      expect((await errorsFor(CreateCollectionDto, { name: 'Favorites' })).length).toBeGreaterThan(0);
      expect((await errorsFor(CreateCollectionDto, { name: 'Favorites', icon: '   ' })).length).toBeGreaterThan(0);
    });

    it('enforces field lengths', async () => {
      expect((await errorsFor(CreateCollectionDto, { name: 'a'.repeat(256) })).length).toBeGreaterThan(0);
      expect((await errorsFor(CreateCollectionDto, { name: 'x', icon: 'a'.repeat(101) })).length).toBeGreaterThan(0);
      expect((await errorsFor(CreateCollectionDto, { name: 'x', description: 'a'.repeat(1001) })).length).toBeGreaterThan(0);
    });
  });

  describe('UpdateCollectionDto', () => {
    it('allows partial updates but rejects empty names when provided', async () => {
      expect((await errorsFor(UpdateCollectionDto, {})).length).toBe(0);
      expect((await errorsFor(UpdateCollectionDto, { icon: '🧪' })).length).toBe(0);
      expect((await errorsFor(UpdateCollectionDto, { name: '' })).length).toBeGreaterThan(0);
    });
  });

  describe('CollectionBooksDto', () => {
    it('requires non-empty positive integer book ids', async () => {
      expect((await errorsFor(CollectionBooksDto, { bookIds: [1, 2, 3] })).length).toBe(0);
      expect((await errorsFor(CollectionBooksDto, { bookIds: [] })).length).toBeGreaterThan(0);
      expect((await errorsFor(CollectionBooksDto, { bookIds: [1.5] })).length).toBeGreaterThan(0);
      expect((await errorsFor(CollectionBooksDto, { bookIds: [0] })).length).toBeGreaterThan(0);
      expect((await errorsFor(CollectionBooksDto, { bookIds: [-2] })).length).toBeGreaterThan(0);
    });
  });

  describe('ReorderCollectionsDto', () => {
    it('requires at least one order item and validates each item shape', async () => {
      expect((await errorsFor(ReorderCollectionsDto, { order: [{ id: 1, displayOrder: 0 }] })).length).toBe(0);
      expect((await errorsFor(ReorderCollectionsDto, { order: [] })).length).toBeGreaterThan(0);
      expect((await errorsFor(ReorderCollectionsDto, { order: [{ id: 0, displayOrder: 0 }] })).length).toBeGreaterThan(0);
      expect((await errorsFor(ReorderCollectionsDto, { order: [{ id: 1, displayOrder: -1 }] })).length).toBeGreaterThan(0);
    });
  });
});
