import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { AuthService } from '../auth/auth.service';

/**
 * The same coded shape every other submission refusal carries, so the request form and an
 * integration both read these the way they read the rest.
 */
function onBehalfForbidden(): ForbiddenException {
  return new ForbiddenException({
    message: 'You cannot file a book request for another user',
    errorCode: 'SUBMIT_ON_BEHALF_FORBIDDEN',
    statusCode: HttpStatus.FORBIDDEN,
  });
}

function onBehalfUnknownUser(): NotFoundException {
  return new NotFoundException({
    message: 'That user cannot have a book request filed for them',
    errorCode: 'SUBMIT_ON_BEHALF_UNKNOWN_USER',
    statusCode: HttpStatus.NOT_FOUND,
  });
}

/**
 * Who a request is *for*, when that is not the account that made the call.
 *
 * A front end that its own users sign into has one BookOrbit account and many people behind it, so
 * every request it files lands under the integration rather than under whoever asked. Naming the
 * requester fixes that, and the whole risk of allowing it lives in this one file.
 *
 * Two roles, and keeping them apart is the entire design:
 *
 * - the **actor** holds the token. They decide nothing about the request beyond being allowed to
 *   name somebody, and they stay the actor in the audit log, because who made the call is the
 *   question an audit log answers.
 * - the **subject** is who the request is for: their permissions, their reachable libraries, their
 *   caps, their notifications.
 *
 * The invariant that makes this safe is that naming a subject must never let the actor do
 * something they could not already do, and must never lend the subject something the actor holds.
 * It is gated on `manage_book_requests`, whose holder can already approve, grab, fulfil and delete
 * any request in the queue, so what this adds is attribution and not capability. Gated on anything
 * weaker it would be a plain escalation, because an ordinary user could then borrow the
 * self-fulfilment of somebody who has it.
 */
@Injectable()
export class BookRequestAttributionService {
  constructor(private readonly auth: AuthService) {}

  /**
   * The user a submission should be recorded against.
   *
   * Returns the actor unchanged for every ordinary request, including one that names its own
   * caller, so the path the web app and the mobile app take is the path that existed before this.
   */
  async resolveSubject(actor: RequestUser, subjectUserId: number | null | undefined): Promise<RequestUser> {
    if (subjectUserId === null || subjectUserId === undefined || subjectUserId === actor.id) return actor;
    if (!this.canActForOthers(actor)) throw onBehalfForbidden();

    // Resolved the way an authenticated request resolves them, so a deactivated account and a
    // shared account whose link was revoked are refused here exactly as they are at the login.
    //
    // Deliberately not a fall back to the actor: filing silently under the caller is the
    // mis-attribution this exists to end, and doing it on a typo would hide the typo too.
    const subject = await this.auth.findActingUser(subjectUserId);
    if (!subject) throw onBehalfUnknownUser();

    return subject;
  }

  /** Who filed it, recorded only where that is not also who it is for. */
  createdByUserIdFor(actor: RequestUser, subject: RequestUser): number | null {
    return actor.id === subject.id ? null : actor.id;
  }

  private canActForOthers(actor: RequestUser): boolean {
    return actor.isSuperuser || actor.permissions.includes(Permission.ManageBookRequests);
  }
}
