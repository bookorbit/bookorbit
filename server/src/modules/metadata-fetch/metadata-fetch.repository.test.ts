import { MetadataFetchRepository, type StoredProviderIdsRow } from './metadata-fetch.repository';

function makeRepository() {
  const limit = vi.fn();
  const where = vi.fn().mockReturnValue({ limit });
  const leftJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ leftJoin });
  const select = vi.fn().mockReturnValue({ from });
  const findFirst = vi.fn();

  const db = {
    select,
    query: {
      userLibraryAccess: {
        findFirst,
      },
    },
  };

  return {
    repo: new MetadataFetchRepository(db as never),
    limit,
    where,
    leftJoin,
    from,
    select,
    findFirst,
  };
}

describe('MetadataFetchRepository', () => {
  it('returns provider-id row for a known book', async () => {
    const { repo, limit } = makeRepository();
    const row: StoredProviderIdsRow = {
      libraryId: 5,
      googleBooksId: 'google-1',
      goodreadsId: 'goodreads-1',
      amazonId: 'amazon-1',
      hardcoverId: 'hardcover-1',
      openLibraryId: 'open-library-1',
      itunesId: 'itunes-1',
      audibleId: 'audible-1',
      comicvineId: 'comicvine-1',
    };
    limit.mockResolvedValue([row]);

    await expect(repo.findStoredProviderIdsRow(99)).resolves.toEqual(row);
  });

  it('returns null when provider-id row is missing for a book', async () => {
    const { repo, limit } = makeRepository();
    limit.mockResolvedValue([]);

    await expect(repo.findStoredProviderIdsRow(100)).resolves.toBeNull();
  });

  it('returns true when user has explicit library access', async () => {
    const { repo, findFirst } = makeRepository();
    findFirst.mockResolvedValue({ userId: 7 });

    await expect(repo.hasLibraryAccess(7, 11)).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: expect.anything(),
      columns: { userId: true },
    });
  });

  it('returns false when no access row exists', async () => {
    const { repo, findFirst } = makeRepository();
    findFirst.mockResolvedValue(null);

    await expect(repo.hasLibraryAccess(7, 11)).resolves.toBe(false);
  });
});
