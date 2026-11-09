import { ArrayMaxSize, ArrayMinSize, IsArray, IsBase64, IsString, MaxLength } from 'class-validator';

export class RegisterAndroidKeyDto {
  @IsString()
  @IsBase64()
  @MaxLength(64)
  keyId!: string;

  /** DER certificates, leaf first, each in base64. */
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsBase64(undefined, { each: true })
  @MaxLength(16_384, { each: true })
  certificateChain!: string[];

  @IsString()
  @MaxLength(128)
  challenge!: string;
}
