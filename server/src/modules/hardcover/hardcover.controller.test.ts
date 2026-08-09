import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';

import { HardcoverController } from './hardcover.controller';

const mockSettingsService = {
  getSettings: vi.fn(),
  upsertSettings: vi.fn(),
  disconnectUser: vi.fn(),
  validateToken: vi.fn(),
};

const mockSyncService = {
  syncAll: vi.fn(),
  cancelSync: vi.fn(),
  getSyncStatus: vi.fn(),
  streamSyncStatus: vi.fn(),
  getSyncPendingSummary: vi.fn(),
  getBookSyncState: vi.fn(),
  updateBookSyncState: vi.fn(),
  syncBook: vi.fn(),
  listLinkedBooks: vi.fn(),
  getEditions: vi.fn(),
  setEdition: vi.fn(),
};

const mockImportService = {
  previewImport: vi.fn(),
  applyImport: vi.fn(),
};

const mockBookService = {
  verifyBookAccess: vi.fn(),
};

const mockUser = { id: 1, isSuperuser: false, permissions: [] };

function makeController() {
  return new HardcoverController(mockSettingsService as any, mockSyncService as any, mockImportService as any, mockBookService as any);
}

describe('HardcoverController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBookService.verifyBookAccess.mockResolvedValue(undefined);
  });

  it('getSettings delegates to service', async () => {
    mockSettingsService.getSettings.mockResolvedValue({ tokenConfigured: false });
    const result = await makeController().getSettings(mockUser as any);
    expect(result).toEqual({ tokenConfigured: false });
    expect(mockSettingsService.getSettings).toHaveBeenCalledWith(1);
  });

  it('upsertSettings delegates to service', async () => {
    mockSettingsService.upsertSettings.mockResolvedValue({ tokenConfigured: true });
    const result = await makeController().upsertSettings(mockUser as any, { apiToken: 'tok' });
    expect(result).toEqual({ tokenConfigured: true });
  });

  it('disconnectUser delegates to service', async () => {
    mockSettingsService.disconnectUser.mockResolvedValue(undefined);
    await makeController().disconnectUser(mockUser as any);
    expect(mockSettingsService.disconnectUser).toHaveBeenCalledWith(1);
  });

  it('validateToken delegates to service', async () => {
    mockSettingsService.validateToken.mockResolvedValue({ valid: true, hardcoverUsername: 'neon' });
    const result = await makeController().validateToken(mockUser as any, {});
    expect(result).toEqual({ valid: true, hardcoverUsername: 'neon' });
  });

  it('startSync returns runId', async () => {
    mockSyncService.syncAll.mockResolvedValue(42);
    const result = await makeController().startSync(mockUser as any);
    expect(result).toEqual({ runId: 42 });
  });

  it('getSyncStatus delegates to service', () => {
    mockSyncService.getSyncStatus.mockReturnValue(null);
    const result = makeController().getSyncStatus(mockUser as any);
    expect(result).toBeNull();
  });

  it('getSyncStatusStream delegates to service', async () => {
    mockSyncService.streamSyncStatus.mockReturnValue(of(null));
    const stream = makeController().getSyncStatusStream(mockUser as any);
    const emitted = await new Promise((resolve) => stream.subscribe((event) => resolve(event)));
    expect(emitted).toEqual({ data: { activeSyncStatus: null } });
    expect(mockSyncService.streamSyncStatus).toHaveBeenCalledWith(1);
  });

  it('getSyncPendingSummary delegates to service', async () => {
    mockSyncService.getSyncPendingSummary.mockResolvedValue({ totalBooks: 10, pendingBooks: 2 });
    const result = await makeController().getSyncPendingSummary(mockUser as any);
    expect(result).toEqual({ totalBooks: 10, pendingBooks: 2 });
    expect(mockSyncService.getSyncPendingSummary).toHaveBeenCalledWith(1);
  });

  it('gets per-book sync state after verifying book access', async () => {
    mockSyncService.getBookSyncState.mockResolvedValue({
      bookId: 42,
      syncOverride: null,
      syncEnabled: true,
      canSyncNow: false,
      effectiveReason: null,
      lastSyncedAt: null,
      syncError: null,
    });

    const result = await makeController().getBookSyncState(mockUser as any, 42);

    expect(result).toEqual({
      bookId: 42,
      syncOverride: null,
      syncEnabled: true,
      canSyncNow: false,
      effectiveReason: null,
      lastSyncedAt: null,
      syncError: null,
    });
    expect(mockBookService.verifyBookAccess).toHaveBeenCalledWith(42, mockUser);
    expect(mockSyncService.getBookSyncState).toHaveBeenCalledWith(1, 42);
  });

  it('updates per-book sync state after verifying book access', async () => {
    mockSyncService.updateBookSyncState.mockResolvedValue({
      bookId: 42,
      syncOverride: 'excluded',
      syncEnabled: false,
      canSyncNow: false,
      effectiveReason: 'excluded',
      lastSyncedAt: null,
      syncError: null,
    });

    const result = await makeController().updateBookSyncState(mockUser as any, 42, { syncEnabled: false });

    expect(result).toEqual({
      bookId: 42,
      syncOverride: 'excluded',
      syncEnabled: false,
      canSyncNow: false,
      effectiveReason: 'excluded',
      lastSyncedAt: null,
      syncError: null,
    });
    expect(mockBookService.verifyBookAccess).toHaveBeenCalledWith(42, mockUser);
    expect(mockSyncService.updateBookSyncState).toHaveBeenCalledWith(1, 42, { syncEnabled: false });
  });

  it('syncs a single book after verifying book access', async () => {
    mockSyncService.syncBook.mockResolvedValue('synced');
    mockSyncService.getBookSyncState.mockResolvedValue({
      bookId: 42,
      syncOverride: 'included',
      syncEnabled: true,
      canSyncNow: false,
      effectiveReason: null,
      lastSyncedAt: '2026-01-01T00:00:00.000Z',
      syncError: null,
    });

    const result = await makeController().syncBook(mockUser as any, 42);

    expect(result).toEqual({
      result: 'synced',
      state: {
        bookId: 42,
        syncOverride: 'included',
        syncEnabled: true,
        canSyncNow: false,
        effectiveReason: null,
        lastSyncedAt: '2026-01-01T00:00:00.000Z',
        syncError: null,
      },
    });
    expect(mockBookService.verifyBookAccess).toHaveBeenCalledWith(42, mockUser);
    expect(mockSyncService.syncBook).toHaveBeenCalledWith(1, 42);
    expect(mockSyncService.getBookSyncState).toHaveBeenCalledWith(1, 42);
  });

  it('listLinkedBooks delegates to service', async () => {
    mockSyncService.listLinkedBooks.mockResolvedValue({ books: [{ bookId: 1, title: 'Book One' }], truncated: false });
    const result = await makeController().listLinkedBooks(mockUser as any);
    expect(result).toEqual({ books: [{ bookId: 1, title: 'Book One' }], truncated: false });
    expect(mockSyncService.listLinkedBooks).toHaveBeenCalledWith(1);
  });

  it('listEditions delegates to service after verifying book access', async () => {
    mockSyncService.getEditions.mockResolvedValue({ editions: [{ id: 200, format: 'Physical Book' }], truncated: false });
    const result = await makeController().listEditions(mockUser as any, 42);
    expect(result).toEqual({ editions: [{ id: 200, format: 'Physical Book' }], truncated: false });
    expect(mockBookService.verifyBookAccess).toHaveBeenCalledWith(42, mockUser);
    expect(mockSyncService.getEditions).toHaveBeenCalledWith(1, 42);
  });

  it('setEdition delegates to service after verifying book access', async () => {
    mockSyncService.setEdition.mockResolvedValue({ success: true });
    const result = await makeController().setEdition(mockUser as any, 42, { editionId: 200 });
    expect(result).toEqual({ success: true });
    expect(mockBookService.verifyBookAccess).toHaveBeenCalledWith(42, mockUser);
    expect(mockSyncService.setEdition).toHaveBeenCalledWith(1, 42, 200);
  });

  it('previewImport delegates to service', async () => {
    mockImportService.previewImport.mockResolvedValue({ summary: { willUpdate: 1 }, rows: [] });
    const result = await makeController().previewImport(mockUser as any);
    expect(result).toEqual({ summary: { willUpdate: 1 }, rows: [] });
    expect(mockImportService.previewImport).toHaveBeenCalledWith(mockUser);
  });

  it('applyImport delegates to service', async () => {
    mockImportService.applyImport.mockResolvedValue({ applied: 1, failed: 0 });
    const dto = { hardcoverUserBookIds: [1000], importProgress: true };
    const result = await makeController().applyImport(mockUser as any, dto);
    expect(result).toEqual({ applied: 1, failed: 0 });
    expect(mockImportService.applyImport).toHaveBeenCalledWith(mockUser, dto);
  });
});
