import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BOOK_MERGE_FIELDS } from '@bookorbit/types';

import { BookMergeDto } from './book-merge.dto';

describe('BookMergeDto', () => {
  it('accepts an override for every pickable merge field', async () => {
    const fieldOverrides = Object.fromEntries(BOOK_MERGE_FIELDS.map((field) => [field, 7]));
    const dto = plainToInstance(BookMergeDto, { targetBookId: 7, sourceBookIds: [8], previewToken: 'token', fieldOverrides });

    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  });
});
