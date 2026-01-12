import { IsIn } from 'class-validator';

export class UpdateLibraryAccessDto {
  @IsIn(['viewer', 'editor', 'owner'])
  accessLevel: 'viewer' | 'editor' | 'owner';
}
