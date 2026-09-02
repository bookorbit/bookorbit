import { describe, expect, it } from 'vitest'

import { localizedRequestActionFailure } from './requestActionFailure'

describe('localizedRequestActionFailure', () => {
  it('maps coded lifecycle failures with their translation parameters', () => {
    expect(
      localizedRequestActionFailure({
        errorCode: 'BOOK_REQUEST_STALE_TRANSITION',
        errorMeta: { action: 'approve', status: 'rejected' },
        reason: null,
      }),
    ).toEqual({
      key: 'bookRequests.actionError.BOOK_REQUEST_STALE_TRANSITION',
      params: { action: 'approve', status: 'rejected' },
    })
  })

  it('keeps submission refusals localizable on shared action paths', () => {
    expect(localizedRequestActionFailure({ errorCode: 'SUBMIT_SELF_SERVE_LIMIT', errorMeta: { limit: 10 }, reason: null })).toEqual({
      key: 'bookRequests.submitError.SUBMIT_SELF_SERVE_LIMIT',
      params: { limit: 10 },
    })
  })

  it('leaves external grab refusals to their original prose', () => {
    expect(localizedRequestActionFailure({ errorCode: 'GRAB_SOURCE_REFUSED', errorMeta: null, reason: 'Tracker refused' })).toBeNull()
    expect(localizedRequestActionFailure({ errorCode: null, errorMeta: null, reason: null })).toBeNull()
  })
})
