<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, Eye, Sparkles } from '@lucide/vue'
import type { AchievementCategoryGroup, AchievementHint, AchievementItem } from '@bookorbit/types'
import IcuCountText from '@/components/IcuCountText.vue'
import { formatNumber, formatPercent } from '@/i18n/formatters'
import type { DisplayItem } from '../types'
import { closestUnlocks, latestUnlocks, rarityTally, unlockedOnDay, type ClosestUnlock } from '../lib/achievement-showcase'
import { hintView } from '../lib/achievement-hints'
import { tierSetOf } from '../lib/achievement-sets'
import { awardDateLabel, awardDateLong, progressNumber, remainingCount } from '../lib/achievement-format'
import { medalRarity } from '../lib/medal-geometry'
import { RARITY_FILL_CLASS } from '../lib/rarity-classes'
import AchievementCoinStacks from './AchievementCoinStacks.vue'
import AchievementHintNote from './AchievementHintNote.vue'
import AchievementMedal from './AchievementMedal.vue'
import AchievementRarityChip from './AchievementRarityChip.vue'
import AchievementSparkles from './AchievementSparkles.vue'

const props = withDefaults(
  defineProps<{
    categories: AchievementCategoryGroup[]
    items: AchievementItem[]
    displayItems: DisplayItem[]
    totalEarned: number
    totalAvailable: number
    inProgressCount: number
    /** "How to get it" hints by achievement key; empty until they arrive. */
    hints?: ReadonlyMap<string, AchievementHint>
  }>(),
  { hints: () => new Map() },
)

const emit = defineEmits<{
  open: [id: string]
  showInProgress: []
}>()

const { t } = useI18n()

const recent = computed(() => latestUnlocks(props.items, 7))
const latest = computed(() => recent.value[0] ?? null)
const alsoNew = computed(() => recent.value.slice(1))
const newToday = computed(() => unlockedOnDay(props.items))
const tally = computed(() => rarityTally(props.items))
const closest = computed(() => closestUnlocks(props.displayItems, 4, isBlocked))
const lead = computed(() => closest.value[0] ?? null)
const leadHint = computed(() => (lead.value ? hintView(props.hints.get(lead.value.item.key)) : null))
const sharePercent = computed(() => formatPercent(props.totalAvailable ? props.totalEarned / props.totalAvailable : 0))

const latestRarity = computed(() => medalRarity(latest.value?.rarity))
const latestCategory = computed(() => props.categories.find((category) => category.key === latest.value?.category)?.label ?? '')

function isBlocked(item: AchievementItem): boolean {
  return props.hints.get(item.key)?.kind === 'unavailable'
}

function idOf(item: AchievementItem): string {
  return item.groupKey ?? item.key
}

function setLabel(entry: ClosestUnlock): string | null {
  const set = tierSetOf(entry.item.groupKey)
  return set && entry.item.tier ? t('achievements.showcase.tierOfSet', { tier: entry.item.tier, set: t(`achievements.sets.${set.label}`) }) : null
}

function toGoKey(entry: ClosestUnlock): string {
  const set = tierSetOf(entry.item.groupKey)
  return set ? `achievements.units.${set.unit}.toGo` : 'achievements.progress.toGo'
}

function progressText(entry: ClosestUnlock): string {
  const set = tierSetOf(entry.item.groupKey)
  const values = { current: progressNumber(entry.current), threshold: progressNumber(entry.threshold) }
  return set ? t(`achievements.units.${set.unit}.progress`, values) : t('achievements.progress.generic', values)
}

function handleOpenLatest() {
  if (latest.value) emit('open', idOf(latest.value))
}

function handleOpenLead() {
  if (lead.value) emit('open', idOf(lead.value.item))
}

function handleOpenItem(item: AchievementItem) {
  emit('open', idOf(item))
}

function handleShowInProgress() {
  emit('showInProgress')
}
</script>

