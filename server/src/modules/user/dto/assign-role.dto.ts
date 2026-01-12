import { IsInt, IsPositive } from 'class-validator';

export class AssignRoleDto {
  @IsInt()
  @IsPositive()
  roleId: number;
}
