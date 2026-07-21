<script setup lang="ts">
import { computed } from 'vue'
import { X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { t } = useI18n()

const isMac = computed(() => typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent))
const modKey = computed(() => (isMac.value ? '⌘' : 'Ctrl'))

function handleClose() {
  emit('update:open', false)
}

const sections = computed(() => [
  {
    title: t('book.shortcuts.navigation.title'),
    shortcuts: [
      { keys: ['↑', '↓'], label: t('book.shortcuts.navigation.moveFocusVertical') },
      { keys: ['←', '→'], label: t('book.shortcuts.navigation.moveFocusHorizontal') },
      { keys: ['Home'], label: t('book.shortcuts.navigation.jumpFirstColumn') },
      { keys: ['End'], label: t('book.shortcuts.navigation.jumpLastColumn') },
      { keys: [`${modKey.value}+Home`], label: t('book.shortcuts.navigation.jumpFirstRow') },
      { keys: [`${modKey.value}+End`], label: t('book.shortcuts.navigation.jumpLastRow') },
    ],
  },
  {
    title: t('book.shortcuts.actions.title'),
    shortcuts: [
      { keys: ['Enter'], label: t('book.shortcuts.actions.editCell') },
      { keys: ['Escape'], label: t('book.shortcuts.actions.cancelEditing') },
      { keys: ['Space'], label: t('book.shortcuts.actions.toggleRowSelection') },
      { keys: [`${modKey.value}+C`], label: t('book.shortcuts.actions.copyCell') },
      { keys: [`${modKey.value}+Shift+C`], label: t('book.shortcuts.actions.copyRow') },
    ],
  },
  {
    title: t('book.shortcuts.general.title'),
    shortcuts: [{ keys: ['?'], label: t('book.shortcuts.general.toggleHelp') }],
  },
])
</script>

<template>
  <Teleport to="body">
    <Transition name="shortcut-overlay">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        @click.self="handleClose"
        @keydown.escape="handleClose"
      >
        <div class="relative w-full max-w-md rounded-xl border border-border bg-card shadow-xl" role="dialog" :aria-label="t('book.shortcuts.title')">
          <div class="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 class="text-sm font-semibold text-foreground">{{ t('book.shortcuts.title') }}</h2>
            <button
              class="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              @click="handleClose"
            >
              <X :size="14" />
            </button>
          </div>
          <div class="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-5">
            <div v-for="section in sections" :key="section.title">
              <h3 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{{ section.title }}</h3>
              <div class="space-y-1.5">
                <div v-for="shortcut in section.shortcuts" :key="shortcut.label" class="flex items-center justify-between py-1">
                  <span class="text-sm text-foreground">{{ shortcut.label }}</span>
                  <div class="flex items-center gap-1">
                    <kbd
                      v-for="key in shortcut.keys"
                      :key="key"
                      class="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded border border-border bg-muted/50 text-xs font-mono text-muted-foreground"
                    >
                      {{ key }}
                    </kbd>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.shortcut-overlay-enter-active,
.shortcut-overlay-leave-active {
  transition: opacity 0.15s ease;
}
.shortcut-overlay-enter-from,
.shortcut-overlay-leave-to {
  opacity: 0;
}
</style>
