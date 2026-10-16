<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResizeObserver } from '@vueuse/core'
import { BookmarkCheck, BookmarkPlus, ChevronDown, Search, Telescope, X } from '@lucide/vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { FilterToken } from '@/features/book/composables/useFilterTokens'

/**
 * The view search, and the readout of the filter that applies to it: every rule that is not a
 * facet chip shows here as a token. When the tokens no longer fit beside room to type, they fold
 * into one "N filters" token that opens the filter popover.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder: string
    tokens?: FilterToken[]
    /** Anything narrowing the view, including facet picks, which turns the clear button on. */
    active?: boolean
    canSaveAsSmartScope?: boolean
    canSaveFilter?: boolean
    filterSaved?: boolean
    /** Registers "/" to focus this field while the view is on screen. */
    shortcut?: boolean
  }>(),
  { tokens: () => [], active: false, canSaveAsSmartScope: false, canSaveFilter: false, filterSaved: false, shortcut: true },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'remove-token': [index: number]
  clear: []
  'save-as-smart-scope': []
  'save-filter': []
  'open-filters': []
}>()

const { t } = useI18n()

const rootRef = ref<HTMLElement | null>(null)
const tokensRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const summarize = ref(false)
const MIN_TYPING_ROOM = 120

const canSave = computed(() => props.tokens.length > 0 && (props.canSaveAsSmartScope || props.canSaveFilter))
const placeholderText = computed(() => (props.tokens.length > 0 ? t('common.search') : props.placeholder))

function measureTokens() {
  const root = rootRef.value
  const tokens = tokensRef.value
  if (!root || !tokens) {
    summarize.value = false
    return
  }
  const needed = tokens.scrollWidth + MIN_TYPING_ROOM
  summarize.value = props.tokens.length > 1 && needed > root.clientWidth - 120
}

useResizeObserver(rootRef, measureTokens)
watch(
  () => props.tokens,
  () => {
    summarize.value = false
    void nextTick(measureTokens)
  },
  { deep: true },
)

function handleInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function handleEscape() {
  if (props.modelValue) emit('update:modelValue', '')
  else inputRef.value?.blur()
}

function handleRemoveToken(index: number) {
  emit('remove-token', index)
}

function handleClear() {
  emit('clear')
  inputRef.value?.focus()
}

function handleSaveAsSmartScope() {
  emit('save-as-smart-scope')
}

function handleSaveFilter() {
  emit('save-filter')
}

function handleOpenFilters() {
  emit('open-filters')
}

function tokenLabel(token: FilterToken) {
  return [token.field, token.operator, token.value].filter(Boolean).join(' ')
}

/* "/" focuses the search, the way ⌘K focuses the global one. Views stay alive in a KeepAlive
   cache, so the listener follows activation rather than mount alone. */
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return Boolean(target.closest('input, textarea, select, [role="menu"], [role="listbox"], [role="dialog"], [role="grid"], [role="tablist"]'))
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key !== '/' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
  if (isTypingTarget(event.target)) return
  const input = inputRef.value
  if (!input || input.offsetParent === null) return
  event.preventDefault()
  input.focus()
}

let listening = false
function listen() {
  if (!props.shortcut || listening) return
  window.addEventListener('keydown', handleGlobalKeydown)
  listening = true
}
function unlisten() {
  if (!listening) return
  window.removeEventListener('keydown', handleGlobalKeydown)
  listening = false
}
onMounted(listen)
onActivated(listen)
onDeactivated(unlisten)
onBeforeUnmount(unlisten)

defineExpose({ focus: () => inputRef.value?.focus() })
</script>

