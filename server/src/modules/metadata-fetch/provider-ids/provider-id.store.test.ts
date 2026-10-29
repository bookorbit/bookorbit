import { MetadataProviderKey } from '@bookorbit/types';

import type { ProviderIdRepository } from './provider-id.repository';
import { ProviderIdStore } from './provider-id.store';

function store() {
  const repository = { findByBookIds: vi.fn().mockResolvedValue([]), upsert: vi.fn(), delete: vi.fn() };
  return { repository, store: new ProviderIdStore(repository as unknown as ProviderIdRepository) };
}

describe('ProviderIdStore', () => {
  it('stores external ids, deletes on null or empty, and leaves built-in and absent keys alone', async () => {
    const { repository, store: s } = store();

    await s.write(
      7,
      { fantlab: ' 3104 ', isfdb: null, libris: '', [MetadataProviderKey.GOODREADS]: '123', other: undefined, 'Bad Key': '1' },
      { fantlab: 'https://fantlab.ru/work3104' },
    );

    expect(repository.upsert).toHaveBeenCalledWith([
      { bookId: 7, provider: 'fantlab', externalId: '3104', sourceUrl: 'https://fantlab.ru/work3104' },
    ]);
    expect(repository.delete).toHaveBeenCalledWith(7, ['isfdb', 'libris']);
  });

  it('skips an id too long for any provider instead of truncating it, and drops unsafe links', async () => {
    const { repository, store: s } = store();
    await s.write(7, { fantlab: 'x'.repeat(513), libris: 'abc' }, { libris: 'javascript:alert(1)' });
    expect(repository.upsert).toHaveBeenCalledWith([{ bookId: 7, provider: 'libris', externalId: 'abc', sourceUrl: null }]);
  });

  it('reads ids and links per book', async () => {
    const { repository, store: s } = store();
    repository.findByBookIds.mockResolvedValue([
      { bookId: 1, provider: 'fantlab', externalId: '3104', sourceUrl: 'https://fantlab.ru/work3104' },
      { bookId: 1, provider: 'libris', externalId: 'abc', sourceUrl: null },
      { bookId: 2, provider: 'fantlab', externalId: 'e723', sourceUrl: null },
    ]);

    const result = await s.readMany([1, 2]);

    expect(result.get(1)).toEqual({ ids: { fantlab: '3104', libris: 'abc' }, links: { fantlab: 'https://fantlab.ru/work3104' } });
    expect(result.get(2)).toEqual({ ids: { fantlab: 'e723' }, links: {} });
  });
});
