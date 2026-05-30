import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BulkEditMetadataDto, BulkEditFieldsDto } from './bulk-edit-metadata.dto';

async function errorsFor(value: Record<string, unknown>) {
  const dto = plainToInstance(BulkEditMetadataDto, value);
  return validate(dto);
}

describe('BulkEditMetadataDto', () => {
  describe('valid payloads', () => {
    it('accepts a single scalar field with bookIds', async () => {
      const errors = await errorsFor({
        bookIds: [1, 2],
        fields: { publisher: { value: 'Bloomsbury' } },
      });
      expect(errors).toHaveLength(0);
    });

    it('accepts a single array field in add mode', async () => {
      const errors = await errorsFor({
        bookIds: [1],
        fields: { authors: { mode: 'add', values: ['Author A'] } },
      });
      expect(errors).toHaveLength(0);
    });

    it('accepts a single array field in remove mode', async () => {
      const errors = await errorsFor({
        bookIds: [1],
        fields: { tags: { mode: 'remove', values: ['unread'] } },
      });
      expect(errors).toHaveLength(0);
    });

    it('accepts a single array field in replace mode with empty values (clear all)', async () => {
      const errors = await errorsFor({
        bookIds: [1],
        fields: { genres: { mode: 'replace', values: [] } },
      });
      expect(errors).toHaveLength(0);
    });

    it('accepts multiple fields at once', async () => {
      const errors = await errorsFor({
        bookIds: [1, 2, 3],
        fields: {
          authors: { mode: 'add', values: ['Author X'] },
          seriesName: { value: 'Harry Potter' },
          genres: { mode: 'replace', values: ['Fantasy', 'Adventure'] },
          publisher: { value: 'Bloomsbury' },
          language: { value: 'en' },
          publishedYear: { value: 2001 },
          narrators: { mode: 'add', values: ['Stephen Fry'] },
        },
      });
      expect(errors).toHaveLength(0);
    });

    it('accepts query selection instead of bookIds', async () => {
      const errors = await errorsFor({
        query: { libraryId: 5 },
        fields: { publisher: { value: 'Penguin' } },
      });
      expect(errors).toHaveLength(0);
    });

    it('accepts null scalar value (clearing a field)', async () => {
      const errors = await errorsFor({
        bookIds: [1],
        fields: { publisher: { value: null } },
      });
      expect(errors).toHaveLength(0);
    });

    it('accepts null publishedYear value (clearing)', async () => {
      const errors = await errorsFor({
        bookIds: [1],
        fields: { publishedYear: { value: null } },
      });
      expect(errors).toHaveLength(0);
    });
  });

  describe('invalid payloads', () => {
    it('rejects missing fields', async () => {
      const errors = await errorsFor({ bookIds: [1] });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects invalid array mode', async () => {
      const errors = await errorsFor({
        bookIds: [1],
        fields: { authors: { mode: 'invalid', values: ['x'] } },
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects missing bookIds and query', async () => {
      const errors = await errorsFor({
        fields: { publisher: { value: 'Test' } },
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects non-integer publishedYear', async () => {
      const errors = await errorsFor({
        bookIds: [1],
        fields: { publishedYear: { value: 20.5 } },
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects non-string values in array field', async () => {
      const errors = await errorsFor({
        bookIds: [1],
        fields: { authors: { mode: 'add', values: [123] } },
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects missing mode in array field', async () => {
      const errors = await errorsFor({
        bookIds: [1],
        fields: { authors: { values: ['Author A'] } },
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects missing values in array field', async () => {
      const errors = await errorsFor({
        bookIds: [1],
        fields: { authors: { mode: 'add' } },
      });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('BulkEditFieldsDto helper methods', () => {
    it('hasAtLeastOneField returns true when a field is set', () => {
      const fields = plainToInstance(BulkEditFieldsDto, {
        publisher: { value: 'Test' },
      });
      expect(fields.hasAtLeastOneField()).toBe(true);
    });

    it('hasAtLeastOneField returns false for empty object', () => {
      const fields = plainToInstance(BulkEditFieldsDto, {});
      expect(fields.hasAtLeastOneField()).toBe(false);
    });

    it('hasOnlyAllowedKeys returns false for unknown keys', () => {
      const fields = plainToInstance(BulkEditFieldsDto, {});
      expect(fields.hasOnlyAllowedKeys({ unknownField: { value: 'x' } })).toBe(false);
    });

    it('hasOnlyAllowedKeys returns true for known keys only', () => {
      const fields = plainToInstance(BulkEditFieldsDto, {});
      expect(fields.hasOnlyAllowedKeys({ authors: {}, publisher: {} })).toBe(true);
    });

    it('hasValidArrayValues returns false for add mode with empty values', () => {
      const fields = plainToInstance(BulkEditFieldsDto, {
        authors: { mode: 'add', values: [] },
      });
      expect(fields.hasValidArrayValues()).toBe(false);
    });

    it('hasValidArrayValues returns false for remove mode with empty values', () => {
      const fields = plainToInstance(BulkEditFieldsDto, {
        tags: { mode: 'remove', values: [] },
      });
      expect(fields.hasValidArrayValues()).toBe(false);
    });

    it('hasValidArrayValues returns true for replace mode with empty values', () => {
      const fields = plainToInstance(BulkEditFieldsDto, {
        genres: { mode: 'replace', values: [] },
      });
      expect(fields.hasValidArrayValues()).toBe(true);
    });

    it('hasValidArrayValues returns true when all array fields have values', () => {
      const fields = plainToInstance(BulkEditFieldsDto, {
        authors: { mode: 'add', values: ['A'] },
        tags: { mode: 'remove', values: ['x'] },
      });
      expect(fields.hasValidArrayValues()).toBe(true);
    });

    it('provides typed access to all field types', () => {
      const fields = plainToInstance(BulkEditFieldsDto, {
        authors: { mode: 'add', values: ['A'] },
        seriesName: { value: 'S' },
        genres: { mode: 'replace', values: [] },
        tags: { mode: 'remove', values: ['x'] },
        publisher: { value: 'P' },
        language: { value: 'en' },
        publishedYear: { value: 2024 },
        narrators: { mode: 'add', values: ['N'] },
      });
      expect(fields.authors?.mode).toBe('add');
      expect(fields.seriesName?.value).toBe('S');
      expect(fields.genres?.values).toEqual([]);
      expect(fields.tags?.mode).toBe('remove');
      expect(fields.publisher?.value).toBe('P');
      expect(fields.language?.value).toBe('en');
      expect(fields.publishedYear?.value).toBe(2024);
      expect(fields.narrators?.values).toEqual(['N']);
    });
  });
});
