import { computed, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { IndexerColor } from '@bookorbit/types'

import { sourceChipClass } from '../sourceColors'
import type { ReleaseFilters } from './useReleaseFilters'

export interface FacetOption {
  id: string
  label: string
  count: number | null
  active: boolean
  className?: string
  select: () => void
}

export interface FacetGroup {
  key: string
  label: string
  options: FacetOption[]
}

/**
 * The filter rail as data rather than four near-identical markup blocks, because the rail and the
 * wrapping bar it becomes below 2xl are the same list rendered twice over.
 *
 * A group appears only where it could change the list: one option is a control that can do
 * nothing but empty the rows it is already showing.
 */
export function useReleaseFacetGroups(filters: ReleaseFilters, colorByIndexer: Ref<Map<number, IndexerColor | null>>, allFreeleech: Ref<boolean>) {
  const { t } = useI18n()

  const facetGroups = computed<FacetGroup[]>(() => {
    const groups: FacetGroup[] = []

    if (filters.availableSortKeys.value.length > 1) {
      groups.push({
        key: 'sort',
        label: t('bookRequests.releases.sortBy'),
        options: filters.availableSortKeys.value.map((key) => ({
          id: `sort-${key}`,
          label: t(`bookRequests.releases.sort.${key}`),
          count: null,
          active: filters.sortKey.value === key,
          select: () => filters.selectSort(key),
        })),
      })
    }

    if (filters.languageFacets.value.length > 1) {
      groups.push({
        key: 'language',
        label: t('bookRequests.releases.language'),
        options: filters.languageFacets.value.map((facet) => ({
          id: `language-${facet.value}`,
          label: facet.value,
          count: facet.count,
          active: filters.language.value === facet.value,
          select: () => filters.selectLanguage(facet.value),
        })),
      })
    }

    if (filters.formatFacets.value.length > 1) {
      groups.push({
        key: 'format',
        label: t('bookRequests.releases.format'),
        options: filters.formatFacets.value.map((facet) => ({
          id: `format-${facet.value}`,
          label: facet.value,
          count: facet.count,
          active: filters.format.value === facet.value,
          select: () => filters.selectFormat(facet.value),
        })),
      })
    }

    if (filters.fileFacets.value.length > 1) {
      groups.push({
        key: 'files',
        label: t('bookRequests.releases.files'),
        options: filters.fileFacets.value.map((facet) => ({
          id: `files-${facet.layout}`,
          label: t(`bookRequests.releases.fileLayout.${facet.layout}`),
          count: facet.count,
          active: filters.fileLayout.value === facet.layout,
          select: () => filters.selectFileLayout(facet.layout),
        })),
      })
    }

    // Channels and the bitrate floor share one group rather than opening a second: they are the same
    // question about the same encode, and the rail is what an approver reads before the rows.
    const audioOptions: FacetOption[] = [
      ...(filters.channelFacets.value.length > 1
        ? filters.channelFacets.value.map((facet) => ({
            id: `audio-${facet.channels}`,
            label: t(`bookRequests.releases.channels.${facet.channels === 1 ? 'mono' : 'stereo'}`),
            count: facet.count,
            active: filters.channels.value === facet.channels,
            select: () => filters.selectChannels(facet.channels),
          }))
        : []),
      ...filters.bitrateFacets.value.map((facet) => ({
        id: `bitrate-${facet.step}`,
        label: t('bookRequests.releases.bitrateAtLeast', { rate: facet.step }),
        count: facet.count,
        active: filters.minBitrate.value === facet.step,
        select: () => filters.selectMinBitrate(facet.step),
      })),
    ]
    if (audioOptions.length > 0) {
      groups.push({ key: 'audio', label: t('bookRequests.releases.audio'), options: audioOptions })
    }

    const flagOptions: FacetOption[] = []
    if (filters.freeleechCount.value > 0 && !allFreeleech.value) {
      flagOptions.push({
        id: 'flag-freeleech',
        label: t('bookRequests.releases.freeleech'),
        count: filters.freeleechCount.value,
        active: filters.freeleechOnly.value,
        select: filters.toggleFreeleech,
      })
    }
    // Only where such a release is actually present. These rows are dead ends for an account that is
    // not VIP, and offering to hide none of them says nothing.
    if (filters.vipOnlyCount.value > 0) {
      flagOptions.push({
        id: 'flag-vip',
        label: t('bookRequests.releases.hideVipOnly'),
        count: filters.vipOnlyCount.value,
        active: filters.hideVipOnly.value,
        select: filters.toggleHideVipOnly,
      })
    }
    if (flagOptions.length > 0) {
      groups.push({ key: 'flags', label: t('bookRequests.releases.flags'), options: flagOptions })
    }

    if (filters.sourceFacets.value.length > 1) {
      groups.push({
        key: 'source',
        label: t('bookRequests.releases.indexer'),
        options: filters.sourceFacets.value.map((facet) => ({
          id: `source-${facet.indexerId}`,
          label: facet.name,
          count: facet.count,
          active: filters.source.value === facet.indexerId,
          className: sourceChipClass(colorByIndexer.value.get(facet.indexerId)),
          select: () => filters.selectSource(facet.indexerId),
        })),
      })
    }

    return groups
  })

  return { facetGroups }
}
