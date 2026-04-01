import { Logger } from '@nestjs/common';

import { BookEmbeddingSourceData } from './book-embedding.types';
import { BookEmbedderService } from './book-embedder.service';

function makeSourceData(overrides: Partial<BookEmbeddingSourceData> = {}): BookEmbeddingSourceData {
  return {
    title: 'The Last Wish',
    seriesName: 'The Witcher',
    publisher: 'Orbit',
    description: 'A monster hunter travels the world',
    authors: ['Andrzej Sapkowski'],
    genres: ['Fantasy'],
    tags: ['Sword & Sorcery'],
    ...overrides,
  };
}

function makeService() {
  const embedderRepository = {
    findSourceData: vi.fn(),
    saveEmbedding: vi.fn(),
  };
  const vectorizer = {
    buildVector: vi.fn(),
  };

  return {
    service: new BookEmbedderService(embedderRepository as never, vectorizer as never),
    embedderRepository,
    vectorizer,
  };
}

describe('BookEmbedderService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when metadata row does not exist', async () => {
    const { service, embedderRepository, vectorizer } = makeService();
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    embedderRepository.findSourceData.mockResolvedValue(null);

    await expect(service.embedBook(42)).resolves.toBeNull();

    expect(embedderRepository.findSourceData).toHaveBeenCalledWith(42);
    expect(vectorizer.buildVector).not.toHaveBeenCalled();
    expect(embedderRepository.saveEmbedding).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('[book.embedding] [start] bookId=42'));
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('outcome=metadata_missing'));
  });

  it('builds and persists embedding when source data exists', async () => {
    const { service, embedderRepository, vectorizer } = makeService();
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const sourceData = makeSourceData();
    const embedding = [0.12, 0.34, 0.56];

    embedderRepository.findSourceData.mockResolvedValue(sourceData);
    vectorizer.buildVector.mockReturnValue(embedding);
    embedderRepository.saveEmbedding.mockResolvedValue(undefined);

    await expect(service.embedBook(7)).resolves.toEqual(embedding);

    expect(embedderRepository.findSourceData).toHaveBeenCalledWith(7);
    expect(vectorizer.buildVector).toHaveBeenCalledWith(sourceData);
    expect(embedderRepository.saveEmbedding).toHaveBeenCalledWith(7, embedding);
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('[book.embedding] [end] bookId=7'));
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('authorCount=1 genreCount=1 tagCount=1'));
  });

  it('logs fail and rethrows when reading source data fails', async () => {
    const { service, embedderRepository, vectorizer } = makeService();
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    embedderRepository.findSourceData.mockRejectedValue(new Error('database "offline"\n'));

    await expect(service.embedBook(9)).rejects.toThrow('database "offline"');

    expect(vectorizer.buildVector).not.toHaveBeenCalled();
    expect(embedderRepository.saveEmbedding).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[book.embedding] [fail] bookId=9'));
    expect(warnSpy.mock.calls[0][0]).toContain('errorClass=Error');
    expect(warnSpy.mock.calls[0][0]).toMatch(/error="database\s+offline\s*"/);
    expect(warnSpy.mock.calls[0][0]).not.toContain('\n');
  });

  it('logs fail and rethrows when persistence fails', async () => {
    const { service, embedderRepository, vectorizer } = makeService();
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const sourceData = makeSourceData({ authors: ['Andrzej Sapkowski', 'A. Author'] });
    const embedding = [0.3, 0.7];

    embedderRepository.findSourceData.mockResolvedValue(sourceData);
    vectorizer.buildVector.mockReturnValue(embedding);
    embedderRepository.saveEmbedding.mockRejectedValue(new Error('write failed'));

    await expect(service.embedBook(15)).rejects.toThrow('write failed');

    expect(vectorizer.buildVector).toHaveBeenCalledWith(sourceData);
    expect(embedderRepository.saveEmbedding).toHaveBeenCalledWith(15, embedding);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[book.embedding] [fail] bookId=15'));
  });
});
