import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BookJournalQueryDto } from './book-journal-query.dto';
import { CreateBookJournalEntryDto } from './create-book-journal-entry.dto';
import { UpdateBookJournalEntryDto } from './update-book-journal-entry.dto';

const CLIENT_ID = '4f9c7a52-3d1e-4b6a-9a51-0c2f6e8d7b13';

async function errorsFor<T extends object>(cls: new () => T, value: Record<string, unknown>) {
  return validate(plainToInstance(cls, value), { whitelist: true, forbidNonWhitelisted: true });
}

async function failedProperties<T extends object>(cls: new () => T, value: Record<string, unknown>) {
  return (await errorsFor(cls, value)).map((error) => error.property);
}

describe('Book journal DTO validation', () => {
  describe('CreateBookJournalEntryDto', () => {
    it('accepts a full payload, with every optional field null or set', async () => {
      expect(
        await errorsFor(CreateBookJournalEntryDto, {
          clientId: CLIENT_ID,
          body: 'A note',
          quote: 'Quoted line',
          chapterTitle: 'Chapter 4',
          positionPercent: 37.5,
          cfi: 'epubcfi(/6/8!/4/2/1:0)',
          positionSeconds: 12.25,
          createdAt: '2026-10-01T08:30:00.000Z',
        }),
      ).toHaveLength(0);
      expect(
        await errorsFor(CreateBookJournalEntryDto, {
          clientId: CLIENT_ID,
          body: 'A note',
          quote: null,
          chapterTitle: null,
          positionPercent: null,
          cfi: null,
          positionSeconds: null,
        }),
      ).toHaveLength(0);
    });

    it('accepts an uppercase UUID as Swift generates it', async () => {
      expect(await errorsFor(CreateBookJournalEntryDto, { clientId: CLIENT_ID.toUpperCase(), body: 'A note' })).toHaveLength(0);
    });

    it('trims the body and rejects one that is blank', async () => {
      const dto = plainToInstance(CreateBookJournalEntryDto, { clientId: CLIENT_ID, body: '  padded  ' });
      expect(dto.body).toBe('padded');
      expect(await failedProperties(CreateBookJournalEntryDto, { clientId: CLIENT_ID, body: '   \n ' })).toEqual(['body']);
      expect(await failedProperties(CreateBookJournalEntryDto, { clientId: CLIENT_ID, body: '' })).toEqual(['body']);
      expect(await failedProperties(CreateBookJournalEntryDto, { clientId: CLIENT_ID })).toEqual(['body']);
    });

    it('requires a UUID client id', async () => {
      expect(await failedProperties(CreateBookJournalEntryDto, { body: 'x' })).toEqual(['clientId']);
      expect(await failedProperties(CreateBookJournalEntryDto, { clientId: 'not-a-uuid', body: 'x' })).toEqual(['clientId']);
    });

    it('enforces length and range bounds', async () => {
      const base = { clientId: CLIENT_ID, body: 'x' };
      expect(await failedProperties(CreateBookJournalEntryDto, { ...base, body: 'a'.repeat(10001) })).toEqual(['body']);
      expect(await errorsFor(CreateBookJournalEntryDto, { ...base, body: 'a'.repeat(10000) })).toHaveLength(0);
      expect(await failedProperties(CreateBookJournalEntryDto, { ...base, quote: 'a'.repeat(5001) })).toEqual(['quote']);
      expect(await failedProperties(CreateBookJournalEntryDto, { ...base, chapterTitle: 'a'.repeat(501) })).toEqual(['chapterTitle']);
      expect(await failedProperties(CreateBookJournalEntryDto, { ...base, cfi: 'a'.repeat(2001) })).toEqual(['cfi']);
      expect(await failedProperties(CreateBookJournalEntryDto, { ...base, positionPercent: 100.5 })).toEqual(['positionPercent']);
      expect(await failedProperties(CreateBookJournalEntryDto, { ...base, positionPercent: -1 })).toEqual(['positionPercent']);
      expect(await failedProperties(CreateBookJournalEntryDto, { ...base, positionSeconds: -0.5 })).toEqual(['positionSeconds']);
      expect(await failedProperties(CreateBookJournalEntryDto, { ...base, createdAt: 'yesterday' })).toEqual(['createdAt']);
    });

    it('rejects fields the contract does not know', async () => {
      expect(await failedProperties(CreateBookJournalEntryDto, { clientId: CLIENT_ID, body: 'x', mood: 'happy' })).toEqual(['mood']);
    });
  });

  describe('UpdateBookJournalEntryDto', () => {
    it('accepts an empty patch and nulls that clear nullable fields', async () => {
      expect(await errorsFor(UpdateBookJournalEntryDto, {})).toHaveLength(0);
      expect(
        await errorsFor(UpdateBookJournalEntryDto, { quote: null, chapterTitle: null, positionPercent: null, cfi: null, positionSeconds: null }),
      ).toHaveLength(0);
    });

    it('rejects a null or blank body, which cannot be cleared', async () => {
      expect(await failedProperties(UpdateBookJournalEntryDto, { body: null })).toEqual(['body']);
      expect(await failedProperties(UpdateBookJournalEntryDto, { body: '  ' })).toEqual(['body']);
      expect(await errorsFor(UpdateBookJournalEntryDto, { body: ' edited ' })).toHaveLength(0);
    });
  });

  describe('BookJournalQueryDto', () => {
    it('accepts the two statuses only', async () => {
      expect(await errorsFor(BookJournalQueryDto, {})).toHaveLength(0);
      expect(await errorsFor(BookJournalQueryDto, { status: 'trashed' })).toHaveLength(0);
      expect(await failedProperties(BookJournalQueryDto, { status: 'all' })).toEqual(['status']);
    });
  });
});
