import { IsIn, IsInt, IsPositive } from 'class-validator';

export class GrantLibraryAccessDto {
  @IsInt()
  @IsPositive()
  userId: number;

  @IsIn(['viewer', 'editor', 'owner'])
  accessLevel: 'viewer' | 'editor' | 'owner';
}
