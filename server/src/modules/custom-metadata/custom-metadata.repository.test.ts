import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { CustomMetadataRepository } from './custom-metadata.repository';

describe('CustomMetadataRepository', () => {
  let repository: CustomMetadataRepository;
  const query = vi.fn();

  beforeEach(async () => {
    query.mockReset().mockResolvedValue({ rows: [] });
    const db = drizzle({ client: { query } as never, schema });
    const module = await Test.createTestingModule({
      providers: [CustomMetadataRepository, { provide: DB, useValue: db }],
    }).compile();
    repository = module.get(CustomMetadataRepository);
  });

  function sql(): string {
    const [{ text }] = query.mock.calls.at(-1) as [{ text: string }];
    return text;
  }

  // The per-library display_order is the library's index in each field's own list, so ordering by it
  // ignored the order set on the settings page. Edit Metadata and iOS show values in the order served.
  it('orders a library’s fields by the order set on the settings page', async () => {
    await repository.findEnabledFieldsForLibrary(3);

    expect(sql()).toContain('order by "custom_metadata_fields"."display_order" asc');
    expect(sql()).not.toContain('order by "custom_metadata_library_fields"."display_order"');
    expect(sql()).toMatch(/"custom_metadata_fields"\."display_order"[^,]*,\s*"custom_metadata_fields"\."archived_at"/);
  });

  it('orders card values by the order set on the settings page', async () => {
    await repository.findCardValuesForBooks([5, 6]);

    expect(sql()).toContain('order by "custom_metadata_fields"."display_order" asc');
    expect(sql()).not.toContain('"custom_metadata_library_fields"."display_order"');
  });

  it('counts stored values per field and library in one grouped query', async () => {
    query.mockResolvedValueOnce({ rows: [[7, 1, 12]] });

    await expect(repository.countValuesByFieldAndLibrary()).resolves.toEqual([{ fieldId: 7, libraryId: 1, count: 12 }]);

    expect(query).toHaveBeenCalledOnce();
    expect(sql()).toContain('inner join "books" on "books"."id" = "book_custom_metadata_values"."book_id"');
    expect(sql()).toContain('group by "book_custom_metadata_values"."field_id", "books"."library_id"');
    expect(sql()).not.toContain('where');
  });

  it('narrows the per-library count to one field when asked', async () => {
    await repository.countValuesByFieldAndLibrary(7);

    const [, params] = query.mock.calls.at(-1) as [unknown, unknown[]];
    expect(sql()).toContain('where "book_custom_metadata_values"."field_id" = $1');
    expect(params).toEqual([7]);
  });
});
