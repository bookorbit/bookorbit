import { IsString, Matches } from 'class-validator';

export class UpdateBookAddedAtDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) addedAt!: string;
}
