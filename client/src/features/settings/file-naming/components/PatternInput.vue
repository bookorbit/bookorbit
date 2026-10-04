<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { File, Folder, FolderOpen } from '@lucide/vue'
import type { OrganizationMode, PatternToken } from '@bookorbit/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import PatternText from './PatternText.vue'
import {
  canToggleOptional,
  displayOffset,
  displayText,
  joinWithPreviousLevel,
  patternLevels,
  patternOffset,
  stripDisplayNewlines,
  toggleOptionalLevel,
  type PatternLevel,
} from '../lib/pattern-levels'
import { completeToken, matchTokens, partialTokenAt, TOKEN_DESCRIPTION_KEYS } from '../lib/pattern-tokens'
import type { NamingTarget } from '../lib/naming-rules'

const props = withDefaults(
  defineProps<{
    id: string
    modelValue: string
    ariaLabel?: string
    describedBy?: string
    invalid?: boolean
    readonly?: boolean
    disabled?: boolean
    placeholder?: string
    /** Draws one folder level per line with a gutter of level icons. */
    lines?: boolean
    mode?: OrganizationMode | null
    target?: NamingTarget
    /** Values shown beside each suggestion, so a token is recognised by what it produces. */
    sampleValues?: Record<string, string>
  }>(),
  { readonly: false, disabled: false, invalid: false, lines: false, mode: null, target: 'upload', sampleValues: () => ({}) },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  /** True while a token is being typed through the suggestions, so its open brace is not an error yet. */
  completing: [value: boolean]
}>()

const { t } = useI18n()

const entry = ref<HTMLTextAreaElement | null>(null)

const levels = computed<PatternLevel[]>(() =>
  props.lines ? patternLevels(props.modelValue, props.mode, props.target) : [{ text: props.modelValue, kind: 'file', bookFolder: false }],
)
const display = computed(() => (props.lines ? displayText(levels.value) : props.modelValue))
const isEmpty = computed(() => props.modelValue.length === 0)
const editable = computed(() => !props.readonly && !props.disabled)
const splitsIntoFolders = computed(() => props.lines && props.target === 'upload')

/** Folder numbers count folders only, so the file line never shifts them. */
function levelLabel(index: number): string {
  const level = levels.value[index]
  if (!level || level.kind === 'file') return t('settings.reader.fileNaming.level.file')
  if (level.bookFolder) return t('settings.reader.fileNaming.level.bookFolder')
  const number = levels.value.slice(0, index + 1).filter((entry) => entry.kind !== 'file').length
  return t('settings.reader.fileNaming.level.folder', { n: number })
}

function levelIcon(level: PatternLevel) {
  if (level.kind === 'file') return File
  return level.bookFolder ? FolderOpen : Folder
}

function isToggle(level: PatternLevel): boolean {
  return editable.value && splitsIntoFolders.value && canToggleOptional(level)
}

function toggleTooltip(level: PatternLevel): string {
  return level.kind === 'optional' ? t('settings.reader.fileNaming.level.skippedWhenEmpty') : t('settings.reader.fileNaming.level.alwaysCreated')
}

/* ───────────── caret plumbing ───────────── */

function caretInPattern(): number {
  const field = entry.value
  if (!field) return props.modelValue.length
  return props.lines ? patternOffset(field.value, field.selectionStart ?? 0) : (field.selectionStart ?? 0)
}

/** Emits the new pattern, then puts the caret back once the display has been redrawn around it. */
function commit(value: string, caret: number) {
  emit('update:modelValue', value)
  void nextTick(() => {
    const field = entry.value
    if (!field) return
    const offset = props.lines ? displayOffset(patternLevels(value, props.mode, props.target), caret) : caret
    field.setSelectionRange(offset, offset)
  })
}

/* ───────────── token suggestions after "{" ───────────── */

const suggestion = ref<{ start: number; query: string } | null>(null)
const activeIndex = ref(0)
const listboxId = computed(() => `${props.id}-tokens`)
const suggestions = computed<PatternToken[]>(() => (suggestion.value ? matchTokens(suggestion.value.query) : []))
const suggestOpen = computed(() => suggestion.value !== null)
const optionId = (index: number) => `${props.id}-token-${index}`

