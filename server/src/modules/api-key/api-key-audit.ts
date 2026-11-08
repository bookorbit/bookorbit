import type { CreatedApiKey } from '@bookorbit/types';

import type { AuditRequest } from '../../common/decorators/auditable.decorator';

/** What the audit log keeps about a created key. Never the token. */
export function createdKeyMeta(_req: AuditRequest, body: unknown): Record<string, unknown> | undefined {
  const key = (body as CreatedApiKey | undefined)?.key;
  if (!key) return undefined;
  return {
    keyId: key.id,
    name: key.name,
    access: key.access,
    admin: key.admin,
    libraryLimited: key.libraryIds !== null,
    issuedBy: key.createdBy?.username ?? null,
  };
}

export function createdKeyId(_req: AuditRequest, body: unknown): number | undefined {
  return (body as CreatedApiKey | undefined)?.key.id;
}

export function keyIdParam(req: AuditRequest): number | undefined {
  const id = parseInt(req.params['keyId'] ?? req.params['id'] ?? '', 10);
  return Number.isInteger(id) ? id : undefined;
}
