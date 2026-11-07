<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookImage, BookOpen, Headphones } from '@lucide/vue'
import { formatOfKey, getBookMediaKind, type BookCardLinkInfo, type ConcreteBookMediaKind, type FormatBadgeStyle } from '@bookorbit/types'
import { formatList } from '@/i18n/formatters'
import { useLibraries } from '@/features/library/composables/useLibraries'
import BookFormatChip from './BookFormatChip.vue'
import { formatKeyName } from '../lib/book-formats'
import { getFormatColor } from '../lib/format-colors'
import { cardFormatBadges } from '../lib/book-link'

const MAX_DOTS = 5
const MAX_INDICATORS = 5
const PILL_STYLES: FormatBadgeStyle[] = ['primary', 'bubble', 'underline', 'pips']
const MAX_ARCS = 8
const SEAL_RADIUS = 15.5
const SEAL_GAP = 2.2
const KIND_ICONS = { ebook: BookOpen, audiobook: Headphones, comic: BookImage } as const
const KIND_ORDER: ConcreteBookMediaKind[] = ['ebook', 'audiobook', 'comic']

const props = withDefaults(
  defineProps<{
    /** The card's own format keys, the one its media view shows first. */
    ownKeys: string[]
    linked?: BookCardLinkInfo | null
    /** How the formats are drawn. A card with one format always shows the plain pill. */
    badgeStyle?: FormatBadgeStyle
  }>(),
  { linked: null, badgeStyle: 'primary' },
)

const { t } = useI18n()
const { libraries } = useLibraries()

const badges = computed(() => cardFormatBadges(props.ownKeys, props.linked))
const lead = computed(() => badges.value[0] ?? null)
const effectiveStyle = computed<FormatBadgeStyle>(() => (badges.value.length > 1 ? props.badgeStyle : 'primary'))

const isPillStyle = computed(() => PILL_STYLES.includes(effectiveStyle.value))

/** One mark per format after the primary one; past the limit the last mark stands for the rest. */
const indicators = computed(() => {
  const others = badges.value.slice(1)
  const shown = others.length > MAX_INDICATORS ? others.slice(0, MAX_INDICATORS - 1) : others
  const marks = shown.map((badge) => ({ key: badge.key, color: getFormatColor(badge.key), linked: badge.linked }))
  if (others.length > MAX_INDICATORS) marks.push({ key: 'more', color: getFormatColor(null), linked: false })
  return marks
})

const dotBadges = computed(() => (badges.value.length > MAX_DOTS ? badges.value.slice(0, MAX_DOTS - 1) : badges.value))
const dotOverflow = computed(() => badges.value.length - dotBadges.value.length)

const sealArcs = computed(() => {
  const all = badges.value
  const arcs = all.length > MAX_ARCS ? all.slice(0, MAX_ARCS - 1) : all
  const circumference = 2 * Math.PI * SEAL_RADIUS
  const segment = circumference / (arcs.length + (all.length > MAX_ARCS ? 1 : 0))
  const dash = segment - (all.length > 1 ? SEAL_GAP : 0)
  const toArc = (key: string, color: string, linked: boolean, index: number) => ({
    key,
    color,
    linked,
    dasharray: `${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}`,
    dashoffset: (-index * segment).toFixed(2),
  })
  const drawn = arcs.map((badge, index) => toArc(badge.key, getFormatColor(badge.key), badge.linked, index))
  if (all.length > MAX_ARCS) drawn.push(toArc('more', getFormatColor(null), false, arcs.length))
  return drawn
})

const kinds = computed(() => {
  const present = new Set(badges.value.map((badge) => getBookMediaKind(formatOfKey(badge.key))))
  return KIND_ORDER.filter((kind) => present.has(kind)).map((kind) => ({ kind, icon: KIND_ICONS[kind] }))
})

/** The whole list in words: the badge is short codes, colours and shapes, so it stays hidden from screen readers. */
const summary = computed(() => {
  const libraryNames = new Map(libraries.value.map((library) => [library.id, library.name]))
  const own = badges.value.filter((badge) => !badge.linked).map((badge) => formatKeyName(badge.key))
  const linked = badges.value
    .filter((badge) => badge.linked)
    .map((badge) => {
      const format = formatKeyName(badge.key)
      const library = badge.libraryId != null ? libraryNames.get(badge.libraryId) : undefined
      return library ? t('book.link.badges.linkedFormat', { format, library }) : format
    })
  if (linked.length === 0 || own.length === 0) return t('book.link.badges.summary', { formats: formatList([...own, ...linked]) })
  return t('book.link.badges.summaryLinked', { formats: formatList(own), linked: formatList(linked) })
})
</script>