watch(suggestOpen, (open) => {
  emit('completing', open)
})
const tokenText = (token: string) => `{${token}}`

function refreshSuggestion(value: string, caret: number) {
  const next = partialTokenAt(value, caret)
  if (next && (!suggestion.value || suggestion.value.start !== next.start)) activeIndex.value = 0
  suggestion.value = next
}

function closeSuggestions() {
  suggestion.value = null
}

function chooseSuggestion(token: PatternToken) {
  const current = suggestion.value
  if (!current) return
  const completed = completeToken(props.modelValue, current.start, caretInPattern(), token)
  closeSuggestions()
  commit(completed.pattern, completed.caret)
}

function handleOptionDown(event: MouseEvent, token: PatternToken) {
  // Keeps focus, and so the caret, in the field while the option is picked.
  event.preventDefault()
  chooseSuggestion(token)
}

/* ───────────── events ───────────── */

function handleInput(event: Event) {
  const field = event.target as HTMLTextAreaElement
  const caret = props.lines ? patternOffset(field.value, field.selectionStart ?? 0) : (field.selectionStart ?? 0)
  // Patterns are a single path expression; a pasted or typed newline would silently corrupt one.
  const value = stripDisplayNewlines(field.value)
  refreshSuggestion(value, caret)
  if (!props.lines && value !== field.value) field.value = value
  commit(value, caret)
}

function handleKeydown(event: KeyboardEvent) {
  if (suggestOpen.value && suggestions.value.length > 0) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      activeIndex.value = (activeIndex.value + step + suggestions.value.length) % suggestions.value.length
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const token = suggestions.value[activeIndex.value]
      if (token) chooseSuggestion(token)
      return
    }
  }
  if (event.key === 'Escape' && suggestOpen.value) {
    event.preventDefault()
    event.stopPropagation()
    closeSuggestions()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    // Enter means "start a new folder", which is a slash; the line break follows from it.
    if (splitsIntoFolders.value && editable.value) insertAtCaret('/')
    return
  }
  if (event.key === 'Backspace' && props.lines && editable.value) {
    const field = event.target as HTMLTextAreaElement
    const at = field.selectionStart ?? 0
    if (at !== field.selectionEnd || field.value.charAt(at - 1) !== '\n') return
    // Deleting the line break alone would be undone by the next redraw; remove the slash instead.
    const joined = joinWithPreviousLevel(props.modelValue, patternOffset(field.value, at))
    if (!joined) return
    event.preventDefault()
    commit(joined.pattern, joined.offset)
  }
}

function handleBlur() {
  closeSuggestions()
}

function handleToggle(index: number) {
  const next = toggleOptionalLevel(levels.value, index)
  if (next !== null) emit('update:modelValue', next)
}

/** Lets the insert bar drop text at the caret instead of appending it. */
function insertAtCaret(text: string, caretOffset = text.length) {
  const field = entry.value
  if (!field || !editable.value) return
  const start = caretInPattern()
  const end = props.lines ? patternOffset(field.value, field.selectionEnd ?? start) : (field.selectionEnd ?? start)
  const next = props.modelValue.slice(0, start) + text + props.modelValue.slice(end)
  field.focus()
  commit(next, start + caretOffset)
}

function focus() {
  entry.value?.focus()
}

defineExpose({ insertAtCaret, focus })
</script>

