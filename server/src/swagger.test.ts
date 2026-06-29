import type { OpenAPIObject } from '@nestjs/swagger';

import { normalizeSwaggerDocument } from './swagger';

describe('normalizeSwaggerDocument', () => {
  it('uses operation-level security so public routes do not inherit bearer auth', () => {
    const document = {
      openapi: '3.0.0',
      info: { title: 'BookOrbit API', version: 'test' },
      paths: {
        '/api/v1/auth/login': {
          post: {
            'x-public': true,
            responses: { '200': { description: '' } },
          },
        },
        '/api/v1/books': {
          get: {
            responses: { '200': { description: '' } },
          },
        },
      },
      security: [{ bearer: [] }],
    } as unknown as OpenAPIObject;

    const result = normalizeSwaggerDocument(document);

    expect(result.security).toBeUndefined();
    expect(result.paths['/api/v1/auth/login']?.post?.security).toEqual([]);
    expect(result.paths['/api/v1/books']?.get?.security).toEqual([{ bearer: [] }]);
  });
});
