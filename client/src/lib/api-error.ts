/**
 * A failed response carries the only description of what was actually wrong: the `message` the
 * global exception filter serialized. Discarding it leaves the user with a bare status code and no
 * way to tell which field the server rejected.
 */

/** `forbidNonWhitelisted` can name every rejected property at once, and this renders inline. */
const MAX_DETAIL_LENGTH = 300

/**
 * Reads the server's own description of a failure. Returns null when the body carried none, so
 * callers can fall back to translated copy instead of showing an untranslated status code.
 *
 * Nest sends a plain string for thrown `HttpException`s and an array of constraint messages for
 * `ValidationPipe` rejections; both shapes are flattened here.
 */
export async function readApiErrorDetail(response: Response): Promise<string | null> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return null
  }

  if (typeof body !== 'object' || body === null) return null
  const message: unknown = (body as { message?: unknown }).message

  let detail = ''
  if (typeof message === 'string') {
    detail = message
  } else if (Array.isArray(message)) {
    detail = message.filter((entry): entry is string => typeof entry === 'string').join(', ')
  }

  detail = detail.trim()
  if (!detail) return null
  return detail.length > MAX_DETAIL_LENGTH ? `${detail.slice(0, MAX_DETAIL_LENGTH)}...` : detail
}
