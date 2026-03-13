import { IsInt, Min } from 'class-validator';

export class UpdateWeightsDto {
  @IsInt() @Min(0) title!: number;
  @IsInt() @Min(0) subtitle!: number;
  @IsInt() @Min(0) description!: number;
  @IsInt() @Min(0) coverSource!: number;
  @IsInt() @Min(0) genres!: number;
  @IsInt() @Min(0) isbn13!: number;
  @IsInt() @Min(0) publisher!: number;
  @IsInt() @Min(0) publishedYear!: number;
  @IsInt() @Min(0) language!: number;
  @IsInt() @Min(0) isbn10!: number;
  @IsInt() @Min(0) pageCount!: number;
  @IsInt() @Min(0) rating!: number;
  @IsInt() @Min(0) seriesName!: number;
  @IsInt() @Min(0) seriesIndex!: number;
  @IsInt() @Min(0) tags!: number;
  @IsInt() @Min(0) authors!: number;
  @IsInt() @Min(0) googleBooksId!: number;
  @IsInt() @Min(0) goodreadsId!: number;
  @IsInt() @Min(0) amazonId!: number;
  @IsInt() @Min(0) hardcoverId!: number;
  @IsInt() @Min(0) openLibraryId!: number;
  @IsInt() @Min(0) itunesId!: number;
}
