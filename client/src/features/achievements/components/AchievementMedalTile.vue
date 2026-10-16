<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DisplayItem } from '../types'
import { bucketOf, displayId, medalFace } from '../lib/achievement-display'
import { tierSetOf } from '../lib/achievement-sets'
import { medalRarity } from '../lib/medal-geometry'
import { awardDateLabel, progressNumber } from '../lib/achievement-format'
import { useMedalTilt } from '../composables/useMedalTilt'
import AchievementMedal from './AchievementMedal.vue'

const props = defineProps<{
  item: DisplayItem
}>()

const emit = defineEmits<{
  open: [id: string]
}>()

const { t } = useI18n()
const { handlePointerMove, handlePointerLeave } = useMedalTilt()

const face = computed(() => medalFace(props.item))
const name = computed(() => (face.value.state === 'secret' ? t('achievements.secretAchievement') : face.value.item.name))
const pips = computed(() =>
  props.item.type === 'tiered' ? props.item.tiers.map((tier) => ({ rarity: medalRarity(tier.rarity), earned: tier.earned })) : [],
)

/** The progress phrase in the set's own unit ("47 / 100 books"), or bare numbers for a set this build does not know. */
const progressText = computed<string | null>(() => {
  const item = props.item
  if (item.type === 'tiered') {
    const next = item.nextUnearned
    if (!next?.threshold || item.currentProgress == null) return null
    const set = tierSetOf(item.groupKey)
    const values = { current: progressNumber(item.currentProgress), threshold: progressNumber(next.threshold) }
    return set ? t(`achievements.units.${set.unit}.progress`, values) : t('achievements.progress.generic', values)
  }
  const { achievement } = item
  if (achievement.earned || !achievement.threshold || !achievement.currentProgress) return null
  return t('achievements.progress.generic', {
    current: progressNumber(achievement.currentProgress),
    threshold: progressNumber(achievement.threshold),
  })
})

/** Phones have no room for the unit, so a set's progress reads as bare numbers there. */
const shortStatus = computed<string>(() => {
  const item = props.item
  if (item.type !== 'tiered' || !item.nextUnearned?.threshold || item.currentProgress == null) return statusText.value
  return t('achievements.progress.generic', { current: progressNumber(item.currentProgress), threshold: progressNumber(item.nextUnearned.threshold) })
})

const tierText = computed<string | null>(() => {
  const item = props.item
  if (item.type !== 'tiered') return null
  if (item.earnedCount === item.totalTiers) return t('achievements.medal.allTiers', { count: item.totalTiers })
  return item.earnedCount > 0 ? t('achievements.medal.tier', { tier: item.earnedCount }) : null
})

const statusText = computed<string>(() => {
  const item = props.item
  if (item.type === 'tiered') return progressText.value ?? ''
  const { achievement } = item
  if (achievement.earned) return awardDateLabel(achievement.awardedAt)
  if (face.value.state === 'secret') return t('achievements.medal.keepReading')
  return progressText.value ?? t('achievements.medal.notStarted')
})

const ariaLabel = computed(() =>
  t('achievements.medal.label', {
    name: name.value,
    rarity: t(`achievements.rarity.${face.value.rarity}`),
    status: [tierText.value, statusText.value].filter(Boolean).join(', '),
  }),
)

function handleClick() {
  emit('open', displayId(props.item))
}
</script>

<template>
  <button
    type="button"
    class="achievement-medal-trigger medal-tile group relative flex min-w-0 flex-col items-center rounded-xl px-2 pt-1.5 pb-3 transition-colors hover:bg-(--shell-accent-wash) focus-visible:outline-2 focus-visible:outline-ring"
    :data-bucket="bucketOf(item)"
    :aria-label="ariaLabel"
    @click="handleClick"
    @pointermove="handlePointerMove"
    @pointerleave="handlePointerLeave"
  >
    <span class="medal-tile__stand relative flex h-[104px] w-full items-end justify-center pb-1 max-md:h-[82px]">
      <span class="medal-tile__shadow" :class="{ 'opacity-35': face.state !== 'earned' }" aria-hidden="true" />
      <AchievementMedal
        :rarity="face.rarity"
        :icon="face.item.iconName"
        :state="face.state"
        :progress="face.progress"
        :pips="pips"
        :size="84"
        class="max-md:size-[68px]"
      />
    </span>
    <span class="mt-2.5 flex max-w-full flex-col items-center gap-px text-center">
      <span class="line-clamp-2 text-[13px] leading-[17px] font-semibold text-foreground max-md:text-[12.5px] max-md:leading-4">{{ name }}</span>
      <span class="flex max-w-full items-center gap-1 text-[11.5px] leading-[15px] text-muted-foreground tabular-nums max-md:text-[11px]">
        <span v-if="tierText" class="shrink-0" :class="{ 'max-md:hidden': !!statusText }">{{ tierText }}</span>
        <span v-if="tierText && statusText" class="max-md:hidden" aria-hidden="true">·</span>
        <span v-if="statusText" class="truncate max-md:hidden">{{ statusText }}</span>
        <span v-if="shortStatus" class="truncate md:hidden">{{ shortStatus }}</span>
      </span>
    </span>
  </button>
</template>

<style scoped>
/* The shelf: one hairline under every medal, running edge to edge across the row. */
.medal-tile__stand::after {
  content: '';
  position: absolute;
  inset-inline: -0.5rem;
  bottom: 0;
  height: 1px;
  background: var(--shelf-line);
  box-shadow: 0 1px 0 color-mix(in oklch, var(--background) 60%, transparent);
}

.medal-tile__shadow {
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 70px;
  height: 10px;
  transform: translate(-50%, 50%);
  background: radial-gradient(closest-side, var(--medal-shadow), transparent);
  pointer-events: none;
}
</style>
