import { Injectable } from '@nestjs/common';

import type { HubAnnotationRow } from './annotation.repository';

export type AnnotationExportFormat = 'md' | 'csv' | 'json';

export interface AnnotationExportResult {
  content: string;
  contentType: string;
  filename: string;
}

@Injectable()
export class AnnotationExportService {
  export(rows: HubAnnotationRow[], format: AnnotationExportFormat, scopeLabel: string): AnnotationExportResult {
    const stamp = new Date().toISOString().slice(0, 10);
    const safeScope =
      scopeLabel
        .replace(/[^\w-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'annotations';
    if (format === 'csv') {
      return {
        content: this.toCsv(rows),
        contentType: 'text/csv; charset=utf-8',
        filename: `${safeScope}-annotations-${stamp}.csv`,
      };
    }
    if (format === 'json') {
      return {
        content: this.toJson(rows),
        contentType: 'application/json; charset=utf-8',
        filename: `${safeScope}-annotations-${stamp}.json`,
      };
    }
    return {
      content: this.toMarkdown(rows),
      contentType: 'text/markdown; charset=utf-8',
      filename: `${safeScope}-annotations-${stamp}.md`,
    };
  }

  private toMarkdown(rows: HubAnnotationRow[]): string {
    const lines: string[] = ['# Annotations', ''];
    let currentBook: string | null = null;
    let currentChapter: string | null = null;
    for (const row of rows) {
      const book = row.bookTitle ?? 'Unknown book';
      if (book !== currentBook) {
        currentBook = book;
        currentChapter = null;
        lines.push(`## ${book}`, '');
      }
      const chapter = row.chapterTitle ?? null;
      if (chapter !== currentChapter) {
        currentChapter = chapter;
        if (chapter) lines.push(`### ${chapter}`, '');
      }
      const quote = row.text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      lines.push(quote);
      if (row.note) lines.push('', `Note: ${row.note}`);
      lines.push('', `<sub>${row.style}, ${row.color}, ${row.origin}, ${row.createdAt.toISOString().slice(0, 10)}</sub>`, '');
    }
    return lines.join('\n');
  }

  private toCsv(rows: HubAnnotationRow[]): string {
    const header = ['book', 'chapter', 'text', 'note', 'color', 'style', 'origin', 'createdAt'];
    const escape = (value: string | null): string => {
      const raw = value ?? '';
      return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
    };
    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push(
        [
          escape(row.bookTitle),
          escape(row.chapterTitle),
          escape(row.text),
          escape(row.note),
          escape(row.color),
          escape(row.style),
          escape(row.origin),
          escape(row.createdAt.toISOString()),
        ].join(','),
      );
    }
    return lines.join('\r\n');
  }

  private toJson(rows: HubAnnotationRow[]): string {
    return JSON.stringify(
      rows.map((row) => ({
        id: row.id,
        bookId: row.bookId,
        bookTitle: row.bookTitle,
        chapterTitle: row.chapterTitle,
        text: row.text,
        note: row.note,
        color: row.color,
        style: row.style,
        origin: row.origin,
        cfi: row.cfi,
        createdAt: row.createdAt.toISOString(),
      })),
      null,
      2,
    );
  }
}
