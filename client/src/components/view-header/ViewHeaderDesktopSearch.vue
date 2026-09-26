<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, X } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = withDefaults(
  defineProps<{
    searchQuery?: string
    placeholder?: string
  }>(),
  {
    searchQuery: '',
  },
)

const { t } = useI18n()

const emit = defineEmits<{
  'update:searchQuery': [value: string]
}>()

const searchActive = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)

function openSearch() {
  if (searchActive.value) return
  searchActive.value = true
  void nextTick(() => {
    searchInputRef.value?.focus()
  })
}

function clearSearchQuery() {
  emit('update:searchQuery', '')
}

function closeSearch() {
  searchActive.value = false
  clearSearchQuery()
}

function handleSearchInput(event: Event) {
  emit('update:searchQuery', (event.target as HTMLInputElement).value)
}

function handleSearchKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  closeSearch()
}
</script>

<template>
  <div class="relative hidden shrink-0 items-center md:flex">
    <Search
      :size="14"
      class="pointer-events-none absolute left-2 z-10 transition-colors duration-200"
      :class="searchActive ? 'text-primary' : 'text-muted-foreground'"
    />
    <Tooltip>
      <TooltipTrigger as-child>
        <input
          ref="searchInputRef"
          :value="searchQuery ?? ''"
          type="text"
          :placeholder="props.placeholder ?? t('components.viewHeader.searchPlaceholder')"
          :aria-label="t('common.search')"
          class="h-8 text-[13px] transition-all duration-300 focus:outline-none"
          :class="
            searchActive
              ? 'w-44 cursor-text rounded-lg border border-primary/30 bg-primary/5 pl-8 pr-6 text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary/30 lg:w-72'
              : 'w-8 cursor-pointer rounded-lg border border-input bg-transparent pl-2.25 pr-0 text-transparent placeholder:text-transparent select-none hover:border-muted-foreground/30 hover:bg-primary/5'
          "
          @focus="openSearch"
          @input="handleSearchInput"
          @keydown="handleSearchKeydown"
        />
      </TooltipTrigger>
      <TooltipContent>{{ t('common.search') }}</TooltipContent>
    </Tooltip>
    <Tooltip v-if="searchActive">
      <TooltipTrigger as-child>
        <button
          type="button"
          :aria-label="t('common.close')"
          class="absolute right-1.5 text-muted-foreground transition-colors hover:text-foreground"
          @click="closeSearch"
        >
          <X :size="13" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ t('common.close') }}</TooltipContent>
    </Tooltip>
  </div>
</template>
