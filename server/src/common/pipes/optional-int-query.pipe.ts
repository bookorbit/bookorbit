import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/**
 * An absent query parameter falls back to the default; a present one must be an integer.
 *
 * `DefaultValuePipe` followed by `ParseIntPipe` cannot tell those apart here: an unparseable value
 * arrives as the default, so `?page=abc` silently read page 0 while every DTO-validated sibling
 * answered 400. The routes that parse their pagination by hand use this instead so both shapes of
 * list endpoint reject the same input.
 */
@Injectable()
export class OptionalIntQueryPipe implements PipeTransform<unknown, number> {
  constructor(private readonly fallback: number) {}

  transform(value: unknown, metadata: ArgumentMetadata): number {
    if (value === undefined || value === null) return this.fallback;
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim().length > 0 ? Number(value) : Number.NaN;
    if (!Number.isInteger(parsed)) throw new BadRequestException(`${metadata.data ?? 'value'} must be an integer number`);
    return parsed;
  }
}
