import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateBookMetadataLocksDto } from './dto/update-book-metadata-locks.dto';

describe('UpdateBookMetadataLocksDto', () => {
  it('accepts unique valid lock fields', async () => {
    const dto = plainToInstance(UpdateBookMetadataLocksDto, {
      lockedFields: ['title', 'authors', 'cover'],
    });

    expect((await validate(dto)).length).toBe(0);
  });

  it('rejects duplicates and unknown lock fields', async () => {
    const duplicateDto = plainToInstance(UpdateBookMetadataLocksDto, {
      lockedFields: ['title', 'title'],
    });
    const unknownDto = plainToInstance(UpdateBookMetadataLocksDto, {
      lockedFields: ['not-a-field'],
    });

    expect((await validate(duplicateDto)).length).toBeGreaterThan(0);
    expect((await validate(unknownDto)).length).toBeGreaterThan(0);
  });
});
