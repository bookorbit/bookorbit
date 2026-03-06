import { resolveFieldsWritten } from './resolve-fields-written';

describe('resolveFieldsWritten', () => {
  it('drops null/empty values and never includes coverBytes', () => {
    const fields = resolveFieldsWritten({
      title: 'Book',
      subtitle: null,
      authors: [],
      genres: ['Fantasy'],
      coverBytes: Buffer.from([1]),
    });

    expect(fields).toEqual(['title', 'genres']);
  });

  it('applies field mask strictly', () => {
    const fields = resolveFieldsWritten(
      {
        title: 'Book',
        publisher: 'Orbit',
        tags: ['a'],
      },
      new Set(['publisher', 'tags']),
    );

    expect(fields).toEqual(['publisher', 'tags']);
  });
});
