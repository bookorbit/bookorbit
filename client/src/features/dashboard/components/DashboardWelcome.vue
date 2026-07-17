<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, Plus, Users } from '@lucide/vue'
import type { Library } from '@bookorbit/types'
import LibraryCreatorModal from '@/features/library/components/LibraryCreatorModal.vue'
import { useLibraryCreationRedirect } from '@/features/library/composables/useLibraryCreationRedirect'

defineProps<{ canCreate: boolean }>()

const { t } = useI18n()
const { handleLibraryCreated } = useLibraryCreationRedirect()
const createOpen = ref(false)

function handleOpenCreate() {
  createOpen.value = true
}

function handleClose() {
  createOpen.value = false
}

async function handleSaved(library: Library) {
  createOpen.value = false
  await handleLibraryCreated(library)
}
</script>

<template>
  <div class="flex items-center justify-center py-16 px-4">
    <div
      data-tour="welcome-card"
      class="relative w-full max-w-md overflow-hidden rounded-2xl border border-primary/40 bg-card/30 shadow-sm backdrop-blur-[1px]"
    >
      <!-- Glow backdrop -->
      <div
        class="pointer-events-none absolute inset-0"
        style="
          background-image: radial-gradient(ellipse 80% 60% at 50% -10%, color-mix(in oklch, var(--primary) 18%, transparent) 0%, transparent 100%);
        "
      />

      <div class="relative flex flex-col items-center px-10 py-12 text-center">
        <!-- Icon -->
        <div class="mb-6 flex h-14 w-14 items-center justify-center rounded-lg border border-border bg-background shadow-sm">
          <component :is="canCreate ? BookOpen : Users" :size="26" class="text-foreground/70" />
        </div>

        <!-- Heading -->
        <h2 class="mb-2 text-lg font-bold tracking-tight text-foreground">
          {{ canCreate ? t('dashboard.welcome.emptyTitle') : t('dashboard.welcome.noLibrariesTitle') }}
        </h2>

        <!-- Description -->
        <p class="mb-8 max-w-xs text-sm leading-relaxed text-muted-foreground">
          <template v-if="canCreate">
            {{ t('dashboard.welcome.emptyDescription') }}
          </template>
          <template v-else> {{ t('dashboard.welcome.noLibrariesDescription') }} </template>
        </p>

        <!-- CTA -->
        <button
          v-if="canCreate"
          class="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          @click="handleOpenCreate"
        >
          <Plus :size="15" />
          {{ t('dashboard.welcome.createFirstLibrary') }}
        </button>
      </div>
    </div>
  </div>

  <LibraryCreatorModal v-if="createOpen" @close="handleClose" @saved="handleSaved" />
</template>
