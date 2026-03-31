import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AuthorAutoEnrichmentWriteMode } from '@projectx/types';

import { AuthorAutoEnrichmentConfigDto } from './author-auto-enrichment-config.dto';
import { PreviewAuthorEnrichmentCountDto } from './preview-author-enrichment-count.dto';

describe('author enrichment DTO validation', () => {
  it('accepts valid enrichment config payload', async () => {
    const dto = plainToInstance(AuthorAutoEnrichmentConfigDto, {
      enabled: true,
      triggerOnImport: false,
      writeMode: AuthorAutoEnrichmentWriteMode.MISSING_ONLY,
      conditions: {
        neverEnriched: true,
        missingBio: false,
        missingPhoto: true,
      },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects invalid writeMode and non-boolean conditions', async () => {
    const dto = plainToInstance(AuthorAutoEnrichmentConfigDto, {
      enabled: true,
      triggerOnImport: true,
      writeMode: 'bad_mode',
      conditions: {
        neverEnriched: 'true',
        missingBio: false,
        missingPhoto: true,
      },
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects preview-count payload when conditions are missing', async () => {
    const dto = plainToInstance(PreviewAuthorEnrichmentCountDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
