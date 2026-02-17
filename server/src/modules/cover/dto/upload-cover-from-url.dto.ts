import { IsUrl } from 'class-validator';

export class UploadCoverFromUrlDto {
  @IsUrl({ protocols: ['http', 'https'], require_tld: true })
  url: string;
}
