import { CallHandler, ExecutionContext, Injectable, NestInterceptor, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { Observable } from 'rxjs';

import { BookAliasService } from '../../modules/book-alias/book-alias.service';
import { BookService } from '../../modules/book/book.service';
import { RESOLVES_MERGED_BOOK_KEY, ResolvesMergedBookOptions } from '../decorators/resolves-merged-book.decorator';
import type { RequestUser } from '../types/request-user';

type Fields = Record<string, unknown>;
type AliasableRequest = { params?: unknown; body?: unknown; user?: RequestUser };

const DIGITS = /^\d+$/;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bookIdOf(value: unknown): number | null {
  const id = typeof value === 'number' ? value : typeof value === 'string' && DIGITS.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function aliased(value: unknown, resolved: Map<number, number>): unknown {
  const id = bookIdOf(value);
  const target = id === null ? undefined : resolved.get(id);
  if (target === undefined) return value;
  return typeof value === 'string' ? String(target) : target;
}

function aliasedList(values: unknown[], resolved: Map<number, number>): unknown[] {
  const mapped = values.map((value) => aliased(value, resolved));
  if (mapped.every((value, index) => value === values[index])) return values;
  return [...new Set(mapped)];
}

/**
 * Sends a request made with a merged-away book id to the book it was merged into. Released mobile
 * builds replay queued writes by book id long after a merge, and some of them drop their local copy
 * on a 404, so the routes they use are marked with `@ResolvesMergedBook` and rewritten here. Runs
 * after guards and before pipes, so `ParseIntPipe` and the body DTO see the rewritten id.
 *
 * A signed-in caller who cannot see the kept book keeps the old id: the handler then answers its
 * plain 404, where a rewritten one would name the kept book in "Book <id> not found".
 */
@Injectable()
export class MergedBookAliasInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly bookAlias: BookAliasService,
    private readonly bookService: BookService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<ResolvesMergedBookOptions | undefined>(RESOLVES_MERGED_BOOK_KEY, context.getHandler());
    if (!options || context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<AliasableRequest>();
    return from(this.rewrite(req, options)).pipe(switchMap(() => next.handle()));
  }

  private async rewrite(req: AliasableRequest, options: ResolvesMergedBookOptions): Promise<void> {
    const params = isFields(req.params) ? req.params : {};
    const body = isFields(req.body) ? req.body : {};
    const paramKeys = (options.params ?? []).filter((key) => Object.hasOwn(params, key));
    const bodyKeys = (options.body ?? []).filter((key) => Object.hasOwn(body, key));

    const ids = new Set<number>();
    const collect = (value: unknown) => {
      const id = bookIdOf(value);
      if (id !== null) ids.add(id);
    };
    for (const key of paramKeys) collect(params[key]);
    for (const key of bodyKeys) {
      const value = body[key];
      if (Array.isArray(value)) value.forEach(collect);
      else collect(value);
    }
    if (ids.size === 0) return;

    const resolved = await this.visibleTargets(await this.bookAlias.resolve([...ids]), req.user);
    if (resolved.size === 0) return;

    for (const key of paramKeys) params[key] = aliased(params[key], resolved);
    for (const key of bodyKeys) {
      const value = body[key];
      body[key] = Array.isArray(value) ? aliasedList(value, resolved) : aliased(value, resolved);
    }
  }

  private async visibleTargets(resolved: Map<number, number>, user: RequestUser | undefined): Promise<Map<number, number>> {
    if (!user || resolved.size === 0) return resolved;
    const hidden = new Set<number>();
    for (const target of new Set(resolved.values())) {
      try {
        await this.bookService.verifyBookAccess(target, user);
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
        hidden.add(target);
      }
    }
    return hidden.size === 0 ? resolved : new Map([...resolved].filter(([, target]) => !hidden.has(target)));
  }
}
