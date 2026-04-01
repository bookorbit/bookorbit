import { Injectable, Logger } from '@nestjs/common';

import { BookEmbeddingVectorizerService } from './book-embedding-vectorizer.service';
import { BookEmbedderRepository } from './book-embedder.repository';

const EMBEDDING_EVENT = 'book.embedding';

@Injectable()
export class BookEmbedderService {
  private readonly logger = new Logger(BookEmbedderService.name);

  constructor(
    private readonly embedderRepository: BookEmbedderRepository,
    private readonly vectorizer: BookEmbeddingVectorizerService,
  ) {}

  async embedBook(bookId: number): Promise<number[] | null> {
    const startedAt = Date.now();
    this.logger.debug(`[${EMBEDDING_EVENT}] [start] bookId=${bookId} - embedding started`);

    try {
      const sourceData = await this.embedderRepository.findSourceData(bookId);
      if (!sourceData) {
        this.logger.debug(
          `[${EMBEDDING_EVENT}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} outcome=metadata_missing - embedding completed`,
        );
        return null;
      }

      const embedding = this.vectorizer.buildVector(sourceData);
      await this.embedderRepository.saveEmbedding(bookId, embedding);

      this.logger.debug(
        `[${EMBEDDING_EVENT}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} authorCount=${sourceData.authors.length} genreCount=${sourceData.genres.length} tagCount=${sourceData.tags.length} - embedding completed`,
      );
      return embedding;
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${EMBEDDING_EVENT}] [fail] bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${this.sanitizeErrorMessage(
          error,
        )}" - embedding failed`,
      );
      throw error;
    }
  }

  private sanitizeErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message.replace(/[\r\n"]/g, ' ').slice(0, 200);
    return String(error)
      .replace(/[\r\n"]/g, ' ')
      .slice(0, 200);
  }
}
