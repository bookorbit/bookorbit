export interface AudiobookChapter {
  title: string;
  startMs: number;
}

export interface NarratorRef {
  id: number;
  name: string;
  sortName: string | null;
  displayOrder: number;
}
