import { IsBase64, IsIn, IsString, MaxLength } from 'class-validator';

import { VISION_SCAN_KINDS, VISION_SCAN_MAX_IMAGE_BASE64_LENGTH, type VisionScanKind, type VisionScanRequest } from '@bookorbit/types';

/**
 * The route's body limit. Fastify's default of 1 MiB would refuse most phone photos with a 413
 * before this DTO is read. The photo travels as base64 JSON so App Attest can hash the body.
 */
export const VISION_SCAN_BODY_LIMIT_BYTES = VISION_SCAN_MAX_IMAGE_BASE64_LENGTH + 64 * 1024;

export class VisionScanDto implements VisionScanRequest {
  @IsIn(VISION_SCAN_KINDS)
  kind!: VisionScanKind;

  @IsString()
  @MaxLength(VISION_SCAN_MAX_IMAGE_BASE64_LENGTH)
  @IsBase64()
  image!: string;
}
