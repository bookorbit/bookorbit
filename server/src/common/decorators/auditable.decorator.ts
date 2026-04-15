import { SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { AuditAction, AuditResource } from '@projectx/types';

export const AUDITABLE_KEY = 'auditable';

export type AuditRequest = Omit<FastifyRequest, 'params' | 'body'> & {
  params: Record<string, string>;
  body: unknown;
};

export interface AuditableOptions {
  action: AuditAction;
  resource?: AuditResource;
  getResourceId?: (req: AuditRequest, responseBody: unknown) => number | undefined;
  description: string | ((req: AuditRequest, responseBody: unknown) => string);
}

export const Auditable = (options: AuditableOptions) => {
  if (!options.action) {
    throw new Error('Auditable decorator requires a defined audit action');
  }

  return SetMetadata(AUDITABLE_KEY, options);
};
