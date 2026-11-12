import { describe, expect, it } from 'vitest'

import { orderedActions } from './ai-job-presentation'

describe('ai job presentation', () => {
  it('offers the step forward first and the way out last', () => {
    expect(orderedActions(['cancel', 'pause', 'prioritize'])).toEqual(['pause', 'prioritize', 'cancel'])
    expect(orderedActions(['dismiss', 'retry'])).toEqual(['retry', 'dismiss'])
  })
})
