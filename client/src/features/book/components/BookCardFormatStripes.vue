<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Headphones, Link2 } from '@lucide/vue'
import { isReadAlongFormatKey, type BookCardLinkInfo } from '@bookorbit/types'
import { formatKeyCode } from '../lib/book-formats'
import { getFormatColor } from '../lib/format-colors'
import { cardFormatBadges } from '../lib/book-link'

/**
 * How many formats fit at each cover width; past that the last slot becomes a "+N" count. Each
 * tier's classes are written out in full so Tailwind sees them; the container is the cover frame.
 */
const TIERS = [
  { max: 1, showFrom: 'inline-flex', onlyIn: 'inline-flex @min-[130px]:hidden' },
  { max: 2, showFrom: 'hidden @min-[130px]:inline-flex', onlyIn: 'hidden @min-[130px]:inline-flex @min-[170px]:hidden' },
  { max: 3, showFrom: 'hidden @min-[170px]:inline-flex', onlyIn: 'hidden @min-[170px]:inline-flex @min-[230px]:hidden' },
  { max: 4, showFrom: 'hidden @min-[230px]:inline-flex', onlyIn: 'hidden @min-[230px]:inline-flex' },
] as const

const props = withDefaults(
  defineProps<{
    /** The card's own format keys, the one its media view shows first. */
    ownKeys: string[]
    linked?: BookCardLinkInfo | null
  }>(),
  { linked: null },
)

const { t } = useI18n()

const badges = computed(() => cardFormatBadges(props.ownKeys, props.linked))
const visibleCounts = computed(() => TIERS.map(({ max }) => (badges.value.length > max ? Math.max(1, max - 1) : badges.value.length)))

const stripes = computed(() => {
  const counts = visibleCounts.value
  return badges.value.flatMap((badge, index) => {
    const tier = counts.findIndex((count) => index < count)
    if (tier < 0) return []
    return [
      {
        key: badge.key,
        code: formatKeyCode(badge.key),
        color: getFormatColor(badge.key),
        linked: badge.linked,
        readAlong: isReadAlongFormatKey(badge.key),
        visibility: TIERS[tier]!.showFrom,
      },
    ]
  })
})

const overflows = computed(() =>
  visibleCounts.value.flatMap((count, tier) => {
    const hidden = badges.value.length - count
    return hidden > 0 ? [{ tier, label: t('book.link.badges.more', { count: hidden }), visibility: TIERS[tier]!.onlyIn }] : []
  }),
)
</script>

<template>
  <span
    v-if="badges.length > 0"
    class="card-format-stripes flex min-w-0 text-[clamp(8px,4.8cqi,10px)] leading-none font-bold tracking-[0.09em] text-cover-chip-foreground uppercase text-shadow-[0_1px_2px_rgb(0_0_0/0.5)]"
    aria-hidden="true"
    data-testid="card-format-stripes"
  >
    <!-- Anything that does not fit wraps to a clipped second line instead of being cut mid-code. The
         padding keeps the text shadow inside the clip and the negative margin gives the height back. -->
    <span
      class="-my-[3px] flex h-[calc(1.15em+6px)] min-w-0 flex-1 flex-wrap content-start items-center gap-x-[clamp(6px,4cqi,10px)] gap-y-3 overflow-hidden py-[3px]"
    >
      <span
        v-for="stripe in stripes"
        :key="stripe.key"
        class="shrink-0 items-center gap-[0.4em]"
        :class="stripe.visibility"
        :data-linked="stripe.linked ? 'true' : undefined"
        data-testid="card-format-stripe"
      >
        <span class="h-[1.15em] w-[2.5px] shrink-0 rounded-[1px] shadow-[0_0_0_0.5px_rgb(0_0_0/0.25)]" :style="{ backgroundColor: stripe.color }" />
        <Link2 v-if="stripe.linked" class="size-[1.1em] shrink-0" :stroke-width="2.5" data-testid="card-format-stripe-linked" />
        <span>{{ stripe.code }}</span>
        <Headphones v-if="stripe.readAlong" class="size-[1.1em] shrink-0" :stroke-width="2.5" />
      </span>
      <span
        v-for="overflow in overflows"
        :key="overflow.tier"
        class="shrink-0 tracking-[0.02em] text-cover-chip-muted-foreground"
        :class="overflow.visibility"
        data-testid="card-format-stripes-more"
        >{{ overflow.label }}</span
      >
    </span>
  </span>
</template>
