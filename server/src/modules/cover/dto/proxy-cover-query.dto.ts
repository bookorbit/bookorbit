import { IsUrl, MaxLength } from 'class-validator';

export class ProxyCoverQueryDto {
  @IsUrl({ protocols: ['http', 'https'], require_tld: true })
  @MaxLength(2048)
  url: string;
}
