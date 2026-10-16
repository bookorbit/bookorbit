<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { Eye } from '@lucide/vue'
import type { AchievementHint, AchievementItem } from '@bookorbit/types'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import IcuCountText from '@/components/IcuCountText.vue'
import type { DisplayItem } from '../types'
import { isLockedSecret, medalFace, progressOf } from '../lib/achievement-display'
import { tierSetOf } from '../lib/achievement-sets'
import { awardDateLong, progressNumber, remainingCount } from '../lib/achievement-format'
import { hintView } from '../lib/achievement-hints'
import { momentBookId, momentOf } from '../lib/achievement-moments'
import { medalRarity } from '../lib/medal-geometry'
import { RARITY_FILL_CLASS, RARITY_TEXT_CLASS } from '../lib/rarity-classes'
import { useMomentText } from '../composables/useMomentText'
import AchievementBookCover from './AchievementBookCover.vue'
import AchievementHintNote from './AchievementHintNote.vue'
import AchievementMedal from './AchievementMedal.vue'
import AchievementRarityChip from './AchievementRarityChip.vue'
import AchievementSparkles from './AchievementSparkles.vue'
import { resolveLucideIcon } from '../utils/resolveLucideIcon'

const props = defineProps<{
  item: DisplayItem | null
  categoryLabel: string
  /** How to earn what is still locked, when the server has a hint for it. */
  hint?: AchievementHint | null
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()
const { momentText } = useMomentText()

/** Tailwind's `sm`. Below it the sheet rises from the bottom instead of sliding in from the side. */
const isNarrow = useMediaQuery('(max-width: 639px)')
const side = computed(() => (isNarrow.value ? ('bottom' as const) : ('right' as const)))
const sizeClass = computed(() => (isNarrow.value ? 'max-h-[90svh] rounded-t-2xl' : 'w-full sm:max-w-[452px]'))

const open = computed(() => props.item !== null)
// Keep the last medal and its hint on screen while the sheet slides closed.
const shown = shallowRef<DisplayItem | null>(props.item)
const shownHint = shallowRef<AchievementHint | null>(props.hint ?? null)
watch(
  () => [props.item, props.hint] as const,
  ([item, hint]) => {
    if (!item) return
    shown.value = item
    shownHint.value = hint ?? null
  },
)
const face = computed(() => (shown.value ? medalFace(shown.value) : null))
const tiered = computed(() => (shown.value?.type === 'tiered' ? shown.value : null))
const single = computed(() => (shown.value?.type === 'single' ? shown.value.achievement : null))
const set = computed(() => tierSetOf(tiered.value?.groupKey))
const name = computed(() => (face.value?.state === 'secret' ? t('achievements.secretAchievement') : (face.value?.item.name ?? '')))
const description = computed(() => (face.value?.state === 'secret' ? t('achievements.detail.secretHint') : (face.value?.item.description ?? '')))
const pips = computed(() => tiered.value?.tiers.map((tier) => ({ rarity: medalRarity(tier.rarity), earned: tier.earned })) ?? [])
const singleMoment = computed(() => (single.value ? momentOf(single.value) : null))
const singleBook = computed(() => (single.value ? momentBookId(single.value) : null))
const SingleIcon = computed(() => resolveLucideIcon(single.value?.iconName ?? 'trophy'))
const howTo = computed(() => hintView(shownHint.value))

function progressText(current: number, threshold: number): string {
  const values = { current: progressNumber(current), threshold: progressNumber(threshold) }
  return set.value ? t(`achievements.units.${set.value.unit}.progress`, values) : t('achievements.progress.generic', values)
}

function tierProgress(tier: AchievementItem): number {
  return progressOf({ ...tier, currentProgress: tiered.value?.currentProgress ?? 0 }) ?? 0
}

function tierMoment(tier: AchievementItem): string | null {
  const moment = momentOf(tier)
  return moment ? momentText(moment) : null
}

function handleOpenChange(value: boolean) {
  if (!value) emit('close')
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent :side="side" class="gap-0 overflow-y-auto p-0" :class="sizeClass">
      <div v-if="shown && face" class="flex flex-col gap-4.5 px-5.5 pt-3.5 pb-7 max-sm:px-4">
        <span class="flex h-8 items-center text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          {{ tiered ? t('achievements.detail.categoryTierSet', { category: categoryLabel }) : categoryLabel }}
        </span>

        <div class="relative -mt-1.5 grid h-[196px] place-items-center">
          <span
            class="detail-glow absolute inset-y-0 left-1/2 w-[220px] -translate-x-1/2 rounded-full"
            :class="{ 'opacity-35': face.state !== 'earned' }"
            :style="{ '--glow': `var(--medal-${face.rarity}-body)` }"
            aria-hidden="true"
          />
          <span class="achievement-medal-trigger relative grid size-[200px] place-items-center">
            <AchievementSparkles v-if="face.state === 'earned'" :rarity="face.rarity" />
            <AchievementMedal
              :rarity="face.rarity"
              :icon="face.item.iconName"
              :state="face.state"
              :progress="face.progress"
              :pips="pips"
              :size="176"
              :sheen="face.state === 'earned' ? 'intro' : 'none'"
              glow
            />
          </span>
        </div>

        <div class="flex flex-col items-center gap-0.5 text-center">
          <div class="flex flex-wrap justify-center gap-1.5">
            <AchievementRarityChip :rarity="face.rarity" />
            <span
              v-if="tiered"
              class="inline-flex h-5 items-center rounded-full border border-border bg-muted px-2 text-[11px] font-semibold text-foreground tabular-nums"
            >
              {{ t('achievements.detail.tierOf', { earned: tiered.earnedCount, total: tiered.totalTiers }) }}
            </span>
            <span
              v-if="single?.hidden && single.earned"
              class="inline-flex h-5 items-center gap-1.5 rounded-full border border-border bg-muted px-2 text-[11px] font-semibold text-foreground"
            >
              <Eye :size="12" aria-hidden="true" />{{ t('achievements.showcase.secretRevealed') }}
            </span>
          </div>
          <SheetTitle class="mt-2.5 text-[26px] leading-[31px] font-extrabold tracking-[-0.022em] text-foreground">{{ name }}</SheetTitle>
          <SheetDescription class="text-sm text-muted-foreground">{{ description }}</SheetDescription>
        </div>

        <!-- Three facts -->
        <dl class="grid grid-cols-3 rounded-xl border border-border bg-card/70">
          <template v-if="tiered">
            <div class="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
              <dt class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                {{ t('achievements.detail.current') }}
              </dt>
              <dd class="truncate text-sm font-semibold text-foreground">{{ tiered.highestEarnedTier?.name ?? t('achievements.detail.noneYet') }}</dd>
            </div>
            <div class="flex min-w-0 flex-col gap-0.5 border-s border-border px-3 py-2.5">
              <dt class="truncate text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                {{ set ? t(`achievements.sets.${set.label}`) : t('achievements.detail.progress') }}
              </dt>
              <dd class="truncate text-sm font-semibold text-foreground tabular-nums">
                {{
                  tiered.nextUnearned && tiered.currentProgress != null
                    ? progressText(tiered.currentProgress, tiered.nextUnearned.threshold ?? 0)
                    : t('achievements.detail.allTiersEarned')
                }}
              </dd>
            </div>
            <div class="flex min-w-0 flex-col gap-0.5 border-s border-border px-3 py-2.5">
              <dt class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                {{ t('achievements.detail.tiers') }}
              </dt>
              <dd class="text-sm font-semibold text-foreground tabular-nums">
                {{ t('achievements.detail.tierOf', { earned: tiered.earnedCount, total: tiered.totalTiers }) }}
              </dd>
            </div>
          </template>
          <template v-else-if="single">
            <div class="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
              <dt class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                {{ single.earned ? t('achievements.detail.earned') : t('achievements.detail.status') }}
              </dt>
              <dd class="truncate text-sm font-semibold text-foreground tabular-nums">
                <template v-if="single.earned">{{ awardDateLong(single.awardedAt) }}</template>
                <template v-else-if="isLockedSecret(single)">{{ t('achievements.detail.hidden') }}</template>
                <template v-else-if="single.threshold && single.currentProgress">{{
                  progressText(single.currentProgress, single.threshold)
                }}</template>
                <template v-else>{{ t('achievements.medal.notStarted') }}</template>
              </dd>
            </div>
            <div class="flex min-w-0 flex-col gap-0.5 border-s border-border px-3 py-2.5">
              <dt class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                {{ t('achievements.detail.rarity') }}
              </dt>
              <dd class="text-sm font-semibold" :class="RARITY_TEXT_CLASS[face.rarity]">{{ t(`achievements.rarity.${face.rarity}`) }}</dd>
            </div>
            <div class="flex min-w-0 flex-col gap-0.5 border-s border-border px-3 py-2.5">
              <dt class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                {{ t('achievements.detail.category') }}
              </dt>
              <dd class="truncate text-sm font-semibold text-foreground">{{ categoryLabel }}</dd>
            </div>
          </template>
        </dl>

        <!-- A single achievement in progress: how far along it is -->
        <section v-if="single && !single.earned && single.threshold && single.currentProgress" class="flex flex-col gap-2.5">
          <h3 class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            {{ t('achievements.detail.progress') }}
          </h3>
          <div class="flex flex-col gap-2 rounded-xl border border-border bg-card/70 p-3">
            <span class="text-sm text-muted-foreground">
              <IcuCountText :count="remainingCount(single.currentProgress, single.threshold)" keypath="achievements.progress.toGo">
                <template #count="{ value }">
                  <b class="text-lg font-extrabold text-foreground">{{ value }}</b>
                </template>
              </IcuCountText>
            </span>
            <span class="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
              <span class="block h-full rounded-full" :class="RARITY_FILL_CLASS[face.rarity]" :style="{ width: `${(face.progress ?? 0) * 100}%` }" />
            </span>
          </div>
        </section>

        <!-- What is still locked: how to earn it from this library and reading history -->
        <section v-if="howTo" class="flex flex-col gap-2.5">
          <h3 class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            {{ t('achievements.hints.howToGetIt') }}
          </h3>
          <AchievementHintNote :view="howTo" />
        </section>

        <!-- A tier set: every tier, with the book or number behind the ones already earned -->
        <section v-if="tiered" class="flex flex-col gap-2.5" :aria-label="t('achievements.detail.theSet')">
          <h3 class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            {{ t('achievements.detail.theSet') }}
          </h3>
          <ol class="flex flex-col rounded-xl border border-border bg-card/70">
            <li v-for="tier in tiered.tiers" :key="tier.key" class="flex items-start gap-3 border-border p-3 not-first:border-t">
              <AchievementMedal
                :rarity="medalRarity(tier.rarity)"
                :icon="tier.iconName"
                :state="tier.earned ? 'earned' : 'locked'"
                :progress="tier.earned ? null : tierProgress(tier)"
                :size="40"
                sheen="none"
              />
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm leading-[18px] font-semibold text-foreground">{{ tier.name }}</span>
                  <AchievementRarityChip :rarity="medalRarity(tier.rarity)" />
                </div>
                <span class="text-[12.5px] leading-[17px] text-muted-foreground">{{ tier.description }}</span>
                <RouterLink
                  v-if="tier.earned && tierMoment(tier) && momentBookId(tier)"
                  :to="`/book/${momentBookId(tier)}`"
                  class="mt-1 flex items-center gap-1.5 text-[12.5px] leading-[17px] text-foreground hover:text-primary"
                >
                  <AchievementBookCover :book-id="momentBookId(tier)!" class="w-[18px]" />{{ tierMoment(tier) }}
                </RouterLink>
                <span v-else-if="tier.earned && tierMoment(tier)" class="mt-1 text-[12.5px] leading-[17px] text-foreground">{{
                  tierMoment(tier)
                }}</span>
              </div>
              <span v-if="tier.earned" class="text-xs leading-[18px] whitespace-nowrap text-muted-foreground tabular-nums">{{
                awardDateLong(tier.awardedAt)
              }}</span>
              <span v-else class="flex w-[92px] shrink-0 flex-col items-end gap-1.5">
                <span class="text-xs text-muted-foreground tabular-nums">
                  {{
                    t('achievements.progress.generic', {
                      current: progressNumber(tiered.currentProgress ?? 0),
                      threshold: progressNumber(tier.threshold ?? 0),
                    })
                  }}
                </span>
                <span class="h-[5px] w-full overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
                  <span
                    class="block h-full rounded-full"
                    :class="RARITY_FILL_CLASS[medalRarity(tier.rarity)]"
                    :style="{ width: `${tierProgress(tier) * 100}%` }"
                  />
                </span>
              </span>
            </li>
          </ol>
        </section>

        <!-- A single achievement: the moment it unlocked -->
        <section v-else-if="single && single.earned && singleMoment" class="flex flex-col gap-2.5">
          <h3 class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            {{ t('achievements.detail.theMoment') }}
          </h3>
          <component
            :is="singleBook ? RouterLink : 'div'"
            :to="singleBook ? `/book/${singleBook}` : undefined"
            class="flex items-center gap-3 rounded-xl border border-border bg-card/70 p-3"
            :class="{ 'transition-colors hover:border-primary/40': singleBook }"
          >
            <AchievementBookCover v-if="singleBook" :book-id="singleBook" class="w-11" />
            <span
              v-else
              class="grid size-11 shrink-0 place-items-center rounded-[10px] border border-border bg-muted text-foreground"
              aria-hidden="true"
            >
              <component :is="SingleIcon" :size="18" />
            </span>
            <span class="text-sm leading-[19px] font-semibold text-foreground">{{ momentText(singleMoment) }}</span>
          </component>
        </section>
      </div>
    </SheetContent>
  </Sheet>
</template>

<style scoped>
.detail-glow {
  background: radial-gradient(closest-side, color-mix(in oklch, var(--glow) 34%, transparent), transparent);
}
</style>
