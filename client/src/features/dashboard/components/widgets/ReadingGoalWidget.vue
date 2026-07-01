<script setup lang="ts">
import { computed, ref, shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { Target, Pencil } from '@lucide/vue'

import { readCssColor } from '@/lib/echarts'
import { useReadingGoalWidget } from '../../composables/useReadingGoalWidget'
import { useDashboardWidgets } from '../../composables/useDashboardWidgets'

const { data, loading, error, refresh } = useReadingGoalWidget()
const { readingGoal, saveReadingGoal } = useDashboardWidgets()
const { t } = useI18n()

const editing = ref(false)
const goalInput = ref('')
const saving = ref(false)

const goalBooks = computed(() => data.value?.goalBooks ?? null)
const hasGoal = computed(() => goalBooks.value != null && goalBooks.value > 0)
const percentage = computed(() => {
  const goal = goalBooks.value
  if (!data.value || goal == null || goal <= 0) return 0
  return Math.min(100, Math.round((data.value.completedBooks / goal) * 100))
})

const option = shallowRef({})

watchEffect(() => {
  if (!data.value || !hasGoal.value || goalBooks.value == null) {
    option.value = {}
    return
  }

  const goal = goalBooks.value

  option.value = {
    tooltip: { show: false },
    series: [
      {
        type: 'pie',
        radius: ['78%', '100%'],
        center: ['50%', '50%'],
        clockwise: true,
        startAngle: 90,
        avoidLabelOverlap: true,
        silent: true,
        emphasis: { disabled: true },
        label: { show: false },
        labelLine: { show: false },
        data: [
          { value: Math.min(data.value.completedBooks, goal), name: 'Completed' },
          {
            value: Math.max(goal - data.value.completedBooks, 0),
            name: 'Remaining',
            itemStyle: { color: readCssColor('--muted') },
          },
        ],
      },
    ],
  }
})

function handleStartEditing() {
  goalInput.value = String(readingGoal.value ?? 12)
  editing.value = true
}

async function handleSaveGoal() {
  const parsed = parseInt(goalInput.value, 10)
  if (isNaN(parsed) || parsed < 1 || parsed > 999) return
  saving.value = true
  try {
    await saveReadingGoal(parsed)
    editing.value = false
    await refresh()
  } finally {
    saving.value = false
  }
}

function handleCancelEdit() {
  editing.value = false
}
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="mb-3 flex items-center gap-2 self-start">
      <Target :size="16" class="text-primary/90" />
      <span class="text-[15px] font-semibold text-foreground">{{ t('dashboard.widgets.readingGoal.title', { year: data?.year ?? '' }) }}</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 items-center justify-center">
      <div class="h-20 w-20 animate-pulse rounded-full bg-muted" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {{ t('dashboard.common.failedToLoad') }}
    </div>

    <!-- No goal set -->
    <template v-else-if="!hasGoal && !editing">
      <div class="flex flex-1 flex-col items-center justify-center gap-2">
        <p class="text-center text-xs text-muted-foreground">{{ t('dashboard.widgets.readingGoal.setGoalPrompt') }}</p>
        <button
          class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          @click="handleStartEditing"
        >
          {{ t('dashboard.widgets.readingGoal.setGoal') }}
        </button>
      </div>
    </template>

    <!-- Editing goal -->
    <template v-else-if="editing">
      <div class="flex flex-1 flex-col items-center justify-center gap-2">
        <label class="text-xs text-muted-foreground">{{ t('dashboard.widgets.readingGoal.booksPerYear') }}</label>
        <input
          v-model="goalInput"
          type="number"
          min="1"
          max="999"
          class="h-8 w-20 rounded-md border border-input bg-background px-2 text-center text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div class="flex gap-1.5">
          <button
            class="rounded-md border border-input px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
            :disabled="saving"
            @click="handleCancelEdit"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            :disabled="saving"
            @click="handleSaveGoal"
          >
            {{ t('common.save') }}
          </button>
        </div>
      </div>
    </template>

    <!-- Goal gauge -->
    <template v-else>
      <div class="relative flex flex-1 items-center justify-center">
        <VChart :option="option" autoresize style="width: 124px; height: 124px" />
        <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p class="text-xl leading-none font-semibold tabular-nums text-foreground">{{ data?.completedBooks ?? 0 }}</p>
          <p class="mt-1 text-[11px] leading-none text-muted-foreground">
            {{ t('dashboard.widgets.readingGoal.ofGoal', { goal: data?.goalBooks ?? 0 }) }}
          </p>
        </div>
      </div>
      <div class="flex items-center justify-between">
        <p class="text-xs text-muted-foreground">{{ t('dashboard.widgets.readingGoal.percentComplete', { percentage }) }}</p>
        <button
          class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-muted-foreground"
          :title="t('dashboard.widgets.readingGoal.editGoal')"
          @click="handleStartEditing"
        >
          <Pencil :size="12.5" />
        </button>
      </div>
    </template>
  </div>
</template>
