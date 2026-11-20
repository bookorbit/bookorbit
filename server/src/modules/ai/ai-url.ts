import { BadRequestException } from '@nestjs/common';
import { AI_URL_MAX_LENGTH, normaliseAiBaseUrl as normaliseShared, type AiApiType } from '@bookorbit/types';

/**
 * The base URL to store, normalised for the API type and checked for what a provider URL may
 * contain. Where it may point is checked on every request, not here (`ai-network.ts`).
 */
export function normaliseAiBaseUrl(raw: string, apiType: AiApiType): string {
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/?#]*@/i.test(raw.trim())) {
    throw new BadRequestException({ message: 'Put the key in the API key field, not in the URL', errorCode: 'AI_INVALID_URL' });
  }
  const normalised = normaliseShared(raw, apiType);
  let url: URL;
  try {
    url = new URL(normalised);
  } catch {
    throw new BadRequestException({ message: 'Enter the provider URL, such as https://api.example.com/v1', errorCode: 'AI_INVALID_URL' });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException({ message: 'The provider URL must use http or https', errorCode: 'AI_INVALID_URL' });
  }
  if (normalised.length > AI_URL_MAX_LENGTH) {
    throw new BadRequestException({ message: 'The provider URL is too long', errorCode: 'AI_INVALID_URL' });
  }
  return normalised;
}
