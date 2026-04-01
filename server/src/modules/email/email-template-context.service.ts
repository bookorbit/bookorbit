import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { BookFile } from '../../db/schema';
import type { TemplateContext } from './email-template-renderer';
import { formatFileSize } from './email-template-renderer';
import { EmailBookReadRepository } from './email-book-read.repository';

@Injectable()
export class EmailTemplateContextService {
  constructor(
    private readonly bookReadRepository: EmailBookReadRepository,
    private readonly config: ConfigService,
  ) {}

  async buildForBook(bookId: number, fileId: number | null, senderName: string): Promise<TemplateContext> {
    const [book, meta, authorRows, tagRows, file] = await Promise.all([
      this.bookReadRepository.findBookById(bookId),
      this.bookReadRepository.findMetadataByBookId(bookId),
      this.bookReadRepository.findAuthorNamesByBookId(bookId),
      this.bookReadRepository.findTagNamesByBookId(bookId),
      fileId !== null ? this.bookReadRepository.findFileById(fileId) : Promise.resolve(null),
    ]);

    if (!book) throw new NotFoundException('Book not found');
    if (fileId !== null && (!file || file.bookId !== bookId)) throw new NotFoundException('Book file not found');

    const selectedFile: BookFile | null = fileId !== null ? file : null;

    const appUrl = (this.config.get<string>('app.appUrl') ?? '').replace(/\/+$/, '');
    const coverUrl = meta ? `${appUrl}/api/books/${bookId}/cover` : '';

    return {
      title: meta?.title ?? '',
      subtitle: meta?.subtitle ?? '',
      author: authorRows.map((a) => a.name).join(', '),
      series: meta?.seriesName ?? '',
      seriesIndex: meta?.seriesIndex ?? null,
      format: selectedFile?.format?.toUpperCase() ?? '',
      fileSize: formatFileSize(selectedFile?.sizeBytes ?? null),
      pageCount: meta?.pageCount ?? null,
      publisher: meta?.publisher ?? '',
      publishedYear: meta?.publishedYear ?? null,
      isbn: meta?.isbn13 ?? meta?.isbn10 ?? '',
      tags: tagRows.map((t) => t.name).join(', '),
      language: meta?.language ?? '',
      senderName,
      appUrl,
      coverUrl,
    };
  }
}
