import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { TTS_AUDIO_FORMATS } from '../tts-audio-format';

export class SynthesizeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text!: string;

  @IsString()
  @IsOptional()
  voiceId?: string;

  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsNumber()
  @Min(0.25)
  @Max(4)
  speed!: number;

  @IsOptional()
  @IsString()
  @IsIn(TTS_AUDIO_FORMATS)
  format?: string;
}

export class PreviewVoiceDto {
  @IsString()
  @IsNotEmpty()
  voiceId!: string;

  @IsString()
  @IsNotEmpty()
  providerId!: string;
}
