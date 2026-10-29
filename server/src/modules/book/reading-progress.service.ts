import { Injectable } from '@nestjs/common';
import type { ReadingProgressEntry, ReadingProgressListResponse, ReadingProgressWriteResponse, ReadingProgressWriteResult } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { BookRepository } from './book.repository';
import { BookService } from './book.service';
import type { ReadingProgressWriteDto } from './dto/reading-progress.dto';
import type { SaveProgressDto } from './dto/save-progress.dto';

/** A stored progress row, or the left-joined half of one for a file nothing was saved for. */
interface ProgressRow {
  percentage: number | null;
  cfi: string | null;
  pageNumber: number | null;
  positionSeconds: number | null;
  mediaOverlayFragment: string | null;
  mediaOverlaySectionIndex: number | null;
  narrationPercentage: number | null;
  narrationUpdatedAt: Date | null;
  textUpdatedAt: Date | null;
  koboLocationSource: string | null;
  koboLocationType: string | null;
  koboLocationValue: string | null;
  koboContentSourceProgressPercent: number | null;
  koreaderProgress: string | null;
  updatedAt: Date | null;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function toReadingProgressEntry(fileId: number, row: ProgressRow | null): ReadingProgressEntry {
  return {
    fileId,
    percentage: row?.percentage ?? 0,
    updatedAt: iso(row?.updatedAt),
    text: { cfi: row?.cfi ?? null, page: row?.pageNumber ?? null, updatedAt: iso(row?.textUpdatedAt) },
    narration: {
      seconds: row?.positionSeconds ?? null,
      fragment: row?.mediaOverlayFragment ?? null,
      sectionIndex: row?.mediaOverlaySectionIndex ?? null,
      percentage: row?.narrationPercentage ?? null,
      updatedAt: iso(row?.narrationUpdatedAt),
    },
    kobo: {
      source: row?.koboLocationSource ?? null,
      type: row?.koboLocationType ?? null,
      value: row?.koboLocationValue ?? null,
      contentPercent: row?.koboContentSourceProgressPercent ?? null,
    },
    koreader: row?.koreaderProgress ?? null,
  };
}

/** Narration fields stay undefined when the write leaves them out, which keeps the stored marker. */
function toSaveProgressDto(write: ReadingProgressWriteDto): SaveProgressDto {
  return {
    source: write.kind,
    percentage: write.percentage,
    cfi: write.text?.cfi,
    pageNumber: write.text?.page,
    positionSeconds: write.narration?.seconds,
    mediaOverlayFragment: write.narration?.fragment,
    mediaOverlaySectionIndex: write.narration?.sectionIndex,
    koboLocationSource: write.kobo?.source,
    koboLocationType: write.kobo?.type,
    koboLocationValue: write.kobo?.value,
    koboContentSourceProgressPercent: write.kobo?.contentPercent,
    koreaderProgress: write.koreader,
  };
}

@Injectable()
export class ReadingProgressService {
  constructor(
    private readonly books: BookService,
    private readonly bookRepo: BookRepository,
  ) {}

  async forFile(fileId: number, user: RequestUser): Promise<ReadingProgressListResponse> {
    const row = await this.books.getProgress(user.id, fileId, user);
    return { items: [toReadingProgressEntry(fileId, row)] };
  }

  async forBook(bookId: number, user: RequestUser): Promise<ReadingProgressListResponse> {
    await this.books.verifyBookAccess(bookId, user);
    const rows = await this.bookRepo.findProgressByBook(user.id, bookId);
    return { items: rows.map((row) => toReadingProgressEntry(row.fileId, row)) };
  }

  /**
   * Every file is checked before any is written, so a batch naming one the caller cannot open
   * changes nothing. Saving a position twice is harmless, so a batch that fails partway can be sent
   * again whole.
   */
  async save(writes: ReadingProgressWriteDto[], user: RequestUser): Promise<ReadingProgressWriteResponse> {
    for (const write of writes) await this.books.verifyFileAccess(write.fileId, user);
    const results: ReadingProgressWriteResult[] = [];
    for (const write of writes) results.push(await this.saveOne(write, user));
    return { results };
  }

  async clear(fileId: number, user: RequestUser): Promise<void> {
    await this.books.clearFileProgress(user.id, fileId, user);
  }

  private async saveOne(write: ReadingProgressWriteDto, user: RequestUser): Promise<ReadingProgressWriteResult> {
    if (write.editedAt) {
      const stored = await this.bookRepo.findProgress(user.id, write.fileId);
      if (stored?.updatedAt && stored.updatedAt.getTime() > Date.parse(write.editedAt)) {
        return { fileId: write.fileId, status: 'superseded', progress: toReadingProgressEntry(write.fileId, stored) };
      }
    }
    await this.books.saveProgress(user.id, write.fileId, toSaveProgressDto(write), user);
    const saved = await this.bookRepo.findProgress(user.id, write.fileId);
    return { fileId: write.fileId, status: 'saved', progress: toReadingProgressEntry(write.fileId, saved) };
  }
}
