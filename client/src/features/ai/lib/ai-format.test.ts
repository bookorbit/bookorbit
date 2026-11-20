import { describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api-json'
import {
  apiTypeLabel,
  connectionHost,
  failureText,
  formatAiCost,
  formatAiDollars,
  formatBuildTime,
  modelPairLabel,
  monthLabel,
  outcomeLabel,
  tryFailureText,
  usageFeatureLabel,
} from './ai-format'
import { parseNumberField } from './ai-number-field'

describe('AI formatting', () => {
  it('shows cents, and four places for a cost under a cent', () => {
    expect(formatAiCost(0)).toBe('$0.00')
    expect(formatAiCost(1_234_567)).toBe('$1.23')
    expect(formatAiCost(180)).toBe('$0.0002')
    expect(formatAiCost(27)).toBe('< $0.0001')
  })

  it('shows API dollars the way micro-dollar costs read', () => {
    expect(formatAiDollars(11.74716)).toBe('$11.75')
    expect(formatAiDollars(0.0002)).toBe('$0.0002')
  })

  it('words a build time in seconds, minutes or hours', () => {
    expect(formatBuildTime(44.4)).toBe('44s')
    expect(formatBuildTime(209)).toBe('3m 29s')
    expect(formatBuildTime(3_725)).toBe('1h 2m')
  })

  it('names a pair of models once when both slots used the same one', () => {
    expect(modelPairLabel('haiku', 'sonnet')).toBe('haiku + sonnet')
    expect(modelPairLabel('sonnet', 'sonnet')).toBe('sonnet')
    expect(modelPairLabel(null, 'sonnet')).toBe('sonnet')
    expect(modelPairLabel(undefined, null)).toBeNull()
  })

  it('names the host and port a connection calls', () => {
    expect(connectionHost('http://localhost:8317/v1')).toBe('localhost:8317')
    expect(connectionHost('https://api.openai.com/v1')).toBe('api.openai.com')
  })

  it('words a failure, and falls back to the provider for a code it does not know', () => {
    expect(failureText('key-rejected')).toBe('The provider rejected the key. Check the key.')
    expect(failureText('rate-limited', { retryAfterSeconds: 40 })).toBe('The provider limited requests. Try again in 40 s.')
    expect(failureText('from-a-newer-server', { message: 'Quota exceeded for project' })).toBe('Quota exceeded for project')
    expect(failureText(null)).toBe('The provider answered with an error.')
  })

  it('names API types and usage features, keeping ids it does not know', () => {
    expect(apiTypeLabel('anthropic-messages')).toBe('Anthropic Messages')
    expect(apiTypeLabel('gemini-native')).toBe('Not supported by this server version')
    expect(usageFeatureLabel('try-it')).toBe('Try it')
    expect(usageFeatureLabel('future-feature')).toBe('future-feature')
  })

  it('words a Try it failure from its error details', () => {
    const failed = (meta: Record<string, string>) => new ApiError("Couldn't run Try it.", 400, 'AI_TRY_FAILED', 'Try it failed', meta)
    expect(tryFailureText(failed({ code: 'provider-auth', failure: 'key-rejected', providerMessage: 'invalid x-api-key' }))).toEqual({
      text: 'The provider rejected the key. Check the key.',
      providerMessage: 'invalid x-api-key',
    })
    expect(tryFailureText(failed({ code: 'refused' })).text).toBe('The model declined to read the sample passage.')
    expect(tryFailureText(failed({ code: 'from-a-newer-server', providerMessage: 'Quota exceeded' }))).toEqual({
      text: 'Quota exceeded',
      providerMessage: null,
    })
    expect(tryFailureText(new ApiError('Choose a connection and a model for this slot first.', 400, 'AI_SLOT_EMPTY', null)).text).toBe(
      'Choose a connection and a model for this slot first.',
    )
  })

  it('names ledger outcomes and months, keeping what it does not know', () => {
    expect(outcomeLabel('ok')).toBe('OK')
    expect(outcomeLabel('error:budget')).toBe('Over budget')
    expect(outcomeLabel('error:from-a-newer-server')).toBe('from-a-newer-server')
    expect(outcomeLabel('something-new')).toBe('something-new')
    expect(monthLabel('2026-03')).toBe('Mar 2026')
    expect(monthLabel('later')).toBe('later')
  })

  it('reads typed amounts, with empty as no limit only where that is allowed', () => {
    expect(parseNumberField('', { min: 1, max: 10, optional: true })).toEqual({ ok: true, value: null })
    expect(parseNumberField('', { min: 1, max: 10 })).toEqual({ ok: false })
    expect(parseNumberField('12.5', { min: 0, max: 100 })).toEqual({ ok: true, value: 12.5 })
    expect(parseNumberField('12.5', { min: 0, max: 100, integer: true })).toEqual({ ok: false })
    expect(parseNumberField('0.001', { min: 0, max: 100 })).toEqual({ ok: false })
    expect(parseNumberField('101', { min: 0, max: 100 })).toEqual({ ok: false })
  })
})
