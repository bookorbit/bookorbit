<script setup lang="ts">
import { computed, ref, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Target, Pencil } from 'lucide-vue-next'

import { readCssColor } from '@/lib/echarts'
import { useReadingGoalWidget } from '../../composables/useReadingGoalWidget'
import { useDashboardWidgets } from '../../composables/useDashboardWidgets'

const { data, loading, error, refresh } = useReadingGoalWidget()
const { readingGoal, saveReadingGoal } = useDashboardWidgets()

const editing = ref(false)
const goalInput = ref('')
const saving = ref(false)

const hasGoal = computed(() => data.value?.goalBooks != null && data.value.goalBooks > 0)
const percentage = computed(() => {
  if (!data.value || !hasGoal.value) return 0
  return Math.min(100, Math.round((data.value.completedBooks / data.value.goalBooks!) * 100))
})

const option = shallowRef({})

watchEffect(() => {
  if (!data.value || !hasGoal.value) {
    option.value = {}
    return
  }

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
          { value: Math.min(data.value.completedBooks, data.value.goalBooks), name: 'Completed' },
          {
            value: Math.max(data.value.goalBooks - data.value.completedBooks, 0),
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
      <span class="text-[15px] font-semibold text-foreground">Reading Goal {{ data?.year ?? '' }}</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 items-center justify-center">
      <div class="h-20 w-20 animate-pulse rounded-full bg-muted" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">Failed to load</div>

    <!-- No goal set -->
    <template v-else-if="!hasGoal && !editing">
      <div class="flex flex-1 flex-col items-center justify-center gap-2">
        <p class="text-center text-xs text-muted-foreground">Set a reading goal to track your progress</p>
        <button
          class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          @click="handleStartEditing"
        >
          Set goal
        </button>
      </div>
    </template>

    <!-- Editing goal -->
    <template v-else-if="editing">
      <div class="flex flex-1 flex-col items-center justify-center gap-2">
        <label class="text-xs text-muted-foreground">Books per year</label>
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
            Cancel
          </button>
          <button
            class="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            :disabled="saving"
            @click="handleSaveGoal"
          >
            Save
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
          <p class="mt-1 text-[11px] leading-none text-muted-foreground">of {{ data?.goalBooks ?? 0 }}</p>
        </div>
      </div>
      <div class="flex items-center justify-between">
        <p class="text-xs text-muted-foreground">{{ percentage }}% complete</p>
        <button
          class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-muted-foreground"
          title="Edit goal"
          @click="handleStartEditing"
        >
          <Pencil :size="12.5" />
        </button>
      </div>
    </template>
  </div>
</template>
