import { Injectable } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import type { AiJobRow } from '../../db/schema';
import { UserService } from '../user/user.service';
import { AiJobFailure, type AiFeature, type AiSubject } from './ai-feature';

/**
 * What a job depends on, checked when it is claimed and before each step: a job runs on its
 * requester's authority and must stop once they could no longer have started it, and it builds for
 * one text, so a file that changed under it ends it.
 */
@Injectable()
export class AiJobChecks {
  constructor(private readonly users: UserService) {}

  async verify(row: AiJobRow, feature: AiFeature): Promise<{ user: RequestUser; subject: AiSubject }> {
    const user = await this.requester(row, feature);
    const subject = await feature.resolveSubject(row.subjectRef);
    if (subject.key !== row.subjectKey) throw new AiJobFailure('source-changed', 'The file no longer has the text this job builds for');
    return { user, subject };
  }

  async requester(row: AiJobRow, feature: AiFeature): Promise<RequestUser> {
    const user = row.requestedBy == null ? null : await this.users.findByIdWithPermissions(row.requestedBy);
    if (!user?.active) throw new AiJobFailure('requester', 'The requesting account is no longer active');
    if (!mayRun(user, feature)) throw new AiJobFailure('requester', 'The requesting account no longer has the permission');
    if (!(await feature.canReach(user, row.subjectRef))) throw new AiJobFailure('requester', 'The requesting account can no longer reach this book');
    return user;
  }
}

export function mayRun(user: Pick<RequestUser, 'active' | 'isSuperuser' | 'permissions'>, feature: Pick<AiFeature, 'permission'>): boolean {
  return user.active && (user.isSuperuser || user.permissions.includes(feature.permission));
}
