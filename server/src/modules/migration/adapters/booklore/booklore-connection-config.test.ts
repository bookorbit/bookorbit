import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { parseBookloreConnectionConfig } from './booklore-connection-config';

describe('parseBookloreConnectionConfig', () => {
  it('parses optional absolute mediaRootPath', () => {
    const parsed = parseBookloreConnectionConfig({
      host: '127.0.0.1',
      user: 'root',
      password: 'rootpw',
      database: 'booklore',
      mediaRootPath: '/tmp/booklore-media',
    });

    expect(parsed.mediaRootPath).toBe('/tmp/booklore-media');
  });

  it('rejects relative mediaRootPath values', () => {
    expect(() =>
      parseBookloreConnectionConfig({
        host: '127.0.0.1',
        user: 'root',
        password: 'rootpw',
        database: 'booklore',
        mediaRootPath: './booklore-media',
      }),
    ).toThrow(BadRequestException);
  });
});
