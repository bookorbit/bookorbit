import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { KoboDeviceContext } from '../guards/kobo-token.guard';

export const KoboDevice = createParamDecorator((_: unknown, ctx: ExecutionContext): KoboDeviceContext => {
  const req = ctx.switchToHttp().getRequest<Record<string, unknown>>();
  return req.koboDevice as KoboDeviceContext;
});