<template>
  <div
    class="relative rounded-md border bg-background transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/45"
    :class="[
      invalid ? 'border-destructive focus-within:border-destructive focus-within:ring-destructive/40' : 'border-input',
      readonly ? 'border-dashed bg-muted/30' : '',
      disabled ? 'opacity-50' : '',
    ]"
  >
    <textarea
      :id="id"
      ref="entry"
      :value="display"
      rows="1"
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      :readonly="readonly"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-describedby="describedBy"
      :aria-invalid="invalid ? 'true' : undefined"
      :aria-autocomplete="editable ? 'list' : undefined"
      :aria-controls="suggestOpen ? listboxId : undefined"
      :aria-activedescendant="suggestOpen && suggestions.length ? optionId(activeIndex) : undefined"
      class="pattern-text absolute inset-y-0 end-0 z-10 resize-none overflow-hidden border-0 bg-transparent py-1.5 pe-2.5 font-mono text-[13px] leading-6 text-transparent caret-primary outline-none selection:bg-primary/30"
      :class="lines ? 'start-9 ps-2.5' : 'start-0 ps-2.5'"
      @input="handleInput"
      @keydown="handleKeydown"
      @blur="handleBlur"
    />

    <span v-if="lines" aria-hidden="true" class="pointer-events-none absolute inset-y-0 start-9 w-px bg-border/70" />

    <!-- The painted layer sits in normal flow so it, not JavaScript, sets the height. -->
    <div class="pattern-text min-h-9 py-1.5 pe-2.5 font-mono text-[13px] leading-6" :class="lines ? 'ps-[2.875rem]' : 'ps-2.5'">
      <div
        v-for="(level, index) in levels"
        :key="index"
        class="relative min-h-6"
        :class="lines && index > 0 ? 'shadow-[inset_0_1px_0_color-mix(in_oklch,var(--border)_70%,transparent)]' : ''"
      >
        <template v-if="lines">
          <Tooltip v-if="isToggle(level)">
            <TooltipTrigger as-child>
              <button
                type="button"
                class="absolute -start-[2.875rem] top-0 z-20 grid h-6 w-9 place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                :aria-pressed="level.kind === 'optional'"
                :aria-label="t('settings.reader.fileNaming.level.skipWhenEmpty', { level: levelLabel(index) })"
                @click="handleToggle(index)"
              >
                <Folder :size="13" :class="level.kind === 'optional' ? 'folder-dashed text-pattern-optional' : ''" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ toggleTooltip(level) }}</TooltipContent>
          </Tooltip>
          <span
            v-else
            class="absolute -start-[2.875rem] top-0 grid h-6 w-9 place-items-center"
            :class="level.kind === 'file' || level.bookFolder ? 'text-primary' : 'text-muted-foreground'"
            :title="levelLabel(index)"
            aria-hidden="true"
          >
            <component :is="levelIcon(level)" :size="13" :class="level.kind === 'optional' ? 'folder-dashed text-pattern-optional' : ''" />
          </span>
        </template>
        <span aria-hidden="true"
          ><span v-if="isEmpty && index === 0" class="text-muted-foreground">{{ placeholder }}</span
          ><PatternText v-else :pattern="level.text" /><span
            v-if="lines && splitsIntoFolders && level.kind === 'file' && !level.text && !isEmpty"
            class="font-sans text-xs text-muted-foreground"
            >{{ t('settings.reader.fileNaming.uploadedNameKept') }}</span
          >&#8203;</span
        >
      </div>
    </div>

    <ul
      v-if="suggestOpen"
      :id="listboxId"
      role="listbox"
      :aria-label="t('settings.reader.fileNaming.tokenSuggestions')"
      class="absolute inset-x-0 top-full z-30 mt-1 max-h-72 list-none overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
    >
      <li
        v-for="(token, index) in suggestions"
        :id="optionId(index)"
        :key="token"
        role="option"
        :aria-selected="index === activeIndex"
        class="grid cursor-default grid-cols-[8.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2 py-1.5 text-xs"
        :class="index === activeIndex ? 'bg-accent text-accent-foreground' : ''"
        @mousedown="handleOptionDown($event, token)"
      >
        <span class="font-mono font-semibold text-pattern-token">{{ tokenText(token) }}</span>
        <span class="truncate text-foreground">{{ t(TOKEN_DESCRIPTION_KEYS[token]) }}</span>
        <span class="max-w-40 truncate text-muted-foreground">{{ sampleValues[token] || '' }}</span>
      </li>
      <li v-if="suggestions.length === 0" class="px-2 py-1.5 text-xs text-muted-foreground">
        {{ t('settings.reader.fileNaming.noTokenMatch', { query: suggestion?.query ?? '' }) }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.pattern-text {
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: normal;
  tab-size: 2;
  font-variant-ligatures: none;
}

.folder-dashed :deep(path) {
  stroke-dasharray: 2.6 2.4;
}
</style>
