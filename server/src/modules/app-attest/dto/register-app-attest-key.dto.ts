import { IsBase64, IsString, MaxLength } from 'class-validator';

export class RegisterAppAttestKeyDto {
  @IsString()
  @IsBase64()
  @MaxLength(64)
  keyId!: string;

  @IsString()
  @IsBase64()
  @MaxLength(32_768)
  attestation!: string;

  @IsString()
  @MaxLength(128)
  challenge!: string;
}
