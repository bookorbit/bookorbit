export type UploadResult = {
  bookId: number;
  filename: string;
  format: string;
  sizeBytes: number;
};

export type AddBookFileResult = {
  id: number;
  format: string | null;
  role: string;
  sizeBytes: number | null;
  absolutePath: string;
  createdAt: string;
  filename: string;
  durationSeconds: number | null;
  bookStatus: string;
};
