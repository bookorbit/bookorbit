<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Award } from '@lucide/vue'
import type { RecordEntry } from '../lib/achievement-moments'
import { medalRarity } from '../lib/medal-geometry'
import { useMomentText } from '../composables/useMomentText'
import AchievementMedal from './AchievementMedal.vue'

defineProps<{
  records: RecordEntry[]
}>()

const emit = defineEmits<{
  open: [id: string]
}>()

const { t } = useI18n()
const { momentText } = useMomentText()

function handleOpen(entry: RecordEntry) {
  emit('open', entry.item.groupKey ?? entry.item.key)
}
</script>

<template>
  <section class="flex min-w-0 flex-col rounded-2xl border border-primary/40 bg-card/30 shadow-sm" aria-labelledby="achievements-records-title">
    <div class="flex items-center justify-between gap-3 px-5 pt-3.5 pb-1 max-md:px-3.5 max-md:pt-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <span class="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-muted/50 text-foreground" aria-hidden="true">
          <Award :size="15" />
        </span>
        <h2 id="achievements-records-title" class="text-[15px] leading-5 font-bold tracking-[-0.015em] text-foreground">
          {{ t('achievements.records.title') }}
        </h2>
      </div>
      <span class="truncate text-xs text-muted-foreground max-md:hidden">{{ t('achievements.records.subtitle') }}</span>
    </div>
    <div class="grid flex-1 grid-cols-5 items-stretch px-3.5 pt-2 pb-3.5 max-lg:grid-cols-3 max-md:grid-cols-2 max-md:px-2 max-md:pb-2.5">
      <button
        v-for="entry in records"
        :key="entry.item.key"
        type="button"
        class="achievement-medal-trigger flex min-w-0 flex-col items-start justify-end gap-0.5 rounded-xl px-3 pt-3 pb-2.5 text-start transition-colors hover:bg-(--shell-accent-wash)"
        @click="handleOpen(entry)"
      >
        <AchievementMedal :rarity="medalRarity(entry.item.rarity)" :icon="entry.item.iconName" :size="40" class="mb-auto" />
        <span
          class="mt-3.5 text-[32px] leading-9 font-extrabold tracking-[-0.03em] whitespace-nowrap text-foreground tabular-nums max-md:text-[26px] max-md:leading-[30px]"
        >
          {{ momentText(entry.value) }}
        </span>
        <span class="text-[13px] leading-[17px] font-medium text-foreground">{{ momentText(entry.label) }}</span>
        <span class="text-[11.5px] leading-[15px] text-muted-foreground">{{ entry.item.name }}</span>
      </button>
    </div>
  </section>
</template>
