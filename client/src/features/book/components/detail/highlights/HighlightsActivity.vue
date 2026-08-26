<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AnnotationStats } from '@bookorbit/types'
import { formatDate as formatLocaleDate } from '@/i18n/formatters'

const props = defineProps<{ stats: AnnotationStats | null }>()

const { t } = useI18n()

const COLLAPSED = 5
const expanded = ref(false)

const activity = computed(() => props.stats?.activity ?? [])
const max = computed(() => Math.max(1, ...activity.value.map((day) => day.count)))
const rows = computed(() => (expanded.value ? activity.value : activity.value.slice(0, COLLAPSED)))

function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00`)
  return Number.isNaN(date.getTime()) ? day : formatLocaleDate(date, { month: 'short', day: 'numeric' })
}

function originStyle(origin: string) {
  return { background: `var(--pill-${origin})` }
}

function handleToggle() {
  expanded.value = !expanded.value
}
</script>

<template>
  <section
    v-if="activity.length > 0"
    class="flex flex-none flex-col overflow-hidden rounded-xl border border-border bg-card"
    :aria-label="t('book.detail.highlights.activity.title')"
  >
    <header class="flex h-[34px] flex-none items-center gap-2 border-b border-border px-3">
      <h2 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('book.detail.highlights.activity.title') }}</h2>
      <span class="ml-auto text-[11px] text-muted-foreground">{{ t('book.detail.highlights.activity.days', activity.length) }}</span>
    </header>
    <div class="px-3 pb-2 pt-1.5">
      <div v-for="day in rows" :key="day.day" class="grid h-6 grid-cols-[44px_minmax(0,1fr)_20px] items-center gap-2">
        <span class="text-[10.5px] leading-4 text-muted-foreground">{{ formatDay(day.day) }}</span>
        <span class="flex h-[7px] overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <i
            v-for="origin in day.origins"
            :key="origin.origin"
            class="block h-full"
            :style="{ width: `${(origin.count / max) * 100}%`, ...originStyle(origin.origin) }"
          />
        </span>
        <span class="text-right text-[10.5px] font-bold leading-4 tabular-nums text-foreground">{{ day.count }}</span>
      </div>
      <button
        v-if="activity.length > COLLAPSED"
        type="button"
        class="mt-1.5 inline-flex h-6 items-center rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click="handleToggle"
      >
        {{ expanded ? t('book.detail.highlights.activity.showFewer') : t('book.detail.highlights.activity.showAll', { count: activity.length }) }}
      </button>
    </div>
  </section>
</template>
