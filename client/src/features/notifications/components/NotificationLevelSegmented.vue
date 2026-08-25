<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bell, BellOff, TriangleAlert } from '@lucide/vue'
import { availableLevelsForCategory, type NotificationCategory, type NotificationLevel as Level } from '@bookorbit/types'

const { t } = useI18n()

const props = defineProps<{ modelValue: Level; category: NotificationCategory; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: Level] }>()

const ICONS = { off: BellOff, problems: TriangleAlert, all: Bell } as const

// A category with no warning or error member cannot express "problems only", so it renders as
// Off/All rather than offering a third option that silently means the same as Off.
const options = computed(() =>
  availableLevelsForCategory(props.category).map((value) => ({
    value,
    icon: ICONS[value],
    short: t(`notifications.preferences.levels.${value}.short`),
    description: t(`notifications.preferences.levels.${value}.description`),
  })),
)

function select(value: Level) {
  emit('update:modelValue', value)
}
</script>

<template>
  <div role="radiogroup" :aria-label="props.label" class="inline-flex min-w-0 shrink-0 gap-0.5 rounded-md border border-input bg-muted p-0.5">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="props.modelValue === option.value"
      :aria-label="`${props.label}: ${option.short}. ${option.description}`"
      :title="option.description"
      class="inline-flex h-7 min-w-0 items-center gap-1.5 rounded px-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      :class="
        props.modelValue === option.value
          ? 'bg-background font-semibold text-foreground shadow-xs'
          : 'font-medium text-muted-foreground hover:text-foreground'
      "
      @click="select(option.value)"
    >
      <component :is="option.icon" :size="13" class="shrink-0" aria-hidden="true" />
      <span class="truncate">{{ option.short }}</span>
    </button>
  </div>
</template>
