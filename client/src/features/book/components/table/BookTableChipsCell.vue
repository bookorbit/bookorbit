<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import ChipInput from '@/components/ui/ChipInput.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const props = defineProps<{
  value: string[]
  isActive: boolean
  isReadOnly?: boolean
  searchFn?: (q: string) => Promise<string[]>
  linkFn?: (chip: string) => string | null
  chipActionFn?: (chip: string) => void
}>()

const emit = defineEmits<{
  activate: []
  save: [value: string[]]
  cancel: []
  navigate: [direction: 'next' | 'prev']
}>()

const { t } = useI18n()

const defaultSearchFn = () => Promise.resolve([])

const isOpen = ref(false)
const draft = ref<string[]>([...props.value])

watch(
  () => props.isActive,
  (active) => {
    if (active && !isOpen.value) {
      draft.value = [...props.value]
      isOpen.value = true
    } else if (!active && isOpen.value) {
      isOpen.value = false
    }
  },
)

function handleOpenChange(open: boolean) {
  isOpen.value = open
  if (open) {
    draft.value = [...props.value]
    if (!props.isActive) emit('activate')
  } else if (props.isActive) {
    const changed = draft.value.length !== props.value.length || draft.value.some((value, index) => value !== props.value[index])
    if (changed) {
      emit('save', draft.value)
    } else {
      emit('cancel')
    }
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Tab') {
    e.preventDefault()
    const snap = [...draft.value]
    isOpen.value = false
    emit('save', snap)
    emit('navigate', e.shiftKey ? 'prev' : 'next')
  }
}

function handleChipAction(chip: string) {
  props.chipActionFn?.(chip)
}
</script>

<template>
  <div class="w-full min-w-0">
    <Popover :open="isOpen" @update:open="handleOpenChange">
      <PopoverTrigger as-child :disabled="isReadOnly">
        <div
          data-cell-activator="true"
          class="flex min-h-[28px] flex-wrap items-center gap-1 px-1 py-0.5"
          :class="isReadOnly ? '' : 'cursor-pointer rounded hover:bg-primary/5'"
          :role="isReadOnly ? undefined : 'button'"
          :tabindex="isReadOnly ? -1 : 0"
        >
          <template v-if="value.length > 0">
            <template v-for="(chip, idx) in value.slice(0, 2)" :key="idx">
              <RouterLink
                v-if="linkFn?.(chip)"
                :to="linkFn(chip)!"
                class="rounded-full bg-muted px-1.5 py-0.5 text-xs text-primary hover:underline"
                @click.stop
              >
                {{ chip }}
              </RouterLink>
              <button
                v-else-if="chipActionFn"
                type="button"
                class="rounded-full bg-muted px-1.5 py-0.5 text-xs text-primary hover:underline"
                @click.stop="handleChipAction(chip)"
              >
                {{ chip }}
              </button>
              <span v-else class="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {{ chip }}
              </span>
            </template>
            <span v-if="value.length > 2" class="text-xs text-muted-foreground"> +{{ value.length - 2 }} </span>
          </template>
          <span v-else class="text-xs text-muted-foreground/40">-</span>
        </div>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        :side-offset="2"
        :trap-focus="false"
        class="w-auto p-2"
        :style="{ minWidth: 'max(240px, var(--reka-popover-trigger-width))', maxWidth: 'min(400px, 90vw)' }"
        @keydown="handleKeydown"
      >
        <ChipInput v-model="draft" :search-fn="searchFn ?? defaultSearchFn" :placeholder="t('book.table.chips.addPlaceholder')" />
      </PopoverContent>
    </Popover>
  </div>
</template>
