import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { DEFAULT_LOCALE, localeFromAcceptLanguage, type Locale } from '@bookorbit/types';

/**
 * The supported language the request's `Accept-Language` asks for, or English when it names none.
 * Pair it with `@Header('Vary', 'Accept-Language')` on the route, so a shared cache never hands one
 * language's response to another.
 */
export const RequestLocale = createParamDecorator((_: unknown, ctx: ExecutionContext): Locale => {
  const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
  const header = request.headers['accept-language'];
  return localeFromAcceptLanguage(Array.isArray(header) ? header.join(',') : header) ?? DEFAULT_LOCALE;
});
