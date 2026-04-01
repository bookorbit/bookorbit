import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CATALOG_QUERY_MAX_LENGTH, SearchCatalogQueryDto } from './search-catalog-query.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(SearchCatalogQueryDto, input);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('SearchCatalogQueryDto', () => {
  it('defaults q to an empty string when omitted', async () => {
    const { dto, errors } = await validateInput({});

    expect(errors).toHaveLength(0);
    expect(dto.q).toBe('');
  });

  it('trims surrounding whitespace from q', async () => {
    const { dto, errors } = await validateInput({ q: '  Frank Herbert  ' });

    expect(errors).toHaveLength(0);
    expect(dto.q).toBe('Frank Herbert');
  });

  it('accepts q at the maximum configured length', async () => {
    const q = 'a'.repeat(CATALOG_QUERY_MAX_LENGTH);
    const { errors } = await validateInput({ q });

    expect(errors).toHaveLength(0);
  });

  it('rejects q values longer than the configured maximum', async () => {
    const q = 'a'.repeat(CATALOG_QUERY_MAX_LENGTH + 1);
    const { errors } = await validateInput({ q });

    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'q' })]));
  });

  it('rejects non-string q values', async () => {
    const { errors } = await validateInput({ q: 123 });

    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'q' })]));
  });
});
