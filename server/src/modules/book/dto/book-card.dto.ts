export class BookCardDto {
  id: number;
  status: string;
  title: string | null;
  authors: string[];
  seriesName: string | null;
  seriesIndex: number | null;
}
