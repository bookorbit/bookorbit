import { BookEmbeddingVectorizerService, EMBEDDING_DIMENSIONS } from './book-embedding-vectorizer.service';
import { BookEmbeddingSourceData } from './book-embedding.types';

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

describe('BookEmbeddingVectorizerService', () => {
  it('produces deterministic normalized vectors', () => {
    const vectorizer = new BookEmbeddingVectorizerService();
    const sourceData = makeSourceData();

    const vectorA = vectorizer.buildVector(sourceData);
    const vectorB = vectorizer.buildVector(sourceData);

    expect(vectorA).toEqual(vectorB);
    expect(vectorA).toHaveLength(EMBEDDING_DIMENSIONS);
    const norm = Math.sqrt(vectorA.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 10);
  });

  it('keeps a zero vector when all text is stopwords or too short', () => {
    const vectorizer = new BookEmbeddingVectorizerService();

    const vector = vectorizer.buildVector(
      makeSourceData({
        title: 'a the of',
        seriesName: null,
        publisher: null,
        description: 'it is as to',
        authors: [],
        genres: [],
        tags: [],
      }),
    );

    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(vector.every((value) => value === 0)).toBe(true);
  });

  it('limits description contribution to the first 100 tokens', () => {
    const vectorizer = new BookEmbeddingVectorizerService();
    const words = Array.from({ length: 130 }, (_, index) => `token${index}`);
    const longDescription = words.join(' ');

    const vectorWith130 = vectorizer.buildVector(
      makeSourceData({
        title: null,
        seriesName: null,
        publisher: null,
        description: longDescription,
        authors: [],
        genres: [],
        tags: [],
      }),
    );

    const vectorWith100 = vectorizer.buildVector(
      makeSourceData({
        title: null,
        seriesName: null,
        publisher: null,
        description: words.slice(0, 100).join(' '),
        authors: [],
        genres: [],
        tags: [],
      }),
    );

    expect(vectorWith130).toEqual(vectorWith100);
  });

  it('keeps accented and non-latin tokens in the vector', () => {
    const vectorizer = new BookEmbeddingVectorizerService();
    const vector = vectorizer.buildVector(
      makeSourceData({
        title: 'Cien años de soledad Преступление и наказание',
        seriesName: null,
        publisher: null,
        description: null,
        authors: [],
        genres: [],
        tags: [],
      }),
    );

    expect(vector.some((value) => value !== 0)).toBe(true);
  });

  it('ignores blank exact-match fields', () => {
    const vectorizer = new BookEmbeddingVectorizerService();

    const vector = vectorizer.buildVector(
      makeSourceData({
        title: null,
        seriesName: '   ',
        publisher: '',
        description: null,
        authors: ['  '],
        genres: [''],
        tags: [],
      }),
    );

    expect(vector.every((value) => value === 0)).toBe(true);
  });
});
