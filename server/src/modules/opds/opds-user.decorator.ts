import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { OpdsRequestUser } from './opds-auth.guard';

export const OpdsUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): OpdsRequestUser => ctx.switchToHttp().getRequest<{ opdsUser: OpdsRequestUser }>().opdsUser,
);
