export type BookFileRef = {
  id: number;
  format: string | null;
  role: string;
};

export type BookCard = {
  id: number;
  status: string;
  title: string | null;
  authors: string[];
  seriesName: string | null;
  seriesIndex: number | null;
  files: BookFileRef[];
};

export type BookDetailFile = {
  id: number;
  format: string | null;
  role: string;
  sizeBytes: number | null;
};

export type BookDetail = {
  id: number;
  status: string;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  authors: { id: number; name: string; sortName: string | null }[];
  tags: string[];
  files: BookDetailFile[];
};

export type BooksPage = {
  items: BookCard[];
  total: number;
  page: number;
  size: number;
};
