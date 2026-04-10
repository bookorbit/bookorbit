import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateDryRunPlanDto } from './create-dry-run-plan.dto';
import { CreateMigrationProfileDto } from './create-migration-profile.dto';
import { ResolveDuplicateMatchesDto } from './resolve-duplicate-matches.dto';
import { StartLiveRunDto } from './start-live-run.dto';
import { ValidatePathMappingsDto } from './validate-path-mappings.dto';

async function errorsFor<T extends object>(cls: new () => T, value: Record<string, unknown>) {
  const dto = plainToInstance(cls, value);
  return validate(dto);
}

describe('Migration DTO validation', () => {
  it('validates migration profile creation payloads with nested mappings', async () => {
    expect(
      (
        await errorsFor(CreateMigrationProfileDto, {
          sourceId: '5',
          name: 'Booklore Import',
          userMappings: [{ sourceUserId: 'u1', targetUserId: '10' }],
          pathMappings: [{ sourcePrefix: '/old/books', targetPrefix: '/new/books' }],
          scope: { metadata: true },
        })
      ).length,
    ).toBe(0);

    expect((await errorsFor(CreateMigrationProfileDto, { sourceId: 0, name: '', userMappings: [] })).length).toBeGreaterThan(0);
    expect(
      (await errorsFor(CreateMigrationProfileDto, { sourceId: 2, name: 'ok', userMappings: [{ sourceUserId: '', targetUserId: 1 }] })).length,
    ).toBeGreaterThan(0);
  });

  it('validates dry-run and live-run identifiers and optional settings', async () => {
    expect((await errorsFor(CreateDryRunPlanDto, { profileId: '4', scopeOverride: { tags: false } })).length).toBe(0);
    expect((await errorsFor(StartLiveRunDto, { planArtifactId: '9', targetKey: 'default-target' })).length).toBe(0);

    expect((await errorsFor(CreateDryRunPlanDto, { profileId: 0 })).length).toBeGreaterThan(0);
    expect((await errorsFor(StartLiveRunDto, { planArtifactId: 0 })).length).toBeGreaterThan(0);
    expect((await errorsFor(StartLiveRunDto, { planArtifactId: 9, targetKey: 'x'.repeat(101) })).length).toBeGreaterThan(0);
  });

  it('validates duplicate resolution payload structure', async () => {
    expect(
      (
        await errorsFor(ResolveDuplicateMatchesDto, {
          resolutions: [{ targetBookId: 42, selectedSourceBookId: 'source-abc' }],
        })
      ).length,
    ).toBe(0);

    expect((await errorsFor(ResolveDuplicateMatchesDto, { resolutions: [] })).length).toBeGreaterThan(0);
    expect((await errorsFor(ResolveDuplicateMatchesDto, { resolutions: [{ targetBookId: 0, selectedSourceBookId: '' }] })).length).toBeGreaterThan(0);
  });

  it('validates path mapping checks and sample limits', async () => {
    expect(
      (
        await errorsFor(ValidatePathMappingsDto, {
          pathMappings: [{ sourcePrefix: '/source', targetPrefix: '/target' }],
          sampleLimit: '50',
        })
      ).length,
    ).toBe(0);

    expect((await errorsFor(ValidatePathMappingsDto, { pathMappings: [{ sourcePrefix: '', targetPrefix: '/target' }] })).length).toBeGreaterThan(0);
    expect((await errorsFor(ValidatePathMappingsDto, { pathMappings: [], sampleLimit: 101 })).length).toBeGreaterThan(0);
  });
});
