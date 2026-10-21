<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Eye, EyeOff, GripVertical, Lock } from '@lucide/vue'
import { useThemeStore } from '@/stores/theme'

const props = defineProps<{
  name: string
  hidden: boolean
  locked: boolean
  lifted: boolean
  /** Rows and groups sort in nested lists, so each needs its own handle selector. */
  handleClass: string
}>()

const emit = defineEmits<{ toggle: []; 'grip-keydown': [KeyboardEvent]; 'grip-blur': [] }>()

const { t } = useI18n()
const themeStore = useThemeStore()
const iconRadiusClass = computed(() => (themeStore.radius === 'sharp' ? 'rounded-none' : 'rounded-full'))
const lockedLabel = computed(() => t('components.sidebar.customize.alwaysShown', { name: props.name }))

function handleToggle() {
  emit('toggle')
}

function handleGripKeydown(event: KeyboardEvent) {
  emit('grip-keydown', event)
}

function handleGripBlur() {
  emit('grip-blur')
}
</script>

<template>
  <!-- Fixed widths keep the eye and grip in one column down every row and group header. On touch
       screens each hit area grows sideways into the label and row padding, and by 1px to the 30px
       row pitch, so a finger gets a 32px eye and a 24px grip without neighbouring rows overlapping. -->
  <div class="flex shrink-0 items-center gap-px">
    <template v-if="locked">
      <span class="flex size-6 items-center justify-center text-muted-foreground" :title="lockedLabel">
        <Lock :size="13" :stroke-width="2.25" aria-hidden="true" />
        <span class="sr-only">{{ lockedLabel }}</span>
      </span>
      <span class="w-4" aria-hidden="true" />
    </template>
    <template v-else>
      <button
        type="button"
        class="relative flex size-6 items-center justify-center outline-hidden transition-colors duration-150 before:absolute before:content-[''] hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-sidebar-ring pointer-coarse:before:-inset-y-[3px] pointer-coarse:before:-start-2 pointer-coarse:before:end-0"
        :class="[iconRadiusClass, hidden ? 'text-muted-foreground hover:text-sidebar-foreground' : 'text-sidebar-foreground']"
        :aria-pressed="!hidden"
        :aria-label="t('components.sidebar.customize.showInSidebar', { name })"
        :title="hidden ? t('components.sidebar.customize.show') : t('components.sidebar.customize.hide')"
        @click="handleToggle"
      >
        <EyeOff v-if="hidden" :size="15" aria-hidden="true" />
        <Eye v-else :size="15" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="relative flex h-7 w-4 shrink-0 cursor-grab items-center justify-center rounded-sm outline-hidden transition-colors duration-150 before:absolute before:content-[''] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring pointer-coarse:before:-inset-y-px pointer-coarse:before:start-0 pointer-coarse:before:-end-2"
        :class="[handleClass, lifted ? 'text-primary' : 'text-muted-foreground']"
        :aria-label="t('components.sidebar.reorder.gripAria', { name })"
        :aria-pressed="lifted"
        @keydown="handleGripKeydown"
        @blur="handleGripBlur"
      >
        <GripVertical :size="13" aria-hidden="true" />
      </button>
    </template>
  </div>
</template>
