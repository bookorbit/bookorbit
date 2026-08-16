import { BadRequestException } from '@nestjs/common';

import { parseCalibreWebAutomatedConnectionConfig } from './calibre-web-automated-connection-config';

describe('parseCalibreWebAutomatedConnectionConfig', () => {
  it('normalizes a snapshot configuration', () => {
    expect(
      parseCalibreWebAutomatedConnectionConfig({
        mode: 'snapshot',
        appDatabasePath: ' /imports/cwa/app.db ',
        metadataDatabasePath: ' /imports/cwa/metadata.db ',
      }),
    ).toEqual({
      mode: 'snapshot',
      appDatabasePath: '/imports/cwa/app.db',
      metadataDatabasePath: '/imports/cwa/metadata.db',
    });
  });

  it.each([null, [], 'snapshot'])('rejects non-object input', (raw) => {
    expect(() => parseCalibreWebAutomatedConnectionConfig(raw)).toThrow(BadRequestException);
  });

  it.each([undefined, null, '', 'api'])('rejects unsupported modes', (mode) => {
    expect(() =>
      parseCalibreWebAutomatedConnectionConfig({
        mode,
        appDatabasePath: '/imports/app.db',
        metadataDatabasePath: '/imports/metadata.db',
      }),
    ).toThrow('mode must be snapshot');
  });

  it.each([
    [{ mode: 'snapshot', metadataDatabasePath: '/imports/metadata.db' }, 'appDatabasePath is required'],
    [{ mode: 'snapshot', appDatabasePath: '/imports/app.db' }, 'metadataDatabasePath is required'],
    [{ mode: 'snapshot', appDatabasePath: './app.db', metadataDatabasePath: '/imports/metadata.db' }, 'appDatabasePath must be an absolute path'],
    [
      { mode: 'snapshot', appDatabasePath: '/imports/app.db', metadataDatabasePath: '../metadata.db' },
      'metadataDatabasePath must be an absolute path',
    ],
  ])('rejects missing and relative paths', (raw, message) => {
    expect(() => parseCalibreWebAutomatedConnectionConfig(raw)).toThrow(message as string);
  });
});
