export class BookFileRefDto {
  id: number;
  format: string | null;
  role: string;
}

export class BookCardDto {
  id: number;
  status: string;
  title: string | null;
  authors: string[];
  seriesName: string | null;
  seriesIndex: number | null;
  files: BookFileRefDto[];
  publishedYear: number | null;
  language: string | null;
  tags: string[];
  rating: number | null;
  readingProgress: number | null;
  addedAt: string;
}
