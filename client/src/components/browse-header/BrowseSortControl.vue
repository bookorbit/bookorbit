<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from '@lucide/vue'
import BrowsePanel from './BrowsePanel.vue'
import { barButton, barButtonOn, barIconButton } from './browse-header'

/**
 * Sort as two controls: the field, whose panel holds the full sort, and the direction of the first
 * tier, which flips in one click instead of opening anything. The direction reads as the field's
 * own words ("Newest first") when the host passes them.
 */
const props = withDefaults(
  defineProps<{
    label: string
    direction: 'asc' | 'desc'
    /** A sort that differs from the view's default. */
    changed?: boolean
    popoverClass?: string
    /** Tiers after the first, shown on the button as "+1". */
    extraLevels?: number
    /** The current order and the one a click switches to, in the field's words. */
    directionLabel?: string
    nextDirectionLabel?: string
    /** Drops the direction button, for sorts that have no order to flip such as Random. */
    hideDirection?: boolean
    /** Opens as a bottom sheet on a phone. */
    phoneSheet?: boolean
    /** Keeps the field name on the button at every width. */
    alwaysShowLabel?: boolean
  }>(),
  {
    changed: false,
    popoverClass: 'w-80 p-3',
    extraLevels: 0,
    directionLabel: undefined,
    nextDirectionLabel: undefined,
    hideDirection: false,
    phoneSheet: false,
    alwaysShowLabel: false,
  },
)

const emit = defineEmits<{
  'toggle-direction': []
}>()

const { t } = useI18n()

const directionTitle = computed(() => {
  if (props.directionLabel && props.nextDirectionLabel) {
    return t('components.browseHeader.sort.switchDirection', { current: props.directionLabel, next: props.nextDirectionLabel })
  }
  return props.direction === 'asc' ? t('components.browseHeader.sort.ascending') : t('components.browseHeader.sort.descending')
})

const buttonLabel = computed(() => (props.extraLevels > 0 ? `${props.label} +${props.extraLevels}` : props.label))

function handleToggleDirection() {
  emit('toggle-direction')
}
</script>

<template>
  <div class="flex shrink-0 items-center">
    <BrowsePanel :title="t('book.sort.panelTitle')" :phone-sheet="phoneSheet" :content-class="popoverClass">
      <template #trigger>
        <button
          type="button"
          :class="cn(barButton, changed && barButtonOn)"
          :aria-label="t('components.browseHeader.sort.sortBy', { field: label })"
          aria-haspopup="dialog"
        >
          <ArrowUpDown :size="14" :class="changed ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
          <span class="max-w-[11rem] truncate" :class="alwaysShowLabel ? 'inline' : 'hidden lg:inline'">{{ buttonLabel }}</span>
          <ChevronDown :size="13" class="-ms-0.5 text-muted-foreground" :class="alwaysShowLabel ? 'block' : 'hidden lg:block'" aria-hidden="true" />
        </button>
      </template>
      <slot />
    </BrowsePanel>
    <button
      v-if="!hideDirection"
      type="button"
      :class="cn(barIconButton, alwaysShowLabel ? 'inline-grid' : 'hidden sm:inline-grid')"
      :aria-label="directionTitle"
      :title="directionTitle"
      @click="handleToggleDirection"
    >
      <ArrowUp v-if="direction === 'asc'" :size="15" aria-hidden="true" />
      <ArrowDown v-else :size="15" aria-hidden="true" />
    </button>
  </div>
</template>
