<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { ExternalLink } from '@lucide/vue'

const props = defineProps<{
  value: string | null
  isActive: boolean
  isReadOnly?: boolean
  searchFn?: (q: string) => Promise<string[]>
  openLink?: string | null
  openLinkLabel?: string | null
  alwaysShowOpenLinkIcon?: boolean
}>()

const emit = defineEmits<{
  activate: []
  save: [value: string | null]
  cancel: []
  navigate: [direction: 'next' | 'prev' | 'rowUp' | 'rowDown']
}>()

const { t } = useI18n()

const inputRef = ref<HTMLInputElement | null>(null)
const draft = ref<string>(props.value ?? '')
const suggestions = ref<string[]>([])
const showDropdown = ref(false)
const activeIndex = ref(-1)
const dropdownStyle = ref<Record<string, string>>({})
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let blurTimer: ReturnType<typeof setTimeout> | null = null
let latestRequestId = 0
let wasCancelled = false

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (blurTimer) clearTimeout(blurTimer)
})

function computeDropdownStyle() {
  if (!inputRef.value) return
  const rect = inputRef.value.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom
  const maxH = 160
  if (spaceBelow < maxH && rect.top > maxH) {
    dropdownStyle.value = {
      position: 'fixed',
      bottom: `${window.innerHeight - rect.top}px`,
      left: `${rect.left}px`,
      width: `${Math.max(rect.width, 128)}px`,
      zIndex: '9999',
    }
  } else {
    dropdownStyle.value = {
      position: 'fixed',
      top: `${rect.bottom + 2}px`,
      left: `${rect.left}px`,
      width: `${Math.max(rect.width, 128)}px`,
      zIndex: '9999',
    }
  }
}

watch(
  () => props.isActive,
  (active) => {
    if (active) {
      wasCancelled = false
      draft.value = props.value ?? ''
      suggestions.value = []
      showDropdown.value = false
      nextTick(() => {
        inputRef.value?.focus()
        inputRef.value?.select()
      })
    } else {
      suggestions.value = []
      showDropdown.value = false
    }
  },
)

watch(draft, (q) => {
  if (!props.searchFn || !props.isActive) return
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!q.trim()) {
    suggestions.value = []
    showDropdown.value = false
    return
  }
  debounceTimer = setTimeout(async () => {
    const requestId = ++latestRequestId
    const results = await props.searchFn!(q)
    if (requestId !== latestRequestId) return
    suggestions.value = results
    if (results.length > 0) {
      computeDropdownStyle()
      showDropdown.value = true
    } else {
      showDropdown.value = false
    }
    activeIndex.value = -1
  }, 200)
})

function selectSuggestion(s: string) {
  draft.value = s
  suggestions.value = []
  showDropdown.value = false
  emitSaveIfChanged(s)
}

function normalizedTextValue(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function emitSaveIfChanged(nextValue: string | null) {
  const normalizedNext = normalizedTextValue(nextValue)
  const normalizedCurrent = normalizedTextValue(props.value)
  if (normalizedNext === normalizedCurrent) {
    emit('cancel')
    return
  }
  emit('save', normalizedNext)
}

function handleBlur() {
  blurTimer = setTimeout(() => {
    if (wasCancelled) return
    showDropdown.value = false
    emitSaveIfChanged(draft.value)
  }, 150)
}

function handleKeydown(e: KeyboardEvent) {
  if (showDropdown.value && suggestions.value.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIndex.value = Math.min(activeIndex.value + 1, suggestions.value.length - 1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIndex.value = Math.max(activeIndex.value - 1, -1)
      return
    }
    if (e.key === 'Enter' && activeIndex.value >= 0) {
      e.preventDefault()
      const s = suggestions.value[activeIndex.value]
      if (s) selectSuggestion(s)
      return
    }
    if (e.key === 'Escape') {
      showDropdown.value = false
      return
    }
  }

  if (e.key === 'Enter') {
    e.preventDefault()
    emitSaveIfChanged(draft.value)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    wasCancelled = true
    emit('cancel')
  } else if (e.key === 'Tab') {
    e.preventDefault()
    emit('navigate', e.shiftKey ? 'prev' : 'next')
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    emit('navigate', 'rowDown')
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    emit('navigate', 'rowUp')
  }
}

function handleClick() {
  if (!props.isReadOnly) emit('activate')
}
</script>

<template>
  <div class="relative w-full min-w-0">
    <input
      v-if="isActive"
      ref="inputRef"
      v-model="draft"
      type="text"
      class="w-full rounded border border-primary/50 bg-background px-1.5 py-0.5 text-sm text-foreground outline-none focus:border-primary/70"
      :role="searchFn ? 'combobox' : undefined"
      :aria-expanded="searchFn ? showDropdown : undefined"
      :aria-controls="searchFn && showDropdown ? 'text-cell-suggestions' : undefined"
      :aria-activedescendant="searchFn && activeIndex >= 0 ? `suggestion-${activeIndex}` : undefined"
      aria-autocomplete="list"
      @blur="handleBlur"
      @keydown="handleKeydown"
    />
    <Teleport to="body">
      <div
        v-if="isActive && showDropdown"
        id="text-cell-suggestions"
        role="listbox"
        class="max-h-40 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
        :style="dropdownStyle"
      >
        <button
          v-for="(s, i) in suggestions"
          :id="`suggestion-${i}`"
          :key="s"
          type="button"
          role="option"
          :aria-selected="i === activeIndex"
          class="w-full truncate px-2.5 py-1 text-left text-sm text-foreground hover:bg-accent"
          :class="{ 'bg-accent': i === activeIndex }"
          @mousedown.prevent="selectSuggestion(s)"
        >
          {{ s }}
        </button>
      </div>
    </Teleport>
    <div v-if="!isActive" class="group/text-cell relative w-full min-w-0">
      <span
        class="block min-h-[20px] min-w-0 truncate rounded px-1 text-sm transition-[padding-right] duration-150"
        :class="[
          isReadOnly ? 'text-foreground' : 'cursor-pointer hover:bg-primary/5',
          value ? 'text-foreground' : 'text-muted-foreground/40',
          openLink ? 'pr-1 group-hover/text-cell:pr-6 group-focus-within/text-cell:pr-6' : 'pr-1',
        ]"
        :title="value ?? ''"
        :tabindex="isReadOnly ? -1 : 0"
        :role="isReadOnly ? undefined : 'button'"
        @click="handleClick"
        @keydown.space.prevent="handleClick"
      >
        {{ value || '-' }}
      </span>
      <RouterLink
        v-if="openLink"
        :to="openLink"
        class="absolute right-0.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-primary/10 hover:text-primary"
        :class="
          alwaysShowOpenLinkIcon
            ? 'opacity-100'
            : 'pointer-events-none opacity-0 group-hover/text-cell:pointer-events-auto group-hover/text-cell:opacity-100 group-focus-within/text-cell:pointer-events-auto group-focus-within/text-cell:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100'
        "
        :aria-label="openLinkLabel ?? t('book.table.text.openDetails')"
        :title="openLinkLabel ?? t('book.table.text.openDetails')"
        @click.stop
      >
        <ExternalLink :size="12" />
      </RouterLink>
    </div>
  </div>
</template>
