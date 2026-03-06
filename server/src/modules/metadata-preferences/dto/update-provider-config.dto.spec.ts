import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpdateProviderConfigDto } from './update-provider-config.dto';

async function validateInput(input: Record<string, unknown>) {
  const dto = plainToInstance(UpdateProviderConfigDto, input);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('UpdateProviderConfigDto', () => {
  it('accepts partial nested provider patches', async () => {
    const { errors } = await validateInput({
      google: { enabled: false },
      amazon: { cookie: 'session-cookie' },
      hardcover: { apiKey: 'hardcover-key' },
    });

    expect(errors).toHaveLength(0);
  });

  it('accepts empty payload for no-op updates', async () => {
    const { errors } = await validateInput({});

    expect(errors).toHaveLength(0);
  });

  it('rejects invalid nested property types', async () => {
    const { errors } = await validateInput({
      google: { enabled: 'yes' },
      amazon: { domain: 123 },
      hardcover: { apiKey: false },
      openLibrary: { enabled: 'true' },
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'google' }),
        expect.objectContaining({ property: 'amazon' }),
        expect.objectContaining({ property: 'hardcover' }),
        expect.objectContaining({ property: 'openLibrary' }),
      ]),
    );
  });

  it('rejects non-object provider sections', async () => {
    const { errors } = await validateInput({
      google: 'bad-section',
      goodreads: true,
    });

    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'google' }), expect.objectContaining({ property: 'goodreads' })]),
    );
  });
});
