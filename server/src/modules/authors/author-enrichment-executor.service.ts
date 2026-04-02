import { Injectable } from '@nestjs/common';
import { AuthorAutoEnrichmentWriteMode, AuthorMetadataProviderKey } from '@projectx/types';

import { AuthorMetadataFetchService } from './metadata/author-metadata-fetch.service';
import { AuthorImageStorageError, AuthorImageStorageService } from './author-image-storage.service';
import { AuthorsRepository } from './authors.repository';

export type AuthorEnrichmentExecutionResult =
  | {
      kind: 'done';
      provider: string | null;
      descriptionUpdated: boolean;
      imageUpdated: boolean;
    }
  | {
      kind: 'skipped';
      reason: 'author_not_found' | 'orphaned' | 'provider_disabled' | 'no_match';
      provider: string | null;
      descriptionUpdated: false;
      imageUpdated: false;
    }
  | {
      kind: 'failed';
      message: string;
      provider: string | null;
      httpStatus: number | null;
      retryAfterMs: number | null;
      transient: boolean;
      descriptionUpdated: false;
      imageUpdated: false;
    };

@Injectable()
export class AuthorEnrichmentExecutorService {
  constructor(
    private readonly authorsRepo: AuthorsRepository,
    private readonly authorMetadataFetchService: AuthorMetadataFetchService,
    private readonly authorImageStorage: AuthorImageStorageService,
  ) {}

  async execute(params: {
    authorId: number;
    writeMode: AuthorAutoEnrichmentWriteMode;
    audnexusEnabled: boolean;
  }): Promise<AuthorEnrichmentExecutionResult> {
    const author = await this.authorsRepo.findByIdForEnrichment(params.authorId);
    if (!author) {
      return {
        kind: 'skipped',
        reason: 'author_not_found',
        provider: null,
        descriptionUpdated: false,
        imageUpdated: false,
      };
    }

    if (author.bookCount <= 0) {
      return {
        kind: 'skipped',
        reason: 'orphaned',
        provider: null,
        descriptionUpdated: false,
        imageUpdated: false,
      };
    }

    if (!params.audnexusEnabled) {
      return {
        kind: 'skipped',
        reason: 'provider_disabled',
        provider: null,
        descriptionUpdated: false,
        imageUpdated: false,
      };
    }

    const metadataResult = await this.authorMetadataFetchService.quickSearchDetailed(
      {
        name: author.name,
        region: 'us',
        limit: 1,
      },
      { keys: [AuthorMetadataProviderKey.AUDNEXUS] },
    );

    if (!metadataResult.candidate) {
      if (metadataResult.failure) {
        return {
          kind: 'failed',
          message: metadataResult.failure.message,
          provider: metadataResult.failure.provider,
          httpStatus: metadataResult.failure.httpStatus,
          retryAfterMs: metadataResult.failure.retryAfterMs,
          transient: metadataResult.failure.transient,
          descriptionUpdated: false,
          imageUpdated: false,
        };
      }

      return {
        kind: 'skipped',
        reason: 'no_match',
        provider: null,
        descriptionUpdated: false,
        imageUpdated: false,
      };
    }

    const metadata = metadataResult.candidate;
    const resolvedDescription = metadata.description?.trim() || null;

    let descriptionUpdated = false;
    if (resolvedDescription) {
      if (params.writeMode === AuthorAutoEnrichmentWriteMode.ALWAYS_REFETCH) {
        const current = author.description?.trim() || null;
        if (current !== resolvedDescription) {
          await this.authorsRepo.updateAuthorById(author.id, { description: resolvedDescription });
          descriptionUpdated = true;
        }
      } else if (!author.description?.trim()) {
        descriptionUpdated = await this.authorsRepo.updateAuthorDescriptionIfEmpty(author.id, resolvedDescription);
      }
    }

    let imageUpdated = false;
    if (metadata.imageUrl) {
      try {
        imageUpdated = await this.authorImageStorage.saveFromUrl(author.id, metadata.imageUrl);
      } catch (error) {
        const storageError = error instanceof AuthorImageStorageError ? error : null;
        return {
          kind: 'failed',
          message: storageError?.message ?? (error instanceof Error ? error.message : 'Failed to save author image'),
          provider: metadata.provider,
          httpStatus: storageError?.httpStatus ?? null,
          retryAfterMs: storageError?.retryAfterMs ?? null,
          transient: storageError?.transient ?? true,
          descriptionUpdated: false,
          imageUpdated: false,
        };
      }
    }

    const now = new Date();
    const hasPhoto = !!(await this.authorImageStorage.getThumbnailPath(author.id));
    await this.authorsRepo.updateAuthorById(author.id, {
      lastEnrichedAt: now,
      hasPhoto,
    });

    return {
      kind: 'done',
      provider: metadata.provider,
      descriptionUpdated,
      imageUpdated,
    };
  }
}
