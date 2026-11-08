import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

export const INTERACTIVE_ONLY_KEY = 'apiKey:interactiveOnly';
export const ALLOW_API_KEY_KEY = 'apiKey:allow';
export const KEY_READ_SAFE_KEY = 'apiKey:readSafe';

/**
 * Only a signed-in session may call this route or controller: managing credentials, sessions and
 * account security is never delegated to an API key.
 */
export const InteractiveOnly = () => applyDecorators(SetMetadata(INTERACTIVE_ONLY_KEY, true), ApiExtension('x-api-key', 'interactive'));

/** Lets an API key call one handler of an `@InteractiveOnly()` controller. */
export const AllowApiKey = () => applyDecorators(SetMetadata(ALLOW_API_KEY_KEY, true), ApiExtension('x-api-key', 'allowed'));

/**
 * A non-GET route that only reads, such as a search that takes its criteria in a body, so a
 * read-only key may call it. Never put this on a route with a lasting side effect.
 */
export const KeyReadSafe = () => applyDecorators(SetMetadata(KEY_READ_SAFE_KEY, true), ApiExtension('x-api-key-read-safe', true));
