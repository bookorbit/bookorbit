import { BadRequestException } from '@nestjs/common';

import { LibraryController } from './library.controller';

describe('LibraryController', () => {
  const libraryService = {
    findAll: vi.fn(),
    verifyUserAccess: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    prescan: vi.fn(),
    reorder: vi.fn(),
    getStats: vi.fn(),
    getAccess: vi.fn(),
    grantAccess: vi.fn(),
    updateAccess: vi.fn(),
    revokeAccess: vi.fn(),
  };

  const bookService = { queryForLibrary: vi.fn() };
  const fileWriteService = {
    writeToFile: vi.fn(),
    findNonMissingBookFilesByLibrary: vi.fn(),
    resolveSettings: vi.fn(),
  };

  const controller = new LibraryController(libraryService as any, bookService as any, fileWriteService as any);

  beforeEach(() => {
    vi.resetAllMocks();
    libraryService.verifyUserAccess.mockResolvedValue(undefined);
  });

  it('writeMetadataToFiles blocks non-dry-run when file write is disabled', async () => {
    fileWriteService.resolveSettings.mockResolvedValue({ enabled: false });

    await expect(controller.writeMetadataToFiles(1, undefined, { id: 1, isSuperuser: true } as any, { raw: {} } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('writeMetadataToFiles streams progress and final done event with counters', async () => {
    fileWriteService.resolveSettings.mockResolvedValue({ enabled: true });
    fileWriteService.findNonMissingBookFilesByLibrary.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }, { bookId: 3 }]);

    fileWriteService.writeToFile
      .mockResolvedValueOnce({ status: 'success', fieldsWritten: [], durationMs: 1 })
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce({ status: 'skipped', fieldsWritten: [], durationMs: 1, reason: 'no changes' });

    const reply = {
      raw: {
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      },
    };

    await controller.writeMetadataToFiles(1, 'false', { id: 7, isSuperuser: false } as any, reply as any);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'text/event-stream' }));
    expect(reply.raw.write).toHaveBeenCalledTimes(4);

    const doneLine = (reply.raw.write as vi.Mock).mock.calls[3][0] as string;
    const donePayload = JSON.parse(doneLine.replace(/^data:\s*/, '').trim());
    expect(donePayload).toEqual(expect.objectContaining({ done: true, processed: 3, succeeded: 1, failed: 1, skipped: 1 }));
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it('writeMetadataToFiles in dry-run mode skips settings check', async () => {
    fileWriteService.findNonMissingBookFilesByLibrary.mockResolvedValue([]);
    const reply = { raw: { writeHead: vi.fn(), write: vi.fn(), end: vi.fn() } };

    await controller.writeMetadataToFiles(1, 'true', { id: 1, isSuperuser: true } as any, reply as any);

    expect(fileWriteService.resolveSettings).not.toHaveBeenCalled();
  });
});
