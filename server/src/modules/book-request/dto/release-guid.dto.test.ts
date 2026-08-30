import 'reflect-metadata';

import { validate } from 'class-validator';

import { GrabBookRequestDto } from './grab-book-request.dto';
import { InspectBookRequestReleaseDto } from './inspect-book-request-release.dto';

describe('book request release guid DTOs', () => {
  const longGuid = `https://indexer.example/download?token=${'a'.repeat(900)}`;

  it.each([
    Object.assign(new GrabBookRequestDto(), { indexerId: 1, releaseGuid: longGuid }),
    Object.assign(new InspectBookRequestReleaseDto(), { indexerId: 1, releaseGuid: longGuid }),
  ])('accepts a bounded Torznab guid longer than 500 characters', async (dto) => {
    await expect(validate(dto)).resolves.toEqual([]);
  });
});
