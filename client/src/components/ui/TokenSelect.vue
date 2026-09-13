<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronsUpDown, X } from '@lucide/vue'

/**
 * A closed-set multi-select: type to narrow a long list, add several, see what is chosen, drop one
 * by name.
 *
 * It replaces a native `<select multiple>`, which asked an operator to know that cmd-click toggles
 * and a plain click discards everything else, and showed four rows of a list ninety entries long.
 * A bound array could not drive one either: Vue stringifies `:value`, so two selections resolved to
 * "en,de", no option carried that, and the browser silently cleared the whole box.
 */
const props = defineProps<{
  options: readonly { value: string; label: string }[]
  modelValue: readonly string[]
  /** Ties the field to the caller's visible label, and namespaces the listbox and option ids. */
  inputId: string
  /** Shown while nothing is chosen, which is where "any" is worth saying out loud. */
  placeholder?: string
  disabled?: boolean
  describedBy?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const { t } = useI18n()

const inputRef = ref<HTMLInputElement | null>(null)
const query = ref('')
const open = ref(false)
const activeIndex = ref(-1)

const listboxId = computed(() => `${props.inputId}-listbox`)
const activeOptionId = computed(() => (activeIndex.value >= 0 ? `${props.inputId}-option-${activeIndex.value}` : undefined))

/** Ordered by the option list rather than by when each was picked, so the chips stay alphabetical. */
const chips = computed(() => props.options.filter((option) => props.modelValue.includes(option.value)))

/** A code matches as well as a name, so someone who thinks in "de" is not made to spell German. */
const matches = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return props.options.filter((option) => {
    if (props.modelValue.includes(option.value)) return false
    if (!needle) return true
    return option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle)
  })
})

function openList() {
  if (props.disabled) return
  open.value = true
  activeIndex.value = -1
}

function toggleList() {
  if (props.disabled) return
  if (open.value) {
    open.value = false
    return
  }
  open.value = true
  activeIndex.value = -1
  inputRef.value?.focus()
}

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
  open.value = true
  activeIndex.value = -1
}

function add(value: string) {
  if (props.disabled || props.modelValue.includes(value)) return
  emit('update:modelValue', [...props.modelValue, value])
  query.value = ''
  activeIndex.value = -1
  inputRef.value?.focus()
}

function remove(value: string) {
  if (props.disabled) return
  emit(
    'update:modelValue',
    props.modelValue.filter((entry) => entry !== value),
  )
}

function onKeydown(event: KeyboardEvent) {
  if (props.disabled) return

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    open.value = true
    activeIndex.value = Math.min(activeIndex.value + 1, matches.value.length - 1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, -1)
    return
  }
  if (event.key === 'Enter') {
    // A query narrowed to one is unambiguous, so Enter takes it without an arrow key first.
    const option = activeIndex.value >= 0 ? matches.value[activeIndex.value] : matches.value.length === 1 ? matches.value[0] : undefined
    if (!option) return
    event.preventDefault()
    add(option.value)
    return
  }
  if (event.key === 'Escape') {
    open.value = false
    query.value = ''
    return
  }
  if (event.key === 'Backspace' && query.value === '' && chips.value.length > 0) {
    const last = chips.value[chips.value.length - 1]
    if (last) remove(last.value)
  }
}

function onBlur() {
  setTimeout(() => {
    open.value = false
    query.value = ''
  }, 150)
}
</script>

<template>
  <div class="relative">
    <div
      class="flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1 transition-shadow focus-within:ring-2 focus-within:ring-ring"
      :class="disabled ? 'cursor-not-allowed opacity-50' : ''"
    >
      <span v-for="chip in chips" :key="chip.value" class="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">
        {{ chip.label }}
        <button
          type="button"
          class="text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none motion-reduce:transition-none"
          :disabled="disabled"
          @click="remove(chip.value)"
        >
          <X :size="11" aria-hidden="true" />
          <span class="sr-only">{{ t('components.ui.tokenSelect.remove', { value: chip.label }) }}</span>
        </button>
      </span>

      <input
        :id="inputId"
        ref="inputRef"
        :value="query"
        type="text"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        :aria-expanded="open"
        :aria-controls="listboxId"
        :aria-activedescendant="activeOptionId"
        :aria-describedby="describedBy"
        :disabled="disabled"
        :placeholder="chips.length === 0 ? placeholder : ''"
        class="min-w-20 flex-1 bg-transparent px-1 py-0.5 text-xs text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        @focus="openList"
        @input="onInput"
        @keydown="onKeydown"
        @blur="onBlur"
      />

      <button
        type="button"
        class="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none motion-reduce:transition-none"
        :disabled="disabled"
        :aria-label="t('components.ui.tokenSelect.showOptions')"
        @mousedown.prevent="toggleList"
      >
        <ChevronsUpDown :size="12" aria-hidden="true" />
      </button>
    </div>

    <ul
      v-show="open"
      :id="listboxId"
      role="listbox"
      :aria-multiselectable="true"
      class="absolute z-50 mt-1 max-h-56 w-full min-w-44 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
    >
      <li v-if="matches.length === 0" class="px-2.5 py-1.5 text-xs text-muted-foreground">
        {{ t('components.ui.tokenSelect.noMatches') }}
      </li>
      <li
        v-for="(option, index) in matches"
        :id="`${inputId}-option-${index}`"
        :key="option.value"
        role="option"
        :aria-selected="false"
        class="cursor-pointer px-2.5 py-1.5 text-xs text-foreground"
        :class="index === activeIndex ? 'bg-accent' : 'hover:bg-accent'"
        @mousedown.prevent="add(option.value)"
      >
        {{ option.label }}
      </li>
    </ul>
  </div>
</template>
