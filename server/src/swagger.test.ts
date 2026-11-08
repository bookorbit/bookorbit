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
    expect(result.paths['/api/v1/books']?.get?.security).toEqual([{ bearer: [] }, { 'api-key': [] }]);
  });

  it('offers only a session on routes an API key cannot call', () => {
    const document = {
      openapi: '3.0.0',
      info: { title: 'BookOrbit API', version: 'test' },
      paths: {
        '/api/v1/auth/sessions': { get: { 'x-api-key': 'interactive', responses: { '200': { description: '' } } } },
        '/api/v1/auth/me': { get: { 'x-api-key': 'allowed', responses: { '200': { description: '' } } } },
      },
    } as unknown as OpenAPIObject;

    const result = normalizeSwaggerDocument(document);

    expect(result.paths['/api/v1/auth/sessions']?.get?.security).toEqual([{ bearer: [] }]);
    expect(result.paths['/api/v1/auth/me']?.get?.security).toEqual([{ bearer: [] }, { 'api-key': [] }]);
  });
});
