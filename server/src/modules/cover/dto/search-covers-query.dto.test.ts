import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SearchCoversQueryDto } from './search-covers-query.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(SearchCoversQueryDto, input);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('SearchCoversQueryDto', () => {
  it('accepts a valid minimal query', async () => {
    const { errors } = await validateInput({ title: 'Dune' });
    expect(errors).toHaveLength(0);
  });

  it('trims title and author values', async () => {
    const { dto, errors } = await validateInput({ title: '  Dune  ', author: '  Frank Herbert  ' });
    expect(errors).toHaveLength(0);
    expect(dto.title).toBe('Dune');
    expect(dto.author).toBe('Frank Herbert');
  });

  it('parses boolean query values for isAudiobook', async () => {
    const { dto, errors } = await validateInput({ title: 'Dune', isAudiobook: ' TRUE ' });
    expect(errors).toHaveLength(0);
    expect(dto.isAudiobook).toBe(true);
  });

  it('rejects invalid isAudiobook values', async () => {
    const { errors } = await validateInput({ title: 'Dune', isAudiobook: 'yes' });
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'isAudiobook' })]));
  });

  it('allows known provider values and rejects unknown values', async () => {
    expect((await validateInput({ title: 'Dune', provider: 'duckduckgo' })).errors).toHaveLength(0);
    expect((await validateInput({ title: 'Dune', provider: 'itunes' })).errors).toHaveLength(0);
    expect((await validateInput({ title: 'Dune', provider: 'all' })).errors).toHaveLength(0);
    expect((await validateInput({ title: 'Dune', provider: 'unknown' })).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'provider' })]),
    );
  });

  it('requires a non-empty title', async () => {
    expect((await validateInput({})).errors).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'title' })]));
    expect((await validateInput({ title: '   ' })).errors).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'title' })]));
  });
});
