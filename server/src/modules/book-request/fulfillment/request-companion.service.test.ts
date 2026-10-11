import { RequestCompanionService } from './request-companion.service';

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    mediaKind: 'audiobook',
    status: 'importing',
    title: 'Dune',
    targetLibraryId: 3,
    targetBookId: null,
    companionRequestId: null,
    matchedBookId: null,
    ...overrides,
  } as never;
}

const folderBook = { bookId: 42, libraryId: 3, libraryFolderId: 4, folderPath: '/lib/Dune', status: 'present', organizationMode: 'book_per_folder' };

function makeService(repoOverrides: Record<string, unknown> = {}) {
  const repo = {
    findById: vi.fn().mockResolvedValue(undefined),
    findBookPlacement: vi.fn().mockResolvedValue(folderBook),
    findBookMediaKinds: vi.fn().mockResolvedValue(new Set(['ebook'])),
    updateIf: vi.fn().mockResolvedValue({ id: 11 }),
    setTargetBookIfUnset: vi.fn().mockResolvedValue(true),
    ...repoOverrides,
  };
  const notifier = { notifyBookAvailable: vi.fn().mockResolvedValue(undefined) };
  return { service: new RequestCompanionService(repo as never, notifier as never), repo, notifier };
}

describe('RequestCompanionService.resolveJoin', () => {
  it('joins the book a request names, following that book into whatever library it now lives in', async () => {
    const { service } = makeService({ findBookPlacement: vi.fn().mockResolvedValue({ ...folderBook, libraryId: 8, libraryFolderId: 9 }) });

    await expect(service.resolveJoin(request({ targetBookId: 42, coverUrl: 'https://covers.example/square.jpg' }))).resolves.toEqual({
      libraryId: 8,
      folderId: 9,
      // The art the request chose travels with it, for when the arriving files carry none.
      joinBook: { bookId: 42, folderPath: '/lib/Dune', coverUrl: 'https://covers.example/square.jpg' },
    });
  });

  it('joins the book its companion landed as, when both are headed for the same library', async () => {
    const { service } = makeService({
      findById: vi.fn().mockResolvedValue({ request: { id: 11, companionRequestId: 10, status: 'available', matchedBookId: 42 } }),
    });

    const join = await service.resolveJoin(request({ companionRequestId: 11 }));

    expect(join?.joinBook.bookId).toBe(42);
  });

  it('files on its own when the companion landed in a different library', async () => {
    const { service } = makeService({
      findById: vi.fn().mockResolvedValue({ request: { id: 11, companionRequestId: 10, status: 'available', matchedBookId: 42 } }),
      findBookPlacement: vi.fn().mockResolvedValue({ ...folderBook, libraryId: 5 }),
    });

    await expect(service.resolveJoin(request({ companionRequestId: 11 }))).resolves.toBeNull();
  });

  it('ignores a companion that has not landed yet', async () => {
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue({ request: { id: 11, companionRequestId: 10, status: 'downloading', matchedBookId: null } }),
    });

    await expect(service.resolveJoin(request({ companionRequestId: 11 }))).resolves.toBeNull();
    expect(repo.findBookPlacement).not.toHaveBeenCalled();
  });

  it('never trusts a link only one side of the pair still holds', async () => {
    const { service } = makeService({
      findById: vi.fn().mockResolvedValue({ request: { id: 11, companionRequestId: 99, status: 'available', matchedBookId: 42 } }),
    });

    await expect(service.resolveJoin(request({ companionRequestId: 11 }))).resolves.toBeNull();
  });

  it('refuses a library where a book is one file, because there is no folder to share', async () => {
    const { service } = makeService({ findBookPlacement: vi.fn().mockResolvedValue({ ...folderBook, organizationMode: 'book_per_file' }) });

    await expect(service.resolveJoin(request({ targetBookId: 42 }))).resolves.toBeNull();
  });

  it('refuses a book that already has this format, which would be a second copy rather than a second format', async () => {
    const { service } = makeService({ findBookMediaKinds: vi.fn().mockResolvedValue(new Set(['ebook', 'audiobook'])) });

    await expect(service.resolveJoin(request({ targetBookId: 42 }))).resolves.toBeNull();
  });

  it('refuses a book that is no longer present', async () => {
    const { service } = makeService({ findBookPlacement: vi.fn().mockResolvedValue({ ...folderBook, status: 'missing' }) });

    await expect(service.resolveJoin(request({ targetBookId: 42 }))).resolves.toBeNull();
  });
});

describe('RequestCompanionService.handOn', () => {
  const landed = request({ id: 10, mediaKind: 'ebook', companionRequestId: 11 });

  it('settles a companion whose format arrived in the same release, and tells the people waiting on it', async () => {
    const { service, repo, notifier } = makeService({
      findById: vi.fn().mockResolvedValue({ request: { id: 11, companionRequestId: 10, mediaKind: 'audiobook', title: 'Dune', targetLibraryId: 3 } }),
      findBookMediaKinds: vi.fn().mockResolvedValue(new Set(['ebook', 'audiobook'])),
    });

    await expect(service.handOn(landed, 42)).resolves.toBe(true);

    expect(repo.updateIf).toHaveBeenCalledWith(
      11,
      ['pending', 'approved', 'searching'],
      expect.objectContaining({ status: 'available', matchedBookId: 42 }),
    );
    expect(notifier.notifyBookAvailable).toHaveBeenCalledWith(11, 42, expect.objectContaining({ meta: { requestId: 11, bookId: 42 } }));
  });

  it('leaves a companion with a grab of its own in flight to finish it', async () => {
    const { service, notifier } = makeService({
      findById: vi.fn().mockResolvedValue({ request: { id: 11, companionRequestId: 10, mediaKind: 'audiobook', title: 'Dune', targetLibraryId: 3 } }),
      findBookMediaKinds: vi.fn().mockResolvedValue(new Set(['ebook', 'audiobook'])),
      updateIf: vi.fn().mockResolvedValue(undefined),
    });

    await expect(service.handOn(landed, 42)).resolves.toBe(false);
    expect(notifier.notifyBookAvailable).not.toHaveBeenCalled();
  });

  it('points a companion still to come at the book, so it joins it when it arrives', async () => {
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue({ request: { id: 11, companionRequestId: 10, mediaKind: 'audiobook', title: 'Dune', targetLibraryId: 3 } }),
    });

    await service.handOn(landed, 42);

    expect(repo.updateIf).not.toHaveBeenCalled();
    expect(repo.setTargetBookIfUnset).toHaveBeenCalledWith(11, 42);
  });

  it('leaves a companion bound for another library to land there as a book of its own', async () => {
    const { service, repo } = makeService({
      findById: vi.fn().mockResolvedValue({ request: { id: 11, companionRequestId: 10, mediaKind: 'audiobook', title: 'Dune', targetLibraryId: 7 } }),
    });

    await service.handOn(landed, 42);

    expect(repo.setTargetBookIfUnset).not.toHaveBeenCalled();
  });

  it('does nothing for a request made on its own', async () => {
    const { service, repo } = makeService();

    await expect(service.handOn(request({ companionRequestId: null }), 42)).resolves.toBe(false);
    expect(repo.findById).not.toHaveBeenCalled();
  });
});
