import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UploadCoverFromUrlDto } from './upload-cover-from-url.dto';

describe('UploadCoverFromUrlDto', () => {
  it('accepts valid http/https URLs and rejects invalid protocols or malformed values', async () => {
    await expect(validate(plainToInstance(UploadCoverFromUrlDto, { url: 'https://example.com/cover.jpg' }))).resolves.toHaveLength(0);
    await expect(validate(plainToInstance(UploadCoverFromUrlDto, { url: 'http://example.com/cover.jpg' }))).resolves.toHaveLength(0);

    await expect(validate(plainToInstance(UploadCoverFromUrlDto, { url: 'ftp://example.com/file.jpg' }))).resolves.not.toHaveLength(0);
    await expect(validate(plainToInstance(UploadCoverFromUrlDto, { url: 'not-a-url' }))).resolves.not.toHaveLength(0);
  });
});
