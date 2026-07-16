<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

const props = withDefaults(
  defineProps<{
    open: boolean
    searchQuery?: string
    placeholder?: string
  }>(),
  {
    searchQuery: '',
  },
)

const { t } = useI18n()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:searchQuery': [value: string]
}>()

const inputRef = ref<HTMLInputElement | null>(null)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    void nextTick(() => {
      inputRef.value?.focus()
    })
  },
)

function close() {
  emit('update:open', false)
}

function clear() {
  emit('update:searchQuery', '')
}

function handleInput(event: Event) {
  emit('update:searchQuery', (event.target as HTMLInputElement).value)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent side="top">
      <SheetHeader>
        <SheetTitle>{{ t('common.search') }}</SheetTitle>
        <SheetDescription class="sr-only">{{ t('components.viewHeader.mobileSearch.description') }}</SheetDescription>
      </SheetHeader>
      <div class="space-y-3 px-4 pb-6">
        <div class="flex h-9 items-center rounded-md border border-input bg-background px-2.5">
          <Search :size="13" class="mr-1.5 shrink-0 text-muted-foreground/85" />
          <input
            ref="inputRef"
            :value="searchQuery ?? ''"
            @input="handleInput"
            @keydown="handleKeydown"
            type="search"
            :placeholder="props.placeholder ?? t('components.viewHeader.searchPlaceholder')"
            class="view-header-mobile-search-input h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/85"
          />
          <button
            v-if="(searchQuery ?? '').trim().length > 0"
            class="ml-1 text-muted-foreground/85 transition-colors hover:text-foreground"
            @click="clear"
          >
            <X :size="12" />
          </button>
        </div>
        <Button variant="outline" size="sm" class="w-full" @click="close">{{ t('components.viewHeader.mobileSearch.done') }}</Button>
      </div>
    </SheetContent>
  </Sheet>
</template>

<style scoped>
.view-header-mobile-search-input::-webkit-search-decoration,
.view-header-mobile-search-input::-webkit-search-cancel-button,
.view-header-mobile-search-input::-webkit-search-results-button,
.view-header-mobile-search-input::-webkit-search-results-decoration {
  -webkit-appearance: none;
  appearance: none;
}

.view-header-mobile-search-input::-ms-clear,
.view-header-mobile-search-input::-ms-reveal {
  display: none;
  width: 0;
  height: 0;
}
</style>
