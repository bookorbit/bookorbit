import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { parseAudiobookshelfConnectionConfig } from './audiobookshelf-connection-config';

describe('parseAudiobookshelfConnectionConfig', () => {
  it('normalizes API mode and defaults private-network access to false', () => {
    expect(
      parseAudiobookshelfConnectionConfig({
        mode: 'api',
        baseUrl: ' https://abs.example.com:8443/ ',
        apiToken: ' token-value ',
      }),
    ).toEqual({
      mode: 'api',
      baseUrl: 'https://abs.example.com:8443',
      apiToken: 'token-value',
      allowPrivateNetwork: false,
    });
  });

  it('preserves explicit private-network access', () => {
    expect(
      parseAudiobookshelfConnectionConfig({
        mode: 'api',
        baseUrl: 'http://192.168.1.5:13378',
        apiToken: 'secret',
        allowPrivateNetwork: true,
      }),
    ).toMatchObject({ allowPrivateNetwork: true });
  });

  it.each([
    [{ mode: 'api', baseUrl: 'ftp://abs.example.com', apiToken: 'secret' }],
    [{ mode: 'api', baseUrl: 'https://abs.example.com/path', apiToken: 'secret' }],
    [{ mode: 'api', baseUrl: 'https://user:pass@abs.example.com', apiToken: 'secret' }],
    [{ mode: 'api', baseUrl: 'https://abs.example.com', apiToken: '  ' }],
    [{ mode: 'unknown' }],
    [null],
  ])('rejects invalid configuration %#', (raw) => {
    expect(() => parseAudiobookshelfConnectionConfig(raw)).toThrow(BadRequestException);
  });

  it('parses an absolute backup path for the later backup connector', () => {
    expect(parseAudiobookshelfConnectionConfig({ mode: 'backup', backupPath: ' /imports/abs/backup.audiobookshelf ' })).toEqual({
      mode: 'backup',
      backupPath: '/imports/abs/backup.audiobookshelf',
    });
  });

  it('rejects a relative backup path', () => {
    expect(() => parseAudiobookshelfConnectionConfig({ mode: 'backup', backupPath: './backup.audiobookshelf' })).toThrow(BadRequestException);
  });
});
