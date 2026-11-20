import 'reflect-metadata';

import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { AuthorAutoEnrichmentConfigDto } from './author-auto-enrichment-config.dto';
import { PreviewAuthorEnrichmentCountDto } from './preview-author-enrichment-count.dto';

describe('author enrichment DTO validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const config = {
    enabled: true,
    triggerOnImport: false,
    conditions: { neverEnriched: true, missingBio: false, missingPhoto: true },
  };
  const configMetadata = { type: 'body', metatype: AuthorAutoEnrichmentConfigDto } as const;

  it('accepts a valid enrichment config payload', async () => {
    await expect(pipe.transform(config, configMetadata)).resolves.toEqual(config);
  });

  it('rejects the retired writeMode field', async () => {
    await expect(pipe.transform({ ...config, writeMode: 'always_refetch' }, configMetadata)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-boolean conditions', async () => {
    const invalid = { ...config, conditions: { ...config.conditions, neverEnriched: 'true' } };
    await expect(pipe.transform(invalid, configMetadata)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects preview-count payload when conditions are missing', async () => {
    await expect(pipe.transform({}, { type: 'body', metatype: PreviewAuthorEnrichmentCountDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});
