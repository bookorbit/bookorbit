import type { InjectionKey, MaybeRefOrGetter } from 'vue'

/**
 * Whether the metadata editors show their per-field lock toggles.
 *
 * A lock only means anything against a feed refresh, and local content is never refreshed, so the
 * editors provide `false` for a local-origin show or episode and every field label hides its
 * toggle. Defaults to true, which is what a feed-backed editor wants without providing anything.
 */
export const PODCAST_LOCKS_ENABLED: InjectionKey<MaybeRefOrGetter<boolean>> = Symbol('podcastLocksEnabled')
