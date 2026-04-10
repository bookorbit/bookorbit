import 'reflect-metadata';

vi.mock('../auth/auth.module', () => ({ AuthModule: class AuthModule {} }));
vi.mock('../book/book.module', () => ({ BookModule: class BookModule {} }));
vi.mock('../book-metadata-lock/book-metadata-lock.module', () => ({ BookMetadataLockModule: class BookMetadataLockModule {} }));
vi.mock('../metadata-fetch/metadata-fetch.module', () => ({ MetadataFetchModule: class MetadataFetchModule {} }));
vi.mock('../metadata/metadata.module', () => ({ MetadataModule: class MetadataModule {} }));
vi.mock('../metadata-score/metadata-score.module', () => ({ MetadataScoreModule: class MetadataScoreModule {} }));

import { MODULE_METADATA } from '@nestjs/common/constants';

import { BookModule } from '../book/book.module';
import { BookMetadataFetchConfigService } from './book-metadata-fetch-config.service';
import { BookMetadataFetchController } from './book-metadata-fetch.controller';
import { BookMetadataFetchEligibilityService } from './book-metadata-fetch-eligibility.service';
import { BookMetadataFetchGateway } from './book-metadata-fetch.gateway';
import { BookMetadataFetchModule } from './book-metadata-fetch.module';
import { BookMetadataFetchOrchestratorService } from './book-metadata-fetch-orchestrator.service';
import { BookMetadataFetchQueueRepository } from './book-metadata-fetch-queue.repository';
import { BookMetadataFetchSessionService } from './book-metadata-fetch-session.service';

describe('BookMetadataFetchModule', () => {
  it('registers expected controller and provider graph', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, BookMetadataFetchModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, BookMetadataFetchModule) as Array<unknown>;
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, BookMetadataFetchModule) as Array<unknown>;

    expect(controllers).toEqual([BookMetadataFetchController]);
    expect(providers).toEqual(
      expect.arrayContaining([
        BookMetadataFetchSessionService,
        BookMetadataFetchQueueRepository,
        BookMetadataFetchEligibilityService,
        BookMetadataFetchConfigService,
        BookMetadataFetchOrchestratorService,
        BookMetadataFetchGateway,
      ]),
    );
    expect(exports).toEqual([BookMetadataFetchOrchestratorService]);
  });

  it('keeps the book forwardRef import and config-driven jwt factory', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, BookMetadataFetchModule) as Array<{
      forwardRef?: () => unknown;
      providers?: Array<{ useFactory?: (config: { getOrThrow: (key: string) => string }) => unknown }>;
    }>;

    const forwardRefImport = imports.find((entry) => typeof entry.forwardRef === 'function');
    expect(forwardRefImport?.forwardRef?.()).toBe(BookModule);

    const jwtFactory = imports.flatMap((entry) => entry.providers ?? []).find((provider) => typeof provider.useFactory === 'function')?.useFactory;

    expect(jwtFactory).toBeDefined();
    const config = {
      getOrThrow: vi.fn((key: string) => {
        if (key === 'auth.jwtSecret') return 'secret';
        if (key === 'auth.jwtExpiresIn') return '1h';
        throw new Error(`unexpected key: ${key}`);
      }),
    };
    const options = jwtFactory?.(config) as { secret: string; signOptions: { expiresIn: string } };

    expect(options).toEqual({ secret: 'secret', signOptions: { expiresIn: '1h' } });
  });
});
