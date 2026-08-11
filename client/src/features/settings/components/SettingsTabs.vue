<script setup lang="ts" generic="T extends string">
import { nextTick, ref, watch } from 'vue'

interface SettingsTabItem {
  id: T
  label: string
  controls?: string
}

const props = withDefaults(
  defineProps<{
    tabs: readonly SettingsTabItem[]
    activeTab: T
    variant?: 'page' | 'section'
    testIdPrefix?: string
    idPrefix?: string
  }>(),
  { variant: 'page' },
)

const emit = defineEmits<{
  select: [tab: T]
}>()

const container = ref<HTMLElement | null>(null)

async function revealActiveTab(): Promise<void> {
  await nextTick()
  const tab = container.value?.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"]')
  if (!tab || !container.value || container.value.scrollWidth <= container.value.clientWidth) return

  const containerRect = container.value.getBoundingClientRect()
  const tabRect = tab.getBoundingClientRect()
  if (tabRect.left < containerRect.left || tabRect.right > containerRect.right) {
    container.value.scrollLeft += tabRect.left - containerRect.left
  }
}

watch(() => props.activeTab, revealActiveTab, { immediate: true })

function handleSelect(tab: T): void {
  emit('select', tab)
}
</script>

<template>
  <div
    ref="container"
    :role="variant === 'page' ? 'tablist' : undefined"
    :class="
      variant === 'section'
        ? 'flex h-11 shrink-0 snap-x snap-mandatory items-stretch overflow-x-auto border-b px-4 scrollbar-none md:snap-none'
        : 'sticky top-0 z-20 mb-5 flex snap-x gap-1 overflow-x-auto border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:static md:mb-6 md:overflow-visible'
    "
  >
    <button
      v-for="tab in tabs"
      :key="tab.id"
      :role="variant === 'page' ? 'tab' : undefined"
      :id="idPrefix ? `${idPrefix}-${tab.id}-tab` : undefined"
      :aria-selected="variant === 'page' ? activeTab === tab.id : undefined"
      :aria-pressed="variant === 'page' ? activeTab === tab.id : undefined"
      :aria-current="variant === 'section' && activeTab === tab.id ? 'page' : undefined"
      :aria-controls="variant === 'page' ? tab.controls : undefined"
      :data-testid="testIdPrefix ? `${testIdPrefix}-${tab.id}` : undefined"
      :class="[
        variant === 'section'
          ? 'h-full shrink-0 snap-start whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors'
          : '-mb-px shrink-0 snap-start border-b-2 px-3 py-3 text-sm font-medium transition-colors md:py-2',
        activeTab === tab.id
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
      ]"
      @click="handleSelect(tab.id)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>
