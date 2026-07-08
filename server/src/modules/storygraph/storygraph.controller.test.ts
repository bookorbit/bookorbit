import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';

import { StorygraphController } from './storygraph.controller';

const mockSettingsService = {
  getSettings: vi.fn(),
  upsertSettings: vi.fn(),
  disconnectUser: vi.fn(),
  validateCookies: vi.fn(),
};

const mockSyncService = {
  syncAll: vi.fn(),
  cancelSync: vi.fn(),
  getSyncStatus: vi.fn(),
  streamSyncStatus: vi.fn(),
  getSyncPendingSummary: vi.fn(),
  listSyncFailures: vi.fn(),
  rematchBook: vi.fn(),
  getBookSyncState: vi.fn(),
  updateBookSyncState: vi.fn(),
  syncBook: vi.fn(),
  listLinkedBooks: vi.fn(),
  linkBookManually: vi.fn(),
  listEditions: vi.fn(),
  setEdition: vi.fn(),
};

const mockBookService = {
  verifyBookAccess: vi.fn(),
};

const mockUser = { id: 1, isSuperuser: false, permissions: [] };

function makeController() {
  return new StorygraphController(mockSettingsService as any, mockSyncService as any, mockBookService as any);
}

describe('StorygraphController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getSettings delegates to service', async () => {
    mockSettingsService.getSettings.mockResolvedValue({ cookiesConfigured: false });
    const result = await makeController().getSettings(mockUser as any);
    expect(result).toEqual({ cookiesConfigured: false });
    expect(mockSettingsService.getSettings).toHaveBeenCalledWith(1);
  });

  it('upsertSettings delegates to service', async () => {
    mockSettingsService.upsertSettings.mockResolvedValue({ cookiesConfigured: true });
    const result = await makeController().upsertSettings(mockUser as any, { sessionCookie: 'sess', rememberToken: 'remember' });
    expect(result).toEqual({ cookiesConfigured: true });
  });

  it('disconnectUser delegates to service', async () => {
    mockSettingsService.disconnectUser.mockResolvedValue(undefined);
    await makeController().disconnectUser(mockUser as any);
    expect(mockSettingsService.disconnectUser).toHaveBeenCalledWith(1);
  });

  it('validateCookies delegates to service', async () => {
    mockSettingsService.validateCookies.mockResolvedValue({ valid: true });
    const result = await makeController().validateCookies(mockUser as any, { sessionCookie: 'sess', rememberToken: 'remember' });
    expect(result).toEqual({ valid: true });
    expect(mockSettingsService.validateCookies).toHaveBeenCalledWith(1, 'sess', 'remember');
  });

  it('startSync returns runId', async () => {
    mockSyncService.syncAll.mockResolvedValue(42);
    const result = await makeController().startSync(mockUser as any);
    expect(result).toEqual({ runId: 42 });
    expect(mockSyncService.syncAll).toHaveBeenCalledWith(mockUser);
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

  it('listSyncFailures delegates to service', async () => {
    const failures = [{ bookId: 7, title: 'Broken Book', authorName: null, syncError: 'no_match', lastAttemptAt: null }];
    mockSyncService.listSyncFailures.mockResolvedValue(failures);
    const result = await makeController().listSyncFailures(mockUser as any);
    expect(result).toEqual(failures);
    expect(mockSyncService.listSyncFailures).toHaveBeenCalledWith(mockUser);
  });

  it('getSyncPendingSummary delegates to service', async () => {
    mockSyncService.getSyncPendingSummary.mockResolvedValue({ totalBooks: 10, pendingBooks: 2 });
    const result = await makeController().getSyncPendingSummary(mockUser as any);
    expect(result).toEqual({ totalBooks: 10, pendingBooks: 2 });
    expect(mockSyncService.getSyncPendingSummary).toHaveBeenCalledWith(mockUser);
  });

  it('rematchBook delegates to service', async () => {
    mockSyncService.rematchBook.mockResolvedValue('synced');
    const result = await makeController().rematchBook(mockUser as any, 42);
    expect(result).toEqual({ result: 'synced' });
    expect(mockBookService.verifyBookAccess).toHaveBeenCalledWith(42, mockUser);
    expect(mockSyncService.rematchBook).toHaveBeenCalledWith(1, 42);
  });

  it('listLinkedBooks delegates to service', async () => {
    mockSyncService.listLinkedBooks.mockResolvedValue([{ bookId: 42 }]);
    const result = await makeController().listLinkedBooks(mockUser as any);
    expect(result).toEqual([{ bookId: 42 }]);
    expect(mockSyncService.listLinkedBooks).toHaveBeenCalledWith(mockUser);
  });

  it('linkBookManually delegates to service', async () => {
    mockSyncService.linkBookManually.mockResolvedValue({ success: true, storygraphBookId: 'abc-123' });
    const result = await makeController().linkBookManually(mockUser as any, 42, { input: 'https://app.thestorygraph.com/books/abc-123' });
    expect(result).toEqual({ success: true, storygraphBookId: 'abc-123' });
    expect(mockBookService.verifyBookAccess).toHaveBeenCalledWith(42, mockUser);
    expect(mockSyncService.linkBookManually).toHaveBeenCalledWith(1, 42, 'https://app.thestorygraph.com/books/abc-123');
  });

  it('listEditions delegates to service', async () => {
    mockSyncService.listEditions.mockResolvedValue([{ id: 'ed-1' }]);
    const result = await makeController().listEditions(mockUser as any, 42);
    expect(result).toEqual([{ id: 'ed-1' }]);
    expect(mockBookService.verifyBookAccess).toHaveBeenCalledWith(42, mockUser);
    expect(mockSyncService.listEditions).toHaveBeenCalledWith(1, 42);
  });

  it('setEdition delegates to service', async () => {
    mockSyncService.setEdition.mockResolvedValue({ success: true });
    const result = await makeController().setEdition(mockUser as any, 42, { editionId: 'ed-2' });
    expect(result).toEqual({ success: true });
    expect(mockBookService.verifyBookAccess).toHaveBeenCalledWith(42, mockUser);
    expect(mockSyncService.setEdition).toHaveBeenCalledWith(1, 42, 'ed-2');
  });

  it('getBookSyncState verifies access and delegates to service', async () => {
    mockSyncService.getBookSyncState.mockResolvedValue({ bookId: 42 });
    const result = await makeController().getBookSyncState(mockUser as any, 42);
    expect(result).toEqual({ bookId: 42 });
    expect(mockBookService.verifyBookAccess).toHaveBeenCalledWith(42, mockUser);
    expect(mockSyncService.getBookSyncState).toHaveBeenCalledWith(1, 42);
  });

  it('updateBookSyncState verifies access and delegates to service', async () => {
    mockSyncService.updateBookSyncState.mockResolvedValue({ bookId: 42, syncEnabled: false });
    const result = await makeController().updateBookSyncState(mockUser as any, 42, { syncEnabled: false });
    expect(result).toEqual({ bookId: 42, syncEnabled: false });
    expect(mockBookService.verifyBookAccess).toHaveBeenCalledWith(42, mockUser);
    expect(mockSyncService.updateBookSyncState).toHaveBeenCalledWith(1, 42, { syncEnabled: false });
  });

  it('syncBook verifies access and returns result with refreshed state', async () => {
    mockSyncService.syncBook.mockResolvedValue('synced');
    mockSyncService.getBookSyncState.mockResolvedValue({ bookId: 42 });
    const result = await makeController().syncBook(mockUser as any, 42);
    expect(result).toEqual({ result: 'synced', state: { bookId: 42 } });
    expect(mockBookService.verifyBookAccess).toHaveBeenCalledWith(42, mockUser);
    expect(mockSyncService.syncBook).toHaveBeenCalledWith(1, 42);
    expect(mockSyncService.getBookSyncState).toHaveBeenCalledWith(1, 42);
  });
});