<template>
  <div
    ref="rootRef"
    data-browse-grow
    class="relative flex h-[34px] min-w-0 flex-1 basis-[300px] items-center gap-1.5 overflow-hidden rounded-lg border border-border/60 bg-background/70 ps-2.5 pe-1 transition-colors focus-within:border-primary/45 focus-within:bg-background focus-within:ring-[3px] focus-within:ring-primary/15"
  >
    <Search :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />

    <button
      v-if="summarize"
      type="button"
      class="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-primary/45 bg-primary/12 px-2 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-primary/18 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      @click="handleOpenFilters"
    >
      {{ t('components.browseHeader.search.summaryToken', { count: tokens.length }) }}
      <ChevronDown :size="12" :stroke-width="2.25" class="text-muted-foreground" aria-hidden="true" />
    </button>
    <div
      ref="tokensRef"
      class="flex min-w-0 shrink-0 items-center gap-1.5"
      :class="summarize ? 'pointer-events-none invisible absolute' : ''"
      :aria-hidden="summarize || undefined"
    >
      <span
        v-for="token in tokens"
        :key="token.index"
        class="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-primary/45 bg-primary/12 ps-2 pe-0.5 text-[12.5px] whitespace-nowrap"
      >
        <span class="font-semibold text-foreground">{{ token.field }}</span>
        <span v-if="token.operator" class="text-muted-foreground">{{ token.operator }}</span>
        <span v-if="token.value" class="max-w-[16rem] truncate font-semibold text-primary">{{ token.value }}</span>
        <button
          type="button"
          class="grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-primary/15 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          :aria-label="t('components.browseHeader.search.removeToken', { label: tokenLabel(token) })"
          :tabindex="summarize ? -1 : undefined"
          @click="handleRemoveToken(token.index)"
        >
          <X :size="12" :stroke-width="2.25" aria-hidden="true" />
        </button>
      </span>
    </div>

    <input
      ref="inputRef"
      :value="modelValue"
      type="search"
      :placeholder="placeholderText"
      :aria-label="t('common.search')"
      class="browse-search-input h-full min-w-[3rem] flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
      @input="handleInput"
      @keydown.escape="handleEscape"
    />

    <DropdownMenu v-if="canSave">
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          class="inline-flex h-[26px] shrink-0 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <BookmarkCheck v-if="filterSaved" :size="14" class="text-primary" aria-hidden="true" />
          <BookmarkPlus v-else :size="14" class="text-muted-foreground" aria-hidden="true" />
          <span class="hidden sm:inline">{{ t('components.browseHeader.search.save') }}</span>
          <ChevronDown :size="12" :stroke-width="2.25" class="text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-60">
        <DropdownMenuItem v-if="canSaveAsSmartScope" @click="handleSaveAsSmartScope">
          <Telescope :size="14" class="mr-2" />
          {{ t('views.library.saveAsSmartScope') }}
        </DropdownMenuItem>
        <DropdownMenuItem v-if="canSaveFilter" :disabled="filterSaved" @click="handleSaveFilter">
          <BookmarkCheck v-if="filterSaved" :size="14" class="mr-2" />
          <BookmarkPlus v-else :size="14" class="mr-2" />
          {{ filterSaved ? t('views.library.filterSaved') : t('views.library.saveFilter') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <button
      v-if="active || modelValue"
      type="button"
      class="grid size-[26px] shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      :aria-label="t('components.browseHeader.search.clearAll')"
      :title="t('components.browseHeader.search.clearAll')"
      @click="handleClear"
    >
      <X :size="15" aria-hidden="true" />
    </button>
    <kbd
      v-else-if="shortcut"
      class="hidden h-5 min-w-5 shrink-0 place-items-center rounded-[5px] border border-b-2 border-border px-1.5 font-sans text-[11px] font-semibold text-muted-foreground md:grid"
      aria-hidden="true"
      >/</kbd
    >
  </div>
</template>

<style scoped>
.browse-search-input::-webkit-search-decoration,
.browse-search-input::-webkit-search-cancel-button,
.browse-search-input::-webkit-search-results-button,
.browse-search-input::-webkit-search-results-decoration {
  -webkit-appearance: none;
  appearance: none;
}
</style>
