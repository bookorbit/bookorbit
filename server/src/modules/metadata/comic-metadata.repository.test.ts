import * as schema from '../../db/schema';
import { ComicMetadataRepository } from './comic-metadata.repository';

function makeRepository() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  const findFirst = vi.fn();
  const db = {
    insert,
    query: {
      comicMetadata: {
        findFirst,
      },
    },
  };

  return {
    repo: new ComicMetadataRepository(db as never),
    insert,
    values,
    onConflictDoUpdate,
    findFirst,
  };
}

describe('ComicMetadataRepository', () => {
  it('upserts comic metadata fields and updates updatedAt on conflicts', async () => {
    const { repo, insert, values, onConflictDoUpdate } = makeRepository();

    await repo.upsert(17, {
      issueNumber: '42',
      volumeName: 'Saga',
      pencillers: ['A'],
      inkers: ['B'],
      colorists: ['C'],
      letterers: ['D'],
      coverArtists: ['E'],
      characters: ['F'],
      teams: ['G'],
      locations: ['H'],
      storyArcs: ['I'],
    });

    expect(insert).toHaveBeenCalledWith(schema.comicMetadata);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: 17,
        issueNumber: '42',
        volumeName: 'Saga',
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith({
      target: schema.comicMetadata.bookId,
      set: expect.objectContaining({
        issueNumber: '42',
        volumeName: 'Saga',
        updatedAt: expect.any(Date),
      }),
    });
  });

  it('returns null when no comic metadata row exists for a book', async () => {
    const { repo, findFirst } = makeRepository();
    findFirst.mockResolvedValue(undefined);

    await expect(repo.findByBookId(999)).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: expect.anything(),
    });
  });
});
