import { FASTIFY_ROUTE_CONFIG_METADATA } from '@nestjs/platform-fastify/constants';
import { describe, expect, it } from 'vitest';

import { BookRequestAdminController } from './book-request-admin.controller';
import { BookRequestSelfFulfilController } from './book-request-self-fulfil.controller';
import { GRAB_BODY_LIMIT_BYTES, GRAB_TORRENT_BASE64_MAX_LENGTH } from './dto/grab-book-request.dto';

/**
 * Fastify's 1 MiB default refused a `.torrent` over about 768 KiB with a 413 before the DTO was
 * read, though the DTO takes a base64 body up to 4 Mi characters.
 */
describe('book request grab routes', () => {
  it('take a body as large as the largest .torrent the DTO accepts', () => {
    expect(GRAB_BODY_LIMIT_BYTES).toBeGreaterThan(GRAB_TORRENT_BASE64_MAX_LENGTH);
    for (const grab of [BookRequestAdminController.prototype.grab, BookRequestSelfFulfilController.prototype.grab]) {
      expect(Reflect.getMetadata(FASTIFY_ROUTE_CONFIG_METADATA, grab)).toEqual({ bodyLimit: GRAB_BODY_LIMIT_BYTES });
    }
  });
});
