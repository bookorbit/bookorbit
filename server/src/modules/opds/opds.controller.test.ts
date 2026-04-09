vi.mock('fs', () => ({
  createReadStream: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
}));

import { createReadStream } from 'fs';
import { readdir, stat } from 'fs/promises';
import type { MockedFunction } from 'vitest';

import { OpdsController } from './opds.controller';

const mockCreateReadStream = createReadStream as MockedFunction<typeof createReadStream>;
const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockStat = stat as MockedFunction<typeof stat>;

function makeController() {
  const opdsService = {} as never;
  const opdsBookService = {
    validateBookAccess: vi.fn().mockResolvedValue(undefined),
  } as never;
  const config = {
    get: vi.fn().mockReturnValue('/books'),
  } as never;

  return {
    controller: new OpdsController(opdsService, opdsBookService, config),
    opdsBookService,
  };
}

function makeReply() {
  const reply = {
    header: vi.fn(),
    type: vi.fn(),
    status: vi.fn(),
    send: vi.fn(),
  };

  reply.header.mockReturnValue(reply);
  reply.type.mockReturnValue(reply);
  reply.status.mockReturnValue(reply);

  return reply as never;
}

describe('OpdsController', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('serves the preferred stored cover file for OPDS clients', async () => {
    const { controller, opdsBookService } = makeController();
    const reply = makeReply();
    const stream = { kind: 'stream' };

    mockReaddir.mockResolvedValue(['cover_extracted.jpg', 'cover_custom.png'] as never);
    mockStat.mockResolvedValue({ mtimeMs: 1234 } as never);
    mockCreateReadStream.mockReturnValue(stream as never);

    await controller.cover(42, { userId: 7, isSuperuser: false } as never, reply);

    expect(opdsBookService.validateBookAccess).toHaveBeenCalledWith(42, 7, false);
    expect(mockCreateReadStream).toHaveBeenCalledWith('/books/covers/42/cover_custom.png');
    expect(reply.header).toHaveBeenCalledWith('ETag', '"1234"');
    expect(reply.type).toHaveBeenCalledWith('image/png');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });
});
