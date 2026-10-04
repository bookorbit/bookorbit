<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, Check, ChevronDown, WandSparkles } from '@lucide/vue'
import type { OrganizationMode } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import AppIcon from '@/components/AppIcon.vue'
import { recipePattern, recipesFor, type PatternRecipe } from '../lib/pattern-recipes'
import { resolvePreview } from '../lib/pattern-resolution'
import { PREVIEW_BOOKS, type PreviewBookId } from '../lib/preview-books'
import type { NamingTarget } from '../lib/naming-rules'

const props = defineProps<{
  target: NamingTarget
  organizationMode: OrganizationMode | null
  currentPattern: string
  sanitize: boolean
  previewBookId: PreviewBookId
}>()

const emit = defineEmits<{ apply: [pattern: string]; openExamples: [] }>()

const { t } = useI18n()

interface RecipeEntry {
  id: string
  icon: string
  name: string
  pattern: string
  path: string
}

// Resolved only while the menu is rendered, so typing in the field does not re-resolve every recipe.
const entries = computed<RecipeEntry[]>(() => {
  const book = PREVIEW_BOOKS[props.previewBookId]
  return recipesFor(props.target).map((recipe: PatternRecipe) => {
    const pattern = recipePattern(recipe, props.organizationMode)
    const preview = resolvePreview(pattern, book.metadata, {
      target: props.target,
      mode: props.organizationMode,
      extension: book.extension,
      sanitize: props.sanitize,
    })
    return {
      id: recipe.id,
      icon: recipe.icon,
      name: t(`settings.reader.fileNaming.recipe.${recipe.id}` as 'settings.reader.fileNaming.recipe.seriesShelf'),
      pattern,
      path: preview.path.split('/').join(' / '),
    }
  })
})

function applyRecipe(pattern: string) {
  emit('apply', pattern)
}

function openExamples() {
  emit('openExamples')
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline" size="sm" type="button" :aria-label="t('settings.reader.fileNaming.recipes')">
        <WandSparkles :size="14" aria-hidden="true" />
        <span class="hidden @lg:inline">{{ t('settings.reader.fileNaming.recipes') }}</span>
        <ChevronDown :size="14" class="text-muted-foreground" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-[26rem] max-w-[calc(100vw-2rem)]">
      <DropdownMenuLabel class="flex items-baseline gap-2">
        <span class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{{ t('settings.reader.fileNaming.recipesTitle') }}</span>
        <span class="text-xs font-normal text-muted-foreground">{{ t('settings.reader.fileNaming.recipesReplace') }}</span>
      </DropdownMenuLabel>
      <DropdownMenuItem v-for="entry in entries" :key="entry.id" class="flex-col items-stretch gap-1 py-2" @select="applyRecipe(entry.pattern)">
        <span class="flex items-center gap-2 text-[13px] font-semibold">
          <AppIcon :icon="entry.icon" fallback="BookOpen" :size="14" aria-hidden="true" />
          {{ entry.name }}
          <span v-if="entry.pattern === currentPattern" class="ms-auto inline-flex items-center gap-1 text-xs font-medium text-primary">
            <Check :size="13" class="text-primary" aria-hidden="true" />
            {{ t('settings.reader.fileNaming.recipeInUse') }}
          </span>
        </span>
        <span class="break-words ps-[1.375rem] text-xs text-muted-foreground">{{ entry.path }}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="gap-2 text-[13px]" @select="openExamples">
        <BookOpen :size="14" aria-hidden="true" />
        {{ t('settings.reader.fileNaming.examples') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
