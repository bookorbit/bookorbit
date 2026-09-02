import { IsBoolean, IsOptional } from 'class-validator';

export class RemoveDownloadDto {
  /**
   * Off unless asked for. The seeded copy is the one BookOrbit hardlinked from, so deleting it is
   * a deliberate choice rather than tidying up after a removal.
   */
  @IsOptional()
  @IsBoolean()
  deleteFiles?: boolean;
}
