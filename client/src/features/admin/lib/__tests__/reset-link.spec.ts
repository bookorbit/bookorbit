import { describe, expect, it } from 'vitest'
import { resolveResetLinkUrl } from '../reset-link'

describe('resolveResetLinkUrl', () => {
  const publicOrigin = 'https://books.example.test'

  it.each([
    'http://172.18.0.4:3000',
    'http://10.0.0.5:3000',
    'http://192.168.1.5:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://[::1]:3000',
    'http://[fd12::1]:3000',
  ])('uses the public browser origin when APP_URL is local: %s', (configuredOrigin) => {
    const resetUrl = `${configuredOrigin}/reset-password?token=a%2Bb%3Dc&next=1`
    expect(resolveResetLinkUrl(resetUrl, publicOrigin)).toBe(`${publicOrigin}/reset-password?token=a%2Bb%3Dc&next=1`)
  })

  it('preserves a public configured URL when the admin uses a local address', () => {
    const resetUrl = 'https://books.example.test/reset-password?token=abc'
    expect(resolveResetLinkUrl(resetUrl, 'http://192.168.1.5:3000')).toBe(resetUrl)
  })

  it('preserves a different public canonical domain', () => {
    const resetUrl = 'https://fcbooks.example.test/reset-password?token=abc'
    expect(resolveResetLinkUrl(resetUrl, publicOrigin)).toBe(resetUrl)
  })

  it('preserves a local link when both addresses are local', () => {
    const resetUrl = 'http://172.18.0.4:3000/reset-password?token=abc'
    expect(resolveResetLinkUrl(resetUrl, 'http://192.168.1.5:3000')).toBe(resetUrl)
  })

  it('does not downgrade a secure reset link to HTTP', () => {
    const resetUrl = 'https://localhost:3000/reset-password?token=abc'
    expect(resolveResetLinkUrl(resetUrl, 'http://books.example.test')).toBe(resetUrl)
  })

  it('preserves malformed and unsupported URLs', () => {
    expect(resolveResetLinkUrl('not a URL', publicOrigin)).toBe('not a URL')
    expect(resolveResetLinkUrl('javascript:alert(1)', publicOrigin)).toBe('javascript:alert(1)')
  })
})
