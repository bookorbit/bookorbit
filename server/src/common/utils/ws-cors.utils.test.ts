import { afterEach, describe, expect, it } from 'vitest';

import { wsCorsOrigin } from './ws-cors.utils';

const original = process.env.CLIENT_URL;

afterEach(() => {
  if (original === undefined) delete process.env.CLIENT_URL;
  else process.env.CLIENT_URL = original;
});

describe('wsCorsOrigin', () => {
  it('falls back to the dev client when nothing is configured', () => {
    delete process.env.CLIENT_URL;
    expect(wsCorsOrigin()).toBe('http://localhost:5173');
  });

  it('drops a trailing slash, which no Origin header ever carries', () => {
    process.env.CLIENT_URL = 'https://books.example.com/';
    expect(wsCorsOrigin()).toBe('https://books.example.com');
  });

  it('drops a path, keeping the origin a browser would actually send', () => {
    process.env.CLIENT_URL = 'https://books.example.com/app';
    expect(wsCorsOrigin()).toBe('https://books.example.com');
  });

  it('keeps a non-default port', () => {
    process.env.CLIENT_URL = 'http://192.168.1.10:8080';
    expect(wsCorsOrigin()).toBe('http://192.168.1.10:8080');
  });

  it('falls back rather than throwing on a malformed value', () => {
    process.env.CLIENT_URL = 'not a url';
    expect(wsCorsOrigin()).toBe('http://localhost:5173');
  });
});
