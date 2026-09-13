<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from '@lucide/vue'

const { t } = useI18n()

const props = defineProps<{
  modelValue: string[]
  placeholder?: string
  /** Omit for a free-text list: chips are whatever is typed, with no suggestion dropdown. */
  searchFn?: (q: string) => Promise<string[]>
  /** Returns null to reject an entry, so a list with a format can enforce it as it is typed. */
  normalize?: (raw: string) => string | null
  disabled?: boolean
  controlClass?: string
  inputId?: string
  inputMode?: 'numeric' | 'text'
  describedBy?: string
  invalid?: boolean
  removeLabel?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const query = ref('')
const results = ref<string[]>([])
const showDropdown = ref(false)
let debounceTimer: ReturnType<typeof setTimeout>

const inputPlaceholder = computed(() => {
  if (props.modelValue.length === 0) return props.placeholder ?? t('components.ui.chipInput.typeAndEnter')
  return props.placeholder === undefined ? t('components.ui.chipInput.pressEnter') : ''
})

/** Operators paste whole comma-separated lists, which is how these values are written down. */
const SEPARATORS = /[,\n\t;]/

async function onInput() {
  if (props.disabled) return
  clearTimeout(debounceTimer)

  if (SEPARATORS.test(query.value)) {
    commitSeparated()
    return
  }

  if (!props.searchFn || !query.value.trim()) {
    results.value = []
    showDropdown.value = false
    return
  }
  const searchFn = props.searchFn
  debounceTimer = setTimeout(async () => {
    const res = await searchFn(query.value)
    results.value = res.filter((r) => !props.modelValue.includes(r))
    showDropdown.value = results.value.length > 0
  }, 200)
}

/**
 * Everything before the final separator is complete; whatever follows it is still being typed and
 * stays in the box, so pasting a list and continuing to type both behave.
 */
function commitSeparated() {
  const parts = query.value.split(SEPARATORS)
  const trailing = parts.pop() ?? ''
  const next = [...props.modelValue]
  for (const part of parts) {
    const value = accept(part, next)
    if (value !== null) next.push(value)
  }
  if (next.length !== props.modelValue.length) emit('update:modelValue', next)
  query.value = trailing
  results.value = []
  showDropdown.value = false
}

/** Null for anything the field will not take: blank, a duplicate, or rejected by `normalize`. */
function accept(raw: string, existing: readonly string[]): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = props.normalize ? props.normalize(trimmed) : trimmed
  if (value === null || value === '' || existing.includes(value)) return null
  return value
}

function addItem(item: string) {
  if (props.disabled) return
  const value = accept(item, props.modelValue)
  if (value !== null) emit('update:modelValue', [...props.modelValue, value])
  query.value = ''
  results.value = []
  showDropdown.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (props.disabled) return
  if (e.key === 'Enter' && query.value.trim()) {
    e.preventDefault()
    addItem(query.value)
  } else if (e.key === 'Backspace' && !query.value && props.modelValue.length > 0) {
    emit('update:modelValue', props.modelValue.slice(0, -1))
  }
}

/** A half-typed entry is meant, so committing it on the way out beats silently discarding it. */
function commitPending() {
  if (query.value.trim()) addItem(query.value)
}

function removeItem(item: string) {
  if (props.disabled) return
  emit(
    'update:modelValue',
    props.modelValue.filter((v) => v !== item),
  )
}

function onBlur() {
  setTimeout(() => {
    showDropdown.value = false
  }, 150)
}

defineExpose({ commitPending })

onUnmounted(() => clearTimeout(debounceTimer))
</script>

<template>
  <div class="relative">
    <div
      class="min-h-10 flex flex-wrap gap-1.5 rounded-md border bg-background px-3 py-2 text-sm focus-within:ring-1 focus-within:ring-ring transition-shadow"
      :class="[props.disabled ? 'cursor-not-allowed opacity-60' : '', props.invalid ? 'border-destructive' : 'border-input', props.controlClass]"
    >
      <span v-for="item in modelValue" :key="item" class="flex items-center gap-1 bg-muted px-2 py-0.5 rounded-full text-xs">
        {{ item }}
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground transition-colors disabled:pointer-events-none"
          :disabled="props.disabled"
          @click="removeItem(item)"
        >
          <X class="size-3" aria-hidden="true" />
          <span class="sr-only">{{ removeLabel ?? t('components.ui.chipInput.remove', { value: item }) }}</span>
        </button>
      </span>
      <input
        :id="inputId"
        v-model="query"
        enterkeyhint="enter"
        class="flex-1 min-w-24 bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        :placeholder="inputPlaceholder"
        :disabled="props.disabled"
        :inputmode="inputMode"
        :aria-describedby="describedBy"
        :aria-invalid="invalid || undefined"
        @input="onInput"
        @keydown="onKeydown"
        @blur="onBlur"
      />
    </div>
    <ul v-if="showDropdown" class="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
      <li v-for="item in results" :key="item" class="px-3 py-2 text-sm cursor-pointer hover:bg-muted" @mousedown.prevent="addItem(item)">
        {{ item }}
      </li>
    </ul>
  </div>
</template>