<template>
  <span v-if="lead" class="contents" data-testid="card-format-badges" :data-badge-style="effectiveStyle">
    <span v-if="isPillStyle" class="pointer-events-none absolute right-1.5 bottom-1.5 flex" aria-hidden="true">
      <span class="relative inline-flex" :class="effectiveStyle === 'underline' ? 'flex-col' : ''">
        <span v-if="effectiveStyle === 'pips'" class="absolute right-0 bottom-[calc(100%+2px)] flex gap-0.5" data-testid="card-format-pips">
          <span
            v-for="mark in indicators"
            :key="mark.key"
            class="box-border h-[5px] w-1.5 rounded-[1px]"
            :class="mark.linked ? 'border' : ''"
            :style="mark.linked ? { borderColor: mark.color } : { backgroundColor: mark.color }"
            :data-linked="mark.linked ? 'true' : undefined"
            data-testid="card-format-pip"
          />
        </span>
        <BookFormatChip
          :format-key="lead.key"
          :linked="lead.linked"
          variant="solid"
          class="gap-0.5 rounded-xs px-1.5 py-0.5 text-[8px] font-semibold tracking-widest opacity-90"
          :class="effectiveStyle === 'underline' ? 'h-[15px] rounded-b-none' : ''"
          :data-linked="lead.linked ? 'true' : undefined"
          data-testid="card-format-badge"
        />
        <span
          v-if="effectiveStyle === 'bubble'"
          class="absolute -top-[5px] -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-black px-[3px] text-[8px] font-semibold leading-none text-white ring-1 ring-inset ring-white/35"
          data-testid="card-format-badges-more"
          >{{ t('book.link.badges.more', { count: badges.length - 1 }) }}</span
        >
        <span v-if="effectiveStyle === 'underline'" class="flex h-[3px] overflow-hidden rounded-b-xs" data-testid="card-format-underline">
          <span
            v-for="mark in indicators"
            :key="mark.key"
            class="flex-1"
            :class="mark.linked ? 'h-px self-start' : ''"
            :style="{ backgroundColor: mark.color }"
            :data-linked="mark.linked ? 'true' : undefined"
            data-testid="card-format-segment"
          />
        </span>
      </span>
    </span>

    <!-- A circle leaves the cover corner empty, so it sits 1px closer to the edges than the rectangular badges to look aligned with them. -->
    <span v-else-if="effectiveStyle === 'seal'" class="pointer-events-none absolute right-[5px] bottom-[5px] flex" aria-hidden="true">
      <svg viewBox="0 0 40 40" class="size-5" data-testid="card-format-seal">
        <circle cx="20" cy="20" r="20" class="fill-black/70" />
        <g fill="none" transform="rotate(-90 20 20)">
          <circle
            v-for="arc in sealArcs"
            :key="arc.key"
            cx="20"
            cy="20"
            :r="SEAL_RADIUS"
            :stroke="arc.color"
            :stroke-width="arc.linked ? 2 : 4"
            :stroke-dasharray="arc.dasharray"
            :stroke-dashoffset="arc.dashoffset"
            :data-linked="arc.linked ? 'true' : undefined"
            data-testid="card-format-arc"
          />
        </g>
        <text x="20" y="25" text-anchor="middle" font-size="14" font-weight="600" class="fill-white" data-testid="card-format-seal-count">
          {{ badges.length }}
        </text>
      </svg>
    </span>

    <span v-else-if="effectiveStyle === 'dots'" class="pointer-events-none absolute right-1.5 bottom-1.5 flex" aria-hidden="true">
      <span class="flex h-4.5 items-center gap-[3px] rounded-full bg-black/60 px-2 ring-1 ring-inset ring-white/20" data-testid="card-format-dots">
        <span
          v-for="badge in dotBadges"
          :key="badge.key"
          class="size-1.5 shrink-0 rounded-full"
          :class="badge.linked ? 'border-[1.5px]' : ''"
          :style="badge.linked ? { borderColor: getFormatColor(badge.key) } : { backgroundColor: getFormatColor(badge.key) }"
          :data-linked="badge.linked ? 'true' : undefined"
          data-testid="card-format-dot"
        />
        <span v-if="dotOverflow > 0" class="ps-0.5 text-[8px] font-semibold leading-none text-white" data-testid="card-format-badges-more">{{
          t('book.link.badges.more', { count: dotOverflow })
        }}</span>
      </span>
    </span>

    <span
      v-else
      class="pointer-events-none absolute right-1.5 bottom-1.5 flex h-4.5 max-w-[70%] items-center gap-[3px] rounded-full bg-black/60 ps-0.5 pe-1 ring-1 ring-inset ring-white/20"
      aria-hidden="true"
      data-testid="card-format-kinds"
    >
      <BookFormatChip
        :format-key="lead.key"
        :linked="lead.linked"
        variant="solid"
        class="gap-0.5 rounded-full px-1 py-0.5 text-[8px] font-semibold leading-none tracking-widest"
        :data-linked="lead.linked ? 'true' : undefined"
        data-testid="card-format-badge"
      />
      <component
        :is="item.icon"
        v-for="item in kinds"
        :key="item.kind"
        class="size-2.5 shrink-0 text-white @max-[129px]:hidden"
        :data-kind="item.kind"
      />
      <span class="text-[8px] font-semibold leading-none text-white @max-[105px]:hidden" data-testid="card-format-badges-more">{{
        t('book.link.badges.more', { count: badges.length - 1 })
      }}</span>
    </span>

    <span class="sr-only" data-testid="card-format-badges-summary">{{ summary }}</span>
  </span>
</template>
