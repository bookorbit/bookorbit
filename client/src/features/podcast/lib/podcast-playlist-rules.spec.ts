import { describe, expect, it } from 'vitest'
import { appendPlaylistRuleParams, DEFAULT_PLAYLIST_RULES, normalizePlaylistRules, playlistRuleBody } from './podcast-playlist-rules'

describe('podcast playlist rules', () => {
  it('sends only the rules that narrow the match', () => {
    const params = new URLSearchParams()

    appendPlaylistRuleParams(params, normalizePlaylistRules({ filter: 'unplayed', sort: 'shortest', maxDurationMinutes: 20 }))

    expect(params.toString()).toBe('filter=unplayed&sort=shortest&followedOnly=false&maxDurationMinutes=20')
  })

  it('serialises a show list as a single comma separated parameter', () => {
    const params = new URLSearchParams()

    appendPlaylistRuleParams(params, normalizePlaylistRules({ podcastIds: [4, 9], publishedWithinDays: 7, followedOnly: true }))

    expect(params.get('podcastIds')).toBe('4,9')
    expect(params.get('publishedWithinDays')).toBe('7')
    expect(params.get('followedOnly')).toBe('true')
  })

  it('omits unset rules from the bulk queue body', () => {
    expect(playlistRuleBody(DEFAULT_PLAYLIST_RULES)).toEqual({ filter: 'latest', sort: 'newest', followedOnly: false })
  })

  it('copies the show list so an edited draft never mutates the stored rules', () => {
    const stored = normalizePlaylistRules({ podcastIds: [1] })

    const draft = normalizePlaylistRules(stored)
    draft.podcastIds.push(2)

    expect(stored.podcastIds).toEqual([1])
  })
})
