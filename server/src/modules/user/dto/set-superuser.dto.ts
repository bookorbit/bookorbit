import { IsBoolean } from 'class-validator';

export class SetSuperuserDto {
  @IsBoolean()
  isSuperuser!: boolean;
}
