import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { UPLOAD_CHUNK_SIZE_BYTES } from '../../common/constants/upload.constants';
import { UploadSessionController } from './upload-session.controller';

describe('UploadSessionController', () => {
  const sessions = {
    capabilities: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    appendChunk: vi.fn(),
    complete: vi.fn(),
    cancel: vi.fn(),
  };
  const controller = new UploadSessionController(sessions as any);
  const user = { id: 7 } as any;

  it('delegates capability, create, status, complete, and cancellation requests', async () => {
    const dto = { filename: 'book.epub' } as any;
    await controller.capabilities(user);
    await controller.create(dto, user);
    await controller.get('095806d1-29a4-442c-a6ea-0d19252bf405', user);
    await controller.complete('095806d1-29a4-442c-a6ea-0d19252bf405', user);
    await controller.cancel('095806d1-29a4-442c-a6ea-0d19252bf405', user);

    expect(sessions.capabilities).toHaveBeenCalledWith(user);
    expect(sessions.create).toHaveBeenCalledWith(dto, user);
    expect(sessions.get).toHaveBeenCalledOnce();
    expect(sessions.complete).toHaveBeenCalledOnce();
    expect(sessions.cancel).toHaveBeenCalledOnce();
  });

  it('passes the exact chunk offset, checksum, stream, and multipart limit', async () => {
    const stream = { pipe: vi.fn() };
    const file = vi.fn(() => ({ file: stream }));

    await controller.appendChunk('095806d1-29a4-442c-a6ea-0d19252bf405', '123', `sha256 ${'a'.repeat(64)}`, user, { file } as any);

    expect(file).toHaveBeenCalledWith({ limits: { fileSize: UPLOAD_CHUNK_SIZE_BYTES } });
    expect(sessions.appendChunk).toHaveBeenCalledWith('095806d1-29a4-442c-a6ea-0d19252bf405', 123, `sha256 ${'a'.repeat(64)}`, stream, user);
  });

  it.each([undefined, '', '-1', '1.5', '9007199254740992'])('rejects invalid Upload-Offset %s', async (offset) => {
    await expect(
      controller.appendChunk('095806d1-29a4-442c-a6ea-0d19252bf405', offset, undefined, user, { file: vi.fn() } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a multipart request without a chunk', async () => {
    await expect(
      controller.appendChunk('095806d1-29a4-442c-a6ea-0d19252bf405', '0', undefined, user, { file: vi.fn(() => undefined) } as any),
    ).rejects.toThrow('No chunk provided');
  });
});
