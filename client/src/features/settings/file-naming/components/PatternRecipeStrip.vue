<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from '@lucide/vue'
import type { OrganizationMode } from '@bookorbit/types'
import AppIcon from '@/components/AppIcon.vue'
import { recipePattern, recipesFor, type PatternRecipe } from '../lib/pattern-recipes'
import { previewDownloadName, previewUploadPath, splitResolvedPath } from '../lib/pattern-preview'
import type { NamingTarget } from '../lib/naming-rules'

const props = defineProps<{
  target: NamingTarget
  organizationMode: OrganizationMode | null
  currentPattern: string
  sanitize: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{ apply: [pattern: string] }>()

const { t } = useI18n()

interface RecipeCard {
  id: string
  icon: string
  name: string
  pattern: string
  folders: string[]
  filename: string
}

const cards = computed<RecipeCard[]>(() =>
  recipesFor(props.target).map((recipe: PatternRecipe) => {
    const pattern = recipePattern(recipe, props.organizationMode)
    const resolved =
      props.target === 'download'
        ? previewDownloadName(pattern, { sanitizeForCrossPlatform: props.sanitize })
        : previewUploadPath(pattern, { sanitizeForCrossPlatform: props.sanitize })
    const parts = splitResolvedPath(resolved)
    return {
      id: recipe.id,
      icon: recipe.icon,
      name: t(`settings.reader.fileNaming.recipe.${recipe.id}` as 'settings.reader.fileNaming.recipe.seriesShelf'),
      pattern,
      folders: parts.folders,
      filename: `${parts.stem}${parts.extension}`,
    }
  }),
)

// Kept out of `cards` so typing in the field does not re-resolve every recipe.
function isActive(pattern: string): boolean {
  return pattern === props.currentPattern
}

function applyRecipe(pattern: string) {
  emit('apply', pattern)
}
</script>

<template>
  <div>
    <p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{{ t('settings.reader.fileNaming.recipesLabel') }}</p>
    <div class="grid gap-2 @md:grid-cols-2">
      <button
        v-for="card in cards"
        :key="card.id"
        type="button"
        :aria-pressed="isActive(card.pattern)"
        :disabled="disabled"
        class="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3 text-left transition-all hover:border-primary/50 hover:shadow-md disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        :class="isActive(card.pattern) ? 'border-primary ring-1 ring-primary' : ''"
        @click="applyRecipe(card.pattern)"
      >
        <span class="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <AppIcon :icon="card.icon" fallback="BookOpen" :size="14" aria-hidden="true" />
          {{ card.name }}
          <Check v-if="isActive(card.pattern)" :size="14" class="ml-auto shrink-0 text-primary" aria-hidden="true" />
        </span>
        <span class="break-words font-mono text-[11px] leading-snug text-muted-foreground">
          <span v-for="folder in card.folders" :key="folder">{{ folder }}/</span>
          <span class="font-semibold text-foreground">{{ card.filename }}</span>
        </span>
      </button>
    </div>
  </div>
</template>
