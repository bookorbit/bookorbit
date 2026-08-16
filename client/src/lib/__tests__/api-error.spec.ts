// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readApiErrorDetail } from '../api-error'

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as unknown as Response
}

describe('readApiErrorDetail', () => {
  it('joins the constraint array a ValidationPipe rejection returns', async () => {
    const detail = await readApiErrorDetail(
      jsonResponse({
        statusCode: 400,
        message: ['amazonId must be shorter than or equal to 20 characters', 'goodreadsId must be a string'],
        error: 'Bad Request',
      }),
    )

    expect(detail).toBe('amazonId must be shorter than or equal to 20 characters, goodreadsId must be a string')
  })

  it('returns the plain string message a thrown HttpException produces', async () => {
    expect(await readApiErrorDetail(jsonResponse({ statusCode: 404, message: 'Book 7 not found' }))).toBe('Book 7 not found')
  })

  it('returns null when the body carries no usable message', async () => {
    expect(await readApiErrorDetail(jsonResponse({ statusCode: 500 }))).toBeNull()
    expect(await readApiErrorDetail(jsonResponse({ message: '' }))).toBeNull()
    expect(await readApiErrorDetail(jsonResponse({ message: '   ' }))).toBeNull()
    expect(await readApiErrorDetail(jsonResponse({ message: [] }))).toBeNull()
    expect(await readApiErrorDetail(jsonResponse({ message: 42 }))).toBeNull()
    expect(await readApiErrorDetail(jsonResponse(null))).toBeNull()
    expect(await readApiErrorDetail(jsonResponse('plain text'))).toBeNull()
  })

  it('drops non-string entries rather than rendering them as undefined', async () => {
    expect(await readApiErrorDetail(jsonResponse({ message: ['title must be a string', null, 7] }))).toBe('title must be a string')
  })

  it('returns null for a body that is not JSON at all', async () => {
    const html = {
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    } as unknown as Response

    expect(await readApiErrorDetail(html)).toBeNull()
  })

  it('returns null when the response cannot be read as JSON at all', async () => {
    expect(await readApiErrorDetail({} as Response)).toBeNull()
  })

  it('caps a long message so a rejected bulk payload cannot flood the layout', async () => {
    const detail = await readApiErrorDetail(jsonResponse({ message: Array.from({ length: 40 }, (_, i) => `field${i} must be a string`) }))

    expect(detail).toHaveLength(303)
    expect(detail?.endsWith('...')).toBe(true)
    expect(detail?.startsWith('field0 must be a string')).toBe(true)
  })

  it('leaves a message that fits the cap untouched', async () => {
    const message = 'x'.repeat(300)

    expect(await readApiErrorDetail(jsonResponse({ message }))).toBe(message)
  })
})
