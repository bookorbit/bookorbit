import { BadRequestException } from '@nestjs/common';

import { LibraryController } from './library.controller';

describe('LibraryController', () => {
  const libraryService = {
    findAll: jest.fn(),
    verifyUserAccess: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    prescan: jest.fn(),
    reorder: jest.fn(),
    getStats: jest.fn(),
    getAccess: jest.fn(),
    grantAccess: jest.fn(),
    updateAccess: jest.fn(),
    revokeAccess: jest.fn(),
  };

  const bookService = { queryForLibrary: jest.fn() };
  const fileWriteService = { writeToFile: jest.fn() };
  const fileWriteRepo = { findNonMissingBookFilesByLibrary: jest.fn() };
  const fileWriteSettings = { resolve: jest.fn() };

  const controller = new LibraryController(
    libraryService as any,
    bookService as any,
    fileWriteService as any,
    fileWriteRepo as any,
    fileWriteSettings as any,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    libraryService.verifyUserAccess.mockResolvedValue(undefined);
  });

  it('writeMetadataToFiles blocks non-dry-run when file write is disabled', async () => {
    fileWriteSettings.resolve.mockResolvedValue({ enabled: false });

    await expect(
      controller.writeMetadataToFiles(1, undefined, { id: 1, roles: [{ isSuperuser: true }] } as any, { raw: {} } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writeMetadataToFiles streams progress and final done event with counters', async () => {
    fileWriteSettings.resolve.mockResolvedValue({ enabled: true });
    fileWriteRepo.findNonMissingBookFilesByLibrary.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }, { bookId: 3 }]);

    fileWriteService.writeToFile
      .mockResolvedValueOnce({ status: 'success', fieldsWritten: [], durationMs: 1 })
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce({ status: 'skipped', fieldsWritten: [], durationMs: 1, reason: 'no changes' });

    const reply = {
      raw: {
        writeHead: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      },
    };

    await controller.writeMetadataToFiles(1, 'false', { id: 7, roles: [{ isSuperuser: false }] } as any, reply as any);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'text/event-stream' }));
    expect(reply.raw.write).toHaveBeenCalledTimes(4);

    const doneLine = (reply.raw.write as jest.Mock).mock.calls[3][0] as string;
    const donePayload = JSON.parse(doneLine.replace(/^data:\s*/, '').trim());
    expect(donePayload).toEqual(expect.objectContaining({ done: true, processed: 3, succeeded: 1, failed: 1, skipped: 1 }));
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it('writeMetadataToFiles in dry-run mode skips settings check', async () => {
    fileWriteRepo.findNonMissingBookFilesByLibrary.mockResolvedValue([]);
    const reply = { raw: { writeHead: jest.fn(), write: jest.fn(), end: jest.fn() } };

    await controller.writeMetadataToFiles(1, 'true', { id: 1, roles: [{ isSuperuser: true }] } as any, reply as any);

    expect(fileWriteSettings.resolve).not.toHaveBeenCalled();
  });
});