<template>
  <section
    class="relative grid overflow-hidden rounded-2xl border border-primary/40 bg-card/30 shadow-sm md:max-[1599px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] min-[1600px]:grid-cols-[minmax(0,1.28fr)_minmax(0,0.98fr)_minmax(0,0.9fr)]"
    :aria-label="t('achievements.showcase.label')"
  >
    <span
      class="showcase-ambient pointer-events-none absolute inset-0"
      :style="{ '--ambient': `var(--medal-${latestRarity}-body)` }"
      aria-hidden="true"
    />

    <!-- Latest unlock -->
    <div class="relative min-w-0 px-5.5 pt-4 pb-4.5 max-md:px-4 max-md:pt-3.5">
      <div class="mb-1.5 flex h-5.5 items-center justify-between gap-2.5">
        <span class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">{{
          t('achievements.showcase.latest')
        }}</span>
        <span
          v-if="newToday > 0"
          class="inline-flex h-5 items-center gap-1.5 rounded-full border border-border bg-muted px-2 text-[11px] font-semibold text-foreground"
        >
          <Sparkles :size="12" aria-hidden="true" />{{ t('achievements.showcase.newToday', { count: newToday }) }}
        </span>
      </div>

      <template v-if="latest">
        <div class="flex items-center gap-5.5 max-md:gap-3.5">
          <button
            type="button"
            class="achievement-medal-trigger relative grid size-44 shrink-0 place-items-center rounded-full max-md:size-[118px]"
            :aria-label="t('achievements.showcase.openMedal', { name: latest.name })"
            @click="handleOpenLatest"
          >
            <span class="showcase-glow absolute inset-0 rounded-full" :style="{ '--glow': `var(--medal-${latestRarity}-body)` }" aria-hidden="true" />
            <AchievementSparkles :rarity="latestRarity" />
            <AchievementMedal :rarity="latestRarity" :icon="latest.iconName" :size="150" sheen="intro" glow class="max-md:size-[104px]" />
          </button>
          <div class="flex min-w-0 flex-col">
            <div class="flex flex-wrap items-center gap-1.5">
              <AchievementRarityChip :rarity="latestRarity" />
              <span
                v-if="latest.hidden"
                class="inline-flex h-5 items-center gap-1.5 rounded-full border border-border bg-muted px-2 text-[11px] font-semibold text-foreground"
              >
                <Eye :size="12" aria-hidden="true" />{{ t('achievements.showcase.secretRevealed') }}
              </span>
            </div>
            <h2
              class="mt-2.5 text-[30px] leading-[34px] font-extrabold tracking-[-0.025em] text-balance text-foreground max-md:mt-2 max-md:text-[23px] max-md:leading-[27px]"
            >
              {{ latest.name }}
            </h2>
            <p class="mt-1.5 text-sm text-muted-foreground max-md:text-[13px] max-md:leading-[18px]">{{ latest.description }}</p>
            <p class="mt-3 text-[12.5px] leading-4 text-muted-foreground max-md:mt-2 max-md:text-xs">
              {{ t('achievements.showcase.categoryAndDate', { category: latestCategory, date: awardDateLong(latest.awardedAt) }) }}
            </p>
          </div>
        </div>

        <div v-if="alsoNew.length" class="mt-3 border-t border-border/60 pt-2.5">
          <span class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">{{
            t('achievements.showcase.alsoNew')
          }}</span>
          <div
            class="mt-1.5 grid grid-cols-6 gap-1 max-md:-mx-4 max-md:grid-cols-[repeat(6,96px)] max-md:overflow-x-auto max-md:px-3 max-md:[scrollbar-width:none]"
          >
            <button
              v-for="item in alsoNew"
              :key="item.key"
              type="button"
              class="achievement-medal-trigger flex min-w-0 flex-col items-center gap-0.5 rounded-[10px] px-0.5 pt-1.5 pb-1 transition-colors hover:bg-(--shell-accent-wash)"
              :aria-label="t('achievements.showcase.openMedal', { name: item.name })"
              @click="handleOpenItem(item)"
            >
              <AchievementMedal :rarity="medalRarity(item.rarity)" :icon="item.iconName" :size="40" />
              <span class="mt-0.5 max-w-full truncate text-[11.5px] leading-[14px] font-semibold text-foreground">{{ item.name }}</span>
              <span class="text-[11px] leading-[13px] text-muted-foreground">{{ awardDateLabel(item.awardedAt) }}</span>
            </button>
          </div>
        </div>
      </template>

      <div v-else class="flex items-center gap-5 py-3">
        <AchievementMedal rarity="common" icon="trophy" state="locked" :size="104" />
        <div class="min-w-0">
          <h2 class="text-xl font-bold tracking-tight text-foreground">{{ t('achievements.showcase.emptyTitle') }}</h2>
          <p class="mt-1 text-sm text-muted-foreground">{{ t('achievements.showcase.emptyBody') }}</p>
        </div>
      </div>
    </div>

    <!-- Collection -->
    <div class="relative flex min-w-0 flex-col border-border/60 px-5.5 pt-4 pb-4.5 max-md:border-t max-md:px-4 max-md:pt-3.5 md:border-s">
      <div class="mb-1.5 flex h-5.5 items-center justify-between gap-2.5">
        <span class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">{{
          t('achievements.showcase.collection')
        }}</span>
        <span class="text-xs text-muted-foreground">{{ t('achievements.showcase.shareOfTiers', { percent: sharePercent }) }}</span>
      </div>
      <i18n-t
        keypath="achievements.showcase.tiersEarned"
        tag="p"
        scope="global"
        class="flex flex-wrap items-baseline gap-x-2.5 text-sm text-muted-foreground"
      >
        <template #earned>
          <span
            class="text-[58px] leading-[60px] font-extrabold tracking-[-0.04em] text-foreground tabular-nums max-md:text-[44px] max-md:leading-[46px]"
            >{{ formatNumber(totalEarned) }}</span
          >
        </template>
        <template #total>{{ formatNumber(totalAvailable) }}</template>
      </i18n-t>
      <AchievementCoinStacks :tally="tally" class="mt-auto pt-2" />
    </div>

    <!-- Closest to unlocking -->
    <div
      class="relative min-w-0 border-border/60 px-5.5 pt-4 pb-4.5 max-md:px-4 max-md:pt-3.5 max-[1599px]:col-span-full max-[1599px]:border-t min-[1600px]:border-s"
    >
      <div class="mb-1.5 flex h-5.5 items-center justify-between gap-2.5">
        <span class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">{{
          t('achievements.showcase.closest')
        }}</span>
        <button
          v-if="inProgressCount > 0"
          type="button"
          class="inline-flex items-center gap-1 text-[12.5px] font-medium text-foreground transition-colors hover:text-primary"
          @click="handleShowInProgress"
        >
          {{ t('achievements.showcase.allInProgress', { count: inProgressCount }) }}<ChevronRight :size="14" aria-hidden="true" />
        </button>
      </div>

      <div v-if="lead" class="md:max-[1599px]:grid md:max-[1599px]:grid-cols-2 md:max-[1599px]:gap-x-7">
        <div class="min-w-0">
          <button
            type="button"
            class="achievement-medal-trigger -mx-2 -ms-1 flex w-[calc(100%+0.75rem)] items-center gap-4 rounded-[14px] py-1.5 ps-1 pe-2 text-start transition-colors hover:bg-(--shell-accent-wash)"
            @click="handleOpenLead"
          >
            <AchievementMedal
              :rarity="medalRarity(lead.item.rarity)"
              :icon="lead.item.iconName"
              state="locked"
              :progress="lead.fraction"
              :size="96"
              class="max-md:size-20"
            />
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="flex flex-wrap items-center gap-2">
                <AchievementRarityChip :rarity="medalRarity(lead.item.rarity)" />
                <span v-if="setLabel(lead)" class="text-xs text-muted-foreground">{{ setLabel(lead) }}</span>
              </span>
              <span class="mt-1.5 text-lg leading-[23px] font-bold tracking-[-0.012em] text-foreground">{{ lead.item.name }}</span>
              <span class="text-[13px] leading-[18px] text-muted-foreground">{{ lead.item.description }}</span>
              <span class="mt-1 text-[13px] text-muted-foreground">
                <IcuCountText :count="remainingCount(lead.current, lead.threshold)" :keypath="toGoKey(lead)">
                  <template #count="{ value }">
                    <b class="me-0.5 text-[21px] leading-6 font-extrabold tracking-[-0.02em] text-foreground">{{ value }}</b>
                  </template>
                </IcuCountText>
              </span>
            </span>
          </button>
          <div class="my-2.5 flex items-center gap-2.5">
            <div
              class="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10"
              role="progressbar"
              :aria-valuenow="Math.round(lead.fraction * 100)"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="lead.item.name"
            >
              <div
                class="h-full rounded-full"
                :class="RARITY_FILL_CLASS[medalRarity(lead.item.rarity)]"
                :style="{ width: `${lead.fraction * 100}%` }"
              />
            </div>
            <span class="text-xs text-muted-foreground tabular-nums">{{ progressText(lead) }}</span>
          </div>
          <AchievementHintNote v-if="leadHint" :view="leadHint" variant="inline" class="mb-2.5" />
        </div>
        <ul class="flex flex-col border-t border-border/60 md:max-[1599px]:border-t-0">
          <li v-for="entry in closest.slice(1)" :key="entry.item.key" class="border-b border-border/60 last:border-b-0">
            <button
              type="button"
              class="achievement-medal-trigger flex w-full items-center gap-2.5 px-1.5 py-1.5 text-start transition-colors hover:bg-(--shell-accent-wash)"
              @click="handleOpenItem(entry.item)"
            >
              <AchievementMedal
                :rarity="medalRarity(entry.item.rarity)"
                :icon="entry.item.iconName"
                state="locked"
                :progress="entry.fraction"
                :size="34"
              />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-[13px] leading-[17px] font-semibold text-foreground">{{ entry.item.name }}</span>
                <span class="text-xs text-muted-foreground tabular-nums">{{ progressText(entry) }}</span>
              </span>
              <span class="text-[13px] font-bold text-foreground tabular-nums">{{ formatPercent(entry.fraction) }}</span>
            </button>
          </li>
        </ul>
      </div>
      <p v-else class="py-6 text-sm text-muted-foreground">{{ t('achievements.showcase.nothingCounting') }}</p>
    </div>
  </section>
</template>

<style scoped>
/* Static tints: painted once, never animated. */
.showcase-ambient {
  background: radial-gradient(60% 120% at 12% 0%, color-mix(in oklch, var(--ambient) 10%, transparent), transparent 70%);
}

.showcase-glow {
  background: radial-gradient(closest-side, color-mix(in oklch, var(--glow) 34%, transparent), transparent);
}
</style>
