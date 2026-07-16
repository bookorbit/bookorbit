<script setup lang="ts">
import { computed, ref, watch, nextTick, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, Columns3, EyeOff, Filter, Pin, PinOff, X } from '@lucide/vue'
import type { ColumnDef } from '@/features/book/composables/useTableColumns'

const props = defineProps<{
  column: ColumnDef
  position: { x: number; y: number } | null
  sortDir: 'asc' | 'desc' | null
  quickFilters?: { key: string; label: string }[]
}>()

const emit = defineEmits<{
  'sort-asc': []
  'sort-desc': []
  'clear-sort': []
  'hide-column': []
  'auto-fit': []
  'auto-fit-all': []
  'pin-left': []
  'pin-right': []
  unpin: []
  'quick-filter': [key: string]
  close: []
}>()

const { t } = useI18n()

const menuRef = ref<HTMLElement | null>(null)

const adjustedX = computed(() => {
  if (!props.position) return 0
  return Math.max(8, Math.min(props.position.x, window.innerWidth - 200 - 8))
})

const adjustedY = computed(() => {
  if (!props.position) return 0
  return Math.max(8, Math.min(props.position.y, window.innerHeight - 260 - 8))
})

function handleAction(action: () => void): void {
  action()
  emit('close')
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.position) {
    e.preventDefault()
    emit('close')
  }
}

watch(
  () => props.position,
  (pos) => {
    if (pos) {
      document.addEventListener('keydown', handleEscape)
      nextTick(() => {
        const first = menuRef.value?.querySelector('button') as HTMLElement | null
        first?.focus()
      })
    } else {
      document.removeEventListener('keydown', handleEscape)
    }
  },
)

function handleMenuKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const buttons = Array.from(menuRef.value?.querySelectorAll('button') ?? []) as HTMLElement[]
    const idx = buttons.indexOf(document.activeElement as HTMLElement)
    const next = buttons[idx + 1] ?? buttons[0]
    next?.focus()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    const buttons = Array.from(menuRef.value?.querySelectorAll('button') ?? []) as HTMLElement[]
    const idx = buttons.indexOf(document.activeElement as HTMLElement)
    const prev = buttons[idx - 1] ?? buttons[buttons.length - 1]
    prev?.focus()
  }
}

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscape)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="position" class="fixed inset-0 z-[99]" @click="emit('close')" @contextmenu.prevent="emit('close')" />
    <div
      v-if="position"
      ref="menuRef"
      class="fixed z-[100] min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-md"
      :style="{ top: `${adjustedY}px`, left: `${adjustedX}px` }"
      @keydown="handleMenuKeydown"
    >
      <template v-if="column.sortField">
        <button
          class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          :class="{ 'text-primary font-medium': sortDir === 'asc' }"
          @click="handleAction(() => emit('sort-asc'))"
        >
          <ArrowUp :size="14" />
          {{ t('book.table.header.sortAscending') }}
        </button>
        <button
          class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          :class="{ 'text-primary font-medium': sortDir === 'desc' }"
          @click="handleAction(() => emit('sort-desc'))"
        >
          <ArrowDown :size="14" />
          {{ t('book.table.header.sortDescending') }}
        </button>
        <button
          v-if="sortDir"
          class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          @click="handleAction(() => emit('clear-sort'))"
        >
          <X :size="14" />
          {{ t('book.table.header.clearSort') }}
        </button>
        <div class="my-1 h-px bg-border" />
      </template>

      <template v-if="quickFilters && quickFilters.length > 0">
        <button
          v-for="option in quickFilters"
          :key="option.key"
          class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          @click="handleAction(() => emit('quick-filter', option.key))"
        >
          <Filter :size="14" />
          {{ option.label }}
        </button>
        <div class="my-1 h-px bg-border" />
      </template>

      <button
        v-if="column.pinned === null"
        class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
        @click="handleAction(() => emit('hide-column'))"
      >
        <EyeOff :size="14" />
        {{ t('book.table.header.hideColumn') }}
      </button>

      <template v-if="column.pinned === null">
        <button
          class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          @click="handleAction(() => emit('pin-left'))"
        >
          <Pin :size="14" />
          {{ t('book.table.header.pinLeft') }}
        </button>
        <button
          class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          @click="handleAction(() => emit('pin-right'))"
        >
          <Pin :size="14" class="rotate-90" />
          {{ t('book.table.header.pinRight') }}
        </button>
      </template>
      <button
        v-else
        class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
        @click="handleAction(() => emit('unpin'))"
      >
        <PinOff :size="14" />
        {{ t('book.table.header.unpinColumn') }}
      </button>

      <div class="my-1 h-px bg-border" />

      <button
        class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
        @click="handleAction(() => emit('auto-fit'))"
      >
        <Columns3 :size="14" />
        {{ t('book.table.header.autoFitWidth') }}
      </button>
      <button
        class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
        @click="handleAction(() => emit('auto-fit-all'))"
      >
        <Columns3 :size="14" />
        {{ t('book.table.header.autoFitAllColumns') }}
      </button>
    </div>
  </Teleport>
</template>
