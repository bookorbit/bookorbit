<script setup lang="ts">
import type { PlaceholderCoverStyle } from '@bookorbit/types'
import { useElementSize } from '@vueuse/core'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { renderPlaceholder, type PlaceholderStrings } from '../lib/placeholder'
import { placeholderFontsVersion, watchPlaceholderFonts } from '../lib/placeholder/fonts'

const props = withDefaults(
  defineProps<{
    /** `''` draws the artwork alone, for stacked series fallbacks. */
    title: string | null
    authorLine?: string | null
    isAudio?: boolean
    seed: string
    authors?: readonly string[] | null
    subtitle?: string | null
    seriesName?: string | null
    seriesIndex?: string | number | null
    genres?: readonly string[] | null
    /** Draws this style instead of the reader's setting, for previews. */
    variant?: PlaceholderCoverStyle
  }>(),
  {
    authorLine: null,
    isAudio: false,
    authors: null,
    subtitle: null,
    seriesName: null,
    seriesIndex: null,
    genres: null,
    variant: undefined,
  },
)

const { t, locale } = useI18n()
const { placeholderCoverStyle } = useDisplaySettings()
watchPlaceholderFonts()

const root = ref<HTMLElement | null>(null)
const { width, height } = useElementSize(root)
// 4px buckets keep sub-pixel resizes from laying every cover out again
const size = computed(() => ({ width: Math.round(width.value / 4) * 4, height: Math.round(height.value / 4) * 4 }))

const strings = computed<PlaceholderStrings>(() => {
  const families: Record<string, string> = {
    horror: t('book.placeholder.genre.horror'),
    romance: t('book.placeholder.genre.romance'),
    fantasy: t('book.placeholder.genre.fantasy'),
    scifi: t('book.placeholder.genre.scifi'),
    mystery: t('book.placeholder.genre.mystery'),
    classic: t('book.placeholder.genre.classic'),
    nonfiction: t('book.placeholder.genre.nonfiction'),
    young: t('book.placeholder.genre.young'),
  }
  return {
    untitled: t('book.untitled'),
    volume: (number) => t('book.placeholder.volume', { number }),
    family: (key) => families[key] ?? '',
    list: new Intl.ListFormat(locale.value, { style: 'short', type: 'conjunction' }),
  }
})

const activeStyle = computed(() => props.variant ?? placeholderCoverStyle.value)

const markup = computed(() => {
  void placeholderFontsVersion.value
  if (size.value.width < 8 || size.value.height < 8) return ''
  return renderPlaceholder(
    activeStyle.value,
    {
      title: props.title,
      subtitle: props.subtitle,
      authors: props.authors,
      credit: props.authorLine,
      seriesName: props.seriesName,
      seriesIndex: props.seriesIndex,
      genres: props.genres,
      seed: props.seed,
    },
    size.value,
    strings.value,
  )
})
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- generated SVG; every book string is escaped in the renderer -->
  <span
    ref="root"
    class="absolute inset-0 block overflow-hidden"
    data-testid="cover-placeholder-art"
    :data-placeholder-style="activeStyle"
    aria-hidden="true"
    v-html="markup"
  />
</template>
