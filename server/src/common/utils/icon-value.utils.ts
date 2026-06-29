import { BadRequestException } from '@nestjs/common';
import { CUSTOM_ICON_PREFIX, ICON_VALUE_MAX_LENGTH } from '@bookorbit/types';

const CUSTOM_ICON_VALUE_REGEX = /^custom:[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeIconValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const icon = value.trim();
  if (!icon) return null;
  if (icon.length > ICON_VALUE_MAX_LENGTH) {
    throw new BadRequestException(`Icon must not exceed ${ICON_VALUE_MAX_LENGTH} characters`);
  }
  if (icon.startsWith(CUSTOM_ICON_PREFIX) && !CUSTOM_ICON_VALUE_REGEX.test(icon)) {
    throw new BadRequestException('Custom icon reference is invalid');
  }
  return icon;
}
