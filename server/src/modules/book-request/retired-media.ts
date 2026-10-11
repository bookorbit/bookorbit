/**
 * Said for anything that would fetch a release for a request whose medium has been retired. Such a
 * request still loads, and can be rejected, cancelled, hidden or deleted; it just goes no further.
 */
export const RETIRED_MEDIUM_REFUSAL = 'Comic requests are no longer supported: reject, cancel or delete this one';
